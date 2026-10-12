import test from "node:test";
import assert from "node:assert/strict";
import { publicTeam, publicInput, evaluationRequest, parseEvaluation, effectiveScore, evaluationCandidates, MAX_INPUT_BYTES, nextEvaluationAt, samePublicInput, batchEvaluationRequest, parseBatchEvaluation, MAX_BATCH_SIZE, evaluationFailure, evaluationBatchSize } from "../supabase/functions/_shared/evaluation.ts";
const text = "This reproducible guide configures KV cache offloading and compares latency under controlled request concurrency. ";
const input = publicInput({title:"Cache engineering",kind:"Discovery",reference_meta:{link_status:"search_result"}},text)!;
const result = {topic:"Inference",score:90,confidence:"high",depth:"advanced",decision:"useful",summary:"Cache offloading guidance.",reason:"Relevant cache engineering.",action:"Review the concurrency comparison.",evidence:"configures KV cache offloading"};
const output=(r:any,finishReason="STOP")=>({candidates:[{finishReason,content:{parts:[{text:JSON.stringify(r)}]}}]});
test("evaluation discloses public allowlisted context and bounded excerpts without private profile data or tools",()=>{
  const team=publicTeam({interests:"vLLM, secret.internal, private project, H200",priorities:{Inference:99},notes:"secret",queries:["private query"]});
  const bounded=publicInput({title:"x".repeat(1000),kind:"Repository"},"😀".repeat(6000))!;
  assert(new TextEncoder().encode(bounded.text).length<=MAX_INPUT_BYTES);assert.equal(bounded.scope,"repository_metadata");
  const request=evaluationRequest(bounded,team), serialized=JSON.stringify(request);
  assert(!serialized.includes("secret.internal"));assert(!serialized.includes("private project"));assert(!serialized.includes("private query"));
  assert.deepEqual(team.interests,["vLLM","H200"]);assert.equal(team.priorities.Inference,20);
  assert.equal(request.generationConfig.maxOutputTokens,650);assert.equal(request.generationConfig.thinkingConfig.thinkingLevel,"LOW");
  assert.equal("tools" in request,false);assert.equal(request.store,false);
  assert.equal(publicInput({title:"short"},"tiny"),null);
  assert(samePublicInput(input,{scope:input.scope,text:input.text,title:input.title}),"JSONB key order must not invalidate cached input");
  assert(!samePublicInput(input,{...input,text:input.text+" changed"}));
});
test("evaluation rejects invented evidence, incomplete or malformed output; accepts explicit uncertainty",()=>{
  assert.deepEqual(parseEvaluation(output(result),input),result);
  for(const change of [{evidence:"invented quote"},{score:900},{summary:{inject:"HTML"}},{topic:"Other"},{extra:"instruction"}])
    assert.throws(()=>parseEvaluation(output({...result,...change}),input));
  assert.throws(()=>parseEvaluation(output(result,"MAX_TOKENS"),input));
  const uncertain={...result,decision:"insufficient_evidence",confidence:"low",depth:"unknown",score:20,evidence:""};
  assert.deepEqual(parseEvaluation(output(uncertain),input),uncertain);
  assert.equal(effectiveScore(80,uncertain,"rerank",false),80);
  assert.equal(effectiveScore(80,result,"shadow",false),80);
  assert.equal(effectiveScore(88,{...result,score:5},"rerank",true),88);
  assert.equal(effectiveScore(80,{...result,confidence:"medium"},"rerank",false),80);
  assert.equal(effectiveScore(80,result,"rerank",false),87);
});
test("sampling reserves attention for low keyword exploration while reviewing followed releases too",()=>{
  const row=(id:string,score:number,meta={})=>({id,score,reference_meta:{public_evaluation_input:input,...meta}});
  const rows=[row("strong",95),row("borderline",60),row("unfamiliar",20),row("release",88,{alert_kind:"release"}),{id:"private",score:90}];
  assert.equal(evaluationCandidates(rows,0)[0].id,"release");
  const discovery=rows.filter(r=>r.id!=="release");
  assert.equal(evaluationCandidates(discovery,0)[0].id,"strong");
  assert.equal(evaluationCandidates(discovery,1)[0].id,"borderline");
  assert.equal(evaluationCandidates(discovery,2)[0].id,"unfamiliar");
  assert.equal(evaluationCandidates(rows,0).length,4);
});

test("batch judgments stay bound to their own source and fail closed on identities",()=>{
  const second={...input,text:"This reproducible guide explains NUMA placement and GPU topology for inference."};
  const sources=[{id:"one",input},{id:"two",input:second}];
  const request=batchEvaluationRequest(sources,publicTeam({}));
  assert.equal(request.generationConfig.maxOutputTokens,1800);
  assert.equal(request.store,false);assert.equal("tools" in request,false);
  const valid2={...result,evidence:"NUMA placement and GPU topology"};
  const parsed=parseBatchEvaluation(output({results:[{id:"two",assessment:valid2},{id:"one",assessment:result}]}),sources);
  assert.equal(parsed.valid.size,2);assert.equal(parsed.invalid.length,0);
  const crossed=parseBatchEvaluation(output({results:[{id:"two",assessment:result},{id:"one",assessment:result}]}),sources);
  assert.equal(crossed.valid.size,1);assert.deepEqual(crossed.invalid,["two"]);
  for(const ids of [["one","one"],["one","unknown"]]) assert.throws(()=>parseBatchEvaluation(output({results:ids.map(id=>({id,assessment:result}))}),sources));
  assert.throws(()=>parseBatchEvaluation(output({results:[]},"MAX_TOKENS"),sources));
  assert.deepEqual(parseBatchEvaluation(output({results:[]}),sources).invalid,["one","two"]);
  assert.throws(()=>batchEvaluationRequest(Array.from({length:MAX_BATCH_SIZE+1},(_,i)=>({id:String(i),input})),publicTeam({})));
  const full=batchEvaluationRequest(Array.from({length:MAX_BATCH_SIZE},(_,i)=>({id:String(i),input})),publicTeam({}));
  assert.equal(full.generationConfig.maxOutputTokens,10800);
});
test("transient outages stay retryable beyond three failures, honor Retry-After and keep validation distinct",()=>{
  const now=Date.parse("2026-10-12T12:00:00Z");
  for(const status of [408,429,500,503,504]) assert(evaluationFailure("HTTP "+status,8,status,null,now,0).retryAt!>now);
  assert.equal(evaluationFailure("Signal timed out.",8,0,null,now,0).kind,"transient");
  assert.equal(evaluationFailure("HTTP 503",1,503,"900",now,0).retryAt,now+900000);
  assert.equal(evaluationFailure("HTTP 429",1,429,new Date(now+1200000).toUTCString(),now,0).retryAt,now+1200000);
  assert.equal(evaluationFailure("Unsupported evidence",3,0,null,now,0).retryAt,null);
  assert.equal(evaluationFailure("HTTP 403",1,403,null,now,0).kind,"configuration");
  assert.equal(evaluationBatchSize({}),12);assert.equal(evaluationBatchSize({target_batch_size:99}),12);
  assert.equal(evaluationBatchSize({target_batch_size:3}),3);
});
test("age prevents starvation and followed releases get attention before fresh generic discoveries",()=>{
  const now=Date.parse("2026-10-12T12:00:00Z");
  const row=(id:string,age:number,meta={})=>({id,score:90,discovered_at:new Date(now-age).toISOString(),reference_meta:{public_evaluation_input:input,...meta}});
  const rows=[row("fresh",1000),row("release",2000,{alert_kind:"release"}),row("old",86400001)];
  assert.deepEqual(evaluationCandidates(rows,0,now).map(r=>r.id),["old","release","fresh"]);
});
test("on-demand pacing reserves five-minute spacing and stops at configured budgets",()=>{
  const now=Date.parse("2026-10-11T11:00:00Z"),last="2026-10-11T10:59:00Z";
  assert.equal(nextEvaluationAt({used_month:1,last_attempt:last},16,496,now),Date.parse(last)+300000);
  assert.equal(nextEvaluationAt({used_month:496,last_attempt:last},16,496,now),Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(nextEvaluationAt({used_month:0},16,496,now),0);
  assert(nextEvaluationAt({used_month:16,used_24h:16,last_attempt:last},16,496,now)>now);
  const firstSlot="2026-10-12T10:48:30Z";
  assert.equal(nextEvaluationAt({used_month:16,used_24h:16,last_attempt:last,next_available_at:firstSlot},16,496,now),Date.parse(firstSlot),"Use the oldest released rolling slot, not the last request plus 24 hours");
});
