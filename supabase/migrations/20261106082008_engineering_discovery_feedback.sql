-- The issue scan watermark belongs to the watch and is invalidated by a repository change.
alter table public.ss_sources
  add column issue_scan_at timestamptz,
  add column issue_scan_repository text;

-- Closed technical vocabulary. Only these facet IDs can select shared discovery queries.
create function ss_private.interest_facets(headline text, excerpt text) returns text[]
language sql immutable set search_path='' as $$
 select array(select facet from (values
   ('cluster-dns', '\m(coredns|kube-dns|dns resolution|dns initialization|etcd|node-local dns)\M'),
   ('packet-path', '\m(tcp|envoy|cilium|conntrack|packet capture|packet loss|network polic(y|ies)|kube-proxy)\M'),
   ('gpu-fabric', '\m(rdma|roce|nccl|infiniband|gpudirect|priority flow control|lossless fabric|deepep)\M'),
   ('inference-routing', '\m(kv[ -]cache|prefix cach[ei][a-z]*|inference control plane|inference gateway|token rate limit[a-z]*|disaggregated inference)\M'),
   ('inference-runtime', '\m(vllm|sglang|llm-d|nixl|tensorrt-llm|lmcache|dynamo|inference scheduler|cuda graph[a-z]*)\M'),
   ('gpu-platform', '\m(openshift|hypershift|kubevirt|gpu operator|network operator|gpu scheduling|bare[ -]metal provisioning|redfish)\M'),
   ('storage', '\m(nvme|lvm[o]?|csi driver[a-z]*|persistent volumes?|storage offload[a-z]*|object storage)\M'),
   ('hardware', '\m(numa|pcie|firmware|bios|connectx[a-z0-9-]*|nvidia h[0-9]+|iommu)\M'),
   ('model-optimization', '\m(quantization|speculative decoding|expert parallelism|mixture of experts|moe|attention kernels?)\M'),
   ('observability', '\m(dcgm|opentelemetry|prometheus|grafana|ebpf tracing|distributed tracing)\M')
 ) as rules(facet,pattern)
 where concat_ws(' ',left(headline,500),left(excerpt,6000)) ~* pattern);
$$;

create function ss_private.interest_format(kind text, meta jsonb, title text) returns text
language sql immutable set search_path='' as $$
 select case
   when kind='Issue' then 'repository_issue'
   when kind='Release' then 'release'
   when kind='Incident' or meta->>'engineering_class'='incident'
     or title ~* '\m(postmortem|incident report|outage|network mystery)\M' then 'incident'
   when kind='Repository' or meta->>'engineering_class'='project_launch'
     or title ~* '\m(introducing|open.sourcing|initial release)\M' then 'project_launch'
   else kind
 end;
$$;

alter table public.ss_articles add column interest_facets text[] generated always as
 (ss_private.interest_facets(coalesce(reference_meta->'public_evaluation_input'->>'title',title),
   reference_meta->'public_evaluation_input'->>'text')) stored;

create index ss_feedback_recent_preferences on public.ss_feedback(user_id,updated_at desc,article_id)
 where liked or hidden;

-- One current example per person and article. A hide takes precedence until restored.
create function ss_private.interest_examples(member uuid)
returns table(article_id uuid, facets text[], tags text[], format text, vote int)
language sql stable set search_path='' as $$
 select a.id,a.interest_facets,a.tags,ss_private.interest_format(a.kind,a.reference_meta,a.title),
   case when f.hidden then -1 else 1 end
 from public.ss_feedback f join public.ss_articles a on a.id=f.article_id
 where f.user_id=member and (f.liked or f.hidden)
   and f.updated_at>=now()-interval '90 days' and a.deleted_at is null
 order by f.updated_at desc,f.article_id limit 160;
$$;

-- Only the owner (the single admin) can steer shared search. Other votes personalize
-- only that member's feed. Active watches contribute a small signal per distinct facet.
create function public.ss_discovery_preferences() returns jsonb
language sql stable security definer set search_path='' as $$
 with owner_examples as (
   select e.*,a.reference_meta from public.ss_members m
   cross join lateral ss_private.interest_examples(m.id) e
   join public.ss_articles a on a.id=e.article_id
   where m.role='admin' and m.active and jsonb_typeof(a.reference_meta->'public_evaluation_input')='object'
 ), watch_facets as (
   select distinct facet from public.ss_sources s
   cross join lateral unnest(ss_private.interest_facets(
     replace(regexp_replace(split_part(s.url,'?',1),'^https://[^/]+/',''),'-',' '),
     case s.topic when 'Inference' then 'vllm' when 'Networking' then 'cilium'
       when 'Platforms' then 'openshift' when 'Hardware' then 'numa'
       when 'Operations' then 'prometheus' end
   )) as facet
   where s.active
 ), signals as (
   select facet,2*e.vote as weight from owner_examples e
   cross join lateral unnest(ss_private.interest_facets(e.reference_meta->'public_evaluation_input'->>'title',
     e.reference_meta->'public_evaluation_input'->>'text')) as facet
   union all select facet,1 from watch_facets
 ), totals as (
   select facet,greatest(-8,least(8,sum(weight))) as weight from signals group by facet
 )
 select coalesce(jsonb_object_agg(facet,weight),'{}'::jsonb) from totals;
$$;

revoke all on function ss_private.interest_facets(text,text),ss_private.interest_format(text,jsonb,text),
  ss_private.interest_examples(uuid) from public,anon,authenticated,service_role;
grant execute on function ss_private.interest_facets(text,text) to service_role;
revoke all on function public.ss_discovery_preferences() from public,anon,authenticated;
grant execute on function public.ss_discovery_preferences() to service_role;

-- Reuse the guarded feed RPC, leaving its review policy, pagination and display score intact.
do $migration$
declare definition text; original text;
begin
 definition:=pg_get_functiondef('public.ss_api(text,jsonb)'::regprocedure);
 original:='), current_releases as materialized (select ss_private.current_release_ids(profile) as id), matched as (';
 if strpos(definition,original)=0 then raise exception 'Expected feed CTE is missing';end if;
 definition:=replace(definition,original,$new$
  ), current_releases as materialized (select ss_private.current_release_ids(profile) as id),
  preferences as materialized (select * from ss_private.interest_examples(uid) where action='feed'),
  watched_sources as materialized (
    select id::text as id, lower(substring(url from '^https://api[.]github[.]com/repos/([^/]+/[^/]+)/releases([?]|$)')) as repo
    from public.ss_sources where active and action='feed'
  ), matched as ($new$);
 original:=$old$greatest(-12,least(12,coalesce((select sum(case when x.liked then 2 when x.hidden then -2 else 0 end) from public.ss_feedback x join public.ss_articles y on x.article_id=y.id where x.user_id=uid and (y.topic=a.topic or y.tags && a.tags)),0)))$old$;
 if strpos(definition,original)=0 then raise exception 'Expected feed ranking expression is missing';end if;
 definition:=replace(definition,original,$new$greatest(-12,least(12,
   coalesce((select sum(e.vote * case when e.format=ss_private.interest_format(a.kind,a.reference_meta,a.title) then 4 else 1 end)
     from preferences e where e.article_id<>a.id and (
       e.facets && a.interest_facets or
       (select count(distinct tag) from unnest(e.tags) tag
         where tag=any(a.tags) and tag not in('gpu','kubernetes','llm','network','kernel','operator','benchmark','gateway','latency','agent'))>=2
     )),0) +
   case when exists(select 1 from watched_sources s
      where s.id=a.reference_meta->>'source_id'
      or s.repo=lower(substring(a.url from '^https://github[.]com/([^/]+/[^/?#]+)'))) then 2 else 0 end
 ))$new$);
 execute definition;
end;
$migration$;
