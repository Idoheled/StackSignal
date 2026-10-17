-- Additive notification support. Disabled until a paired host passes real delivery checks.
alter table public.ss_members add column whatsapp_opt_in boolean not null default false;

create table ss_private.whatsapp_configuration (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  active_from timestamptz,
  app_origin text not null default 'https://stacksignal.stacksignal-idoheled.workers.dev'
    check (app_origin ~ '^https://[a-zA-Z0-9.-]+$'),
  invite_url text check (invite_url ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]{16,64}$'),
  check (not enabled or active_from is not null)
);
insert into ss_private.whatsapp_configuration(singleton) values (true);
alter table ss_private.whatsapp_configuration enable row level security;
revoke all on ss_private.whatsapp_configuration from public, anon, authenticated, service_role;

create function public.ss_whatsapp_preferences(desired_opt_in boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare opted boolean; configuration ss_private.whatsapp_configuration;
begin
  if not ss_private.member_ok(true) then raise exception 'Authentication required' using errcode='42501'; end if;
  if desired_opt_in is not null then
    update public.ss_members set whatsapp_opt_in=desired_opt_in where id=auth.uid();
  end if;
  select whatsapp_opt_in into opted from public.ss_members where id=auth.uid();
  select * into configuration from ss_private.whatsapp_configuration where singleton;
  return jsonb_build_object('opt_in',opted,'enabled',coalesce(configuration.enabled,false),
    'invite_url',case when opted then configuration.invite_url else null end);
end; $$;
revoke all on function public.ss_whatsapp_preferences(boolean) from public,anon,service_role;
grant execute on function public.ss_whatsapp_preferences(boolean) to authenticated;

-- Preserve the existing invitation transaction and signature for old clients.
create function public.ss_finish_invite_whatsapp(invite_id uuid,claim uuid,user_id uuid,uname text,dname text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.ss_finish_invite(invite_id,claim,user_id,uname,dname);
  update public.ss_members set whatsapp_opt_in=true where id=user_id;
end; $$;
revoke all on function public.ss_finish_invite_whatsapp(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ss_finish_invite_whatsapp(uuid,uuid,uuid,text,text) to service_role;

-- Private notes are not included in notification deep-link responses.
create function public.ss_whatsapp_article(article_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not ss_private.member_ok(true) then raise exception 'Authentication required' using errcode='42501'; end if;
  select to_jsonb(a)||jsonb_build_object(
    'title',coalesce(a.reference_meta->'review_snapshot'->>'title',a.title),
    'summary',coalesce(a.reference_meta->'review_snapshot'->>'summary',a.summary),
    'reason',coalesce(a.reference_meta->'review_snapshot'->>'reason',a.reason),
    'evidence',coalesce(a.reference_meta->'review_snapshot'->>'evidence',a.evidence))
  into result from public.ss_articles a where a.id=article_id and a.deleted_at is null;
  return result;
end; $$;
revoke all on function public.ss_whatsapp_article(uuid) from public,anon,service_role;
grant execute on function public.ss_whatsapp_article(uuid) to authenticated;

create table ss_private.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null unique references public.ss_articles(id) on delete cascade,
  event_kind text not null check (event_kind in ('article_approved','github_release')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','running','sent','needs_attention')),
  available_at timestamptz not null default now(),
  lease_id uuid,
  locked_at timestamptz,
  failures integer not null default 0,
  provider_message_id text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  check (status<>'sent' or provider_message_id is not null)
);
create index whatsapp_outbox_due on ss_private.whatsapp_outbox(available_at,created_at) where status='pending';
create index whatsapp_outbox_leases on ss_private.whatsapp_outbox(locked_at) where status='running';
alter table ss_private.whatsapp_outbox enable row level security;
revoke all on ss_private.whatsapp_outbox from public,anon,authenticated,service_role;

create function ss_private.enqueue_whatsapp_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare configuration ss_private.whatsapp_configuration; profile jsonb; minimum integer; event text;
begin
  select * into configuration from ss_private.whatsapp_configuration where singleton;
  if not coalesce(configuration.enabled,false) or new.deleted_at is not null then return null; end if;
  if not exists(select 1 from public.ss_articles where id=new.id) then return null; end if;
  select value into profile from public.ss_settings where key='profile';
  minimum:=coalesce((profile->>'min_score')::integer,55);
  if not ss_private.reviewed_article(new.reference_meta,minimum)
    or not ss_private.repo_admitted(new.url,new.reference_meta,profile)
    or not ss_private.release_channel_allowed(new.url,new.reference_meta)
    or new.reference_meta->'evaluation'->>'evaluated_at' is null then return null; end if;
  if tg_op='UPDATE' and ss_private.reviewed_article(old.reference_meta,minimum)
    and ss_private.repo_admitted(old.url,old.reference_meta,profile)
    and ss_private.release_channel_allowed(old.url,old.reference_meta) then return null; end if;
  if (new.reference_meta->'evaluation'->>'evaluated_at')::timestamptz < configuration.active_from then return null; end if;
  event:=case when new.reference_meta->>'alert_kind'='release' and exists (
    select 1 from public.ss_sources s where s.id::text=new.reference_meta->>'source_id' and s.active and s.type='github'
  ) then 'github_release' else 'article_approved' end;
  insert into ss_private.whatsapp_outbox(article_id,event_kind,payload) values(new.id,event,jsonb_build_object(
    'version',1,'kind',event,'article_id',new.id,
    'title',left(coalesce(new.reference_meta->'review_snapshot'->>'title',new.title),500),
    'summary',left(coalesce(new.reference_meta->'review_snapshot'->>'summary',new.summary),1400),
    'why',left(coalesce(new.reference_meta->'review_snapshot'->>'reason',new.reason),700),
    'evidence',left(coalesce(new.reference_meta->'review_snapshot'->>'evidence',new.evidence),800),
    'topic',new.topic,'source',new.source,'source_url',new.url,
    'discovered_at',new.discovered_at,'evaluated_at',new.reference_meta->'evaluation'->>'evaluated_at',
    'ui_url',configuration.app_origin||'/?article='||new.id::text
  )) on conflict(article_id) do nothing;
  return null;
end; $$;
revoke all on function ss_private.enqueue_whatsapp_notification() from public,anon,authenticated,service_role;
-- Run after the existing discard guard, so rejected rows cannot leave payload copies.
create trigger z_whatsapp_notification after insert or update of reference_meta on public.ss_articles
for each row execute function ss_private.enqueue_whatsapp_notification();

create function public.ss_whatsapp_claim_events(batch_size integer default 5)
returns setof ss_private.whatsapp_outbox language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select enabled from ss_private.whatsapp_configuration where singleton),false) then return; end if;
  return query update ss_private.whatsapp_outbox set status='running',locked_at=now(),lease_id=gen_random_uuid()
  where id in (select id from ss_private.whatsapp_outbox
    where (status='pending' and available_at<=now()) or (status='running' and locked_at<now()-interval '5 minutes')
    order by available_at,created_at for update skip locked limit least(greatest(coalesce(batch_size,5),1),10))
  returning *;
end; $$;
revoke all on function public.ss_whatsapp_claim_events(integer) from public,anon,authenticated;
grant execute on function public.ss_whatsapp_claim_events(integer) to service_role;

create function public.ss_whatsapp_finish_event(event_id uuid,expected_lease uuid,outcome text,message_id text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if outcome not in ('queued','retry','sent','uncertain') or (outcome='sent' and length(coalesce(message_id,'')) not between 1 and 256) then
    raise exception 'Invalid delivery result';
  end if;
  update ss_private.whatsapp_outbox set
    status=case when outcome='sent' then 'sent' when outcome='uncertain' then 'needs_attention' else 'pending' end,
    available_at=now()+make_interval(secs=>case when outcome='retry' then least(3600,60*power(2,least(failures,6))::integer) else 60 end),
    failures=failures+case when outcome='retry' then 1 else 0 end,
    lease_id=null,locked_at=null,
    provider_message_id=case when outcome='sent' then message_id else provider_message_id end,
    delivered_at=case when outcome='sent' then now() else delivered_at end,
    payload=case when outcome='sent' then '{}'::jsonb else payload end,
    last_error=case when outcome='retry' then 'Webhook unavailable; awaiting retry' when outcome='uncertain' then 'Delivery uncertain; reconcile before replay' else null end
  where id=event_id and status='running' and lease_id=expected_lease;
  get diagnostics n=row_count;
  return n=1;
end; $$;
revoke all on function public.ss_whatsapp_finish_event(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ss_whatsapp_finish_event(uuid,uuid,text,text) to service_role;
