alter table public.ss_sources add column last_error_kind text check(last_error_kind in ('deferred','error'));
alter table public.ss_sources add column retry_at timestamptz;
update public.ss_sources set last_error_kind=case when last_error ~ 'budget reached|rate limit|deferred' then 'deferred' else 'error' end where last_error is not null;

-- Existing-link cohort and immutable review history. No destructive reimport.
create table ss_private.review_cohort (
 url text primary key,
 captured_at timestamptz not null default now()
);
create table ss_private.article_reviews (
 id bigint generated always as identity primary key,
 article_id uuid not null,
 url text not null,
 cache_key text not null,
 evaluator text not null,
 assessment jsonb not null,
 snapshot jsonb not null,
 reviewed_at timestamptz not null default now(),
 unique(article_id,cache_key,evaluator)
);
alter table ss_private.review_cohort enable row level security;
alter table ss_private.article_reviews enable row level security;
revoke all on ss_private.review_cohort,ss_private.article_reviews from public,anon,authenticated,service_role;
insert into ss_private.review_cohort(url)
 select jsonb_array_elements_text(value->'existing_urls') from public.ss_settings where key='assistant_review_handoff'
 on conflict do nothing;
-- GitHub owner/repository names are case insensitive; release tags remain case sensitive.
create function ss_private.review_identity(link text) returns text language sql immutable set search_path='' as $$
 select case when link ~ '^https://github\.com/[^/]+/[^/]+(/|$)' then
  'https://github.com/'||lower(split_part(link,'/',4))||'/'||lower(split_part(link,'/',5))||substr(link,length('https://github.com/'||split_part(link,'/',4)||'/'||split_part(link,'/',5))+1)
 else link end;
$$;
create index review_cohort_identity_idx on ss_private.review_cohort(ss_private.review_identity(url));
revoke all on function ss_private.review_identity(text) from public,anon,authenticated,service_role;
-- A frozen cohort always wins over discovery time, including delayed collection jobs.
create function ss_private.gemini_new_link(link text) returns boolean language sql stable set search_path='' as $$
 select not exists(select 1 from ss_private.review_cohort where ss_private.review_identity(url)=ss_private.review_identity(link));
$$;
revoke all on function ss_private.gemini_new_link(text) from public,anon,authenticated,service_role;

create function ss_private.preserve_article_review() returns trigger language plpgsql security definer set search_path='' as $$
declare reviewed jsonb; saved_snapshot jsonb;
begin
 if tg_op='UPDATE' and jsonb_typeof(old.reference_meta->'evaluation')='object' then
  reviewed:=old.reference_meta->'evaluation';
  saved_snapshot:=jsonb_build_object('title',old.title,'summary',old.summary,'reason',old.reason,'evidence',old.evidence,'input',old.reference_meta->'public_evaluation_input','content_hash',old.content_hash);
  insert into ss_private.article_reviews(article_id,url,cache_key,evaluator,assessment,snapshot,reviewed_at)
   values(old.id,old.url,coalesce(reviewed->>'cache_key',md5(reviewed::text)),coalesce(reviewed->>'evaluator','gemini'),reviewed,saved_snapshot,coalesce((reviewed->>'evaluated_at')::timestamptz,now())) on conflict do nothing;
  -- Collector refreshes never erase a completed decision or replace it with an unrelated assessment.
  if new.reference_meta->'evaluation' is distinct from old.reference_meta->'evaluation'
   and (new.reference_meta->>'review_commit' is null or new.reference_meta->>'review_commit' is not distinct from old.reference_meta->>'review_commit') then
   new.reference_meta:=new.reference_meta||jsonb_build_object('evaluation',reviewed,'review_snapshot',coalesce(old.reference_meta->'review_snapshot',saved_snapshot),'evaluation_failed_at',null,'evaluation_retry_at',null,'evaluation_failures',0);
  end if;
  if new.reference_meta->'public_evaluation_input' is distinct from old.reference_meta->'public_evaluation_input' then
   new.reference_meta:=new.reference_meta||jsonb_build_object('review_content_changed_at',now(),'review_snapshot',coalesce(old.reference_meta->'review_snapshot',saved_snapshot));
  end if;
 end if;
 if jsonb_typeof(new.reference_meta->'evaluation')='object' then
  reviewed:=new.reference_meta->'evaluation';
  insert into ss_private.article_reviews(article_id,url,cache_key,evaluator,assessment,snapshot,reviewed_at)
   values(new.id,new.url,coalesce(reviewed->>'cache_key',md5(reviewed::text)),coalesce(reviewed->>'evaluator','gemini'),reviewed,
   coalesce(new.reference_meta->'review_snapshot',jsonb_build_object('title',new.title,'summary',new.summary,'reason',new.reason,'evidence',new.evidence,'input',new.reference_meta->'public_evaluation_input','content_hash',new.content_hash)),coalesce((reviewed->>'evaluated_at')::timestamptz,now())) on conflict do nothing;
 end if;
 return new;
end;$$;
revoke all on function ss_private.preserve_article_review() from public,anon,authenticated,service_role;
create trigger preserve_article_review before insert or update on public.ss_articles for each row execute function ss_private.preserve_article_review();
insert into ss_private.article_reviews(article_id,url,cache_key,evaluator,assessment,snapshot,reviewed_at)
 select id,url,coalesce(reference_meta->'evaluation'->>'cache_key',md5((reference_meta->'evaluation')::text)),coalesce(reference_meta->'evaluation'->>'evaluator','gemini'),reference_meta->'evaluation',
 jsonb_build_object('title',title,'summary',summary,'reason',reason,'evidence',evidence,'input',reference_meta->'public_evaluation_input','content_hash',content_hash),coalesce((reference_meta->'evaluation'->>'evaluated_at')::timestamptz,now())
 from public.ss_articles where jsonb_typeof(reference_meta->'evaluation')='object' on conflict do nothing;

-- Service-only visibility: no public endpoints or broad private-schema grants.
create function public.ss_review_coverage() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('total',count(*),'evaluated',count(*) filter(where jsonb_typeof(a.reference_meta->'evaluation')='object'),
 'approved',count(*) filter(where ss_private.reviewed_article(a.reference_meta,coalesce((p.value->>'min_score')::int,55)) and ss_private.repo_admitted(a.url,a.reference_meta,p.value)),
 'rejected',count(*) filter(where a.reference_meta->'evaluation'->>'decision'='tangential'),
 'insufficient',count(*) filter(where a.reference_meta->'evaluation'->>'decision'='insufficient_evidence'),
 'repository_blocked',count(*) filter(where ss_private.reviewed_article(a.reference_meta,coalesce((p.value->>'min_score')::int,55)) and not ss_private.repo_admitted(a.url,a.reference_meta,p.value)),
 'pending',count(*) filter(where ss_private.gemini_new_link(a.url) and a.reference_meta->>'evaluation' is null and a.reference_meta->>'public_evaluation_input' is not null and a.reference_meta->>'evaluation_failed_at' is null),
 'failed',count(*) filter(where ss_private.gemini_new_link(a.url) and a.reference_meta->>'evaluation_failed_at' is not null),
 'missing_public_input',count(*) filter(where ss_private.gemini_new_link(a.url) and a.reference_meta->>'public_evaluation_input' is null),
 'bootstrap_pending',count(*) filter(where not ss_private.gemini_new_link(a.url) and a.reference_meta->>'assistant_reviewed_at' is null),
 'assistant_reviewed',count(*) filter(where a.reference_meta->>'assistant_reviewed_at' is not null),'checked_at',now())
 from public.ss_articles a cross join public.ss_settings p where p.key='profile' and a.deleted_at is null;
$$;
revoke all on function public.ss_review_coverage() from public,anon,authenticated;
grant execute on function public.ss_review_coverage() to service_role;

create or replace function public.ss_reserve_evaluation_batch(items jsonb,daily_max int,monthly_max int)
returns jsonb language plpgsql security definer set search_path='' as $$
declare selected jsonb; request_id bigint; item jsonb; pacific_start timestamptz;
begin
 perform pg_advisory_xact_lock(882225);
 if jsonb_typeof(items) is distinct from 'array' or daily_max is null or monthly_max is null
 or daily_max not between 1 and 16 or monthly_max not between 1 and 496 then return '{}';end if;
 if jsonb_array_length(items) not between 1 and 50 then return '{}';end if;
 pacific_start:=date_trunc('day',now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
 if exists(select 1 from ss_private.evaluation_requests where attempted_at>now()-interval '5 minutes') then return '{}';end if;
 if (select count(*) from ss_private.evaluation_requests where attempted_at>now()-interval '24 hours')>=daily_max
 or (select count(*) from ss_private.evaluation_requests where attempted_at>=pacific_start)>=daily_max
 or (select count(*) from ss_private.evaluation_requests where attempted_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')>=monthly_max then return '{}';end if;
 select jsonb_agg(x order by pos) into selected from (
 select x.value as x,min(x.ordinality) as pos from jsonb_array_elements(items) with ordinality x(value,ordinality)
 join public.ss_articles a on a.id=(x.value->>'id')::uuid
 left join ss_private.evaluation_claims c on c.article_id=a.id and c.cache_key=x.value->>'cache_key'
 where ss_private.gemini_new_link(a.url) and ss_private.repo_admitted(a.url,a.reference_meta,(select value from public.ss_settings where key='profile'))
 and a.deleted_at is null and a.content_hash=x.value->>'content_hash'
 and jsonb_typeof(a.reference_meta->'public_evaluation_input')='object'
 and a.reference_meta->>'evaluation' is null
 and (x.value->>'cache_key') ~ '^[a-f0-9]{64}$'
 and (c.article_id is null or (c.attempts<3 and c.attempted_at<now()-interval '6 hours'))
 group by x.value order by min(x.ordinality) limit 5
 ) eligible;
 if selected is null then return '{}';end if;
 -- Reject ambiguous duplicate article ids even if callers provide different cache keys.
 if (select count(distinct x->>'id') from jsonb_array_elements(selected) x)<>jsonb_array_length(selected) then return '{}';end if;
 insert into ss_private.evaluation_requests default values returning id into request_id;
 for item in select * from jsonb_array_elements(selected) loop
  insert into ss_private.evaluation_claims(article_id,cache_key,request_id) values((item->>'id')::uuid,item->>'cache_key',request_id)
  on conflict(article_id,cache_key) do update set request_id=excluded.request_id,attempts=evaluation_claims.attempts+1,attempted_at=now();
 end loop;
 return jsonb_build_object('request_id',request_id,'items',selected);
end;$$;
revoke all on function public.ss_reserve_evaluation_batch(jsonb,int,int) from public,anon,authenticated;
grant execute on function public.ss_reserve_evaluation_batch(jsonb,int,int) to service_role;


create or replace function public.ss_evaluation_candidates() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
  select a.id,a.url,a.score,a.content_hash,a.discovered_at,a.reference_meta,a.kind
  from public.ss_articles a where a.deleted_at is null
  and ss_private.gemini_new_link(a.url)
  and jsonb_typeof(a.reference_meta->'public_evaluation_input')='object'
  and a.reference_meta->>'evaluation' is null
  and (a.reference_meta->>'evaluation_failed_at' is null or (a.reference_meta->>'evaluation_retry_at')::timestamptz<=now())
  and ss_private.repo_admitted(a.url,a.reference_meta,(select value from public.ss_settings where key='profile'))
  order by a.discovered_at,a.id limit 50
 )x;
$$;
revoke all on function public.ss_evaluation_candidates() from public,anon,authenticated;
grant execute on function public.ss_evaluation_candidates() to service_role;
create or replace function public.ss_maintenance() returns void language plpgsql security definer set search_path='' as $$begin
 delete from public.ss_sessions where expires_at<now()-interval '1 day';
 delete from public.ss_limits where expires_at<now()-interval '1 day';
 delete from public.ss_recovery where expires_at<now()-interval '1 day';
 delete from public.ss_invites where expires_at<now()-interval '30 days';
 delete from public.ss_jobs where status in('done','failed') and created_at<now()-interval '7 days';
 delete from public.ss_audit where created_at<now()-interval '90 days';
 -- Delete replies with the same expired parent, including nested replies.
 with recursive doomed as(select id from public.ss_notes where deleted_at<now()-interval '30 days' union select n.id from public.ss_notes n join doomed d on n.parent_id=d.id) delete from public.ss_notes where id in(select id from doomed);
 with recursive doomed as(select id from public.ss_folders where deleted_at<now()-interval '30 days' union select f.id from public.ss_folders f join doomed d on f.parent_id=d.id) delete from public.ss_folders where id in(select id from doomed);
 delete from public.ss_articles a where discovered_at<now()-interval '90 days' and not exists(select 1 from public.ss_bookmarks b where b.article_id=a.id) and not exists(select 1 from public.ss_notes n where n.article_id=a.id) and not exists(select 1 from ss_private.article_reviews r where r.article_id=a.id) and ss_private.gemini_new_link(a.url);
end;$$;
revoke all on function public.ss_maintenance() from public,anon,authenticated;
grant execute on function public.ss_maintenance() to service_role;

-- Reviewed content is a stable snapshot; clients still see later source changes explicitly.
create or replace function ss_private.reviewed_article(meta jsonb,minimum int default 55) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(meta->'evaluation')='object' and meta->'evaluation'->>'decision'='useful'
 and meta->'evaluation'->>'confidence' in('medium','high') and meta->'evaluation'->>'depth' in('practical','advanced')
 and length(meta->'evaluation'->>'evidence')>=10
 and case when jsonb_typeof(meta->'evaluation'->'score')='number' then (meta->'evaluation'->>'score')::numeric>=minimum else false end,false)
$$;
revoke all on function ss_private.reviewed_article(jsonb,int) from public,anon,authenticated,service_role;

create function public.ss_apply_assistant_reviews(items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; a public.ss_articles; assessment jsonb; input jsonb; h jsonb; result jsonb:='[]'; stamp text;
begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 50 then raise exception 'Invalid review batch';end if;
 for item in select value from jsonb_array_elements(items) loop
  select * into a from public.ss_articles where id=(item->>'id')::uuid and deleted_at is null for update;
  if not found or not exists(select 1 from ss_private.review_cohort where url=a.url) then raise exception 'Article not in frozen review cohort';end if;
  assessment:=item->'assessment'; input:=item->'input'; h:=item->'repo_health';
  if jsonb_typeof(assessment) is distinct from 'object' or (select count(*) from jsonb_object_keys(assessment))<>9 or not assessment ?& array['topic','score','confidence','depth','decision','summary','reason','action','evidence'] then raise exception 'Invalid assessment';end if;
  if exists(select 1 from jsonb_each(assessment) e where e.key<>'score' and jsonb_typeof(e.value) is distinct from 'string')
   or assessment->>'decision' not in('useful','tangential','insufficient_evidence') or assessment->>'confidence' not in('low','medium','high')
   or assessment->>'depth' not in('introductory','practical','advanced','unknown') or jsonb_typeof(assessment->'score') is distinct from 'number'
   or (assessment->>'score')::numeric<>trunc((assessment->>'score')::numeric) or (assessment->>'score')::numeric not between 0 and 100
   or length(assessment->>'reason') not between 1 and 240 or length(assessment->>'summary')>300 or length(assessment->>'action')>200 or length(assessment->>'evidence')>160
   or assessment->>'topic' not in ('Hardware','Networking','Platforms','Inference','Models & research','Operations') then raise exception 'Invalid assessment';end if;
  if assessment->>'decision'<>'insufficient_evidence' and (jsonb_typeof(input) is distinct from 'object' or jsonb_typeof(input->'text') is distinct from 'string' or jsonb_typeof(input->'title') is distinct from 'string' or input->>'scope' not in('search_snippet','publisher_excerpt','repository_metadata') or length(assessment->>'evidence') not between 10 and 160 or coalesce(strpos(input->>'text',assessment->>'evidence'),0)<1) then raise exception 'Evidence is not grounded in the reviewed public input';end if;
  if assessment->>'decision'='insufficient_evidence' and (coalesce(assessment->>'evidence','')<>'' or assessment->>'confidence'<>'low' or assessment->>'depth'<>'unknown') then raise exception 'Invalid uncertainty';end if;
  if assessment->>'decision'='useful' and (not ss_private.reviewed_article(jsonb_build_object('evaluation',assessment),coalesce((select (value->>'min_score')::int from public.ss_settings where key='profile'),55)) or not ss_private.repo_admitted(a.url,jsonb_build_object('repo_health',h),(select value from public.ss_settings where key='profile'))) then raise exception 'Accepted review does not pass the policy';end if;
  stamp:=encode(extensions.gen_random_bytes(16),'hex');
  assessment:=assessment||jsonb_build_object('evaluator','assistant','version','assistant-review-v1','evaluated_at',now(),'cache_key',encode(extensions.digest(coalesce(input::text,'')||assessment::text,'sha256'),'hex'),'rules_score',a.score,'scope',coalesce(input->>'scope','unavailable'));
  update public.ss_articles set reference_meta=reference_meta||jsonb_build_object('evaluation',assessment,'review_commit',stamp,'assistant_reviewed_at',now(),'evaluation_failed_at',null,'evaluation_retry_at',null,'evaluation_failures',0,'review_content_changed_at',null,
   'repo_health',coalesce(h,reference_meta->'repo_health'),'review_snapshot',jsonb_build_object('title',coalesce(input->>'title',a.title),'summary',assessment->>'summary','reason',assessment->>'reason','evidence',assessment->>'evidence','input',input,'content_hash',a.content_hash))
   where id=a.id;
  result:=result||jsonb_build_array(jsonb_build_object('id',a.id,'decision',assessment->>'decision'));
 end loop;
 return result;
end;$$;
revoke all on function public.ss_apply_assistant_reviews(jsonb) from public,anon,authenticated;
grant execute on function public.ss_apply_assistant_reviews(jsonb) to service_role;

create or replace function public.ss_api(action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); r text; current_member public.ss_members; result jsonb; target uuid; parent uuid; token text; batch uuid; old public.ss_folders; nt public.ss_notes; lim integer; ofs integer; previous public.ss_sources; source_url text; profile jsonb;
begin
 if not ss_private.member_ok(false) then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into current_member from public.ss_members where id=uid; r:=current_member.role;
 if action='me' then return to_jsonb(current_member); end if;
 if not ss_private.member_ok() then raise exception 'Complete password change and MFA first' using errcode='42501'; end if;
 select value into profile from public.ss_settings where key='profile';
 if action in('feed','library','hidden') then
  lim:=least(greatest(coalesce((p->>'limit')::int,30),1),100);ofs:=greatest(coalesce((p->>'offset')::int,0),0);
  with recursive paths as (
   select f.id,f.parent_id,f.name::text as path,array[f.id] as ancestors from public.ss_folders f where f.parent_id is null and f.deleted_at is null
   union all select f.id,f.parent_id,paths.path||' / '||f.name,paths.ancestors||f.id from public.ss_folders f join paths on paths.id=f.parent_id where f.deleted_at is null and not f.id=any(paths.ancestors)
  ), matched as (
   select a.id,a.url,coalesce(a.reference_meta->'review_snapshot'->>'title',a.title) as title,a.source,a.author,a.published_at,a.updated_at,a.discovered_at,a.kind,a.topic,a.tags,coalesce(a.reference_meta->'review_snapshot'->>'summary',a.summary) as summary,coalesce(a.reference_meta->'review_snapshot'->>'reason',a.reason) as reason,coalesce(a.reference_meta->'review_snapshot'->>'evidence',a.evidence) as evidence,a.score,a.analysis_status,a.content_hash,a.deleted_at,a.reference_meta,coalesce(fb.liked,false) as liked,coalesce(fb.hidden,false) as hidden,coalesce(fb.read,false) as read,
   exists(select 1 from public.ss_bookmarks b join paths fp on fp.id=b.folder_id where b.article_id=a.id) as saved,
   (select count(*) from public.ss_feedback x where x.article_id=a.id and x.liked) as likes,
   (select count(*) from public.ss_notes n where n.article_id=a.id and n.deleted_at is null and n.visibility='team') as comments,
   coalesce((select jsonb_agg(fp.id) from public.ss_bookmarks b join paths fp on fp.id=b.folder_id where b.article_id=a.id),'[]') as folder_ids,
   coalesce((select jsonb_agg(fp.path) from public.ss_bookmarks b join paths fp on fp.id=b.folder_id where b.article_id=a.id),'[]') as folder_paths,
   a.score+greatest(-12,least(12,coalesce((select sum(case when x.liked then 2 when x.hidden then -2 else 0 end) from public.ss_feedback x join public.ss_articles y on x.article_id=y.id where x.user_id=uid and (y.topic=a.topic or y.tags && a.tags)),0))) as rank_score
   from public.ss_articles a left join public.ss_feedback fb on fb.article_id=a.id and fb.user_id=uid
   where a.deleted_at is null
   and (action<>'feed' or (ss_private.reviewed_article(a.reference_meta,coalesce((profile->>'min_score')::int,55)) and ss_private.repo_admitted(a.url,a.reference_meta,profile)))
   and (action='hidden' and fb.hidden or action<>'hidden' and not coalesce(fb.hidden,false))
   and (coalesce(p->>'topic','All topics')='All topics' or a.topic=p->>'topic')
   and (coalesce(p->>'q','')='' or a.title ilike '%'||replace(replace(replace(p->>'q','\','\\'),'%','\%'),'_','\_')||'%' or to_tsvector('simple',a.title) @@ websearch_to_tsquery('simple',p->>'q'))
   and (coalesce(p->>'unread','false')<>'true' or not coalesce(fb.read,false))
   and (coalesce(p->>'kind','All types')='All types' or a.kind=p->>'kind')
   and (coalesce(p->>'needs_review','false')<>'true' or a.reference_meta->>'link_status' in('submitted','unresolved','title-match'))
   and (action<>'library' or exists(select 1 from public.ss_bookmarks b join paths fp on fp.id=b.folder_id where b.article_id=a.id and (coalesce(p->>'folder','')='' or (p->>'folder')::uuid=any(fp.ancestors))))
   and (action<>'feed' or coalesce(p->>'mode','week')='archive' or a.reference_meta->>'alert_kind'='release' or ss_private.reviewed_article(a.reference_meta,coalesce((profile->>'min_score')::int,55)))
   and (action<>'feed' or coalesce(p->>'mode','week')='archive' or (a.reference_meta->>'prerelease' is distinct from 'true' or exists(select 1 from public.ss_sources s where s.id::text=a.reference_meta->>'source_id' and s.include_prereleases)))
   and (action<>'feed' or coalesce(p->>'mode','week')='archive' or (p->>'mode'='releases' and a.reference_meta->>'alert_kind'='release' and a.published_at between now()-interval '7 days' and now()) or (p->>'mode'='radar' and (a.reference_meta->'evaluation'->>'evaluated_at')::timestamptz between now()-interval '7 days' and now() and a.kind<>'Release') or (p->>'mode'='updates' and a.updated_at>now()-interval '7 days' and a.updated_at<=now()) or (coalesce(p->>'mode','week')='week' and a.published_at>now()-interval '7 days' and a.published_at<=now()))
  ), paged as (select * from matched order by case when p->>'sort'='newest' then case when p->>'mode'='radar' then (reference_meta->'evaluation'->>'evaluated_at')::timestamptz when p->>'mode'='updates' then updated_at else coalesce(published_at,discovered_at) end end desc,rank_score desc,discovered_at desc,id limit lim offset ofs)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'),'total',(select count(*) from matched)) into result;return result;
 elsif action='folders' then
  select coalesce(jsonb_agg(x),'[]') into result from (select f.*,(select count(*) from public.ss_bookmarks b where b.folder_id=f.id) as count from public.ss_folders f where f.deleted_at is null order by name) x;return result;
 elsif action='notes' then
  select coalesce(jsonb_agg(x),'[]') into result from (select n.*,m.username from public.ss_notes n join public.ss_members m on m.id=n.user_id where n.article_id=(p->>'article_id')::uuid and n.deleted_at is null and (n.visibility='team' or n.user_id=uid) order by n.created_at) x;return result;
 elsif action='sources' then
  select coalesce(jsonb_agg(x),'[]') into result from (select id,name,url,type,topic,active,interval_minutes,last_success_at,last_error,next_check_at,include_prereleases,priority,last_item_count,revision,last_error_kind,retry_at from public.ss_sources order by name) x;return result;
 elsif action='read' then
  insert into public.ss_feedback(user_id,article_id,read) values(uid,(p->>'article_id')::uuid,true) on conflict(user_id,article_id) do update set read=true,updated_at=now();return '{}';
 elsif action='stats' then
  return jsonb_build_object('review_pending',(select count(*) from public.ss_articles where deleted_at is null and ss_private.gemini_new_link(url) and reference_meta->>'public_evaluation_input' is not null and reference_meta->>'evaluation' is null),'review_only',true,'week',(select count(*) from public.ss_articles where published_at between now()-interval '7 days' and now() and deleted_at is null and ss_private.reviewed_article(reference_meta,coalesce((profile->>'min_score')::int,55)) and ss_private.repo_admitted(url,reference_meta,profile)),'saved',(select count(distinct article_id) from public.ss_bookmarks b join public.ss_folders f on f.id=b.folder_id where f.deleted_at is null),'sources',(select count(*) from public.ss_sources where active),'last_scan',(select max(last_success_at) from public.ss_sources),'release_unread',(select count(*) from public.ss_articles a left join public.ss_feedback f on f.article_id=a.id and f.user_id=uid where a.deleted_at is null and ss_private.reviewed_article(a.reference_meta,coalesce((profile->>'min_score')::int,55)) and ss_private.repo_admitted(a.url,a.reference_meta,profile) and a.reference_meta->>'alert_kind'='release' and a.published_at between now()-interval '7 days' and now() and not coalesce(f.read,false) and not coalesce(f.hidden,false) and (a.reference_meta->>'prerelease' is distinct from 'true' or exists(select 1 from public.ss_sources s where s.id::text=a.reference_meta->>'source_id' and s.include_prereleases))));
 end if;
 if r='reader' then raise exception 'Read-only account' using errcode='42501'; end if;
 if action='feedback' then
  if p ? 'hidden' and not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
  insert into public.ss_feedback(user_id,article_id,liked,hidden,reason) values(uid,(p->>'article_id')::uuid,coalesce((p->>'liked')::boolean,false),coalesce((p->>'hidden')::boolean,false),left(coalesce(p->>'reason',''),500)) on conflict(user_id,article_id) do update set liked=case when p ? 'liked' then (p->>'liked')::boolean else ss_feedback.liked end,hidden=case when p ? 'hidden' then (p->>'hidden')::boolean else ss_feedback.hidden end,reason=case when p ? 'reason' then left(p->>'reason',500) else ss_feedback.reason end,updated_at=now();
 elsif action='folder_save' then
  perform pg_advisory_xact_lock(882219);
  parent:=nullif(p->>'parent_id','')::uuid;
  if parent is not null and not exists(select 1 from public.ss_folders where id=parent and deleted_at is null) then raise exception 'Parent unavailable';end if;
  if p ? 'id' then
   target:=(p->>'id')::uuid;
   if not exists(select 1 from public.ss_folders where id=target and deleted_at is null) then raise exception 'Folder unavailable';end if;
   if exists(with recursive children as(select id from public.ss_folders where id=target union all select f.id from public.ss_folders f join children c on f.parent_id=c.id) select 1 from children where id=parent) then raise exception 'A folder cannot contain itself';end if;
   update public.ss_folders set name=trim(p->>'name'),parent_id=parent where id=target;
  else insert into public.ss_folders(name,parent_id,created_by) values(trim(p->>'name'),parent,uid) returning id into target;end if;
 elsif action='folder_delete' then
  if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
  perform pg_advisory_xact_lock(882219);batch:=gen_random_uuid();
  with recursive children as(select id from public.ss_folders where id=(p->>'id')::uuid union all select f.id from public.ss_folders f join children c on f.parent_id=c.id) update public.ss_folders set deleted_at=now(),delete_batch=batch where id in(select id from children) and deleted_at is null;
 elsif action='save' then
  target:=nullif(p->>'folder_id','')::uuid;
  if target is null then
   perform pg_advisory_xact_lock(882219);
   select id into target from public.ss_folders where name='Inbox' and parent_id is null and deleted_at is null order by created_at limit 1;
   if target is null then insert into public.ss_folders(name,created_by) values('Inbox',uid) returning id into target;end if;
  end if;
  if not exists(select 1 from public.ss_folders where id=target and deleted_at is null) then raise exception 'Folder unavailable';end if;
  insert into public.ss_bookmarks(article_id,folder_id,created_by) values((p->>'article_id')::uuid,target,uid) on conflict do nothing;
 elsif action='unsave' then
  if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
  delete from public.ss_bookmarks where article_id=(p->>'article_id')::uuid and folder_id=(p->>'folder_id')::uuid;
 elsif action='note_save' then
  if p ? 'id' then
   select * into nt from public.ss_notes where id=(p->>'id')::uuid and deleted_at is null;
   if nt.user_id is distinct from uid then raise exception 'Only the author may edit this note' using errcode='42501';end if;
   if p->>'visibility' is distinct from nt.visibility then raise exception 'Create a new note to change its visibility';end if;
   update public.ss_notes set body=trim(p->>'body'),updated_at=now() where id=nt.id;
  else
   parent:=nullif(p->>'parent_id','')::uuid;
   if parent is not null and not exists(select 1 from public.ss_notes where id=parent and article_id=(p->>'article_id')::uuid and visibility='team' and deleted_at is null) then raise exception 'Reply target unavailable';end if;
   if parent is not null and p->>'visibility'<>'team' then raise exception 'Replies must be shared';end if;
   insert into public.ss_notes(article_id,user_id,body,visibility,parent_id) values((p->>'article_id')::uuid,uid,trim(p->>'body'),p->>'visibility',parent);
  end if;
 elsif action='note_delete' then
  if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
  select * into nt from public.ss_notes where id=(p->>'id')::uuid;
  if nt.user_id is distinct from uid and not(r='admin' and nt.visibility='team') then raise exception 'Not allowed' using errcode='42501';end if;
  update public.ss_notes set deleted_at=now() where id=nt.id;
 elsif action='submit' then
  insert into public.ss_articles(url,title,source,summary,reason) values(p->>'url',coalesce(nullif(p->>'title',''),p->>'url'),'Team submission','','Submitted by a team member; analysis pending.') on conflict(url) do update set url=excluded.url returning id into target;
  insert into public.ss_jobs(kind,payload) values('article',jsonb_build_object('id',target,'url',p->>'url'));
  if coalesce((p->>'teach')::boolean,true) then insert into public.ss_feedback(user_id,article_id,liked,reason) values(uid,target,true,left(coalesce(p->>'reason',''),500)) on conflict(user_id,article_id) do update set liked=true,reason=excluded.reason;end if;
  perform public.ss_api('save',jsonb_build_object('article_id',target,'folder_id',p->>'folder_id'));
 elsif action='trash' then
  return jsonb_build_object('folders',coalesce((select jsonb_agg(f) from public.ss_folders f where f.deleted_at is not null),'[]'),'notes',coalesce((select jsonb_agg(n) from public.ss_notes n where n.deleted_at is not null and (n.user_id=uid or (r='admin' and n.visibility='team'))),'[]'));
 elsif action='restore' then
  if p->>'type'='folder' then
   perform pg_advisory_xact_lock(882219); select * into old from public.ss_folders where id=(p->>'id')::uuid;
   update public.ss_folders set parent_id=null where id=old.id and exists(select 1 from public.ss_folders p2 where p2.id=old.parent_id and p2.deleted_at is not null and p2.delete_batch is distinct from old.delete_batch);
   update public.ss_folders set deleted_at=null,delete_batch=null where delete_batch=old.delete_batch;
  else update public.ss_notes set deleted_at=null where id=(p->>'id')::uuid and (user_id=uid or(r='admin' and visibility='team'));end if;
 else
  if r<>'admin' then raise exception 'Administrator required' using errcode='42501';end if;
  if action='admin' then
   return jsonb_build_object('members',(select jsonb_agg(m2 order by m2.created_at) from public.ss_members m2),'invites',coalesce((select jsonb_agg(x) from(select id,label,role,expires_at,used_at,revoked from public.ss_invites order by created_at desc limit 100)x),'[]'),'audit',coalesce((select jsonb_agg(x) from(select a.*,m2.username from public.ss_audit a left join public.ss_members m2 on m2.id=a.user_id order by a.id desc limit 100)x),'[]'),'profile',(select value from public.ss_settings where key='profile'),'jobs',(select jsonb_object_agg(status,n) from(select status,count(*) n from public.ss_jobs group by status)x),'usage',coalesce((select jsonb_agg(x) from(select key,n,expires_at from public.ss_limits where key like 'budget:%' and expires_at>now())x),'[]'),'discovery_health',coalesce((select value from public.ss_settings where key='discovery_health'),'{}'),'database_bytes',pg_database_size(current_database()));
  elsif action='invite' then
   if p->>'role' not in('maintainer','reader') then raise exception 'Invalid role';end if;
   token:=encode(extensions.gen_random_bytes(32),'hex');
   insert into public.ss_invites(token_hash,label,role,created_by) values(encode(extensions.digest(token,'sha256'),'hex'),left(coalesce(p->>'label',''),100),p->>'role',uid) returning id into target;
   perform ss_private.log(action,target::text);return jsonb_build_object('token',token,'expires_at',now()+interval '24 hours');
  elsif action='invite_revoke' then
   if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
   update public.ss_invites set revoked=true where id=(p->>'id')::uuid;
  elsif action='member_update' then
   if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
   target:=(p->>'id')::uuid;
   if target=uid or exists(select 1 from public.ss_members where id=target and role='admin') then raise exception 'Owner account is protected';end if;
   if p->>'role' not in('maintainer','reader') then raise exception 'Invalid role';end if;
   update public.ss_members set role=p->>'role',active=(p->>'active')::boolean where id=target;
   update public.ss_sessions set revoked=true where user_id=target;
  elsif action='source_save' then
   perform pg_advisory_xact_lock(882221);
   source_url:=p->>'url';
   if p->>'type'='openshift' and source_url !~ '^https://amd64\.ocp\.releases\.ci\.openshift\.org/api/v1/releasestream/[45]-(stable|dev-preview)/tags$' then raise exception 'Invalid official OpenShift release stream';end if;
   if p->>'type'='github' then
    if source_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(/releases)?/?$' then
     source_url:='https://api.github.com/repos/'||regexp_replace(regexp_replace(substr(source_url,20),'/releases/?$|/$','','g'),'\.git$','')||'/releases';
    end if;
    if source_url !~ '^https://api\.github\.com/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/(releases(/tags/[^/?#]+)?|(issues|pulls)/[0-9]+)$' then raise exception 'Use a public GitHub repository or supported API URL';end if;
   end if;
   if p->>'type'='github' and exists(select 1 from public.ss_sources where type='github' and lower(split_part(url,'?',1))=lower(source_url) and id is distinct from nullif(p->>'id','')::uuid) then raise exception 'Project is already followed; edit its existing watch';end if;
   if p ? 'id' then
    target:=(p->>'id')::uuid;
    select * into previous from public.ss_sources where id=target for update;
    if not found then raise exception 'Source unavailable';end if;
    update public.ss_sources set name=trim(p->>'name'),url=source_url,type=p->>'type',topic=p->>'topic',
     active=coalesce((p->>'active')::boolean,previous.active),interval_minutes=(p->>'interval_minutes')::int,
     include_prereleases=coalesce((p->>'include_prereleases')::boolean,previous.include_prereleases),
     priority=coalesce(p->>'priority',previous.priority),revision=previous.revision+1,next_check_at=now(),etag=null,
     baseline=case when url is distinct from source_url or type is distinct from p->>'type' then null else baseline end,
     content_hash=case when url is distinct from source_url or type is distinct from p->>'type' then null else content_hash end,
     last_success_at=case when url is distinct from source_url or type is distinct from p->>'type' then null else last_success_at end,
     last_error=null where id=target;
   else
    if (select count(*) from public.ss_sources)>=500 then raise exception 'Source limit reached';end if;
    insert into public.ss_sources(name,url,type,topic,interval_minutes,include_prereleases,priority)
     values(trim(p->>'name'),source_url,p->>'type',p->>'topic',(p->>'interval_minutes')::int,coalesce((p->>'include_prereleases')::boolean,false),coalesce(p->>'priority','normal')) returning id into target;
   end if;
  elsif action='source_toggle' then
   if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
   update public.ss_sources set active=(p->>'active')::boolean,next_check_at=now(),revision=revision+1 where id=(p->>'id')::uuid;
  elsif action='source_delete' then
   if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
   delete from public.ss_jobs where status='pending' and payload->>'source_id'=p->>'id';
   delete from public.ss_sources where id=(p->>'id')::uuid;
  elsif action='source_scan' then
   update public.ss_sources set next_check_at=now() where id=(p->>'id')::uuid and active;
  elsif action='profile_save' then
   profile:=profile||p;
   if jsonb_typeof(profile->'queries')<>'array' or jsonb_typeof(profile->'repo_queries')<>'array' or jsonb_typeof(profile->'priorities')<>'object' then raise exception 'Invalid profile format';end if;
   if length(coalesce(profile->>'interests',''))>5000 or jsonb_array_length(profile->'queries')>20 or jsonb_array_length(profile->'repo_queries')>12
    or coalesce((profile->>'gemini_daily_limit')::int,0) not between 0 and 16 or coalesce((profile->>'search_monthly_limit')::int,0) not between 0 and 800
    or coalesce((profile->>'min_score')::int,55) not between 45 and 85 then raise exception 'Invalid limits or profile';end if;
   if exists(select 1 from jsonb_array_elements(profile->'queries') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 300)
    or exists(select 1 from jsonb_array_elements(profile->'repo_queries') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 160)
    or exists(select 1 from jsonb_each(profile->'priorities') x where jsonb_typeof(x.value)<>'number' or (x.value::text)::numeric not between -20 and 20)
    or jsonb_typeof(profile->'repo_discovery')<>'boolean' then raise exception 'Invalid coverage values';end if;
   if coalesce(profile->>'gemini_mode','off') not in ('off','shadow','rerank') or coalesce((profile->>'gemini_monthly_limit')::int,0) not between 0 and 496 then raise exception 'Invalid evaluation limits';end if;
   if jsonb_typeof(profile->'trending_discovery')<>'boolean'
    or exists(select 1 from jsonb_each(profile) x where x.key in('repo_min_stars','repo_min_watchers','repo_min_releases','repo_active_days','repo_release_days') and (jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$'))
    or (profile->>'repo_min_stars')::int not between 1 and 100000 or (profile->>'repo_min_watchers')::int not between 1 and 10000
    or (profile->>'repo_min_releases')::int not between 1 and 20 or (profile->>'repo_active_days')::int not between 7 and 365 or (profile->>'repo_release_days')::int not between 30 and 730 then raise exception 'Invalid repository quality policy';end if;
   update public.ss_settings set value=profile,updated_at=now() where key='profile';
  elsif action='recovery' then
   if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
   target:=(p->>'id')::uuid;
   if not exists(select 1 from public.ss_members where id=target and role<>'admin' and active) then raise exception 'Member unavailable';end if;
   update public.ss_recovery set used_at=now() where user_id=target and used_at is null;
   token:=encode(extensions.gen_random_bytes(32),'hex');
   insert into public.ss_recovery(user_id,token_hash) values(target,encode(extensions.digest(token,'sha256'),'hex'));
   perform ss_private.log(action,target::text);return jsonb_build_object('token',token,'expires_at',now()+interval '1 hour');
  elsif action='rescan' then update public.ss_sources set next_check_at=now() where active;
  elsif action='export' then
   return jsonb_build_object('schema_version',1,'exported_at',now(),'articles',(select coalesce(jsonb_agg(a),'[]') from public.ss_articles a),'folders',(select coalesce(jsonb_agg(f),'[]') from public.ss_folders f),'bookmarks',(select coalesce(jsonb_agg(b),'[]') from public.ss_bookmarks b),'notes',(select coalesce(jsonb_agg(n),'[]') from public.ss_notes n where n.visibility='team' or n.user_id=uid),'sources',(select coalesce(jsonb_agg(s),'[]') from public.ss_sources s),'profile',(select value from public.ss_settings where key='profile'));
  else raise exception 'Unknown action';end if;
 end if;
 perform ss_private.log(action,coalesce(p->>'id',p->>'article_id',target::text));return jsonb_build_object('ok',true,'id',target);
end;$$;
revoke all on function public.ss_api(text,jsonb) from public,anon;
grant execute on function public.ss_api(text,jsonb) to authenticated;



-- Additive imports honor release-channel preferences for new sources only.
create or replace function public.ss_import_team(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
<<seed>>
declare owner_id uuid; item jsonb; folder_id uuid; article_id uuid; parent_id uuid; folder_map jsonb:='{}'; imported jsonb; prior public.ss_imports; fingerprint text; n int; article_count int:=0; folder_count int:=0; bookmark_count int:=0; source_count int:=0; import_key text:=payload->>'key';
begin
 if import_key is null or length(import_key)>120 or jsonb_array_length(payload->'articles')>1000 then raise exception 'Invalid import'; end if;
 perform pg_advisory_xact_lock(882221);
 fingerprint:=encode(extensions.digest(payload::text,'sha256'),'hex');
 select * into prior from public.ss_imports where key=import_key;
 if found then
  if prior.payload_hash<>fingerprint then raise exception 'Import content changed; use a new batch key'; end if;
  return prior.result || '{"already_applied":true}'::jsonb;
 end if;
 select id into owner_id from public.ss_members where role='admin' and active;
 if owner_id is null then raise exception 'Create the administrator before importing the library'; end if;
 for item in select value from jsonb_array_elements(payload->'folders') loop
  parent_id:=null;
  if item->>'parent_key' is not null then
   parent_id:=(folder_map->>(item->>'parent_key'))::uuid;
   if parent_id is null then continue; end if;
  end if;
  folder_id:=null;
  select id into folder_id from public.ss_folders where ss_folders.import_key='team-folder:'||(item->>'key');
  if folder_id is null then
   select id into folder_id from public.ss_folders where name=item->>'name' and ss_folders.parent_id is not distinct from seed.parent_id and deleted_at is null and ss_folders.import_key is null order by created_at limit 1;
   if folder_id is null then
    insert into public.ss_folders(name,parent_id,created_by,import_key) values(item->>'name',parent_id,owner_id,'team-folder:'||(item->>'key')) returning id into folder_id;
    folder_count:=folder_count+1;
   else update public.ss_folders set import_key='team-folder:'||(item->>'key') where id=folder_id; end if;
  end if;
  if exists(select 1 from public.ss_folders where id=folder_id and deleted_at is null) then folder_map:=folder_map||jsonb_build_object(item->>'key',folder_id); end if;
 end loop;
 for item in select value from jsonb_array_elements(payload->'articles') loop
  insert into public.ss_articles(url,title,source,kind,topic,tags,summary,reason,score,analysis_status,reference_meta)
  values(item->>'url',item->>'title',item->>'source',item->>'kind',item->>'topic',array(select jsonb_array_elements_text(item->'tags')),item->>'summary',item->>'reason',(item->>'score')::int,'reference',item->'reference_meta')
  on conflict(url) do nothing;
  get diagnostics n=row_count;article_count:=article_count+n;
  select id into article_id from public.ss_articles where url=item->>'url' and deleted_at is null;
  if article_id is null then continue; end if;
  folder_id:=(folder_map->>(item->>'folder_key'))::uuid;
  if folder_id is not null then
   insert into public.ss_bookmarks(article_id,folder_id,created_by) values(article_id,folder_id,owner_id) on conflict do nothing;
   get diagnostics n=row_count;bookmark_count:=bookmark_count+n;
  end if;
  if (item->>'queue_metadata')::boolean and not exists(select 1 from public.ss_jobs where kind='article' and status in('pending','running') and ss_jobs.payload->>'url'=item->>'url') then
   insert into public.ss_jobs(kind,payload) values('article',jsonb_build_object('url',item->>'url','kind',item->>'kind','topic',item->>'topic','title',item->>'title'));
  end if;
 end loop;
 for item in select value from jsonb_array_elements(payload->'sources') loop
  insert into public.ss_sources(name,url,type,topic,interval_minutes,next_check_at,include_prereleases,priority) values(item->>'name',item->>'url',item->>'type',item->>'topic',(item->>'interval_minutes')::int,now()+make_interval(secs=>source_count*30),coalesce((item->>'include_prereleases')::boolean,false),coalesce(item->>'priority','normal')) on conflict(url) do nothing;
  get diagnostics n=row_count;source_count:=source_count+n;
 end loop;
 -- Preserve an administrator's existing edits. Only replace the original bootstrap profile.
 update public.ss_settings set value=value||(payload->'profile'),updated_at=now() where key='profile' and value->>'interests'='Bare metal, RoCE, InfiniBand, OpenShift, HyperShift, GPU operators, LLM serving, token quotas and optimization';
 imported:=jsonb_build_object('articles_created',article_count,'folders_created',folder_count,'bookmarks_created',bookmark_count,'sources_created',source_count,'already_applied',false);
 insert into public.ss_imports(key,payload_hash,result) values(import_key,fingerprint,imported);
 insert into public.ss_audit(user_id,action,object_id) values(owner_id,'team_import',import_key);
 return imported;
end;$$;
revoke all on function public.ss_import_team(jsonb) from public,anon,authenticated;
grant execute on function public.ss_import_team(jsonb) to service_role;

-- Filter before LIMIT so low-quality repositories cannot monopolize the oldest queue window.


-- Exact next request opportunity: the oldest rolling slot, Pacific reset, month and spacing.
create or replace function public.ss_evaluation_usage() returns jsonb language sql stable security definer set search_path='' as $$
 with config as(select greatest(1,least(16,coalesce((value->>'gemini_daily_limit')::int,16))) daily, greatest(1,least(496,coalesce((value->>'gemini_monthly_limit')::int,496))) monthly from public.ss_settings where key='profile'),
 usage as(select count(*) filter(where attempted_at>now()-interval '24 hours') used_24h,
 count(*) filter(where attempted_at>=date_trunc('day',now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles') used_provider_day,
 count(*) filter(where attempted_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC') used_month,max(attempted_at) last_attempt from ss_private.evaluation_requests)
 select to_jsonb(usage)||jsonb_build_object('next_available_at',greatest(now(),coalesce(last_attempt+interval '5 minutes',now()),
 case when used_24h>=daily then (select attempted_at+interval '24 hours' from ss_private.evaluation_requests where attempted_at>now()-interval '24 hours' order by attempted_at offset greatest(used_24h-daily,0) limit 1) else now() end,
 case when used_provider_day>=daily then (date_trunc('day',now() at time zone 'America/Los_Angeles')+interval '1 day') at time zone 'America/Los_Angeles' else now() end,
 case when used_month>=monthly then (date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC' else now() end)) from usage cross join config;
$$;
revoke all on function public.ss_evaluation_usage() from public,anon,authenticated;
grant execute on function public.ss_evaluation_usage() to service_role;

-- One pending source job per watch; enqueue time does not move the successful-check clock.
create or replace function public.ss_enqueue_sources() returns void language plpgsql security definer set search_path='' as $$begin
 with due as(select id,url,type,topic,name,interval_minutes from public.ss_sources s where active and next_check_at<=now()
 and not exists(select 1 from public.ss_jobs j where j.kind='source' and j.status in('pending','running') and j.payload->>'source_id'=s.id::text)
 order by next_check_at for update skip locked limit 8), queued as(insert into public.ss_jobs(kind,payload) select 'source',jsonb_build_object('source_id',id,'url',url,'type',type,'topic',topic,'name',name) from due returning id)
 update public.ss_sources s set next_check_at=now()+make_interval(mins=>s.interval_minutes) where s.id in(select id from due);
 update public.ss_jobs set status='failed',last_error='Retry limit reached' where attempts>=4 and status in('pending','running') and locked_at<now()-interval '5 minutes';
end;$$;
revoke all on function public.ss_enqueue_sources() from public,anon,authenticated;
grant execute on function public.ss_enqueue_sources() to service_role;
