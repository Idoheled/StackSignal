-- Request ceilings include failures; changing batch size never resets the ledger.
alter table ss_private.evaluation_claims drop constraint evaluation_claims_attempts_check;
alter table ss_private.evaluation_claims add constraint evaluation_claims_attempts_check check(attempts>=1);
alter table ss_private.evaluation_requests add column if not exists batch_size int not null default 0;
alter table ss_private.evaluation_requests add column if not exists outcome text not null default 'reserved';
alter table ss_private.evaluation_requests add column if not exists reviewed int not null default 0;
alter table ss_private.evaluation_requests add column if not exists error text;
alter table ss_private.evaluation_requests add column if not exists finished_at timestamptz;
-- Current policy is applied at read/reservation time; saved library items are unaffected.
create or replace function ss_private.repo_admitted(link text,meta jsonb,profile jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare h jsonb:=meta->'repo_health';
begin
 if link !~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(/|$)' then return true;end if;
 if lower(split_part(link,'/',4)||'/'||split_part(link,'/',5)) in ('mellanox/nic-configuration-operator','mellanox/network-operator','mellanox/maintenance-operator')
 and meta->>'origin'='source_watch' and exists(select 1 from public.ss_sources s where s.id::text=meta->>'source_id' and s.active and s.type='github'
 and lower(split_part(s.url,'?',1)) like 'https://api.github.com/repos/'||lower(split_part(link,'/',4)||'/'||split_part(link,'/',5))||'/%') then
  return coalesce(h->>'active'='true' and (h->>'checked_at')::timestamptz between now()-interval '7 days' and now() and h->>'license' not in('Unspecified','NOASSERTION','NONE'),false);
 end if;
 return coalesce(h->>'active'='true' and (h->>'checked_at')::timestamptz between now()-interval '7 days' and now()
 and (h->>'stars')::int>=coalesce((profile->>'repo_min_stars')::int,100)
 and (h->>'watchers')::int>=coalesce((profile->>'repo_min_watchers')::int,5)
 and (h->>'recent_releases')::int>=coalesce((profile->>'repo_min_releases')::int,2)
 and (h->>'pushed_at')::timestamptz between now()-make_interval(days=>coalesce((profile->>'repo_active_days')::int,90)) and now()
 and (h->>'latest_release')::timestamptz between now()-make_interval(days=>coalesce((profile->>'repo_release_days')::int,180)) and now()
 and h->>'license' not in('Unspecified','NOASSERTION','NONE'),false);
exception when invalid_text_representation or datetime_field_overflow then return false;
end;$$;
revoke all on function ss_private.repo_admitted(text,jsonb,jsonb) from public,anon,authenticated,service_role;
create or replace function public.ss_reserve_evaluation_batch(items jsonb,daily_max int,monthly_max int)
returns jsonb language plpgsql security definer set search_path='' as $$
declare selected jsonb; request_id bigint; item jsonb; pacific_start timestamptz;
begin
 perform pg_advisory_xact_lock(882225);
 if jsonb_typeof(items) is distinct from 'array' or daily_max is null or monthly_max is null
 or daily_max not between 1 and 16 or monthly_max not between 1 and 496 then return '{}';end if;
 if jsonb_array_length(items) not between 1 and 50 then return '{}';end if;
 pacific_start:=date_trunc('day',now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
 if exists(select 1 from ss_private.evaluation_requests where attempted_at>now()-interval '5 minutes') then return '{}';end if;
 if (select count(*) from ss_private.evaluation_requests where attempted_at>now()-interval '24 hours')>=daily_max
 or (select count(*) from ss_private.evaluation_requests where attempted_at>=pacific_start)>=daily_max
 or (select count(*) from ss_private.evaluation_requests where attempted_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')>=monthly_max then return '{}';end if;
 select jsonb_agg(x order by pos) into selected from (
 select x.value as x,min(x.ordinality) as pos from jsonb_array_elements(items) with ordinality x(value,ordinality)
 join public.ss_articles a on a.id=(x.value->>'id')::uuid
 left join ss_private.evaluation_claims c on c.article_id=a.id and c.cache_key=x.value->>'cache_key'
 where ss_private.gemini_new_link(a.url) and ss_private.repo_admitted(a.url,a.reference_meta,(select value from public.ss_settings where key='profile'))
 and a.deleted_at is null and a.content_hash=x.value->>'content_hash'
 and jsonb_typeof(a.reference_meta->'public_evaluation_input')='object'
 and a.reference_meta->>'evaluation' is null
 and (x.value->>'cache_key') ~ '^[a-f0-9]{64}$'
 and (a.reference_meta->>'evaluation_failed_at' is null or (a.reference_meta->>'evaluation_retry_at')::timestamptz<=now())
 and (c.article_id is null or c.attempted_at<now()-interval '5 minutes')
 group by x.value order by min(x.ordinality) limit 12
 ) eligible;
 if selected is null then return '{}';end if;
 -- Reject ambiguous duplicate article ids even if callers provide different cache keys.
 if (select count(distinct x->>'id') from jsonb_array_elements(selected) x)<>jsonb_array_length(selected) then return '{}';end if;
 insert into ss_private.evaluation_requests(batch_size) values(jsonb_array_length(selected)) returning id into request_id;
 for item in select * from jsonb_array_elements(selected) loop
  insert into ss_private.evaluation_claims(article_id,cache_key,request_id) values((item->>'id')::uuid,item->>'cache_key',request_id)
  on conflict(article_id,cache_key) do update set request_id=excluded.request_id,attempts=evaluation_claims.attempts+1,attempted_at=now();
 end loop;
 return jsonb_build_object('request_id',request_id,'items',selected);
end;$$;
revoke all on function public.ss_reserve_evaluation_batch(jsonb,int,int) from public,anon,authenticated;
grant execute on function public.ss_reserve_evaluation_batch(jsonb,int,int) to service_role;


create or replace function public.ss_evaluation_candidates() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
  select a.id,a.url,a.score,a.content_hash,a.discovered_at,a.reference_meta,a.kind
  from public.ss_articles a where a.deleted_at is null
  and ss_private.gemini_new_link(a.url)
  and jsonb_typeof(a.reference_meta->'public_evaluation_input')='object'
  and a.reference_meta->>'evaluation' is null
  and (a.reference_meta->>'evaluation_failed_at' is null or (a.reference_meta->>'evaluation_retry_at')::timestamptz<=now())
  and ss_private.repo_admitted(a.url,a.reference_meta,(select value from public.ss_settings where key='profile'))
  order by case when a.discovered_at<now()-interval '24 hours' then 0 when a.reference_meta->>'alert_kind'='release' then 1 else 2 end,a.discovered_at,a.id limit 200
 )x;
$$;
revoke all on function public.ss_evaluation_candidates() from public,anon,authenticated;
grant execute on function public.ss_evaluation_candidates() to service_role;

create or replace function public.ss_finish_evaluation_request(request bigint,outcome text,reviewed int,error text default null)
returns void language plpgsql security definer set search_path='' as $$begin
 if outcome not in('success','partial','transient','validation','configuration') or reviewed<0 then raise exception 'Invalid request outcome';end if;
 update ss_private.evaluation_requests r set outcome=ss_finish_evaluation_request.outcome,reviewed=least(ss_finish_evaluation_request.reviewed,r.batch_size),error=left(ss_finish_evaluation_request.error,200),finished_at=now() where r.id=request and r.outcome='reserved';
end;$$;
revoke all on function public.ss_finish_evaluation_request(bigint,text,int,text) from public,anon,authenticated;
grant execute on function public.ss_finish_evaluation_request(bigint,text,int,text) to service_role;

create or replace function public.ss_evaluation_pipeline() returns jsonb language sql stable security definer set search_path='' as $$
 with profile as(select value from public.ss_settings where key='profile'),
 queue as(select a.*,ss_private.repo_admitted(a.url,a.reference_meta,p.value) admitted from public.ss_articles a cross join profile p where a.deleted_at is null and ss_private.gemini_new_link(a.url)),
 requests as(select count(*) filter(where outcome in('success','partial')) successful,count(*) filter(where outcome in('transient','configuration','validation')) unsuccessful,sum(reviewed) reviewed from ss_private.evaluation_requests where attempted_at>now()-interval '24 hours')
 select jsonb_build_object('discovered_24h',count(*) filter(where discovered_at>now()-interval '24 hours'),
 'evaluated_24h',count(*) filter(where (reference_meta->'evaluation'->>'evaluated_at')::timestamptz>now()-interval '24 hours'),
 'eligible_pending',count(*) filter(where reference_meta->>'evaluation' is null and admitted),
 'policy_excluded',count(*) filter(where reference_meta->>'evaluation' is null and not admitted),
 'retrying',count(*) filter(where reference_meta->>'evaluation' is null and reference_meta->>'evaluation_failed_at' is not null and reference_meta->>'evaluation_retry_at' is not null and admitted),
 'needs_attention',count(*) filter(where reference_meta->>'evaluation' is null and reference_meta->>'evaluation_failed_at' is not null and reference_meta->>'evaluation_retry_at' is null and admitted),
 'oldest_pending_at',min(discovered_at) filter(where reference_meta->>'evaluation' is null and admitted),
 'batch_capacity',greatest(1,least(12,coalesce((select (value->>'target_batch_size')::int from public.ss_settings where key='evaluation_health'),12))),
 'daily_request_limit',(select least(16,coalesce((value->>'gemini_daily_limit')::int,0)) from profile),
 'requests_24h',(select to_jsonb(requests) from requests),'checked_at',now()) from queue;
$$;
revoke all on function public.ss_evaluation_pipeline() from public,anon,authenticated;
grant execute on function public.ss_evaluation_pipeline() to service_role;

-- Recover transport failures, including links previously abandoned after three tries.
-- Preserve genuine completed reviews and the request/claim history.
update public.ss_articles set reference_meta=reference_meta||jsonb_build_object('evaluation_error_kind','transient','evaluation_retry_at',now())
 where reference_meta->>'evaluation' is null and reference_meta->>'evaluation_failed_at' is not null
 and (reference_meta->>'evaluation_error' ~* '(HTTP (408|429|5[0-9][0-9])|timeout|timed out|network|fetch failed|connection)');
update public.ss_sources set interval_minutes=60,priority='core',next_check_at=now(),include_prereleases=true
 where type='github' and lower(split_part(url,'?',1)) in ('https://api.github.com/repos/mellanox/nic-configuration-operator/releases','https://api.github.com/repos/mellanox/network-operator/releases','https://api.github.com/repos/mellanox/maintenance-operator/releases');
