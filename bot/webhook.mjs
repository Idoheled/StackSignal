import { MAX_EVENT_BYTES, readBoundedBody, signedHeaders, validateEvent, verifySignature } from "../supabase/functions/_shared/whatsapp-protocol.ts";

export async function handleWebhook(request, { store, secret, appOrigin, now = Date.now } = {}) {
  const url = new URL(request.url);
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (request.method === "GET" && url.pathname === "/healthz") return new Response('{"ok":true}', { headers });
  if (request.method !== "POST" || url.pathname !== "/v1/events" || url.search) return new Response('{"error":"Not found"}', { status: 404, headers });
  if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json")
    return new Response('{"error":"JSON required"}', { status: 415, headers });
  let body;
  try { body = await readBoundedBody(request, MAX_EVENT_BYTES); }
  catch { return new Response('{"error":"Invalid body"}', { status: 413, headers }); }
  if (!await verifySignature(secret, "event", body, request.headers, now())) return new Response('{"error":"Unauthorized"}', { status: 401, headers });
  let event;
  try { event = validateEvent(JSON.parse(body), appOrigin); }
  catch { return new Response('{"error":"Invalid event"}', { status: 400, headers }); }
  try {
    const { conflict, receipt } = store.accept(event, now());
    const result = JSON.stringify(receipt);
    return new Response(result, { status: conflict ? 409 : receipt.status === "queued" ? 202 : 200,
      headers: { ...headers, ...await signedHeaders(secret, "receipt", result, now()) } });
  } catch { return new Response('{"error":"Queue unavailable"}', { status: 503, headers }); }
}
