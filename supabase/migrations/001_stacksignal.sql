-- StackSignal: run once in the Supabase SQL editor, then run scripts/bootstrap-admin.mjs.
-- Public signups must be disabled in Supabase Auth. Browser clients never receive service credentials.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists ss_private;
revoke all on schema ss_private from public, anon, authenticated;

create table public.ss_members (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check(username ~ '^[a-z][a-z0-9_-]{2,31}$'),
 display_name text not null check(length(display_name) between 1 and 80),
 role text not null check(role in ('admin','maintainer','reader')),
 active boolean not null default true, must_change_password boolean not null default false,
 created_at timestamptz not null default now()
);
create unique index ss_single_owner on public.ss_members(role) where role='admin';
create table public.ss_sessions (session_id uuid primary key,user_id uuid not null references public.ss_members(id) on delete cascade,expires_at timestamptz not null default now()+interval '12 hours',revoked boolean not null default false);
create table public.ss_invites (id uuid primary key default gen_random_uuid(),token_hash text not null unique,label text not null default '',role text not null check(role in('maintainer','reader')),created_by uuid not null references public.ss_members(id),created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '24 hours',used_at timestamptz,revoked boolean not null default false,claim_id uuid,claimed_at timestamptz);
create table public.ss_articles (id uuid primary key default gen_random_uuid(),url text not null unique check(length(url)<=2048 and url ~ '^https://'),title text not null check(length(title) between 1 and 500),source text not null default '',author text,published_at timestamptz,updated_at timestamptz,discovered_at timestamptz not null default now(),kind text not null default 'Article',topic text not null default 'Models & research',tags text[] not null default '{}',summary text not null default '',reason text not null default '',evidence text not null default '',score integer not null default 30 check(score between 0 and 100),analysis_status text not null default 'pending',content_hash text,deleted_at timestamptz);
create index ss_articles_dates on public.ss_articles(published_at desc,discovered_at desc);
create index ss_articles_search on public.ss_articles using gin(to_tsvector('simple',title));
create table public.ss_folders (id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 80),parent_id uuid references public.ss_folders(id),created_by uuid not null references public.ss_members(id),created_at timestamptz not null default now(),deleted_at timestamptz,delete_batch uuid,check(id is distinct from parent_id));
create table public.ss_bookmarks (article_id uuid not null references public.ss_articles(id) on delete cascade,folder_id uuid not null references public.ss_folders(id) on delete cascade,created_by uuid not null references public.ss_members(id),created_at timestamptz not null default now(),primary key(article_id,folder_id));
create table public.ss_feedback (user_id uuid not null references public.ss_members(id) on delete cascade,article_id uuid not null references public.ss_articles(id) on delete cascade,liked boolean not null default false,hidden boolean not null default false,read boolean not null default false,reason text not null default '',updated_at timestamptz not null default now(),primary key(user_id,article_id));
create table public.ss_notes (id uuid primary key default gen_random_uuid(),article_id uuid not null references public.ss_articles(id) on delete cascade,user_id uuid not null references public.ss_members(id),body text not null check(length(body) between 1 and 10000),visibility text not null check(visibility in('private','team')),parent_id uuid references public.ss_notes(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz);
create table public.ss_sources (id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 120),url text not null unique check(url ~ '^https://' and length(url)<=2048),type text not null check(type in('rss','github','page')),topic text not null,active boolean not null default true,interval_minutes integer not null default 240 check(interval_minutes between 30 and 10080),next_check_at timestamptz not null default now(),last_success_at timestamptz,last_error text,etag text,content_hash text,baseline text);
create table public.ss_jobs (id uuid primary key default gen_random_uuid(),kind text not null check(kind in('source','article','analyze','discovery')),payload jsonb not null default '{}',status text not null default 'pending' check(status in('pending','running','done','failed')),attempts integer not null default 0,available_at timestamptz not null default now(),locked_at timestamptz,last_error text,created_at timestamptz not null default now());
create index ss_jobs_due on public.ss_jobs(status,available_at);
create table public.ss_settings (key text primary key,value jsonb not null,updated_at timestamptz not null default now());
create table public.ss_audit (id bigint generated always as identity primary key,user_id uuid,action text not null,object_id text,created_at timestamptz not null default now());
create table public.ss_limits (key text primary key,n integer not null,expires_at timestamptz not null);
insert into public.ss_settings values ('profile','{"priorities":{},"interests":"Bare metal, RoCE, InfiniBand, OpenShift, HyperShift, GPU operators, LLM serving, token quotas and optimization","queries":["LLM inference serving benchmark vLLM SGLang","OpenShift HyperShift GPU operator release","RoCE InfiniBand NCCL performance"],"gemini_daily_limit":20,"search_monthly_limit":800}',now());

-- Bound sessions + current membership are required, including for direct PostgREST access.
create function ss_private.member_ok(require_mfa boolean default true) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ss_members m join public.ss_sessions s on s.user_id=m.id where m.id=auth.uid() and m.active and s.session_id=(auth.jwt()->>'session_id')::uuid and not s.revoked and s.expires_at>now() and (not require_mfa or (not m.must_change_password and (m.role='reader' or auth.jwt()->>'aal'='aal2'))));
$$;
create function ss_private.role() returns text language sql stable security definer set search_path='' as $$ select role from public.ss_members where id=auth.uid() and active $$;
create function ss_private.log(action_name text,object_name text default null) returns void language sql security definer set search_path='' as $$ insert into public.ss_audit(user_id,action,object_id) values(auth.uid(),action_name,object_name) $$;

-- No client table mutations. Mutations go through audited, explicitly authorized RPCs.
alter table public.ss_members enable row level security;
alter table public.ss_sessions enable row level security;
alter table public.ss_invites enable row level security;
alter table public.ss_articles enable row level security;
alter table public.ss_folders enable row level security;
alter table public.ss_bookmarks enable row level security;
alter table public.ss_feedback enable row level security;
alter table public.ss_notes enable row level security;
alter table public.ss_sources enable row level security;
alter table public.ss_jobs enable row level security;
alter table public.ss_settings enable row level security;
alter table public.ss_audit enable row level security;
alter table public.ss_limits enable row level security;
revoke all on public.ss_members,public.ss_sessions,public.ss_invites,public.ss_articles,public.ss_folders,public.ss_bookmarks,public.ss_feedback,public.ss_notes,public.ss_sources,public.ss_jobs,public.ss_settings,public.ss_audit,public.ss_limits from anon,authenticated;
grant select on public.ss_members,public.ss_articles,public.ss_folders,public.ss_bookmarks,public.ss_feedback,public.ss_notes,public.ss_sources to authenticated;
create policy ss_self_profile on public.ss_members for select to authenticated using(id=auth.uid() and ss_private.member_ok(false));
create policy ss_read_articles on public.ss_articles for select to authenticated using(ss_private.member_ok() and deleted_at is null);
create policy ss_read_folders on public.ss_folders for select to authenticated using(ss_private.member_ok() and deleted_at is null);
create policy ss_read_bookmarks on public.ss_bookmarks for select to authenticated using(ss_private.member_ok() and exists(select 1 from public.ss_folders f where f.id=folder_id and f.deleted_at is null));
create policy ss_self_feedback on public.ss_feedback for select to authenticated using(ss_private.member_ok() and user_id=auth.uid());
create policy ss_visible_notes on public.ss_notes for select to authenticated using(ss_private.member_ok() and deleted_at is null and (visibility='team' or user_id=auth.uid()));
create policy ss_read_sources on public.ss_sources for select to authenticated using(ss_private.member_ok());
-- Helpers callable from RLS, never exposed as a public API schema.
grant usage on schema ss_private to authenticated;
grant execute on function ss_private.member_ok(boolean),ss_private.role() to authenticated;

create function public.ss_api(action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); r text; current_member public.ss_members; result jsonb; target uuid; parent uuid; token text; batch uuid; old public.ss_folders; nt public.ss_notes; lim integer; ofs integer;
begin
 if not ss_private.member_ok(false) then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into current_member from public.ss_members where id=uid; r:=current_member.role;
 if action='me' then return to_jsonb(current_member); end if;
 if not ss_private.member_ok() then raise exception 'Complete password change and MFA first' using errcode='42501'; end if;
 if action in('feed','library','hidden') then
  lim:=least(greatest(coalesce((p->>'limit')::int,30),1),100);ofs:=greatest(coalesce((p->>'offset')::int,0),0);
  with recursive paths as (
   select f.id,f.parent_id,f.name::text as path,array[f.id] as ancestors from public.ss_folders f where f.parent_id is null and f.deleted_at is null
   union all select f.id,f.parent_id,paths.path||' / '||f.name,paths.ancestors||f.id from public.ss_folders f join paths on paths.id=f.parent_id where f.deleted_at is null and not f.id=any(paths.ancestors)
  ), matched as (
   select a.*,coalesce(fb.liked,false) as liked,coalesce(fb.hidden,false) as hidden,coalesce(fb.read,false) as read,
   exists(select 1 from public.ss_bookmarks b join paths fp on fp.id=b.folder_id where b.article_id=a.id) as saved,
   (select count(*) from public.ss_feedback x where x.article_id=a.id and x.liked) as likes,
   (select count(*) from public.ss_notes n where n.article_id=a.id and n.deleted_at is null and n.visibility='team') as comments,
   coalesce((select jsonb_agg(fp.id) from public.ss_bookmarks b join paths fp on fp.id=b.folder_id where b.article_id=a.id),'[]') as folder_ids,
   coalesce((select jsonb_agg(fp.path) from public.ss_bookmarks b join paths fp on fp.id=b.folder_id where b.article_id=a.id),'[]') as folder_paths,
   a.score+greatest(-12,least(12,coalesce((select sum(case when x.liked then 2 when x.hidden then -2 else 0 end) from public.ss_feedback x join public.ss_articles y on x.article_id=y.id where x.user_id=uid and y.topic=a.topic),0))) as rank_score
   from public.ss_articles a left join public.ss_feedback fb on fb.article_id=a.id and fb.user_id=uid
   where a.deleted_at is null
   and (action='hidden' and fb.hidden or action<>'hidden' and not coalesce(fb.hidden,false))
   and (coalesce(p->>'topic','All topics')='All topics' or a.topic=p->>'topic')
   and (coalesce(p->>'q','')='' or a.title ilike '%'||replace(replace(replace(p->>'q','\','\\'),'%','\%'),'_','\_')||'%' or to_tsvector('simple',a.title) @@ websearch_to_tsquery('simple',p->>'q'))
   and (coalesce(p->>'unread','false')<>'true' or not coalesce(fb.read,false))
   and (action<>'library' or exists(select 1 from public.ss_bookmarks b join paths fp on fp.id=b.folder_id where b.article_id=a.id and (coalesce(p->>'folder','')='' or (p->>'folder')::uuid=any(fp.ancestors))))
   and (action<>'feed' or coalesce(p->>'mode','week')='archive' or a.score>=45)
   and (action<>'feed' or coalesce(p->>'mode','week')='archive' or (p->>'mode'='updates' and a.updated_at>now()-interval '7 days' and a.updated_at<=now()) or (coalesce(p->>'mode','week')='week' and a.published_at>now()-interval '7 days' and a.published_at<=now()))
  ), paged as (select * from matched order by case when p->>'sort'='newest' then coalesce(published_at,discovered_at) end desc,rank_score desc,discovered_at desc,id limit lim offset ofs)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'),'total',(select count(*) from matched)) into result;return result;
 elsif action='folders' then
  select coalesce(jsonb_agg(x),'[]') into result from (select f.*,(select count(*) from public.ss_bookmarks b where b.folder_id=f.id) as count from public.ss_folders f where f.deleted_at is null order by name) x;return result;
 elsif action='notes' then
  select coalesce(jsonb_agg(x),'[]') into result from (select n.*,m.username from public.ss_notes n join public.ss_members m on m.id=n.user_id where n.article_id=(p->>'article_id')::uuid and n.deleted_at is null and (n.visibility='team' or n.user_id=uid) order by n.created_at) x;return result;
 elsif action='sources' then
  select coalesce(jsonb_agg(x),'[]') into result from (select id,name,url,type,topic,active,interval_minutes,last_success_at,last_error,next_check_at from public.ss_sources order by name) x;return result;
 elsif action='read' then
  insert into public.ss_feedback(user_id,article_id,read) values(uid,(p->>'article_id')::uuid,true) on conflict(user_id,article_id) do update set read=true,updated_at=now();return '{}';
 elsif action='stats' then
  return jsonb_build_object('week',(select count(*) from public.ss_articles where published_at between now()-interval '7 days' and now() and deleted_at is null),'saved',(select count(distinct article_id) from public.ss_bookmarks b join public.ss_folders f on f.id=b.folder_id where f.deleted_at is null),'sources',(select count(*) from public.ss_sources where active),'last_scan',(select max(last_success_at) from public.ss_sources));
 end if;
 if r='reader' then raise exception 'Read-only account' using errcode='42501'; end if;
 if action='feedback' then
  if p ? 'hidden' and not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
  insert into public.ss_feedback(user_id,article_id,liked,hidden,reason) values(uid,(p->>'article_id')::uuid,coalesce((p->>'liked')::boolean,false),coalesce((p->>'hidden')::boolean,false),left(coalesce(p->>'reason',''),500)) on conflict(user_id,article_id) do update set liked=case when p ? 'liked' then (p->>'liked')::boolean else ss_feedback.liked end,hidden=case when p ? 'hidden' then (p->>'hidden')::boolean else ss_feedback.hidden end,reason=case when p ? 'reason' then left(p->>'reason',500) else ss_feedback.reason end,updated_at=now();
 elsif action='folder_save' then
  perform pg_advisory_xact_lock(882219);
  parent:=nullif(p->>'parent_id','')::uuid;
  if parent is not null and not exists(select 1 from public.ss_folders where id=parent and deleted_at is null) then raise exception 'Parent unavailable';end if;
  if p ? 'id' then
   target:=(p->>'id')::uuid;
   if not exists(select 1 from public.ss_folders where id=target and deleted_at is null) then raise exception 'Folder unavailable';end if;
   if exists(with recursive children as(select id from public.ss_folders where id=target union all select f.id from public.ss_folders f join children c on f.parent_id=c.id) select 1 from children where id=parent) then raise exception 'A folder cannot contain itself';end if;
   update public.ss_folders set name=trim(p->>'name'),parent_id=parent where id=target;
  else insert into public.ss_folders(name,parent_id,created_by) values(trim(p->>'name'),parent,uid) returning id into target;end if;
 elsif action='folder_delete' then
  if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
  perform pg_advisory_xact_lock(882219);batch:=gen_random_uuid();
  with recursive children as(select id from public.ss_folders where id=(p->>'id')::uuid union all select f.id from public.ss_folders f join children c on f.parent_id=c.id) update public.ss_folders set deleted_at=now(),delete_batch=batch where id in(select id from children) and deleted_at is null;
 elsif action='save' then
  target:=nullif(p->>'folder_id','')::uuid;
  if target is null then
   perform pg_advisory_xact_lock(882219);
   select id into target from public.ss_folders where name='Inbox' and parent_id is null and deleted_at is null order by created_at limit 1;
   if target is null then insert into public.ss_folders(name,created_by) values('Inbox',uid) returning id into target;end if;
  end if;
  if not exists(select 1 from public.ss_folders where id=target and deleted_at is null) then raise exception 'Folder unavailable';end if;
  insert into public.ss_bookmarks(article_id,folder_id,created_by) values((p->>'article_id')::uuid,target,uid) on conflict do nothing;
 elsif action='unsave' then
  if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
  delete from public.ss_bookmarks where article_id=(p->>'article_id')::uuid and folder_id=(p->>'folder_id')::uuid;
 elsif action='note_save' then
  if p ? 'id' then
   select * into nt from public.ss_notes where id=(p->>'id')::uuid and deleted_at is null;
   if nt.user_id is distinct from uid then raise exception 'Only the author may edit this note' using errcode='42501';end if;
   if p->>'visibility' is distinct from nt.visibility then raise exception 'Create a new note to change its visibility';end if;
   update public.ss_notes set body=trim(p->>'body'),updated_at=now() where id=nt.id;
  else
   parent:=nullif(p->>'parent_id','')::uuid;
   if parent is not null and not exists(select 1 from public.ss_notes where id=parent and article_id=(p->>'article_id')::uuid and visibility='team' and deleted_at is null) then raise exception 'Reply target unavailable';end if;
   if parent is not null and p->>'visibility'<>'team' then raise exception 'Replies must be shared';end if;
   insert into public.ss_notes(article_id,user_id,body,visibility,parent_id) values((p->>'article_id')::uuid,uid,trim(p->>'body'),p->>'visibility',parent);
  end if;
 elsif action='note_delete' then
  if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
  select * into nt from public.ss_notes where id=(p->>'id')::uuid;
  if nt.user_id is distinct from uid and not(r='admin' and nt.visibility='team') then raise exception 'Not allowed' using errcode='42501';end if;
  update public.ss_notes set deleted_at=now() where id=nt.id;
 elsif action='submit' then
  insert into public.ss_articles(url,title,source,summary,reason) values(p->>'url',coalesce(nullif(p->>'title',''),p->>'url'),'Team submission','','Submitted by a team member; analysis pending.') on conflict(url) do update set url=excluded.url returning id into target;
  insert into public.ss_jobs(kind,payload) values('article',jsonb_build_object('id',target,'url',p->>'url'));
  if coalesce((p->>'teach')::boolean,true) then insert into public.ss_feedback(user_id,article_id,liked,reason) values(uid,target,true,left(coalesce(p->>'reason',''),500)) on conflict(user_id,article_id) do update set liked=true,reason=excluded.reason;end if;
  perform public.ss_api('save',jsonb_build_object('article_id',target,'folder_id',p->>'folder_id'));
 elsif action='trash' then
  return jsonb_build_object('folders',coalesce((select jsonb_agg(f) from public.ss_folders f where f.deleted_at is not null),'[]'),'notes',coalesce((select jsonb_agg(n) from public.ss_notes n where n.deleted_at is not null and (n.user_id=uid or (r='admin' and n.visibility='team'))),'[]'));
 elsif action='restore' then
  if p->>'type'='folder' then
   perform pg_advisory_xact_lock(882219); select * into old from public.ss_folders where id=(p->>'id')::uuid;
   update public.ss_folders set parent_id=null where id=old.id and exists(select 1 from public.ss_folders p2 where p2.id=old.parent_id and p2.deleted_at is not null and p2.delete_batch is distinct from old.delete_batch);
   update public.ss_folders set deleted_at=null,delete_batch=null where delete_batch=old.delete_batch;
  else update public.ss_notes set deleted_at=null where id=(p->>'id')::uuid and (user_id=uid or(r='admin' and visibility='team'));end if;
 else
  if r<>'admin' then raise exception 'Administrator required' using errcode='42501';end if;
  if action='admin' then
   return jsonb_build_object('members',(select jsonb_agg(m2 order by m2.created_at) from public.ss_members m2),'invites',coalesce((select jsonb_agg(x) from(select id,label,role,expires_at,used_at,revoked from public.ss_invites order by created_at desc limit 100)x),'[]'),'audit',coalesce((select jsonb_agg(x) from(select a.*,m2.username from public.ss_audit a left join public.ss_members m2 on m2.id=a.user_id order by a.id desc limit 100)x),'[]'),'profile',(select value from public.ss_settings where key='profile'),'jobs',(select jsonb_object_agg(status,n) from(select status,count(*) n from public.ss_jobs group by status)x),'usage',coalesce((select jsonb_agg(x) from(select key,n,expires_at from public.ss_limits where key like 'budget:%' and expires_at>now())x),'[]'),'database_bytes',pg_database_size(current_database()));
  elsif action='invite' then
   if p->>'role' not in('maintainer','reader') then raise exception 'Invalid role';end if;
   token:=encode(extensions.gen_random_bytes(32),'hex');
   insert into public.ss_invites(token_hash,label,role,created_by) values(encode(extensions.digest(token,'sha256'),'hex'),left(coalesce(p->>'label',''),100),p->>'role',uid) returning id into target;
   perform ss_private.log(action,target::text);return jsonb_build_object('token',token,'expires_at',now()+interval '24 hours');
  elsif action='invite_revoke' then
   if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
   update public.ss_invites set revoked=true where id=(p->>'id')::uuid;
  elsif action='member_update' then
   if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
   target:=(p->>'id')::uuid;
   if target=uid or exists(select 1 from public.ss_members where id=target and role='admin') then raise exception 'Owner account is protected';end if;
   if p->>'role' not in('maintainer','reader') then raise exception 'Invalid role';end if;
   update public.ss_members set role=p->>'role',active=(p->>'active')::boolean where id=target;
   update public.ss_sessions set revoked=true where user_id=target;
  elsif action='source_save' then
   if p ? 'id' then update public.ss_sources set name=trim(p->>'name'),url=p->>'url',type=p->>'type',topic=p->>'topic',active=coalesce((p->>'active')::boolean,true),interval_minutes=(p->>'interval_minutes')::int,next_check_at=now() where id=(p->>'id')::uuid;
   else insert into public.ss_sources(name,url,type,topic,interval_minutes) values(trim(p->>'name'),p->>'url',p->>'type',p->>'topic',(p->>'interval_minutes')::int);end if;
  elsif action='source_toggle' then
   if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
   update public.ss_sources set active=(p->>'active')::boolean where id=(p->>'id')::uuid;
  elsif action='profile_save' then
   if length(coalesce(p->>'interests',''))>5000 or jsonb_array_length(p->'queries')>20 or coalesce((p->>'gemini_daily_limit')::int,0) not between 0 and 500 or coalesce((p->>'search_monthly_limit')::int,0) not between 0 and 800 then raise exception 'Invalid limits or profile';end if;
   update public.ss_settings set value=p,updated_at=now() where key='profile';
  elsif action='recovery' then
   if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
   target:=(p->>'id')::uuid;
   if not exists(select 1 from public.ss_members where id=target and role<>'admin' and active) then raise exception 'Member unavailable';end if;
   update public.ss_recovery set used_at=now() where user_id=target and used_at is null;
   token:=encode(extensions.gen_random_bytes(32),'hex');
   insert into public.ss_recovery(user_id,token_hash) values(target,encode(extensions.digest(token,'sha256'),'hex'));
   perform ss_private.log(action,target::text);return jsonb_build_object('token',token,'expires_at',now()+interval '1 hour');
  elsif action='rescan' then update public.ss_sources set next_check_at=now() where active;
  elsif action='export' then
   return jsonb_build_object('schema_version',1,'exported_at',now(),'articles',(select coalesce(jsonb_agg(a),'[]') from public.ss_articles a),'folders',(select coalesce(jsonb_agg(f),'[]') from public.ss_folders f),'bookmarks',(select coalesce(jsonb_agg(b),'[]') from public.ss_bookmarks b),'notes',(select coalesce(jsonb_agg(n),'[]') from public.ss_notes n where n.visibility='team' or n.user_id=uid),'sources',(select coalesce(jsonb_agg(s),'[]') from public.ss_sources s),'profile',(select value from public.ss_settings where key='profile'));
  else raise exception 'Unknown action';end if;
 end if;
 perform ss_private.log(action,coalesce(p->>'id',p->>'article_id',target::text));return jsonb_build_object('ok',true,'id',target);
end;$$;
revoke all on function public.ss_api(text,jsonb) from public,anon;
grant execute on function public.ss_api(text,jsonb) to authenticated;

-- Service-only bounded rate counters. Authenticated users cannot reset counters.
create function public.ss_rate_limit(keys text[],max_count int,window_seconds int) returns boolean language plpgsql security definer set search_path='' as $$
declare k text;c int;ok boolean:=true;begin
 foreach k in array keys loop
  insert into public.ss_limits(key,n,expires_at) values(k,1,now()+make_interval(secs=>window_seconds)) on conflict(key) do update set n=case when ss_limits.expires_at<=now() then 1 else ss_limits.n+1 end,expires_at=case when ss_limits.expires_at<=now() then now()+make_interval(secs=>window_seconds) else ss_limits.expires_at end returning n into c;
  if c>max_count then ok:=false;end if;
 end loop;return ok;
end;$$;
revoke all on function public.ss_rate_limit(text[],int,int) from public,anon,authenticated;
grant execute on function public.ss_rate_limit(text[],int,int) to service_role;

create function public.ss_claim_invite(token text,claim uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.ss_invites;begin
 perform pg_advisory_xact_lock(882220);
 if (select count(*) from public.ss_members)>=100 then raise exception 'Workspace capacity reached';end if;
 select * into i from public.ss_invites where token_hash=encode(extensions.digest(token,'sha256'),'hex') for update;
 if i.id is null or i.revoked or i.used_at is not null or i.expires_at<=now() or(i.claimed_at>now()-interval '5 minutes') then raise exception 'Invitation unavailable';end if;
 update public.ss_invites set claim_id=claim,claimed_at=now() where id=i.id;return jsonb_build_object('id',i.id,'role',i.role);
end;$$;
create function public.ss_finish_invite(invite_id uuid,claim uuid,user_id uuid,uname text,dname text) returns void language plpgsql security definer set search_path='' as $$
declare i public.ss_invites;begin
 perform pg_advisory_xact_lock(882220);
 select * into i from public.ss_invites where id=invite_id and claim_id=claim for update;
 if i.id is null or i.revoked or i.used_at is not null or i.expires_at<=now() or i.claimed_at<now()-interval '5 minutes' or(select count(*) from public.ss_members)>=100 then raise exception 'Invitation unavailable';end if;
 insert into public.ss_members(id,username,display_name,role) values(user_id,uname,dname,i.role);
 update public.ss_invites set used_at=now(),claim_id=null,claimed_at=null where id=i.id;
 insert into public.ss_audit(user_id,action,object_id) values(user_id,'account_created',invite_id::text);
end;$$;
revoke all on function public.ss_claim_invite(text,uuid),public.ss_finish_invite(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ss_claim_invite(text,uuid),public.ss_finish_invite(uuid,uuid,uuid,text,text) to service_role;

create function public.ss_claim_jobs(batch_size int default 3) returns setof public.ss_jobs language sql security definer set search_path='' as $$
 update public.ss_jobs set status='running',locked_at=now(),attempts=attempts+1 where id in(select id from public.ss_jobs where ((status='pending' and available_at<=now()) or(status='running' and locked_at<now()-interval '5 minutes')) and attempts<4 order by available_at for update skip locked limit least(batch_size,5)) returning *;
$$;
create function public.ss_enqueue_sources() returns void language plpgsql security definer set search_path='' as $$begin
 with due as (select id,url,type,topic,name,interval_minutes from public.ss_sources where active and next_check_at<=now() order by next_check_at for update skip locked limit 8),queued as(insert into public.ss_jobs(kind,payload) select 'source',jsonb_build_object('source_id',id,'url',url,'type',type,'topic',topic,'name',name) from due returning id)
 update public.ss_sources s set next_check_at=now()+make_interval(mins=>s.interval_minutes) where s.id in(select id from due);
 update public.ss_jobs set status='failed',last_error='Retry limit reached' where attempts>=4 and status in('pending','running') and locked_at<now()-interval '5 minutes';
end;$$;
revoke all on function public.ss_claim_jobs(int),public.ss_enqueue_sources() from public,anon,authenticated;
grant execute on function public.ss_claim_jobs(int),public.ss_enqueue_sources() to service_role;
-- All tables are inaccessible to anonymous callers, including via guessed URLs.
grant all on public.ss_members,public.ss_sessions,public.ss_invites,public.ss_articles,public.ss_folders,public.ss_bookmarks,public.ss_feedback,public.ss_notes,public.ss_sources,public.ss_jobs,public.ss_settings,public.ss_audit,public.ss_limits to service_role;
grant usage,select on sequence public.ss_audit_id_seq to service_role;
revoke all on function ss_private.member_ok(boolean),ss_private.role() from public,anon;
revoke all on function ss_private.log(text,text) from public,anon,authenticated;
create table public.ss_recovery (id uuid primary key default gen_random_uuid(),user_id uuid not null references public.ss_members(id) on delete cascade,token_hash text not null unique,expires_at timestamptz not null default now()+interval '1 hour',used_at timestamptz);
alter table public.ss_recovery enable row level security;
revoke all on public.ss_recovery from public,anon,authenticated;
grant all on public.ss_recovery to service_role;

-- Service-only daily maintenance; saved items and active notes are retained.
create function public.ss_maintenance() returns void language plpgsql security definer set search_path='' as $$begin
 delete from public.ss_sessions where expires_at<now()-interval '1 day';
 delete from public.ss_limits where expires_at<now()-interval '1 day';
 delete from public.ss_recovery where expires_at<now()-interval '1 day';
 delete from public.ss_invites where expires_at<now()-interval '30 days';
 delete from public.ss_jobs where status in('done','failed') and created_at<now()-interval '7 days';
 delete from public.ss_audit where created_at<now()-interval '90 days';
 -- Delete replies with the same expired parent, including nested replies.
 with recursive doomed as(select id from public.ss_notes where deleted_at<now()-interval '30 days' union select n.id from public.ss_notes n join doomed d on n.parent_id=d.id) delete from public.ss_notes where id in(select id from doomed);
 with recursive doomed as(select id from public.ss_folders where deleted_at<now()-interval '30 days' union select f.id from public.ss_folders f join doomed d on f.parent_id=d.id) delete from public.ss_folders where id in(select id from doomed);
 delete from public.ss_articles a where discovered_at<now()-interval '90 days' and not exists(select 1 from public.ss_bookmarks b where b.article_id=a.id) and not exists(select 1 from public.ss_notes n where n.article_id=a.id);
end;$$;
revoke all on function public.ss_maintenance() from public,anon,authenticated;
grant execute on function public.ss_maintenance() to service_role;
-- Quota reservation differs from attack-rate limiting: rejected requests do not consume or inflate usage.
create function public.ss_take_budget(budget_key text,max_count int,window_seconds int) returns boolean language plpgsql security definer set search_path='' as $$
declare c int;begin
 if max_count<=0 then return false;end if;
 insert into public.ss_limits(key,n,expires_at) values('budget:'||budget_key,1,now()+make_interval(secs=>window_seconds)) on conflict(key) do update set n=case when ss_limits.expires_at<=now() then 1 else ss_limits.n+1 end,expires_at=case when ss_limits.expires_at<=now() then now()+make_interval(secs=>window_seconds) else ss_limits.expires_at end where ss_limits.expires_at<=now() or ss_limits.n<max_count returning n into c;
 return c is not null;
end;$$;
revoke all on function public.ss_take_budget(text,int,int) from public,anon,authenticated;
grant execute on function public.ss_take_budget(text,int,int) to service_role;
