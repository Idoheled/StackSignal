import test from "node:test";
import assert from "node:assert/strict";
let handler: (request: Request) => Promise<Response>;
const secret = "test-only-collector-secret-1234567890";
(globalThis as any).Deno = {
  env: { get: (key: string) => ({SUPABASE_URL:"https://database.example",SUPABASE_SERVICE_ROLE_KEY:"test-service-key",COLLECTOR_SECRET:secret}[key]) },
  resolveDns: async () => ["8.8.8.8"],
  serve: (fn: typeof handler) => { handler = fn; },
};
await import("../supabase/functions/collector/index.ts");

test("collector authenticates, deduplicates releases, defers publisher limits, and keeps real discovery dates", async () => {
  const originalFetch = globalThis.fetch;
  let job: any, article: any, upstream = 200, active = true;
  const writes: {path:string;body:any}[] = [];
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u.hostname === "api.github.com") {
      if (upstream === 429) return new Response("",{status:429,headers:{"retry-after":"120"}});
      if (u.pathname === "/repos/a/b/releases") {
        assert.equal(u.searchParams.get("per_page"), "100", "legacy per_page=10 must not truncate the release check");
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
