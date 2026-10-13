-- Match legacy trailing-slash variants without retaining rejected identities.
create or replace function ss_private.review_identity(link text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(case when link ~ '^https://github\.com/[^/]+/[^/]+(/|$)' then
  'https://github.com/'||lower(split_part(link,'/',4))||'/'||lower(split_part(link,'/',5))||substr(link,length('https://github.com/'||split_part(link,'/',4)||'/'||split_part(link,'/',5))+1)
 else link end,'/+$','');
$$;
revoke all on function ss_private.review_identity(text) from public,anon,authenticated,service_role;
reindex index ss_private.review_cohort_identity_idx;

create or replace function ss_private.purge_link_records(article uuid,link text,meta jsonb) returns void language plpgsql set search_path='' as $$begin
 delete from ss_private.article_reviews r where article_id=article or (ss_private.review_identity(url)=ss_private.review_identity(link) and not exists(select 1 from public.ss_articles a where a.id=r.article_id and a.id<>article));
 delete from ss_private.review_cohort where ss_private.review_identity(url)=ss_private.review_identity(link) and not exists(select 1 from public.ss_articles a where a.id<>article and a.review_state in('approved','archived') and ss_private.review_identity(a.url)=ss_private.review_identity(link));
 delete from ss_private.evaluation_claims where article_id=article;
 delete from ss_private.evaluation_attempts where article_id=article;
 delete from public.ss_jobs where payload->>'article_id'=article::text or payload->>'id'=article::text
  or ss_private.review_identity(payload->>'url')=ss_private.review_identity(link)
  or payload->>'url' in(select jsonb_array_elements_text(case when jsonb_typeof(meta->'original_urls')='array' then meta->'original_urls' else '[]'::jsonb end));
 delete from public.ss_audit where object_id in(article::text,link)
  or object_id in(select id::text from public.ss_notes where article_id=article);
end;$$;
revoke all on function ss_private.purge_link_records(uuid,text,jsonb) from public,anon,authenticated,service_role;
