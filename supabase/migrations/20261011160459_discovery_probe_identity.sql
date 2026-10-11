-- Daily/weekly Trending are distinct probes. Preserve URL-based article deduplication.
create or replace function public.ss_queue_item(job_kind text,item jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare identity_key text;
begin
 if job_kind not in('analyze','article','discovery') or jsonb_typeof(item)<>'object' then raise exception 'Invalid job';end if;
 identity_key := case when job_kind='discovery' then
   jsonb_build_array(coalesce(item->>'lane','web'),item->>'query',item->>'window')::text
   else coalesce(item->>'url','') end;
 perform pg_advisory_xact_lock(hashtextextended(job_kind||identity_key,721));
 if not exists(select 1 from public.ss_jobs where kind=job_kind and status in('pending','running') and
   (case when kind='discovery' then jsonb_build_array(coalesce(payload->>'lane','web'),payload->>'query',payload->>'window')::text
    else coalesce(payload->>'url','') end)=identity_key) then
  insert into public.ss_jobs(kind,payload) values(job_kind,item);
 end if;
end;$$;
revoke all on function public.ss_queue_item(text,jsonb) from public,anon,authenticated;
grant execute on function public.ss_queue_item(text,jsonb) to service_role;
