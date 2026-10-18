import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {questionFrom,restrictSocket} from '../bot/columbus-policy.mjs';
import {answerQuestion,ColumbusLedger,installColumbusBoundary,articleContext} from '../bot/columbus-runtime.mjs';
import {DeliveryStore} from '../bot/store.mjs';
const target='123456789012345678@g.us',now=Date.now(),activatedAt=now-60000;
const message=(text,change={})=>({key:{remoteJid:target,id:'SYNTHETIC12345',participant:'55555@s.whatsapp.net'},messageTimestamp:Math.floor(now/1000),message:{conversation:text},...change});
function socket(){const calls=[];const ws=new EventEmitter(),ev=new EventEmitter();ws.on('CB:message',node=>calls.push(node));return{ws,ev,calls,sendMessage:async(jid,body)=>{calls.push({jid,body});return{key:{id:'PROVIDER12345'}};},relayMessage:async jid=>calls.push(jid),groupMetadata:async jid=>({id:jid}),groupFetchAllParticipating:async()=>{throw Error('cross-group fetch');},fetchMessageHistory:async()=>{throw Error('history fetch');}};}
test('English and Hebrew prefix requests are exact, fresh, text-only and group-bound',()=>{
 for(const text of ['Columbus explain KAI','columbus: explain KAI','קולומבוס תסביר על KAI'])assert(questionFrom(message(text),'notify',target,{now,activatedAt}));
 for(const text of ['hey Columbus explain','Columbusian task','קולומבוסי תסביר','🤖 Columbus replied'])assert.equal(questionFrom(message(text),'notify',target,{now,activatedAt}),null);
 assert.equal(questionFrom(message('Columbus hi',{messageTimestamp:(now-700000)/1000}),'notify',target,{now,activatedAt}),null);
 assert.equal(questionFrom(message('Columbus hi'),'append',target,{now,activatedAt}),null);
 assert(questionFrom(message('Columbus hi',{key:{remoteJid:target,id:'OWNERPHONE123',fromMe:true}}),'append',target,{now,activatedAt}),'the paired owner can ask from their phone');
 const unrelated={key:{remoteJid:'personal@s.whatsapp.net'},get message(){throw Error('personal text was read');}};
 assert.equal(questionFrom(unrelated,'notify',target,{now,activatedAt}),null);
 const quoted=message('',{message:{extendedTextMessage:{text:'Columbus explain this',contextInfo:{stanzaId:'trusted-alert',remoteJid:'another@g.us',get quotedMessage(){throw Error('raw quote read');}}}}});
 assert.equal(questionFrom(quoted,'notify',target,{now,activatedAt}).quotedID,null);
});
test('wire boundary blocks private/other-group ciphertext before any receive handler and locks outbound sends',async()=>{
 const sock=socket();restrictSocket(sock,target);
 for(const from of ['55555@s.whatsapp.net','99999@g.us','status@broadcast'])sock.ws.emit('CB:message',{attrs:{from},get content(){throw Error('outside ciphertext consumed');}});
 assert.equal(sock.calls.length,0);
 const frame={attrs:{from:target},content:[]};sock.ws.emit('CB:message',frame);assert.equal(sock.calls[0],frame);
 for(const jid of ['55555@s.whatsapp.net','99999@g.us']){assert.throws(()=>sock.sendMessage(jid,{text:'no'}),/blocked/);assert.throws(()=>sock.relayMessage(jid,{}),/blocked/);}
 assert.equal(sock.calls.length,1);
 assert.deepEqual(Object.keys(await sock.groupFetchAllParticipating()),[target]);
 await assert.rejects(sock.fetchMessageHistory(),/disabled/);
 await sock.sendMessage(target,{text:'allowed'});assert.equal(sock.calls.length,2);
});
test('request ledger deduplicates across restart, limits abuse and stores no question content',()=>{
 const root=mkdtempSync(join(tmpdir(),'columbus-'));const path=join(root,'questions.sqlite');let ledger=new ColumbusLedger(path);
 try{
  const item={id:'one',sender:'synthetic-sender',question:'never persist my question'};
  assert(ledger.accept(item,now));assert(!ledger.accept(item,now));assert(!ledger.accept({...item,id:'two'},now+1000));
  ledger.close();ledger=new ColumbusLedger(path);assert(!ledger.accept(item,now+40000));
  assert.equal(ledger.db.prepare('select status from questions where id=?').get('one').status,'uncertain');
  assert(!JSON.stringify(ledger.db.prepare('select * from questions').all()).includes(item.question));
 }finally{ledger.close();rmSync(root,{recursive:true,force:true});}
});
test('answers use only local Ollama and bounded text, without tools or configurable destinations',async()=>{
 let request;
 const text=await answerQuestion('קולומבוס תסביר KAI',{title:'KAI Scheduler'}, {send:async(url,init)=>{assert.equal(url,'http://127.0.0.1:11434/api/generate');request=JSON.parse(init.body);return Response.json({done:true,thinking:'PRIVATE MODEL REASONING',response:JSON.stringify({answer:'קודם נותנים ל-GPU עבודה, גאון. KAI מתזמן עומסי GPU.'})});}});
 assert(text.startsWith('🤖'));assert(text.includes('KAI'));assert.equal(request.think,false);assert.equal('tools' in request,false);
 assert(request.system.includes('Hebrew'));assert(request.system.includes('no tools'));assert.equal(request.model,'qwen3:4b');
 assert.deepEqual(request.format.required,['answer']);assert.equal(request.format.additionalProperties,false);
 assert(request.prompt.endsWith('/no_think'));assert(!text.includes('PRIVATE MODEL REASONING'));assert(!text.includes('"answer"'));
 await assert.rejects(answerQuestion('hi',null,{model:'a-cloud-model'}),/Local/);
});
test('reasoning, malformed output and truncated generations never become WhatsApp replies',async()=>{
 const ask=payload=>answerQuestion('Explain GPU scheduling',null,{send:async()=>Response.json({done:true,...payload})});
 for(const response of [
  'Okay, let me think about how to answer the user. The final answer is GPU scheduling.',
  '<think>private thought</think>{"answer":"GPU scheduling"}',
  '<think>unfinished private thought',
  JSON.stringify({answer:'<think>private thought</think>GPU scheduling'}),
  JSON.stringify({answer:'private thought</think>GPU scheduling'}),
  JSON.stringify({answer:'<analysis>private thought'}),
  JSON.stringify({answer:'<|channel|>analysis private thought'}),
  JSON.stringify({thinking:'private thought',answer:'GPU scheduling'}),
  JSON.stringify({answer:''}), JSON.stringify({answer:42}), 'null', '[]'
 ])await assert.rejects(ask({response}));
 await assert.rejects(ask({done_reason:'length',response:'{"answer":"A truncated explanation"}'}));
 assert((await ask({thinking:'PRIVATE',response:'{"answer":"Fine, genius. GPU scheduling assigns work to available GPUs."}'})).endsWith('Fine, genius. GPU scheduling assigns work to available GPUs.'));
});
test('trusted article context comes from sent public alerts, never arbitrary quoted content',()=>{
 const root=mkdtempSync(join(tmpdir(),'columbus-context-'));const store=new DeliveryStore(join(root,'deliveries.sqlite'));
 try{
  const payload={title:'KAI test title',summary:'GPU resource placement',why:'Shared GPU scheduling',evidence:'public excerpt',ui_url:'https://stacksignal.example/?article=one'};
  store.accept({id:'event',payload},now);store.claim(now);store.prepareSend('event','alert',now);store.confirm('event','sent-alert',now);
  assert.equal(articleContext(root,'sent-alert').title,payload.title);assert.equal(articleContext(root,'unknown'),null);assert.equal(articleContext(root,null).summary,payload.summary);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('the installed listener answers only prefixed StackSignal questions and ignores its own signature',async()=>{
 const root=mkdtempSync(join(tmpdir(),'columbus-listener-'));const sock=socket();let generated=0;
 try{
  installColumbusBoundary(sock,{target,enabled:true,activatedAt,base:root,generateAnswer:async q=>{generated++;return '🤖 Columbus: '+q;}});
  sock.ev.emit('messages.upsert',{type:'notify',messages:[message('not a request'),message('Columbus should not read this',{key:{remoteJid:'55555@s.whatsapp.net',id:'PERSONAL1234'}})]});
  await new Promise(setImmediate);assert.equal(generated,0);
  sock.ev.emit('messages.upsert',{type:'notify',messages:[message('Columbus explain KAI')]});
  await new Promise(setImmediate);assert.equal(generated,1);assert.equal(sock.calls[0].jid,target);
  sock.ev.emit('messages.upsert',{type:'notify',messages:[message('Columbus explain KAI')]});await new Promise(setImmediate);assert.equal(generated,1);
 }finally{sock.ev.emit('connection.update',{connection:'close'});rmSync(root,{recursive:true,force:true});}
});
test('the listener withholds rejected model output instead of sending reasoning',async()=>{
 const root=mkdtempSync(join(tmpdir(),'columbus-output-'));const sock=socket();
 try{
  installColumbusBoundary(sock,{target,enabled:true,activatedAt,base:root,
   generateAnswer:q=>answerQuestion(q,null,{send:async()=>Response.json({done:true,response:'Let me think about the user request...'})})});
  sock.ev.emit('messages.upsert',{type:'notify',messages:[message('Columbus explain scheduling')]});
  await new Promise(setImmediate);
  assert.equal(sock.calls.length,1,'a failed generation gets a safe explanatory reply');
  assert(sock.calls[0].body.text.includes('Please retry shortly'));
  assert(!sock.calls[0].body.text.includes('Let me think'));
 }finally{sock.ev.emit('connection.update',{connection:'close'});rmSync(root,{recursive:true,force:true});}
});

test('the installed listener answers the exact Hebrew seven-release request without model invention',async()=>{
 const root=mkdtempSync(join(tmpdir(),'columbus-catalog-')),sock=socket();let lookedUp=0;
 try{
  installColumbusBoundary(sock,{target,enabled:true,activatedAt,base:root,
   generateAnswer:async()=>{throw Error('Catalog requests must bypass the LLM');},
   getContext:async(operation,count)=>{assert.equal(operation,'latest_releases');assert.equal(count,7);lookedUp++;return{releases:Array.from({length:7},(_,i)=>({title:'Real project '+i,discovered_at:new Date(now).toISOString(),ui_url:'https://stacksignal.example/?article='+i}))};}});
  sock.ev.emit('messages.upsert',{type:'notify',messages:[message('קולומבוס מה כל שבעת הreleaseים האחרונים שנכנסו לפלטפורמה?')]});
  await new Promise(setImmediate);assert.equal(lookedUp,1);assert.equal(sock.calls.length,1);
  for(let i=0;i<7;i++)assert(sock.calls[0].body.text.includes('Real project '+i));
 }finally{sock.ev.emit('connection.update',{connection:'close'});rmSync(root,{recursive:true,force:true});}
});
test('a busy request gets an explicit bounded reply rather than disappearing',async()=>{
 const root=mkdtempSync(join(tmpdir(),'columbus-busy-')),sock=socket();let resolveAnswer;
 try{
  installColumbusBoundary(sock,{target,enabled:true,activatedAt,base:root,generateAnswer:()=>new Promise(r=>{resolveAnswer=r;})});
  sock.ev.emit('messages.upsert',{type:'notify',messages:[message('Columbus explain KAI')]});
  sock.ev.emit('messages.upsert',{type:'notify',messages:[message('Columbus explain GPUs',{key:{remoteJid:target,id:'SECONDQUESTION',participant:'66666@s.whatsapp.net'}})]});
  await new Promise(setImmediate);assert(sock.calls[0].body.text.includes('one question at a time'));
  resolveAnswer('Finished answer');await new Promise(setImmediate);assert.equal(sock.calls.length,2);
 }finally{sock.ev.emit('connection.update',{connection:'close'});rmSync(root,{recursive:true,force:true});}
});

test('linked-phone group frames pass vendor routing while personal ciphertext and spoofed recipients remain blocked',async()=>{
 const {ignoreRoute}=await import('../bot/columbus-policy.mjs');
 const sock=socket(),owner='55555:7@s.whatsapp.net',lid='88888@lid';sock.user={id:owner,lid};
 sock.ws.removeAllListeners('CB:message');const accepted=[];
 sock.ws.on('CB:message',node=>{
  // The pinned Baileys early filter receives the raw from address, not recipient.
  if(ignoreRoute(node.attrs.from,target))return;
  accepted.push(node.content);
  void Promise.resolve().then(()=>assert.equal(ignoreRoute(node.attrs.from,target),false));
 });
 restrictSocket(sock,target);
 for(const attrs of[
  {from:'55555:2@s.whatsapp.net',recipient:'99999@s.whatsapp.net'},
  {from:'55555:2@s.whatsapp.net'},
  {from:'55555:2@s.whatsapp.net',recipient:'99999@g.us'},
  {from:'77777@s.whatsapp.net',recipient:target},
  {from:'88888@lid',recipient:'99999@s.whatsapp.net'},
 ])sock.ws.emit('CB:message',{attrs,get content(){throw Error('Outside ciphertext read');}});
 assert.equal(accepted.length,0);assert.equal(ignoreRoute(owner,target),true);
 for(const from of['55555:2@s.whatsapp.net',lid])sock.ws.emit('CB:message',{attrs:{from,recipient:target},content:'fixed-group ciphertext'});
 await new Promise(setImmediate);assert.deepEqual(accepted,['fixed-group ciphertext','fixed-group ciphertext']);
 assert.equal(ignoreRoute(owner,target),true,'a permitted frame must not widen subsequent routing');
});
