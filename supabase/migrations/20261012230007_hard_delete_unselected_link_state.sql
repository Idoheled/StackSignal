-- Retain useful links and unresolved work only. No rejected-link tombstones.
-- The generated state cannot drift when a service writer changes retry/review metadata.
alter table public.ss_articles add column review_state text generated always as (
 case when deleted_at is not null then 'archived'
 when jsonb_typeof(reference_meta->'evaluation')='object' then
   case when reference_meta->'evaluation'->>'decision'='useful' then 'approved' else 'discarding' end
 when reference_meta->>'evaluation_retry_at' is not null then 'retry_wait'
 when reference_meta->>'evaluation_failed_at' is not null then 'needs_attention'
 when jsonb_typeof(reference_meta->'public_evaluation_input')='object' then 'awaiting_evaluation'
 else 'awaiting_input' end
) stored;
create index ss_articles_unresolved_state on public.ss_articles(review_state,discovered_at,id)
 where review_state in('awaiting_input','awaiting_evaluation','retry_wait','needs_attention');

-- Drop stale comparison objects and redundant frozen URL copies on every write,
-- including a health snapshot written by an evaluator racing with deletion.
create function ss_private.clean_retained_settings() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.key='evaluation_health' and new.value ? 'comparisons' then
  new.value:=jsonb_set(new.value,'{comparisons}',coalesce((
   select jsonb_agg(c.value order by c.ordinality) from jsonb_array_elements(
    case when jsonb_typeof(new.value->'comparisons')='array' then new.value->'comparisons' else '[]'::jsonb end
   ) with ordinality c(value,ordinality)
   where exists(select 1 from public.ss_articles a where a.id::text=c.value->>'article_id' and a.review_state='approved')
  ),'[]'::jsonb));
 elsif new.key='assistant_review_handoff' then new.value:=new.value-'existing_urls';
 end if;
 return new;
end;$$;
revoke all on function ss_private.clean_retained_settings() from public,anon,authenticated,service_role;
create trigger clean_retained_settings before insert or update on public.ss_settings
 for each row execute function ss_private.clean_retained_settings();

-- Cleanup runs for every physical article deletion, including policy decisions,
-- maintenance and future writers. FK cascades handle bookmarks/feedback/notes.
create function ss_private.record_link_discard(meta jsonb,link text) returns void language plpgsql set search_path='' as $$
declare minimum int; decision text;
begin
 select coalesce((value->>'min_score')::int,55) into minimum from public.ss_settings where key='profile';
 decision:=meta->'evaluation'->>'decision';
 if jsonb_typeof(meta->'evaluation')='object' and (
    not ss_private.reviewed_article(meta,coalesce(minimum,55))
    or not ss_private.repo_admitted(link,meta,coalesce((select value from public.ss_settings where key='profile'),'{}'::jsonb))) then
  insert into public.ss_settings(key,value) values('link_retention',jsonb_build_object(
   'policy','hard_delete','discarded',1,'tangential',case when decision='tangential' then 1 else 0 end,
   'insufficient_evidence',case when decision='insufficient_evidence' then 1 else 0 end,
   'below_policy',case when decision not in('tangential','insufficient_evidence') then 1 else 0 end,'last_discarded_at',now()))
  on conflict(key) do update set updated_at=now(),value=ss_settings.value||jsonb_build_object(
   'discarded',coalesce((ss_settings.value->>'discarded')::bigint,0)+1,
   'tangential',coalesce((ss_settings.value->>'tangential')::bigint,0)+case when decision='tangential' then 1 else 0 end,
   'insufficient_evidence',coalesce((ss_settings.value->>'insufficient_evidence')::bigint,0)+case when decision='insufficient_evidence' then 1 else 0 end,
   'below_policy',coalesce((ss_settings.value->>'below_policy')::bigint,0)+case when decision not in('tangential','insufficient_evidence') then 1 else 0 end,'last_discarded_at',now());
 end if;
end;$$;
revoke all on function ss_private.record_link_discard(jsonb,text) from public,anon,authenticated,service_role;

create function ss_private.purge_link_records(article uuid,link text,meta jsonb) returns void language plpgsql set search_path='' as $$begin
 delete from ss_private.article_reviews where article_id=article or ss_private.review_identity(url)=ss_private.review_identity(link);
 delete from ss_private.review_cohort where ss_private.review_identity(url)=ss_private.review_identity(link);
 delete from ss_private.evaluation_claims where article_id=article;
 delete from ss_private.evaluation_attempts where article_id=article;
 delete from public.ss_jobs where payload->>'article_id'=article::text or payload->>'id'=article::text
  or ss_private.review_identity(payload->>'url')=ss_private.review_identity(link)
  or payload->>'url' in(select jsonb_array_elements_text(case when jsonb_typeof(meta->'original_urls')='array' then meta->'original_urls' else '[]'::jsonb end));
 delete from public.ss_audit where object_id in(article::text,link)
  or object_id in(select id::text from public.ss_notes where article_id=article);
end;$$;
revoke all on function ss_private.purge_link_records(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function ss_private.purge_link_caches(article uuid,link text) returns void language plpgsql set search_path='' as $$declare repo text;begin
 update public.ss_settings set value=jsonb_set(value,'{comparisons}',coalesce((
  select jsonb_agg(c) from jsonb_array_elements(value->'comparisons') c where c->>'article_id' is distinct from article::text
 ),'[]'::jsonb)),updated_at=now() where key='evaluation_health' and jsonb_typeof(value->'comparisons')='array'
  and exists(select 1 from jsonb_array_elements(value->'comparisons') c where c->>'article_id'=article::text);
 if link ~ '^https://github\.com/[^/]+/[^/]+' then
  repo:=lower(split_part(link,'/',4)||'/'||split_part(link,'/',5));
  if not exists(select 1 from public.ss_articles a where a.id<>article and lower(split_part(a.url,'/',4)||'/'||split_part(a.url,'/',5))=repo and a.url like 'https://github.com/%')
   and not exists(select 1 from public.ss_sources s where s.active and s.type='github' and lower(split_part(s.url,'/',5)||'/'||split_part(s.url,'/',6))=repo) then
   delete from public.ss_settings where key in('repo_metadata:'||repo,'repo_health:'||repo);
  end if;
 end if;
end;$$;
revoke all on function ss_private.purge_link_caches(uuid,text) from public,anon,authenticated,service_role;

create function ss_private.purge_link_claims(article uuid) returns void language plpgsql set search_path='' as $$begin delete from ss_private.evaluation_claims where article_id=article; delete from ss_private.evaluation_attempts where article_id=article; end;$$;
revoke all on function ss_private.purge_link_claims(uuid) from public,anon,authenticated,service_role;

create function ss_private.remove_article_dependents() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform ss_private.record_link_discard(old.reference_meta,old.url);
 perform ss_private.purge_link_records(old.id,old.url,old.reference_meta);
 perform ss_private.purge_link_claims(old.id);
 perform ss_private.purge_link_caches(old.id,old.url);
 return old;
end;$$;
revoke all on function ss_private.remove_article_dependents() from public,anon,authenticated,service_role;
create trigger remove_article_dependents before delete on public.ss_articles for each row execute function ss_private.remove_article_dependents();

-- Preserve accepted history only. Terminal non-selected decisions are removed
-- in the same transaction as their insert/update, regardless of evaluator.
create function ss_private.discard_unselected_article() returns trigger
language plpgsql security definer set search_path='' as $$
declare profile jsonb;
begin
 if jsonb_typeof(new.reference_meta->'evaluation') is distinct from 'object' then return null;end if;
 if tg_op='UPDATE' and jsonb_typeof(old.reference_meta->'evaluation')='object'
  and new.reference_meta->'evaluation'->>'cache_key' is not distinct from old.reference_meta->'evaluation'->>'cache_key'
  and new.reference_meta->'evaluation'->>'decision' is not distinct from old.reference_meta->'evaluation'->>'decision'
  and new.reference_meta->>'review_commit' is not distinct from old.reference_meta->>'review_commit' then return null;end if;
 select value into profile from public.ss_settings where key='profile';
 if not ss_private.reviewed_article(new.reference_meta,coalesce((profile->>'min_score')::int,55))
  or not ss_private.repo_admitted(new.url,new.reference_meta,coalesce(profile,'{}'::jsonb)) then
  delete from public.ss_articles where id=new.id;
 end if;
 return null;
end;$$;
revoke all on function ss_private.discard_unselected_article() from public,anon,authenticated,service_role;
create trigger discard_unselected_article after insert or update on public.ss_articles
 for each row execute function ss_private.discard_unselected_article();

-- Purge existing non-selected rows and all their dependent data. Keep the
-- request-level quota ledger: it contains no link identifiers or public text.
delete from public.ss_articles a using public.ss_settings p where p.key='profile'
 and jsonb_typeof(a.reference_meta->'evaluation')='object'
 and (not ss_private.reviewed_article(a.reference_meta,coalesce((p.value->>'min_score')::int,55))
  or not ss_private.repo_admitted(a.url,a.reference_meta,p.value));
delete from ss_private.article_reviews r where not exists(select 1 from public.ss_articles a where a.id=r.article_id)
 or not ss_private.reviewed_article(jsonb_build_object('evaluation',r.assessment),55);
delete from ss_private.evaluation_claims c where not exists(select 1 from public.ss_articles a where a.id=c.article_id);
delete from ss_private.evaluation_attempts c where not exists(select 1 from public.ss_articles a where a.id=c.article_id);
delete from ss_private.review_cohort c where not exists(select 1 from public.ss_articles a where ss_private.review_identity(a.url)=ss_private.review_identity(c.url));
update public.ss_settings set value=value-'existing_urls',updated_at=now() where key='assistant_review_handoff';
update public.ss_settings set value=value,updated_at=now() where key='evaluation_health';

-- Foreign keys make future orphan history/claims impossible. The trigger also
-- removes URL-keyed records and non-FK payloads.
alter table ss_private.article_reviews add constraint article_reviews_article_fk foreign key(article_id) references public.ss_articles(id) on delete cascade deferrable initially deferred;
alter table ss_private.evaluation_claims add constraint evaluation_claims_article_fk foreign key(article_id) references public.ss_articles(id) on delete cascade;
alter table ss_private.evaluation_attempts add constraint evaluation_attempts_article_fk foreign key(article_id) references public.ss_articles(id) on delete cascade;

create or replace function public.ss_review_coverage() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('total',count(*),'evaluated',count(*) filter(where jsonb_typeof(a.reference_meta->'evaluation')='object'),
 'approved',count(*) filter(where ss_private.reviewed_article(a.reference_meta,coalesce((p.value->>'min_score')::int,55)) and ss_private.repo_admitted(a.url,a.reference_meta,p.value)),
 'rejected',0,'insufficient',0,'discarded',coalesce((select (value->>'discarded')::bigint from public.ss_settings where key='link_retention'),0),
 'repository_blocked',count(*) filter(where ss_private.reviewed_article(a.reference_meta,coalesce((p.value->>'min_score')::int,55)) and not ss_private.repo_admitted(a.url,a.reference_meta,p.value)),
 'pending',count(*) filter(where a.review_state in('awaiting_input','awaiting_evaluation')),
 'failed',count(*) filter(where a.review_state in('retry_wait','needs_attention')),
 'missing_public_input',count(*) filter(where a.review_state='awaiting_input'),
 'bootstrap_pending',count(*) filter(where not ss_private.gemini_new_link(a.url) and a.reference_meta->>'evaluation' is null),
 'assistant_reviewed',count(*) filter(where a.reference_meta->'evaluation'->>'evaluator'='assistant'),
 'states',coalesce((select jsonb_object_agg(review_state,n) from(select review_state,count(*) n from public.ss_articles where deleted_at is null group by 1)s),'{}'::jsonb),'checked_at',now())
 from public.ss_articles a cross join public.ss_settings p where p.key='profile' and a.deleted_at is null;
$$;
revoke all on function public.ss_review_coverage() from public,anon,authenticated;
grant execute on function public.ss_review_coverage() to service_role;

create or replace function public.ss_internal_review_candidates(batch_size int default 200) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]') from (select a.id,a.url,a.title,a.topic,a.kind,a.discovered_at,a.content_hash,a.reference_meta,a.review_state
 from public.ss_articles a where a.deleted_at is null and a.review_state in('awaiting_input','awaiting_evaluation','retry_wait','needs_attention')
 order by (a.discovered_at<=now()-interval '24 hours') desc,(a.reference_meta->>'alert_kind'='release') desc nulls last,a.discovered_at,a.id limit least(greatest(batch_size,1),500))x;
$$;
revoke all on function public.ss_internal_review_candidates(int) from public,anon,authenticated;
grant execute on function public.ss_internal_review_candidates(int) to service_role;

-- Failed/pre-ingestion link jobs must obey the same 24-hour deadline. Preserve
-- their original discovery clock and captured public payload; never fetch here.
create function ss_private.capture_overdue_link(payload jsonb,discovered timestamptz) returns int language plpgsql set search_path='' as $$
declare input jsonb;meta jsonb;body text;added int;
begin
  meta:=case when jsonb_typeof(payload->'reference_meta')='object' then (payload->'reference_meta')-'evaluation'-'review_commit' else '{}'::jsonb end;
  body:=left(coalesce(nullif(payload->>'text',''),payload->>'summary',''),6000);
  input:=case when jsonb_typeof(meta->'public_evaluation_input')='object' then meta->'public_evaluation_input'
   when length(body)>=80 then jsonb_build_object('title',left(coalesce(nullif(payload->>'title',''),payload->>'url'),500),'text',body,
    'scope',case when meta->>'link_status'='search_result' then 'search_snippet' when payload->>'kind'='Repository' then 'repository_metadata' else 'publisher_excerpt' end)
   else null end;
  insert into public.ss_articles(url,title,kind,topic,discovered_at,content_hash,reference_meta)
   values(payload->>'url',left(coalesce(nullif(payload->>'title',''),payload->>'url'),500),coalesce(payload->>'kind','Article'),coalesce(payload->>'topic','Models & research'),discovered,
    encode(extensions.digest(payload::text,'sha256'),'hex'),meta||jsonb_build_object('public_evaluation_input',input,'evaluation_failed_at',now(),'evaluation_error_kind','collection','evaluation_error','Public source collection did not complete within 24 hours'))
   on conflict(url) do nothing;
 get diagnostics added=row_count;return added;
end;$$;
revoke all on function ss_private.capture_overdue_link(jsonb,timestamptz) from public,anon,authenticated,service_role;

create function public.ss_promote_overdue_link_jobs(batch_size int default 200) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.ss_jobs; added int; promoted int:=0; cleared int:=0;
begin
 for j in select * from public.ss_jobs where kind in('analyze','article') and status in('pending','failed','running')
  and created_at<=now()-interval '24 hours' and (status<>'running' or locked_at is null or locked_at<now()-interval '5 minutes')
  order by created_at,id limit least(greatest(batch_size,1),500) for update skip locked loop
  if j.payload->>'url' is null or j.payload->>'url' !~ '^https://' or length(j.payload->>'url')>2048 then
   delete from public.ss_jobs where id=j.id;cleared:=cleared+1;continue;
  end if;
  if j.payload->'reference_meta'->>'source_id' is not null and not exists(
   select 1 from public.ss_sources s where s.id::text=j.payload->'reference_meta'->>'source_id' and s.active
    and s.revision::text=j.payload->'reference_meta'->>'source_revision'
    and (coalesce(j.payload->'reference_meta'->>'prerelease','false')<>'true' or s.include_prereleases)
  ) then delete from public.ss_jobs where id=j.id;cleared:=cleared+1;continue;end if;
  added:=ss_private.capture_overdue_link(j.payload,j.created_at);
  promoted:=promoted+added;
  -- The canonical article now owns the evidence; no duplicate failed payload.
  delete from public.ss_jobs where id=j.id;cleared:=cleared+1;
 end loop;
 return jsonb_build_object('promoted',promoted,'cleared',cleared);
end;$$;
revoke all on function public.ss_promote_overdue_link_jobs(int) from public,anon,authenticated;
grant execute on function public.ss_promote_overdue_link_jobs(int) to service_role;
