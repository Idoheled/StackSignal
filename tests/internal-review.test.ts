import test from "node:test";
import assert from "node:assert/strict";
import {internalReview,immediateInternalReview} from "../supabase/functions/_shared/internal-review.ts";
const now=Date.now();
const row=(text:string,url="https://docs.vllm.ai/engineering")=>({url,title:"Cache engineering",topic:"Inference",input:{title:"Cache engineering",scope:"publisher_excerpt",text}});
test("local evidence rules require a source-bound mechanism and distinguish unknown from irrelevant",()=>{
 const text="The implementation configures KV cache offloading over NIXL to NVMe. The benchmark measures TTFT and throughput under concurrent long-context requests. The kernel reuses cached blocks and isolates memory for multiple tenants. This documentation specifies configuration prerequisites and tests recovery behavior.";
 const r=internalReview(row(text),{},now);
 assert.equal(r.assessment.decision,"useful");assert.equal(r.assessment.confidence,"medium");assert(text.includes(r.assessment.evidence));assert(immediateInternalReview(row(text.repeat(2)),internalReview(row(text.repeat(2)),{},now)));
 assert.equal(internalReview(row("GPU LLM KV cache prefill decode networking performance benchmark ".repeat(10)),{},now).assessment.decision,"insufficient_evidence","keyword stuffing is not an action or a concrete result");
 assert.equal(internalReview(row("GPU LLM KV cache configuration deployment benchmark architecture ".repeat(10)),{},now).assessment.decision,"insufficient_evidence","configuration/deployment nouns alone are not implementation actions");
 assert.equal(internalReview(row("Tiny fragment"),{},now).assessment.decision,"insufficient_evidence");
 assert.equal(internalReview({...row(text),title:"Neonatal EEG detection",input:{...row(text).input,title:"Neonatal EEG detection"}}, {},now).assessment.decision,"tangential");
 assert.equal(internalReview(row(text,"https://example.com/jobs/network-engineer"),{},now).assessment.decision,"tangential");
 assert.equal(internalReview(row(text,"https://www.facebook.com/groups/a/posts/b"),{},now).assessment.decision,"tangential");
});
test("repository policy and source scope remain mandatory for local review",()=>{
 const text="The implementation deploys a GPU inference gateway with KV cache routing. Configuration includes kubectl and helm commands. The benchmark measures throughput and TTFT under concurrent traffic.";
 const repo={...row(text,"https://github.com/example/tool"),reference_meta:{repo_health:{active:true,checked_at:new Date(now).toISOString(),stars:3,watchers:0,license:"Apache-2.0"}}};
 assert.equal(internalReview(repo,{},now).assessment.decision,"tangential");
 const search={...row(text),input:{...row(text).input,scope:"search_snippet"}};
 assert.equal(immediateInternalReview(search,internalReview(search,{},now)),false);
 const watched={...search,reference_meta:{alert_kind:"release"}};
 assert(immediateInternalReview(watched,internalReview(watched,{},now)));
});

test("followed releases may use a concrete component change without accepting bare version labels",()=>{
 const input={title:"v26.10-beta",scope:"publisher_excerpt",text:"This followed release updates the OFED version to doca3.6.0-26.10-050000-0 for the network driver component. The publisher links the exact component change and release comparison for compatibility review. Additional build-only changes do not establish runtime performance gains."};
 const r={url:"https://docs.nvidia.com/release",topic:"Networking",kind:"Release",input,reference_meta:{origin:"source_watch",source_id:"watch",alert_kind:"release"}};
 assert.equal(internalReview(r,{},now).assessment.decision,"useful");
 const bare={...r,input:{...input,text:"Release v26.10.0-beta.4. Version v26.10.0-beta.4 published. This release is a new preview version; no actual changes are included in this captured public source."}};
 assert.notEqual(internalReview(bare,{},now).assessment.decision,"useful");
});
