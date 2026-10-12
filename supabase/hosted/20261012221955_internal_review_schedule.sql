-- Apply after the collector supports mode=evaluation. Reuses existing Vault auth.
-- Idempotent: preserve the collector and reuse the named evaluation job.
do $setup$
declare evaluator_job bigint; enabled boolean;
begin
 select active into enabled from cron.job where jobname='stacksignal-collector';
 if enabled is null then raise exception 'Configure the collector schedule first';end if;
 evaluator_job:=cron.schedule('stacksignal-internal-review','*/5 * * * *', $job$
 delete from cron.job_run_details where jobid=(select jobid from cron.job where jobname='stacksignal-internal-review') and end_time<now()-interval '7 days';
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='stacksignal_collector_url' limit 1),
  headers:=jsonb_build_object('Content-Type','application/json','x-collector-secret',(select decrypted_secret from vault.decrypted_secrets where name='stacksignal_collector_secret' limit 1)),
  body:='{"mode":"internal_review"}'::jsonb,
  timeout_milliseconds:=120000
 );
 $job$);
 perform cron.alter_job(evaluator_job,active:=enabled);
end $setup$;
