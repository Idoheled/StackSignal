import test from "node:test";
import assert from "node:assert/strict";
let handler: (request: Request) => Promise<Response>;
const secret = "test-only-collector-secret-1234567890";
const environment: Record<string,string> = {SUPABASE_URL:"https://database.example",SUPABASE_SERVICE_ROLE_KEY:"test-service-key",COLLECTOR_SECRET:secret};
(globalThis as any).Deno = {
  env: { get: (key: string) => environment[key] },
  resolveDns: async () => ["8.8.8.8"],
  serve: (fn: typeof handler) => { handler = fn; },
};
await import("../supabase/functions/collector/index.ts");

test("collector authenticates, deduplicates releases, defers publisher limits, and keeps real discovery dates", async () => {
  const originalFetch = globalThis.fetch;
  let job: any, article: any, upstream = 200, active = true, oversized = false, oversizedAtPage = 1;
  const releaseRequests: string[] = [];
  const writes: {path:string;body:any}[] = [];
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u.hostname === "api.github.com") {
      if (upstream === 429) return new Response("",{status:429,headers:{"retry-after":"120"}});
      if (u.pathname === "/repos/a/b/releases") {
        releaseRequests.push(u.search);
        if (oversized) {
          if (u.searchParams.get("per_page") === "20") {
            if (Number(u.searchParams.get("page")) === oversizedAtPage) return new Response("",{headers:{"content-length":"2000001"}});
            return Response.json(Array.from({length:20},(_,i)=>({html_url:"https://github.com/a/b/releases/tag/v3rc"+i,tag_name:"v3rc"+i,prerelease:true,published_at:"2026-10-09T00:00:00Z"})));
          }
          assert.equal(u.searchParams.get("per_page"),"10");
          if (u.searchParams.get("page") === "1") return Response.json(Array.from({length:10},(_,i)=>({html_url:"https://github.com/a/b/releases/tag/v3rc"+i,tag_name:"v3rc"+i,prerelease:true,published_at:"2026-10-09T00:00:00Z"})));
          return Response.json([{html_url:"https://github.com/a/b/releases/tag/v2",tag_name:"v2",name:"v2",body:"Fix crash",published_at:"2026-10-09T00:00:00Z",prerelease:false}]);
        }
        assert.equal(u.searchParams.get("per_page"), "20", "release payloads must stay bounded");
        return Response.json([{html_url:"https://github.com/a/b/releases/tag/v2",tag_name:"v2",name:"v2",body:"Fix crash",published_at:"2026-10-09T00:00:00Z",prerelease:false}]);
      }
      assert.equal(u.pathname,"/search/repositories");
      return Response.json({items:[{full_name:"engineering/gpu-inference",description:"GPU inference serving with KV cache offloading",topics:["vllm"],owner:{login:"engineering"},created_at:"2020-01-01T00:00:00Z",pushed_at:"2026-10-09T00:00:00Z",stargazers_count:40,license:{spdx_id:"Apache-2.0"}}]});
    }
    assert.equal(u.hostname,"database.example");
    if (init?.method === "POST" || init?.method === "PATCH") writes.push({path:u.pathname,body});
    if (u.pathname.endsWith("ss_take_budget")) return Response.json(!body.budget_key.startsWith("maintenance:") && !body.budget_key.startsWith("repository-discovery:"));
    if (u.pathname.endsWith("ss_claim_jobs")) return Response.json([job]);
    if (u.pathname.endsWith("ss_feedback_weights")) return Response.json({});
    if (u.pathname.endsWith("ss_enqueue_sources")) return Response.json(null);
    if (u.pathname.endsWith("ss_queue_items")) return Response.json(body.items.length);
    if (u.pathname.endsWith("ss_settings")) return Response.json([{value:{repo_discovery:true,repo_queries:[],gemini_daily_limit:0,search_monthly_limit:0}}]);
    if (u.pathname.endsWith("ss_sources")) return Response.json([{id:"source",url:"https://api.github.com/repos/a/b/releases?per_page=10",name:"a/b",type:"github",active,revision:1,include_prereleases:false}]);
    if (u.pathname.endsWith("ss_articles")) {
      if (!body) return Response.json(article ? [article] : []);
      article = {id:"article",...article,...body};return Response.json([article]);
    }
    if (u.pathname.endsWith("ss_jobs")) return Response.json([body]);
    throw new Error("Unexpected request " + u.pathname);
  };
  const run = () => handler(new Request("https://collector.example",{method:"POST",headers:{"x-collector-secret":secret}}));
  try {
    assert.equal((await handler(new Request("https://collector.example",{method:"POST"}))).status,401);
    assert.equal(writes.length,0);
    job={id:"job",kind:"analyze",attempts:1,payload:{url:"https://github.com/a/b/releases/tag/v1",title:"v1",kind:"Release",summary:"Fix crash",published_at:"2026-10-09T00:00:00Z",reference_meta:{origin:"source_watch",source_id:"source",source_revision:1,alert_kind:"release"}}};
    assert.equal((await run()).status,200);
    assert(article.score>=80);
    assert.equal(article.reference_meta.alert_kind,"release");
    const n=writes.filter(x=>x.path.endsWith("ss_articles")).length;
    await run();
    assert.equal(writes.filter(x=>x.path.endsWith("ss_articles")).length,n,"unchanged release does not create another alert");
    active=false;job.payload.title="Changed while paused";await run();
    assert.equal(writes.filter(x=>x.path.endsWith("ss_articles")).length,n,"stale analyze jobs respect pause");
    active=true;job.payload.url="https://github.com/a/b/releases/tag/v2.0rc1";job.payload.reference_meta.prerelease=false;await run();
    assert.equal(writes.filter(x=>x.path.endsWith("ss_articles")).length,n,"old queued payloads also respect the stable release channel");
    job={id:"source-check",kind:"source",attempts:1,payload:{source_id:"source"}};
    await run();
    assert(writes.some(x=>x.path.endsWith("ss_queue_items")),"legacy release watches still queue release analysis");
    oversized=true;releaseRequests.length=0;await run();
    assert.deepEqual(releaseRequests,["?per_page=20&page=1","?per_page=10&page=1","?per_page=10&page=2"]);
    assert.equal(writes.filter(x=>x.path.endsWith("ss_queue_items")).at(-1)!.body.items.length,1,"stable releases behind prerelease pages are retained");
    assert(writes.some(x=>x.path.endsWith("ss_sources") && x.body.last_error===null));
    oversizedAtPage=2;releaseRequests.length=0;await run();
    assert.deepEqual(releaseRequests,["?per_page=20&page=1","?per_page=20&page=2","?per_page=10&page=1","?per_page=10&page=2"]);
    assert.equal(writes.filter(x=>x.path.endsWith("ss_queue_items")).at(-1)!.body.items.length,1,"oversized later pages restart safely at the smaller size");
    oversized=false;
    upstream=429;job={id:"rate-limit",kind:"source",attempts:1,payload:{source_id:"source"}};
    await run();
    const last=writes.filter(x=>x.path.endsWith("ss_jobs")).at(-1)!.body;
    assert.equal(last.status,"pending");assert.equal(last.attempts,0);assert(Date.parse(last.available_at)>Date.now()+60000);
    upstream=200;article=null;job={id:"discovery",kind:"discovery",attempts:1,payload:{lane:"repository",query:"gpu inference"}};
    await run();
    assert.equal(article.kind,"Repository");assert.equal(article.published_at,"2020-01-01T00:00:00.000Z");assert.equal(article.reference_meta.origin,"discovery");
    assert.equal(article.reference_meta.repository,"engineering/gpu-inference");
  } finally { globalThis.fetch=originalFetch; }
});

test("web discovery bounds requests, preserves snippet provenance, filters noise, and defers quotas", async () => {
  const originalFetch = globalThis.fetch;
  environment.TAVILY_API_KEY = "test-only-tavily-key";
  const query = "vLLM KV cache offloading benchmark";
  let status = 200, monthly = 800, allowDaily = true, existing = false;
  let searches = 0;
  let job: any = {id:"web-job",kind:"discovery",attempts:1,payload:{lane:"web",query,window:"recent"}};
  const writes: any[] = [];
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u.hostname === "api.tavily.com") {
      searches++;
      assert.equal(init?.redirect,"error");
      assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer test-only-tavily-key");
      assert.equal(body.search_depth,"basic");assert.equal(body.auto_parameters,false);
      assert.equal(body.include_answer,false);assert.equal(body.include_raw_content,false);
      assert.equal(body.include_published_date,true);assert.equal(body.time_range,"week");
      if (status !== 200) return new Response("",{status});
      return Response.json({results:[
        {title:"vLLM KV cache offloading benchmark",url:"https://docs.vllm.ai/en/latest/offloading?utm_source=search",content:"A reproducible benchmark explains how vLLM uses KV cache offloading to improve inference throughput and memory efficiency."},
        {title:"vLLM KV cache deployment guide",url:"https://independent-engineer.example/guide",content:"This guide explains KV cache offloading in vLLM inference with measurable latency and throughput outcomes."},
        {title:"My GPU Kubernetes portfolio",url:"https://github.com/person/portfolio",content:"My personal portfolio covering Kubernetes GPU operators, vLLM inference and KV cache deployments."},
        {title:"vLLM",url:"https://127.0.0.1/private",content:"A reproducible benchmark explains KV cache offloading for vLLM inference."},
      ]});
    }
    assert.equal(u.hostname,"database.example","search must not expand automatic fetch hosts");
    if (init?.method === "POST" || init?.method === "PATCH") writes.push({path:u.pathname,body});
    if (u.pathname.endsWith("ss_take_budget")) {
      assert(!body.budget_key.startsWith("search:") || body.max_count<=800);
      if (body.budget_key.startsWith("web-search-day:")) {assert.equal(body.max_count,24);return Response.json(allowDaily);}
      return Response.json(body.budget_key.startsWith("search:"));
    }
    if (u.pathname.endsWith("ss_claim_jobs")) return Response.json([job]);
    if (u.pathname.endsWith("ss_feedback_weights")) return Response.json({});
    if (u.pathname.endsWith("ss_enqueue_sources")) return Response.json(null);
    if (u.pathname.endsWith("ss_settings")) return Response.json(body ? [body] : u.searchParams.get("key")==="eq.profile" ? [{value:{queries:[query],search_monthly_limit:monthly,gemini_daily_limit:0,repo_discovery:false}}] : []);
    if (u.pathname.endsWith("ss_articles")) return Response.json(body ? [body] : existing ? [{id:"existing"}] : []);
    if (u.pathname.endsWith("ss_queue_item")) return Response.json(null);
    if (u.pathname.endsWith("ss_jobs")) return Response.json([body]);
    throw new Error("Unexpected request " + u.pathname);
  };
  const run=()=>handler(new Request("https://collector.example",{method:"POST",headers:{"x-collector-secret":secret}}));
  try {
    assert.equal((await run()).status,200);
    const articles=writes.filter(x=>x.path.endsWith("ss_articles"));
    assert.equal(articles.length,2);
    assert.equal(articles[0].body.url,"https://docs.vllm.ai/en/latest/offloading");
    assert.equal(articles[0].body.published_at,null,"no invented publisher date");
    assert.equal(articles[0].body.reference_meta.link_status,"search_result");
    assert.equal(articles[0].body.reference_meta.checked_at,undefined,"snippet is not a destination fetch");
    const extraction=writes.filter(x=>x.path.endsWith("ss_queue_item"));
    assert.equal(extraction.length,1);assert.match(extraction[0].body.item.url,/docs\.vllm\.ai/);
    const health=writes.filter(x=>x.path.endsWith("ss_settings")).at(-1).body.value;
    assert.equal(health.last_accepted,2);assert.equal(health.last_filtered,2);
    existing=true;await run();assert.equal(writes.filter(x=>x.path.endsWith("ss_articles")).length,2);
    status=429;await run();
    let deferred=writes.filter(x=>x.path.endsWith("ss_jobs")).at(-1).body;
    assert.equal(deferred.status,"pending");assert.equal(deferred.attempts,0);
    status=200;allowDaily=false;const before=searches;await run();assert.equal(searches,before);
    deferred=writes.filter(x=>x.path.endsWith("ss_jobs")).at(-1).body;assert.equal(deferred.status,"pending");
    monthly=0;await run();assert.equal(searches,before,"disabled search performs no provider call");
    monthly=800;allowDaily=true;job.payload.query="removed query";await run();assert.equal(searches,before,"queued obsolete queries do not run");
  } finally { globalThis.fetch=originalFetch;delete environment.TAVILY_API_KEY; }
});
