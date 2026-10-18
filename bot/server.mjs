import { createServer } from "node:http";
import { join } from "node:path";
import { DeliveryStore } from "./store.mjs";
import { handleWebhook } from "./webhook.mjs";
import { generateMessage } from "./message.mjs";
import { sendWhatsApp } from "./transport.mjs";
import { processNext } from "./worker.mjs";
import { MAX_EVENT_BYTES, validateEvent } from "../supabase/functions/_shared/whatsapp-protocol.ts";

process.umask(0o077);
const secret = process.env.WHATSAPP_WEBHOOK_SECRET || "", appOrigin = process.env.WHATSAPP_APP_ORIGIN || "";
const target = process.env.WHATSAPP_GROUP_JID || "", model = process.env.OLLAMA_MODEL || "qwen3:4b";
const state = process.env.WHATSAPP_STATE_DIR || "/var/lib/stacksignal-bot";
if (!/^[0-9a-f]{64,128}$/i.test(secret) || (target && !/^\d{5,30}(?:-\d{5,20})?@g\.us$/.test(target))) throw new Error("Bot configuration incomplete");
// Validate configured origin before listening, without logging configuration.
validateEvent({ id: "00000000-0000-0000-0000-000000000000", payload: { version: 1, kind: "article_approved", article_id: "00000000-0000-0000-0000-000000000000", discovered_at: "2026-01-01T00:00:00Z", evaluated_at: "2026-01-01T00:00:00Z", ui_url: appOrigin + "/?article=00000000-0000-0000-0000-000000000000" } }, appOrigin);
const store = new DeliveryStore(join(state, "deliveries.sqlite"));
const server = createServer(async (req, res) => {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_EVENT_BYTES) { res.writeHead(413); res.end(); return; }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    const response = await handleWebhook(new Request("http://127.0.0.1:8787" + req.url, {
      method: req.method, headers: req.headers,
      ...(req.method !== "GET" && req.method !== "HEAD" ? { body } : {}),
    }), { store, secret, appOrigin, deliveryEnabled: Boolean(target) });
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  } catch { res.writeHead(500); res.end('{"error":"Request failed"}'); }
});
server.requestTimeout = 15_000; server.headersTimeout = 10_000;
server.listen(8787, "127.0.0.1", () => console.log(JSON.stringify({ event: "webhook_listening" })));
let stopping = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const loop = (async () => {
  while (!stopping) {
    if (!target) { await delay(1000); continue; }
    try {
      const processed = await processNext(store, { generate: payload => generateMessage(payload, { model }),
        deliver: message => sendWhatsApp(message, { target }) });
      await delay(processed ? 10_000 : 1000);
    } catch { console.error(JSON.stringify({ event: "worker_error" })); await delay(5000); }
  }
})();
async function stop() {
  if (stopping) return;
  stopping = true; server.close(); await loop; store.close();
}
process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
