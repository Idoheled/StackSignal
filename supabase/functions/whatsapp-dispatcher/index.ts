import { dispatchEvents } from "../_shared/whatsapp-dispatch.ts";

const headers = { "content-type": "application/json", "cache-control": "no-store" };
const env = (name: string) => Deno.env.get(name) || "";
async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).join(",");
}
Deno.serve(async request => {
  if (request.method !== "POST" || !request.headers.get("x-whatsapp-dispatch-secret"))
    return new Response('{"error":"Unauthorized"}', { status: 401, headers });
  try {
    const supabaseURL = new URL(env("SUPABASE_URL"));
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseURL.protocol !== "https:" || !serviceKey) throw new Error("Database configuration missing");
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(supabaseURL.origin + "/rest/v1/rpc/" + name, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
        headers: { "content-type": "application/json", apikey: serviceKey, authorization: "Bearer " + serviceKey }, body: JSON.stringify(args),
      });
      if (!response.ok) throw new Error("Database RPC failed");
      return response.json();
    };
    const configuration = await rpc("ss_whatsapp_dispatch_configuration", {});
    const cronSecret = env("WHATSAPP_DISPATCH_SECRET") || configuration.whatsapp_dispatch_secret || "";
    if (cronSecret.length < 32 || await digest(request.headers.get("x-whatsapp-dispatch-secret") || "") !== await digest(cronSecret))
      return new Response('{"error":"Unauthorized"}', { status: 401, headers });
    const webhookURL = env("WHATSAPP_WEBHOOK_URL") || configuration.whatsapp_webhook_url;
    const secret = env("WHATSAPP_WEBHOOK_SECRET") || configuration.whatsapp_webhook_secret;
    const appOrigin = env("WHATSAPP_APP_ORIGIN") || configuration.whatsapp_app_origin;
    if (!webhookURL || !secret || !appOrigin) return new Response('{"error":"Dispatcher not configured"}', { status: 503, headers });
    return new Response(JSON.stringify({ ok: true, ...await dispatchEvents({ webhookURL, secret, appOrigin }, rpc) }), { headers });
  } catch { return new Response('{"error":"Dispatch failed; pending events retained"}', { status: 503, headers }); }
});
