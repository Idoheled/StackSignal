-- Keep reviewed snapshots immutable while displaying the followed GitHub project with its release tag.
create function ss_private.article_display_title(link text,article_kind text,source_label text,title text,meta jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare frozen text:=coalesce(nullif(meta->'review_snapshot'->>'title',''),title); label text;
begin
 if link ~* '^https://github[.]com/[^/]+/[^/]+/releases/tag/' then
  label:=nullif(trim(source_label),'');
  if label is null or lower(label) in('github','github.com') then label:=split_part(link,'/',4)||'/'||split_part(link,'/',5);end if;
  if left(lower(frozen),length(label))<>lower(label) then return label||' · '||frozen;end if;
 end if;
 return frozen;
end;$$;
revoke all on function ss_private.article_display_title(text,text,text,text,jsonb) from public,anon,authenticated,service_role;

do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.ss_api(text,jsonb)'::regprocedure);
 if strpos(definition,$old$coalesce(a.reference_meta->'review_snapshot'->>'title',a.title)$old$)=0 then raise exception 'Expected feed title expression is missing';end if;
 definition:=replace(definition,$old$coalesce(a.reference_meta->'review_snapshot'->>'title',a.title)$old$,$new$ss_private.article_display_title(a.url,a.kind,a.source,a.title,a.reference_meta)$new$);
 execute definition;
end;$migration$;
