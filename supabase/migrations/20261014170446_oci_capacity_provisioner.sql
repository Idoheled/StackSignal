-- TEMPORARY provisioning control plane; remove this source before merging the bot.
-- Existing collector/evaluator schedules are never changed by this migration.
create table public.oci_provisioner_state (
  deployment_id text primary key default 'stacksignal-whatsapp-bot-il-jerusalem-1'
    check(deployment_id='stacksignal-whatsapp-bot-il-jerusalem-1'),
  status text not null default 'SEARCHING_CAPACITY' check(status in
    ('SEARCHING_CAPACITY','LAUNCH_IN_FLIGHT','VM_ALLOCATED_INSTALLING','AWAITING_WHATSAPP_QR','VERIFIED_LIVE','PAUSED_ERROR')),
  cron_enabled boolean not null default false,
  approved_sha text check(approved_sha ~ '^[0-9a-f]{40}$'),
  lease_id uuid, locked_until timestamptz, runner_id text,
  attempt_count integer not null default 0, last_run_at timestamptz,
  last_result jsonb, manifest jsonb not null default jsonb_build_object('deployment',gen_random_uuid(),'launch_token',gen_random_uuid()),
  instance_ocid text, public_ip text, shape_allocated text, webhook_url text,
  notification_status text not null default 'none' check(notification_status in ('none','pending','sent','error')),
  updated_at timestamptz not null default now()
);
alter table public.oci_provisioner_state enable row level security;
revoke all on public.oci_provisioner_state from public,anon,authenticated,service_role;
insert into public.oci_provisioner_state(deployment_id) values('stacksignal-whatsapp-bot-il-jerusalem-1');

create function public.ss_oci_control_configuration() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  select jsonb_object_agg(name,decrypted_secret) into result from vault.decrypted_secrets
  where name in ('oci_cron_control_secret','oci_provisioner_github_pat');
  return coalesce(result,'{}'::jsonb);
end; $$;
revoke all on function public.ss_oci_control_configuration() from public,anon,authenticated;
grant execute on function public.ss_oci_control_configuration() to service_role;

create function public.ss_oci_provisioner_control(requested_action text,run_token uuid default null,input jsonb default '{}')
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
revoke all on function public.ss_oci_provisioner_control(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ss_oci_provisioner_control(text,uuid,jsonb) to service_role;

create function ss_private.oci_hourly_dispatch() returns bigint language plpgsql security definer set search_path='' as $$
declare token text; request_id bigint;
begin
  if not exists(select 1 from public.oci_provisioner_state where cron_enabled and status in ('SEARCHING_CAPACITY','LAUNCH_IN_FLIGHT','VM_ALLOCATED_INSTALLING')
    and (locked_until is null or locked_until<now())) then return null; end if;
  select decrypted_secret into token from vault.decrypted_secrets where name='oci_provisioner_github_pat';
  if length(coalesce(token,''))<30 then raise exception 'GitHub dispatch credential missing'; end if;
  select net.http_post(url:='https://api.github.com/repos/Idoheled/StackSignal/actions/workflows/ci.yml/dispatches',
    headers:=jsonb_build_object('Authorization','Bearer '||token,'Accept','application/vnd.github+json','Content-Type','application/json','X-GitHub-Api-Version','2026-03-10','User-Agent','StackSignal-OCI-Provisioner'),
    body:=jsonb_build_object('ref','feat/whatsapp-notifications','inputs',jsonb_build_object('mode','oci_capacity')),
    timeout_milliseconds:=15000) into request_id;
  return request_id;
end; $$;
revoke all on function ss_private.oci_hourly_dispatch() from public,anon,authenticated,service_role;
