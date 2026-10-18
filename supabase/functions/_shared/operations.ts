import { readBoundedBody, signedHeaders, verifySignature, validateReceipt, validateOpsEvent } from './whatsapp-protocol.ts';
import type { DispatchConfig, RPC } from './whatsapp-dispatch.ts';
export type Stage = { key: string; label: string; status: 'healthy'|'waiting'|'degraded'|'down'|'unknown'; detail: string; last_success?: string|null };
export function assessHealth(s:any, bot:any, website:boolean, now=Date.now()): Stage[] {
 const stale=(x:unknown,ms:number)=>typeof x!=='string'||!Number.isFinite(Date.parse(x))||now-Date.parse(x)>ms;
 const stages:Stage[]=[{key:'database',label:'Database',status:'healthy',detail:'Authenticated database query completed.'}];
 const add=(key:string,label:string,bad:boolean,detail:string,last_success?:string|null,wait=false)=>stages.push({key,label,status:bad?'degraded':wait?'waiting':'healthy',detail,last_success});
 add('discovery','Discovery',Number(s.sources?.overdue)>0||Number(s.sources?.errors)>0,`${Number(s.sources?.active)||0} active watches; ${Number(s.sources?.overdue)||0} overdue checks; ${Number(s.sources?.errors)||0} source errors.`,s.sources?.last_success);
 add('collection','Collection',Number(s.jobs?.stuck)>0||Number(s.jobs?.failed)>0,`${Number(s.jobs?.pending)||0} pending; ${Number(s.jobs?.stuck)||0} overdue; ${Number(s.jobs?.failed)||0} unresolved failed jobs.`);
 const e=s.evaluation||{},expected=['budget_wait','pacing_wait','cooldown','batching_wait','reservation_wait'].includes(e.state);
 const evalBad=Number(s.reviews?.overdue)>0||(['configuration_error','missing_key'].includes(e.state)&&s.profile?.gemini_mode!=='off')||(s.profile?.gemini_mode!=='off'&&stale(e.coverage?.checked_at,20*60000));
 add('evaluation','Evaluation',evalBad,`${Number(s.reviews?.pending)||0} pending reviews; ${Number(s.reviews?.overdue)||0} older than the 25-hour review threshold. ${expected?'Quota, batching or retry wait is expected.':''}`,e.last_success,expected||s.profile?.gemini_mode==='off');
 add('internal_review','Local review fallback',stale(e.internal_review?.last_run,20*60000),'Evidence-based fallback should run every five minutes.',e.internal_review?.last_run);
 const d=s.discovery||{};const dailyBad=(s.profile?.repo_discovery!==false&&stale(d.repository_last_success,30*3600000))||(s.profile?.trending_discovery!==false&&stale(d.trending_daily_success,30*3600000))||(Number(s.profile?.search_monthly_limit)>0&&s.web_discovery?.configured===true&&stale(s.web_discovery?.last_success,30*3600000));
 add('daily_discovery','Daily discovery',dailyBad,'Daily GitHub, Trending and configured web discovery windows.',d.repository_last_success);
 const n=s.notifications||{};
 add('dispatch','New-link delivery',Boolean(n.enabled)&&(Number(n.stuck)>0||Number(n.uncertain)>0||Number(n.admission_gaps)>0||Number(bot?.deliveries?.uncertain)>0||Number(bot?.deliveries?.stuck)>0),`${Number(n.sent)||0} confirmed; ${Number(n.pending)||0} pending; ${Math.max(Number(n.uncertain)||0,Number(bot?.deliveries?.uncertain)||0)} uncertain; ${Number(n.admission_gaps)||0} missing eligible events.`,null,!n.enabled);
 stages.push({key:'website',label:'Platform website',status:website?'healthy':'down',detail:website?'Configured public application responded.':'Platform status endpoint did not pass its check.'});
 const connected=bot?.connected===true&&Number.isFinite(bot?.heartbeat_at)&&now-Number(bot.heartbeat_at)<120000;
 stages.push({key:'whatsapp',label:'WhatsApp connection',status:connected?'healthy':'down',detail:connected?'Paired group listener has a fresh connected heartbeat.':'Receiver or paired group listener is unavailable/stale.'});
 stages.push({key:'ollama',label:'Local LLM',status:bot?.ollama_ok===true?'healthy':'down',detail:bot?.ollama_ok===true?'Local Ollama HTTP service responded.':'Local Ollama service did not respond.'});
 add('questions','Columbus questions',Number(bot?.questions?.failed_1h)>=3||Number(bot?.questions?.uncertain)>0||Number(bot?.questions?.stuck)>0,`${Number(bot?.questions?.answered_24h)||0} answered in 24h; ${Number(bot?.questions?.failed_1h)||0} recent generation failures; ${Number(bot?.questions?.stuck)||0} stuck questions.`);
 return stages;
}
export async function monitorOperations(config:DispatchConfig,rpc:RPC,send:typeof fetch=fetch) {
 const base=new URL(config.webhookURL).origin;
 const probes=await Promise.allSettled([
  (async()=>{const body='{"operation":"status"}';const r=await send(base+'/v1/status',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'content-type':'application/json',...await signedHeaders(config.secret,'ops-status',body)},body});const text=await readBoundedBody(r,12000);if(!r.ok||!await verifySignature(config.secret,'ops-receipt',text,r.headers))throw Error('Unverified bot status');return JSON.parse(text);})(),
  (async()=>{const r=await send(config.appOrigin+'/api/status',{redirect:'error',signal:AbortSignal.timeout(8000),headers:{'User-Agent':'Mozilla/5.0 StackSignal-CI'}});const s=JSON.parse(await readBoundedBody(r,4096));return r.ok&&s.configured===true;})(),
 ]);
 const bot=probes[0].status==='fulfilled'?probes[0].value:null, website=probes[1].status==='fulfilled'&&probes[1].value===true;
 await rpc('ss_ops_reconcile',{});
 const snapshot=await rpc('ss_ops_snapshot',{}) as any;
 const stages=assessHealth(snapshot,bot,website);
 await rpc('ss_ops_observe',{observation:{...snapshot,bot,stages},conditions:stages.filter(x=>['degraded','down'].includes(x.status)).map(x=>({code:x.key+'_degraded',severity:x.status==='down'?'critical':'warning',summary:x.label+': '+x.detail}))});
 const events=await rpc('ss_ops_claim_events',{batch_size:3}) as any[];
 const counts={queued:0,sent:0,uncertain:0,retry:0};
 for(const e of events){let outcome:keyof typeof counts='retry',message_id:string|null=null;
  try {const event=validateOpsEvent({id:e.id,payload:e.payload},config.appOrigin),body=JSON.stringify(event);const r=await send(base+'/v1/ops',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'content-type':'application/json',...await signedHeaders(config.secret,'ops-event',body)},body});const text=await readBoundedBody(r,2048);if(![200,202,409].includes(r.status)||!await verifySignature(config.secret,'receipt',text,r.headers))throw Error('No signed health receipt');const receipt=validateReceipt(JSON.parse(text),e.id);if(r.status===409&&receipt.status!=='uncertain')throw Error('Invalid health receipt');outcome=receipt.status;message_id=receipt.message_id||null;}catch{/* Retry the same durable event ID only. */}
  if(await rpc('ss_ops_finish_event',{event_id:e.id,expected_lease:e.lease_id,outcome,message_id})===true)counts[outcome]++;
 }
 return {ok:true,...counts,checked_at:snapshot.checked_at};
}
