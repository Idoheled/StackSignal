import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

test('operations RPC authorization, catalog truth, incident deduplication and bounded recovery',async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);create table auth.mfa_factors(user_id uuid,factor_type text,status text);create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;grant usage on schema auth to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;`);
  const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of(await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  const owner='40000000-0000-4000-8000-000000000001',reader='40000000-0000-4000-8000-000000000002',maintainer='40000000-0000-4000-8000-000000000003';
  for(const [id,name,role]of[[owner,'owner','admin'],[reader,'reader','reader'],[maintainer,'maintainer','maintainer']]){
   await db.query('insert into auth.users values($1)',[id]);await db.query('insert into ss_members(id,username,display_name,role) values($1,$2,$2,$3)',[id,name,role]);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[id]);await db.query('insert into ss_sessions(session_id,user_id) values($1,$1)',[id]);await db.query("insert into auth.mfa_factors values($1,'totp','verified')",[id]);
  }
  const as=async(id,aal='aal2')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,session_id:id,aal})]);await db.exec('set role authenticated');};
  const review={decision:'useful',score:85,confidence:'high',depth:'practical',evidence:'Documented public release configuration.',evaluated_at:new Date().toISOString()};
  for(let i=0;i<9;i++)await db.query("insert into ss_articles(url,title,kind,discovered_at,reference_meta) values($1,$2,'Release',$3,$4)",[`https://docs.example/project${i}/releases/v1`,`Project ${i} release`,new Date(Date.now()-i*1000).toISOString(),JSON.stringify({evaluation:review})]);
  await db.query("insert into ss_articles(url,title,kind,reference_meta) values('https://docs.example/pending/releases/v1','Pending release','Release','{}')");
  await db.exec('set role service_role');const context=(await db.query('select ss_platform_context(7) x')).rows[0].x;
  assert.equal(context.releases.length,7);assert.equal(context.releases[0].title,'Project 0 release');assert(!JSON.stringify(context).includes('Pending release'));assert(!JSON.stringify(context).includes('username'));
  await db.exec('reset role;set role anon');await assert.rejects(db.query('select ss_admin_dashboard()'));await assert.rejects(db.query('select ss_platform_context(7)'));
  for(const id of[reader,maintainer]){await as(id);await assert.rejects(db.query('select ss_admin_dashboard()'),/Administrator/);await assert.rejects(db.query('select ss_ops_snapshot()'),/permission/);}
  await as(owner,'aal1');await assert.rejects(db.query('select ss_admin_dashboard()'),/Administrator/);
  await as(owner);const dashboard=(await db.query('select ss_admin_dashboard(14) x')).rows[0].x;
  assert.equal(dashboard.users.length,3);assert.equal(dashboard.totals.members,3);assert.equal(dashboard.trends.length,14);assert.equal(dashboard.totals.reviewed_links,9);
  await assert.rejects(db.query('select * from ss_private.ops_incidents'),/permission/);
  await db.exec('reset role');await db.query("update ss_private.whatsapp_configuration set enabled=true,active_from=now()");
  const conditions=[{code:'evaluation_degraded',severity:'warning',summary:'Evaluation: one overdue item.'}];
  const observe=async c=>db.query('select ss_ops_observe($1,$2)',[JSON.stringify({stages:[]}),JSON.stringify(c)]);
  await observe(conditions);assert.equal((await db.query('select count(*)::int n from ss_private.ops_events')).rows[0].n,0);
  await db.exec("update ss_private.ops_incidents set first_seen=now()-interval '6 minutes'");await observe(conditions);await observe(conditions);
  assert.equal((await db.query('select count(*)::int n from ss_private.ops_events')).rows[0].n,1);
  await db.exec('set role service_role');const event=(await db.query('select * from ss_ops_claim_events()')).rows[0];
  assert(event.lease_id);await observe([]);assert.equal((await db.query('select * from ss_ops_claim_events()')).rows.length,0,'recovery must wait for confirmed incident delivery, including after resolution');
  assert.equal((await db.query("select ss_ops_finish_event($1,$2,'sent','provider') x",[event.id,crypto.randomUUID()])).rows[0].x,false);
  assert.equal((await db.query("select ss_ops_finish_event($1,$2,'sent','provider') x",[event.id,event.lease_id])).rows[0].x,true);
  await observe([]);await observe([]);await db.exec('reset role');
  assert.equal((await db.query("select count(*)::int n from ss_private.ops_events where phase='recovery'")).rows[0].n,1);
  await observe([{code:'brief_outage',severity:'warning',summary:'Temporary condition'}]);await observe([]);
  assert.equal((await db.query('select count(*)::int n from ss_private.ops_events')).rows[0].n,2,'brief conditions must not notify');
  await db.query("insert into ss_settings(key,value) values('evaluation_health',$1) on conflict(key) do update set value=excluded.value",[JSON.stringify({last_success:new Date().toISOString()})]);
  await db.query("insert into ss_articles(url,title,reference_meta) values('https://docs.example/repair','Pending config',$1)",[JSON.stringify({evaluation:null,evaluation_failed_at:new Date(Date.now()-3600000).toISOString(),evaluation_retry_at:new Date(Date.now()+86400000).toISOString(),evaluation_error_kind:'configuration',evaluation_error:'Gemini HTTP 400 (response_format)'})]);
  const before=(await db.query('select count(*)::int n from ss_private.evaluation_requests')).rows[0].n;
  await db.exec('set role service_role');assert.equal((await db.query('select ss_ops_reconcile() x')).rows[0].x.reviews_requeued,1);assert.equal((await db.query('select ss_ops_reconcile() x')).rows[0].x.reviews_requeued,0);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from ss_private.evaluation_requests')).rows[0].n,before);
  assert.equal((await db.query("select count(*)::int n from ss_private.whatsapp_outbox")).rows[0].n,0,'recovering pending reviews must not broadcast old approved links');
  await db.exec('set role service_role');const snapshot=(await db.query('select ss_ops_snapshot() x')).rows[0].x;assert.equal(snapshot.reviews.pending,2);
  await db.exec("reset role;update ss_private.whatsapp_configuration set active_from=now()-interval '10 minutes';update ss_private.ops_state set started_at=now()-interval '4 minutes'");
  await db.query("insert into ss_articles(url,title,discovered_at,reference_meta) values('https://docs.example/delayed-review','Delayed first review',now()-interval '5 minutes',$1)",[JSON.stringify({evaluation:{...review,evaluated_at:new Date(Date.now()-180000).toISOString()}})]);
  await db.exec("delete from ss_private.whatsapp_outbox where article_id=(select id from ss_articles where url='https://docs.example/delayed-review');set role service_role");
  assert.equal((await db.query('select ss_ops_snapshot() x')).rows[0].x.notifications.admission_gaps,1,'monitor must cover earlier discoveries first evaluated after monitoring began');

 }finally{await db.close();}
});
