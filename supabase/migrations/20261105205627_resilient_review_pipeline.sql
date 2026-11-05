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
