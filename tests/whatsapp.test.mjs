import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

test("WhatsApp opt-in isolation, reviewed events, leases and delivery receipts", async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const owner = "30000000-0000-4000-8000-000000000001";
  const reader = "30000000-0000-4000-8000-000000000002";
  const other = "30000000-0000-4000-8000-000000000003";
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema extensions;create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
      create table auth.mfa_factors(user_id uuid,factor_type text,status text);
      create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
      grant usage on schema auth to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;`);
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter(n => n.endsWith(".sql")).sort())
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    for (const [id, name, role] of [[owner,"owner","admin"],[reader,"reader","reader"],[other,"other","reader"]]) {
      await db.query("insert into auth.users values($1)", [id]);
      await db.query("insert into ss_members(id,username,display_name,role) values($1,$2,$2,$3)",[id,name,role]);
      await db.query("insert into auth.sessions(id,user_id) values($1,$1)",[id]);
      await db.query("insert into ss_sessions(session_id,user_id) values($1,$1)",[id]);
      await db.query("insert into auth.mfa_factors values($1,'totp','verified')",[id]);
    }
    async function as(id, aal="aal2") {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,session_id:id,aal})]);
      await db.exec("set role authenticated");
    }
    const preferences = async value => (await db.query("select ss_whatsapp_preferences($1) result",[value])).rows[0].result;
    const meta = extra => ({ evaluation: { decision:"useful",score:85,confidence:"high",depth:"practical",
      evidence:"A documented mechanism for configuring distributed serving.",evaluated_at:new Date().toISOString() }, ...extra });
    const insert = async (url, value = meta()) => (await db.query(
      "insert into ss_articles(url,title,summary,reference_meta) values($1,'Notification regression','Documented configuration',$2) returning id",
      [url,JSON.stringify(value)])).rows[0].id;

    await t.test("invite access requires opt-in and a live member session", async () => {
      await db.query("update ss_private.whatsapp_configuration set invite_url='https://chat.whatsapp.com/SyntheticInviteOnly12345'");
      await as(reader,"aal1");
      assert.equal((await preferences(null)).invite_url,null);
      assert.equal((await preferences(true)).invite_url,"https://chat.whatsapp.com/SyntheticInviteOnly12345");
      await as(other);
      assert.equal((await preferences(null)).opt_in,false,"one user's choice does not alter another user's profile");
      await as(owner,"aal1");
      await assert.rejects(preferences(true),/Authentication/);
      await db.exec("reset role;set role anon");
      await assert.rejects(preferences(null),/permission denied/);
      await db.exec("reset role");
      await db.query("update ss_sessions set revoked=true where user_id=$1",[reader]);
      await as(reader);
      await assert.rejects(preferences(null),/Authentication/);
      await db.exec("reset role");
      await db.query("update ss_sessions set revoked=false where user_id=$1",[reader]);
    });

    await t.test("registration requires an explicit join declaration and preserves confirmation on repeated opt-in", async () => {
      await as(other);
      await assert.rejects(db.query("select ss_whatsapp_confirm_joined()"),/Choose WhatsApp/);
      assert.equal((await preferences(true)).registration,"pending");
      const confirmed=(await db.query("select ss_whatsapp_confirm_joined() result")).rows[0].result;
      assert.equal(confirmed.registration,"registered");
      assert.equal(confirmed.registration_source,"user_confirmed");
      assert(confirmed.registered_at);
      assert.equal((await preferences(true)).registered_at,confirmed.registered_at);
      assert.equal((await db.query("select ss_whatsapp_confirm_joined() result")).rows[0].result.registered_at,confirmed.registered_at);
      await as(reader);
      assert.equal((await preferences(null)).registration,"pending");
      await assert.rejects(db.query("update ss_members set whatsapp_registration='registered'"),/permission denied/);
      await as(other);
      const off=await preferences(false);
      assert.equal(off.registration,"unregistered");assert.equal(off.registered_at,null);assert.equal(off.invite_url,null);
      assert.equal((await preferences(true)).registration,"pending");
      await db.exec("reset role;set role anon");
      await assert.rejects(db.query("select ss_whatsapp_confirm_joined()"),/permission denied/);
      await db.exec("reset role");
    });

    await t.test("invitation opt-in is atomic and old invitation callers still work", async () => {
      await as(owner);
      const invitation=(await db.query("select ss_api('invite','{\"role\":\"reader\"}') result")).rows[0].result;
      await db.exec("reset role");
      const claim=crypto.randomUUID();
      const invited=(await db.query("select ss_claim_invite($1,$2) result",[invitation.token,claim])).rows[0].result;
      const user=crypto.randomUUID();
      await db.query("insert into auth.users values($1)",[user]);
      await db.query("select ss_finish_invite_whatsapp($1,$2,$3,'whatsapp_new','WhatsApp new')",[invited.id,claim,user]);
      assert.equal((await db.query("select whatsapp_opt_in from ss_members where id=$1",[user])).rows[0].whatsapp_opt_in,true);
      assert.equal((await db.query("select whatsapp_registration from ss_members where id=$1",[user])).rows[0].whatsapp_registration,"pending");
      await as(reader);
      await assert.rejects(db.query("select ss_finish_invite_whatsapp($1,$2,$3,'forged','Forged')",[invited.id,claim,user]),/permission denied/);
      await db.exec("reset role");
    });

    let article;
    await t.test("disabled notifications never backfill existing approved content", async () => {
      const prior=await insert("https://kubernetes.io/whatsapp-before-activation");
      assert.equal((await db.query("select count(*)::int n from ss_private.whatsapp_outbox")).rows[0].n,0);
      await db.query("update ss_private.whatsapp_configuration set enabled=true,active_from=now()");
      await db.query("update ss_articles set reference_meta=reference_meta||'{\"unrelated_metadata\":true}' where id=$1",[prior]);
      assert.equal((await db.query("select count(*)::int n from ss_private.whatsapp_outbox")).rows[0].n,0);
      article=await insert("https://kubernetes.io/whatsapp-newly-reviewed");
      const rows=(await db.query("select * from ss_private.whatsapp_outbox")).rows;
      assert.equal(rows.length,1);
      assert.equal(rows[0].payload.article_id,article);
      assert.equal(rows[0].payload.ui_url,"https://stacksignal.stacksignal-idoheled.workers.dev/?article="+article);
      assert(rows[0].payload.discovered_at && rows[0].payload.evaluated_at);
      await db.query("update ss_articles set reference_meta=reference_meta||'{\"another_refresh\":true}' where id=$1",[article]);
      assert.equal((await db.query("select count(*)::int n from ss_private.whatsapp_outbox")).rows[0].n,1);
    });

    await t.test("an older unevaluated discovery cannot broadcast when first reviewed after activation",async()=>{
      const row=(await db.query("insert into ss_articles(url,title,discovered_at,reference_meta) values('https://kubernetes.io/old-pending-notification','Old pending',now()-interval '1 day','{}') returning id")).rows[0];
      await db.query("update ss_articles set reference_meta=$2 where id=$1",[row.id,JSON.stringify(meta())]);
      assert.equal((await db.query("select count(*)::int n from ss_private.whatsapp_outbox where article_id=$1",[row.id])).rows[0].n,0);
    });

    await t.test("deep links require login and return no private notes",async()=>{
      await db.query("insert into ss_notes(article_id,user_id,body,visibility) values($1,$2,'Private test secret','private')",[article,owner]);
      await as(reader);
      const item=(await db.query("select ss_whatsapp_article($1) result",[article])).rows[0].result;
      assert.equal(item.id,article);
      assert(!JSON.stringify(item).includes("Private test secret"));
      await assert.rejects(db.query("select * from ss_private.whatsapp_outbox"),/permission denied/);
      await assert.rejects(db.query("select ss_whatsapp_claim_events()"),/permission denied/);
      await assert.rejects(db.query("select ss_whatsapp_dispatch_configuration()"),/permission denied/);
      await assert.rejects(db.query("select ss_whatsapp_stage_webhook('https://stacksignal.8.8.8.8.sslip.io/v1/events')"),/permission denied/);
      await db.exec("reset role;set role anon");
      await assert.rejects(db.query("select ss_whatsapp_article($1)",[article]),/permission denied/);
      await db.exec("reset role");
    });

    await t.test("one followed release is classified once; rejected content leaves no event",async()=>{
      const source=(await db.query("insert into ss_sources(name,url,type,topic) values('Official NIC','https://api.github.com/repos/Mellanox/nic-configuration-operator/releases','github','Networking') returning id")).rows[0].id;
      const release=await insert("https://github.com/Mellanox/nic-configuration-operator/releases/tag/notification-v1",meta({origin:"source_watch",alert_kind:"release",source_id:source,
        repo_health:{active:true,stars:23,license:"Apache-2.0",checked_at:new Date().toISOString()}}));
      assert.equal((await db.query("select event_kind from ss_private.whatsapp_outbox where article_id=$1",[release])).rows[0].event_kind,"github_release");
      await db.query("insert into ss_articles(url,title,reference_meta) values('https://kubernetes.io/whatsapp-rejected','Rejected',$1)",[JSON.stringify({evaluation:{...meta().evaluation,decision:"tangential"}})]);
      assert.equal((await db.query("select count(*)::int n from ss_private.whatsapp_outbox where payload->>'source_url'='https://kubernetes.io/whatsapp-rejected'")).rows[0].n,0);
      await db.query("delete from ss_articles where id=$1",[release]);
      assert.equal((await db.query("select count(*)::int n from ss_private.whatsapp_outbox where article_id=$1",[release])).rows[0].n,0);
    });

    await t.test("acceptance is not delivery; stale leases cannot confirm a send",async()=>{
      await db.exec("set role service_role");
      const event=(await db.query("select * from ss_whatsapp_claim_events(1)")).rows[0];
      assert(event.lease_id);
      assert.equal((await db.query("select * from ss_whatsapp_claim_events(1)")).rows.length,0);
      assert.equal((await db.query("select ss_whatsapp_finish_event($1,$2,'sent','receipt') result",[event.id,crypto.randomUUID()])).rows[0].result,false);
      await assert.rejects(db.query("select ss_whatsapp_finish_event($1,$2,'sent',null)",[event.id,event.lease_id]),/Invalid delivery/);
      await db.query("select ss_whatsapp_finish_event($1,$2,'queued',null)",[event.id,event.lease_id]);
      await db.exec("reset role");
      let row=(await db.query("select * from ss_private.whatsapp_outbox where id=$1",[event.id])).rows[0];
      assert.equal(row.status,"pending");assert.equal(row.delivered_at,null);assert(row.payload.title);
      await db.query("update ss_private.whatsapp_outbox set available_at=now() where id=$1",[event.id]);
      await db.exec("set role service_role");
      const next=(await db.query("select * from ss_whatsapp_claim_events(1)")).rows[0];
      assert.notEqual(next.lease_id,event.lease_id);
      await db.query("select ss_whatsapp_finish_event($1,$2,'uncertain',null)",[next.id,next.lease_id]);
      assert.equal((await db.query("select * from ss_whatsapp_claim_events(1)")).rows.length,0);
      await db.exec("reset role");
      row=(await db.query("select * from ss_private.whatsapp_outbox where id=$1",[next.id])).rows[0];
      assert.equal(row.status,"needs_attention");assert(row.payload.title);
    });

    await t.test("a confirmed receipt marks delivery and clears the public-text payload",async()=>{
      const id=await insert("https://kubernetes.io/whatsapp-confirmed-receipt");
      await db.exec("set role service_role");
      const event=(await db.query("select * from ss_whatsapp_claim_events(1)")).rows[0];
      assert.equal(event.article_id,id);
      assert.equal((await db.query("select ss_whatsapp_finish_event($1,$2,'sent','confirmed-provider-id') result",[event.id,event.lease_id])).rows[0].result,true);
      assert.equal((await db.query("select ss_whatsapp_finish_event($1,$2,'sent','confirmed-provider-id') result",[event.id,event.lease_id])).rows[0].result,false);
      await db.exec("reset role");
      const row=(await db.query("select * from ss_private.whatsapp_outbox where id=$1",[event.id])).rows[0];
      assert.equal(row.status,"sent");assert(row.delivered_at);assert.deepEqual(row.payload,{});
    });
  } finally { await db.close(); }
});
