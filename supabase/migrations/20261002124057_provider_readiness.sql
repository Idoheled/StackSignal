-- Cache request-wide authorization checks per statement, retaining all row filters.
alter policy ss_self_profile on public.ss_members using
 (id=(select auth.uid()) and (select ss_private.member_ok(false)));
alter policy ss_read_articles on public.ss_articles using
 ((select ss_private.member_ok()) and deleted_at is null);
alter policy ss_read_folders on public.ss_folders using
 ((select ss_private.member_ok()) and deleted_at is null);
alter policy ss_read_bookmarks on public.ss_bookmarks using
 ((select ss_private.member_ok()) and exists(select 1 from public.ss_folders f where f.id=folder_id and f.deleted_at is null));
alter policy ss_self_feedback on public.ss_feedback using
 ((select ss_private.member_ok()) and user_id=(select auth.uid()));
alter policy ss_visible_notes on public.ss_notes using
 ((select ss_private.member_ok()) and deleted_at is null and (visibility='team' or user_id=(select auth.uid())));
alter policy ss_read_sources on public.ss_sources using
 ((select ss_private.member_ok()));

-- Cover the remaining relationship lookups and private-note ownership predicate.
create index ss_bookmarks_creator on public.ss_bookmarks(created_by);
create index ss_folders_creator on public.ss_folders(created_by);
create index ss_invites_creator on public.ss_invites(created_by);
create index ss_notes_parent on public.ss_notes(parent_id);
create index ss_notes_author on public.ss_notes(user_id);
create index ss_recovery_user on public.ss_recovery(user_id);

-- A new installation stays API-independent even before the team import runs.
-- Preserve settings once an owner has entered the application or edited the profile.
update public.ss_settings
set value=value || '{"gemini_daily_limit":0,"search_monthly_limit":0}'::jsonb,
    updated_at=now()
where key='profile'
  and value->>'interests'='Bare metal, RoCE, InfiniBand, OpenShift, HyperShift, GPU operators, LLM serving, token quotas and optimization'
  and not exists(select 1 from public.ss_members);
