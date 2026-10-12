-- Incremental watch ingestion: unchanged publisher bodies do not occupy queue slots.
create or replace function public.ss_queue_items(job_kind text,items jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; existing uuid; begin
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>100 then raise exception 'Invalid batch';end if;
 for item in select value from jsonb_array_elements(items) loop
  existing:=null;
  if job_kind='analyze' and item->'reference_meta'->>'source_fingerprint' ~ '^[a-f0-9]{64}$' then
   select id into existing from public.ss_articles a where a.url=item->>'url' and a.deleted_at is null
    and a.reference_meta->>'source_fingerprint'=item->'reference_meta'->>'source_fingerprint'
    and a.reference_meta->>'source_id'=item->'reference_meta'->>'source_id';
  end if;
  if existing is not null then
   update public.ss_articles a set reference_meta=a.reference_meta||jsonb_build_object('repo_health',coalesce(item->'reference_meta'->'repo_health',a.reference_meta->'repo_health'),'source_revision',item->'reference_meta'->'source_revision') where id=existing;
  else perform public.ss_queue_item(job_kind,item);
  end if;
 end loop;
end;$$;
revoke all on function public.ss_queue_items(text,jsonb) from public,anon,authenticated;
grant execute on function public.ss_queue_items(text,jsonb) to service_role;

-- Keep job-kind rotation; prioritize core release ingestion within its lane.
create or replace function public.ss_claim_jobs(batch_size int default 3) returns setof public.ss_jobs language sql security definer set search_path='' as $$
 with ranked as (select j.id,row_number() over(partition by kind order by
  case when j.created_at<now()-interval '24 hours' then 0
   when j.kind='analyze' and j.payload->'reference_meta'->>'alert_kind'='release' and exists(select 1 from public.ss_sources s where s.id::text=j.payload->'reference_meta'->>'source_id' and s.active and s.priority='core') then 1 else 2 end,
  case when j.kind='analyze' and j.payload->'reference_meta'->>'alert_kind'='release' then j.payload->>'published_at' else null end desc nulls last,
  available_at,created_at,j.id) as turn from public.ss_jobs j where ((status='pending' and available_at<=now()) or(status='running' and locked_at<now()-interval '5 minutes')) and attempts<4),
 picked as(select j.id from public.ss_jobs j join ranked r on r.id=j.id order by r.turn,j.available_at,j.id for update of j skip locked limit least(greatest(batch_size,1),8))
 update public.ss_jobs set status='running',locked_at=now(),attempts=attempts+1 where id in(select id from picked) returning *;
$$;
revoke all on function public.ss_claim_jobs(int) from public,anon,authenticated;
grant execute on function public.ss_claim_jobs(int) to service_role;
