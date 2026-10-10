import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { teamImportPayload } from "../scripts/import-team-library.mjs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
test("PostgreSQL access, isolation, invitation and concurrency invariants", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);create table auth.mfa_factors(user_id uuid,factor_type text,status text);create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;grant usage on schema auth to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;`,
    );
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(migrations))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(name, migrations), "utf8"));
    const bootstrapProfile = (await db.query("select value from ss_settings where key='profile'")).rows[0].value;
    assert.equal(bootstrapProfile.gemini_daily_limit, 0);
    assert.equal(bootstrapProfile.search_monthly_limit, 0);
    const owner = "10000000-0000-4000-8000-000000000001",
      writer = "10000000-0000-4000-8000-000000000002",
      reader = "10000000-0000-4000-8000-000000000003";
    const ids = [owner, writer, reader];
    for (const [i, id] of ids.entries()) {
      await db.query("insert into auth.users values($1)", [id]);
      await db.query(
        "insert into ss_members(id,username,display_name,role) values($1,$2,$2,$3)",
        [
          id,
          ["administrator", "writer", "reader"][i],
          ["admin", "maintainer", "reader"][i],
        ],
      );
      await db.query("insert into auth.sessions(id,user_id) values($1,$1)", [id]);
      await db.query("insert into auth.mfa_factors values($1,'totp','verified')", [id]);
      await db.query(
        "insert into ss_sessions(session_id,user_id) values($1,$1)",
        [id],
      );
    }
    async function as(id, aal = "aal2") {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: id, session_id: id, aal }),
      ]);
      await db.exec("set role authenticated");
    }
    async function action(name, p = {}) {
      return (
        await db.query("select ss_api($1,$2::jsonb) result", [
          name,
          JSON.stringify(p),
        ])
      ).rows[0].result;
    }
    async function fails(fn, fragment) {
      await assert.rejects(fn, fragment ? new RegExp(fragment) : undefined);
    }
    const payload = teamImportPayload();
    await db.exec("set role service_role");
    const firstImport = (
      await db.query("select ss_import_team($1::jsonb) result", [
        JSON.stringify(payload),
      ])
    ).rows[0].result;
    assert.equal(firstImport.articles_created, 136);
    assert.equal(firstImport.folders_created, 29);
    assert.equal(firstImport.sources_created, 57);
    assert.equal(firstImport.bookmarks_created, 136);
    await db.query(
      "update ss_folders set name='My custom inference folder' where import_key='team-folder:inference'",
    );
    const secondImport = (
      await db.query("select ss_import_team($1::jsonb) result", [
        JSON.stringify(payload),
      ])
    ).rows[0].result;
    assert.equal(secondImport.already_applied, true);
    assert.equal(
      (
        await db.query(
          "select name from ss_folders where import_key='team-folder:inference'",
        )
      ).rows[0].name,
      "My custom inference folder",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from ss_articles where published_at is not null",
        )
      ).rows[0].n,
      0,
    );
    await as(reader, "aal1");
    const importedLibrary = await action("library", { kind: "Pull request" });
    assert.equal(importedLibrary.total, 6);
    const pendingLinks = await action("library", { needs_review: true });
    assert.equal(pendingLinks.total, 133);
    assert.equal((await action("feed", { mode: "week" })).total, 0);
    await fails(() =>
      db.query("select ss_import_team($1::jsonb)", [JSON.stringify(payload)]),
    );
    await db.exec("reset role");
    // Leave one isolated fixture set for the pre-existing access-control tests.
    await db.exec(
      "delete from ss_jobs; delete from ss_bookmarks; delete from ss_articles; delete from ss_folders; delete from ss_sources; delete from ss_imports;",
    );
    await db.exec("set role anon");
    await fails(() => action("feed"));
    await fails(() => db.query("select * from ss_members"));
    await as(owner, "aal1");
    await fails(() => action("feed"), "MFA");
    assert.equal((await action("me")).role, "admin");
    await db.exec("reset role");
    await db.query("delete from auth.sessions where id=$1", [owner]);
    await as(owner);
    await fails(() => action("me"), "Authentication");
    await db.exec("reset role");
    await db.query("insert into auth.sessions(id,user_id) values($1,$1)", [owner]);
    await db.query("delete from auth.mfa_factors where user_id=$1", [owner]);
    await as(owner);
    await fails(() => action("feed"), "MFA");
    await db.exec("reset role");
    await db.query("insert into auth.mfa_factors values($1,'totp','verified')", [owner]);
    await as(owner);
    const parent = (await action("folder_save", { name: "Platforms" })).id;
    const child = (
      await action("folder_save", { name: "OpenShift", parent_id: parent })
    ).id;
    await fails(
      () =>
        action("folder_save", {
          id: parent,
          name: "Platforms",
          parent_id: child,
        }),
      "contain itself",
    );
    await db.exec("reset role");
    const article = (
      await db.query(
        "insert into ss_articles(url,title,published_at,topic,score) values('https://kubernetes.io/docs/','OpenShift GPU operators',now(),'Platforms',70) returning id",
      )
    ).rows[0].id;
    await as(writer);
    await action("save", { article_id: article, folder_id: child });
    const lib = await action("library", { folder: parent, q: "GPU" });
    assert.equal(lib.items.length, 1);
    assert.equal(lib.items[0].folder_paths[0], "Platforms / OpenShift");
    await action("note_save", {
      article_id: article,
      body: "Private capacity context",
      visibility: "private",
    });
    await action("note_save", {
      article_id: article,
      body: "Shared tuning note",
      visibility: "team",
    });
    await fails(
      () => action("feedback", { article_id: article, hidden: true }),
      "Confirmation",
    );
    await action("feedback", { article_id: article, liked: true });
    assert.equal((await action("feed")).items[0].liked, true);
    await as(reader, "aal1");
    assert.equal((await action("library")).items.length, 1);
    const visible = await action("notes", { article_id: article });
    assert.equal(visible.length, 1);
    assert.equal(visible[0].body, "Shared tuning note");
    assert.equal((await db.query("select body from ss_notes")).rows.length, 1);
    for (const operation of [
      "save",
      "feedback",
      "folder_save",
      "note_save",
      "invite",
      "admin",
    ])
      await fails(
        () =>
          action(operation, {
            article_id: article,
            name: "Denied",
            body: "Denied",
          }),
        "Read-only",
      );
    await fails(() => db.query("update ss_members set role='admin'"));
    await as(owner);
    assert.equal((await action("notes", { article_id: article })).length, 1);
    const dump = await action("export");
    assert(!JSON.stringify(dump).includes("Private capacity context"));
    await fails(
      () =>
        action("note_save", {
          id: visible[0].id,
          body: "Hijack",
          visibility: "team",
        }),
      "author",
    );
    await action("folder_delete", { id: parent, confirmed: true });
    assert.equal((await action("library")).items.length, 0);
    await action("restore", { id: parent, type: "folder" });
    assert.equal((await action("library")).items.length, 1);
    const invite = await action("invite", { role: "reader", label: "Test" });
    assert.match(invite.token, /^[a-f0-9]{64}$/);
    assert(!JSON.stringify(await action("admin")).includes(invite.token));
    await db.exec("reset role");
    const claim = crypto.randomUUID();
    const claimed = (
      await db.query("select ss_claim_invite($1,$2) i", [invite.token, claim])
    ).rows[0].i;
    await fails(
      () =>
        db.query("select ss_claim_invite($1,$2)", [
          invite.token,
          crypto.randomUUID(),
        ]),
      "unavailable",
    );
    const newcomer = crypto.randomUUID();
    await db.query("insert into auth.users values($1)", [newcomer]);
    await db.query("select ss_finish_invite($1,$2,$3,$4,$4)", [
      claimed.id,
      claim,
      newcomer,
      "newmember",
    ]);
    await fails(
      () =>
        db.query("select ss_claim_invite($1,$2)", [
          invite.token,
          crypto.randomUUID(),
        ]),
      "unavailable",
    );
    await as(owner);
    await action("member_update", {
      id: writer,
      role: "maintainer",
      active: false,
      confirmed: true,
    });
    await as(writer);
    await fails(() => action("feed"), "Authentication");
    await as(owner);
    await fails(
      () =>
        action("member_update", {
          id: owner,
          role: "reader",
          active: false,
          confirmed: true,
        }),
      "protected",
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select ss_take_budget('test',2,3600) ok")).rows[0].ok,
      true,
    );
    assert.equal(
      (await db.query("select ss_take_budget('test',2,3600) ok")).rows[0].ok,
      true,
    );
    assert.equal(
      (await db.query("select ss_take_budget('test',2,3600) ok")).rows[0].ok,
      false,
    );
    assert.equal(
      (await db.query("select n from ss_limits where key='budget:test'"))
        .rows[0].n,
      2,
    );
    await db.query(
      "insert into ss_jobs(kind,payload) values('article','{}'),('article','{}')",
    );
    const jobs = (await db.query("select * from ss_claim_jobs(1)")).rows;
    assert.equal(jobs.length, 1);
    assert.equal(
      (await db.query("select * from ss_claim_jobs(5)")).rows.length,
      1,
    );
    await db.query("update ss_folders set deleted_at=now()-interval '31 days' where id=$1", [child]);
    await db.query("select ss_maintenance()");
    assert.equal((await db.query("select count(*)::int n from ss_bookmarks where folder_id=$1", [child])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from ss_articles where id=$1", [article])).rows[0].n, 1);

    await as(reader);
    await fails(() => action("source_save", { name: "no", url:"https://github.com/a/b", type:"github",topic:"Platforms",interval_minutes:240 }), "Read-only");
    await as(owner);
    const watchPayload = {name:"NCCL releases",url:"https://github.com/NVIDIA/nccl",type:"github",topic:"Networking",interval_minutes:240};
    const watch = (await action("source_save",watchPayload)).id;
    let watchRow = (await action("sources")).find(x=>x.id===watch);
    assert.equal(watchRow.url,"https://api.github.com/repos/NVIDIA/nccl/releases");
    assert.equal(watchRow.include_prereleases,false);
    await fails(() => action("source_toggle",{id:watch,active:false}),"Confirmation");
    await action("source_toggle",{id:watch,active:false,confirmed:true});
    await action("source_save",{...watchPayload,id:watch,include_prereleases:true,priority:"core"});
    watchRow = (await action("sources")).find(x=>x.id===watch);
    assert.equal(watchRow.active,false,"editing a paused watch must not resume it");
    assert.equal(watchRow.include_prereleases,true);
    assert.equal(watchRow.priority,"core");
    const previousProfile = (await action("admin")).profile;
    await action("profile_save",{min_score:60});
    const profile = (await action("admin")).profile;
    assert.equal(profile.min_score,60);
    assert.equal(profile.repo_discovery,true);
    assert.equal(profile.gemini_daily_limit,0);
    assert.deepEqual(profile.priorities, previousProfile.priorities);
    await fails(() => action("profile_save",{repo_queries:["a".repeat(161)]}),"Invalid");
    await fails(() => action("profile_save",{min_score:99}),"Invalid");
    await fails(() => action("source_delete",{id:watch}),"Confirmation");
    await db.exec("reset role");
    await db.query("update ss_articles set reference_meta=$2::jsonb,published_at=now(),score=88 where id=$1", [article,JSON.stringify({alert_kind:"release",source_id:watch,origin:"source_watch"})]);
    await db.query("delete from ss_feedback where article_id=$1",[article]);
    await as(owner);
    assert.equal((await action("feed",{mode:"releases"})).total,1);
    assert.equal((await action("stats")).release_unread,1);
    await action("read",{article_id:article});
    assert.equal((await action("stats")).release_unread,0);
    await action("source_delete",{id:watch,confirmed:true});
    assert.equal((await action("feed",{mode:"releases"})).total,1,"removing a watch preserves its links");
    await db.exec("reset role");
    await db.query("update ss_articles set reference_meta='{\"origin\":\"discovery\"}',published_at=null where id=$1",[article]);
    await as(owner);
    assert.equal((await action("feed",{mode:"radar"})).total,1);
    assert.equal((await action("feed",{mode:"week"})).total,0,"discovery never invents a publication date");
    await db.exec("reset role");
    await db.exec("delete from ss_jobs");
    await db.query("select ss_queue_item('analyze',$1::jsonb)",[JSON.stringify({url:"https://github.com/a/b"})]);
    await db.query("select ss_queue_item('analyze',$1::jsonb)",[JSON.stringify({url:"https://github.com/a/b"})]);
    assert.equal((await db.query("select count(*)::int n from ss_jobs")).rows[0].n,1);
    await db.exec("insert into ss_jobs(kind,available_at) select 'article',now()-interval '1 day' from generate_series(1,20); insert into ss_jobs(kind) values('source'),('discovery')");
    const fair = (await db.query("select * from ss_claim_jobs(4)")).rows;
    assert.deepEqual(new Set(fair.map(j=>j.kind)),new Set(['article','source','analyze','discovery']));
    await as(reader);
    await fails(()=>db.query("select ss_feedback_weights()"));
    await fails(()=>db.query("select ss_queue_item('article','{}')"));

    console.log(
      "Verified: RLS, MFA gate, read-only restrictions, private notes, recursive title search, cycle prevention, trash/restore, confirmation, single-use invites, immediate revocation, bounded quotas, job leases.",
    );
  } finally {
    await db.close();
  }
});
