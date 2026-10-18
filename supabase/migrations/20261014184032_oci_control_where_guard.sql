-- TEMPORARY: scoped updates also satisfy Supabase REST safe-update checks.
create or replace function public.ss_oci_provisioner_control(requested_action text,run_token uuid default null,input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.oci_provisioner_state; desired text; job bigint;
begin
  if jsonb_typeof(input)<>'object' or octet_length(input::text)>16000 then raise exception 'Invalid control payload'; end if;
  select * into s from public.oci_provisioner_state where deployment_id='stacksignal-whatsapp-bot-il-jerusalem-1' for update;
  if not found then raise exception 'Provisioning state missing'; end if;
  if requested_action='status' then return to_jsonb(s); end if;
  if requested_action='lease' then
    if not s.cron_enabled or s.status in ('AWAITING_WHATSAPP_QR','VERIFIED_LIVE','PAUSED_ERROR')
      or s.locked_until>now() then return jsonb_build_object('acquired',false,'state',to_jsonb(s)); end if;
    if s.approved_sha is null or input->>'commit_sha' is distinct from s.approved_sha then
      return jsonb_build_object('acquired',false,'reason','unverified_revision','state',to_jsonb(s));
    end if;
    if coalesce(input->>'runner_id','') !~ '^[a-zA-Z0-9._:-]{1,100}$' then raise exception 'Invalid runner identity'; end if;
    update public.oci_provisioner_state set lease_id=gen_random_uuid(),locked_until=now()+interval '20 minutes',
      runner_id=input->>'runner_id',last_run_at=now(),attempt_count=attempt_count+1,updated_at=now()
    where deployment_id=s.deployment_id returning * into s;
    return jsonb_build_object('acquired',true,'state',to_jsonb(s));
  end if;
  -- An identical signed retry after stop is harmless and may retry its notification.
  if requested_action='stop_cron' and s.status='AWAITING_WHATSAPP_QR' and not s.cron_enabled then return to_jsonb(s); end if;
  if requested_action='notification_result' and s.status='AWAITING_WHATSAPP_QR' and not s.cron_enabled then
    update public.oci_provisioner_state set notification_status=case when input->>'sent'='true' then 'sent' else 'error' end,updated_at=now() where deployment_id=s.deployment_id returning * into s;
    return to_jsonb(s);
  end if;
  if not s.cron_enabled then raise exception 'Provisioning disabled'; end if;
  if run_token is null or run_token is distinct from s.lease_id or coalesce(s.locked_until<=now(),true) then raise exception 'Lease lost' using errcode='40001'; end if;
  if requested_action='renew' then
    update public.oci_provisioner_state set locked_until=now()+interval '20 minutes',updated_at=now() where deployment_id=s.deployment_id returning * into s;
  elsif requested_action='checkpoint' or requested_action='release' then
    desired:=coalesce(input->>'status',s.status);
    if not ((s.status='SEARCHING_CAPACITY' and desired in ('SEARCHING_CAPACITY','LAUNCH_IN_FLIGHT','VM_ALLOCATED_INSTALLING','PAUSED_ERROR'))
      or (s.status='LAUNCH_IN_FLIGHT' and desired in ('SEARCHING_CAPACITY','LAUNCH_IN_FLIGHT','VM_ALLOCATED_INSTALLING','PAUSED_ERROR'))
      or (s.status='VM_ALLOCATED_INSTALLING' and desired in ('VM_ALLOCATED_INSTALLING','PAUSED_ERROR'))) then raise exception 'Invalid state transition'; end if;
    if input ? 'manifest' and (jsonb_typeof(input->'manifest')<>'object'
      or input->'manifest'->>'deployment' is distinct from s.manifest->>'deployment') then raise exception 'Deployment identity cannot change'; end if;
    if s.instance_ocid is not null and (desired in ('SEARCHING_CAPACITY','LAUNCH_IN_FLIGHT')
      or (input ? 'instance_ocid' and input->>'instance_ocid' is distinct from s.instance_ocid)) then raise exception 'Allocated instance cannot change'; end if;
    if input ? 'instance_ocid' and coalesce(input->>'instance_ocid','') !~ '^ocid1\.instance\.oc1\.il-jerusalem-1\.' then raise exception 'Invalid instance region'; end if;
    if desired='VM_ALLOCATED_INSTALLING' and coalesce(input->>'instance_ocid',s.instance_ocid) is null then raise exception 'Allocated instance missing'; end if;
    update public.oci_provisioner_state set status=desired,
      manifest=coalesce(input->'manifest',manifest),last_result=coalesce(input->'result',last_result),
      instance_ocid=coalesce(input->>'instance_ocid',instance_ocid),public_ip=coalesce(input->>'public_ip',public_ip),
      shape_allocated=coalesce(input->>'shape_allocated',shape_allocated),webhook_url=coalesce(input->>'webhook_url',webhook_url),
      lease_id=case when requested_action='release' then null else lease_id end,
      locked_until=case when requested_action='release' then null else locked_until end,updated_at=now()
    where deployment_id=s.deployment_id returning * into s;
    if desired='PAUSED_ERROR' then
      update public.oci_provisioner_state set cron_enabled=false,lease_id=null,locked_until=null where deployment_id=s.deployment_id returning * into s;
      for job in select jobid from cron.job where jobname='stacksignal-oci-hourly-claim' loop perform cron.unschedule(job); end loop;
    end if;
  elsif requested_action='stop_cron' then
    if s.status<>'VM_ALLOCATED_INSTALLING' or s.instance_ocid is null or s.public_ip is null or s.webhook_url is null
      or s.manifest->'ready'->>'bootstrap' is distinct from 'true' or s.manifest->'ready'->>'ollama' is distinct from 'true' or s.manifest->'ready'->>'https' is distinct from 'true'
      or s.manifest->'ready' is null then raise exception 'Host readiness incomplete'; end if;
    update public.oci_provisioner_state set cron_enabled=false,status='AWAITING_WHATSAPP_QR',lease_id=null,locked_until=null,
      notification_status='pending',updated_at=now() where deployment_id=s.deployment_id returning * into s;
    for job in select jobid from cron.job where jobname='stacksignal-oci-hourly-claim' loop
      perform cron.unschedule(job);
    end loop;
  else raise exception 'Unknown control action'; end if;
  return to_jsonb(s);
end; $$;
