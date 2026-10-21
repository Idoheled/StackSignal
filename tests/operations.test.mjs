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
  const observe=async (c,observation={stages:[]})=>db.query('select ss_ops_observe($1,$2)',[JSON.stringify(observation),JSON.stringify(c)]);
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


  await db.exec('reset role');
  // Keep the original failing and healthy evidence, even after the delivery body is cleared.
  const fault=[{code:'collection_degraded',severity:'warning',summary:'Collection: 68 pending; 56 overdue.'}];
  await observe(fault,{jobs:{pending:68,stuck:56},stages:[{key:'collection',status:'degraded',detail:'56 overdue'}]});
  await db.exec("update ss_private.ops_incidents set first_seen=now()-interval '6 minutes' where code='collection_degraded' and resolved_at is null");
  await observe(fault,{jobs:{pending:50,stuck:20},stages:[{key:'collection',status:'degraded',detail:'20 overdue'}]});
  await observe([],{jobs:{pending:19,stuck:0},stages:[{key:'collection',label:'Collection',status:'healthy',detail:'19 pending; 0 overdue; 0 failed.'}]});
  const incident=(await db.query("select * from ss_private.ops_incidents where code='collection_degraded' order by first_seen desc limit 1")).rows[0];
  assert.equal(incident.opening_evidence.jobs.pending,68);assert.equal(incident.latest_evidence.jobs.pending,50);assert.equal(incident.recovery_evidence.jobs.stuck,0);
  const recovery=(await db.query("select payload from ss_private.ops_events where incident_id=$1 and phase='recovery'",[incident.id])).rows[0].payload;
  assert.equal(recovery.code,'collection_recovered');assert.match(recovery.summary,/0 overdue/);assert(!recovery.summary.includes('56 overdue'));
  assert.equal((await db.query('select count(*)::int n from ss_private.ops_metrics')).rows[0].n,1,'samples in the same five-minute bucket are compacted');

  const job=(await db.query("insert into ss_jobs(kind,payload) values('article',$1) returning id",[JSON.stringify({url:'https://kubernetes.io/sensitive-private-query?secret=never-log',text:'NEVER-RETAIN-THIS-PAYLOAD'})])).rows[0].id;
  await db.query("update ss_jobs set status='running',attempts=1,locked_at=now() where id=$1",[job]);
  await db.query("update ss_jobs set status='pending',last_error='Source exceeds size limit' where id=$1",[job]);
  await db.query('delete from ss_jobs where id=$1',[job]);
  const trace=(await db.query('select * from ss_private.ops_trace_events where job_id=$1 order by id',[job])).rows;
  assert.deepEqual(trace.map(x=>x.phase),['queued','running','pending','removed']);assert.equal(trace[2].error_code,'source_size_limit');assert(trace[2].duration_ms>=0);
  assert(!JSON.stringify(trace).includes('NEVER-RETAIN'));assert(!JSON.stringify(trace).includes('https://'));
  const run=crypto.randomUUID();await db.exec('set role service_role');
  await db.query("select ss_ops_run_start($1,'collection')",[run]);await db.query("select ss_ops_run_finish($1,'succeeded',32)",[run]);await db.query("select ss_ops_run_finish($1,'failed',0)",[run]);
  await db.exec('reset role');assert.equal((await db.query('select status,processed from ss_private.ops_runs where id=$1',[run])).rows[0].processed,32,'finished run is immutable through service RPC');
  await db.exec("insert into ss_jobs(kind,payload) select 'article','{}' from generate_series(1,40);set role service_role");
  assert.equal((await db.query('select * from ss_claim_jobs(32)')).rows.length,32,'burst capacity is bounded at 32');
  await db.exec('reset role;delete from ss_jobs');
  const entity=crypto.randomUUID();await db.query("insert into ss_private.ops_trace_events(stage,entity_id,phase) select 'collection',$1,'running' from generate_series(1,101)",[entity]);
  await as(owner);
  const page=(await db.query('select ss_admin_diagnostics(null,$1) x',[entity])).rows[0].x;
  assert.equal(page.events.length,100);assert(page.next_cursor);
  const older=(await db.query('select ss_admin_diagnostics(null,$1,null,$2) x',[entity,page.next_cursor])).rows[0].x;
  assert.equal(older.events.length,1);assert(!page.events.some(e=>e.id===older.events[0].id));
  await as(reader);await assert.rejects(db.query('select ss_admin_diagnostics()'),/Administrator required/);
  await assert.rejects(db.query("select ss_ops_run_start($1,'collection')",[crypto.randomUUID()]),/permission denied/);
  await db.exec('reset role');
  await db.exec("insert into ss_private.ops_metrics values(now()-interval '31 days',now()-interval '31 days','{}');insert into ss_private.ops_trace_events(stage,entity_id,phase,occurred_at) values('collection',gen_random_uuid(),'removed',now()-interval '15 days');insert into ss_private.ops_runs(id,stage,started_at) values(gen_random_uuid(),'collection',now()-interval '31 days');delete from ss_limits where key like 'budget:ops-retention:%'");
  await observe([]);assert.equal((await db.query("select count(*)::int n from ss_private.ops_metrics where bucket<now()-interval '30 days'")).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from ss_private.ops_trace_events where occurred_at<now()-interval '14 days'")).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from ss_private.ops_runs where started_at<now()-interval '30 days'")).rows[0].n,0);

 }finally{await db.close();}
});
