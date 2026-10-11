import test from "node:test";
import assert from "node:assert/strict";
import { publicTeam, publicInput, evaluationRequest, parseEvaluation, effectiveScore, evaluationCandidates, MAX_INPUT_BYTES, nextEvaluationAt, samePublicInput } from "../supabase/functions/_shared/evaluation.ts";
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
test("sampling reserves attention for low keyword exploration while avoiding guaranteed release alerts",()=>{
  const row=(id:string,score:number,meta={})=>({id,score,reference_meta:{public_evaluation_input:input,...meta}});
  const rows=[row("strong",95),row("borderline",60),row("unfamiliar",20),row("release",88,{alert_kind:"release"}),{id:"private",score:90}];
  assert.equal(evaluationCandidates(rows,0)[0].id,"strong");
  assert.equal(evaluationCandidates(rows,1)[0].id,"borderline");
  assert.equal(evaluationCandidates(rows,2)[0].id,"unfamiliar");
  assert.equal(evaluationCandidates(rows,0).length,3);
});

test("pacing spreads remaining monthly attempts, respects daily spacing and rolls into a new month",()=>{
  const now=Date.parse("2026-10-11T11:00:00Z"), last="2026-10-11T10:00:00Z";
  const next=nextEvaluationAt({used_month:1,last_attempt:last},4,100,now);
  assert(next>=Date.parse(last)+6*3600000);
  assert.equal(nextEvaluationAt({used_month:100,last_attempt:last},4,100,now),Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(nextEvaluationAt({used_month:0},4,100,now),0);
  assert.equal(nextEvaluationAt({used_month:1,last_attempt:last},1,100,now),Date.parse(last)+86400000);
  const feb=Date.parse("2028-02-01T00:00:00Z");
  assert.equal(nextEvaluationAt({used_month:99,last_attempt:"2028-02-01T00:00:00Z"},4,100,feb),Date.parse("2028-03-01T00:00:00Z"));
  const rollover=nextEvaluationAt({used_month:0,last_attempt:"2026-10-31T23:00:00Z"},4,100,Date.parse("2026-11-01T01:00:00Z"));
  assert.equal(rollover,Date.parse("2026-11-01T05:00:00Z"));
});
