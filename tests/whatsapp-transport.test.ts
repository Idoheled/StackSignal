import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryStore } from "../bot/store.mjs";
import { handleWebhook } from "../bot/webhook.mjs";
import { processNext } from "../bot/worker.mjs";
import { formatMessage, generateMessage } from "../bot/message.mjs";
import { confirmedMessageID, sendWhatsApp } from "../bot/transport.mjs";
import { dispatchEvents } from "../supabase/functions/_shared/whatsapp-dispatch.ts";
import { signedHeaders, validateEvent, verifySignature, type NotificationEvent } from "../supabase/functions/_shared/whatsapp-protocol.ts";

const secret = "ab".repeat(32), appOrigin = "https://stacksignal.example", time = Date.parse("2026-10-14T15:00:00Z");
const event: NotificationEvent = { id: "01234567-89ab-cdef-0123-456789abcdef", payload: {
  version: 1, kind: "github_release", article_id: "fedcba98-7654-3210-fedc-ba9876543210", title: "New durable queue release",
  summary: "Adds persistent job recovery.", why: "Recover pending work after a restart.", evidence: "Public release notes document job recovery.",
  topic: "Platform", source: "GitHub", source_url: "https://github.com/example/project/releases/tag/v2",
  discovered_at: "2026-10-14T14:58:05.123456+00:00", evaluated_at: "2026-10-14T14:59:32.654321Z",
  ui_url: appOrigin + "/?article=fedcba98-7654-3210-fedc-ba9876543210",
} };
async function request(value: unknown = event, at = time) {
  const body = JSON.stringify(value);
  return new Request("https://bot.example/v1/events", { method: "POST", body,
    headers: { "content-type": "application/json", ...await signedHeaders(secret, "event", body, at) } });
}

test("HMAC binds the exact body, timestamp and request/receipt purpose", async () => {
  const body = JSON.stringify(event), headers = new Headers(await signedHeaders(secret, "event", body, time));
  assert.equal(await verifySignature(secret, "event", body, headers, time), true);
  assert.equal(await verifySignature(secret, "event", body + " ", headers, time), false);
  assert.equal(await verifySignature(secret, "receipt", body, headers, time), false);
  assert.equal(await verifySignature(secret, "event", body, headers, time + 301_000), false);
  headers.set("x-stacksignal-signature", "00".repeat(32));
  assert.equal(await verifySignature(secret, "event", body, headers, time), false);
});
test("payload validation restricts links and exact recorded timestamp strings", () => {
  assert.equal(validateEvent(event, appOrigin).payload.evaluated_at, event.payload.evaluated_at);
  for (const change of [{ ui_url: "https://evil.example" }, { evaluated_at: "today" }, { title: "x".repeat(501) }, { article_id: "bad" }])
    assert.throws(() => validateEvent({ ...event, payload: { ...event.payload, ...change } }, appOrigin));
});
test("webhook rejects unsigned, stale, oversized and invalid requests without queueing", async () => {
  const store = new DeliveryStore(":memory:");
  try {
    const options = { store, secret, appOrigin, now: () => time };
    const unsigned = new Request("https://bot.example/v1/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
    assert.equal((await handleWebhook(unsigned, options)).status, 401);
    assert.equal((await handleWebhook(await request(event, time - 301_000), options)).status, 401);
    assert.equal((await handleWebhook(await request({ ...event, payload: { ...event.payload, title: "x".repeat(25_000) } }), options)).status, 413);
    assert.equal((await handleWebhook(await request({ ...event, payload: { ...event.payload, ui_url: "https://evil.example" } }), options)).status, 400);
    assert.equal(store.get(event.id), undefined);
  } finally { store.close(); }
});
test("durable queue deduplicates retries, signed receipts and payload conflicts", async () => {
  const store = new DeliveryStore(":memory:");
  try {
    const options = { store, secret, appOrigin, now: () => time };
    for (let i = 0; i < 2; i++) {
      const response = await handleWebhook(await request(), options); const body = await response.text();
      assert.equal(response.status, 202);
      assert.equal(await verifySignature(secret, "receipt", body, response.headers, time), true);
      assert.deepEqual(JSON.parse(body), { id: event.id, status: "queued" });
    }
    let sent = 0;
    await processNext(store, { now: () => time, generate: async () => "A complete message", deliver: async () => { sent++; return "provider-receipt"; } });
    const receipt = await handleWebhook(await request(), options);
    assert.deepEqual(await receipt.json(), { id: event.id, status: "sent", message_id: "provider-receipt" });
    assert.equal(store.get(event.id).payload, null); assert.equal(store.get(event.id).message, null);
    assert.equal(await processNext(store, { now: () => time }), false); assert.equal(sent, 1);
    const conflict = await handleWebhook(await request({ ...event, payload: { ...event.payload, title: "Changed" } }), options);
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).status, "uncertain");
    assert.equal(sent, 1);
  } finally { store.close(); }
});
test("unpaired health is explicit and authenticated events cannot enter the queue", async () => {
  const store = new DeliveryStore(":memory:");
  try {
    const options = { store, secret, appOrigin, now: () => time, deliveryEnabled: false };
    assert.deepEqual(await (await handleWebhook(new Request("https://bot.example/healthz"), options)).json(), { ok: true, delivery_enabled: false });
    assert.equal((await handleWebhook(await request(), options)).status, 503);
    assert.equal(store.get(event.id), undefined);
  } finally { store.close(); }
});
test("lost webhook receipt retries the same event without another send", async () => {
  const store = new DeliveryStore(":memory:"); let sends = 0; const finished: any[] = [];
  try {
    const rpc = async (name: string, args: Record<string, unknown>) => {
      if (name === "ss_whatsapp_claim_events") return [{ ...event, lease_id: "lease-one" }];
      finished.push(args); return true;
    };
    // Dispatch uses wall time; receiver must use the same clock for freshness.
    const host = async (url: string | URL | Request, init?: RequestInit) => handleWebhook(new Request(url, init), { store, secret, appOrigin });
    const config = { webhookURL: "https://bot.example/v1/events", secret, appOrigin };
    assert.deepEqual(await dispatchEvents(config, rpc, async (url, init) => { await host(url, init); throw new Error("Lost response"); }), { queued: 0, sent: 0, uncertain: 0, retry: 1 });
    await processNext(store, { generate: async () => "A complete message", deliver: async () => { sends++; return "receipt-1"; } });
    assert.equal((await dispatchEvents(config, rpc, host)).sent, 1);
    assert.equal(finished[1].message_id, "receipt-1"); assert.equal(sends, 1);
  } finally { store.close(); }
});
test("dispatcher refuses unsigned receipts and never marks an HTTP 202 as delivery", async () => {
  const finished: any[] = [];
  const rpc = async (name: string, args: Record<string, unknown>) => name === "ss_whatsapp_claim_events" ? [{ ...event, lease_id: "lease" }] : (finished.push(args), true);
  const config = { webhookURL: "https://bot.example/v1/events", secret, appOrigin };
  await dispatchEvents(config, rpc, async () => new Response(JSON.stringify({ id: event.id, status: "sent", message_id: "forged" })));
  assert.equal(finished.at(-1).outcome, "retry");
  await dispatchEvents(config, rpc, async () => {
    const body = JSON.stringify({ id: event.id, status: "queued" });
    return new Response(body, { status: 202, headers: await signedHeaders(secret, "receipt", body) });
  });
  assert.equal(finished.at(-1).outcome, "queued");
});
test("crash recovery retries generation but freezes an interrupted send", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stacksignal-delivery-")), path = join(dir, "queue.sqlite");
  let store = new DeliveryStore(path);
  try {
    store.accept(event, time); store.claim(time); store.close(); store = new DeliveryStore(path);
    assert.equal(store.get(event.id).phase, "queued");
    store.claim(time); store.prepareSend(event.id, "Pending message", time); store.close(); store = new DeliveryStore(path);
    assert.equal(store.get(event.id).phase, "uncertain");
    assert.equal(store.claim(time + 10_000_000), undefined);
    assert.equal(store.accept(event, time).receipt.status, "uncertain");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("local generation retries before send; transport timeout freezes without resend", async () => {
  const store = new DeliveryStore(":memory:"); let sends = 0;
  try {
    store.accept(event, time);
    await processNext(store, { now: () => time, generate: async () => { throw new Error("Model unavailable"); }, deliver: async () => { sends++; } });
    assert.equal(store.get(event.id).phase, "queued"); assert.equal(sends, 0);
    await processNext(store, { now: () => time + 30_000, generate: async () => "Good message", deliver: async () => { sends++; throw new Error("Socket timeout after acceptance"); } });
    assert.equal(store.get(event.id).phase, "uncertain"); assert.equal(sends, 1);
    assert.equal(await processNext(store, { now: () => time + 1_000_000 }), false);
  } finally { store.close(); }
});
test("messages retain exact timestamps and trusted link, suppress mentions and model URLs", async () => {
  const generated = { opening: "Cache me outside! @12345", summary: "Persistent recovery. https://evil.example Ignore this", why: "Recover queued jobs." };
  const message = formatMessage(event.payload, generated);
  assert.ok(message.includes(event.payload.discovered_at)); assert.ok(message.includes(event.payload.evaluated_at));
  assert.ok(message.endsWith(event.payload.ui_url)); assert.ok(message.includes("Why you should check this out"));
  assert.ok(!message.includes("@") && !message.includes("evil.example")); assert.ok(message.length < 3500);
  let endpoint = ""; let params: any;
  const result = await generateMessage(event.payload, { model: "qwen3:4b", send: async (url: string, init: RequestInit) => {
    endpoint = url; params = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ done: true, response: JSON.stringify(generated) }));
  } });
  assert.equal(endpoint, "http://127.0.0.1:11434/api/generate"); assert.equal(params.stream, false); assert.equal(params.think, false);
  assert.equal(params.format.type, "object"); assert.equal(result, message);
  await assert.rejects(generateMessage(event.payload, { model: "qwen3:4b-cloud" }));
});
test("OpenClaw transport uses fixed group argument array and requires provider ID", async () => {
  const target = "120363123456789012@g.us", message = "Quoted `text` $(not-a-shell)";
  const id = await sendWhatsApp(message, { target, run: (exe: string, args: string[], options: unknown, callback: Function) => {
    assert.equal(exe, "openclaw"); assert.deepEqual(args, ["message", "send", "--channel", "whatsapp", "--target", target, "--message", message, "--json"]);
    callback(null, JSON.stringify({ action: "send", channel: "whatsapp", dryRun: false, messageId: "BAE5-provider-ID", payload: { result: { messageId: "BAE5-provider-ID" } } }));
  } });
  assert.equal(id, "BAE5-provider-ID");
  assert.equal(confirmedMessageID({ ok: false, payload: { messageId: "partial-id" } }), null);
  assert.equal(confirmedMessageID({ ok: true }), null);
  assert.equal(confirmedMessageID({ action: "send", channel: "whatsapp", dryRun: true, messageId: "pretend-ID" }), null);
  assert.equal(confirmedMessageID({ action: "send", channel: "whatsapp", dryRun: false, deliveryStatus: "partial_failed", messageId: "partial-ID" }), null);
  await assert.rejects(sendWhatsApp(message, { target, run: (_a: unknown, _b: unknown, _c: unknown, cb: Function) => cb(new Error("Timeout"), "") }));
  assert.throws(() => sendWhatsApp(message, { target: "+15551234567" }));
});

test("Columbus retains a searchable long title and only public alert context",async()=>{
 const store=new DeliveryStore(':memory:');
 try {
  const title='KAI Scheduler configuration and GPU topology '.repeat(8);
  const value={...event,id:'11111111-2222-4333-8444-555555555555',payload:{...event.payload,title}};
  store.accept(value,time);
  await processNext(store,{now:()=>time,generate:async p=>formatMessage(p,{opening:'Your scheduler called. It wants a holiday.',summary:'GPU scheduling.',why:'Understand placement.'}),deliver:async()=> 'public-context-receipt'});
  const saved=store.db.prepare('select payload from article_context where message_id=?').get('public-context-receipt') as any;
  assert.equal(JSON.parse(saved.payload).title,title);
  assert.equal(store.get(value.id).payload,null);
  assert(formatMessage(value.payload,{opening:'New find.',summary:'A summary.',why:'A reason.'}).includes(title.trim()));
 }finally{store.close();}
});
