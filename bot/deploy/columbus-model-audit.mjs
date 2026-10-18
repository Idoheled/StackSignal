// Read-only, synthetic quality audit of the currently installed model/prompt.
// The caller encrypts this output; it never contains real group conversations.
import {answerQuestion} from '/opt/stacksignal/bot/columbus-runtime.mjs';
const results=[];
for(const [language,question] of [
 ['he','מה אתה?'],
 ['he','הסבר בעברית תקינה מה ההבדל בין RDMA לבין TCP. כתוב פסקה קצרה ושתי נקודות מעשיות.'],
 ['en','Who are you?'],
 ['en','Explain the difference between RDMA and TCP in a short paragraph and two practical bullet points.'],
]){
 const started=Date.now();
 try{results.push({language,question,answer:await answerQuestion(question,null,{model:process.env.OLLAMA_MODEL||'qwen3:4b'}),duration_ms:Date.now()-started});}
 catch{results.push({language,question,error:'No valid final answer',duration_ms:Date.now()-started});}
}
console.log(JSON.stringify({model:process.env.OLLAMA_MODEL||'qwen3:4b',group_messages_sent:0,results}));
