// Deploy with --no-verify-jwt. This endpoint authenticates its own 256-bit cron secret.
import {
  TRUSTED_HOSTS,
  safeURL,
  publicIPv4,
  textOnly,
  dateISO,
  htmlMeta,
  parseFeed,
  meaningfulChange,
} from "../_shared/content.ts";
import { canonicalLink } from "../../../lib/links.ts";
import { githubItems, githubAPIForLink, isPrerelease } from "../_shared/github.ts";
import { repositorySearchURL, DEFAULT_REPO_QUERIES } from "../../../lib/source-config.ts";
import { relevance } from "../_shared/relevance.ts";
import { webCandidate, webSearchRequest, lowValueDiscovery } from "../_shared/web-discovery.ts";
import { EVALUATOR_VERSION, EVALUATION_MODEL, publicInput, publicTeam, evaluationRequest, parseEvaluation, effectiveScore, evaluationCandidates, candidateLane, nextEvaluationAt, samePublicInput, batchEvaluationRequest, parseBatchEvaluation, MAX_BATCH_SIZE, DAILY_REQUEST_CAP, MONTHLY_REQUEST_CAP, EVALUATION_TIMEOUT_MS, evaluationFailure, evaluationBatchSize } from "../_shared/evaluation.ts";
import { repositoryHealth, repositoryAdmitted, articleRepositoryAdmitted, repositoryName, trendingProjects } from "../_shared/repository-health.ts";
import { openshiftWatchURL, openshiftTags, openshiftItem } from "../_shared/openshift.ts";
import { internalReview, immediateInternalReview, INTERNAL_REVIEW_DELAY_MS } from "../_shared/internal-review.ts";
class Deferred extends Error { retryAt: number; constructor(message: string, retryAt = Date.now() + 3600000) { super(message); this.retryAt = retryAt; } }
class SourceTooLarge extends Error { constructor() { super("Source exceeds size limit"); } }
const env = (k: string) => Deno.env.get(k) || "";
const SUPABASE = env("SUPABASE_URL"),
  KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const hosts = [
  ...TRUSTED_HOSTS,
  ...env("COLLECTOR_ALLOWED_HOSTS")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
];
async function digest(s: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function db(path: string, method = "GET", body?: unknown, prefer = "return=representation") {
  const r = await fetch(SUPABASE + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: KEY,
      Authorization: "Bearer " + KEY,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error("Database operation failed");
  return r.status === 204 ? null : await r.json();
}
const rpc = (name: string, body: unknown = {}) =>
  db("rpc/" + name, "POST", body);
async function budget(key: string, max: number, seconds: number) {
  if (max <= 0) return false;
  return await rpc("ss_take_budget", {
    budget_key: key,
    max_count: max,
    window_seconds: seconds,
  });
}
async function bodyText(res: Response, maxBytes=2_000_000) {
  if (Number(res.headers.get("content-length") || 0) > maxBytes) {
    await res.body?.cancel();
    throw new SourceTooLarge();
  }
  const reader = res.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new SourceTooLarge();
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return new TextDecoder().decode(bytes);
}
async function fetchPublic(input: string, etag?: string, maxBytes=2_000_000, lane: "source" | "enrichment" = "enrichment") {
  let url = safeURL(input, hosts);
  for (let hop = 0; hop < 4; hop++) {
    // Exact operator-controlled host allowlist is the trust boundary; arbitrary submitted domains are never fetched.
    const host = new URL(url).hostname;
    const ips = await Promise.race([
      Deno.resolveDns(host, "A"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DNS timeout")), 4000),
      ),
    ]);
    if (!ips.length || ips.some((ip) => !publicIPv4(ip)))
      throw new Error("Non-public address rejected");
    const headers: Record<string, string> = {
      "User-Agent": "StackSignal/1.0 (private engineering feed)",
      Accept:
        "application/json, application/rss+xml, application/atom+xml, text/html;q=0.9",
    };
    if (etag) headers["If-None-Match"] = etag;
    if (host === "api.github.com" && env("GITHUB_READ_TOKEN"))
      headers.Authorization = "Bearer " + env("GITHUB_READ_TOKEN");
    // Reserve most unauthenticated requests for existing watches. Bulk extraction and
    // health probes share the smaller lane, then still consume the global ceiling.
    if (host === "api.github.com" && lane === "enrichment" &&
      !(await budget("github-enrichment:" + new Date().toISOString().slice(0,13), env("GITHUB_READ_TOKEN") ? 1000 : 15, 3600)))
      throw new Deferred("GitHub enrichment budget reached; deferred until the next hour", (Math.floor(Date.now()/3600000)+1)*3600000+1000);
    if (
      host === "api.github.com" &&
      !(await budget(
        "github:" + new Date().toISOString().slice(0, 13),
        env("GITHUB_READ_TOKEN") ? 3000 : 45,
        3600,
      ))
    )
      throw new Deferred("GitHub hourly budget reached; deferred until the next hour", (Math.floor(Date.now()/3600000)+1)*3600000+1000);
    const res = await fetch(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const target = res.headers.get("location");
      await res.body?.cancel();
      if (!target) throw new Error("Invalid source redirect");
      url = safeURL(new URL(target, url).toString(), hosts);
      continue;
    }
    if (res.status === 304) return { url, unchanged: true, text: "", etag };
    if (res.status === 429 || (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")))) {
      const retry = Number(res.headers.get("retry-after"));
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
      await res.body?.cancel();
      throw new Deferred("Publisher rate limit; collection deferred", Math.min(Date.now()+86400000, Math.max(Date.now()+60000, reset || Date.now()+(retry || 3600)*1000)));
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error("Source returned HTTP " + res.status);
    }
    return {
      url,
      unchanged: false,
      text: await bodyText(res,maxBytes),
      etag: res.headers.get("etag"),
    };
  }
  throw new Error("Too many source redirects");
}
async function repoHealth(name:string, suppliedReleases?:any[], lane: "source" | "enrichment" = "enrichment") {
  const key="repo_health:"+name.toLowerCase();
  const cached=(await db("ss_settings?key=eq."+encodeURIComponent(key)+"&select=value"))[0]?.value;
  if(cached?.checked_at && Date.parse(cached.checked_at)>Date.now()-86400000) return cached;
  const metadataKey="repo_metadata:"+name.toLowerCase();
  let metadata=(await db("ss_settings?key=eq."+encodeURIComponent(metadataKey)+"&select=value"))[0]?.value;
  if(!metadata?.captured_at || Date.parse(metadata.captured_at)<Date.now()-86400000) {
    const value=JSON.parse((await fetchPublic("https://api.github.com/repos/"+name,undefined,2_000_000,lane)).text);
    if(value.private!==false) throw new Error("Only public repository metadata can be collected");
    metadata={captured_at:new Date().toISOString(),value};
    await db("ss_settings?on_conflict=key","POST",{key:metadataKey,value:metadata},"resolution=merge-duplicates,return=representation");
  }
  const releases=suppliedReleases || JSON.parse((await fetchPublic("https://api.github.com/repos/"+name+"/releases?per_page=20",undefined,2_000_000,lane)).text);
  if(!Array.isArray(releases)) throw new Error("Invalid repository release history");
  const health=repositoryHealth(metadata.value,releases);
  await db("ss_settings?on_conflict=key","POST",{key,value:health},"resolution=merge-duplicates,return=representation");
  return health;
}
async function queueRepoHealthChecks() {
  const filter="deleted_at=is.null&url=like.https://github.com/*&or=(reference_meta->repo_health->>checked_at.is.null,reference_meta->repo_health->>checked_at.lt."+new Date(Date.now()-86400000).toISOString()+")&select=url&order=discovered_at.asc&limit=1000";
  const reviewed=await db("ss_articles?"+filter+"&reference_meta->evaluation->>decision=eq.useful");
  const rows=[...reviewed,...await db("ss_articles?"+filter+"&reference_meta->>assistant_reviewed_at=is.null")];
  let queued=0;
  for(const name of new Set(rows.map((r:any)=>repositoryName(r.url)).filter(Boolean))) {
    if(queued>=2) break;
    if(await budget("repo-health-queue:"+name+":"+new Date().toISOString().slice(0,10),1,86400)) {
      await rpc("ss_queue_item",{job_kind:"article",item:{url:"https://github.com/"+name,health_only:true}});queued++;
    }
  }
}
async function evaluationHealth(patch: any) {
  const old = await db("ss_settings?key=eq.evaluation_health&select=value");
  await db("ss_settings?on_conflict=key", "POST", { key: "evaluation_health",
    value: { ...old[0]?.value, ...patch }, updated_at: new Date().toISOString() }, "resolution=merge-duplicates,return=representation");
}
const eligibleEvaluation = "deleted_at=is.null&reference_meta->>public_evaluation_input=not.is.null";
const pendingEvaluation = eligibleEvaluation + "&reference_meta->>evaluation=is.null&reference_meta->>evaluation_failed_at=is.null";
async function articleCount(filter: string) {
  const r = await fetch(SUPABASE + "/rest/v1/ss_articles?select=id&limit=1&" + filter, {
    method:"HEAD", headers:{apikey:KEY,Authorization:"Bearer "+KEY,Prefer:"count=exact"}, signal:AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error("Coverage count failed");
  const count = Number(r.headers.get("content-range")?.split("/")[1]);
  if (!Number.isFinite(count)) throw new Error("Coverage count unavailable");
  return count;
}
async function evaluationCoverage() {
  return await rpc("ss_review_coverage");
}
async function failedEvaluation(row: any, reason="Evaluation validation failed", status=0, retryAfter: string | null=null) {
  const failures=Number(row.reference_meta?.evaluation_failures||0)+1;
  const validationFailures=Number(row.reference_meta?.evaluation_validation_failures||0)+1;
  const failure=evaluationFailure(reason,status ? failures : /timeout|timed out|network|fetch failed|connection/i.test(reason) ? failures : validationFailures,status,retryAfter);
  await db("ss_articles?id=eq."+row.id+"&content_hash=eq."+encodeURIComponent(row.content_hash)+"&deleted_at=is.null", "PATCH",
    {reference_meta:{...row.reference_meta,evaluation_failed_at:new Date().toISOString(),evaluation_failures:failures,
      evaluation_validation_failures:failure.kind==="validation" ? validationFailures : Number(row.reference_meta?.evaluation_validation_failures||0),
      evaluation_error:reason.slice(0,200),evaluation_error_kind:failure.kind,evaluation_retry_at:failure.retryAt ? new Date(failure.retryAt).toISOString() : null}});
  return failure;
}
async function queueMissingPublicInputs() {
  const rows=await db("ss_articles?deleted_at=is.null&reference_meta->>evaluation=is.null&reference_meta->>public_evaluation_input=is.null&reference_meta->>public_extraction_requested=is.null&reference_meta->>assistant_reviewed_at=is.null&select=id,url,kind,topic,content_hash,reference_meta&order=discovered_at.asc,id.asc&limit=8");
  for(const row of rows) {
    let approved=false; try { approved=!!safeURL(row.url,hosts) && !new URL(row.url).pathname.toLowerCase().endsWith(".pdf"); } catch { /* Unapproved references stay private and unfetched. */ }
    if(approved) await rpc("ss_queue_item",{job_kind:"article",item:{url:row.url,kind:row.kind,topic:row.topic}});
    await db("ss_articles?id=eq."+row.id+(row.content_hash ? "&content_hash=eq."+encodeURIComponent(row.content_hash) : "&content_hash=is.null"),"PATCH",{reference_meta:{...row.reference_meta,public_extraction_requested:approved ? "queued" : "unsupported"}});
  }
}
async function internalSweep(profile:any) {
  const collection=await rpc("ss_promote_overdue_link_jobs",{batch_size:500});
  const rows=await rpc("ss_internal_review_candidates",{batch_size:500});
  const items=[];
  for(const row of rows) {
    const reviewed=internalReview(row,profile);
    const overdue=Date.parse(row.discovered_at)<=Date.now()-INTERNAL_REVIEW_DELAY_MS;
    const fresh=immediateInternalReview(row,reviewed);
    if(!overdue&&!fresh)continue;
    items.push({id:row.id,content_hash:row.content_hash,captured_input:row.reference_meta.public_evaluation_input||null,input:row.reference_meta.public_evaluation_input||null,
      ...reviewed,evaluator:"policy",completion_path:overdue ? "sla_failover" : "priority_fresh"});
  }
  const result={committed:0,skipped:0};
  for(let i=0;i<items.length;i+=200) { const out=await rpc("ss_commit_internal_reviews",{items:items.slice(i,i+200)});result.committed+=out.committed;result.skipped+=out.skipped; }
  await evaluationHealth({internal_review:{...result,promoted:collection.promoted,cleared_jobs:collection.cleared,version:"dry-evidence-v1",after_hours:24,last_run:new Date().toISOString()},pipeline:await rpc("ss_evaluation_pipeline"),coverage:await evaluationCoverage()});
  return result;
}
async function evaluateSweep(profile: any) {
  const configured = !!env("GEMINI_API_KEY");
  const mode = ["shadow","rerank"].includes(profile.gemini_mode) ? profile.gemini_mode : "off";
  const limit = Math.max(0,Math.min(Number(profile.gemini_daily_limit)||0,DAILY_REQUEST_CAP));
  const monthly = Math.max(0,Math.min(Number(profile.gemini_monthly_limit)||0,MONTHLY_REQUEST_CAP));
  const old = await db("ss_settings?key=eq.evaluation_health&select=value");
  const health = old[0]?.value || {};
  if (configured) {
    try { await evaluationHealth({coverage:await evaluationCoverage(),pipeline:await rpc("ss_evaluation_pipeline")}); } catch { /* Counts never spend quota. */ }
  }
  if (!configured || mode === "off" || !limit || !monthly) {
    await evaluationHealth({ configured, state: configured ? "paused" : "missing_key", mode,
      model: EVALUATION_MODEL, next_attempt_at:null, daily_ceiling:limit, monthly_ceiling:monthly });
    return;
  }
  try { await queueMissingPublicInputs(); } catch { /* A metadata outage must not spend or block evaluation. */ }
  await evaluationHealth({configured:true,mode,model:EVALUATION_MODEL,daily_ceiling:limit,monthly_ceiling:monthly});
  const usage=await rpc("ss_evaluation_usage");
  if (Date.parse(health.cooldown_until || "") > Date.now()) { await evaluationHealth({mode,usage}); return; }
  if (usage.used_24h >= limit || usage.used_provider_day >= limit || usage.used_month >= monthly) {
    await evaluationHealth({configured:true,mode,model:EVALUATION_MODEL,state:"budget_wait",next_attempt_at:usage.next_available_at || null,daily_ceiling:limit,monthly_ceiling:monthly,usage}); return;
  }
  const next=nextEvaluationAt(usage,limit,monthly);
  if(next>Date.now()) {
    await evaluationHealth({configured:true,mode,model:EVALUATION_MODEL,state:"pacing_wait",next_attempt_at:new Date(next).toISOString(),daily_ceiling:limit,monthly_ceiling:monthly,usage}); return;
  }
  const rows=await rpc("ss_evaluation_candidates");
  const team=publicTeam(profile), candidates=[];
  // Oldest queue window plus rotating lane preference balances useful known material and unfamiliar ideas.
  for(const row of evaluationCandidates(rows,Number(usage.used_month)||0)) {
    if(!articleRepositoryAdmitted(row.url,row.reference_meta,profile)) continue;
    const input=row.reference_meta.public_evaluation_input;
    const cache_key=await digest(JSON.stringify({version:EVALUATOR_VERSION,model:EVALUATION_MODEL,input,team}));
    candidates.push({...row,cache_key}); if(candidates.length===50) break;
  }
  if(!candidates.length) { await evaluationHealth({state:"ready",usage,next_attempt_at:null}); return; }
  const targetSize=evaluationBatchSize(health);
  // Fill requests during fresh discovery bursts; aged links and watched releases never wait for a full batch.
  if(candidates.length<targetSize && !candidates.some(r=>r.reference_meta.alert_kind || Date.parse(r.discovered_at)<Date.now()-3600000)) {
    await evaluationHealth({state:"batching_wait",next_attempt_at:new Date(Date.now()+300000).toISOString(),target_batch_size:targetSize}); return;
  }
  const reservation=await rpc("ss_reserve_evaluation_batch",{items:candidates.slice(0,targetSize).map(r=>({id:r.id,cache_key:r.cache_key,content_hash:r.content_hash})),daily_max:limit,monthly_max:monthly});
  if(!reservation?.request_id) { await evaluationHealth({state:"reservation_wait",usage:await rpc("ss_evaluation_usage")}); return; }
  const batch=candidates.filter(r=>reservation.items.some((i:any)=>i.id===r.id));
  const inputs=batch.map(r=>({id:r.id,input:r.reference_meta.public_evaluation_input}));
  let out:any, parsed:ReturnType<typeof parseBatchEvaluation>, phase="transport";
  try {
    const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+EVALUATION_MODEL+":generateContent",{
      method:"POST",redirect:"error",signal:AbortSignal.timeout(EVALUATION_TIMEOUT_MS),headers:{"Content-Type":"application/json","x-goog-api-key":env("GEMINI_API_KEY")},body:JSON.stringify(batchEvaluationRequest(inputs,team)),
    });
    if(!response.ok) {
      await response.body?.cancel();
      const reason="Gemini HTTP "+response.status;
      const failures=await Promise.all(batch.map(row=>failedEvaluation(row,reason,response.status,response.headers.get("retry-after"))));
      const retryAt=Math.max(...failures.map(f=>f.retryAt || Date.now()+3600000));
      await rpc("ss_finish_evaluation_request",{request:reservation.request_id,outcome:failures[0].kind,reviewed:0,error:reason});
      await evaluationHealth({state:failures[0].kind==="configuration" ? "configuration_error" : "cooldown",next_attempt_at:new Date(retryAt).toISOString(),last_error:reason+"; queued links retained for retry",usage:await rpc("ss_evaluation_usage"),cooldown_until:new Date(retryAt).toISOString()}); return;
    }
    const responseText=await bodyText(response); phase="validation";
    out=JSON.parse(responseText);parsed=parseBatchEvaluation(out,inputs);
  } catch (error) {
    const reason=(error as Error).message;
    const failures=await Promise.all(batch.map(row=>failedEvaluation(row,reason,phase==="transport" ? 503 : 0)));
    const retryAt=Math.max(...failures.map(f=>f.retryAt || Date.now()+3600000));
    await rpc("ss_finish_evaluation_request",{request:reservation.request_id,outcome:failures[0].kind,reviewed:0,error:reason});
    await evaluationHealth({state:"cooldown",next_attempt_at:new Date(retryAt).toISOString(),last_error:reason+"; queued links retained",target_batch_size:Math.max(1,Math.floor(targetSize/2)),usage:await rpc("ss_evaluation_usage"),cooldown_until:new Date(retryAt).toISOString()}); return;
  }
  const resolved_model=typeof out.modelVersion==="string" ? out.modelVersion.slice(0,120) : null;
  const tokens={input_tokens:Number(out.usageMetadata?.promptTokenCount)||0,output_tokens:Number(out.usageMetadata?.candidatesTokenCount)||0,thinking_tokens:Number(out.usageMetadata?.thoughtsTokenCount)||0};
  const comparisons=[];
  let reviewed=0;
  for(const row of batch) {
    const result=parsed.valid.get(row.id);
    if(!result) { await failedEvaluation(row,parsed.errors[row.id]); continue; }
    const current=(await db("ss_articles?id=eq."+row.id+"&select=score,reference_meta,content_hash,deleted_at"))[0];
    const input=row.reference_meta.public_evaluation_input;
    if(!current || current.deleted_at || current.reference_meta?.evaluation || current.content_hash!==row.content_hash || !samePublicInput(current.reference_meta?.public_evaluation_input,input)) continue;
    const rules=current.reference_meta?.evaluation?.rules_score ?? current.score;
    const score=effectiveScore(rules,result,mode,!!current.reference_meta.alert_kind);
    const evaluated_at=new Date().toISOString();
    const evaluation={...result,rules_score:rules,applied_score:score,mode,model:EVALUATION_MODEL,resolved_model,scope:input.scope,evaluator:"gemini",version:EVALUATOR_VERSION,cache_key:row.cache_key,evaluated_at,request_id:reservation.request_id};
    const patch:any={reference_meta:{...current.reference_meta,evaluation,evaluation_failed_at:null,evaluation_retry_at:null,evaluation_failures:0,evaluation_validation_failures:0,evaluation_error_kind:null,evaluation_error:null,review_commit:row.cache_key}};
    if(mode==="rerank" && result.confidence==="high" && result.decision!=="insufficient_evidence") Object.assign(patch,{score,analysis_status:"ai",summary:result.summary,reason:result.reason,evidence:result.evidence});
    const updated=await db("ss_articles?id=eq."+row.id+"&content_hash=eq."+encodeURIComponent(row.content_hash)+"&deleted_at=is.null&reference_meta->>evaluation=is.null","PATCH",patch);
    if(!updated?.length)continue;
    reviewed++;
    // Non-selected terminal decisions are physically deleted by the database.
    // Never recreate their payload in comparison history or an enrichment job.
    if(result.decision==="useful" && result.score>=Number(profile.min_score ?? 55) && ["medium","high"].includes(result.confidence) && ["practical","advanced"].includes(result.depth))
      comparisons.push({article_id:row.id,title:input.title,lane:candidateLane(row),rules_score:rules,ai_score:result.score,applied_score:score,...result,model:EVALUATION_MODEL,resolved_model,scope:input.scope,evaluated_at});
  }
  await rpc("ss_finish_evaluation_request",{request:reservation.request_id,outcome:parsed.invalid.length ? "partial" : "success",reviewed,error:parsed.invalid.length ? "Evidence validation failed for some sources" : null});
  const previous=await db("ss_settings?key=eq.evaluation_health&select=value");
  await evaluationHealth({configured:true,mode,model:EVALUATION_MODEL,resolved_model,state:parsed.invalid.length ? "partial_batch" : "active",next_attempt_at:null,last_success:new Date().toISOString(),last_error:parsed.invalid.length ? "Some batch results failed evidence validation; those links withheld" : null,cooldown_until:null,
    daily_ceiling:limit,monthly_ceiling:monthly,target_batch_size:parsed.invalid.length ? Math.max(1,Math.floor(targetSize/2)) : Math.min(MAX_BATCH_SIZE,targetSize+3),batch_size:batch.length,last_batch_reviewed:reviewed,last_request_tokens:tokens,usage:await rpc("ss_evaluation_usage"),comparisons:[...comparisons,...(previous[0]?.value?.comparisons||[])].slice(0,12)});
  try { await evaluationHealth({coverage:await evaluationCoverage(),pipeline:await rpc("ss_evaluation_pipeline")}); } catch { /* Non-critical health snapshot. */ }
}
async function ingest(item: any, profile: any) {
  let url: string;
  try {
    url = canonicalLink(item.url);
  } catch {
    return;
  }
  const u = new URL(url);
  if (item.kind === "Release") {
    const tag = item.reference_meta?.tag || u.pathname.split("/releases/tag/")[1];
    item.reference_meta = { ...item.reference_meta, prerelease: isPrerelease({ prerelease: item.reference_meta?.prerelease, tag_name: tag }) };
  }
  if (item.reference_meta?.source_id) {
    const watched = await db("ss_sources?id=eq." + encodeURIComponent(item.reference_meta.source_id) + "&select=active,revision,include_prereleases");
    if (!watched[0]?.active || watched[0].revision !== item.reference_meta.source_revision) return;
    if (item.reference_meta.prerelease && !watched[0].include_prereleases) return;
  }
  const repo=repositoryName(url);
  if(repo && !item.reference_meta?.repo_health) item.reference_meta={...item.reference_meta,repository:repo,repo_health:await repoHealth(repo)};
  const old = await db(
    "ss_articles?url=eq." +
      encodeURIComponent(url) +
      "&select=id,title,kind,topic,content_hash,published_at,updated_at,reference_meta",
  );
  const hash = await digest(
    "radar-v2 " + JSON.stringify(item.reference_meta || {}) + item.title +
      " " +
      item.summary +
      " " +
      (item.text || "") +
      " " +
      (item.updated_at || ""),
  );
  if (old[0]?.content_hash === hash) return;
  // Unknown publisher dates stay null. Discovery time never becomes publication time.
  const published = dateISO(item.published_at) || old[0]?.published_at || null;
  const full = textOnly(item.text || item.summary || "");
  const { signals, ...local } = relevance(item.title, full, profile, item);
  const a = { ...local, summary:"", analysis_status:"rules" };
  const captured = publicInput(item, full);
  const changedInput = !samePublicInput(captured,old[0]?.reference_meta?.public_evaluation_input);
  const record = {
    url,
    title: String(item.title || old[0]?.title || u.hostname).slice(0, 500),
    source: item.source || u.hostname,
    kind: item.kind || old[0]?.kind || "Article",
    author: item.author || null,
    published_at: published,
    updated_at: item.updated_at || old[0]?.updated_at || null,
    ...a,
    topic: item.topic || old[0]?.topic || a.topic,
    summary: a.summary || String(item.summary || "").slice(0, 600),
    content_hash: hash,
    reference_meta: {
      ...old[0]?.reference_meta, ...item.reference_meta, signals,
      public_evaluation_input: captured,
      ...(changedInput ? {evaluation:null,evaluation_failed_at:null,evaluation_retry_at:null,evaluation_failures:0,evaluation_validation_failures:0,evaluation_error_kind:null,evaluation_error:null} : {}),
      link_status: old[0]?.reference_meta?.link_status === "title-match" ? "title-match" : item.reference_meta?.link_status === "search_result" ? "search_result" : "checked",
      ...(item.reference_meta?.link_status === "search_result" ? {} : { checked_at: new Date().toISOString() }),
    },
  };
  if (!changedInput && old[0]?.reference_meta?.evaluation) {
    const cached=old[0].reference_meta.evaluation;
    const applied=effectiveScore(record.score,cached,profile.gemini_mode,!!record.reference_meta.alert_kind);
    record.reference_meta.evaluation={...cached,rules_score:record.score,applied_score:applied};
    if(profile.gemini_mode==="rerank" && cached.confidence==="high" && cached.decision!=="insufficient_evidence") Object.assign(record,{score:applied,analysis_status:"ai",summary:cached.summary,reason:cached.reason,evidence:cached.evidence});
  }
  if (old[0]) await db("ss_articles?id=eq." + old[0].id, "PATCH", record);
  else await db("ss_articles?on_conflict=url", "POST", record, "resolution=merge-duplicates,return=representation");
  if(!old[0] && item.kind==="Paper" && /^https:\/\/arxiv\.org\/abs\//.test(url)) await rpc("ss_queue_item",{job_kind:"article",item:{url,kind:"Paper",topic:record.topic}});
}
async function queueSourceItems(items: any[]) {
  const captured=[];
  for(const item of items) {
    // Stable publisher identity excludes changing health/check clocks and watch revisions.
    const source_fingerprint=await digest(JSON.stringify({url:item.url,title:item.title,public_title:item.public_title,summary:item.summary,text:item.text,published_at:item.published_at,updated_at:item.updated_at,prerelease:item.reference_meta?.prerelease}));
    captured.push({...item,reference_meta:{...item.reference_meta,source_fingerprint}});
  }
  await rpc("ss_queue_items",{job_kind:"analyze",items:captured});
}
async function sourceJob(job: any, profile: any) {
  const p = job.payload;
  const rows = await db("ss_sources?id=eq." + p.source_id);
  const source = rows[0];
  if (!source?.active) return;
  try {
    const requestURL = new URL(source.url);
    const releaseList = source.type === "github" && requestURL.pathname.endsWith("/releases");
    const fetchReleases = async (size: number) => {
      requestURL.searchParams.set("per_page", String(size));
      requestURL.searchParams.set("page", "1");
      const first = await fetchPublic(requestURL.toString(), source.etag,2_000_000,"source");
      if (first.unchanged) return first;
      let values = JSON.parse(first.text);
      if (!Array.isArray(values)) throw new Error("Invalid GitHub release list");
      let pageValues = values;
      const since = Math.max(Date.now() - 90 * 86400000, (Date.parse(source.last_success_at || "") || 0) - 7 * 86400000);
      // Persist the first-page ETag only after every required page succeeds.
      // Changed sources inspect a seven-day overlap; first scans cover up to 90 days.
      for (let page = 2; page <= 5 && pageValues.length === size && pageValues.some((x: any) => Date.parse(x.published_at || "") >= since); page++) {
        requestURL.searchParams.set("page", String(page));
        const next = await fetchPublic(requestURL.toString(),undefined,2_000_000,"source");
        pageValues = JSON.parse(next.text);
        if (!Array.isArray(pageValues)) throw new Error("Invalid GitHub release list");
        values = values.concat(pageValues);
      }
      return { ...first, text: JSON.stringify(values) };
    };
    let res;
    if (releaseList) {
      try { res = await fetchReleases(20); }
      catch (e) {
        if (!(e instanceof SourceTooLarge)) throw e;
        res = await fetchReleases(10);
      }
    } else res = await fetchPublic(requestURL.toString(), source.etag,2_000_000,"source");
    const meta = { origin: "source_watch", source_id: source.id, source_revision: source.revision };
    if (!res.unchanged) {
      if (source.type === "openshift") {
        openshiftWatchURL(source.url);
        const tags=openshiftTags(JSON.parse(res.text),source);
        const entries=[];
        for(const tag of tags) {
          const link=source.url.replace(/\/tags$/, "/release/"+encodeURIComponent(tag.name));
          const detail=JSON.parse((await fetchPublic(link,undefined,8_000_000)).text);
          entries.push(openshiftItem(detail,source,tag.name));
        }
        await queueSourceItems(entries);
        await db("ss_sources?id=eq."+source.id+"&revision=eq."+source.revision,"PATCH",{last_item_count:entries.length});
      } else if (source.type === "github") {
        const health=await repoHealth(requestURL.pathname.split("/").slice(2,4).join("/"),releaseList ? JSON.parse(res.text) : undefined,"source");
        const entries = githubItems(JSON.parse(res.text), source);
        await queueSourceItems(entries.map(payload => ({ ...payload, reference_meta: { ...payload.reference_meta, ...meta, repo_health:health } })));
        await db("ss_sources?id=eq." + source.id + "&revision=eq." + source.revision, "PATCH", { last_item_count: entries.length });
      } else if (source.type === "rss") {
        if (!/<(?:rss|feed|rdf:RDF)\b/i.test(res.text)) throw new Error("The URL did not return an RSS or Atom feed");
        const entries = parseFeed(res.text)
          .slice(0, 40)
          .filter(
            (item) =>
              !item.published_at ||
              Date.parse(item.published_at) >= Date.now() - 90 * 86400000,
          );
        await queueSourceItems(entries.map(item => ({
          ...item, source: source.name, kind: source.url.includes("arxiv.org") ? "Paper" : "Article", priority: source.priority,
          reference_meta: { ...meta, discovery_lane: "publication_feed" },
        })));
        await db("ss_sources?id=eq." + source.id + "&revision=eq." + source.revision, "PATCH", { last_item_count: entries.length });
      } else {
        const m = htmlMeta(res.text);
        const changed =
          source.baseline && meaningfulChange(source.baseline, m.text);
        await ingest(
          {
            ...m,
            url: res.url,
            source: source.name,
            topic: source.topic,
            kind: "Documentation", priority: source.priority,
            reference_meta: { ...meta, date_basis: changed ? "change_detected" : "publisher" },
            updated_at: changed ? new Date().toISOString() : m.updated_at,
          },
          profile,
        );
        await db("ss_sources?id=eq." + source.id + "&revision=eq." + source.revision, "PATCH", {
          baseline: m.text,
          content_hash: await digest(m.text),
        });
      }
      await db("ss_sources?id=eq." + source.id + "&revision=eq." + source.revision, "PATCH", {
        etag: res.etag || null,
      });
    }
    await db("ss_sources?id=eq." + source.id + "&revision=eq." + source.revision, "PATCH", {
      last_success_at: new Date().toISOString(),
      last_error: null,last_error_kind:null,retry_at:null,
    });
  } catch (e) {
    await db("ss_sources?id=eq." + source.id + "&revision=eq." + source.revision, "PATCH", {
      last_error: (e as Error).message.slice(0, 200),last_error_kind:e instanceof Deferred ? "deferred" : "error",retry_at:e instanceof Deferred ? new Date(e.retryAt).toISOString() : null,
    });
    throw e;
  }
}
async function articleJob(job: any, profile: any) {
  const repository=new URL(job.payload.url);
  const repo=repository.hostname==="github.com" && repository.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/);
  if(repo) {
    const endpoint="https://api.github.com/repos/"+repo[1]+"/"+repo[2];
    const health=await repoHealth(repo[1]+"/"+repo[2]);
    if(job.payload.health_only) {
      const rows=await db("ss_articles?deleted_at=is.null&url=ilike."+encodeURIComponent("https://github.com/"+repo[1]+"/"+repo[2]+"*")+"&select=id,url,content_hash,reference_meta&limit=1000");
      for(const row of rows) if(repositoryName(row.url)?.toLowerCase()===(repo[1]+"/"+repo[2]).toLowerCase())
        await db("ss_articles?id=eq."+row.id+(row.content_hash ? "&content_hash=eq."+encodeURIComponent(row.content_hash) : "&content_hash=is.null"),"PATCH",{reference_meta:{...row.reference_meta,repo_health:health,repository:repo[1]+"/"+repo[2]}});
      return;
    }
    if(job.payload.discovery_lane && !repositoryAdmitted(health,profile)) return;
    const cached=(await db("ss_settings?key=eq."+encodeURIComponent("repo_metadata:"+(repo[1]+"/"+repo[2]).toLowerCase())+"&select=value"))[0]?.value;
    const metadata=cached?.value || JSON.parse((await fetchPublic(endpoint)).text);
    if(metadata.private) throw new Error("Only public repository content can be evaluated");
    let readme="";
    try {
      const data=JSON.parse((await fetchPublic(endpoint+"/readme")).text);
      if(data.encoding==="base64" && typeof data.content==="string") {
        const bytes=Uint8Array.from(atob(data.content.replace(/\s/g,"")),c=>c.charCodeAt(0));
        readme=new TextDecoder().decode(bytes).slice(0,12000);
      }
    } catch(e) { if(e instanceof Deferred) throw e; /* Metadata may suffice without a README. */ }
    await ingest({url:job.payload.url,title:metadata.full_name,source:"GitHub",author:metadata.owner?.login,kind:"Repository",topic:job.payload.topic,
      summary:String(metadata.description||""),text:[metadata.description,...(metadata.topics||[]),readme].join(" "),published_at:metadata.created_at,updated_at:metadata.pushed_at,
      reference_meta:{...job.payload.reference_meta,repository:metadata.full_name,repo_health:health,stars:health.stars,license:health.license,...(job.payload.discovery_lane ? {origin:"discovery",discovery_lane:job.payload.discovery_lane} : {})}},profile);
    return;
  }
  const commit=repository.hostname==="github.com" && repository.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/commit\/([a-f0-9]{40})$/);
  if(commit) {
    const x=JSON.parse((await fetchPublic("https://api.github.com/repos/"+commit[1]+"/"+commit[2]+"/commits/"+commit[3])).text);
    const text=String(x.commit?.message||"");
    await ingest({url:job.payload.url,title:text.split("\n")[0],source:"GitHub",kind:"Commit",topic:job.payload.topic,summary:text.slice(0,600),text,author:x.author?.login,published_at:x.commit?.committer?.date,reference_meta:{repository:commit[1]+"/"+commit[2],note:"Commit reference; this is not a published release or proof of deployment."}},profile);return;
  }
  const apiURL = githubAPIForLink(job.payload.url);
  if (apiURL) {
    const res = await fetchPublic(apiURL);
    const source = {
      url: apiURL,
      name: new URL(job.payload.url).pathname.split("/").slice(1, 3).join("/"),
      topic: job.payload.topic || "",
    };
    for (const item of githubItems(JSON.parse(res.text), source))
      await ingest(item, profile);
    return;
  }
  if (new URL(job.payload.url).pathname.toLowerCase().endsWith(".pdf"))
    throw new Error(
      "PDF saved as a reference; automatic PDF extraction is not enabled",
    );
  const res = await fetchPublic(job.payload.url);
  const m = /\.md(?:$|\?)/i.test(res.url) ? {title:res.text.match(/^#\s+(.+)$/m)?.[1] || job.payload.title || new URL(res.url).pathname.split("/").at(-1),text:res.text,summary:res.text.slice(0,600),author:null,published_at:null,updated_at:null} : htmlMeta(res.text);
  await ingest(
    {
      ...m,
      url: job.payload.url,
      title: m.title || job.payload.title,
      source: new URL(res.url).hostname,
      kind: job.payload.kind,
      topic: job.payload.topic,
      reference_meta: m.published_at ? { date_basis: "publisher", note: "Metadata extracted from the approved publisher page. Technical claims have not been independently validated." } : undefined,
    },
    profile,
  );
}
async function discovery(profile: any) {
  if (!env("TAVILY_API_KEY") || !profile.search_monthly_limit) return;
  const date = new Date();
  const month = date.toISOString().slice(0, 7);
  const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const seconds = Math.ceil((nextMonth - Date.now()) / 1000);
  for (const q of (profile.queries || []).slice(0, 20)) {
    if (typeof q !== "string" || q.length > 300) continue;
    if (profile._allowedQueries && !profile._allowedQueries.includes(q)) continue;
    const lane = profile._searchLane === "explore" ? "explore" : "recent";
    if (!(await budget("web-search-day:" + date.toISOString().slice(0, 10), 24, 86400)))
      throw new Deferred("Daily web search ceiling reached", Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1));
    if (
      !(await budget(
        "search:" + month,
        Math.min(profile.search_monthly_limit, 800),
        seconds,
      ))
    )
      throw new Deferred("Monthly web search ceiling reached", nextMonth + 1000);
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env("TAVILY_API_KEY"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(webSearchRequest(q, lane)),
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (res.status === 429 || res.status === 432 || res.status === 433)
      throw new Deferred("Web search provider throttled or exhausted its quota", res.status === 429 ? Date.now()+3600000 : nextMonth+1000);
    if (!res.ok)
      throw new Error("Discovery provider returned HTTP " + res.status);
    const out = JSON.parse(await bodyText(res));
    if (!Array.isArray(out.results)) throw new Error("Invalid web search response");
    let accepted = 0, filtered = 0, duplicates = 0;
    for (const x of out.results.slice(0, 8)) {
      const item = webCandidate(x, profile, q, lane);
      if (!item) { filtered++; continue; }
      const existing = await db(
        "ss_articles?url=eq." + encodeURIComponent(item.url) + "&select=id",
      );
      if (existing.length) { duplicates++; continue; }
      await ingest(item, profile);
      accepted++;
      try {
        const url = safeURL(item.url, hosts);
        if (new URL(url).pathname.toLowerCase().endsWith(".pdf")) continue;
        await rpc("ss_queue_item", { job_kind: "article", item: { url } });
      } catch {
        /* Keep public link visible as an undated reference; do not fetch unapproved hosts. */
      }
    }
    await webHealth({ state: "active", last_success: new Date().toISOString(), last_error: null,
      last_query: q, last_window: lane, last_results: Math.min(out.results.length,8),
      last_accepted: accepted, last_filtered: filtered, last_duplicates: duplicates });
  }
}
async function webHealth(patch: any) {
  const old = await db("ss_settings?key=eq.web_discovery_health&select=value");
  if (patch.configured && patch.monthly_ceiling > 0 && !patch.state &&
      (!old[0]?.value?.state || ["missing_key","paused"].includes(old[0].value.state))) patch.state = "ready";
  await db("ss_settings?on_conflict=key", "POST", { key: "web_discovery_health",
    value: { ...old[0]?.value, ...patch }, updated_at: new Date().toISOString() }, "resolution=merge-duplicates,return=representation");
}
async function repoDiscovery(query: string, profile: any) {
  if (profile.repo_discovery === false) return;
  if (!(await budget("github-search:" + new Date().toISOString().slice(0,16), 6, 60))) throw new Deferred("GitHub search minute budget reached", Date.now()+65000);
  const res = await fetchPublic(repositorySearchURL(query));
  const result = JSON.parse(res.text);
  if (!Array.isArray(result.items)) throw new Error("Invalid GitHub search response");
  for (const x of result.items.slice(0,6)) {
    if (x.private || x.fork || x.archived || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(x.full_name || "")) continue;
    if (lowValueDiscovery(x.full_name, String(x.description || ""))) continue;
    if(Number(x.stargazers_count)<(profile.repo_min_stars ?? 100)) continue;
    const health=await repoHealth(x.full_name);
    if(!repositoryAdmitted(health,profile)) continue;
    const url = "https://github.com/" + x.full_name;
    await rpc("ss_queue_item",{job_kind:"article",item:{url,discovery_lane:"repository_search"}});
    await ingest({ url, title: x.full_name, source: "GitHub", author: x.owner?.login,
      summary: textOnly(String(x.description || "")).slice(0,600), text: [x.description, ...(x.topics || [])].join(" "),
      kind: "Repository", published_at: dateISO(x.created_at), updated_at: dateISO(x.pushed_at),
      reference_meta: { origin: "discovery", discovery_lane: "repository_search", repository: x.full_name, repo_health:health,
        stars: Math.max(0, Number(x.stargazers_count) || 0), license: String(x.license?.spdx_id || "Unspecified").slice(0,80) },
    }, profile);
  }
  const previous = await db("ss_settings?key=eq.discovery_health&select=value");
  await db("ss_settings?on_conflict=key", "POST", { key: "discovery_health", value: { ...previous[0]?.value,
    repository_last_success: new Date().toISOString(), repository_results: result.items.length,
    repository_partial: !!result.incomplete_results, repository_last_error: null }, updated_at: new Date().toISOString() }, "resolution=merge-duplicates,return=representation");
}
async function trendingDiscovery(window:string,profile:any) {
  if(profile.trending_discovery===false || profile.repo_discovery===false) return;
  if(!["daily","weekly"].includes(window)) throw new Error("Invalid Trending period");
  const result=trendingProjects((await fetchPublic("https://github.com/trending?since="+window)).text);
  for(const x of result) await rpc("ss_queue_item",{job_kind:"article",item:{url:"https://github.com/"+x.repository,discovery_lane:"github_trending",reference_meta:{trending_period:window,trending_rank:x.rank,trending_checked_at:new Date().toISOString()}}});
  const previous=await db("ss_settings?key=eq.discovery_health&select=value");
  await db("ss_settings?on_conflict=key","POST",{key:"discovery_health",value:{...previous[0]?.value,["trending_"+window+"_success"]:new Date().toISOString(),trending_last_error:null}},"resolution=merge-duplicates,return=representation");
}
Deno.serve(async (request) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const secret = env("COLLECTOR_SECRET");
  if (
    request.method !== "POST" ||
    secret.length < 32 ||
    (await digest(request.headers.get("x-collector-secret") || "")) !==
      (await digest(secret))
  )
    return new Response('{"error":"Unauthorized"}', { status: 401, headers });
  let count = 0;
  try {
    const body = await request.json().catch(()=>({}));
    if(body.mode === "internal_review") {
      const settings=await db("ss_settings?key=eq.profile&select=value");
      const result=await internalSweep(settings[0].value);
      return new Response(JSON.stringify({ok:true,mode:"internal_review",...result}),{headers});
    }
    if(body.mode === "evaluation") {
      const settings=await db("ss_settings?key=eq.profile&select=value");
      await evaluateSweep(settings[0].value);
      return new Response(JSON.stringify({ok:true,mode:"evaluation"}),{headers});
    }
    const day = new Date().toISOString().slice(0, 10);
    if (await budget("maintenance:" + day, 1, 86400))
      await rpc("ss_maintenance");
    await rpc("ss_enqueue_sources");
    const settings = await db("ss_settings?key=eq.profile&select=value");
    const profile = { ...settings[0].value, _tagWeights: await rpc("ss_feedback_weights") };
    const webEnabled = !!env("TAVILY_API_KEY") && Number(profile.search_monthly_limit) > 0;
    await webHealth({ configured: !!env("TAVILY_API_KEY"), monthly_ceiling: Math.min(Number(profile.search_monthly_limit)||0,800),
      daily_ceiling: 24, ...(webEnabled ? {} : { state: env("TAVILY_API_KEY") ? "paused" : "missing_key" }) });
    try { await queueRepoHealthChecks(); } catch { /* Queue public health checks without interrupting collection. */ }
    if(profile.repo_discovery!==false && profile.trending_discovery!==false && await budget("trending-discovery:"+day,1,86400))
      for(const window of ["daily","weekly"]) await rpc("ss_queue_item",{job_kind:"discovery",item:{lane:"trending",window,scheduled_day:day}});
    if (profile.repo_discovery !== false && await budget("repository-discovery:" + day, 1, 86400)) {
      for (const query of (profile.repo_queries || DEFAULT_REPO_QUERIES).slice(0,12))
        await rpc("ss_queue_item", { job_kind: "discovery", item: { lane: "repository", query } });
    }
    if (
      webEnabled &&
      (await budget("discovery-run:" + day, 1, 86400))
    )
      for (const [index, query] of (profile.queries || []).slice(0,20).entries())
        await rpc("ss_queue_item", { job_kind: "discovery", item: { query,
          lane: "web", window: (Math.floor(Date.now()/86400000)+index)%4===0 ? "explore" : "recent", scheduled_day: day } });
    const jobs = await rpc("ss_claim_jobs", { batch_size: 8 });
    const start = Date.now();
    for (const job of jobs) {
      if (Date.now() - start > 85000) {
        await db("ss_jobs?id=eq." + job.id, "PATCH", {
          status: "pending",
          attempts: Math.max(0, job.attempts - 1),
          available_at: new Date(Date.now() + 300000).toISOString(),
        });
        continue;
      }
      try {
        if (job.kind === "source") await sourceJob(job, profile);
        else if (job.kind === "discovery")
          await (job.payload.lane === "trending" ? trendingDiscovery(job.payload.window,profile) : job.payload.lane === "repository" ? repoDiscovery(job.payload.query, profile) : discovery({ ...profile, queries: [job.payload.query], _allowedQueries: profile.queries, _searchLane: job.payload.window }));
        else if (job.kind === "analyze") await ingest(job.payload, profile);
        else await articleJob(job, profile);
        // Completed work needs no durable copy of source text or rejected URLs.
        await db("ss_jobs?id=eq." + job.id, "DELETE");
        count++;
      } catch (e) {
        if (job.kind === "discovery" && !(["repository","trending"].includes(job.payload.lane)))
          await webHealth({ state: e instanceof Deferred ? "deferred" : "error", last_error: (e as Error).message.slice(0,200) });
        if (job.kind === "discovery" && ["repository","trending"].includes(job.payload.lane)) {
          const previous = await db("ss_settings?key=eq.discovery_health&select=value");
          await db("ss_settings?on_conflict=key", "POST", { key: "discovery_health", value: { ...previous[0]?.value,
            [job.payload.lane==="trending" ? "trending_last_error" : "repository_last_error"]: (e as Error).message.slice(0,200) }, updated_at: new Date().toISOString() }, "resolution=merge-duplicates,return=representation");
        }
        await db("ss_jobs?id=eq." + job.id, "PATCH", {
          status: e instanceof Deferred ? "pending" : job.attempts >= 4 ? "failed" : "pending",
          ...(e instanceof Deferred ? { attempts: Math.max(0, job.attempts-1) } : {}),
          available_at: new Date(
            e instanceof Deferred ? e.retryAt : Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts),
          ).toISOString(),
          last_error: (e as Error).message.slice(0, 200),
        });
      }
    }
    // A separate authenticated cron invocation evaluates; collection never waits on Google.
    return new Response(JSON.stringify({ ok: true, processed: count }), {
      headers,
    });
  } catch {
    return new Response('{"error":"Collector run failed"}', {
      status: 503,
      headers,
    });
  }
});
