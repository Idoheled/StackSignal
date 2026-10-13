import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { teamImportPayload } from "../scripts/import-team-library.mjs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
test("PostgreSQL access, isolation, invitation and concurrency invariants", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);create table auth.mfa_factors(user_id uuid,factor_type text,status text);create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;grant usage on schema auth to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;`,
    );
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(migrations))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      let legacySource, legacyArticle, rejectedMigrationRows;
      if (name.endsWith("_hard_delete_unselected_link_state.sql")) {
        rejectedMigrationRows=[];
        const request=(await db.query("insert into ss_private.evaluation_requests default values returning id")).rows[0].id;
        for(const decision of ["tangential","insufficient_evidence"]) {
          const url=`https://kubernetes.io/migration-${decision}`;
          const meta={evaluation:{decision,score:0,confidence:"low",depth:"unknown",evidence:"",cache_key:decision},review_commit:decision};
          const id=(await db.query("insert into ss_articles(url,title,reference_meta) values($1,'Migration purge regression',$2) returning id",[url,JSON.stringify(meta)])).rows[0].id;
          rejectedMigrationRows.push(id);
          await db.query("insert into ss_private.review_cohort(url) values($1)",[url]);
          await db.query("insert into ss_private.evaluation_claims(article_id,cache_key,request_id) values($1,$2,$3)",[id,"e".repeat(64),request]);
          await db.query("insert into ss_private.evaluation_attempts(article_id,cache_key) values($1,$2)",[id,"e".repeat(64)]);
          await db.query("insert into ss_jobs(kind,payload) values('analyze',$1)",[JSON.stringify({url,title:"Migration purge regression"})]);
        }
      }
      if (name.endsWith("_source_watch_compatibility.sql")) {
        legacySource = (await db.query("insert into ss_sources(name,url,type,topic) values('Legacy NCCL','https://api.github.com/repos/NVIDIA/nccl/releases?per_page=10','github','Networking') returning id")).rows[0];
        legacyArticle = (await db.query("insert into ss_articles(url,title,kind,published_at,score) values('https://github.com/nvidia/NCCL/releases/tag/v2.0.0rc1','NCCL candidate','Release',now(),40) returning id,published_at")).rows[0];
      }
      await db.exec(await readFile(new URL(name, migrations), "utf8"));
      if(rejectedMigrationRows) {
        for(const table of ["ss_articles","ss_private.article_reviews","ss_private.evaluation_claims","ss_private.evaluation_attempts"])
          assert.equal((await db.query(`select count(*)::int n from ${table} where ${table==="ss_articles"?"id":"article_id"}=any($1::uuid[])`,[rejectedMigrationRows])).rows[0].n,0,"migration purges existing rejected links and private copies");
        assert.equal((await db.query("select count(*)::int n from ss_jobs where payload->>'url' like 'https://kubernetes.io/migration-%'")).rows[0].n,0);
        assert.equal((await db.query("select count(*)::int n from ss_private.evaluation_requests")).rows[0].n,1,"purging source data preserves the request quota ledger");
        await db.exec("delete from ss_private.evaluation_requests");
      }
      if (legacyArticle) {
        const repaired = (await db.query("select * from ss_articles where id=$1", [legacyArticle.id])).rows[0];
        assert.equal(repaired.reference_meta.prerelease, true);
        assert.equal(repaired.reference_meta.source_id, legacySource.id);
        assert.equal(repaired.reference_meta.alert_kind, "release");
        assert.equal(repaired.published_at.getTime(), legacyArticle.published_at.getTime());
        assert.equal(repaired.score, 80);
        await db.query("delete from ss_articles where id=$1", [legacyArticle.id]);
        await db.query("delete from ss_sources where id=$1", [legacySource.id]);
      }
    }
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
    const review={topic:"Platforms",score:90,confidence:"high",depth:"advanced",decision:"useful",evidence:"Reviewed public engineering excerpt",evaluated_at:new Date().toISOString()};
    await db.query("update ss_articles set reference_meta=$2::jsonb where id=$1",[article,JSON.stringify({review_commit:crypto.randomUUID(),evaluation:review})]);
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
    await db.exec("reset role");
    await db.query("update ss_sources set url=url||'?per_page=10' where id=$1", [watch]);
    await as(owner);
    await fails(() => action("source_save",{...watchPayload,url:"https://github.com/nvidia/NCCL"}),"already followed");
    await fails(() => action("source_toggle",{id:watch,active:false}),"Confirmation");
    await action("source_toggle",{id:watch,active:false,confirmed:true});
    await action("source_save",{...watchPayload,id:watch,include_prereleases:true,priority:"core"});
    watchRow = (await action("sources")).find(x=>x.id===watch);
    assert.equal(watchRow.active,false,"editing a paused watch must not resume it");
    assert.equal(watchRow.include_prereleases,true);
    assert.equal(watchRow.priority,"core");
    const ocp=(await action("source_save",{name:"OpenShift candidates",url:"https://amd64.ocp.releases.ci.openshift.org/api/v1/releasestream/5-stable/tags",type:"openshift",topic:"Platforms",interval_minutes:240,include_prereleases:true})).id;
    assert((await action("sources")).find(s=>s.id===ocp).include_prereleases);
    await fails(()=>action("source_save",{name:"Bad stream",url:"https://evil.example/tags",type:"openshift",topic:"Platforms",interval_minutes:240}),"Invalid");
    await fails(()=>action("profile_save",{repo_min_watchers:0}),"Invalid");
    await fails(()=>db.query("select ss_evaluation_candidates()"),"permission denied");
    await db.exec("reset role");
    const gh=(await db.query("insert into ss_articles(url,title,content_hash,reference_meta) values('https://github.com/example/maintained','GitHub candidate',$1,$2) returning id",["e".repeat(64),JSON.stringify({public_evaluation_input:{text:"Public engineering excerpt"}})])).rows[0].id;
    await as(owner);assert.equal((await action("feed",{mode:"archive",q:"GitHub candidate"})).total,0,"unresolved repository work cannot bypass the review gate");
    await action("save",{article_id:gh});assert.equal((await action("library",{q:"GitHub candidate"})).total,1,"an unresolved saved reference remains accessible until its terminal review");
    await db.exec("reset role");
    const repoHealth={checked_at:new Date().toISOString(),stars:400,watchers:10,recent_releases:3,pushed_at:new Date().toISOString(),latest_release:new Date().toISOString(),active:true,license:"Apache-2.0"};
    await db.query("update ss_articles set reference_meta=reference_meta||$2::jsonb where id=$1",[gh,JSON.stringify({repo_health:repoHealth,evaluation:review,review_commit:crypto.randomUUID()})]);
    await as(owner);assert.equal((await action("feed",{mode:"archive",q:"GitHub candidate"})).total,1);
    await action("profile_save",{repo_min_stars:500});assert.equal((await action("feed",{mode:"archive",q:"GitHub candidate"})).total,0,"new admin thresholds apply immediately without another model call");
    await action("profile_save",{repo_min_stars:100});
    await db.exec("reset role");
    await db.query("update ss_articles set reference_meta=reference_meta||$2::jsonb where id=$1",[gh,JSON.stringify({review_commit:crypto.randomUUID(),evaluation:null,repo_health:{...repoHealth,watchers:1}})]);
    assert(!(await db.query("select ss_evaluation_candidates() x")).rows[0].x.some(r=>r.id===gh));
    assert.equal((await db.query("select ss_reserve_evaluation_batch($1,16,496) x",[JSON.stringify([{id:gh,content_hash:"e".repeat(64),cache_key:"d".repeat(64)}])])).rows[0].x.request_id,undefined,"weak repositories cannot spend AI quota through a forged reservation");
    await db.query("delete from ss_articles where id=$1",[gh]);
    await as(owner);
    const previousProfile = (await action("admin")).profile;
    await action("profile_save",{min_score:60});
    const profile = (await action("admin")).profile;
    assert.equal(profile.min_score,60);
    assert.equal(profile.repo_discovery,true);
    assert.equal(profile.gemini_daily_limit,0);
    assert.deepEqual(profile.priorities, previousProfile.priorities);
    await fails(() => action("profile_save",{repo_queries:["a".repeat(161)]}),"Invalid");
    await fails(() => action("profile_save",{min_score:99}),"Invalid");
    await fails(() => action("profile_save",{gemini_daily_limit:17}),"Invalid");
    await fails(() => action("profile_save",{gemini_monthly_limit:497}),"Invalid");
    await fails(() => action("profile_save",{gemini_mode:"automatic"}),"Invalid");
    await action("profile_save",{gemini_mode:"rerank",gemini_daily_limit:4,gemini_monthly_limit:100});
    await action("profile_save",{min_score:60});
    assert.equal((await action("admin")).profile.gemini_mode,"rerank","unrelated profile updates preserve the saved Apply setting");
    await fails(() => db.query("select ss_reserve_evaluation($1,$2,4,100)",[article,"a".repeat(64)]),"permission denied");
    await fails(() => db.query("select * from ss_private.evaluation_attempts"),"permission denied");
    await db.exec("reset role");
    await db.query("update ss_articles set reference_meta=reference_meta||$2::jsonb where id=$1",[article,JSON.stringify({public_evaluation_input:{text:"Public excerpt"}})]);
    await db.query("update ss_articles set content_hash=$2,reference_meta=reference_meta||'{\"evaluation\":null,\"review_commit\":\"explicit-test-reset\"}'::jsonb where id=$1",[article,"a".repeat(64)]);
    const batchIds=[article];
    for(let i=1;i<5;i++) batchIds.push((await db.query("insert into ss_articles(url,title,content_hash,reference_meta) values($1,'Pending public link',$2,$3::jsonb) returning id",["https://kubernetes.io/test-batch-"+i,"a".repeat(64),JSON.stringify({public_evaluation_input:{text:"Public engineering excerpt"}})])).rows[0].id);
    const items=k=>batchIds.map(id=>({id,cache_key:k.repeat(64),content_hash:"a".repeat(64)}));
    const reserve=async(k,d=4,m=100)=>(await db.query("select ss_reserve_evaluation_batch($1::jsonb,$2,$3) value",[JSON.stringify(items(k)),d,m])).rows[0].value;
    assert.equal((await reserve("a",17)).request_id,undefined,"hard cap cannot be bypassed");
    assert.equal((await reserve("a")).items.length,5);
    assert.equal((await db.query("select ss_evaluation_usage() value")).rows[0].value.used_24h,1,"five articles consume one request");
    assert.equal((await reserve("b")).request_id,undefined,"global five minute gate");
    await db.exec("update ss_private.evaluation_requests set attempted_at=attempted_at-interval '6 minutes'");
    assert.equal((await reserve("a")).request_id,undefined,"claimed batch is not duplicated by concurrent/repeated runs");
    for(const k of ["b","c","d"]) {
      await db.exec("update ss_private.evaluation_requests set attempted_at=attempted_at-interval '6 minutes'");
      assert((await reserve(k)).request_id);
    }
    await db.exec("update ss_private.evaluation_requests set attempted_at=attempted_at-interval '6 minutes'");
    assert.equal((await reserve("e")).request_id,undefined,"configured rolling ceiling includes failures");
    await db.exec("update ss_private.evaluation_requests set attempted_at=now()-interval '25 hours'");
    assert.equal((await reserve("e",4,4)).request_id,undefined,"monthly ceiling remains independent");
    await db.exec("delete from ss_private.evaluation_claims;delete from ss_private.evaluation_requests");
    for(let attempt=0;attempt<3;attempt++) {
      await db.exec("update ss_private.evaluation_claims set attempted_at=now()-interval '7 hours';update ss_private.evaluation_requests set attempted_at=now()-interval '6 minutes'");
      assert((await reserve("a",16,496)).request_id);
    }
    await db.exec("update ss_private.evaluation_claims set attempted_at=now()-interval '7 hours';update ss_private.evaluation_requests set attempted_at=now()-interval '6 minutes'");
    assert((await reserve("a",16,496)).request_id,"transport failures are recoverable beyond three attempts without resetting request accounting");
    assert.equal((await db.query("select ss_reserve_evaluation($1,$2,4,100) ok",[article,"f".repeat(64)])).rows[0].ok,false,"retired collector cannot bypass batch ledger");
    await db.exec("delete from ss_private.evaluation_claims;delete from ss_private.evaluation_requests");
    await as(owner);
    for(const mode of ["week","radar","archive","updates","releases"]) assert.equal((await action("feed",{mode})).total,0,"unevaluated records never enter suggestions");
    await fails(()=>db.query("select ss_reserve_evaluation_batch('[]',16,496)"),"permission denied");
    await fails(()=>db.query("select * from ss_private.evaluation_requests"),"permission denied");
    await db.exec("reset role");
    const uncertain=(await db.query("insert into ss_articles(url,title) values('https://kubernetes.io/uncertain-regression','Uncertain regression') returning id")).rows[0].id;
    await db.query("update ss_articles set reference_meta=reference_meta||$2::jsonb where id=$1",[uncertain,JSON.stringify({review_commit:"explicit-uncertainty-review",evaluation:{...review,decision:"insufficient_evidence",confidence:"low",depth:"unknown",evidence:""}})]);
    assert.equal((await db.query("select count(*)::int n from ss_articles where id=$1",[uncertain])).rows[0].n,0,"uncertain terminal decisions are permanently deleted");
    await as(owner);assert.equal((await action("feed",{mode:"archive"})).total,0,"uncertain assessments stay withheld");
    await db.exec("reset role");
    await db.query("update ss_articles set reference_meta=reference_meta||$2::jsonb where id=$1",[article,JSON.stringify({review_commit:crypto.randomUUID(),evaluation:review})]);
    await as(owner);
    await fails(() => action("source_delete",{id:watch}),"Confirmation");
    await db.exec("reset role");
    await db.query("update ss_articles set reference_meta=$2::jsonb,published_at=now(),score=88 where id=$1", [article,JSON.stringify({review_commit:crypto.randomUUID(),alert_kind:"release",source_id:watch,origin:"source_watch",evaluation:review})]);
    await db.query("delete from ss_feedback where article_id=$1",[article]);
    await as(owner);
    assert.equal((await action("feed",{mode:"releases"})).total,1);
    assert.equal((await action("stats")).release_unread,1);
    await db.exec("reset role");
    await db.query("update ss_articles set reference_meta=reference_meta||'{\"prerelease\":true}'::jsonb where id=$1",[article]);
    await as(owner);
    assert.equal((await action("feed",{mode:"releases"})).total,1,"opt-in includes prereleases");
    await action("source_save",{...watchPayload,id:watch,include_prereleases:false});
    assert.equal((await action("feed",{mode:"releases"})).total,0);
    assert.equal((await action("feed",{mode:"week"})).total,0);
    assert.equal((await action("stats")).release_unread,0);
    assert.equal((await action("feed",{mode:"archive"})).total,0,"all discovery modes respect the current release channel; saved history remains in the library");
    await db.exec("reset role");
    await db.query("update ss_articles set reference_meta=reference_meta||'{\"prerelease\":false}'::jsonb where id=$1",[article]);
    await as(owner);
    await action("read",{article_id:article});
    assert.equal((await action("stats")).release_unread,0);
    await action("source_delete",{id:watch,confirmed:true});
    assert.equal((await action("feed",{mode:"releases"})).total,1,"removing a watch preserves its links");
    await db.exec("reset role");
    await db.query("update ss_articles set reference_meta=$2::jsonb,published_at=null where id=$1",[article,JSON.stringify({review_commit:crypto.randomUUID(),origin:"discovery",evaluation:review})]);
    await as(owner);
    assert.equal((await action("feed",{mode:"radar"})).total,1);
    assert.equal((await action("feed",{mode:"week"})).total,0,"discovery never invents a publication date");
    await db.exec("reset role");
    await db.exec("delete from ss_jobs");
    await db.query("select ss_queue_item('analyze',$1::jsonb)",[JSON.stringify({url:"https://github.com/a/b"})]);
    await db.query("select ss_queue_item('analyze',$1::jsonb)",[JSON.stringify({url:"https://github.com/a/b"})]);
    assert.equal((await db.query("select count(*)::int n from ss_jobs")).rows[0].n,1);
    for (const window of ['daily','weekly','daily']) await db.query("select ss_queue_item('discovery',$1::jsonb)",[JSON.stringify({lane:'trending',window})]);
    for (const lane of ['web','repository','web']) await db.query("select ss_queue_item('discovery',$1::jsonb)",[JSON.stringify({lane,query:'GPU inference',window:'recent'})]);
    assert.equal((await db.query("select count(*)::int n from ss_jobs where kind='discovery'")).rows[0].n,4,'probe lane and period are distinct, repeat probes deduplicate');
    await db.exec("delete from ss_jobs where kind='discovery'");
    await db.exec("insert into ss_jobs(kind,available_at) select 'article',now()-interval '1 day' from generate_series(1,20); insert into ss_jobs(kind) values('source'),('discovery')");
    const fair = (await db.query("select * from ss_claim_jobs(4)")).rows;
    assert.deepEqual(new Set(fair.map(j=>j.kind)),new Set(['article','source','analyze','discovery']));
    await as(reader);
    await fails(()=>db.query("select ss_feedback_weights()"));
    await fails(()=>db.query("select ss_queue_item('article','{}')"));

    await db.exec("reset role");
    const frozen = (await db.query("insert into ss_articles(url,title,summary,content_hash,reference_meta) values('https://kubernetes.io/frozen-review','Original title','Original summary',$1,$2) returning id",["9".repeat(64),JSON.stringify({public_evaluation_input:{title:"Original title",text:"Reviewed public engineering excerpt with actionable GPU topology placement.",scope:"publisher_excerpt"}})])).rows[0].id;
    await db.query("insert into ss_private.review_cohort(url) values('https://kubernetes.io/frozen-review')");
    await db.query("insert into ss_private.review_cohort(url) values('https://github.com/vLLM-project/vLLM/releases/tag/TagCase')");
    assert.equal((await db.query("select ss_private.gemini_new_link('https://github.com/VLLM-project/VLLM/releases/tag/TagCase') x")).rows[0].x,false,"GitHub repository casing does not bypass the frozen cohort");
    assert.equal((await db.query("select ss_private.gemini_new_link('https://github.com/vllm-project/vllm/releases/tag/tagcase') x")).rows[0].x,true,"distinct case-sensitive release tags remain new links");
    assert(!(await db.query("select ss_evaluation_candidates() x")).rows[0].x.some(r=>r.id===frozen),"frozen cohort never enters Gemini candidates");
    assert.equal((await db.query("select ss_reserve_evaluation_batch($1,16,496) x",[JSON.stringify([{id:frozen,content_hash:"9".repeat(64),cache_key:"9".repeat(64)}])])).rows[0].x.request_id,undefined,"forged reservation cannot evaluate an old link");
    const assistantItem={id:frozen,input:{title:"Original title",text:"Reviewed public engineering excerpt with actionable GPU topology placement.",scope:"publisher_excerpt"},assessment:{topic:"Platforms",score:90,confidence:"high",depth:"advanced",decision:"useful",summary:"Actionable placement guidance.",reason:"Explains GPU topology placement.",action:"Compare topology constraints.",evidence:"actionable GPU topology placement"}};
    await as(reader);await fails(()=>db.query("select ss_apply_assistant_reviews($1)",[JSON.stringify([assistantItem])]),"permission denied");
    await db.exec("reset role");
    await fails(()=>db.query("select ss_apply_assistant_reviews($1)",[JSON.stringify([{...assistantItem,assessment:{...assistantItem.assessment,evidence:"invented quote"}}])]),"Evidence");
    await fails(()=>db.query("select ss_apply_assistant_reviews($1)",[JSON.stringify([{...assistantItem,input:{...assistantItem.input,scope:null}}])]),"Evidence");
    await fails(()=>db.query("select ss_apply_assistant_reviews($1)",[JSON.stringify([{...assistantItem,assessment:{...assistantItem.assessment,score:90.5}}])]),"Invalid assessment");
    await db.query("select ss_apply_assistant_reviews($1)",[JSON.stringify([assistantItem])]);
    const originalReview=(await db.query("select reference_meta->'evaluation' x from ss_articles where id=$1",[frozen])).rows[0].x;
    await db.query("insert into ss_feedback(user_id,article_id,read) values($1,$2,true)",[owner,frozen]);
    await db.query("update ss_articles set score=1,title='Changed title',summary='Changed source',content_hash=$2,reference_meta=reference_meta||$3 where id=$1",[frozen,"8".repeat(64),JSON.stringify({evaluation:null,public_evaluation_input:{title:"Changed title",text:"New text"}})]);
    const retained=(await db.query("select reference_meta from ss_articles where id=$1",[frozen])).rows[0].reference_meta;
    assert.deepEqual(retained.evaluation,originalReview,"collection never clears an existing review");
    assert.equal((await db.query("select score from ss_articles where id=$1",[frozen])).rows[0].score,90,"publisher refresh cannot change the completed assistant rank");
    assert(retained.review_content_changed_at);assert.equal(retained.review_snapshot.title,"Original title");
    assert.equal((await db.query("select count(*)::int n from ss_private.article_reviews where article_id=$1",[frozen])).rows[0].n,1,"refresh does not duplicate review history");
    await as(owner);const reviewedFeed=await action("feed",{mode:"archive"});const frozenCard=reviewedFeed.items.find(x=>x.id===frozen);
    assert.equal(frozenCard.title,"Original title");assert.equal(frozenCard.read,true);assert.equal(frozenCard.reference_meta.evaluation.evaluator,"assistant");assert.equal(frozenCard.score,90);
    const searched=await action("feed",{mode:"archive",q:"Original title"});assert(searched.items.some(a=>a.id===frozen),"search uses the retained reviewed title");
    await db.exec("reset role");await db.query("update ss_articles set discovered_at=now()-interval '100 days' where id=$1",[frozen]);await db.query("select ss_maintenance()");
    assert.equal((await db.query("select count(*)::int n from ss_articles where id=$1",[frozen])).rows[0].n,1,"maintenance retains reviewed links beyond 90 days");
    await as(reader);await fails(()=>db.query("select * from ss_private.article_reviews"),"permission denied");

    async function releaseFixture(url,title,hours,meta={},kind="Release") {
      await db.exec("reset role");
      return (await db.query("insert into ss_articles(url,title,kind,published_at,updated_at,score,reference_meta) values($1,$2,$3,$4,$4,90,$5) returning id",[
        url,title,kind,new Date(Date.now()-hours*3600000).toISOString(),JSON.stringify({repo_health:repoHealth,evaluation:review,...meta})
      ])).rows[0].id;
    }
    await t.test("one current release is selected globally before filters, ranking and pagination; saved history survives",async()=>{
      await as(owner);const before=await action("stats");
      const old=await releaseFixture("https://github.com/ReleaseTest/Runtime/releases/tag/v0.9.9","Release regression v0.9.9",1,{alert_kind:"release",evaluation:{...review,score:99}});
      const backport=await releaseFixture("https://github.com/releasetest/runtime/releases/tag/v0.12.26","Release regression v0.12.26",0.1,{alert_kind:"release",evaluation:{...review,score:99}});
      const latest=await releaseFixture("https://github.com/releasetest/runtime/releases/tag/v0.18.5","Release regression v0.18.5",2,{alert_kind:"release",evaluation:{...review,score:70},repository:"old-owner/old-name"});
      await releaseFixture("https://github.com/RELEASETEST/Runtime/releases/tag/v0.18.4","Release regression v0.18.4",0.2,{alert_kind:"release"});
      await releaseFixture("https://github.com/releasetest/runtime/releases/tag/v0.19.0","Release regression pending",0.01,{evaluation:null});
      await releaseFixture("https://github.com/releasetest/runtime/releases/tag/v0.20.0","Release regression rejected",0.01,{evaluation:{...review,decision:"tangential"}});
      await releaseFixture("https://github.com/releasetest/runtime/releases/tag/v0.21.0","Release regression future",-24);
      const doc=await releaseFixture("https://github.com/releasetest/runtime/blob/main/guide.md","Release regression guide",1,{repository:"releasetest/runtime"},"Article");
      const pr=await releaseFixture("https://github.com/releasetest/runtime/pull/42","Release regression change",1,{repository:"releasetest/runtime"},"Pull request");
      await as(owner);
      for(const mode of ["week","archive","updates","releases"]) for(const sort of ["newest","best"]) {
        const result=await action("feed",{mode,sort,q:"Release regression",kind:"Release",limit:1});
        assert.equal(result.total,1,`current release in ${mode}/${sort}`);assert.equal(result.items[0].id,latest,"latest version beats older backports, score and legacy repository metadata");
        assert.equal((await action("feed",{mode,sort,q:"Release regression",kind:"Release",limit:1,offset:1})).items.length,0);
      }
      assert.equal((await action("feed",{mode:"archive",q:"v0.12.26"})).total,0,"search never resurrects a superseded release");
      assert.equal((await action("feed",{mode:"radar",q:"Release regression",kind:"Release"})).total,0,"radar retains its nonrelease scope");
      const mixed=await action("feed",{mode:"archive",q:"Release regression"});
      assert.deepEqual(new Set(mixed.items.map(x=>x.id)),new Set([latest,doc,pr]),"docs and PRs from the same project are independent signals");
      assert.equal((await action("stats")).release_unread,before.release_unread+1);
      assert.equal((await action("stats")).week,before.week+3);
      await action("read",{article_id:latest});
      assert.equal((await action("feed",{mode:"releases",q:"Release regression",unread:true})).total,0,"reading the current release cannot reveal an older unread release");
      assert.equal((await action("stats")).release_unread,before.release_unread);
      await action("save",{article_id:old});
      await action("read",{article_id:old});
      await action("feedback",{article_id:latest,hidden:true,confirmed:true});
      await action("feedback",{article_id:backport,hidden:true,confirmed:true});
      assert.equal((await action("feed",{mode:"archive",q:"Release regression",kind:"Release"})).total,0,"personal dismissal cannot promote an old version");
      assert.equal((await action("hidden",{q:"Release regression",kind:"Release"})).total,1,"hidden view also suppresses superseded releases");
      assert.equal((await action("library",{q:"v0.9.9"})).items[0].id,old);
      await as(reader);
      assert.equal((await action("feed",{mode:"archive",q:"Release regression",kind:"Release"})).items[0].id,latest,"one member's dismissal does not affect another member");
      assert.equal((await action("library",{q:"v0.9.9"})).items[0].id,old,"a release saved by a member stays in the shared library");
      await fails(()=>db.query("select ss_private.current_release_ids('{}')"),"permission denied");
      await db.exec("reset role");
      await db.query("update ss_articles set reference_meta=reference_meta||'{\"evaluation\":null}'::jsonb where id=$1",[old]);
      assert.deepEqual((await db.query("select reference_meta->'evaluation' x from ss_articles where id=$1",[old])).rows[0].x,{...review,score:99},"suppression and refresh preserve completed assessments");
    });
    await t.test("OpenShift streams share one project and numeric preview order obeys channel opt-in",async()=>{
      await as(owner);
      const source={name:"Regression OpenShift previews",url:"https://amd64.ocp.releases.ci.openshift.org/api/v1/releasestream/5-dev-preview/tags",type:"openshift",topic:"Platforms",interval_minutes:240,include_prereleases:true};
      const watch=(await action("source_save",source)).id;
      const stable=await releaseFixture("https://amd64.ocp.releases.ci.openshift.org/releasestream/4-stable/release/4.22.1","OpenShift regression stable",0.1);
      await releaseFixture("https://amd64.ocp.releases.ci.openshift.org/releasestream/5-dev-preview/release/5.0.0-rc.2","OpenShift regression rc2",0.2);
      const rc10=await releaseFixture("https://amd64.ocp.releases.ci.openshift.org/releasestream/5-dev-preview/release/5.0.0-rc.10","OpenShift regression rc10",1);
      await as(owner);
      assert.equal((await action("feed",{mode:"archive",q:"OpenShift regression"})).items[0].id,rc10,"legacy URLs without provenance still infer their channel and numeric preview sequence");
      await action("source_save",{...source,id:watch,include_prereleases:false});
      const visible=await action("feed",{mode:"archive",q:"OpenShift regression"});
      assert.equal(visible.total,1);assert.equal(visible.items[0].id,stable);
      await action("save",{article_id:rc10});
      assert.equal((await action("library",{q:"OpenShift regression rc10"})).items[0].id,rc10,"saved preview remains accessible after opting out");
    });
    await t.test("nonversion release tags use publisher dates and ties do not split pagination",async()=>{
      await releaseFixture("https://docs.example/runtime/releases/autumn","Dated regression autumn",3);
      const newest=await releaseFixture("https://docs.example/runtime/releases/winter","Dated regression winter",1);
      await as(owner);
      const feed=await action("feed",{mode:"archive",q:"Dated regression"});assert.equal(feed.total,1);assert.equal(feed.items[0].id,newest);
      await db.exec("reset role");
      assert((await db.query("select ss_private.release_version('v1.0.0-rc10')>ss_private.release_version('v1.0.0-rc2') as valid")).rows[0].valid);
      assert((await db.query("select ss_private.release_version('v1.0.0')>ss_private.release_version('v1.0.0-rc.10') as valid")).rows[0].valid);
      assert((await db.query("select ss_private.release_version('v1.0.0-RC10')>ss_private.release_version('v1.0.0-RC2') as valid")).rows[0].valid);
      assert((await db.query("select ss_private.release_version('v1.0.0+build.9')=ss_private.release_version('v1.0.0') as valid")).rows[0].valid,"build metadata has no version precedence");
      const tied=await releaseFixture("https://docs.example/runtime/releases/spring","Dated regression spring",1);
      await db.query("update ss_articles set published_at=(select published_at from ss_articles where id=$1),discovered_at=(select discovered_at from ss_articles where id=$1) where id=$2",[newest,tied]);
      await as(owner);
      const first=await action("feed",{mode:"archive",q:"Dated regression",limit:1});
      assert.equal(first.total,1);assert.equal(first.items[0].id,[newest,tied].sort()[0],"publisher/discovery ties have a deterministic ID winner");
      assert.equal((await action("feed",{mode:"archive",q:"Dated regression",limit:1,offset:1})).items.length,0);
    });

    await t.test("twelve-link reservation, transient lease recovery and official watched policy",async()=>{
      await db.exec("reset role;delete from ss_private.evaluation_claims;delete from ss_private.evaluation_requests");
      const all=[];
      for(let i=0;i<13;i++) all.push((await db.query("insert into ss_articles(url,title,content_hash,reference_meta) values($1,'Capacity regression',$2,$3) returning id",["https://kubernetes.io/capacity-"+i,"a".repeat(64),JSON.stringify({public_evaluation_input:{title:"Public engineering",text:"A reproducible guide to controlled cache offloading",scope:"publisher_excerpt"}})])).rows[0].id);
      const items=all.map(id=>({id,cache_key:"e".repeat(64),content_hash:"a".repeat(64)}));
      const first=(await db.query("select ss_reserve_evaluation_batch($1,16,496) x",[JSON.stringify(items)])).rows[0].x;
      assert.equal(first.items.length,12);assert.equal((await db.query("select ss_evaluation_usage() x")).rows[0].x.used_24h,1);
      await db.query("select ss_finish_evaluation_request($1,'transient',0,'Gemini HTTP 503')",[first.request_id]);
      assert.equal((await db.query("select outcome from ss_private.evaluation_requests where id=$1",[first.request_id])).rows[0].outcome,"transient");
      await db.query("select ss_finish_evaluation_request($1,'success',12,null)",[first.request_id]);
      assert.equal((await db.query("select outcome from ss_private.evaluation_requests where id=$1",[first.request_id])).rows[0].outcome,"transient","completion is idempotent");
      await db.query("update ss_articles set reference_meta=reference_meta||$2 where id=any($1::uuid[])",[all,JSON.stringify({evaluation_failed_at:new Date().toISOString(),evaluation_error_kind:"transient",evaluation_failures:8,evaluation_retry_at:new Date(Date.now()-60000).toISOString()})]);
      await db.exec("update ss_private.evaluation_claims set attempted_at=now()-interval '6 minutes';update ss_private.evaluation_requests set attempted_at=now()-interval '6 minutes'");
      assert.equal((await db.query("select ss_reserve_evaluation_batch($1,16,496) x",[JSON.stringify(items)])).rows[0].x.items.length,12);
      const source=(await db.query("insert into ss_sources(name,url,type,topic) values('Official NIC','https://api.github.com/repos/Mellanox/nic-configuration-operator/releases','github','Networking') returning id")).rows[0].id;
      const meta={origin:"source_watch",source_id:source,repo_health:{active:true,stars:23,license:"Apache-2.0",checked_at:new Date().toISOString()}};
      const admit=async m=>(await db.query("select ss_private.repo_admitted('https://github.com/Mellanox/nic-configuration-operator/releases/tag/v2',$1,'{}') x",[JSON.stringify(m)])).rows[0].x;
      assert(await admit(meta));assert(!await admit({...meta,source_id:owner}),"a forged/nonmatching source cannot bypass policy");
      await db.query("update ss_sources set active=false where id=$1",[source]);assert(!await admit(meta));
      await as(reader);await fails(()=>db.query("select ss_evaluation_pipeline()"),"permission denied");await fails(()=>db.query("select ss_finish_evaluation_request(1,'success',1,null)"),"permission denied");
    });

    await t.test("watch fingerprints skip unchanged bodies while core releases retain a fast ingestion lane",async()=>{
      await db.exec("reset role");
      const source=(await db.query("insert into ss_sources(name,url,type,topic,priority) values('Core maintenance','https://api.github.com/repos/Mellanox/maintenance-operator/releases','github','Networking','core') returning id")).rows[0].id;
      const url="https://github.com/Mellanox/maintenance-operator/releases/tag/regression-v9";
      const meta={source_id:source,source_revision:1,source_fingerprint:"f".repeat(64),alert_kind:"release"};
      const article=(await db.query("insert into ss_articles(url,title,reference_meta) values($1,'Incremental watch',$2) returning id",[url,JSON.stringify(meta)])).rows[0].id;
      const payload={url,title:"Incremental watch",published_at:new Date().toISOString(),reference_meta:{...meta,repo_health:{checked_at:new Date().toISOString()}}};
      await db.query("select ss_queue_items('analyze',$1)",[JSON.stringify([payload])]);
      assert.equal((await db.query("select count(*) n from ss_jobs where payload->>'url'=$1",[url])).rows[0].n,0,"unchanged text does not enter ingestion again");
      assert((await db.query("select reference_meta->'repo_health' h from ss_articles where id=$1",[article])).rows[0].h.checked_at,"health clocks refresh without an ingestion job");
      const changed={...payload,reference_meta:{...payload.reference_meta,source_fingerprint:"e".repeat(64)}};
      await db.query("select ss_queue_items('analyze',$1)",[JSON.stringify([changed,changed])]);
      assert.equal((await db.query("select count(*) n from ss_jobs where payload->>'url'=$1",[url])).rows[0].n,1,"changed content queues exactly once");
      const claimed=(await db.query("select * from ss_claim_jobs(8)")).rows;
      assert(claimed.some(j=>j.payload.url===url),"core release is claimed before ordinary analyze backlog");
    });

    await t.test("internal review commits bind source identity, enforce due time, preserve history and deny client access",async()=>{
      await db.exec("reset role");
      const input={title:"Internal regression",scope:"publisher_excerpt",text:"The implementation configures KV cache offloading over NIXL with measured TTFT and throughput under concurrent GPU traffic."};
      const id=(await db.query("insert into ss_articles(url,title,content_hash,discovered_at,reference_meta) values('https://kubernetes.io/internal-regression','Internal regression',$1,now()-interval '25 hours',$2) returning id",["c".repeat(64),JSON.stringify({public_evaluation_input:input})])).rows[0].id;
      const assessment={topic:"Inference",decision:"useful",score:80,depth:"practical",confidence:"medium",summary:"Concrete cache configuration.",reason:"Concrete NIXL configuration and latency measurement.",action:"Review configuration assumptions.",evidence:"configures KV cache offloading over NIXL"};
      const item={id,content_hash:"c".repeat(64),captured_input:input,input,assessment,evaluator:"policy",completion_path:"sla_failover",facts:{first_party:true}};
      const commit=async x=>(await db.query("select ss_commit_internal_reviews($1) x",[JSON.stringify([x])])).rows[0].x;
      assert.equal((await commit({...item,content_hash:"d".repeat(64)})).skipped,1);
      assert.equal((await commit({...item,captured_input:{...input,text:"changed"}})).skipped,1);
      await fails(()=>commit({...item,assessment:{...assessment,evidence:"Invented source quote"}}),"grounded");
      assert.equal((await commit(item)).committed,1);assert.equal((await commit(item)).skipped,1,"completed review cannot be overwritten");
      assert.equal((await db.query("select count(*) n from ss_private.article_reviews where article_id=$1",[id])).rows[0].n,1);
      await db.query("update ss_articles set score=1 where id=$1",[id]);await as(owner);
      const feed=await action("feed",{mode:"archive",q:"Internal regression"});assert.equal(feed.items[0].score,80,"local score survives metadata/rules refresh");
      await fails(()=>commit(item),"permission denied");await fails(()=>db.query("select ss_internal_review_candidates(200)"),"permission denied");
      await db.exec("reset role");
      const missing=(await db.query("insert into ss_articles(url,title,discovered_at) values('https://kubernetes.io/missing-internal','No public input',now()-interval '25 hours') returning id")).rows[0].id;
      assert.equal((await commit({id:missing,content_hash:null,captured_input:null,input:null,assessment:{...assessment,decision:"insufficient_evidence",score:0,confidence:"low",depth:"unknown",evidence:""},evaluator:"policy"})).committed,1,"missing public inputs receive an explicit insufficient-evidence outcome");
      assert.equal((await db.query("select count(*)::int n from ss_articles where id=$1",[missing])).rows[0].n,0);
      assert.equal((await db.query("select count(*)::int n from ss_private.article_reviews where article_id=$1",[missing])).rows[0].n,0,"the local fallback does not retain a rejected audit snapshot");
      const fresh=(await db.query("insert into ss_articles(url,title,content_hash,reference_meta) values('https://example.com/fresh-internal','Fresh',$1,$2) returning id",["c".repeat(64),JSON.stringify({public_evaluation_input:{...input,scope:"search_snippet"}})])).rows[0].id;
      await fails(()=>commit({...item,id:fresh,input:{...input,scope:"search_snippet"},captured_input:{...input,scope:"search_snippet"}}),"not due");
      assert.equal((await commit({...item,id:fresh,input:{...input,scope:"search_snippet"},captured_input:{...input,scope:"search_snippet"},evaluator:"assistant"})).committed,1,"explicit personal backlog review may complete a fresh link");
    });

    await t.test("terminal rejection removes every dependent record and stale health writes cannot resurrect its data",async()=>{
      await db.exec("reset role");
      const url="https://github.com/purgetest/runtime";
      const accepted={...review,evaluator:"assistant",cache_key:"accepted-purge-fixture"};
      const id=(await db.query("insert into ss_articles(url,title,reference_meta) values($1,'Purge regression',$2) returning id",[url,JSON.stringify({repo_health:repoHealth,review_commit:"accepted-purge-fixture",evaluation:accepted})])).rows[0].id;
      assert.equal((await db.query("select review_state from ss_articles where id=$1",[id])).rows[0].review_state,"approved");
      await db.query("insert into ss_private.review_cohort(url) values($1)",[url]);
      const folder=(await db.query("insert into ss_folders(name,created_by) values('Purge regression folder',$1) returning id",[owner])).rows[0].id;
      await db.query("insert into ss_bookmarks(article_id,folder_id,created_by) values($1,$2,$3)",[id,folder,owner]);
      await db.query("insert into ss_feedback(article_id,user_id,liked) values($1,$2,true)",[id,owner]);
      const note=(await db.query("insert into ss_notes(article_id,user_id,body,visibility) values($1,$2,'Dependent note','team') returning id",[id,owner])).rows[0].id;
      await db.query("insert into ss_notes(article_id,user_id,body,visibility,parent_id) values($1,$2,'Dependent reply','team',$3)",[id,owner,note]);
      await db.query("insert into ss_audit(action,object_id) values('note_save',$1),('save',$2)",[note,id]);
      const request=(await db.query("insert into ss_private.evaluation_requests default values returning id")).rows[0].id;
      await db.query("insert into ss_private.evaluation_claims(article_id,cache_key,request_id) values($1,$2,$3)",[id,"f".repeat(64),request]);
      await db.query("insert into ss_private.evaluation_attempts(article_id,cache_key) values($1,$2)",[id,"f".repeat(64)]);
      for(const status of ["pending","running","done","failed"])
        await db.query("insert into ss_jobs(kind,status,payload) values('analyze',$1,$2)",[status,JSON.stringify({url,article_id:id,text:"Rejected source body"})]);
      const stale={comparisons:[{article_id:id,title:"Rejected source body",decision:"useful"}]};
      await db.query("insert into ss_settings(key,value) values('evaluation_health',$1),('repo_metadata:purgetest/runtime',$2),('repo_health:purgetest/runtime',$2) on conflict(key) do update set value=excluded.value",[JSON.stringify(stale),JSON.stringify({url,text:"Rejected source body"})]);
      const usage=(await db.query("select ss_evaluation_usage() x")).rows[0].x;
      await db.query("update ss_articles set reference_meta=reference_meta||$2 where id=$1",[id,JSON.stringify({review_commit:"rejected-purge-fixture",evaluation:{...accepted,cache_key:"rejected-purge-fixture",decision:"tangential"}})]);
      for(const table of ["ss_articles","ss_bookmarks","ss_notes","ss_feedback","ss_private.article_reviews","ss_private.evaluation_claims","ss_private.evaluation_attempts"])
        assert.equal((await db.query(`select count(*)::int n from ${table} where ${table==="ss_articles"?"id":"article_id"}=$1`,[id])).rows[0].n,0,`${table} contains no rejected-link record`);
      assert.equal((await db.query("select count(*)::int n from ss_jobs where payload->>'url'=$1",[url])).rows[0].n,0);
      assert.equal((await db.query("select count(*)::int n from ss_private.review_cohort where url=$1",[url])).rows[0].n,0);
      assert.equal((await db.query("select count(*)::int n from ss_audit where object_id in($1,$2)",[id,note])).rows[0].n,0);
      assert.equal((await db.query("select count(*)::int n from ss_settings where key like '%purgetest/runtime'")).rows[0].n,0);
      await db.query("update ss_settings set value=$1 where key='evaluation_health'",[JSON.stringify(stale)]);
      assert.deepEqual((await db.query("select value->'comparisons' x from ss_settings where key='evaluation_health'")).rows[0].x,[],"a stale evaluator snapshot cannot re-save the deleted title or assessment");
      assert.deepEqual((await db.query("select ss_evaluation_usage() x")).rows[0].x,usage,"deletion must not refund Google request quota");
      assert.equal((await db.query("select count(*)::int n from ss_private.evaluation_requests where id=$1",[request])).rows[0].n,1);
      await as(reader);await fails(()=>db.query("select ss_private.remove_article_dependents()"),"permission denied");
    });

    await t.test("stored link states follow source, retry, failure and review metadata without caller overrides",async()=>{
      await db.exec("reset role");
      const id=(await db.query("insert into ss_articles(url,title) values('https://kubernetes.io/state-regression','State regression') returning id")).rows[0].id;
      const state=async()=>(await db.query("select review_state from ss_articles where id=$1",[id])).rows[0]?.review_state;
      assert.equal(await state(),"awaiting_input");
      await db.query("update ss_articles set reference_meta='{\"public_evaluation_input\":{\"text\":\"Source body\"}}' where id=$1",[id]);assert.equal(await state(),"awaiting_evaluation");
      await db.query("update ss_articles set reference_meta=reference_meta||jsonb_build_object('evaluation_failed_at',now(),'evaluation_retry_at',now()+interval '5 minutes') where id=$1",[id]);assert.equal(await state(),"retry_wait");
      await db.query("update ss_articles set reference_meta=reference_meta-'evaluation_retry_at' where id=$1",[id]);assert.equal(await state(),"needs_attention");
      await db.query("update ss_articles set reference_meta=jsonb_build_object('evaluation',$2::jsonb) where id=$1",[id,JSON.stringify({...review,cache_key:"state-regression"})]);assert.equal(await state(),"approved");
      await fails(()=>db.query("update ss_articles set review_state='retry_wait' where id=$1",[id]),"can only be updated to DEFAULT");
      await db.query("update ss_articles set deleted_at=now() where id=$1",[id]);assert.equal(await state(),"archived");
      for(const assessment of [{...review,score:40},{...review,confidence:"low"},{...review,depth:"introductory"},{...review,evidence:""}]) {
        await db.query("insert into ss_articles(url,title,reference_meta) values('https://kubernetes.io/below-policy-regression','Below policy',$1)",[JSON.stringify({evaluation:assessment})]);
        assert.equal((await db.query("select count(*)::int n from ss_articles where url='https://kubernetes.io/below-policy-regression'")).rows[0].n,0,"useful labels do not bypass score, confidence, depth or evidence policy");
      }
      await db.query("insert into ss_articles(url,title,reference_meta) values('https://github.com/purgetest/unknown-health','Unknown health',$1)",[JSON.stringify({evaluation:review})]);
      assert.equal((await db.query("select count(*)::int n from ss_articles where url='https://github.com/purgetest/unknown-health'")).rows[0].n,0,"a useful label cannot bypass repository policy");
      const invalid=(await db.query("insert into ss_articles(url,title) values('https://kubernetes.io/invalid-terminal','Invalid terminal') returning id")).rows[0].id;
      await db.query("update ss_articles set reference_meta='{\"evaluation\":{}}' where id=$1",[invalid]);
      assert.equal((await db.query("select count(*)::int n from ss_articles where id=$1",[invalid])).rows[0].n,0,"a malformed terminal object cannot remain stored without making the cut");
    });

    await t.test("failed collection jobs keep their discovery clock and receive a model-free terminal review",async()=>{
      await db.exec("reset role");
      const body="The implementation configures KV cache offloading over NIXL with measured TTFT and throughput under concurrent GPU traffic.";
      const url="https://kubernetes.io/overdue-job-regression";
      const jobs=[{url,title:"Overdue captured source",text:body,kind:"Documentation"},{url:"https://kubernetes.io/overdue-empty-job",title:"Unavailable source"}];
      for(const payload of jobs)await db.query("insert into ss_jobs(kind,status,attempts,created_at,payload) values('article','failed',4,now()-interval '25 hours',$1)",[JSON.stringify(payload)]);
      await db.query("insert into ss_jobs(kind,status,locked_at,created_at,payload) values('article','running',now(),now()-interval '25 hours','{\"url\":\"https://kubernetes.io/inflight-regression\"}')");
      await db.query("insert into ss_jobs(kind,payload) values('article','{\"url\":\"https://kubernetes.io/fresh-job-regression\"}')");
      const result=(await db.query("select ss_promote_overdue_link_jobs(500) x")).rows[0].x;
      assert.equal(result.promoted,2);assert.equal(result.cleared,2);
      const rows=(await db.query("select * from ss_articles where url in($1,$2)",[jobs[0].url,jobs[1].url])).rows;
      assert.equal(rows.length,2);assert(rows.every(a=>Date.now()-Date.parse(a.discovered_at)>=24*3600000),"promotion cannot restart a failed link's 24-hour clock");
      assert.equal(rows.find(a=>a.url===url).reference_meta.public_evaluation_input.text,body);
      assert.equal((await db.query("select count(*)::int n from ss_jobs where payload->>'url' in($1,$2)",[jobs[0].url,jobs[1].url])).rows[0].n,0,"the failed payload is moved, not duplicated");
      const items=rows.map(a=>({id:a.id,content_hash:a.content_hash,captured_input:a.reference_meta.public_evaluation_input,input:a.reference_meta.public_evaluation_input,evaluator:"policy",assessment:a.url===url ? {topic:"Inference",decision:"useful",score:80,confidence:"medium",depth:"practical",summary:"Concrete cache operation.",reason:"Public implementation and measurements.",action:"Review configuration prerequisites.",evidence:"configures KV cache offloading over NIXL"} : {topic:"Inference",decision:"insufficient_evidence",score:0,confidence:"low",depth:"unknown",summary:"",reason:"Public source unavailable.",action:"",evidence:""}}));
      assert.equal((await db.query("select ss_commit_internal_reviews($1) x",[JSON.stringify(items)])).rows[0].x.committed,2);
      assert.equal((await db.query("select count(*)::int n from ss_articles where url=$1",[jobs[1].url])).rows[0].n,0);
      assert.equal((await db.query("select review_state from ss_articles where url=$1",[url])).rows[0].review_state,"approved");
      assert.equal((await db.query("select count(*)::int n from ss_jobs where payload->>'url' in('https://kubernetes.io/fresh-job-regression','https://kubernetes.io/inflight-regression')")).rows[0].n,2,"fresh and actively leased jobs are not stolen");
      await as(reader);await fails(()=>db.query("select ss_promote_overdue_link_jobs(500)"),"permission denied");
    });

    await t.test("legacy slash aliases preserve another retained article's history and cohort on cleanup",async()=>{
      await db.exec("reset role");
      const base='https://kubernetes.io/alias-regression';
      const first=(await db.query("insert into ss_articles(url,title,reference_meta) values($1,'Alias regression',$2) returning id",[base+'/',JSON.stringify({evaluation:{...review,cache_key:'alias-one'}})])).rows[0].id;
      const keeper=(await db.query("insert into ss_articles(url,title,reference_meta) values($1,'Alias regression',$2) returning id",[base,JSON.stringify({evaluation:{...review,cache_key:'alias-two'}})])).rows[0].id;
      await db.query("insert into ss_private.review_cohort(url) values($1)",[base+'/']);
      assert.equal((await db.query("select ss_private.gemini_new_link($1) x",[base])).rows[0].x,false,"canonical variants share the retained frozen cohort");
      await db.query("delete from ss_articles where id=$1",[first]);
      assert.equal((await db.query("select count(*)::int n from ss_private.article_reviews where article_id=$1",[keeper])).rows[0].n,1,"deleting an alias cannot erase a retained row's history");
      assert.equal((await db.query("select ss_private.gemini_new_link($1) x",[base])).rows[0].x,false);
      await db.query("delete from ss_articles where id=$1",[keeper]);
      assert.equal((await db.query("select ss_private.gemini_new_link($1) x",[base])).rows[0].x,true,"no identity remains when the last retained link is deleted");
    });

    console.log(
      "Verified: RLS, MFA gate, read-only restrictions, private notes, recursive title search, cycle prevention, trash/restore, confirmation, single-use invites, immediate revocation, bounded quotas, job leases.",
    );
  } finally {
    await db.close();
  }
});
