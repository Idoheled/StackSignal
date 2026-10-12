-- Service-only, hash-bound commits retain the same immutable review history and feed gates.
create or replace function public.ss_internal_review_candidates(batch_size int default 200) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]') from (select a.id,a.url,a.title,a.topic,a.kind,a.discovered_at,a.content_hash,a.reference_meta
 from public.ss_articles a where a.deleted_at is null and a.reference_meta->>'evaluation' is null
 order by (a.discovered_at<=now()-interval '24 hours') desc,(a.reference_meta->>'alert_kind'='release') desc nulls last,a.discovered_at,a.id limit least(greatest(batch_size,1),500))x;
$$;
revoke all on function public.ss_internal_review_candidates(int) from public,anon,authenticated;
grant execute on function public.ss_internal_review_candidates(int) to service_role;
create or replace function public.ss_commit_internal_reviews(items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; a public.ss_articles; v jsonb; input jsonb; reviewer text; profile jsonb; committed int:=0; skipped int:=0; stamp text;
begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 200 then raise exception 'Invalid review batch';end if;
 select value into profile from public.ss_settings where key='profile';
 for item in select value from jsonb_array_elements(items) loop
  select * into a from public.ss_articles where id=(item->>'id')::uuid and deleted_at is null for update;
  if not found or a.reference_meta->>'evaluation' is not null or a.content_hash is distinct from item->>'content_hash'
    or coalesce(a.reference_meta->'public_evaluation_input','null'::jsonb) is distinct from coalesce(item->'captured_input','null'::jsonb) then skipped:=skipped+1;continue;end if;
  v:=item->'assessment';input:=item->'input';reviewer:=item->>'evaluator';
  if reviewer is null or reviewer not in('assistant','policy') or jsonb_typeof(v) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(v))<>9 or not v ?& array['topic','score','confidence','depth','decision','summary','reason','action','evidence'] then raise exception 'Invalid assessment';end if;
  if exists(select 1 from jsonb_each(v) e where e.key<>'score' and jsonb_typeof(e.value) is distinct from 'string') or jsonb_typeof(v->'score') is distinct from 'number'
    or (v->>'score')::numeric<>trunc((v->>'score')::numeric) or (v->>'score')::numeric not between 0 and 100
    or v->>'decision' not in('useful','tangential','insufficient_evidence') or v->>'confidence' not in('low','medium','high') or v->>'depth' not in('introductory','practical','advanced','unknown')
    or v->>'topic' not in('Hardware','Networking','Platforms','Inference','Models & research','Operations')
    or length(v->>'summary')>300 or length(v->>'reason') not between 1 and 240 or length(v->>'action')>200 or length(v->>'evidence')>160 then raise exception 'Invalid assessment fields';end if;
  if reviewer='policy' and a.discovered_at>now()-interval '24 hours' and not (v->>'decision'='useful' and (
     (a.reference_meta->>'alert_kind'='release' and exists(select 1 from public.ss_sources w where w.id::text=a.reference_meta->>'source_id' and w.active))
     or (a.reference_meta->'public_evaluation_input'->>'scope'='publisher_excerpt' and item->'facts'->>'first_party'='true'))) then raise exception 'Local review is not due';end if;
  if reviewer='policy' and coalesce(input,'null'::jsonb) is distinct from coalesce(a.reference_meta->'public_evaluation_input','null'::jsonb) then raise exception 'Local reviewer must use captured public input';end if;
  if v->>'decision'='insufficient_evidence' then
   if v->>'confidence'<>'low' or v->>'depth'<>'unknown' or v->>'evidence'<>'' then raise exception 'Invalid uncertainty';end if;
  elsif jsonb_typeof(input) is distinct from 'object' or input->>'scope' not in('search_snippet','publisher_excerpt','repository_metadata')
    or length(v->>'evidence') not between 10 and 160 or coalesce(strpos(input->>'text',v->>'evidence'),0)<1 then raise exception 'Evidence is not grounded in the public input';end if;
  if v->>'decision'='useful' and (not ss_private.reviewed_article(jsonb_build_object('evaluation',v),coalesce((profile->>'min_score')::int,55)) or not ss_private.repo_admitted(a.url,a.reference_meta,profile)) then raise exception 'Accepted review does not pass policy';end if;
  stamp:=encode(extensions.gen_random_bytes(16),'hex');
  v:=v||jsonb_build_object('evaluator',reviewer,'version',case when reviewer='policy' then 'dry-evidence-v1' else 'assistant-review-v2' end,'evaluated_at',now(),'cache_key',stamp,'rules_score',a.score,'scope',coalesce(input->>'scope','unavailable'),'facts',coalesce(item->'facts','{}'),'completion_path',coalesce(item->>'completion_path','backlog_review'));
  update public.ss_articles set topic=v->>'topic',score=(v->>'score')::int,reference_meta=reference_meta||jsonb_build_object('evaluation',v,'review_commit',stamp,'evaluation_failed_at',null,'evaluation_retry_at',null,'evaluation_failures',0,'evaluation_validation_failures',0,'evaluation_error',null,'evaluation_error_kind',null,'review_content_changed_at',null,
    'review_snapshot',jsonb_build_object('title',coalesce(input->>'title',a.title),'summary',v->>'summary','reason',v->>'reason','evidence',v->>'evidence','input',input,'content_hash',a.content_hash)) where id=a.id;
  committed:=committed+1;
 end loop;
 return jsonb_build_object('committed',committed,'skipped',skipped);
end;$$;
revoke all on function public.ss_commit_internal_reviews(jsonb) from public,anon,authenticated;
grant execute on function public.ss_commit_internal_reviews(jsonb) to service_role;

-- Rank local decisions by their explicit evidence score after later metadata refreshes.
create or replace function public.ss_api(action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); r text; current_member public.ss_members; result jsonb; target uuid; parent uuid; token text; batch uuid; old public.ss_folders; nt public.ss_notes; lim integer; ofs integer; previous public.ss_sources; source_url text; profile jsonb;
begin
 if not ss_private.member_ok(false) then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into current_member from public.ss_members where id=uid; r:=current_member.role;
 if action='me' then return to_jsonb(current_member); end if;
 if not ss_private.member_ok() then raise exception 'Complete password change and MFA first' using errcode='42501'; end if;
 select value into profile from public.ss_settings where key='profile';
 if action in('feed','library','hidden') then
  lim:=least(greatest(coalesce((p->>'limit')::int,30),1),100);ofs:=greatest(coalesce((p->>'offset')::int,0),0);
  with recursive paths as (
   select f.id,f.parent_id,f.name::text as path,array[f.id] as ancestors from public.ss_folders f where f.parent_id is null and f.deleted_at is null
   union all select f.id,f.parent_id,paths.path||' / '||f.name,paths.ancestors||f.id from public.ss_folders f join paths on paths.id=f.parent_id where f.deleted_at is null and not f.id=any(paths.ancestors)
  ), current_releases as materialized (select ss_private.current_release_ids(profile) as id), matched as (
   select a.id,a.url,coalesce(a.reference_meta->'review_snapshot'->>'title',a.title) as title,a.source,a.author,a.published_at,a.updated_at,a.discovered_at,a.kind,a.topic,a.tags,coalesce(a.reference_meta->'review_snapshot'->>'summary',a.summary) as summary,coalesce(a.reference_meta->'review_snapshot'->>'reason',a.reason) as reason,coalesce(a.reference_meta->'review_snapshot'->>'evidence',a.evidence) as evidence,case when a.reference_meta->'evaluation'->>'evaluator' in('assistant','policy') then (a.reference_meta->'evaluation'->>'score')::int else a.score end as score,a.analysis_status,a.content_hash,a.deleted_at,a.reference_meta,coalesce(fb.liked,false) as liked,coalesce(fb.hidden,false) as hidden,coalesce(fb.read,false) as read,
   exists(select 1 from public.ss_bookmarks b join paths fp on fp.id=b.folder_id where b.article_id=a.id) as saved,
   (select count(*) from public.ss_feedback x where x.article_id=a.id and x.liked) as likes,
   (select count(*) from public.ss_notes n where n.article_id=a.id and n.deleted_at is null and n.visibility='team') as comments,
   coalesce((select jsonb_agg(fp.id) from public.ss_bookmarks b join paths fp on fp.id=b.folder_id where b.article_id=a.id),'[]') as folder_ids,
   coalesce((select jsonb_agg(fp.path) from public.ss_bookmarks b join paths fp on fp.id=b.folder_id where b.article_id=a.id),'[]') as folder_paths,
   (case when a.reference_meta->'evaluation'->>'evaluator' in('assistant','policy') then (a.reference_meta->'evaluation'->>'score')::int else a.score end)+greatest(-12,least(12,coalesce((select sum(case when x.liked then 2 when x.hidden then -2 else 0 end) from public.ss_feedback x join public.ss_articles y on x.article_id=y.id where x.user_id=uid and (y.topic=a.topic or y.tags && a.tags)),0))) as rank_score
   from public.ss_articles a left join public.ss_feedback fb on fb.article_id=a.id and fb.user_id=uid
   where a.deleted_at is null
   and (action='library' or ss_private.release_project(a.url,a.kind,a.reference_meta) is null or a.id in(select id from current_releases))
   and (action<>'feed' or (ss_private.reviewed_article(a.reference_meta,coalesce((profile->>'min_score')::int,55)) and ss_private.repo_admitted(a.url,a.reference_meta,profile)))
   and (action='hidden' and fb.hidden or action<>'hidden' and not coalesce(fb.hidden,false))
   and (coalesce(p->>'topic','All topics')='All topics' or a.topic=p->>'topic')
   and (coalesce(p->>'q','')='' or coalesce(a.reference_meta->'review_snapshot'->>'title',a.title) ilike '%'||replace(replace(replace(p->>'q','\','\\'),'%','\%'),'_','\_')||'%' or to_tsvector('simple',coalesce(a.reference_meta->'review_snapshot'->>'title',a.title)) @@ websearch_to_tsquery('simple',p->>'q'))
   and (coalesce(p->>'unread','false')<>'true' or not coalesce(fb.read,false))
   and (coalesce(p->>'kind','All types')='All types' or a.kind=p->>'kind')
   and (coalesce(p->>'needs_review','false')<>'true' or a.reference_meta->>'link_status' in('submitted','unresolved','title-match'))
   and (action<>'library' or exists(select 1 from public.ss_bookmarks b join paths fp on fp.id=b.folder_id where b.article_id=a.id and (coalesce(p->>'folder','')='' or (p->>'folder')::uuid=any(fp.ancestors))))
   and (action<>'feed' or coalesce(p->>'mode','week')='archive' or a.reference_meta->>'alert_kind'='release' or ss_private.reviewed_article(a.reference_meta,coalesce((profile->>'min_score')::int,55)))
   and (action<>'feed' or ss_private.release_channel_allowed(a.url,a.reference_meta))
   and (action<>'feed' or coalesce(p->>'mode','week')='archive' or (p->>'mode'='releases' and a.reference_meta->>'alert_kind'='release' and a.published_at between now()-interval '7 days' and now()) or (p->>'mode'='radar' and (a.reference_meta->'evaluation'->>'evaluated_at')::timestamptz between now()-interval '7 days' and now() and a.kind<>'Release') or (p->>'mode'='updates' and a.updated_at>now()-interval '7 days' and a.updated_at<=now()) or (coalesce(p->>'mode','week')='week' and a.published_at>now()-interval '7 days' and a.published_at<=now()))
  ), paged as (select * from matched order by case when p->>'sort'='newest' then case when p->>'mode'='radar' then (reference_meta->'evaluation'->>'evaluated_at')::timestamptz when p->>'mode'='updates' then updated_at else coalesce(published_at,discovered_at) end end desc,rank_score desc,discovered_at desc,id limit lim offset ofs)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'),'total',(select count(*) from matched)) into result;return result;
 elsif action='folders' then
  select coalesce(jsonb_agg(x),'[]') into result from (select f.*,(select count(*) from public.ss_bookmarks b where b.folder_id=f.id) as count from public.ss_folders f where f.deleted_at is null order by name) x;return result;
 elsif action='notes' then
  select coalesce(jsonb_agg(x),'[]') into result from (select n.*,m.username from public.ss_notes n join public.ss_members m on m.id=n.user_id where n.article_id=(p->>'article_id')::uuid and n.deleted_at is null and (n.visibility='team' or n.user_id=uid) order by n.created_at) x;return result;
 elsif action='sources' then
  select coalesce(jsonb_agg(x),'[]') into result from (select id,name,url,type,topic,active,interval_minutes,last_success_at,last_error,next_check_at,include_prereleases,priority,last_item_count,revision,last_error_kind,retry_at from public.ss_sources order by name) x;return result;
 elsif action='read' then
  insert into public.ss_feedback(user_id,article_id,read) values(uid,(p->>'article_id')::uuid,true) on conflict(user_id,article_id) do update set read=true,updated_at=now();return '{}';
 elsif action='stats' then
  with current_releases as materialized (select ss_private.current_release_ids(profile) as id), visible as (
   select a.*,coalesce(fb.read,false) as is_read from public.ss_articles a
   left join public.ss_feedback fb on fb.article_id=a.id and fb.user_id=uid
   where a.deleted_at is null and not coalesce(fb.hidden,false)
   and ss_private.reviewed_article(a.reference_meta,coalesce((profile->>'min_score')::int,55))
   and ss_private.repo_admitted(a.url,a.reference_meta,profile)
   and ss_private.release_channel_allowed(a.url,a.reference_meta)
   and (ss_private.release_project(a.url,a.kind,a.reference_meta) is null or a.id in(select id from current_releases))
  ) select jsonb_build_object('review_pending',(select count(*) from public.ss_articles where deleted_at is null and ss_private.gemini_new_link(url) and reference_meta->>'public_evaluation_input' is not null and reference_meta->>'evaluation' is null),
   'review_only',true,'week',(select count(*) from visible where published_at between now()-interval '7 days' and now()),
   'saved',(select count(distinct article_id) from public.ss_bookmarks b join public.ss_folders f on f.id=b.folder_id where f.deleted_at is null),
   'sources',(select count(*) from public.ss_sources where active),'last_scan',(select max(last_success_at) from public.ss_sources),
   'release_unread',(select count(*) from visible where reference_meta->>'alert_kind'='release' and published_at between now()-interval '7 days' and now() and not is_read)) into result;
  return result;
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
   return jsonb_build_object('members',(select jsonb_agg(m2 order by m2.created_at) from public.ss_members m2),'invites',coalesce((select jsonb_agg(x) from(select id,label,role,expires_at,used_at,revoked from public.ss_invites order by created_at desc limit 100)x),'[]'),'audit',coalesce((select jsonb_agg(x) from(select a.*,m2.username from public.ss_audit a left join public.ss_members m2 on m2.id=a.user_id order by a.id desc limit 100)x),'[]'),'profile',(select value from public.ss_settings where key='profile'),'jobs',(select jsonb_object_agg(status,n) from(select status,count(*) n from public.ss_jobs group by status)x),'usage',coalesce((select jsonb_agg(x) from(select key,n,expires_at from public.ss_limits where key like 'budget:%' and expires_at>now())x),'[]'),'discovery_health',coalesce((select value from public.ss_settings where key='discovery_health'),'{}'),'database_bytes',pg_database_size(current_database()));
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
   perform pg_advisory_xact_lock(882221);
   source_url:=p->>'url';
   if p->>'type'='openshift' and source_url !~ '^https://amd64\.ocp\.releases\.ci\.openshift\.org/api/v1/releasestream/[45]-(stable|dev-preview)/tags$' then raise exception 'Invalid official OpenShift release stream';end if;
   if p->>'type'='github' then
    if source_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(/releases)?/?$' then
     source_url:='https://api.github.com/repos/'||regexp_replace(regexp_replace(substr(source_url,20),'/releases/?$|/$','','g'),'\.git$','')||'/releases';
    end if;
    if source_url !~ '^https://api\.github\.com/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/(releases(/tags/[^/?#]+)?|(issues|pulls)/[0-9]+)$' then raise exception 'Use a public GitHub repository or supported API URL';end if;
   end if;
   if p->>'type'='github' and exists(select 1 from public.ss_sources where type='github' and lower(split_part(url,'?',1))=lower(source_url) and id is distinct from nullif(p->>'id','')::uuid) then raise exception 'Project is already followed; edit its existing watch';end if;
   if p ? 'id' then
    target:=(p->>'id')::uuid;
    select * into previous from public.ss_sources where id=target for update;
    if not found then raise exception 'Source unavailable';end if;
    update public.ss_sources set name=trim(p->>'name'),url=source_url,type=p->>'type',topic=p->>'topic',
     active=coalesce((p->>'active')::boolean,previous.active),interval_minutes=(p->>'interval_minutes')::int,
     include_prereleases=coalesce((p->>'include_prereleases')::boolean,previous.include_prereleases),
     priority=coalesce(p->>'priority',previous.priority),revision=previous.revision+1,next_check_at=now(),etag=null,
     baseline=case when url is distinct from source_url or type is distinct from p->>'type' then null else baseline end,
     content_hash=case when url is distinct from source_url or type is distinct from p->>'type' then null else content_hash end,
     last_success_at=case when url is distinct from source_url or type is distinct from p->>'type' then null else last_success_at end,
     last_error=null where id=target;
   else
    if (select count(*) from public.ss_sources)>=500 then raise exception 'Source limit reached';end if;
    insert into public.ss_sources(name,url,type,topic,interval_minutes,include_prereleases,priority)
     values(trim(p->>'name'),source_url,p->>'type',p->>'topic',(p->>'interval_minutes')::int,coalesce((p->>'include_prereleases')::boolean,false),coalesce(p->>'priority','normal')) returning id into target;
   end if;
  elsif action='source_toggle' then
   if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
   update public.ss_sources set active=(p->>'active')::boolean,next_check_at=now(),revision=revision+1 where id=(p->>'id')::uuid;
  elsif action='source_delete' then
   if not coalesce((p->>'confirmed')::boolean,false) then raise exception 'Confirmation required';end if;
   delete from public.ss_jobs where status='pending' and payload->>'source_id'=p->>'id';
   delete from public.ss_sources where id=(p->>'id')::uuid;
  elsif action='source_scan' then
   update public.ss_sources set next_check_at=now() where id=(p->>'id')::uuid and active;
  elsif action='profile_save' then
   profile:=profile||p;
   if jsonb_typeof(profile->'queries')<>'array' or jsonb_typeof(profile->'repo_queries')<>'array' or jsonb_typeof(profile->'priorities')<>'object' then raise exception 'Invalid profile format';end if;
   if length(coalesce(profile->>'interests',''))>5000 or jsonb_array_length(profile->'queries')>20 or jsonb_array_length(profile->'repo_queries')>12
    or coalesce((profile->>'gemini_daily_limit')::int,0) not between 0 and 16 or coalesce((profile->>'search_monthly_limit')::int,0) not between 0 and 800
    or coalesce((profile->>'min_score')::int,55) not between 45 and 85 then raise exception 'Invalid limits or profile';end if;
   if exists(select 1 from jsonb_array_elements(profile->'queries') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 300)
    or exists(select 1 from jsonb_array_elements(profile->'repo_queries') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 160)
    or exists(select 1 from jsonb_each(profile->'priorities') x where jsonb_typeof(x.value)<>'number' or (x.value::text)::numeric not between -20 and 20)
    or jsonb_typeof(profile->'repo_discovery')<>'boolean' then raise exception 'Invalid coverage values';end if;
   if coalesce(profile->>'gemini_mode','off') not in ('off','shadow','rerank') or coalesce((profile->>'gemini_monthly_limit')::int,0) not between 0 and 496 then raise exception 'Invalid evaluation limits';end if;
   if jsonb_typeof(profile->'trending_discovery')<>'boolean'
    or exists(select 1 from jsonb_each(profile) x where x.key in('repo_min_stars','repo_min_watchers','repo_min_releases','repo_active_days','repo_release_days') and (jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$'))
    or (profile->>'repo_min_stars')::int not between 1 and 100000 or (profile->>'repo_min_watchers')::int not between 1 and 10000
    or (profile->>'repo_min_releases')::int not between 1 and 20 or (profile->>'repo_active_days')::int not between 7 and 365 or (profile->>'repo_release_days')::int not between 30 and 730 then raise exception 'Invalid repository quality policy';end if;
   update public.ss_settings set value=profile,updated_at=now() where key='profile';
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
