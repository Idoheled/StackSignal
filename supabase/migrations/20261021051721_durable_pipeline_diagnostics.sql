-- Bounded private diagnostics: identifiers, fixed codes and measurements only.
-- No URLs, titles, request bodies, credentials, phone numbers or chat content.
create table ss_private.ops_metrics (
 bucket timestamptz primary key, observed_at timestamptz not null, measurements jsonb not null
);
create table ss_private.ops_runs (
 id uuid primary key, stage text not null check(stage in('collection','evaluation','internal_review')),
 status text not null default 'running' check(status in('running','succeeded','failed','abandoned')),
 started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
 duration_ms bigint, processed integer not null default 0
);
create index ops_runs_recent on ss_private.ops_runs(started_at desc);
create table ss_private.ops_trace_events (
 id bigint generated always as identity primary key, occurred_at timestamptz not null default clock_timestamp(),
 stage text not null, entity_id text not null, job_id uuid, article_id uuid, source_id uuid,
 phase text not null, attempt integer not null default 0, error_code text, duration_ms bigint
);
create index ops_trace_recent on ss_private.ops_trace_events(occurred_at desc);
create index ops_trace_entity on ss_private.ops_trace_events(entity_id,occurred_at);
create index ops_trace_article on ss_private.ops_trace_events(article_id,occurred_at) where article_id is not null;
alter table ss_private.ops_metrics enable row level security;
alter table ss_private.ops_runs enable row level security;
alter table ss_private.ops_trace_events enable row level security;
revoke all on ss_private.ops_metrics,ss_private.ops_runs,ss_private.ops_trace_events from public,anon,authenticated,service_role;
alter table ss_private.ops_incidents add column opening_summary text, add column opening_evidence jsonb,
 add column latest_evidence jsonb, add column recovery_summary text, add column recovery_evidence jsonb;
alter table ss_private.ops_state add column diagnostics_started_at timestamptz not null default now();

create function ss_private.ops_error_code(message text) returns text language sql immutable set search_path='' as $$
 select case when message is null or message='' then null
 when message like '%Source exceeds size limit%' then 'source_size_limit'
 when message ~* 'HTTP 404' then 'source_not_found'
 when message ~* 'HTTP 5[0-9][0-9]' then 'upstream_unavailable'
 when message ~* 'rate limit|budget|ceiling' then 'rate_limit_wait'
 when message ~* 'timeout|timed out' then 'upstream_timeout'
 when message ~* 'DNS|address rejected|redirect' then 'source_address_error'
 when message ~* 'RSS|Atom|Invalid.*(feed|release)' then 'source_format_error'
 when message ~* 'uncertain' then 'delivery_uncertain'
 when message ~* 'Webhook unavailable' then 'webhook_unavailable'
 else 'operation_failed' end;
$$;
revoke all on function ss_private.ops_error_code(text) from public,anon,authenticated,service_role;

create function ss_private.ops_trace_job() returns trigger language plpgsql security definer set search_path='' as $$
declare j public.ss_jobs; sid text; aid uuid;
begin
 j:=case when tg_op='DELETE' then old else new end;
 if tg_op='UPDATE' and old.status=new.status and old.attempts=new.attempts and old.last_error is not distinct from new.last_error then return null;end if;
 sid:=coalesce(j.payload->>'source_id',j.payload->'reference_meta'->>'source_id');
 select id into aid from public.ss_articles where url=j.payload->>'url' and deleted_at is null limit 1;
 insert into ss_private.ops_trace_events(stage,entity_id,job_id,article_id,source_id,phase,attempt,error_code,duration_ms)
 values(case when j.kind in('source','discovery') then 'discovery' else 'collection' end,j.id,j.id,aid,
 case when sid ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then sid::uuid end,
 case when tg_op='INSERT' then 'queued' when tg_op='DELETE' then case when j.status='running' then 'completed' else 'removed' end else j.status end,
 j.attempts,ss_private.ops_error_code(j.last_error),
 case when j.locked_at is not null and (tg_op='DELETE' or j.status<>'running') then greatest(0,extract(epoch from(clock_timestamp()-j.locked_at))*1000)::bigint end);
 return null;
end;$$;
create trigger ss_ops_trace_job after insert or update or delete on public.ss_jobs for each row execute function ss_private.ops_trace_job();

create function ss_private.ops_trace_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.last_success_at is not distinct from new.last_success_at and old.last_error is not distinct from new.last_error then return null;end if;
 insert into ss_private.ops_trace_events(stage,entity_id,source_id,phase,error_code)
 values('discovery',new.id,new.id,case when new.last_error is null then 'succeeded' when new.last_error_kind='deferred' then 'waiting' else 'failed' end,ss_private.ops_error_code(new.last_error));
 return null;
end;$$;
create trigger ss_ops_trace_source after update on public.ss_sources for each row execute function ss_private.ops_trace_source();

create function ss_private.ops_trace_delivery() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.status=new.status and old.failures=new.failures then return null;end if;
 insert into ss_private.ops_trace_events(stage,entity_id,article_id,phase,attempt,error_code,duration_ms)
 values('notification',new.id,new.article_id,new.status,new.failures,ss_private.ops_error_code(new.last_error),
 case when new.delivered_at is not null then greatest(0,extract(epoch from(new.delivered_at-new.created_at))*1000)::bigint end);
 return null;
end;$$;
create trigger ss_ops_trace_delivery after insert or update on ss_private.whatsapp_outbox for each row execute function ss_private.ops_trace_delivery();

create function ss_private.ops_trace_review() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into ss_private.ops_trace_events(stage,entity_id,article_id,phase) values('evaluation',new.article_id,new.article_id,'reviewed');return null;
end;$$;
create trigger ss_ops_trace_review after insert on ss_private.article_reviews for each row execute function ss_private.ops_trace_review();
revoke all on function ss_private.ops_trace_job(),ss_private.ops_trace_source(),ss_private.ops_trace_delivery(),ss_private.ops_trace_review() from public,anon,authenticated,service_role;

create function ss_private.ops_trace_request() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.outcome is not distinct from new.outcome and old.finished_at is not distinct from new.finished_at then return null;end if;
 insert into ss_private.ops_trace_events(stage,entity_id,phase,error_code,duration_ms)
 values('evaluation',new.id::text,coalesce(new.outcome,'reserved'),ss_private.ops_error_code(new.error),
 case when new.finished_at is not null then greatest(0,extract(epoch from(new.finished_at-new.attempted_at))*1000)::bigint end);return null;
end;$$;
create trigger ss_ops_trace_request after insert or update on ss_private.evaluation_requests for each row execute function ss_private.ops_trace_request();
revoke all on function ss_private.ops_trace_request() from public,anon,authenticated,service_role;

create function public.ss_ops_run_start(run_id uuid,stage_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if stage_name is null or stage_name not in('collection','evaluation','internal_review') then raise exception 'Invalid stage';end if;
 insert into ss_private.ops_runs(id,stage) values(run_id,stage_name) on conflict(id) do nothing;
end;$$;
create function public.ss_ops_run_finish(run_id uuid,outcome text,processed integer default 0) returns void language plpgsql security definer set search_path='' as $$
begin
 if outcome is null or outcome not in('succeeded','failed') or processed is null or processed not between 0 and 10000 then raise exception 'Invalid run result';end if;
 update ss_private.ops_runs set status=outcome,finished_at=clock_timestamp(),duration_ms=greatest(0,extract(epoch from(clock_timestamp()-started_at))*1000)::bigint,processed=ss_ops_run_finish.processed where id=run_id and status='running';
end;$$;
revoke all on function public.ss_ops_run_start(uuid,text),public.ss_ops_run_finish(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.ss_ops_run_start(uuid,text),public.ss_ops_run_finish(uuid,text,integer) to service_role;

-- Select explicit diagnostic fields: never persist the whole service snapshot.
create function ss_private.ops_measure(s jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('jobs',s->'jobs','sources',s->'sources','reviews',s->'reviews','notifications',s->'notifications',
 'evaluation',jsonb_build_object('state',s->'evaluation'->'state','usage',s->'evaluation'->'usage','pipeline',s->'evaluation'->'pipeline'),
 'bot',jsonb_build_object('connected',s->'bot'->'connected','questions',s->'bot'->'questions','deliveries',s->'bot'->'deliveries'),
 'stages',coalesce(s->'stages','[]'),'diagnostics',s->'diagnostics');
$$;
revoke all on function ss_private.ops_measure(jsonb) from public,anon,authenticated,service_role;
create or replace function public.ss_claim_jobs(batch_size int default 3) returns setof public.ss_jobs language sql security definer set search_path='' as $$
 with ranked as (select j.id,row_number() over(partition by kind order by
  case when j.created_at<now()-interval '24 hours' then 0
   when j.kind='analyze' and j.payload->'reference_meta'->>'alert_kind'='release' and exists(select 1 from public.ss_sources s where s.id::text=j.payload->'reference_meta'->>'source_id' and s.active and s.priority='core') then 1 else 2 end,
  case when j.kind='analyze' and j.payload->'reference_meta'->>'alert_kind'='release' then j.payload->>'published_at' else null end desc nulls last,
  available_at,created_at,j.id) as turn from public.ss_jobs j where ((status='pending' and available_at<=now()) or(status='running' and locked_at<now()-interval '5 minutes')) and attempts<4),
 picked as(select j.id from public.ss_jobs j join ranked r on r.id=j.id order by r.turn,j.available_at,j.id for update of j skip locked limit least(greatest(batch_size,1),32))
 update public.ss_jobs set status='running',locked_at=now(),attempts=attempts+1 where id in(select id from picked) returning *;
$$;

create or replace function public.ss_ops_snapshot() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('checked_at',now(),
 'diagnostics_started_at',(select diagnostics_started_at from ss_private.ops_state where singleton),
 'diagnostics',jsonb_build_object(
 'source_errors',(select coalesce(jsonb_agg(jsonb_build_object('source_id',id,'error_code',ss_private.ops_error_code(last_error),'last_success_at',last_success_at)),'[]') from(select * from public.ss_sources where active and last_error_kind='error' order by next_check_at limit 10)x),
 'failed_jobs',(select coalesce(jsonb_agg(jsonb_build_object('job_id',id,'kind',kind,'attempts',attempts,'error_code',ss_private.ops_error_code(last_error),'created_at',created_at)),'[]') from(select * from public.ss_jobs where status='failed' order by created_at limit 10)x)),
 'runs',(select coalesce(jsonb_agg(x),'[]') from(select stage,max(started_at) last_started,max(finished_at) filter(where status='succeeded') last_success,count(*) filter(where status='running' and started_at<now()-interval '10 minutes') stuck from ss_private.ops_runs where started_at>now()-interval '1 day' group by stage)x),'monitor_started_at',(select started_at from ss_private.ops_state where singleton),
 'evaluation',coalesce((select value-'comparisons' from public.ss_settings where key='evaluation_health'),'{}'),
 'discovery',coalesce((select value from public.ss_settings where key='discovery_health'),'{}'),
 'web_discovery',coalesce((select value from public.ss_settings where key='web_discovery_health'),'{}'),
 'profile',(select value-'interests'-'repo_queries'-'queries' from public.ss_settings where key='profile'),
 'sources',(select jsonb_build_object('active',count(*) filter(where active),'overdue',count(*) filter(where active and next_check_at<now()-interval '30 minutes' and (retry_at is null or retry_at<now()-interval '30 minutes')),'errors',count(*)filter(where active and last_error_kind='error'),'last_success',max(last_success_at)) from public.ss_sources),
 'jobs',(select jsonb_build_object('pending',count(*)filter(where status='pending'),'failed',count(*)filter(where status='failed'),'stuck',count(*)filter(where (status='running' and locked_at<now()-interval '10 minutes') or(status='pending' and available_at<now()-interval '30 minutes')),'oldest_due',min(available_at) filter(where status='pending')) from public.ss_jobs),
 'reviews',(select jsonb_build_object('overdue',count(*)filter(where discovered_at<now()-interval '25 hours'),'pending',count(*),'awaiting_input',count(*)filter(where reference_meta->>'public_evaluation_input' is null),'due_retry',count(*)filter(where (reference_meta->>'evaluation_retry_at')::timestamptz<=now())) from public.ss_articles a cross join public.ss_settings p where p.key='profile' and a.deleted_at is null and a.reference_meta->>'evaluation' is null and ss_private.gemini_new_link(a.url) and ss_private.repo_admitted(a.url,a.reference_meta,p.value)),
 'notifications',(select jsonb_build_object('enabled',c.enabled,'active_from',c.active_from,'sent',(select count(*) from ss_private.whatsapp_outbox where status='sent'),'pending',(select count(*) from ss_private.whatsapp_outbox where status in('pending','running')),'uncertain',(select count(*) from ss_private.whatsapp_outbox where status='needs_attention'),'stuck',(select count(*) from ss_private.whatsapp_outbox where status in('pending','running') and created_at<now()-interval '15 minutes'),'admission_gaps',(select count(*) from public.ss_articles a cross join public.ss_settings p cross join ss_private.ops_state o where p.key='profile' and o.singleton and a.deleted_at is null and a.discovered_at>=c.active_from and (a.reference_meta->'evaluation'->>'evaluated_at')::timestamptz>=greatest(c.active_from,o.started_at) and (a.reference_meta->'evaluation'->>'evaluated_at')::timestamptz<now()-interval '2 minutes' and ss_private.reviewed_article(a.reference_meta,coalesce((p.value->>'min_score')::int,55)) and ss_private.repo_admitted(a.url,a.reference_meta,p.value) and ss_private.release_channel_allowed(a.url,a.reference_meta) and not exists(select 1 from ss_private.whatsapp_outbox w where w.article_id=a.id))) from ss_private.whatsapp_configuration c where c.singleton));
$$;

create or replace function public.ss_ops_observe(observation jsonb,conditions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; incident ss_private.ops_incidents; codes text[]:='{}'; c ss_private.whatsapp_configuration; evidence jsonb; recovery text; measured_bucket timestamptz;
begin
 if jsonb_typeof(observation)<>'object' or octet_length(observation::text)>64000 or jsonb_typeof(conditions)<>'array' or jsonb_array_length(conditions)>30 then raise exception 'Invalid observation';end if;
 perform pg_advisory_xact_lock(882231);
 select * into c from ss_private.whatsapp_configuration where singleton;
 evidence:=ss_private.ops_measure(observation);
 measured_bucket:=date_trunc('hour',now())+make_interval(mins=>(extract(minute from now())::int/5)*5);
 insert into ss_private.ops_metrics(bucket,observed_at,measurements) values(measured_bucket,now(),evidence)
 on conflict(bucket) do update set observed_at=excluded.observed_at,measurements=excluded.measurements;
 update ss_private.ops_runs set status='abandoned',finished_at=now(),duration_ms=extract(epoch from(now()-started_at))*1000 where status='running' and started_at<now()-interval '10 minutes';
 if public.ss_take_budget('ops-retention:'||to_char(now(),'YYYY-MM-DD-HH24'),1,3600) then
  delete from ss_private.ops_metrics where bucket<now()-interval '30 days';
  delete from ss_private.ops_trace_events where occurred_at<now()-interval '14 days' or id<(select max(id)-100000 from ss_private.ops_trace_events);
  delete from ss_private.ops_runs where started_at<now()-interval '30 days' or id in(select id from ss_private.ops_runs order by started_at desc offset 20000);
 end if;
 update ss_private.ops_state set snapshot=observation,observed_at=now() where singleton;
 for item in select value from jsonb_array_elements(conditions) loop
  if item->>'code' !~ '^[a-z_]{1,64}$' or item->>'severity' not in('warning','critical') or length(coalesce(item->>'summary','')) not between 1 and 500 then raise exception 'Invalid condition';end if;
  codes:=array_append(codes,item->>'code');
  insert into ss_private.ops_incidents(code,summary,severity,opening_summary,opening_evidence,latest_evidence) values(item->>'code',item->>'summary',item->>'severity',item->>'summary',evidence,evidence) on conflict(code) where resolved_at is null do update set last_seen=now(),summary=excluded.summary,severity=excluded.severity,latest_evidence=excluded.latest_evidence;
 end loop;
 for incident in select * from ss_private.ops_incidents where resolved_at is null and not(code=any(codes)) for update loop
  select left('Current status: '||coalesce(x->>'label','Stage')||' — '||coalesce(x->>'detail','Condition cleared.'),500) into recovery
   from jsonb_array_elements(coalesce(observation->'stages','[]')) x
   where x->>'key'=regexp_replace(incident.code,'_degraded$','') and x->>'status' in('healthy','waiting') limit 1;
  recovery:=coalesce(recovery,'Condition cleared in the current monitor observation.');
  update ss_private.ops_incidents set resolved_at=now(),recovery_summary=recovery,recovery_evidence=evidence where id=incident.id;
  if exists(select 1 from ss_private.ops_events where incident_id=incident.id and phase='open') then
   insert into ss_private.ops_events(incident_id,phase,payload) values(incident.id,'recovery',jsonb_build_object('version',1,'kind','platform_incident','code',regexp_replace(incident.code,'_degraded$','_recovered'),'phase','recovery','summary',recovery,'observed_at',now(),'ui_url',c.app_origin||'/?view=admin')) on conflict do nothing;
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

create or replace function public.ss_admin_dashboard(window_days integer default 14) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare days integer:=least(greatest(coalesce(window_days,14),7),30); result jsonb;
begin
 if not ss_private.member_ok() or ss_private.role()<>'admin' then raise exception 'Administrator required' using errcode='42501';end if;
 select jsonb_build_object('checked_at',now(),'window_days',days,'observation',(select jsonb_build_object('observed_at',observed_at,'snapshot',snapshot) from ss_private.ops_state where singleton),
 'totals',jsonb_build_object('retained_links',(select count(*) from public.ss_articles where deleted_at is null),'discoveries_24h',(select count(*) from public.ss_articles where deleted_at is null and discovered_at>now()-interval '1 day'),'reviewed_links',(select count(*) from public.ss_articles where deleted_at is null and reference_meta->>'evaluation' is not null),'active_sources',(select count(*) from public.ss_sources where active),'members',(select count(*) from public.ss_members),'active_members',(select count(*) from public.ss_members where active),'whatsapp_registered',(select count(*) from public.ss_members where active and whatsapp_registration='registered'),'reads',(select count(*) from public.ss_feedback where read),'bookmarks',(select count(*) from public.ss_bookmarks),'database_bytes',pg_database_size(current_database())),
 'trends',(select jsonb_agg(jsonb_build_object('day',d::date,'discovered',(select count(*) from public.ss_articles where deleted_at is null and discovered_at>=d and discovered_at<d+interval '1 day'),'reviewed',(select count(distinct article_id) from ss_private.article_reviews where reviewed_at>=d and reviewed_at<d+interval '1 day'),'activity',(select count(*) from public.ss_audit where created_at>=d and created_at<d+interval '1 day')) order by d) from generate_series(date_trunc('day',now())-make_interval(days=>days-1),date_trunc('day',now()),interval '1 day')d),
 'topics',(select coalesce(jsonb_agg(x),'[]') from(select topic,count(*) n from public.ss_articles where deleted_at is null group by topic order by n desc limit 12)x),
 'users',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'username',m.username,'display_name',m.display_name,'role',m.role,'active',m.active,'joined_at',m.created_at,'whatsapp_registration',m.whatsapp_registration,'last_activity',(select max(created_at) from public.ss_audit where user_id=m.id),'recorded_actions',(select count(*) from public.ss_audit where user_id=m.id and created_at>now()-make_interval(days=>days)),'reads',(select count(*) from public.ss_feedback where user_id=m.id and read),'saved',(select count(*) from public.ss_bookmarks where created_by=m.id)) order by m.created_at),'[]') from public.ss_members m),
 'incidents',(select coalesce(jsonb_agg(x),'[]') from(select id,code,summary,severity,first_seen,last_seen,resolved_at,opening_summary,recovery_summary from ss_private.ops_incidents order by (resolved_at is null) desc,first_seen desc limit 50)x),
 'diagnostics',jsonb_build_object(
 'retention',jsonb_build_object('metrics_days',30,'traces_days',14,'trace_limit',100000,'runs_days',30),
 'started_at',(select min(bucket) from ss_private.ops_metrics),
 'timeline',(select coalesce(jsonb_agg(x order by x.at),'[]') from(select h at,
 max((measurements->'jobs'->>'pending')::int) pending_peak,max((measurements->'jobs'->>'stuck')::int) overdue_peak,
 max((measurements->'jobs'->>'failed')::int) failed_peak,max((measurements->'reviews'->>'pending')::int) reviews_peak,
 max((measurements->'notifications'->>'pending')::int) delivery_pending_peak,count(bucket) samples
 from generate_series(greatest((select date_trunc('hour',min(bucket)) from ss_private.ops_metrics),date_trunc('hour',now()-make_interval(days=>days))),date_trunc('hour',now()),interval '1 hour') h left join ss_private.ops_metrics on bucket>=h and bucket<h+interval '1 hour' group by h)x),
 'runs',(select coalesce(jsonb_agg(x),'[]') from(select * from ss_private.ops_runs order by started_at desc limit 30)x),
 'events',(select coalesce(jsonb_agg(x),'[]') from(select * from ss_private.ops_trace_events order by occurred_at desc,id desc limit 100)x)),
 'health_deliveries',(select coalesce(jsonb_object_agg(status,n),'{}') from(select status,count(*) n from ss_private.ops_events group by status)x),
 'recoveries',(select coalesce(jsonb_agg(x),'[]') from(select kind,affected,created_at from ss_private.ops_recoveries order by id desc limit 20)x)) into result;
 return result;
end;$$;

-- Cursor pagination keeps historical investigation available beyond the latest cards.
create function public.ss_admin_diagnostics(stage_name text default null,entity text default null,day_utc date default null,before_id bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare since_at timestamptz:=coalesce(day_utc::timestamp at time zone 'UTC',now()-interval '1 day'); result jsonb;
begin
 if not ss_private.member_ok() or ss_private.role()<>'admin' then raise exception 'Administrator required' using errcode='42501';end if;
 if entity is not null and entity !~ '^([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}|[0-9]{1,20})$' then raise exception 'Invalid correlation ID';end if;
 if stage_name is not null and stage_name not in('discovery','collection','evaluation','notification') then raise exception 'Invalid diagnostic stage';end if;
 if since_at<date_trunc('day',now()-interval '14 days') or since_at>now() then raise exception 'Diagnostic date outside retention';end if;
 select jsonb_build_object('checked_at',now(),'since',since_at,
 'events',coalesce(jsonb_agg(x order by x.id desc),'[]'),'next_cursor',case when count(*)=100 then min(x.id)::text end) into result
 from(select * from ss_private.ops_trace_events e where e.occurred_at>=since_at and (day_utc is null or e.occurred_at<since_at+interval '1 day')
 and(stage_name is null or e.stage=stage_name) and(entity is null or entity in(e.entity_id,e.job_id::text,e.article_id::text,e.source_id::text))
 and(before_id is null or e.id<before_id) order by e.id desc limit 100)x;
 return result||jsonb_build_object('runs',(select coalesce(jsonb_agg(x),'[]') from(select * from ss_private.ops_runs where started_at>=since_at and(day_utc is null or started_at<since_at+interval '1 day') and(entity is null or id::text=entity) order by started_at desc limit 30)x));
end;$$;
revoke all on function public.ss_admin_diagnostics(text,text,date,bigint) from public,anon,service_role;
grant execute on function public.ss_admin_diagnostics(text,text,date,bigint) to authenticated;
