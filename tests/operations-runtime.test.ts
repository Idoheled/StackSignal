import test from 'node:test';import assert from 'node:assert/strict';
import {assessHealth,monitorOperations} from '../supabase/functions/_shared/operations.ts';
import {signedHeaders,verifySignature,validateOpsEvent} from '../supabase/functions/_shared/whatsapp-protocol.ts';
import {handleWebhook} from '../bot/webhook.mjs';import {DeliveryStore} from '../bot/store.mjs';
import {releaseRequest,formatReleases,platformContext,watchdog} from '../bot/operations.mjs';
const secret='ab'.repeat(32),origin='https://stacksignal.example',id='50000000-0000-4000-8000-000000000001';
test('expected quota waits stay distinct from stuck work and unreachable services',()=>{
 const now=Date.now(),at=new Date(now).toISOString();
 const s={sources:{active:88,overdue:0},jobs:{pending:2,failed:0,stuck:0},reviews:{pending:30,overdue:0},evaluation:{state:'budget_wait',coverage:{checked_at:at},internal_review:{last_run:at}},profile:{gemini_mode:'rerank',repo_discovery:true,trending_discovery:true},discovery:{repository_last_success:at,trending_daily_success:at},notifications:{enabled:true,sent:2,pending:0,uncertain:0,stuck:0,admission_gaps:0}};
 const stages=assessHealth(s,{connected:true,heartbeat_at:now,ollama_ok:true,questions:{}},true,now);assert(stages.every(x=>['healthy','waiting'].includes(x.status)));assert.equal(stages.find(x=>x.key==='evaluation')?.status,'waiting');
 const broken=assessHealth({...s,sources:{active:88,errors:1},jobs:{stuck:1},reviews:{overdue:1}},null,false,now);for(const key of['discovery','collection','evaluation','website','whatsapp','ollama'])assert(['down','degraded'].includes(broken.find(x=>x.key===key)!.status));
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

test('scheduler checks completed work, allowing only a bounded rollout warmup',()=>{
 const now=Date.now(),at=new Date(now).toISOString(),old=new Date(now-25*60000).toISOString();
 const snapshot={diagnostics_started_at:old,runs:[{stage:'collection',last_success:at},{stage:'evaluation',last_success:old},{stage:'internal_review',last_success:at}]};
 assert.equal(assessHealth(snapshot,null,true,now).find(s=>s.key==='scheduler')?.status,'degraded');
 assert.equal(assessHealth({...snapshot,diagnostics_started_at:at},null,true,now).find(s=>s.key==='scheduler')?.status,'waiting');
 assert.equal(assessHealth({...snapshot,runs:['collection','evaluation','internal_review'].map(stage=>({stage,last_success:at}))},null,true,now).find(s=>s.key==='scheduler')?.status,'healthy');
});

test('batched monitoring keeps both probes, signed delivery and lease-checked completion',async()=>{
 const at=new Date().toISOString(),lease='50000000-0000-4000-8000-000000000002';
 const snapshot={checked_at:at,jobs:{pending:2,stuck:1}},bot={connected:true,heartbeat_at:Date.now(),ollama_ok:true,questions:{}};
 const event={id,lease_id:lease,payload:{version:1,kind:'platform_incident',code:'collection_degraded',phase:'open',summary:'One overdue job.',observed_at:at,ui_url:origin+'/?view=admin'}};
 const rpcCalls:{name:string;args:any}[]=[],urls:string[]=[];
 const rpc=async(name:string,args:any)=>{
  rpcCalls.push({name,args});
  if(name==='ss_ops_reconcile_snapshot')return {ok:true,snapshot};
  if(name==='ss_ops_observe_claim')return {ok:true,events:[event]};
  if(name==='ss_ops_finish_event')return true;
  throw Error('Unexpected RPC '+name);
 };
 const send:typeof fetch=async(input,init)=>{
  const url=String(input);urls.push(url);
  if(url===origin+'/api/status')return Response.json({configured:true});
  const body=String(init?.body),requestHeaders=new Headers(init?.headers);
  assert.equal(init?.redirect,'error');assert(init?.signal);
  if(url==='https://bot.example/v1/status'){
   assert(await verifySignature(secret,'ops-status',body,requestHeaders));assert.deepEqual(JSON.parse(body),{operation:'status'});
   const response=JSON.stringify(bot);return new Response(response,{headers:await signedHeaders(secret,'ops-receipt',response)});
  }
  assert.equal(url,'https://bot.example/v1/ops');assert(await verifySignature(secret,'ops-event',body,requestHeaders));
  assert.deepEqual(JSON.parse(body),{id,payload:event.payload});
  const receipt=JSON.stringify({id,status:'sent',message_id:'provider-receipt'});
  return new Response(receipt,{headers:await signedHeaders(secret,'receipt',receipt)});
 };
 const result=await monitorOperations({webhookURL:'https://bot.example/v1/events',secret,appOrigin:origin},rpc,send);
 assert.deepEqual(result,{ok:true,queued:0,sent:1,uncertain:0,retry:0,checked_at:at});
 assert.deepEqual(urls.sort(),[origin+'/api/status','https://bot.example/v1/ops','https://bot.example/v1/status'].sort());
 assert.deepEqual(rpcCalls.map(x=>x.name),['ss_ops_reconcile_snapshot','ss_ops_observe_claim','ss_ops_finish_event']);
 assert.equal(rpcCalls[1].args.batch_size,3);assert.deepEqual(rpcCalls[1].args.observation.bot,bot);assert.deepEqual(rpcCalls[1].args.observation.jobs,snapshot.jobs);
 assert(rpcCalls[1].args.conditions.some((c:any)=>c.code==='collection_degraded'&&c.severity==='warning'));
 assert.deepEqual(rpcCalls[2].args,{event_id:id,expected_lease:lease,outcome:'sent',message_id:'provider-receipt'});
});

test('monitoring stops after a failed batch and never finishes an unclaimed event',async t=>{
 for(const [failed,transport] of [['ss_ops_reconcile_snapshot',false],['ss_ops_reconcile_snapshot',true],['ss_ops_observe_claim',false],['ss_ops_observe_claim',true]] as const){
  await t.test(failed+(transport?' RPC failure':' stage failure'),async()=>{
   const calls:string[]=[],probes:string[]=[];
   const rpc=async(name:string)=>{calls.push(name);if(name===failed){if(transport)throw Error('RPC unavailable');return {ok:false,error:'sanitized_stage_failure'};}return {ok:true,snapshot:{checked_at:new Date().toISOString()}};};
   const send:typeof fetch=async input=>{probes.push(String(input));throw Error('Probe unavailable');};
   await assert.rejects(monitorOperations({webhookURL:'https://bot.example/v1/events',secret,appOrigin:origin},rpc,send));
   assert.equal(probes.length,2);assert.deepEqual(calls,failed==='ss_ops_reconcile_snapshot'?[failed]:['ss_ops_reconcile_snapshot',failed]);
  });
 }
});

test('platform context preserves authentication, limits, signed replies and failure statuses',async t=>{
 const previousFetch=globalThis.fetch,previousDeno=(globalThis as any).Deno;
 const environment:Record<string,string>={SUPABASE_URL:'https://database.example',SUPABASE_SERVICE_ROLE_KEY:'test-service-key',WHATSAPP_WEBHOOK_SECRET:secret};
 let handler!:(request:Request)=>Promise<Response>,result:any={ok:true,permitted:true,context:{releases:[{id}],checked_at:'2026-11-22T00:00:00Z'}},rpcStatus=200;
 const calls:{name:string;args:any}[]=[];
 (globalThis as any).Deno={env:{get:(key:string)=>environment[key]},serve:(fn:typeof handler)=>{handler=fn;}};
 try{
  await import('../supabase/functions/platform-context/index.ts');
  globalThis.fetch=async(input,init)=>{
   const url=new URL(String(input)),headers=new Headers(init?.headers);assert.equal(url.origin,'https://database.example');assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error');assert(init?.signal);
   assert.equal(headers.get('apikey'),'test-service-key');assert.equal(headers.get('authorization'),'Bearer test-service-key');
   const name=url.pathname.split('/').pop()!;calls.push({name,args:JSON.parse(String(init?.body))});
   if(name==='ss_whatsapp_dispatch_configuration')return Response.json({whatsapp_webhook_secret:'cd'.repeat(32)});
   assert.equal(name,'ss_platform_context_limited');return Response.json(result,{status:rpcStatus});
  };
  const request=async(payload:unknown,purpose:'ops-context'|'event'='ops-context')=>{
   const body=JSON.stringify(payload);return new Request('https://context.example',{method:'POST',headers:{'content-type':'application/json',...await signedHeaders(secret,purpose,body)},body});
  };
  await t.test('unauthorized and invalid input never spend a rate token',async()=>{
   calls.length=0;assert.equal((await handler(new Request('https://context.example'))).status,401);assert.equal(calls.length,0);
   assert.equal((await handler(await request({operation:'health'},'event'))).status,401);
   for(const payload of [{operation:'write'},{operation:'health',limit:0},{operation:'health',limit:11},{operation:'health',limit:1.5}])assert.equal((await handler(await request(payload))).status,400);
   assert(calls.every(c=>c.name==='ss_whatsapp_dispatch_configuration'));
  });
  await t.test('the same denied rate limit returns 429',async()=>{
   calls.length=0;result={ok:true,permitted:false};
   const response=await handler(await request({operation:'latest_releases',limit:7}));
   assert.equal(response.status,429);assert.deepEqual(await response.json(),{error:'Please retry shortly'});
   assert.deepEqual(calls,[{name:'ss_whatsapp_dispatch_configuration',args:{}},{name:'ss_platform_context_limited',args:{item_limit:7}}]);
  });
  await t.test('context-stage and RPC failures remain sanitized 503 responses',async()=>{
   for(const [value,status] of [[{ok:false,permitted:true,error:'context_unavailable'},200],[{error:'Sensitive database diagnostic'},500],[{ok:true,permitted:true},200]] as const){
    result=value;rpcStatus=status;
    const response=await handler(await request({operation:'health'}));
    assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Platform context unavailable'});
   }
   rpcStatus=200;
  });
  await t.test('health keeps its one-item read and signed response without release rows',async()=>{
   calls.length=0;result={ok:true,permitted:true,context:{releases:[{id}],checked_at:'2026-11-22T00:00:00Z',monitor_checked_at:'2026-11-22T00:00:00Z'}};
   const response=await handler(await request({operation:'health',limit:10})),body=await response.text();
   assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert(await verifySignature(secret,'ops-receipt',body,response.headers));
   assert.deepEqual(JSON.parse(body),{checked_at:'2026-11-22T00:00:00Z',monitor_checked_at:'2026-11-22T00:00:00Z'});
   assert.deepEqual(calls[1].args,{item_limit:1});
  });
  await t.test('release requests keep their requested count and signed response',async()=>{
   calls.length=0;result={ok:true,permitted:true,context:{releases:[{id}],checked_at:'2026-11-22T00:00:00Z'}};
   const response=await handler(await request({operation:'latest_releases',limit:9})),body=await response.text();
   assert.equal(response.status,200);assert.deepEqual(JSON.parse(body),result.context);assert(await verifySignature(secret,'ops-receipt',body,response.headers));assert.deepEqual(calls[1].args,{item_limit:9});
  });
 }finally{globalThis.fetch=previousFetch;(globalThis as any).Deno=previousDeno;}
});

test('dispatcher preserves successful deliveries when a health batch fails',async()=>{
 const previousFetch=globalThis.fetch,previousDeno=(globalThis as any).Deno,cronSecret='test-only-dispatch-secret-1234567890';
 const environment:Record<string,string>={SUPABASE_URL:'https://database.example',SUPABASE_SERVICE_ROLE_KEY:'test-service-key'};
 let handler!:(request:Request)=>Promise<Response>;const calls:string[]=[];
 (globalThis as any).Deno={env:{get:(key:string)=>environment[key]},serve:(fn:typeof handler)=>{handler=fn;}};
 try{
  await import('../supabase/functions/whatsapp-dispatcher/index.ts');
  globalThis.fetch=async input=>{
   const url=new URL(String(input));if(url.origin!=='https://database.example')throw Error('Probe unavailable');
   const name=url.pathname.split('/').pop()!;calls.push(name);
   if(name==='ss_whatsapp_dispatch_configuration')return Response.json({whatsapp_dispatch_secret:cronSecret,whatsapp_webhook_url:'https://bot.example/v1/events',whatsapp_webhook_secret:secret,whatsapp_app_origin:origin});
   if(name==='ss_whatsapp_claim_events')return Response.json([]);
   if(name==='ss_ops_reconcile_snapshot')return Response.json({ok:false,error:'snapshot_unavailable'});
   throw Error('Unexpected RPC '+name);
  };
  const response=await handler(new Request('https://dispatcher.example',{method:'POST',headers:{'x-whatsapp-dispatch-secret':cronSecret}})),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.ok,true);assert.deepEqual(body.operations,{ok:false,error:'Health observation failed; durable state retained'});
  assert.deepEqual(calls,['ss_whatsapp_dispatch_configuration','ss_whatsapp_claim_events','ss_ops_reconcile_snapshot']);
 }finally{globalThis.fetch=previousFetch;(globalThis as any).Deno=previousDeno;}
});
