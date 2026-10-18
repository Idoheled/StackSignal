import { MAX_EVENT_BYTES, readBoundedBody, signedHeaders, validateEvent, validateOpsEvent, verifySignature } from "../supabase/functions/_shared/whatsapp-protocol.ts";

export async function handleWebhook(request, { store, secret, appOrigin, now = Date.now, deliveryEnabled = true, statusProvider } = {}) {
  const url = new URL(request.url);
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (request.method === "GET" && url.pathname === "/healthz") return new Response(JSON.stringify({ ok: true, delivery_enabled: deliveryEnabled }), { headers });
  if (request.method !== "POST" || !['/v1/events','/v1/ops','/v1/status'].includes(url.pathname) || url.search) return new Response('{"error":"Not found"}', { status: 404, headers });
  if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json")
    return new Response('{"error":"JSON required"}', { status: 415, headers });
  let body;
  try { body = await readBoundedBody(request, MAX_EVENT_BYTES); }
  catch { return new Response('{"error":"Invalid body"}', { status: 413, headers }); }
  const purpose=url.pathname==='/v1/status'?'ops-status':url.pathname==='/v1/ops'?'ops-event':'event';
  if (!await verifySignature(secret, purpose, body, request.headers, now())) return new Response('{"error":"Unauthorized"}', { status: 401, headers });
  if(url.pathname==='/v1/status'){
    if(!statusProvider || body!=='{"operation":"status"}')return new Response('{"error":"Invalid status request"}',{status:400,headers});
    const out=JSON.stringify(await statusProvider());
    return new Response(out,{headers:{...headers,...await signedHeaders(secret,'ops-receipt',out,now())}});
  }
  if (!deliveryEnabled) return new Response('{"error":"Awaiting verified WhatsApp destination"}', { status: 503, headers });
  let event;
  try { event = url.pathname==='/v1/ops'?validateOpsEvent(JSON.parse(body),appOrigin):validateEvent(JSON.parse(body), appOrigin); }
  catch { return new Response('{"error":"Invalid event"}', { status: 400, headers }); }
  try {
    const { conflict, receipt } = store.accept(event, now());
    const result = JSON.stringify(receipt);
    return new Response(result, { status: conflict ? 409 : receipt.status === "queued" ? 202 : 200,
      headers: { ...headers, ...await signedHeaders(secret, "receipt", result, now()) } });
  } catch { return new Response('{"error":"Queue unavailable"}', { status: 503, headers }); }
}
