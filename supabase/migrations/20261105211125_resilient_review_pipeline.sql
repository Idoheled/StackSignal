-- Merge independently produced evaluator and fallback fields under one row lock.
-- The service role already owns write access to this setting; no elevated owner
-- privileges are needed for this RPC.
create function public.ss_merge_evaluation_health(patch jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(patch) is distinct from 'object' or octet_length(patch::text)>131072 then
  raise exception 'Invalid evaluation health patch';
 end if;
 insert into public.ss_settings(key,value,updated_at) values('evaluation_health',patch,now())
 on conflict(key) do update set value=ss_settings.value||excluded.value,updated_at=excluded.updated_at;
end;$$;
revoke all on function public.ss_merge_evaluation_health(jsonb) from public,anon,authenticated;
grant execute on function public.ss_merge_evaluation_health(jsonb) to service_role;

-- Persist fixed failure classifications, never SQL text, payloads or provider
-- responses. The existing three-argument finish RPC remains for old deployments.
alter table ss_private.ops_runs add column failure_step text, add column failure_code text;
create function public.ss_ops_run_finish(run_id uuid,outcome text,processed integer,failure_step text,failure_code text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if outcome is null or outcome not in('succeeded','failed') or processed is null or processed not between 0 and 10000
  or (outcome='succeeded' and (failure_step is not null or failure_code is not null))
  or (outcome='failed' and (failure_step is null or failure_step !~ '^(ss_[a-z0-9_]{1,61}|database_request|collector_runtime)$'
    or failure_code is null or failure_code not in('database_timeout','database_transport','database_unavailable','database_rejected','review_validation','runtime_error'))) then
  raise exception 'Invalid run result';
 end if;
 update ss_private.ops_runs
 set status=outcome,finished_at=clock_timestamp(),
 duration_ms=greatest(0,extract(epoch from(clock_timestamp()-started_at))*1000)::bigint,
 processed=ss_ops_run_finish.processed,failure_step=ss_ops_run_finish.failure_step,failure_code=ss_ops_run_finish.failure_code
 where id=run_id and status='running';
end;$$;
revoke all on function public.ss_ops_run_finish(uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.ss_ops_run_finish(uuid,text,integer,text,text) to service_role;
-- A dead automatic search result is a content disposition, not an unresolved pipeline outage.
-- Keep the canonical article reversibly archived until existing retention applies; preserve only
-- bounded job identifiers and a fixed reason in diagnostics.
create function public.ss_archive_unavailable_article_job(
 job_id uuid, expected_lock timestamptz, http_status integer
) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.ss_jobs; a public.ss_articles; candidate_url text; error_code text; observed_error text;
begin
 if expected_lock is null or http_status is null or http_status not in (404,410) then return false;end if;
 observed_error:='Source returned HTTP '||http_status;
 error_code:=case when http_status=404 then 'source_not_found' else 'source_gone' end;
 select x.payload->>'url' into candidate_url from public.ss_jobs x
 where x.id=job_id and x.kind='article' and x.status in('running','failed') and x.locked_at=expected_lock;
 if candidate_url is null then return false;end if;

 -- Lock the article before the job, matching article-dependent cleanup. Skip any
 -- row another worker owns, rather than waiting or stealing a changed lease.
 select * into a from public.ss_articles x
 where x.url=candidate_url and x.deleted_at is null
   and x.reference_meta->>'origin'='discovery'
   and x.reference_meta->>'discovery_lane'='web_search'
   and x.reference_meta->>'search_provider'='Tavily'
   and x.reference_meta->>'link_status'='search_result'
   and x.reference_meta->'public_evaluation_input'->>'scope'='search_snippet'
   and x.reference_meta->>'evaluation' is null
 for update skip locked;
 if not found then return false;end if;
 select * into j from public.ss_jobs x
 where x.id=job_id and x.kind='article' and x.status in('running','failed')
   and x.locked_at=expected_lock and x.payload->>'url'=candidate_url and x.attempts>=1
   and x.payload->>'health_only' is distinct from 'true'
   and x.payload->>'id' is null and x.payload->>'article_id' is null
 for update skip locked;
 if not found then return false;end if;
 if (j.status='failed' and j.last_error is distinct from observed_error)
    or (http_status=404 and (j.attempts<2 or j.last_error is distinct from observed_error))
    or exists(select 1 from public.ss_sources where active and url=candidate_url)
    or exists(select 1 from public.ss_bookmarks where article_id=a.id)
    or exists(select 1 from public.ss_feedback where article_id=a.id)
    or exists(select 1 from public.ss_notes where article_id=a.id)
    or exists(select 1 from ss_private.article_reviews where article_id=a.id)
    or exists(select 1 from ss_private.whatsapp_outbox where article_id=a.id)
    or exists(select 1 from ss_private.evaluation_claims where article_id=a.id and attempted_at>now()-interval '5 minutes')
 then return false;end if;

 insert into ss_private.ops_archived_jobs(id,kind,created_at,resolution)
 values(j.id,j.kind,j.created_at,case when http_status=404 then 'Automatic search result unavailable after consecutive HTTP 404 responses' else 'Automatic search result removed by publisher (HTTP 410)' end)
 on conflict do nothing;
 -- Existing job trace records the failed attempt and removal. The explicit terminal
 -- record correlates them to the article even after it leaves the active feed.
 update public.ss_jobs set status='failed',last_error=observed_error where id=j.id;
 delete from public.ss_jobs where id=j.id;
 update public.ss_articles set deleted_at=now(),reference_meta=reference_meta||jsonb_build_object(
   'public_extraction_requested','unavailable','collection_error_code',error_code,'collection_failed_at',now()
 ) where id=a.id;
 insert into ss_private.ops_trace_events(stage,entity_id,job_id,article_id,phase,attempt,error_code)
 values('collection',j.id,j.id,a.id,'source_unavailable',j.attempts,error_code);
 insert into ss_private.ops_recoveries(kind,affected) values('article_source_unavailable',1);
 return true;
end;$$;
revoke all on function public.ss_archive_unavailable_article_job(uuid,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.ss_archive_unavailable_article_job(uuid,timestamptz,integer) to service_role;

-- The authenticated submit RPC is the only member path that inserts an article
-- job with an exact {id,url} payload. Automatic jobs and ordinary archives stay
-- unchanged. Restore within the submit transaction before it saves the bookmark.
create function ss_private.restore_unavailable_article_on_submit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.kind<>'article' or new.status<>'pending' or new.attempts<>0 or new.locked_at is not null
    or current_setting('role',true) is distinct from 'authenticated'
    or jsonb_typeof(new.payload) is distinct from 'object' then return new;end if;
 if new.payload-'id'-'url'<>'{}'::jsonb or not (new.payload ?& array['id','url'])
    or coalesce(new.payload->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    or jsonb_typeof(new.payload->'url') is distinct from 'string'
    or auth.uid() is null or not ss_private.member_ok()
    or coalesce(ss_private.role(),'') not in('admin','maintainer') then return new;end if;
 update public.ss_articles a
 set deleted_at=null,reference_meta=(
   case when a.reference_meta->'public_evaluation_input'->>'scope'='search_snippet'
        then a.reference_meta-'public_evaluation_input' else a.reference_meta end
   )-'collection_error_code'-'collection_failed_at'||jsonb_build_object('public_extraction_requested','queued')
 where a.id=(new.payload->>'id')::uuid and a.url=new.payload->>'url'
   and a.deleted_at is not null and a.reference_meta->>'evaluation' is null
   and a.reference_meta->>'public_extraction_requested'='unavailable'
   and a.reference_meta->>'collection_error_code' in('source_not_found','source_gone')
   and a.reference_meta->>'collection_failed_at' is not null;
 if found then new.payload:=new.payload||jsonb_build_object('terminal_restore_job_id',new.id);end if;
 return new;
end;$$;
revoke all on function ss_private.restore_unavailable_article_on_submit() from public,anon,authenticated,service_role;
create trigger ss_restore_unavailable_article_on_submit before insert on public.ss_jobs
 for each row execute function ss_private.restore_unavailable_article_on_submit();

-- Give an explicit restored link one bounded collection window before the
-- original 24-hour fallback clock applies again. No new discovery or review time.
create or replace function public.ss_internal_review_candidates(batch_size int default 200) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]') from (
  select a.id,a.url,a.title,a.topic,a.kind,a.discovered_at,a.content_hash,a.reference_meta,a.review_state
  from public.ss_articles a where a.deleted_at is null
    and a.review_state in('awaiting_input','awaiting_evaluation','retry_wait','needs_attention')
    and not exists(select 1 from public.ss_jobs j where j.kind='article' and j.status in('pending','running')
      and j.created_at>now()-interval '15 minutes' and j.payload->>'terminal_restore_job_id'=j.id::text
      and j.payload->>'id'=a.id::text and j.payload->>'url'=a.url)
  order by (a.discovered_at<=now()-interval '24 hours') desc,(a.reference_meta->>'alert_kind'='release') desc nulls last,a.discovered_at,a.id
  limit least(greatest(batch_size,1),500)
 )x;
$$;
revoke all on function public.ss_internal_review_candidates(int) from public,anon,authenticated;
grant execute on function public.ss_internal_review_candidates(int) to service_role;
