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
import { EVALUATOR_VERSION, EVALUATION_MODEL, publicInput, publicTeam, evaluationRequest, parseEvaluation, effectiveScore, evaluationCandidates, candidateLane, nextEvaluationAt, samePublicInput, batchEvaluationRequest, parseBatchEvaluation, MAX_BATCH_SIZE, DAILY_REQUEST_CAP, MONTHLY_REQUEST_CAP } from "../_shared/evaluation.ts";
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
async function bodyText(res: Response) {
  if (Number(res.headers.get("content-length") || 0) > 2_000_000) {
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
    if (size > 2_000_000) {
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
async function fetchPublic(input: string, etag?: string) {
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
      text: await bodyText(res),
      etag: res.headers.get("etag"),
    };
  }
  throw new Error("Too many source redirects");
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
  const [eligible,pending,failed,missing] = await Promise.all([
    articleCount(eligibleEvaluation),articleCount(pendingEvaluation),
    articleCount(eligibleEvaluation+"&reference_meta->>evaluation_failed_at=not.is.null"),
    articleCount("deleted_at=is.null&reference_meta->>public_evaluation_input=is.null"),
  ]);
  return {eligible,pending,failed,missing_public_input:missing,evaluated:Math.max(0,eligible-pending-failed),checked_at:new Date().toISOString()};
}
async function failedEvaluation(row: any, delay=86400000) {
  const failures=Number(row.reference_meta?.evaluation_failures||0)+1;
  await db("ss_articles?id=eq."+row.id+"&content_hash=eq."+encodeURIComponent(row.content_hash)+"&deleted_at=is.null", "PATCH",
    {reference_meta:{...row.reference_meta,evaluation_failed_at:new Date().toISOString(),evaluation_failures:failures,
      evaluation_retry_at:failures<3 ? new Date(Date.now()+delay).toISOString() : null}});
}
async function queueMissingPublicInputs() {
  const rows=await db("ss_articles?deleted_at=is.null&reference_meta->>public_evaluation_input=is.null&reference_meta->>public_extraction_requested=is.null&select=id,url,kind,topic,content_hash,reference_meta&order=discovered_at.asc,id.asc&limit=8");
  for(const row of rows) {
    const approved=!!safeURL(row.url,hosts) && !new URL(row.url).pathname.toLowerCase().endsWith(".pdf");
    if(approved) await rpc("ss_queue_item",{job_kind:"article",item:{url:row.url,kind:row.kind,topic:row.topic}});
    await db("ss_articles?id=eq."+row.id+(row.content_hash ? "&content_hash=eq."+encodeURIComponent(row.content_hash) : "&content_hash=is.null"),"PATCH",{reference_meta:{...row.reference_meta,public_extraction_requested:approved ? "queued" : "unsupported"}});
  }
}
async function evaluateSweep(profile: any) {
  const configured = !!env("GEMINI_API_KEY");
  const mode = ["shadow","rerank"].includes(profile.gemini_mode) ? profile.gemini_mode : "off";
  const limit = Math.max(0,Math.min(Number(profile.gemini_daily_limit)||0,DAILY_REQUEST_CAP));
  const monthly = Math.max(0,Math.min(Number(profile.gemini_monthly_limit)||0,MONTHLY_REQUEST_CAP));
  const old = await db("ss_settings?key=eq.evaluation_health&select=value");
  const health = old[0]?.value || {};
  if (configured) {
    try { await evaluationHealth({coverage:await evaluationCoverage()}); } catch { /* Counts never spend quota. */ }
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
    await evaluationHealth({configured:true,mode,model:EVALUATION_MODEL,state:"budget_wait",next_attempt_at:null,daily_ceiling:limit,monthly_ceiling:monthly,usage}); return;
  }
  const next=nextEvaluationAt(usage,limit,monthly);
  if(next>Date.now()) {
    await evaluationHealth({configured:true,mode,model:EVALUATION_MODEL,state:"pacing_wait",next_attempt_at:new Date(next).toISOString(),daily_ceiling:limit,monthly_ceiling:monthly,usage}); return;
  }
  const filter=eligibleEvaluation+"&reference_meta->>evaluation=is.null&or=(reference_meta->>evaluation_failed_at.is.null,reference_meta->>evaluation_retry_at.lte."+new Date().toISOString()+")";
  const rows=await db("ss_articles?"+filter+"&select=id,url,score,content_hash,discovered_at,reference_meta,kind&order=discovered_at.asc,id.asc&limit=50");
  const team=publicTeam(profile), candidates=[];
  // Oldest queue window plus rotating lane preference balances useful known material and unfamiliar ideas.
  for(const row of evaluationCandidates(rows,Number(usage.used_month)||0)) {
    const input=row.reference_meta.public_evaluation_input;
    const cache_key=await digest(JSON.stringify({version:EVALUATOR_VERSION,model:EVALUATION_MODEL,input,team}));
    candidates.push({...row,cache_key}); if(candidates.length===50) break;
  }
  if(!candidates.length) { await evaluationHealth({state:"ready",usage,next_attempt_at:null}); return; }
  const reservation=await rpc("ss_reserve_evaluation_batch",{items:candidates.map(r=>({id:r.id,cache_key:r.cache_key,content_hash:r.content_hash})),daily_max:limit,monthly_max:monthly});
  if(!reservation?.request_id) { await evaluationHealth({state:"reservation_wait",usage:await rpc("ss_evaluation_usage")}); return; }
  const batch=candidates.filter(r=>reservation.items.some((i:any)=>i.id===r.id));
  const inputs=batch.map(r=>({id:r.id,input:r.reference_meta.public_evaluation_input}));
  let out:any, parsed:ReturnType<typeof parseBatchEvaluation>;
  try {
    const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+EVALUATION_MODEL+":generateContent",{
      method:"POST",redirect:"error",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json","x-goog-api-key":env("GEMINI_API_KEY")},body:JSON.stringify(batchEvaluationRequest(inputs,team)),
    });
    if(!response.ok) {
      await response.body?.cancel();
      const temporary=response.status>=500;
      const cooldown=temporary ? 900000 : 86400000;
      for(const row of batch) await failedEvaluation(row,temporary ? 21600000 : 86400000);
      await evaluationHealth({state:"cooldown",next_attempt_at:null,last_error:"Gemini HTTP "+response.status+"; pending links withheld",usage:await rpc("ss_evaluation_usage"),cooldown_until:new Date(Date.now()+cooldown).toISOString()}); return;
    }
    out=JSON.parse(await bodyText(response));parsed=parseBatchEvaluation(out,inputs);
  } catch {
    for(const row of batch) await failedEvaluation(row,21600000);
    await evaluationHealth({state:"cooldown",next_attempt_at:null,last_error:"Incomplete or invalid batch; pending links withheld",usage:await rpc("ss_evaluation_usage"),cooldown_until:new Date(Date.now()+3600000).toISOString()}); return;
  }
  const resolved_model=typeof out.modelVersion==="string" ? out.modelVersion.slice(0,120) : null;
  const tokens={input_tokens:Number(out.usageMetadata?.promptTokenCount)||0,output_tokens:Number(out.usageMetadata?.candidatesTokenCount)||0,thinking_tokens:Number(out.usageMetadata?.thoughtsTokenCount)||0};
  const comparisons=[];
  for(const row of batch) {
    const result=parsed.valid.get(row.id);
    if(!result) { await failedEvaluation(row,21600000); continue; }
    const current=(await db("ss_articles?id=eq."+row.id+"&select=score,reference_meta,content_hash,deleted_at"))[0];
    const input=row.reference_meta.public_evaluation_input;
    if(!current || current.deleted_at || current.content_hash!==row.content_hash || !samePublicInput(current.reference_meta?.public_evaluation_input,input)) continue;
    const rules=current.reference_meta?.evaluation?.rules_score ?? current.score;
    const score=effectiveScore(rules,result,mode,!!current.reference_meta.alert_kind);
    const evaluated_at=new Date().toISOString();
    const evaluation={...result,rules_score:rules,applied_score:score,mode,model:EVALUATION_MODEL,resolved_model,scope:input.scope,version:EVALUATOR_VERSION,cache_key:row.cache_key,evaluated_at,request_id:reservation.request_id};
    const patch:any={reference_meta:{...current.reference_meta,evaluation,evaluation_failed_at:null,evaluation_retry_at:null,evaluation_failures:0}};
    if(mode==="rerank" && result.confidence==="high" && result.decision!=="insufficient_evidence") Object.assign(patch,{score,analysis_status:"ai",summary:result.summary,reason:result.reason,evidence:result.evidence});
    await db("ss_articles?id=eq."+row.id+"&content_hash=eq."+encodeURIComponent(row.content_hash)+"&deleted_at=is.null","PATCH",patch);
    comparisons.push({article_id:row.id,title:input.title,lane:candidateLane(row),rules_score:rules,ai_score:result.score,applied_score:score,...result,model:EVALUATION_MODEL,resolved_model,scope:input.scope,evaluated_at});
    // One approved-host enrichment attempt for insufficient snippets. No model-selected URL or broader fetch allowlist.
    if(result.decision==="insufficient_evidence" && input.scope==="search_snippet" && !current.reference_meta.evaluation_enrichment_requested && row.url && safeURL(row.url,hosts)) {
      await rpc("ss_queue_item",{job_kind:"article",item:{url:row.url,kind:row.kind}});
      await db("ss_articles?id=eq."+row.id+"&content_hash=eq."+encodeURIComponent(row.content_hash),"PATCH",{reference_meta:{...patch.reference_meta,evaluation_enrichment_requested:true}});
    }
  }
  const previous=await db("ss_settings?key=eq.evaluation_health&select=value");
  await evaluationHealth({configured:true,mode,model:EVALUATION_MODEL,resolved_model,state:parsed.invalid.length ? "partial_batch" : "active",next_attempt_at:null,last_success:new Date().toISOString(),last_error:parsed.invalid.length ? "Some batch results failed evidence validation; those links withheld" : null,cooldown_until:null,
    daily_ceiling:limit,monthly_ceiling:monthly,batch_size:batch.length,last_batch_reviewed:comparisons.length,last_request_tokens:tokens,usage:await rpc("ss_evaluation_usage"),comparisons:[...comparisons,...(previous[0]?.value?.comparisons||[])].slice(0,12)});
  try { await evaluationHealth({coverage:await evaluationCoverage()}); } catch { /* Non-critical health snapshot. */ }
}
async function ingest(item: any, profile: any) {
  let url: string;
  try {
    url = canonicalLink(item.url);
  } catch {
    return;
  }
  const u = new URL(url);
  if (item.kind === "Release" && u.hostname === "github.com") {
    const tag = item.reference_meta?.tag || u.pathname.split("/releases/tag/")[1];
    item.reference_meta = { ...item.reference_meta, prerelease: isPrerelease({ prerelease: item.reference_meta?.prerelease, tag_name: tag }) };
  }
  if (item.reference_meta?.source_id) {
    const watched = await db("ss_sources?id=eq." + encodeURIComponent(item.reference_meta.source_id) + "&select=active,revision,include_prereleases");
    if (!watched[0]?.active || watched[0].revision !== item.reference_meta.source_revision) return;
    if (item.reference_meta.prerelease && !watched[0].include_prereleases) return;
  }
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
      ...(changedInput ? {evaluation:null,evaluation_failed_at:null,evaluation_retry_at:null,evaluation_failures:0} : {}),
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
      const first = await fetchPublic(requestURL.toString(), source.etag);
      if (first.unchanged) return first;
      let values = JSON.parse(first.text);
      if (!Array.isArray(values)) throw new Error("Invalid GitHub release list");
      let pageValues = values;
      const since = Math.max(Date.now() - 90 * 86400000, (Date.parse(source.last_success_at || "") || 0) - 7 * 86400000);
      // Persist the first-page ETag only after every required page succeeds.
      // Changed sources inspect a seven-day overlap; first scans cover up to 90 days.
      for (let page = 2; page <= 5 && pageValues.length === size && pageValues.some((x: any) => Date.parse(x.published_at || "") >= since); page++) {
        requestURL.searchParams.set("page", String(page));
        const next = await fetchPublic(requestURL.toString());
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
    } else res = await fetchPublic(requestURL.toString(), source.etag);
    const meta = { origin: "source_watch", source_id: source.id, source_revision: source.revision };
    if (!res.unchanged) {
      if (source.type === "github") {
        const entries = githubItems(JSON.parse(res.text), source);
        await rpc("ss_queue_items", { job_kind: "analyze", items: entries.map(payload => ({ ...payload, reference_meta: { ...payload.reference_meta, ...meta } })) });
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
        await rpc("ss_queue_items", { job_kind: "analyze", items: entries.map(item => ({
          ...item, source: source.name, kind: source.url.includes("arxiv.org") ? "Paper" : "Article", priority: source.priority,
          reference_meta: { ...meta, discovery_lane: "publication_feed" },
        })) });
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
      last_error: null,
    });
  } catch (e) {
    await db("ss_sources?id=eq." + source.id + "&revision=eq." + source.revision, "PATCH", {
      last_error: (e as Error).message.slice(0, 200),
    });
    throw e;
  }
}
async function articleJob(job: any, profile: any) {
  const repository=new URL(job.payload.url);
  const repo=repository.hostname==="github.com" && repository.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/);
  if(repo) {
    const endpoint="https://api.github.com/repos/"+repo[1]+"/"+repo[2];
    const metadata=JSON.parse((await fetchPublic(endpoint)).text);
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
      reference_meta:{repository:metadata.full_name,license:metadata.license?.spdx_id||"Unspecified"}},profile);
    return;
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
  const m = htmlMeta(res.text);
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
    const url = "https://github.com/" + x.full_name;
    await ingest({ url, title: x.full_name, source: "GitHub", author: x.owner?.login,
      summary: textOnly(String(x.description || "")).slice(0,600), text: [x.description, ...(x.topics || [])].join(" "),
      kind: "Repository", published_at: dateISO(x.created_at), updated_at: dateISO(x.pushed_at),
      reference_meta: { origin: "discovery", discovery_lane: "repository_search", repository: x.full_name,
        stars: Math.max(0, Number(x.stargazers_count) || 0), license: String(x.license?.spdx_id || "Unspecified").slice(0,80) },
    }, profile);
  }
  const previous = await db("ss_settings?key=eq.discovery_health&select=value");
  await db("ss_settings?on_conflict=key", "POST", { key: "discovery_health", value: { ...previous[0]?.value,
    repository_last_success: new Date().toISOString(), repository_results: result.items.length,
    repository_partial: !!result.incomplete_results, repository_last_error: null }, updated_at: new Date().toISOString() }, "resolution=merge-duplicates,return=representation");
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
    const day = new Date().toISOString().slice(0, 10);
    if (await budget("maintenance:" + day, 1, 86400))
      await rpc("ss_maintenance");
    await rpc("ss_enqueue_sources");
    const settings = await db("ss_settings?key=eq.profile&select=value");
    const profile = { ...settings[0].value, _tagWeights: await rpc("ss_feedback_weights") };
    const webEnabled = !!env("TAVILY_API_KEY") && Number(profile.search_monthly_limit) > 0;
    await webHealth({ configured: !!env("TAVILY_API_KEY"), monthly_ceiling: Math.min(Number(profile.search_monthly_limit)||0,800),
      daily_ceiling: 24, ...(webEnabled ? {} : { state: env("TAVILY_API_KEY") ? "paused" : "missing_key" }) });
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
          await (job.payload.lane === "repository" ? repoDiscovery(job.payload.query, profile) : discovery({ ...profile, queries: [job.payload.query], _allowedQueries: profile.queries, _searchLane: job.payload.window }));
        else if (job.kind === "analyze") await ingest(job.payload, profile);
        else await articleJob(job, profile);
        await db("ss_jobs?id=eq." + job.id, "PATCH", {
          status: "done",
          last_error: null,
        });
        count++;
      } catch (e) {
        if (job.kind === "discovery" && job.payload.lane !== "repository")
          await webHealth({ state: e instanceof Deferred ? "deferred" : "error", last_error: (e as Error).message.slice(0,200) });
        if (job.kind === "discovery" && job.payload.lane === "repository") {
          const previous = await db("ss_settings?key=eq.discovery_health&select=value");
          await db("ss_settings?on_conflict=key", "POST", { key: "discovery_health", value: { ...previous[0]?.value,
            repository_last_error: (e as Error).message.slice(0,200) }, updated_at: new Date().toISOString() }, "resolution=merge-duplicates,return=representation");
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
    // AI failures cannot fail collection or trigger queue retries.
    try { await evaluateSweep(profile); } catch { /* Collection remains available. */ }
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
