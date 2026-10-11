// Sanitized public references from the second team reading batch. No transcripts or people.
import { canonicalLink } from './links.ts';
import { safeURL } from '../supabase/functions/_shared/content.ts';
import { TEAM_FOLDERS } from './coverage.ts';
const references = [
 ['https://techdocs.broadcom.com/content/dam/broadcom/techdocs/us/en/pdf/security-and-load-balancing/avi-load-balancer/avi-kubernetes/kubernetes-operating-guide/avi-kubernetes-operator-2-1.pdf','Avi Kubernetes Operator 2.1 operating guide','Networking','routing','PDF'],
 ['https://www.vastdata.com/blog/nvidia-dynamo-vast-scalable-optimized-inference','VAST and NVIDIA Dynamo inference architecture','Inference','cache','Article'],
 ['https://github.com/JustVugg/colibri','JustVugg/colibri','Inference','optimization','Repository'],
 ['https://github.com/kserve/kserve/pull/5603','KServe pull request #5603','Inference','serving','Pull request'],
 ['https://github.com/kserve/kserve/pull/5352','KServe pull request #5352','Inference','serving','Pull request'],
 ['https://github.com/kserve/kserve/pull/5485','KServe pull request #5485','Inference','serving','Pull request'],
 ['https://kserve.github.io/website/blog/kserve-0.20-release','KServe 0.20 release article','Inference','serving','Article'],
 ['https://theagentrouter.ai/blog/envoy-ai-gateway-is-now-agent-router','Envoy AI Gateway becomes Agent Router','Networking','routing','Article'],
 ['https://github.com/theagentrouter/agent-router/releases/tag/v1.1.0','Agent Router v1.1.0','Networking','routing','Release'],
 ['https://kserve.github.io/website/docs/model-serving/generative-inference/ai-gateway/envoy-ai-gateway','KServe AI gateway integration','Inference','routing','Documentation'],
 ['https://github.com/ai-dynamo/dynamo/tree/main/recipes','NVIDIA Dynamo deployment recipes','Inference','serving','Repository'],
 ['https://github.com/MasuRii/pi-agent-router','MasuRii/pi-agent-router','Networking','routing','Repository'],
 ['https://builtonenvoy.io/extensions/openfga/','Envoy OpenFGA extension','Networking','routing','Documentation'],
 ['https://builtonenvoy.io/extensions/anthropic-messages-decoder/','Envoy Anthropic messages decoder','Networking','routing','Documentation'],
 ['https://github.com/kagent-dev/kagent/pull/2959','kagent pull request #2959','Platforms','agents','Pull request'],
 ['https://github.com/mvschwarz/openrig','mvschwarz/openrig','Platforms','agents','Repository'],
 ['https://developer.nvidia.com/blog/how-nvidia-dsx-maxlps-maximizes-ai-factory-throughput-and-efficiency/','NVIDIA DSX MaxLPS throughput and efficiency','Inference','benchmarks','Article'],
 ['https://runinfra.ai/news/b200-beats-the-lpu','Runinfra: B200 and LPU performance comparison','Inference','benchmarks','Article'],
 ['https://share.google/y9i5wjv0Ee0PqCAxR','ConnectX-8 SuperNIC firmware — resolve shared URL','Networking','nic','Documentation'],
 ['https://github.com/vllm-project/vllm/pull/49796','vLLM pull request #49796','Inference','optimization','Pull request'],
 ['https://vllm.ai/blog/2026-09-08-glm53-part1-hybrid-sparse-offloading','vLLM GLM-5.3 hybrid sparse offloading','Inference','cache','Article'],
 ['https://arxiv.org/pdf/2405.16444','CacheBlend paper 2405.16444','Models & research','papers','PDF'],
 ['https://neurips.cc/virtual/2025/loc/san-diego/poster/120181','NeurIPS poster: ChunkKV','Models & research','papers','Paper'],
 ['https://github.com/microsoft/mscclpp','microsoft/mscclpp','Networking','rdma','Repository'],
 ['https://www.deepep.org/en/deepgemm','DeepGEMM overview — community reference','Inference','optimization','Documentation'],
 ['https://github.com/moonshotAI/moonep','moonshotAI/moonep','Networking','rdma','Repository'],
 ['https://github.com/deepseek-ai/DeepGEMM','deepseek-ai/DeepGEMM','Inference','optimization','Repository'],
 ['https://huggingface.co/papers/2405.16444','CacheBlend paper discussion','Models & research','papers','Paper'],
 ['https://llm-d.ai/docs/dev/resources/gateway/agentgateway','llm-d Agentgateway integration','Networking','routing','Documentation'],
 ['https://kagent.dev/blog/kagent-agent-substrate-sandboxes','kagent and Agent Substrate sandboxes','Platforms','agents','Article'],
 ['https://github.com/Tensward/tensward','Tensward/tensward','Platforms','agents','Repository'],
 ['https://docs.lmcache.ai/kv_cache/storage_backends/s3.html','LMCache S3 storage backend','Inference','cache','Documentation'],
 ['https://github.com/theagentrouter/agent-router/commit/ffdb12eade70a84d5839b5b2e13ff76c8782140c','Agent Router shared commit ffdb12e','Networking','routing','Commit'],
 ['https://github.com/theagentrouter/agent-router/pull/2833','Agent Router pull request #2833','Networking','routing','Pull request'],
 ['https://github.com/llm-d/llm-d-router/issues/2881','llm-d router issue #2881','Networking','routing','Issue'],
 ['https://github.com/theagentrouter/agent-router/pull/2595','Agent Router pull request #2595','Networking','routing','Pull request'],
 ['https://github.com/theagentrouter/agent-router/pull/2837','Agent Router pull request #2837','Networking','routing','Pull request'],
 ['https://github.com/kagent-dev/kagent','kagent-dev/kagent','Platforms','agents','Repository'],
] as const;
const projects=[['kagent-dev/kagent','Platforms'],['kagent-dev/kmcp','Platforms'],['JustVugg/colibri','Inference'],['MasuRii/pi-agent-router','Networking'],['mvschwarz/openrig','Platforms'],['microsoft/mscclpp','Networking'],['moonshotAI/moonep','Networking'],['deepseek-ai/DeepGEMM','Inference'],['Tensward/tensward','Platforms'],['llm-d/llm-d-router','Networking']] as const;
export const KNOWLEDGE_SOURCES = [
 ...projects.map(([repo,topic])=>({name:repo+' releases',url:'https://api.github.com/repos/'+repo+'/releases',type:'github',topic,interval_minutes:240})),
 ...references.filter(([url])=>/^https:\/\/github.com\/[^/]+\/[^/]+\/(pull|issues)\/\d+$/.test(url)).map(([url,title,topic])=>({name:title,url:url.replace('github.com/','api.github.com/repos/').replace('/pull/','/pulls/'),type:'github',topic,interval_minutes:240})),
 ...(['4-stable','5-stable','4-dev-preview','5-dev-preview'] as const).map(stream=>({name:'OpenShift '+stream+' release stream',url:'https://amd64.ocp.releases.ci.openshift.org/api/v1/releasestream/'+stream+'/tags',type:'openshift',topic:'Platforms',interval_minutes:240,include_prereleases:true,priority:'core'})),
 ...[
  ['https://kagent.dev/blog/','kagent engineering blog','Platforms'],
  ['https://kagent.dev/docs/kagent/1.x/reference/release-notes/','kagent release notes','Platforms'],
  ['https://llm-d.ai/docs/dev/resources/gateway/agentgateway','llm-d Agentgateway integration','Networking'],
  ['https://builtonenvoy.io/extensions/openfga/','Envoy OpenFGA extension','Networking'],
  ['https://builtonenvoy.io/extensions/anthropic-messages-decoder/','Envoy Anthropic messages decoder','Networking'],
  ['https://docs.lmcache.ai/kv_cache/storage_backends/s3.html','LMCache S3 storage backend','Inference'],
  ['https://kserve.github.io/website/docs/model-serving/generative-inference/ai-gateway/envoy-ai-gateway','KServe AI gateway integration','Inference'],
 ].map(([url,name,topic])=>({url,name,topic,type:'page',interval_minutes:720})),
];
export function knowledgeExpansionPayload() {
 return {key:'team-knowledge-expansion-2026-10-11-v1',profile:{},folders:TEAM_FOLDERS.map(([key,name,parent_key])=>({key,name,parent_key})),sources:KNOWLEDGE_SOURCES,
 articles:references.map(([input,title,topic,folder_key,kind])=>{
  const url=canonicalLink(input);let queue_metadata=false;try {safeURL(url);queue_metadata=kind!=='PDF';}catch {}
  return {url,title,source:new URL(url).hostname,topic,folder_key,kind,tags:[],score:0,summary:'',reason:'Team reading reference; public metadata and review pending.',reference_meta:{origin:'team_import',link_status:new URL(url).hostname==='share.google' ? 'unresolved' : 'submitted',note:'Shared public reference. Publication date and technical claims are not inferred from the chat.'},queue_metadata};
 })};
}
