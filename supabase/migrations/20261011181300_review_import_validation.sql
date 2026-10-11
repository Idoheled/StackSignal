-- Reject missing public-input scope and clear resolved review errors.
create or replace function public.ss_apply_assistant_reviews(items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; a public.ss_articles; assessment jsonb; input jsonb; h jsonb; result jsonb:='[]'; stamp text;
begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 50 then raise exception 'Invalid review batch';end if;
 for item in select value from jsonb_array_elements(items) loop
  select * into a from public.ss_articles where id=(item->>'id')::uuid and deleted_at is null for update;
  if not found or not exists(select 1 from ss_private.review_cohort where url=a.url) then raise exception 'Article not in frozen review cohort';end if;
  assessment:=item->'assessment'; input:=item->'input'; h:=item->'repo_health';
  if jsonb_typeof(assessment) is distinct from 'object' or (select count(*) from jsonb_object_keys(assessment))<>9 or not assessment ?& array['topic','score','confidence','depth','decision','summary','reason','action','evidence'] then raise exception 'Invalid assessment';end if;
  if exists(select 1 from jsonb_each(assessment) e where e.key<>'score' and jsonb_typeof(e.value) is distinct from 'string')
   or assessment->>'decision' not in('useful','tangential','insufficient_evidence') or assessment->>'confidence' not in('low','medium','high')
   or assessment->>'depth' not in('introductory','practical','advanced','unknown') or jsonb_typeof(assessment->'score') is distinct from 'number'
   or (assessment->>'score')::numeric<>trunc((assessment->>'score')::numeric) or (assessment->>'score')::numeric not between 0 and 100
   or length(assessment->>'reason') not between 1 and 240 or length(assessment->>'summary')>300 or length(assessment->>'action')>200 or length(assessment->>'evidence')>160
   or assessment->>'topic' not in ('Hardware','Networking','Platforms','Inference','Models & research','Operations') then raise exception 'Invalid assessment';end if;
  if assessment->>'decision'<>'insufficient_evidence' and (jsonb_typeof(input) is distinct from 'object' or jsonb_typeof(input->'text') is distinct from 'string' or jsonb_typeof(input->'title') is distinct from 'string' or coalesce(input->>'scope','') not in('search_snippet','publisher_excerpt','repository_metadata') or length(assessment->>'evidence') not between 10 and 160 or coalesce(strpos(input->>'text',assessment->>'evidence'),0)<1) then raise exception 'Evidence is not grounded in the reviewed public input';end if;
  if assessment->>'decision'='insufficient_evidence' and (coalesce(assessment->>'evidence','')<>'' or assessment->>'confidence'<>'low' or assessment->>'depth'<>'unknown') then raise exception 'Invalid uncertainty';end if;
  if assessment->>'decision'='useful' and (not ss_private.reviewed_article(jsonb_build_object('evaluation',assessment),coalesce((select (value->>'min_score')::int from public.ss_settings where key='profile'),55)) or not ss_private.repo_admitted(a.url,jsonb_build_object('repo_health',h),(select value from public.ss_settings where key='profile'))) then raise exception 'Accepted review does not pass the policy';end if;
  stamp:=encode(extensions.gen_random_bytes(16),'hex');
  assessment:=assessment||jsonb_build_object('evaluator','assistant','version','assistant-review-v1','evaluated_at',now(),'cache_key',encode(extensions.digest(coalesce(input::text,'')||assessment::text,'sha256'),'hex'),'rules_score',a.score,'scope',coalesce(input->>'scope','unavailable'));
  update public.ss_articles set reference_meta=reference_meta||jsonb_build_object('evaluation',assessment,'review_commit',stamp,'assistant_reviewed_at',now(),'evaluation_failed_at',null,'evaluation_retry_at',null,'evaluation_failures',0,'evaluation_error',null,'review_content_changed_at',null,
   'repo_health',coalesce(h,reference_meta->'repo_health'),'review_snapshot',jsonb_build_object('title',coalesce(input->>'title',a.title),'summary',assessment->>'summary','reason',assessment->>'reason','evidence',assessment->>'evidence','input',input,'content_hash',a.content_hash))
   where id=a.id;
  result:=result||jsonb_build_array(jsonb_build_object('id',a.id,'decision',assessment->>'decision'));
 end loop;
 return result;
end;$$;
revoke all on function public.ss_apply_assistant_reviews(jsonb) from public,anon,authenticated;
grant execute on function public.ss_apply_assistant_reviews(jsonb) to service_role;

