-- The collector explicitly stores evaluation: null before a first review.
-- Text extraction maps JSON null and a missing field to SQL NULL; JSON extraction
-- does not. Preserve every existing cutoff and deduplication guard. No backfill.
create or replace function ss_private.enqueue_whatsapp_notification() returns trigger
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
  if new.discovered_at < configuration.active_from then return null; end if;
  if tg_op='UPDATE' and old.reference_meta->>'evaluation' is not null then return null; end if;
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
