-- Operator release gate: run only AFTER explicit owner approval of the private
-- preview, green release checks, production rollout and live host verification.
-- This script activates content notifications; it never enables provisioning.
begin;
do $$
declare job bigint;
begin
  if not exists(select 1 from public.oci_provisioner_state
    where deployment_id='stacksignal-whatsapp-bot-il-jerusalem-1'
      and cron_enabled=false and lease_id is null
      and manifest->'whatsapp'->>'delivery_verified'='true') then
    raise exception 'Verified existing-host delivery checkpoint required';
  end if;
  if not exists(select 1 from ss_private.whatsapp_configuration
    where singleton and not enabled and invite_url is not null) then
    raise exception 'Expected paused, configured notifications';
  end if;
  if exists(select 1 from ss_private.whatsapp_outbox where status<>'sent') then
    raise exception 'Reconcile outstanding deliveries before activation';
  end if;
  if (select count(*) from cron.job where jobname='ss-whatsapp-dispatch' and not active)<>1 then
    raise exception 'Expected exactly one paused notification schedule';
  end if;
  select jobid into job from cron.job where jobname='ss-whatsapp-dispatch';
  update ss_private.whatsapp_configuration set active_from=now(),enabled=true where singleton;
  perform cron.alter_job(job,active:=true);
end $$;
commit;
