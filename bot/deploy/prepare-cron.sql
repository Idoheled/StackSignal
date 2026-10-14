-- Operator-only rollout step, AFTER applying the additive notification migration.
-- Vault names: whatsapp_dispatch_url (complete Edge URL), whatsapp_dispatch_secret.
-- Values are configured outside git. This transaction leaves the schedule paused.
begin;
do $$
declare endpoint text; secret text; job bigint;
begin
  if coalesce((select enabled from ss_private.whatsapp_configuration where singleton),false) then
    raise exception 'Disable notification delivery before preparing its schedule';
  end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='whatsapp_dispatch_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name='whatsapp_dispatch_secret';
  if endpoint is null or endpoint !~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/whatsapp-dispatcher$'
    or length(coalesce(secret,''))<32 then raise exception 'Dispatcher Vault configuration is incomplete'; end if;
  if exists(select 1 from cron.job where jobname='ss-whatsapp-dispatch' and active) then
    raise exception 'An active notification schedule already exists; reconcile before changing it';
  end if;
  select cron.schedule('ss-whatsapp-dispatch','* * * * *',$cron$
    select net.http_post(
      url:=(select decrypted_secret from vault.decrypted_secrets where name='whatsapp_dispatch_url'),
      headers:=jsonb_build_object('Content-Type','application/json',
        'x-whatsapp-dispatch-secret',(select decrypted_secret from vault.decrypted_secrets where name='whatsapp_dispatch_secret')),
      body:='{}'::jsonb, timeout_milliseconds:=90000
    );
  $cron$) into job;
  perform cron.alter_job(job,active:=false);
end; $$;
commit;
-- Activation is a separate step after verified delivery: set enabled/active_from,
-- then cron.alter_job((select jobid from cron.job where jobname='ss-whatsapp-dispatch'),active:=true).
