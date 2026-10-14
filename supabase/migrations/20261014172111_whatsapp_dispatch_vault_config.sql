-- Server-only delivery configuration. No service key is installed on the bot host.
create function public.ss_whatsapp_dispatch_configuration() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  select jsonb_object_agg(name,decrypted_secret) into result from vault.decrypted_secrets
  where name in ('whatsapp_webhook_url','whatsapp_webhook_secret','whatsapp_dispatch_secret','whatsapp_app_origin');
  return coalesce(result,'{}'::jsonb);
end; $$;
revoke all on function public.ss_whatsapp_dispatch_configuration() from public,anon,authenticated;
grant execute on function public.ss_whatsapp_dispatch_configuration() to service_role;

create function public.ss_whatsapp_stage_webhook(webhook text) returns void
language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
  if webhook !~ '^https://stacksignal\.[0-9]{1,3}(\.[0-9]{1,3}){3}\.sslip\.io/v1/events$'
    or exists(select 1 from ss_private.whatsapp_configuration where enabled)
    then raise exception 'Only the disabled, dedicated host may be staged'; end if;
  select id into secret_id from vault.secrets where name='whatsapp_webhook_url';
  if secret_id is null then perform vault.create_secret(webhook,'whatsapp_webhook_url');
  else perform vault.update_secret(secret_id,webhook); end if;
end; $$;
revoke all on function public.ss_whatsapp_stage_webhook(text) from public,anon,authenticated;
grant execute on function public.ss_whatsapp_stage_webhook(text) to service_role;
