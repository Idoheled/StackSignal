import test from 'node:test';import assert from 'node:assert/strict';
import {assessHealth} from '../supabase/functions/_shared/operations.ts';
import {signedHeaders,validateOpsEvent} from '../supabase/functions/_shared/whatsapp-protocol.ts';
import {handleWebhook} from '../bot/webhook.mjs';import {DeliveryStore} from '../bot/store.mjs';
import {releaseRequest,formatReleases,platformContext,watchdog} from '../bot/operations.mjs';
const secret='ab'.repeat(32),origin='https://stacksignal.example',id='50000000-0000-4000-8000-000000000001';
test('expected quota waits stay distinct from stuck work and unreachable services',()=>{
 const now=Date.now(),at=new Date(now).toISOString();
 const s={sources:{active:88,overdue:0},jobs:{pending:2,failed:0,stuck:0},reviews:{pending:30,overdue:0},evaluation:{state:'budget_wait',coverage:{checked_at:at},internal_review:{last_run:at}},profile:{gemini_mode:'rerank',repo_discovery:true,trending_discovery:true},discovery:{repository_last_success:at,trending_daily_success:at},notifications:{enabled:true,sent:2,pending:0,uncertain:0,stuck:0,admission_gaps:0}};
 const stages=assessHealth(s,{connected:true,heartbeat_at:now,ollama_ok:true,questions:{}},true,now);assert(stages.every(x=>['healthy','waiting'].includes(x.status)));assert.equal(stages.find(x=>x.key==='evaluation')?.status,'waiting');
 const broken=assessHealth({...s,jobs:{stuck:1},reviews:{overdue:1}},null,false,now);for(const key of['collection','evaluation','website','whatsapp','ollama'])assert(['down','degraded'].includes(broken.find(x=>x.key===key)!.status));
});
test('signed health and incident paths reject cross-purpose requests and never enter article context',async()=>{
 const store=new DeliveryStore(':memory:');try{
  const body='{"operation":"status"}',statusProvider=async()=>({connected:true,heartbeat_at:Date.now(),questions:{failed_1h:1}});
  let r=await handleWebhook(new Request(origin+'/v1/status',{method:'POST',headers:{'content-type':'application/json',...await signedHeaders(secret,'event',body)},body}),{secret,store,appOrigin:origin,statusProvider});assert.equal(r.status,401);
  r=await handleWebhook(new Request(origin+'/v1/status',{method:'POST',headers:{'content-type':'application/json',...await signedHeaders(secret,'ops-status',body)},body}),{secret,store,appOrigin:origin,statusProvider});assert.equal(r.status,200);assert.equal((await r.json()).connected,true);
  const event={id,payload:{version:1,kind:'platform_incident',code:'evaluation_degraded',phase:'open',summary:'One overdue review.',observed_at:new Date().toISOString(),ui_url:origin+'/?view=admin'}};
  validateOpsEvent(event,origin);assert.throws(()=>validateOpsEvent({...event,payload:{...event.payload,ui_url:'https://evil.example'}},origin));
  const data=JSON.stringify(event);r=await handleWebhook(new Request(origin+'/v1/ops',{method:'POST',headers:{'content-type':'application/json',...await signedHeaders(secret,'ops-event',data)},body:data}),{secret,store,appOrigin:origin});assert.equal(r.status,202);
  store.claim();store.prepareSend(id,'Safe deterministic health message');store.confirm(id,'receipt');assert.equal(store.db.prepare('select count(*) n from article_context').get().n,0);
 }finally{store.close();}
});
test('the exact Hebrew release request uses seven signed real platform rows',async()=>{
 const question='קולומבוס מה כל שבעת הreleaseים האחרונים שנכנסו לפלטפורמה?';assert.equal(releaseRequest(question),7);assert.equal(releaseRequest('Columbus latest 9 releases'),9);assert.equal(releaseRequest('explain KAI'),null);
 const context={checked_at:new Date().toISOString(),releases:Array.from({length:7},(_,i)=>({id:id.slice(0,-1)+i,title:'Project '+i,discovered_at:new Date().toISOString(),ui_url:origin+'/?article='+id.slice(0,-1)+i}))};
 const got=await platformContext('latest_releases',7,{secret,origin,send:async(url,init)=>{assert.equal(url,'https://plbjscbpvfozqvexmqhk.supabase.co/functions/v1/platform-context');assert.equal(JSON.parse(String(init!.body)).limit,7);const body=JSON.stringify(context);return new Response(body,{headers:await signedHeaders(secret,'ops-receipt',body)});}});
 const answer=formatReleases(got,question);for(let i=0;i<7;i++)assert(answer.includes('Project '+i));assert(answer.includes('נכנס'));
 await assert.rejects(platformContext('latest_releases',7,{secret,origin,send:async()=>Response.json(context)}));
});
test('the independent watchdog persists one incident and a recovery, without calling the LLM',async()=>{
 const store=new DeliveryStore(':memory:');let now=Date.now();try{
  const failing=async()=>{throw Error('DB down');};
  await watchdog(store,{secret,origin,now,getContext:failing});await watchdog(store,{secret,origin,now:now+300001,getContext:failing});await watchdog(store,{secret,origin,now:now+400001,getContext:failing});assert.equal(store.db.prepare('select count(*) n from deliveries').get().n,1);
  const pending=store.claim(now+400001);assert(pending);store.prepareSend(pending.id,'Incident',now+400001);store.confirm(pending.id,'PROVIDER',now+400001);
  await watchdog(store,{secret,origin,now:now+400002,getContext:async()=>({monitor_checked_at:new Date(now+400002).toISOString()})});assert.equal(store.db.prepare('select count(*) n from deliveries').get().n,2);
 }finally{store.close();}
});
