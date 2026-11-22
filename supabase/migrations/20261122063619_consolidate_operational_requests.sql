-- Keep the minute-by-minute monitor and watchdog while reducing REST requests.
-- The first operation stays outside the exception subtransaction: an ordinary
-- second-stage SQL error must not undo reconciliation, observation, or a rate
-- token already recorded. Return fixed markers so Edge can report the same
-- failure after the successful first stage commits; never expose SQL errors.
create function public.ss_ops_reconcile_snapshot() returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
begin
 perform public.ss_ops_reconcile();
 begin
  return jsonb_build_object('ok',true,'snapshot',public.ss_ops_snapshot());
 exception when others then
  return '{"ok":false,"error":"snapshot_unavailable"}'::jsonb;
 end;
end;$$;

create function public.ss_ops_observe_claim(observation jsonb,conditions jsonb,batch_size integer default 3) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare events jsonb;
begin
 perform public.ss_ops_observe(observation,conditions);
 begin
  select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) into events
  from public.ss_ops_claim_events(batch_size)e;
  return jsonb_build_object('ok',true,'events',events);
 exception when others then
  return '{"ok":false,"error":"incident_claim_unavailable"}'::jsonb;
 end;
end;$$;

create function public.ss_platform_context_limited(item_limit integer default 7) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
begin
 if not coalesce(public.ss_rate_limit(array['platform-context']::text[],120,60),false) then
  return '{"ok":true,"permitted":false}'::jsonb;
 end if;
 begin
  return jsonb_build_object('ok',true,'permitted',true,'context',public.ss_platform_context(item_limit));
 exception when others then
  return '{"ok":false,"permitted":true,"error":"context_unavailable"}'::jsonb;
 end;
end;$$;

revoke all on function public.ss_ops_reconcile_snapshot(),public.ss_ops_observe_claim(jsonb,jsonb,integer),public.ss_platform_context_limited(integer) from public,anon,authenticated;
grant execute on function public.ss_ops_reconcile_snapshot(),public.ss_ops_observe_claim(jsonb,jsonb,integer),public.ss_platform_context_limited(integer) to service_role;
