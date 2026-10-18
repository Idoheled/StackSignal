-- Pause new admissions and dispatch; already accepted host work may finish.
begin;
update ss_private.whatsapp_configuration set enabled=false where singleton;
select cron.alter_job(jobid,active:=false) from cron.job where jobname='ss-whatsapp-dispatch';
commit;
-- Preserve receipts and the historical activation watermark. A future explicit
-- activation uses a fresh watermark and must reconcile any outstanding work.
