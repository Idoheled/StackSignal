// Semantic checks against the installed local model; no group messages.
import {platformContext,releaseRequest,formatReleases} from '/opt/stacksignal/bot/operations.mjs';
import {answerQuestion,responseForQuestion,languageGuidance,englishFirst} from '/opt/stacksignal/bot/columbus-runtime.mjs';

const languages=['en','he'],samples=[];
for(const [name,question,required] of [
 ['scheduler','What does a Kubernetes scheduler do? Distinguish scheduling decisions from runtime resource enforcement.',[/pod/i,/node/i]],
 ['networking','Explain RDMA versus TCP, including CPU use during setup and steady-state data transfer. Give two practical considerations.',[/RDMA/,/TCP/,/memory/i,/setup|registration|initiali[sz]/i]],
]){
 const answer=await answerQuestion(question,null,{model:process.env.OLLAMA_MODEL||'qwen3:4b',language:'en'});
 if(!answer.startsWith('🤖 *Columbus · קולומבוס*\n\n*Answer*\n')||!required.every(pattern=>pattern.test(answer))||/KAI|v0\.16\.12|<think|<analysis/i.test(answer))throw Error('Semantic model check failed: '+name);
 if(name==='scheduler'&&/(?:ensures|guarantees)[^.!?]*isolation|avoids overcommitment/i.test(answer))throw Error('Scheduler enforcement overclaim');
 if(name==='networking'&&/RDMA operates at the network layer/i.test(answer))throw Error('Unqualified networking claim');
 samples.push({name,answer});
}
{
 const item={question:'מה אתה?',prefixLanguage:'he',quotedID:null};
 const answer=languageGuidance(await responseForQuestion(item),item);
 if(!answer.includes(englishFirst?'I’m Columbus':'אני קולומבוס')||answer.includes('KAI')||(englishFirst&&!answer.includes('לתשובות טובות יותר')))throw Error('Hebrew identity policy failed');
}
const question='קולומבוס מה כל שבעת הreleaseים האחרונים שנכנסו לפלטפורמה?';
if(releaseRequest(question)!==7)throw Error('Release request parsing failed');
const catalog=await platformContext('latest_releases',7);
if(!catalog.releases.length||!formatReleases(catalog,question).includes(catalog.releases[0].title.replace(/[*_~`@]/g,'')))throw Error('Live catalog verification failed');
// Synthetic samples remain inside the encrypted maintenance report for human review.
console.log(JSON.stringify({status:'ready',languages,language_policy:englishFirst?'english_first':'bilingual',semantic_verified:true,synthetic_samples:samples,final_answer_only:true,catalog_verified:true,catalog_rows:catalog.releases.length,group_messages_sent:0}));
