-- Private, bounded operational history. No user/chat content enters group alerts.
create table ss_private.ops_state(singleton boolean primary key default true check(singleton), started_at timestamptz not null default now(), observed_at timestamptz, snapshot jsonb not null default '{}');
insert into ss_private.ops_state(singleton) values(true);
create table ss_private.ops_incidents(id uuid primary key default gen_random_uuid(),code text not null check(code ~ '^[a-z_]{1,64}$'),summary text not null check(length(summary)<=500),severity text not null check(severity in('warning','critical')),first_seen timestamptz not null default now(),last_seen timestamptz not null default now(),resolved_at timestamptz);
create unique index ops_incident_open on ss_private.ops_incidents(code) where resolved_at is null;
create table ss_private.ops_events(id uuid primary key default gen_random_uuid(),incident_id uuid not null references ss_private.ops_incidents(id) on delete cascade,phase text not null check(phase in('open','recovery')),payload jsonb not null,status text not null default 'pending' check(status in('pending','running','sent','needs_attention','suppressed')),available_at timestamptz not null default now(),locked_at timestamptz,lease_id uuid,failures integer not null default 0,provider_message_id text,created_at timestamptz not null default now(),delivered_at timestamptz,unique(incident_id,phase));
create index ops_events_due on ss_private.ops_events(status,available_at);
create table ss_private.ops_recoveries(id bigint generated always as identity primary key,kind text not null,affected integer not null,created_at timestamptz not null default now());
create table ss_private.ops_archived_jobs(id uuid primary key,kind text not null,source_id text,created_at timestamptz not null,resolved_at timestamptz not null default now(),resolution text not null);
alter table ss_private.ops_state enable row level security;
alter table ss_private.ops_incidents enable row level security;
alter table ss_private.ops_events enable row level security;
alter table ss_private.ops_recoveries enable row level security;
alter table ss_private.ops_archived_jobs enable row level security;
revoke all on ss_private.ops_state,ss_private.ops_incidents,ss_private.ops_events,ss_private.ops_recoveries,ss_private.ops_archived_jobs from public,anon,authenticated,service_role;

create function public.ss_platform_context(item_limit integer default 7) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('checked_at',now(),'monitor_checked_at',(select observed_at from ss_private.ops_state where singleton),
 'releases',coalesce((select jsonb_agg(x order by x.discovered_at desc,x.id) from (
 select a.id,left(coalesce(a.reference_meta->'review_snapshot'->>'title',a.title),500) title,a.discovered_at,a.published_at,a.reference_meta->'evaluation'->>'evaluated_at' evaluated_at,c.app_origin||'/?article='||a.id::text ui_url
 from public.ss_articles a cross join public.ss_settings p cross join ss_private.whatsapp_configuration c
 where p.key='profile' and c.singleton and a.deleted_at is null and (a.kind='Release' or a.reference_meta->>'alert_kind'='release')
 and a.id in(select ss_private.current_release_ids(p.value)) and ss_private.reviewed_article(a.reference_meta,coalesce((p.value->>'min_score')::int,55))
 and ss_private.repo_admitted(a.url,a.reference_meta,p.value) and ss_private.release_channel_allowed(a.url,a.reference_meta)
 order by a.discovered_at desc,a.id limit least(greatest(coalesce(item_limit,7),1),10))x),'[]'::jsonb));
$$;
revoke all on function public.ss_platform_context(integer) from public,anon,authenticated;
grant execute on function public.ss_platform_context(integer) to service_role;

-- Retry only obsolete schema failures after a newer successful provider request.
-- Request/reservation ledgers and completed reviews are never reset or replayed.
create function public.ss_ops_reconcile() returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer; archived integer; success_at timestamptz;
begin
 perform pg_advisory_xact_lock(882230);
 select nullif(value->>'last_success','')::timestamptz into success_at from public.ss_settings where key='evaluation_health';
 update public.ss_articles set reference_meta=reference_meta||jsonb_build_object('evaluation_retry_at',now(),'evaluation_recovered_at',now(),'evaluation_recovery_reason','provider_configuration_repaired')
 where deleted_at is null and reference_meta->>'evaluation' is null and reference_meta->>'evaluation_error_kind'='configuration'
 and reference_meta->>'evaluation_error' in('Gemini HTTP 400 (invalid_request)','Gemini HTTP 400 (response_format)')
 and (reference_meta->>'evaluation_failed_at')::timestamptz<success_at
 and (reference_meta->>'evaluation_recovered_at' is null or (reference_meta->>'evaluation_recovered_at')::timestamptz<(reference_meta->>'evaluation_failed_at')::timestamptz);
 get diagnostics n=row_count;
 with obsolete as(delete from public.ss_jobs j using public.ss_sources s where j.kind='source' and j.status='failed' and j.payload->>'source_id'=s.id::text and s.last_success_at>j.created_at and s.last_error is null returning j.*)
 insert into ss_private.ops_archived_jobs(id,kind,source_id,created_at,resolution) select id,kind,payload->>'source_id',created_at,'Superseded by a successful source scan' from obsolete on conflict do nothing;
 get diagnostics archived=row_count;
 if n>0 then insert into ss_private.ops_recoveries(kind,affected) values('obsolete_evaluation_configuration',n);end if;
 if archived>0 then insert into ss_private.ops_recoveries(kind,affected) values('superseded_source_failure',archived);end if;
 return jsonb_build_object('reviews_requeued',n,'failed_jobs_archived',archived);
end;$$;
revoke all on function public.ss_ops_reconcile() from public,anon,authenticated;
grant execute on function public.ss_ops_reconcile() to service_role;

create function public.ss_ops_snapshot() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('checked_at',now(),'monitor_started_at',(select started_at from ss_private.ops_state where singleton),
 'evaluation',coalesce((select value-'comparisons' from public.ss_settings where key='evaluation_health'),'{}'),
 'discovery',coalesce((select value from public.ss_settings where key='discovery_health'),'{}'),
 'web_discovery',coalesce((select value from public.ss_settings where key='web_discovery_health'),'{}'),
 'profile',(select value-'interests'-'repo_queries'-'queries' from public.ss_settings where key='profile'),
 'sources',(select jsonb_build_object('active',count(*) filter(where active),'overdue',count(*) filter(where active and next_check_at<now()-interval '30 minutes' and (retry_at is null or retry_at<now()-interval '30 minutes')),'errors',count(*)filter(where active and last_error_kind='error'),'last_success',max(last_success_at)) from public.ss_sources),
 'jobs',(select jsonb_build_object('pending',count(*)filter(where status='pending'),'failed',count(*)filter(where status='failed'),'stuck',count(*)filter(where (status='running' and locked_at<now()-interval '10 minutes') or(status='pending' and available_at<now()-interval '30 minutes')),'oldest_due',min(available_at) filter(where status='pending')) from public.ss_jobs),
 'reviews',(select jsonb_build_object('overdue',count(*)filter(where discovered_at<now()-interval '25 hours'),'pending',count(*),'awaiting_input',count(*)filter(where reference_meta->>'public_evaluation_input' is null),'due_retry',count(*)filter(where (reference_meta->>'evaluation_retry_at')::timestamptz<=now())) from public.ss_articles a cross join public.ss_settings p where p.key='profile' and a.deleted_at is null and a.reference_meta->>'evaluation' is null and ss_private.gemini_new_link(a.url) and ss_private.repo_admitted(a.url,a.reference_meta,p.value)),
 'notifications',(select jsonb_build_object('enabled',c.enabled,'active_from',c.active_from,'sent',(select count(*) from ss_private.whatsapp_outbox where status='sent'),'pending',(select count(*) from ss_private.whatsapp_outbox where status in('pending','running')),'uncertain',(select count(*) from ss_private.whatsapp_outbox where status='needs_attention'),'stuck',(select count(*) from ss_private.whatsapp_outbox where status in('pending','running') and created_at<now()-interval '15 minutes'),'admission_gaps',(select count(*) from public.ss_articles a cross join public.ss_settings p cross join ss_private.ops_state o where p.key='profile' and o.singleton and a.deleted_at is null and a.discovered_at>=greatest(c.active_from,o.started_at) and (a.reference_meta->'evaluation'->>'evaluated_at')::timestamptz>=greatest(c.active_from,o.started_at) and (a.reference_meta->'evaluation'->>'evaluated_at')::timestamptz<now()-interval '2 minutes' and ss_private.reviewed_article(a.reference_meta,coalesce((p.value->>'min_score')::int,55)) and ss_private.repo_admitted(a.url,a.reference_meta,p.value) and ss_private.release_channel_allowed(a.url,a.reference_meta) and not exists(select 1 from ss_private.whatsapp_outbox w where w.article_id=a.id))) from ss_private.whatsapp_configuration c where c.singleton));
$$;
revoke all on function public.ss_ops_snapshot() from public,anon,authenticated;
grant execute on function public.ss_ops_snapshot() to service_role;

-- Trusted server supplies fixed, public-safe incident codes and summaries.
create function public.ss_ops_observe(observation jsonb,conditions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; incident ss_private.ops_incidents; codes text[]:='{}'; c ss_private.whatsapp_configuration;
begin
 if jsonb_typeof(observation)<>'object' or octet_length(observation::text)>64000 or jsonb_typeof(conditions)<>'array' or jsonb_array_length(conditions)>30 then raise exception 'Invalid observation';end if;
 perform pg_advisory_xact_lock(882231);
 select * into c from ss_private.whatsapp_configuration where singleton;
 update ss_private.ops_state set snapshot=observation,observed_at=now() where singleton;
 for item in select value from jsonb_array_elements(conditions) loop
  if item->>'code' !~ '^[a-z_]{1,64}$' or item->>'severity' not in('warning','critical') or length(coalesce(item->>'summary','')) not between 1 and 500 then raise exception 'Invalid condition';end if;
  codes:=array_append(codes,item->>'code');
  insert into ss_private.ops_incidents(code,summary,severity) values(item->>'code',item->>'summary',item->>'severity') on conflict(code) where resolved_at is null do update set last_seen=now(),summary=excluded.summary,severity=excluded.severity;
 end loop;
 for incident in select * from ss_private.ops_incidents where resolved_at is null and not(code=any(codes)) for update loop
  update ss_private.ops_incidents set resolved_at=now() where id=incident.id;
  if exists(select 1 from ss_private.ops_events where incident_id=incident.id and phase='open') then
   insert into ss_private.ops_events(incident_id,phase,payload) values(incident.id,'recovery',jsonb_build_object('version',1,'kind','platform_incident','code',incident.code,'phase','recovery','summary',incident.summary,'observed_at',now(),'ui_url',c.app_origin||'/?view=admin')) on conflict do nothing;
  end if;
 end loop;
 if c.enabled then
  insert into ss_private.ops_events(incident_id,phase,payload)
   select id,'open',jsonb_build_object('version',1,'kind','platform_incident','code',code,'phase','open','summary',summary,'observed_at',first_seen,'ui_url',c.app_origin||'/?view=admin') from ss_private.ops_incidents where resolved_at is null and first_seen<now()-interval '5 minutes' on conflict do nothing;
 end if;
 -- Keep bounded operational detail, never user messages or private notes.
 delete from ss_private.ops_incidents where resolved_at<now()-interval '30 days' and not exists(select 1 from ss_private.ops_events e where e.incident_id=ops_incidents.id and e.status in('running','pending','needs_attention'));
 return jsonb_build_object('open_incidents',(select count(*) from ss_private.ops_incidents where resolved_at is null));
end;$$;
revoke all on function public.ss_ops_observe(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ss_ops_observe(jsonb,jsonb) to service_role;

create function public.ss_ops_claim_events(batch_size integer default 5) returns setof ss_private.ops_events language plpgsql security definer set search_path='' as $$
begin
 if not coalesce((select enabled from ss_private.whatsapp_configuration where singleton),false) then return;end if;
 return query update ss_private.ops_events set status='running',locked_at=now(),lease_id=gen_random_uuid() where id in(select e.id from ss_private.ops_events e where ((e.status='pending' and e.available_at<=now()) or(e.status='running' and e.locked_at<now()-interval '5 minutes')) and(e.phase='open' or exists(select 1 from ss_private.ops_events o where o.incident_id=e.incident_id and o.phase='open' and o.status='sent')) order by e.created_at,e.id for update skip locked limit least(greatest(coalesce(batch_size,5),1),5)) returning *;
end;$$;
create function public.ss_ops_finish_event(event_id uuid,expected_lease uuid,outcome text,message_id text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if outcome not in('queued','retry','sent','uncertain') or(outcome='sent' and length(coalesce(message_id,'')) not between 1 and 256) then raise exception 'Invalid receipt';end if;
 update ss_private.ops_events set status=case when outcome='sent' then 'sent' when outcome='uncertain' then 'needs_attention' else 'pending' end,available_at=now()+make_interval(secs=>case when outcome='retry' then least(3600,60*power(2,least(failures,6))::int) else 60 end),failures=failures+case when outcome='retry' then 1 else 0 end,lease_id=null,locked_at=null,provider_message_id=case when outcome='sent' then message_id else provider_message_id end,delivered_at=case when outcome='sent' then now() else delivered_at end,payload=case when outcome='sent' then '{}'::jsonb else payload end where id=event_id and status='running' and lease_id=expected_lease;
 get diagnostics n=row_count;return n=1;
end;$$;
revoke all on function public.ss_ops_claim_events(integer),public.ss_ops_finish_event(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ss_ops_claim_events(integer),public.ss_ops_finish_event(uuid,uuid,text,text) to service_role;

create function public.ss_admin_dashboard(window_days integer default 14) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare days integer:=least(greatest(coalesce(window_days,14),7),30); result jsonb;
begin
 if not ss_private.member_ok() or ss_private.role()<>'admin' then raise exception 'Administrator required' using errcode='42501';end if;
 select jsonb_build_object('checked_at',now(),'window_days',days,'observation',(select jsonb_build_object('observed_at',observed_at,'snapshot',snapshot) from ss_private.ops_state where singleton),
 'totals',jsonb_build_object('retained_links',(select count(*) from public.ss_articles where deleted_at is null),'discoveries_24h',(select count(*) from public.ss_articles where deleted_at is null and discovered_at>now()-interval '1 day'),'reviewed_links',(select count(*) from public.ss_articles where deleted_at is null and reference_meta->>'evaluation' is not null),'active_sources',(select count(*) from public.ss_sources where active),'members',(select count(*) from public.ss_members),'active_members',(select count(*) from public.ss_members where active),'whatsapp_registered',(select count(*) from public.ss_members where active and whatsapp_registration='registered'),'reads',(select count(*) from public.ss_feedback where read),'bookmarks',(select count(*) from public.ss_bookmarks),'database_bytes',pg_database_size(current_database())),
 'trends',(select jsonb_agg(jsonb_build_object('day',d::date,'discovered',(select count(*) from public.ss_articles where deleted_at is null and discovered_at>=d and discovered_at<d+interval '1 day'),'reviewed',(select count(distinct article_id) from ss_private.article_reviews where reviewed_at>=d and reviewed_at<d+interval '1 day'),'activity',(select count(*) from public.ss_audit where created_at>=d and created_at<d+interval '1 day')) order by d) from generate_series(date_trunc('day',now())-make_interval(days=>days-1),date_trunc('day',now()),interval '1 day')d),
 'topics',(select coalesce(jsonb_agg(x),'[]') from(select topic,count(*) n from public.ss_articles where deleted_at is null group by topic order by n desc limit 12)x),
 'users',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'username',m.username,'display_name',m.display_name,'role',m.role,'active',m.active,'joined_at',m.created_at,'whatsapp_registration',m.whatsapp_registration,'last_activity',(select max(created_at) from public.ss_audit where user_id=m.id),'recorded_actions',(select count(*) from public.ss_audit where user_id=m.id and created_at>now()-make_interval(days=>days)),'reads',(select count(*) from public.ss_feedback where user_id=m.id and read),'saved',(select count(*) from public.ss_bookmarks where created_by=m.id)) order by m.created_at),'[]') from public.ss_members m),
 'incidents',(select coalesce(jsonb_agg(x),'[]') from(select id,code,summary,severity,first_seen,last_seen,resolved_at from ss_private.ops_incidents order by (resolved_at is null) desc,first_seen desc limit 50)x),
 'health_deliveries',(select coalesce(jsonb_object_agg(status,n),'{}') from(select status,count(*) n from ss_private.ops_events group by status)x),
 'recoveries',(select coalesce(jsonb_agg(x),'[]') from(select kind,affected,created_at from ss_private.ops_recoveries order by id desc limit 20)x)) into result;
 return result;
end;$$;
revoke all on function public.ss_admin_dashboard(integer) from public,anon,service_role;
grant execute on function public.ss_admin_dashboard(integer) to authenticated;
