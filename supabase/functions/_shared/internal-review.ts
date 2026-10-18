import { TOPIC_TERMS, basicRelevance } from "../../../lib/domain.ts";
import { TRUSTED_HOSTS } from "./content.ts";
import { articleRepositoryAdmitted } from "./repository-health.ts";
export const INTERNAL_REVIEW_VERSION="dry-evidence-v1";
export const INTERNAL_REVIEW_DELAY_MS=24*3600000;
const unrelated=/\b(neonatal|glucose|perovskite|photovoltaic|survival analysis|molecular|shock response|laplace equation|market impact|smart buildings)\b/i;
const excludedURL=/(?:\/job(?:s|-in|-|\/)|\/offer\/|\/sitemap(?:\/|$)|linkedin\.com\/top-content|facebook\.com\/)/i;
const concepts=/\b(?:llms?|language models?|gpus?|nic|ofed|doca|crd|dscp|cnp|mtu|multus|ipoib|daemonset|rdma|roce|infiniband|nccl|gpudirect|pfc|ecn|kubernetes|openshift|hypershift|numa|pcie|nvme|firmware|kv[ -]cache|prefix cach\w*|prefill|decode|tokeniz\w*|moe|expert parallel\w*|quantiz\w*|checkpoint\w*|serverless|scheduling|offload\w*|gateway|mcp|agentic|attention kernel\w*|memory oversubscription)\b/gi;
const concrete=/\b(?:configur(?:e[sd]?|ing)|deploy(?:s|ed|ing)?|reus(?:e[sd]?|ing)|offload(?:s|ed|ing)?|allocat(?:e[sd]?|ing)|isolat(?:e[sd]?|ing)|schedul(?:e[sd]?|ing)|transfer(?:s|red)?|requires?|supports?|provides?|limits?|propos(?:e[sd]?|ing)|present(?:s|ed)?|introduc(?:e[sd]?|ing)|implement(?:s|ed|ing)?|fix(?:es|ed)?|updat(?:e[sd]?|ing)|measures?|reduces?|stores?|writes?|reads?|copies|combines?|separates?|add(?:s|ed)?|reset|kubectl|helm|apiVersion|--[a-z][a-z-]+)\b/i;
const artifact=/\b(?:kubectl|helm|apiVersion|spec:|crd|benchmark|latency|throughput|ttft|tpot|slo|p99|p95|gb\/s|cuda|nixl|ucx|dscp|nvconfig|memory bandwidth|token ids|parallelism|algorithm|implementation|prerequisites|configuration|security|ofed|doca|crd|dscp|mtu|daemonset|cve-\d)\b/i;
function meaningfulBody(text:string,title:string) {
 // Publisher-generated AI summaries are not authored mechanism evidence.
 const ai=text.indexOf("AI-Generated Summary");
 if(ai>=0){const end=text.indexOf("Learn more",ai);text=text.slice(0,ai)+(end>=0 ? text.slice(end+10) : "");}
 const marker=text.lastIndexOf("Scroll to top");if(marker>=0)return text.slice(marker+13);
 const base=title.split(" | ")[0].replace(/ - (?:vLLM|NVIDIA Docs)$/i,"");
 const heading=text.indexOf(base+" ¶");if(heading>=0)return text.slice(heading);
 // arXiv RSS descriptors and documentation navigation are not evidence of a method.
 return text.replace(/^arXiv:[^:]+Announce Type:[^:]+Abstract:\s*/i,"");
}
// PostgreSQL JSONB rejects unpaired UTF-16 surrogates. Keep quotes contiguous
// while moving either cut inward when it would split a non-BMP character.
export function publicFragment(text:string,start:number,end:number) {
 if(start>0 && /[\uDC00-\uDFFF]/.test(text[start]||"") && /[\uD800-\uDBFF]/.test(text[start-1]||""))start++;
 if(end>0 && /[\uD800-\uDBFF]/.test(text[end-1]||"") && /[\uDC00-\uDFFF]/.test(text[end]||""))end--;
 return text.slice(start,end);
}
function quote(text:string) {
 // A single contiguous public-source fragment; never combine different paragraphs as evidence.
 const units=text.match(/[^.!?\n]+[.!?]?/g)||[text];
 for(const unit of units){concepts.lastIndex=0;const matches=[...unit.matchAll(concepts)];if(!matches.length||!concrete.test(unit))continue;
  const anchor=matches[0].index||0;const start=Math.max(0,anchor-30);const q=publicFragment(unit,start,start+140).trim();if(q.length>=10)return q;
 }
 return "";
}
/** No model calls, tools or generated technical claims. Tests and database gates enforce provenance. */
export function internalReview(row:any,profile:any={},now=Date.now()) {
 const input=row.input||row.reference_meta?.public_evaluation_input;
 const text=typeof input?.text==="string" ? input.text : "";
 const title=String(input?.title||row.title||"");
 const meta=row.reference_meta||{repo_health:row.repo_health,origin:row.origin,source_id:row.source_id};
 const topic=Object.keys(TOPIC_TERMS).includes(row.topic) ? row.topic : basicRelevance(title+" "+text,profile.priorities||{}).topic;
 const decision=(decision:string,score:number,depth:string,reason:string,evidence="",facts:any={})=>({assessment:{topic,decision,score,depth,confidence:decision==="insufficient_evidence" ? "low" : "medium",summary:decision==="useful" ? ("Public-source fragment: "+evidence).slice(0,300) : decision==="tangential" ? "Not selected under the local evidence and relevance policy." : "Captured public material is insufficient for a supported relevance decision.",reason,action:decision==="useful" ? "Read the original source and validate its version, hardware and workload assumptions." : "Reconsider if better public evidence or repository metadata becomes available.",evidence},facts});
 if(!text||text.length<80)return decision("insufficient_evidence",0,"unknown","No sufficiently substantive public excerpt is available.");
 const body=meaningfulBody(text,title), evidence=quote(body)||publicFragment(text,0,140).trim();
 if(!articleRepositoryAdmitted(row.url,meta,profile,now))return decision("tangential",0,"unknown","Repository metadata does not pass the configured admission policy.",evidence,{repository_policy:"excluded"});
 if(excludedURL.test(row.url)||/\b(?:job advertisement|job description|we.re hiring|what you.ll need|required experience|principal solutions architect|network architect -)\b/i.test(title+" "+text))return decision("tangential",0,"unknown","Hiring, social collection or navigation content lacks an engineering knowledge result.",evidence);
 if(unrelated.test(title))return decision("tangential",15,"unknown","The source studies an application domain outside GPU infrastructure, serving and platform engineering.",evidence);
 const terms=[...new Set((body.match(concepts)||[]).map(x=>x.toLowerCase().replace(/^(gpus|llms)$/,v=>v.slice(0,-1))))];
 const grounded=quote(body), hasArtifact=artifact.test(body), hasAction=concrete.test(body);
 const depth=/\b(?:algorithm|protocol|architecture|kernel|parallelism|rank mapping|congestion|nvconfig|cache salt|reshard|cuda graph|memory hierarchy)\b/i.test(body) ? "advanced" : "practical";
 let host="";try{host=new URL(row.url).hostname;}catch{return decision("insufficient_evidence",0,"unknown","Invalid public-source URL.");}
 const firstParty=TRUSTED_HOSTS.includes(host)&&input.scope!=="search_snippet";
 const watched=meta.origin==="source_watch" && !!meta.source_id && (meta.alert_kind==="release" || row.alert_kind==="release");
 const facts={followed_release:watched,concepts:terms.slice(0,12),public_text_characters:text.length,scope:input.scope,first_party:firstParty,concrete_action:hasAction,implementation_or_measurement:hasArtifact};
 if(terms.length>=(watched ? 1 : 2)&&hasArtifact&&hasAction&&grounded&&body.length>=180){
  const score=Math.min(85,55+Math.min(18,terms.length*3)+(firstParty ? 5 : 0)+(depth==="advanced" ? 5 : 0));
  return decision("useful",score,depth,"A source-bound engineering fragment contains multiple relevant mechanisms and an implementation or measurement signal. Claims were not independently verified.",grounded,facts);
 }
 if(terms.length===0)return decision("tangential",20,"unknown","No concrete connection to the team's engineering scope is supported by the excerpt.",evidence,facts);
 return decision("insufficient_evidence",25,"unknown","Technical vocabulary alone does not establish a usable procedure, mechanism or measured result.","",facts);
}
export function immediateInternalReview(row:any,review:ReturnType<typeof internalReview>) {
 const input=row.input||row.reference_meta?.public_evaluation_input;
 return review.assessment.decision==="useful" && (row.reference_meta?.alert_kind==="release" || row.alert_kind==="release" ||
  input?.scope==="publisher_excerpt" && review.facts.first_party && review.facts.concepts?.length>=3 && review.facts.public_text_characters>=400);
}
