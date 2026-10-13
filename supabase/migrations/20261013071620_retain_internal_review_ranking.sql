-- Completed internal assessments own their displayed rank after publisher refreshes.
create function ss_private.retain_internal_review_ranking() returns trigger language plpgsql set search_path='' as $$
declare reviewed jsonb;
begin
 reviewed:=new.reference_meta->'evaluation';
 if reviewed->>'evaluator' in('assistant','policy') and jsonb_typeof(reviewed->'score')='number'
  and (reviewed->>'score')::numeric between 0 and 100
  and (reviewed->>'score')::numeric=trunc((reviewed->>'score')::numeric) then
  new.score:=(reviewed->>'score')::int;
 end if;
 return new;
end;$$;
revoke all on function ss_private.retain_internal_review_ranking() from public,anon,authenticated,service_role;
create trigger retain_internal_review_ranking before insert or update on public.ss_articles
 for each row execute function ss_private.retain_internal_review_ranking();

update public.ss_articles set score=(reference_meta->'evaluation'->>'score')::int
where reference_meta->'evaluation'->>'evaluator' in('assistant','policy')
 and score<>(reference_meta->'evaluation'->>'score')::int;
