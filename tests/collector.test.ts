import test from "node:test";
import assert from "node:assert/strict";
let handler: (request: Request) => Promise<Response>;
const healthFixture={checked_at:new Date().toISOString(),stars:400,watchers:10,recent_releases:3,latest_release:new Date().toISOString(),pushed_at:new Date().toISOString(),license:"Apache-2.0",active:true};
const secret = "test-only-collector-secret-1234567890";
const environment: Record<string,string> = {SUPABASE_URL:"https://database.example",SUPABASE_SERVICE_ROLE_KEY:"test-service-key",COLLECTOR_SECRET:secret};
(globalThis as any).Deno = {
  env: { get: (key: string) => environment[key] },
  resolveDns: async () => ["8.8.8.8"],
  serve: (fn: typeof handler) => { handler = fn; },
};
await import("../supabase/functions/collector/index.ts");

test("unchanged RSS feeds do not replay deleted links and changed feeds still queue",async()=>{
 const previous=globalThis.fetch;let source:any={id:"feed",url:"https://developer.nvidia.com/blog/feed/",active:true,type:"rss",revision:1,name:"NVIDIA",priority:1};
 let title="GPU infrastructure",batches=0;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input)),body=init?.body?JSON.parse(String(init.body)):undefined;
  if(url.hostname==="developer.nvidia.com")return new Response(`<rss><channel><item><title>${title}</title><link>https://developer.nvidia.com/blog/gpu-example/</link><description>GPU deployment details.</description></item></channel></rss>`);
  assert.equal(url.hostname,"database.example");
  if(url.pathname.endsWith("ss_take_budget"))return Response.json(false);
  if(url.pathname.endsWith("ss_claim_jobs"))return Response.json([{id:"job",kind:"source",attempts:1,payload:{source_id:"feed"}}]);
  if(url.pathname.endsWith("ss_feedback_weights"))return Response.json({});
  if(url.pathname.endsWith("ss_enqueue_sources"))return Response.json(null);
  if(url.pathname.endsWith("ss_queue_items")){batches++;return Response.json(body.items.length);}
  if(url.pathname.endsWith("ss_articles"))return Response.json([]);
  if(url.pathname.endsWith("ss_settings"))return Response.json(body?[body]:[{value:{repo_discovery:false,search_monthly_limit:0}}]);
  if(url.pathname.endsWith("ss_sources")){if(body)source={...source,...body};return Response.json([source]);}
  if(url.pathname.endsWith("ss_jobs"))return Response.json(body?[body]:[]);
  throw Error("Unexpected "+url.pathname);
 };
 const run=()=>handler(new Request("https://collector.example",{method:"POST",headers:{"x-collector-secret":secret}}));
 try{
  assert.equal((await run()).status,200);assert.equal(batches,1);assert.match(source.content_hash,/^[a-f0-9]{64}$/);
  assert.equal((await run()).status,200);assert.equal(batches,1,"a deleted article does not force an unchanged feed replay");
  title="Changed GPU infrastructure";assert.equal((await run()).status,200);assert.equal(batches,2,"changed source content remains discoverable");
 }finally{globalThis.fetch=previous;}
});

test("collection enriches short public excerpts while Gemini is paused",async()=>{
 const previous=globalThis.fetch, queued:any[]=[],patched:any[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input)),body=init?.body?JSON.parse(String(init.body)):undefined;
  assert.equal(url.hostname,"database.example");
  if(url.pathname.endsWith("ss_take_budget"))return Response.json(false);
  if(url.pathname.endsWith("ss_claim_jobs"))return Response.json([]);
  if(url.pathname.endsWith("ss_feedback_weights"))return Response.json({});
  if(url.pathname.endsWith("ss_enqueue_sources"))return Response.json(null);
  if(url.pathname.endsWith("ss_queue_item")){queued.push(body);return Response.json(null);}
  if(url.pathname.endsWith("ss_settings"))return Response.json(body?[body]:[{value:{repo_discovery:false,search_monthly_limit:0,gemini_mode:"off"}}]);
  if(url.pathname.endsWith("ss_articles")){
   if(body){patched.push(body);return Response.json([body]);}
   if(url.searchParams.get("select")==="url")return Response.json([]);
   assert.equal(url.searchParams.has("reference_meta->>public_evaluation_input"),false);
   return Response.json([
    {id:"short",url:"https://developer.nvidia.com/blog/example/",reference_meta:{public_evaluation_input:{text:"Short RSS excerpt"}}},
    {id:"full",url:"https://developer.nvidia.com/blog/full/",reference_meta:{public_evaluation_input:{text:"x".repeat(1800)}}},
    {id:"unsafe",url:"https://127.0.0.1/private",reference_meta:{}}
   ]);
  }
  throw Error("Unexpected "+url.pathname);
 };
 try{
  const response=await handler(new Request("https://collector.example",{method:"POST",headers:{"x-collector-secret":secret}}));
  assert.equal(response.status,200);assert.equal(queued.length,1);assert.equal(queued[0].item.url,"https://developer.nvidia.com/blog/example/");
  assert.deepEqual(patched.map(row=>row.reference_meta.public_extraction_requested),["queued","unsupported"]);
 }finally{globalThis.fetch=previous;}
});

test("collector authenticates, deduplicates releases, defers publisher limits, and keeps real discovery dates", async () => {
  const originalFetch = globalThis.fetch;
  let job: any, article: any, upstream = 200, active = true, oversized = false, oversizedAtPage = 1, allowEnrichment = true;
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
      return Response.json({items:[{full_name:"engineering/gpu-inference",description:"GPU inference serving with KV cache offloading",topics:["vllm"],owner:{login:"engineering"},created_at:"2020-01-01T00:00:00Z",pushed_at:"2026-10-09T00:00:00Z",stargazers_count:400,license:{spdx_id:"Apache-2.0"}}]});
    }
    assert.equal(u.hostname,"database.example");
    if (init?.method === "POST" || init?.method === "PATCH") writes.push({path:u.pathname,body});
    if (u.pathname.endsWith("ss_take_budget")) return Response.json((allowEnrichment || !body.budget_key.startsWith("github-enrichment:")) && !body.budget_key.startsWith("maintenance:") && !body.budget_key.startsWith("repository-discovery:") && !body.budget_key.startsWith("trending-discovery:") && !body.budget_key.startsWith("repo-health-queue:"));
    if (u.pathname.endsWith("ss_claim_jobs")) return Response.json([job]);
    if (u.pathname.endsWith("ss_feedback_weights")) return Response.json({});
    if (u.pathname.endsWith("ss_enqueue_sources")) return Response.json(null);
    if (u.pathname.endsWith("ss_queue_item")) return Response.json(null);
    if (u.pathname.endsWith("ss_queue_items")) return Response.json(body.items.length);
    if (u.pathname.endsWith("ss_settings") && u.searchParams.get("key")?.startsWith("eq.repo_health:")) return Response.json([{value:healthFixture}]);
    if (u.pathname.endsWith("ss_settings")) return Response.json([{value:{repo_discovery:true,repo_queries:[],gemini_daily_limit:0,search_monthly_limit:0}}]);
    if (u.pathname.endsWith("ss_sources")) return Response.json([{id:"source",url:"https://api.github.com/repos/a/b/releases?per_page=10",name:"a/b",type:"github",active,revision:1,include_prereleases:false}]);
    if (u.pathname.endsWith("ss_articles")) {
      if (!body && u.searchParams.has("reference_meta->>public_extraction_requested")) return Response.json([]);
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
    allowEnrichment=false;releaseRequests.length=0;await run();
    assert(releaseRequests.length>0,"source watches retain GitHub capacity when enrichment is exhausted");
    job={id:"metadata-limit",kind:"article",attempts:1,payload:{url:"https://github.com/a/b/releases/tag/v2"}};
    releaseRequests.length=0;await run();
    assert.equal(releaseRequests.length,0,"enrichment stops before consuming the capacity reserved for watches");
    assert.equal(writes.filter(x=>x.path.endsWith("ss_jobs")).at(-1)!.body.attempts,0);
    allowEnrichment=true;
    upstream=429;job={id:"rate-limit",kind:"source",attempts:1,payload:{source_id:"source"}};
    await run();
    const last=writes.filter(x=>x.path.endsWith("ss_jobs")).at(-1)!.body;
    assert.equal(last.status,"pending");assert.equal(last.attempts,0);assert(Date.parse(last.available_at)>Date.now()+60000);
    assert.equal(writes.filter(x=>x.path.endsWith("ss_sources") && x.body.last_error).at(-1)!.body.last_error_kind,"deferred");
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
    if (u.pathname.endsWith("ss_articles")) return Response.json(body ? [body] : u.searchParams.has("reference_meta->>public_extraction_requested") ? [] : existing ? [{id:"existing"}] : []);
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
    const health=writes.filter(x=>x.path.endsWith("ss_settings") && x.body.key==="web_discovery_health").at(-1).body.value;
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

test("semantic sweep is cached, comparison-only, private-context safe and pauses without retries", async()=>{
  const originalFetch=globalThis.fetch;
  environment.GEMINI_API_KEY="test-only-gemini-key";
  const excerpt="This reproducible guide configures KV cache offloading and compares latency under controlled request concurrency.";
  const source={title:"Cache engineering",text:excerpt,scope:"search_snippet"};
  let mode="shadow", daily=4, provider=200, calls=0, row:any={discovered_at:"2026-10-10T00:00:00Z",url:"https://kubernetes.io/public-guide",id:"public-article",score:70,kind:"Discovery",content_hash:"a".repeat(64),reference_meta:{repo_health:healthFixture,public_evaluation_input:source}};
  let health:any={}, used=0, race=false, lastAttempt:string|undefined;
  const writes:any[]=[];
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input)), body=init?.body?JSON.parse(String(init.body)):undefined;
    if(url.hostname==="generativelanguage.googleapis.com") {
      calls++;
      assert.equal(url.pathname,"/v1beta/models/gemini-flash-latest:generateContent");
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"),"test-only-gemini-key");
      assert.equal(init?.redirect,"error");assert.equal(body.generationConfig.maxOutputTokens,900);assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,"LOW");
      assert(!JSON.stringify(body).includes("private.internal"));assert.equal("tools" in body,false);
      if(provider!==200) return new Response("provider details should not be exposed",{status:provider});
      return Response.json({modelVersion:"gemini-3.8-flash",candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({results:[{id:"public-article",assessment:{topic:"Inference",score:90,confidence:"high",depth:"advanced",decision:"useful",summary:"Cache comparison.",reason:"Applicable engineering.",action:"Review controlled latency measurements.",evidence:"configures KV cache offloading"}}]})}]}}],usageMetadata:{promptTokenCount:500,candidatesTokenCount:100}});
    }
    assert.equal(url.hostname,"database.example");
    if(url.pathname.endsWith("ss_take_budget")) return Response.json(false);
    if(url.pathname.endsWith("ss_feedback_weights")) return Response.json({});
    if(url.pathname.endsWith("ss_enqueue_sources")) return Response.json(null);
    if(url.pathname.endsWith("ss_claim_jobs")) return Response.json([]);
    if(url.pathname.endsWith("ss_finish_evaluation_request")) return Response.json(null);
    if(url.pathname.endsWith("ss_evaluation_pipeline")) return Response.json({});
    if(url.pathname.endsWith("ss_review_coverage")) return Response.json({});
    if(url.pathname.endsWith("ss_evaluation_candidates")) return Response.json(row.reference_meta.evaluation ? [] : [row]);
    if(url.pathname.endsWith("ss_evaluation_usage")) return Response.json({used_24h:used,used_month:used,last_attempt:lastAttempt});
    if(url.pathname.endsWith("ss_reserve_evaluation_batch")) {assert(body.daily_max<=16);assert(body.monthly_max<=496);used++;return Response.json({request_id:used,items:body.items});}
    if(url.pathname.endsWith("ss_settings")) {
      if(body) {if(body.key==="evaluation_health") health=body.value;return Response.json([body]);}
      if(url.searchParams.get("key")==="eq.profile") return Response.json([{value:{gemini_mode:mode,gemini_daily_limit:daily,gemini_monthly_limit:100,repo_discovery:false,interests:"vLLM, private.internal",search_monthly_limit:0}}]);
      if(url.searchParams.get("key")==="eq.evaluation_health") return Response.json([{value:health}]);
      return Response.json([]);
    }
    if(url.pathname.endsWith("ss_articles")) {
      if(init?.method==="HEAD") return new Response(null,{headers:{"content-range":"0-0/1"}});
      if(!url.searchParams.has("id")) {
        assert.equal(url.searchParams.has("discovered_at"),false,"older public discoveries remain eligible");
        assert.equal(url.searchParams.get("order"),"discovered_at.asc,id.asc");
        if(row.reference_meta.evaluation) return Response.json([]);
      }
      if(body) {writes.push(body);row={...row,...body};return Response.json([row]);}
      return Response.json([{...row,...(race && url.searchParams.has("id")?{content_hash:"changed"}:{})}]);
    }
    throw Error("Unexpected "+url.pathname);
  };
  const run=()=>handler(new Request("https://collector.example",{method:"POST",headers:{"x-collector-secret":secret},body:JSON.stringify({mode:"evaluation"})}));
  try {
    await run();assert.equal(calls,1);assert.equal(writes[0].score,undefined);assert.equal(row.score,70);
    assert.equal(row.reference_meta.evaluation.ai_score,undefined);assert.equal(row.reference_meta.evaluation.score,90);
    assert.equal(row.reference_meta.evaluation.model,"gemini-flash-latest");assert.equal(row.reference_meta.evaluation.resolved_model,"gemini-3.8-flash");
    assert.equal(health.resolved_model,"gemini-3.8-flash");assert.equal(health.comparisons[0].resolved_model,"gemini-3.8-flash");
    assert.equal(health.comparisons[0].rules_score,70);assert.equal(health.comparisons[0].applied_score,70);
    await run();assert.equal(calls,1,"matching input is cached without another reservation or call");
    lastAttempt=new Date().toISOString();await run();assert.equal(calls,1,"monthly pacing survives subsequent ticks");assert.equal(health.state,"pacing_wait");
    lastAttempt=undefined;row.reference_meta.evaluation=undefined;mode="rerank";await run();assert.equal(row.score,84);assert.equal(row.analysis_status,"ai");
    row.reference_meta.evaluation=undefined;race=true;const before=writes.length;await run();assert.equal(writes.length,before,"changed content is not overwritten");
    race=false;used=0;provider=429;await run();assert.equal(health.state,"cooldown");assert(row.reference_meta.evaluation_failed_at,"failed inputs remain visible for inspection without retrying");assert(!JSON.stringify(health).includes("provider details"));
    const after=calls;await run();assert.equal(calls,after,"provider errors are not automatically retried");
    daily=0;health={};await run();assert.equal(calls,after,"paused integration makes no provider calls");
    daily=4;provider=503;used=0;health={};row.reference_meta.evaluation_failed_at=undefined;await run();
    assert.equal(health.state,"cooldown");
    assert(Date.parse(health.cooldown_until)<=Date.now()+901000,"transient capacity errors back off for fifteen minutes, not a day");
  } finally {globalThis.fetch=originalFetch;delete environment.GEMINI_API_KEY;}
});

test("multi-link batches save independent valid reviews and withhold an invalid neighbor",async()=>{
  const savedFetch=globalThis.fetch;environment.GEMINI_API_KEY="test-batch-key";
  const excerpt="A reproducible inference benchmark configures KV cache offloading and documents controlled concurrency.";
  const rows=["one","two","three","rejected"].map(id=>({id,url:"https://github.com/a/"+id,score:70,kind:id==="two" ? "Release" : "Article",content_hash:id,reference_meta:{repo_health:healthFixture,public_evaluation_input:{title:id,text:excerpt,scope:"publisher_excerpt"},...(id==="two"?{alert_kind:"release"}:{})}}));
  let health:any={},calls=0,reservations=0;
  globalThis.fetch=async(input,init)=>{
    const u=new URL(String(input)),body=init?.body?JSON.parse(String(init.body)):undefined;
    if(u.hostname==="generativelanguage.googleapis.com") {
      calls++;const inputs=JSON.parse(body.contents[0].parts[0].text).public_sources;
      assert.equal(inputs.length,4);assert.equal(body.generationConfig.maxOutputTokens,3600);
      const results=inputs.map((i:any)=>({id:i.id,assessment:{topic:"Inference",score:85,confidence:"high",depth:"advanced",decision:i.id==="rejected" ? "tangential" : "useful",summary:"Controlled cache benchmark.",reason:"Useful infrastructure experiment.",action:"Compare concurrency conditions.",evidence:i.id==="three" ? "Fabricated unrelated evidence" : "configures KV cache offloading"}}));
      return Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({results:results.reverse()})}]}}]});
    }
    if(u.pathname.endsWith("ss_take_budget")) return Response.json(false);
    if(u.pathname.endsWith("ss_enqueue_sources")) return Response.json(null);
    if(u.pathname.endsWith("ss_claim_jobs")) return Response.json([]);
    if(u.pathname.endsWith("ss_feedback_weights")) return Response.json({});
    if(u.pathname.endsWith("ss_finish_evaluation_request")) return Response.json(null);
    if(u.pathname.endsWith("ss_evaluation_pipeline")) return Response.json({});
    if(u.pathname.endsWith("ss_review_coverage")) return Response.json({});
    if(u.pathname.endsWith("ss_evaluation_candidates")) return Response.json(rows.filter((r:any)=>!r.reference_meta.evaluation&&!r.reference_meta.evaluation_failed_at));
    if(u.pathname.endsWith("ss_evaluation_usage")) return Response.json({used_24h:reservations,used_provider_day:reservations,used_month:reservations});
    if(u.pathname.endsWith("ss_reserve_evaluation_batch")) {reservations++;return Response.json({request_id:reservations,items:body.items});}
    if(u.pathname.endsWith("ss_settings")) {
      if(u.searchParams.get("key")?.startsWith("eq.repo_health:")) return Response.json([{value:healthFixture}]);
      if(body) {if(body.key==="evaluation_health") health=body.value;return Response.json([body]);}
      return Response.json([{value:u.searchParams.get("key")==="eq.profile" ? {gemini_mode:"rerank",gemini_daily_limit:16,gemini_monthly_limit:496,repo_discovery:false,search_monthly_limit:0} : health}]);
    }
    if(u.pathname.endsWith("ss_articles")) {
      if(init?.method==="HEAD") return new Response(null,{headers:{"content-range":"0-0/3"}});
      if(u.searchParams.get("reference_meta->>public_evaluation_input")==="is.null") return Response.json([]);
      const id=u.searchParams.get("id")?.replace("eq.","");
      if(id) {const row=rows.find(r=>r.id===id)!;if(body) Object.assign(row,body);return Response.json([row]);}
      return Response.json(rows.filter((r:any)=>!r.reference_meta.evaluation&&!r.reference_meta.evaluation_failed_at));
    }
    throw Error("Unexpected "+u.pathname);
  };
  try {
    await handler(new Request("https://collector.example",{method:"POST",headers:{"x-collector-secret":secret},body:JSON.stringify({mode:"evaluation"})}));
    assert.equal(calls,1);assert.equal(reservations,1);
    assert.equal((rows[0].reference_meta as any).evaluation.score,85);
    assert.equal((rows[1].reference_meta as any).evaluation.score,85,"followed releases are independently reviewed");
    assert.equal((rows[2].reference_meta as any).evaluation,undefined);
    assert((rows[2].reference_meta as any).evaluation_failed_at);
    assert((rows[2].reference_meta as any).evaluation_retry_at);
    assert.equal(health.state,"partial_batch");assert.equal(health.last_batch_reviewed,3,"valid non-selected decisions still count as completed work");
    assert.equal(health.comparisons.length,2);
    assert(!JSON.stringify(health.comparisons).includes('"rejected"'),"a completed rejected decision must not be re-saved in health comparisons");
  } finally {globalThis.fetch=savedFetch;delete environment.GEMINI_API_KEY;}
});

test("official OpenShift detail payloads allow bounded large changelogs and still reject oversized responses",async()=>{
  const originalFetch=globalThis.fetch;
  const source={id:"openshift-test",name:"OpenShift preview",type:"openshift",url:"https://amd64.ocp.releases.ci.openshift.org/api/v1/releasestream/4-dev-preview/tags",revision:1,active:true,include_prereleases:true,priority:"core"};
  const writes:any[]=[];
  let oversized=false;
  globalThis.fetch=async(input,init)=>{
    const u=new URL(String(input)),body=init?.body?JSON.parse(String(init.body)):undefined;
    if(u.hostname==="amd64.ocp.releases.ci.openshift.org") {
      if(u.pathname.endsWith('/tags')) return Response.json({tags:[{name:'4.23.0-ec.1',phase:'Accepted'}]});
      if(oversized) return new Response('',{headers:{'content-length':'8000001'}});
      return Response.json({name:'4.23.0-ec.1',phase:'Accepted',changeLog:btoa('Created: 2026-10-10 12:00:00 +0000\nGPU Kubernetes resource allocation'),padding:'x'.repeat(2_100_000)});
    }
    assert.equal(u.hostname,'database.example');
    if(init?.method==='POST'||init?.method==='PATCH') writes.push({path:u.pathname,body});
    if(u.pathname.endsWith('ss_take_budget')) return Response.json(false);
    if(u.pathname.endsWith('ss_enqueue_sources')) return Response.json(null);
    if(u.pathname.endsWith('ss_feedback_weights')) return Response.json({});
    if(u.pathname.endsWith('ss_claim_jobs')) return Response.json([{id:'openshift-job',kind:'source',attempts:1,payload:{source_id:source.id}}]);
    if(u.pathname.endsWith('ss_sources')) return Response.json(body?[body]:[source]);
    if(u.pathname.endsWith('ss_articles')) return Response.json([]);
    if(u.pathname.endsWith('ss_settings')) return Response.json(body?[body]:u.searchParams.get('key')==='eq.profile'?[{value:{repo_discovery:false,gemini_daily_limit:0,search_monthly_limit:0}}]:[]);
    if(u.pathname.endsWith('ss_queue_items')||u.pathname.endsWith('ss_jobs')) return Response.json(null);
    throw new Error('Unexpected request '+u.pathname);
  };
  try {
    const run=()=>handler(new Request('https://collector.example',{method:'POST',headers:{'x-collector-secret':secret}}));
    assert.equal((await run()).status,200);
    const queued=writes.find(x=>x.path.endsWith('ss_queue_items')).body.items;
    assert.equal(queued.length,1);assert.equal(queued[0].title,'OpenShift 4.23.0-ec.1');assert.equal(queued[0].reference_meta.prerelease,true);
    assert.equal(queued[0].published_at,'2026-10-10T12:00:00.000Z');
    oversized=true;await run();
    assert.equal(writes.filter(x=>x.path.endsWith('ss_queue_items')).length,1,'oversized official payloads never create partial fabricated releases');
    assert.equal(writes.filter(x=>x.path.endsWith('ss_sources')).at(-1).body.last_error,'Source exceeds size limit');
  } finally {globalThis.fetch=originalFetch;}
});

test("independent evaluator recovers twelve-link provider failures without abandoning inputs or spending from collection",async()=>{
  const previous=globalThis.fetch;environment.GEMINI_API_KEY="test-recovery-key";
  const excerpt="A reproducible inference benchmark configures KV cache offloading under controlled concurrency.";
  const rows=Array.from({length:12},(_,i)=>({id:String(i),url:"https://kubernetes.io/recovery-"+i,score:75,kind:"Article",discovered_at:"2026-10-10T00:00:00Z",content_hash:String(i),reference_meta:{public_evaluation_input:{title:"Public benchmark",text:excerpt,scope:"publisher_excerpt"},evaluation_failures:8} as any}));
  let health:any={},calls=0,used=0,provider="503";
  const finishes:any[]=[];
  globalThis.fetch=async(input,init)=>{
    const u=new URL(String(input)),body=init?.body?JSON.parse(String(init.body)):undefined;
    if(u.hostname==="generativelanguage.googleapis.com") {
      calls++;const sources=JSON.parse(body.contents[0].parts[0].text).public_sources;
      if(provider==="503") {assert.equal(sources.length,12);return new Response("",{status:503,headers:{"retry-after":"600"}});}
      if(provider==="timeout") throw new DOMException("Signal timed out.","TimeoutError");
      assert.equal(sources.length,6);
      return Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({results:sources.map((x:any)=>({id:x.id,assessment:{topic:"Inference",score:90,confidence:"high",depth:"advanced",decision:"useful",summary:"Controlled cache benchmark.",reason:"Relevant cache engineering.",action:"Compare concurrency settings.",evidence:"configures KV cache offloading"}}))})}]}}]});
    }
    if(u.pathname.endsWith("ss_settings")) {
      if(body) {if(body.key==="evaluation_health") health=body.value;return Response.json([body]);}
      return Response.json([{value:u.searchParams.get("key")==="eq.profile" ? {gemini_mode:"rerank",gemini_daily_limit:16,gemini_monthly_limit:496,repo_discovery:false} : health}]);
    }
    if(u.pathname.endsWith("ss_evaluation_usage")) return Response.json({used_month:used,used_24h:used,used_provider_day:used});
    if(u.pathname.endsWith("ss_evaluation_candidates")) return Response.json(rows.filter(r=>!r.reference_meta.evaluation));
    if(u.pathname.endsWith("ss_reserve_evaluation_batch")) return Response.json({request_id:++used,items:body.items});
    if(u.pathname.endsWith("ss_finish_evaluation_request")) {finishes.push(body);return Response.json(null);}
    if(u.pathname.endsWith("ss_articles")) {
      if(u.searchParams.get("reference_meta->>public_evaluation_input")==="is.null") return Response.json([]);
      const row=rows.find(r=>r.id===u.searchParams.get("id")?.replace("eq.",""));
      if(row) {if(body) Object.assign(row,body);return Response.json([row]);}
      return Response.json([]);
    }
    if(u.pathname.endsWith("ss_take_budget")) return Response.json(false);
    if(u.pathname.endsWith("ss_claim_jobs")) return Response.json([]);
    if(u.pathname.endsWith("ss_feedback_weights")||u.pathname.endsWith("ss_review_coverage")||u.pathname.endsWith("ss_evaluation_pipeline")) return Response.json({});
    if(u.pathname.endsWith("ss_enqueue_sources")) return Response.json(null);
    throw Error("Unexpected "+u.pathname);
  };
  const run=(mode:string)=>handler(new Request("https://collector.example",{method:"POST",headers:{"x-collector-secret":secret},body:JSON.stringify({mode})}));
  try {
    assert.equal((await run("collection")).status,200);assert.equal(calls,0);assert.equal(used,0);
    assert.equal((await run("evaluation")).status,200);assert.equal(calls,1);
    assert(rows.every(r=>r.reference_meta.evaluation_failures===9 && r.reference_meta.evaluation_retry_at && r.reference_meta.evaluation_error_kind==="transient"));
    await run("evaluation");assert.equal(calls,1,"persisted cooldown prevents an immediate retry");
    health.cooldown_until=null;provider="timeout";await run("evaluation");assert.equal(health.target_batch_size,6);assert.equal(finishes[1].outcome,"transient");
    assert(rows.every(r=>r.reference_meta.evaluation_retry_at),"ten outages never exhaust per-link retries");
    health.cooldown_until=null;provider="ok";await run("evaluation");
    assert.equal(finishes[2].reviewed,6);assert.equal(finishes[2].outcome,"success");assert.equal(health.target_batch_size,9);
    assert.equal(rows.filter(r=>r.reference_meta.evaluation).length,6);assert.equal(used,3,"failed calls stay in request accounting");
  } finally {globalThis.fetch=previous;delete environment.GEMINI_API_KEY;}
});

test("24-hour local failover is independent of Gemini configuration and commits bounded batches",async()=>{
 const previous=globalThis.fetch;environment.GEMINI_API_KEY="must-not-be-used";
 const text="The implementation configures KV cache offloading over NIXL to NVMe. The benchmark measures TTFT and throughput under concurrent long-context requests. The kernel reuses cached blocks and isolates memory for multiple tenants. This documentation specifies configuration prerequisites and tests recovery behavior.";
 const old=new Date(Date.now()-25*3600000).toISOString(),fresh=new Date().toISOString();
 const rows=Array.from({length:201},(_,i)=>({id:String(i),url:"https://kubernetes.io/local-"+i,topic:"Inference",discovered_at:old,content_hash:String(i),reference_meta:{public_evaluation_input:{title:"Public cache implementation",scope:"publisher_excerpt",text}}}));
 rows.push({id:"fresh",url:"https://unknown.example/fresh",topic:"Inference",discovered_at:fresh,content_hash:"fresh",reference_meta:{public_evaluation_input:{title:"Ambiguous fresh snippet",scope:"search_snippet",text}}});
 const batches:any[]=[],health:any[]=[];
 globalThis.fetch=async(input,init)=>{
  const u=new URL(String(input)),body=init?.body?JSON.parse(String(init.body)):undefined;
  assert.equal(u.hostname,"database.example","local failover must never contact Google or any external model");
  if(u.pathname.endsWith("ss_settings")){if(body){health.push(body);return Response.json([body]);}return Response.json([{value:u.searchParams.get("key")==="eq.profile" ? {gemini_mode:"off",gemini_daily_limit:0} : {}}]);}
  if(u.pathname.endsWith("ss_promote_overdue_link_jobs")){assert.equal(body.batch_size,500);return Response.json({promoted:0,cleared:0});}
  if(u.pathname.endsWith("ss_internal_review_candidates")) {assert.equal(body.batch_size,500);return Response.json(rows);}
  if(u.pathname.endsWith("ss_commit_internal_reviews")){batches.push(body.items);assert(body.items.every((x:any)=>x.evaluator==="policy"&&x.completion_path==="sla_failover"));return Response.json({committed:body.items.length,skipped:0});}
  if(u.pathname.endsWith("ss_evaluation_pipeline")||u.pathname.endsWith("ss_review_coverage"))return Response.json({});
  throw Error("Unexpected "+u.pathname);
 };
 try {
  const response=await handler(new Request("https://collector.example",{method:"POST",headers:{"x-collector-secret":secret},body:JSON.stringify({mode:"internal_review"})}));
  assert.equal(response.status,200);assert.equal((await response.json()).committed,201);assert.deepEqual(batches.map(x=>x.length),[200,1]);
  assert(!batches.flat().some((x:any)=>x.id==="fresh"));assert(health.some(x=>x.value.internal_review?.after_hours===24));
 } finally {globalThis.fetch=previous;delete environment.GEMINI_API_KEY;}
});
