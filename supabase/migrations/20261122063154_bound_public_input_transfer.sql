-- Preserve the collector's oldest-500 window and first-eight incomplete inputs,
-- while keeping complete article metadata inside PostgreSQL instead of sending
-- it over the Data API twice every five minutes. This function only reads rows.
create function public.ss_public_input_candidates()
returns table(id uuid,url text,kind text,topic text,content_hash text,reference_meta jsonb)
language sql stable security invoker set search_path='' as $$
 with candidate_window as materialized (
  select a.id,a.url,a.kind,a.topic,a.content_hash,a.reference_meta,a.discovered_at
  from public.ss_articles a
  where a.deleted_at is null
   and a.reference_meta->>'evaluation' is null
   and a.reference_meta->>'public_extraction_requested' is null
   and a.reference_meta->>'assistant_reviewed_at' is null
  order by a.discovered_at,a.id
  limit 500
 ), inputs as (
  select w.*,coalesce(w.reference_meta#>>'{public_evaluation_input,text}','') as input_text
  from candidate_window w
 )
 select i.id,i.url,i.kind,i.topic,i.content_hash,i.reference_meta
 from inputs i
 -- JavaScript String.length counts supplementary Unicode characters twice.
 -- Keep the existing 1,800 UTF-16-unit cutoff for captured public text.
 where case when char_length(i.input_text) >= 1800 then false else
  char_length(i.input_text)
   + char_length(regexp_replace(i.input_text,U&'[^\+010000-\+10FFFF]','','g')) < 1800 end
 order by i.discovered_at,i.id
 limit 8;
$$;
revoke all on function public.ss_public_input_candidates() from public,anon,authenticated;
grant execute on function public.ss_public_input_candidates() to service_role;
