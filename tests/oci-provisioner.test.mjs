import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

test("OCI control isolates state, fences leases, preserves launch identity and stops only its cron", async t => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const sha = "a".repeat(40), instance = "ocid1.instance.oc1.il-jerusalem-1.example";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema ss_private;
      create schema cron; create table cron.job(jobid bigint primary key,jobname text);
      insert into cron.job values(1,'stacksignal-collector'),(2,'stacksignal-evaluator'),(3,'stacksignal-oci-hourly-claim');
      create function cron.unschedule(bigint) returns boolean language sql as $$with d as(delete from cron.job where jobid=$1 returning *) select exists(select 1 from d)$$;`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261014170446_oci_capacity_provisioner.sql", import.meta.url), "utf8"));
    const call = async (action, token = null, input = {}) => (await db.query("select ss_oci_provisioner_control($1,$2,$3) value", [action, token, JSON.stringify(input)])).rows[0].value;
    await t.test("anonymous and members cannot access state or privileged RPCs", async () => {
      for (const role of ["anon", "authenticated"]) {
        await db.exec("set role " + role);
        await assert.rejects(db.query("select * from oci_provisioner_state"), /permission denied/);
        await assert.rejects(call("lease", null, { runner_id: "one", commit_sha: sha }), /permission denied/);
        await assert.rejects(db.query("select ss_oci_control_configuration()"), /permission denied/);
        await db.exec("reset role");
      }
    });
    assert.equal((await call("lease", null, { runner_id: "one", commit_sha: sha })).acquired, false);
    await db.query("update oci_provisioner_state set cron_enabled=true,approved_sha=$1", [sha]);
    assert.equal((await call("lease", null, { runner_id: "one", commit_sha: "b".repeat(40) })).reason, "unverified_revision");
    const first = await call("lease", null, { runner_id: "one", commit_sha: sha });
    const token = first.state.lease_id, manifest = first.state.manifest;
    assert.equal(first.acquired, true);
    assert.equal((await call("lease", null, { runner_id: "two", commit_sha: sha })).acquired, false);
    await assert.rejects(call("checkpoint", "00000000-0000-0000-0000-000000000000", { status: "LAUNCH_IN_FLIGHT" }), /Lease lost/);
    await assert.rejects(call("checkpoint", token, { manifest: { ...manifest, deployment: "different" } }), /identity cannot change/);
    await call("checkpoint", token, { status: "LAUNCH_IN_FLIGHT", manifest: { ...manifest, launch_request: { ocpus: 2, memory_gb: 12 } } });
    await call("release", token, { status: "LAUNCH_IN_FLIGHT" });
    const second = await call("lease", null, { runner_id: "two", commit_sha: sha });
    assert.equal(second.state.status, "LAUNCH_IN_FLIGHT");
    assert.equal(second.state.manifest.launch_token, manifest.launch_token);
    await assert.rejects(call("renew", token), /Lease lost/);
    const secondToken = second.state.lease_id;
    await call("checkpoint", secondToken, { status: "VM_ALLOCATED_INSTALLING", instance_ocid: instance, public_ip: "198.51.100.8", webhook_url: "https://stacksignal.198.51.100.8.sslip.io/v1/events" });
    await assert.rejects(call("checkpoint", secondToken, { status: "SEARCHING_CAPACITY" }), /Invalid state transition|cannot change/);
    await assert.rejects(call("checkpoint", secondToken, { instance_ocid: "ocid1.instance.oc1.il-jerusalem-1.second" }), /cannot change/);
    await assert.rejects(call("stop_cron", secondToken), /readiness incomplete/);
    await call("checkpoint", secondToken, { manifest: { ...manifest, ready: { bootstrap: true, https: true } } });
    await assert.rejects(call("stop_cron", secondToken), /readiness incomplete/);
    await call("checkpoint", secondToken, { manifest: { ...manifest, ready: { bootstrap: true, https: true, ollama: true } } });
    const stopped = await call("stop_cron", secondToken);
    assert.equal(stopped.status, "AWAITING_WHATSAPP_QR"); assert.equal(stopped.cron_enabled, false);
    assert.deepEqual((await db.query("select jobname from cron.job order by jobid")).rows.map(x => x.jobname), ["stacksignal-collector", "stacksignal-evaluator"]);
    assert.equal((await call("stop_cron", secondToken)).status, "AWAITING_WHATSAPP_QR");
    assert.equal((await call("lease", null, { runner_id: "three", commit_sha: sha })).acquired, false);
    await t.test("dormant dispatcher cannot enqueue workflows after QR handoff", async () => {
      const before = await call("status");
      // Vault/net do not exist in this fixture: reaching either would fail.
      // The disabled-state guard must return before reading a token or HTTP POST.
      assert.equal((await db.query("select ss_private.oci_hourly_dispatch() value")).rows[0].value, null);
      assert.deepEqual(await call("status"), before);
      assert.deepEqual((await db.query("select jobname from cron.job order by jobid")).rows.map(x => x.jobname), ["stacksignal-collector", "stacksignal-evaluator"]);
    });
  } finally { await db.close(); }
});
