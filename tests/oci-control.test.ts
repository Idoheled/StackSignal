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

test("deployed control adapter accepts an empty PostgREST staging response after allocation", async () => {
  const originalFetch=globalThis.fetch, originalDeno=(globalThis as any).Deno;
  let handler: (request: Request) => Promise<Response>;
  const calls: string[]=[];
  (globalThis as any).Deno={env:{get:(name: string)=>({SUPABASE_URL:"https://project.test",SUPABASE_SERVICE_ROLE_KEY:"service-key"})[name]},
    serve:(value: typeof handler)=>{handler=value;}};
  globalThis.fetch=async (url, options) => {
    const name=String(url).split("/").pop()!;
    calls.push(name);
    assert.equal(new Headers(options?.headers).get("authorization"),"Bearer service-key");
    if(name==="ss_oci_control_configuration") return new Response(JSON.stringify({oci_cron_control_secret:secret}));
    if(name==="ss_oci_provisioner_control") return new Response(JSON.stringify({status:"VM_ALLOCATED_INSTALLING",
      webhook_url:"https://stacksignal.82.70.223.24.sslip.io/v1/events"}));
    assert.equal(name,"ss_whatsapp_stage_webhook");
    return new Response(null,{status:204});
  };
  try {
    await import("../supabase/functions/oci-cron-control/index.ts");
    const body=JSON.stringify({action:"checkpoint",run_token:"00000000-0000-0000-0000-000000000001",
      input:{webhook_url:"https://stacksignal.82.70.223.24.sslip.io/v1/events"}});
    const response=await handler!(new Request("https://example.test/functions/v1/oci-cron-control",{
      method:"POST",headers:{"content-type":"application/json",...await ociHeaders(secret,body)},body}));
    const text=await response.text();
    assert.equal(response.status,200);
    assert.equal(await verifyOCI(secret,text,response.headers,Date.now(),true),true);
    assert.equal(JSON.parse(text).result.status,"VM_ALLOCATED_INSTALLING");
    assert.deepEqual(calls,["ss_oci_control_configuration","ss_oci_provisioner_control","ss_whatsapp_stage_webhook"]);
  } finally {globalThis.fetch=originalFetch;(globalThis as any).Deno=originalDeno;}
});
