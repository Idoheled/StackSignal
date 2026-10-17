import { MAX_EVENT_BYTES, readBoundedBody, signedHeaders, validateEvent, validateReceipt, verifySignature } from "./whatsapp-protocol.ts";

type ClaimedEvent = { id: string; lease_id: string; payload: unknown };
export type DispatchConfig = { webhookURL: string; secret: string; appOrigin: string };
export type RPC = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export function validateDispatchConfig(config: DispatchConfig) {
  const url = new URL(config.webhookURL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/v1/events" || (url.port && url.port !== "443"))
    throw new Error("Webhook must be the HTTPS /v1/events endpoint");
  if (!/^[0-9a-f]{64,128}$/i.test(config.secret)) throw new Error("Invalid signing secret");
}
export async function dispatchEvents(config: DispatchConfig, rpc: RPC, send: typeof fetch = fetch) {
  validateDispatchConfig(config);
  const events = await rpc("ss_whatsapp_claim_events", { batch_size: 5 }) as ClaimedEvent[];
  if (!Array.isArray(events)) throw new Error("Invalid claim response");
  const counts = { queued: 0, sent: 0, uncertain: 0, retry: 0 };
  for (const event of events) {
    let outcome: keyof typeof counts = "retry", message_id: string | null = null;
    try {
      const valid = validateEvent({ id: event.id, payload: event.payload }, config.appOrigin);
      const body = JSON.stringify(valid);
      if (new TextEncoder().encode(body).length > MAX_EVENT_BYTES) throw new Error("Event too large");
      const response = await send(config.webhookURL, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000), body,
        headers: { "content-type": "application/json", ...await signedHeaders(config.secret, "event", body) },
      });
      const receiptBody = await readBoundedBody(response, 2048);
      if (![200, 202, 409].includes(response.status) || !await verifySignature(config.secret, "receipt", receiptBody, response.headers)) throw new Error("Unverified response");
      const receipt = validateReceipt(JSON.parse(receiptBody), event.id);
      if (response.status === 409 && receipt.status !== "uncertain") throw new Error("Invalid conflict receipt");
      outcome = receipt.status; message_id = receipt.message_id || null;
    } catch { /* A lost response only retries the immutable event ID; the host owns send deduplication. */ }
    const finished = await rpc("ss_whatsapp_finish_event", { event_id: event.id, expected_lease: event.lease_id, outcome, message_id });
    if (finished === true) counts[outcome]++;
  }
  return counts;
}
