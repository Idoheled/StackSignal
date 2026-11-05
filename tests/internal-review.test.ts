import test from "node:test";
import assert from "node:assert/strict";
import {commitInternalReviewBatches,internalReview,immediateInternalReview} from "../supabase/functions/_shared/internal-review.ts";
const now=Date.now();
const row=(text:string,url="https://docs.vllm.ai/engineering")=>({url,title:"Cache engineering",topic:"Inference",input:{title:"Cache engineering",scope:"publisher_excerpt",text}});
test("local evidence rules require a source-bound mechanism and distinguish unknown from irrelevant",()=>{
 const text="The implementation configures KV cache offloading over NIXL to NVMe. The benchmark measures TTFT and throughput under concurrent long-context requests. The kernel reuses cached blocks and isolates memory for multiple tenants. This documentation specifies configuration prerequisites and tests recovery behavior.";
 const r=internalReview(row(text),{},now);
 assert.equal(r.assessment.decision,"useful");assert.equal(r.assessment.confidence,"medium");assert(text.includes(r.assessment.evidence));assert(immediateInternalReview(row(text.repeat(2)),internalReview(row(text.repeat(2)),{},now)));
 assert.equal(internalReview(row("GPU LLM KV cache prefill decode networking performance benchmark ".repeat(10)),{},now).assessment.decision,"insufficient_evidence","keyword stuffing is not an action or a concrete result");
 assert.equal(internalReview(row("GPU LLM KV cache configuration deployment benchmark architecture ".repeat(10)),{},now).assessment.decision,"insufficient_evidence","configuration/deployment nouns alone are not implementation actions");
 assert.equal(internalReview(row("Tiny fragment"),{},now).assessment.decision,"insufficient_evidence");
 const generated="AI-Generated Summary "+text+" Powered by NVIDIA Nemotron. Learn more The authored body provides no usable technical information.";
 assert.notEqual(internalReview(row(generated),{},now).assessment.decision,"useful","a publisher AI summary cannot be the sole mechanism evidence");
 const authored="AI-Generated Summary Generic promotional text. Powered by NVIDIA Nemotron. Learn more "+text;
 assert.equal(internalReview(row(authored),{},now).assessment.decision,"useful");
 assert(!internalReview(row(authored),{},now).assessment.evidence.includes("Generic promotional"));
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

test("public evidence never splits a Unicode character at PostgreSQL JSON boundaries",async()=>{
 const {publicFragment}=await import('../supabase/functions/_shared/internal-review.ts');
 for(const [text,start,end] of [['a'.repeat(139)+'🚀 technical',0,140],['🚀 technical',1,10]] as [string,number,number][]){
  const quote=publicFragment(text,start,end);assert(quote.isWellFormed());assert(text.includes(quote));
 }
 const value=internalReview(row('a'.repeat(139)+'🚀 irrelevant text with no engineering evidence'));
 assert(value.assessment.evidence.isWellFormed());assert(value.assessment.summary.isWellFormed());
});

test("removing a publisher AI summary never splices nonadjacent fragments into evidence",()=>{
 const authored="As GPU clusters scale, the implementation configures KV cache offloading to NVMe and measures TTFT for concurrent requests. This configuration documents how to deploy the gateway and isolate its memory.";
 const text="Like Discuss (0) L T F R E AI-Generated Summary Generic promotional copy with no original procedure. Learn more "+authored;
 const review=internalReview(row(text,"https://developer.nvidia.com/blog/cluster-engineering"),{},now);
 assert.equal(review.assessment.decision,"useful","authored evidence remains eligible");
 assert(text.includes(review.assessment.evidence),"the database evidence gate must find an exact original-source substring");
 assert(authored.includes(review.assessment.evidence),"the quote must not cross the removed-summary boundary");
});

test("unsupported provenance and evidence shorter than the database minimum stay uncertain",()=>{
 const substantial=row("The implementation configures GPU KV cache offloading to NVMe. The benchmark measures throughput and TTFT in concurrent deployments.");
 const unknown=internalReview({...substantial,input:{...substantial.input,scope:"unknown"}},{},now);
 const short=internalReview(row(" ".repeat(180)+"🚀".repeat(9)),{},now);
 for(const r of [unknown,short]){
  assert.equal(r.assessment.decision,"insufficient_evidence");
  assert.equal(r.assessment.evidence,"");
  assert.equal(r.assessment.confidence,"low");
 }
});

test("validation isolation bounds extra database work and leaves deferred rows unchanged",async()=>{
 const rejected=new Error("validation"), rows=Array.from({length:500},(_,i)=>i);
 let attempts=0;
 const result=await commitInternalReviewBatches(rows,async()=>{attempts++;throw rejected;},error=>error===rejected,Infinity);
 assert(attempts<50,"a large group of invalid inputs cannot fan out into hundreds of writes");
 assert.equal(result.committed+result.skipped+result.rejected+result.deferred,rows.length);
 assert(result.deferred>0);
 const transient=new Error("database unavailable");
 attempts=0;
 await assert.rejects(commitInternalReviewBatches(rows,async()=>{attempts++;throw transient;},error=>error===rejected,Infinity),e=>e===transient);
 assert.equal(attempts,1,"a systemic outage must not cause batch bisection");
 attempts=0;
 const expired=await commitInternalReviewBatches(rows,async()=>{attempts++;return {committed:0,skipped:0};},()=>false,1,()=>1);
 assert.equal(attempts,0);
 assert.equal(expired.deferred,rows.length);
});
