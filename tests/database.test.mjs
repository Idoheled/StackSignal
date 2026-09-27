import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
test("PostgreSQL access, isolation, invitation and concurrency invariants", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;grant usage on schema auth to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;`,
    );
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/001_stacksignal.sql", import.meta.url),
        "utf8",
      ),
    );
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
    await db.exec("set role anon");
    await fails(() => action("feed"));
    await fails(() => db.query("select * from ss_members"));
    await as(owner, "aal1");
    await fails(() => action("feed"), "MFA");
    assert.equal((await action("me")).role, "admin");
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
    await db.query("select ss_maintenance()");
    console.log(
      "Verified: RLS, MFA gate, read-only restrictions, private notes, recursive title search, cycle prevention, trash/restore, confirmation, single-use invites, immediate revocation, bounded quotas, job leases.",
    );
  } finally {
    await db.close();
  }
});
