-- Enable Supabase Cron, pg_net and Vault in the dashboard first.
-- In the Vault UI, create two secrets:
--   stacksignal_collector_url = https://YOUR_PROJECT_REF.supabase.co/functions/v1/collector
--   stacksignal_collector_secret = the COLLECTOR_SECRET from your local .env.setup
-- Never paste real secrets into this tracked file.
select cron.schedule('stacksignal-collector','*/5 * * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='stacksignal_collector_url' limit 1),
  headers := jsonb_build_object('Content-Type','application/json','x-collector-secret',(select decrypted_secret from vault.decrypted_secrets where name='stacksignal_collector_secret' limit 1)),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
 );
$job$);
-- To pause: select cron.unschedule('stacksignal-collector');
