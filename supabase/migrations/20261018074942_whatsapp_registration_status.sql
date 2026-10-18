-- Registration is a recorded declaration, never inferred WhatsApp membership.
alter table public.ss_members
  add column whatsapp_registration text not null default 'unregistered'
    check (whatsapp_registration in ('unregistered','pending','registered')),
  add column whatsapp_registered_at timestamptz,
  add column whatsapp_registration_source text
    check (whatsapp_registration_source in ('user_confirmed','admin_confirmed')),
  add column whatsapp_updated_at timestamptz not null default now();
update public.ss_members set whatsapp_registration='pending' where whatsapp_opt_in;
alter table public.ss_members add constraint whatsapp_registration_consistent check (
  whatsapp_opt_in = (whatsapp_registration <> 'unregistered') and
  (whatsapp_registration='registered') = (whatsapp_registered_at is not null) and
  (whatsapp_registration='registered') = (whatsapp_registration_source is not null)
);

create or replace function public.ss_whatsapp_preferences(desired_opt_in boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.ss_members; configuration ss_private.whatsapp_configuration;
begin
  if not ss_private.member_ok(true) then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into m from public.ss_members where id=auth.uid() for update;
  if desired_opt_in is not null and desired_opt_in is distinct from m.whatsapp_opt_in then
    update public.ss_members set whatsapp_opt_in=desired_opt_in,
      whatsapp_registration=case when desired_opt_in then 'pending' else 'unregistered' end,
      whatsapp_registered_at=null,whatsapp_registration_source=null,whatsapp_updated_at=now()
      where id=auth.uid() returning * into m;
    insert into public.ss_audit(user_id,action,object_id)
      values(auth.uid(),'whatsapp_'||m.whatsapp_registration,auth.uid()::text);
  end if;
  select * into configuration from ss_private.whatsapp_configuration where singleton;
  return jsonb_build_object('opt_in',m.whatsapp_opt_in,'registration',m.whatsapp_registration,
    'registered_at',m.whatsapp_registered_at,'registration_source',m.whatsapp_registration_source,
    'updated_at',m.whatsapp_updated_at,'enabled',coalesce(configuration.enabled,false),
    'invite_url',case when m.whatsapp_opt_in then configuration.invite_url else null end);
end; $$;

create function public.ss_whatsapp_confirm_joined()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.ss_members;
begin
  if not ss_private.member_ok(true) then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into m from public.ss_members where id=auth.uid() for update;
  if not m.whatsapp_opt_in then raise exception 'Choose WhatsApp alerts before confirming membership' using errcode='22023'; end if;
  if m.whatsapp_registration <> 'registered' then
    update public.ss_members set whatsapp_registration='registered',whatsapp_registered_at=now(),
      whatsapp_registration_source='user_confirmed',whatsapp_updated_at=now() where id=auth.uid();
    insert into public.ss_audit(user_id,action,object_id) values(auth.uid(),'whatsapp_registered',auth.uid()::text);
  end if;
  return public.ss_whatsapp_preferences(null);
end; $$;
revoke all on function public.ss_whatsapp_confirm_joined() from public,anon,service_role;
grant execute on function public.ss_whatsapp_confirm_joined() to authenticated;

create or replace function public.ss_finish_invite_whatsapp(invite_id uuid,claim uuid,user_id uuid,uname text,dname text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.ss_finish_invite(invite_id,claim,user_id,uname,dname);
  update public.ss_members set whatsapp_opt_in=true,whatsapp_registration='pending',whatsapp_updated_at=now() where id=user_id;
  insert into public.ss_audit(user_id,action,object_id) values(user_id,'whatsapp_pending',user_id::text);
end; $$;
