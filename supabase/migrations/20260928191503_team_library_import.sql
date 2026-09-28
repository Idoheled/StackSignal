-- Preserve link provenance and import identity without exposing a new client write surface.
alter table public.ss_articles add column reference_meta jsonb not null default '{}' check(jsonb_typeof(reference_meta)='object');
alter table public.ss_folders add column import_key text unique;
create table public.ss_imports (key text primary key, payload_hash text not null, result jsonb not null, created_at timestamptz not null default now());
alter table public.ss_imports enable row level security;
revoke all on public.ss_imports from public, anon, authenticated;
grant all on public.ss_imports to service_role;
grant usage on schema extensions to service_role;

create index ss_folders_parent on public.ss_folders(parent_id);
create index ss_bookmarks_folder on public.ss_bookmarks(folder_id,article_id);
create index ss_feedback_article on public.ss_feedback(article_id);
create index ss_notes_article on public.ss_notes(article_id,visibility) where deleted_at is null;
create index ss_sessions_user on public.ss_sessions(user_id);
create index ss_sources_due on public.ss_sources(next_check_at) where active;
create index ss_jobs_source on public.ss_jobs((payload->>'source_id')) where status in ('pending','running');

-- Invoker security: only the service role has both EXECUTE and table privileges.
create function public.ss_import_team(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
<<seed>>
declare owner_id uuid; item jsonb; folder_id uuid; article_id uuid; parent_id uuid; folder_map jsonb:='{}'; imported jsonb; prior public.ss_imports; fingerprint text; n int; article_count int:=0; folder_count int:=0; bookmark_count int:=0; source_count int:=0; import_key text:=payload->>'key';
begin
 if import_key is null or length(import_key)>120 or jsonb_array_length(payload->'articles')>1000 then raise exception 'Invalid import'; end if;
 perform pg_advisory_xact_lock(882221);
 fingerprint:=encode(extensions.digest(payload::text,'sha256'),'hex');
 select * into prior from public.ss_imports where key=import_key;
 if found then
  if prior.payload_hash<>fingerprint then raise exception 'Import content changed; use a new batch key'; end if;
  return prior.result || '{"already_applied":true}'::jsonb;
 end if;
 select id into owner_id from public.ss_members where role='admin' and active;
 if owner_id is null then raise exception 'Create the administrator before importing the library'; end if;
 for item in select value from jsonb_array_elements(payload->'folders') loop
  parent_id:=null;
  if item->>'parent_key' is not null then
   parent_id:=(folder_map->>(item->>'parent_key'))::uuid;
   if parent_id is null then continue; end if;
  end if;
  folder_id:=null;
  select id into folder_id from public.ss_folders where ss_folders.import_key='team-folder:'||(item->>'key');
  if folder_id is null then
   select id into folder_id from public.ss_folders where name=item->>'name' and ss_folders.parent_id is not distinct from seed.parent_id and deleted_at is null and ss_folders.import_key is null order by created_at limit 1;
   if folder_id is null then
    insert into public.ss_folders(name,parent_id,created_by,import_key) values(item->>'name',parent_id,owner_id,'team-folder:'||(item->>'key')) returning id into folder_id;
    folder_count:=folder_count+1;
   else update public.ss_folders set import_key='team-folder:'||(item->>'key') where id=folder_id; end if;
  end if;
  if exists(select 1 from public.ss_folders where id=folder_id and deleted_at is null) then folder_map:=folder_map||jsonb_build_object(item->>'key',folder_id); end if;
 end loop;
 for item in select value from jsonb_array_elements(payload->'articles') loop
  insert into public.ss_articles(url,title,source,kind,topic,tags,summary,reason,score,analysis_status,reference_meta)
  values(item->>'url',item->>'title',item->>'source',item->>'kind',item->>'topic',array(select jsonb_array_elements_text(item->'tags')),item->>'summary',item->>'reason',(item->>'score')::int,'reference',item->'reference_meta')
  on conflict(url) do nothing;
  get diagnostics n=row_count;article_count:=article_count+n;
  select id into article_id from public.ss_articles where url=item->>'url' and deleted_at is null;
  if article_id is null then continue; end if;
  folder_id:=(folder_map->>(item->>'folder_key'))::uuid;
  if folder_id is not null then
   insert into public.ss_bookmarks(article_id,folder_id,created_by) values(article_id,folder_id,owner_id) on conflict do nothing;
   get diagnostics n=row_count;bookmark_count:=bookmark_count+n;
  end if;
  if (item->>'queue_metadata')::boolean and not exists(select 1 from public.ss_jobs where kind='article' and status in('pending','running') and ss_jobs.payload->>'url'=item->>'url') then
   insert into public.ss_jobs(kind,payload) values('article',jsonb_build_object('url',item->>'url','kind',item->>'kind','topic',item->>'topic','title',item->>'title'));
  end if;
 end loop;
 for item in select value from jsonb_array_elements(payload->'sources') loop
  insert into public.ss_sources(name,url,type,topic,interval_minutes,next_check_at) values(item->>'name',item->>'url',item->>'type',item->>'topic',(item->>'interval_minutes')::int,now()+make_interval(secs=>source_count*30)) on conflict(url) do nothing;
  get diagnostics n=row_count;source_count:=source_count+n;
 end loop;
 -- Preserve an administrator's existing edits. Only replace the original bootstrap profile.
 update public.ss_settings set value=payload->'profile',updated_at=now() where key='profile' and value->>'interests'='Bare metal, RoCE, InfiniBand, OpenShift, HyperShift, GPU operators, LLM serving, token quotas and optimization';
 imported:=jsonb_build_object('articles_created',article_count,'folders_created',folder_count,'bookmarks_created',bookmark_count,'sources_created',source_count,'already_applied',false);
 insert into public.ss_imports(key,payload_hash,result) values(import_key,fingerprint,imported);
 insert into public.ss_audit(user_id,action,object_id) values(owner_id,'team_import',import_key);
 return imported;
end;$$;
revoke all on function public.ss_import_team(jsonb) from public,anon,authenticated;
grant execute on function public.ss_import_team(jsonb) to service_role;

create or replace function public.ss_claim_jobs(batch_size int default 3) returns setof public.ss_jobs language sql security definer set search_path='' as $$
 update public.ss_jobs set status='running',locked_at=now(),attempts=attempts+1 where id in(select id from public.ss_jobs where ((status='pending' and available_at<=now()) or(status='running' and locked_at<now()-interval '5 minutes')) and attempts<4 order by available_at for update skip locked limit least(greatest(batch_size,1),8)) returning *;
$$;
create or replace function public.ss_enqueue_sources() returns void language plpgsql security definer set search_path='' as $$begin
 with due as (select id,interval_minutes from public.ss_sources s where active and next_check_at<=now() and not exists(select 1 from public.ss_jobs j where j.status in('pending','running') and j.payload->>'source_id'=s.id::text) order by next_check_at for update skip locked limit 8),queued as(insert into public.ss_jobs(kind,payload) select 'source',jsonb_build_object('source_id',id) from due returning id)
 update public.ss_sources s set next_check_at=now()+make_interval(mins=>s.interval_minutes) where s.id in(select id from due);
 update public.ss_jobs set status='failed',last_error='Retry limit reached' where attempts>=4 and status in('pending','running') and locked_at<now()-interval '5 minutes';
end;$$;

-- Additional feed/library filters retain the existing authorization checks.
create or replace function public.ss_api(action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
   and (coalesce(p->>'kind','All types')='All types' or a.kind=p->>'kind')
   and (coalesce(p->>'needs_review','false')<>'true' or a.reference_meta->>'link_status' in('submitted','unresolved','title-match'))
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
