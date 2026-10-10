-- Require a live identity-provider session as well as the application's bound session.
create or replace function ss_private.member_ok(require_mfa boolean default true)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.ss_members m
  join public.ss_sessions s on s.user_id=m.id
  join auth.sessions a on a.id=s.session_id and a.user_id=m.id
  where m.id=auth.uid() and m.active
    and s.session_id=(auth.jwt()->>'session_id')::uuid
    and not s.revoked and s.expires_at>now()
    and (a.not_after is null or a.not_after>now())
    and (not require_mfa or (not m.must_change_password and
      (m.role='reader' or (auth.jwt()->>'aal'='aal2' and exists(
       select 1 from auth.mfa_factors f where f.user_id=m.id and f.factor_type='totp' and f.status='verified'
      )))))
 );
$$;
revoke all on function ss_private.member_ok(boolean) from public,anon;
grant execute on function ss_private.member_ok(boolean) to authenticated;

-- Expired trash must not abort the entire daily cleanup because of bookmark references.
alter table public.ss_bookmarks drop constraint ss_bookmarks_folder_id_fkey;
alter table public.ss_bookmarks add constraint ss_bookmarks_folder_id_fkey
 foreign key(folder_id) references public.ss_folders(id) on delete cascade;
