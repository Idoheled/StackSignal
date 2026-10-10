-- Apply supabase/hosted/*_hosted_collector_runtime.sql first (Vault is built in).
-- In the Vault UI, create two secrets:
--   stacksignal_collector_url = https://YOUR_PROJECT_REF.supabase.co/functions/v1/collector
--   stacksignal_collector_secret = the COLLECTOR_SECRET from your local .env.setup
-- Never paste real secrets into this tracked file.
-- Prepare the schedule paused. Re-running preserves an existing job and its
-- active state. Activate only after a successful authenticated collector run.
do $setup$
declare collector_job bigint;
begin
 if exists(select 1 from cron.job where jobname='stacksignal-collector') then
  raise notice 'StackSignal schedule already exists; preserving it';
  return;
 end if;
 if not exists(select 1 from vault.decrypted_secrets where name='stacksignal_collector_secret' and length(decrypted_secret)>=32)
 or not exists(select 1 from vault.decrypted_secrets where name='stacksignal_collector_url' and decrypted_secret ~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/collector$') then
  raise exception 'Configure the collector Vault secrets before scheduling';
 end if;
 collector_job := cron.schedule('stacksignal-collector','*/5 * * * *', $job$
 delete from cron.job_run_details
 where jobid=(select jobid from cron.job where jobname='stacksignal-collector')
 and end_time < now()-interval '7 days';
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='stacksignal_collector_url' limit 1),
  headers := jsonb_build_object('Content-Type','application/json','x-collector-secret',(select decrypted_secret from vault.decrypted_secrets where name='stacksignal_collector_secret' limit 1)),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
 );
$job$);
 perform cron.alter_job(collector_job,active:=false);
end $setup$;

-- After verifying a successful collector invocation, activate:
-- select cron.alter_job((select jobid from cron.job where jobname='stacksignal-collector'),active:=true);
-- Pause without deleting its history:
-- select cron.alter_job((select jobid from cron.job where jobname='stacksignal-collector'),active:=false);
