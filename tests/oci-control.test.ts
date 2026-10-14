import test from "node:test";
import assert from "node:assert/strict";
import { handleOCIControl, ociHeaders, verifyOCI } from "../supabase/functions/_shared/oci-control.ts";
const secret = "cd".repeat(32), now = Date.parse("2026-10-14T17:00:00Z");
test("OCI webhook authenticates exact bodies/time, separates replies and keeps dry runs inert", async () => {
  let writes = 0, notices = 0;
  const dependencies = { configuration: async () => ({ oci_cron_control_secret: secret }),
    rpc: async () => { writes++; return {}; }, notify: async () => { notices++; return true; }, now: () => now };
  const body = JSON.stringify({ action: "ping" }), headers = await ociHeaders(secret, body, now);
  const request = (text: string, h: Record<string, string>) => new Request("https://example.test/functions/v1/oci-cron-control", { method: "POST", headers: { "content-type": "application/json", ...h }, body: text });
  assert.equal((await handleOCIControl(request(body, {}), dependencies)).status, 401);
  assert.equal((await handleOCIControl(request(body + " ", headers), dependencies)).status, 401);
  assert.equal((await handleOCIControl(request(body, await ociHeaders(secret, body, now - 301_000)), dependencies)).status, 401);
  const response = await handleOCIControl(request(body, headers), dependencies), text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(await verifyOCI(secret, text, response.headers, now, true), true);
  assert.equal(await verifyOCI(secret, text, response.headers, now, false), false);
  assert.deepEqual(JSON.parse(text), { action: "ping", result: { ok: true, action: "ping" } });
  assert.equal(writes, 0); assert.equal(notices, 0);
});
