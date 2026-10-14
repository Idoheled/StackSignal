import { readBoundedBody } from "./whatsapp-protocol.ts";

const encoder = new TextEncoder();
export async function ociHeaders(secret: string, body: string, now = Date.now(), response = false) {
  if (!/^[0-9a-f]{64}$/i.test(secret)) throw new Error("Invalid control secret");
  const timestamp = String(Math.floor(now / 1000));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode((response ? "response." : "") + timestamp + "." + body)));
  return { "x-stacksignal-timestamp": timestamp, "x-stacksignal-signature": "sha256=" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("") };
}
export async function verifyOCI(secret: string, body: string, headers: Headers, now = Date.now(), response = false) {
  const time = headers.get("x-stacksignal-timestamp") || "", sig = headers.get("x-stacksignal-signature") || "";
  if (!/^[0-9a-f]{64}$/i.test(secret) || !/^\d{10,12}$/.test(time) || !/^sha256=[0-9a-f]{64}$/i.test(sig) || Math.abs(now / 1000 - Number(time)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, Uint8Array.from(sig.slice(7).match(/../g)!, b => parseInt(b, 16)), encoder.encode((response ? "response." : "") + time + "." + body));
}
type Configuration = { oci_cron_control_secret?: string; oci_provisioner_github_pat?: string };
type RPC = (name: string, args: Record<string, unknown>) => Promise<any>;
type Notify = (state: any, token: string) => Promise<boolean>;
export async function handleOCIControl(request: Request, dependencies: { configuration: () => Promise<Configuration>; rpc: RPC; notify: Notify; now?: () => number }) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (request.method !== "POST" || (request.headers.get("content-type") || "").split(";")[0].trim() !== "application/json")
    return new Response('{"error":"JSON POST required"}', { status: 405, headers });
  const now = dependencies.now?.() ?? Date.now();
  const timestamp = request.headers.get("x-stacksignal-timestamp") || "";
  if (!/^\d{10,12}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !/^sha256=[0-9a-f]{64}$/i.test(request.headers.get("x-stacksignal-signature") || ""))
    return new Response('{"error":"Unauthorized"}', { status: 401, headers });
  let body: string;
  try { body = await readBoundedBody(request, 18_000); }
  catch { return new Response('{"error":"Invalid body"}', { status: 413, headers }); }
  let config: Configuration;
  try { config = await dependencies.configuration(); }
  catch { return new Response('{"error":"Control unavailable"}', { status: 503, headers }); }
  const secret = config.oci_cron_control_secret || "";
  if (!await verifyOCI(secret, body, request.headers, now)) return new Response('{"error":"Unauthorized"}', { status: 401, headers });
  try {
    const input = JSON.parse(body);
    const action = input.action;
    if (!["ping", "status", "lease", "renew", "checkpoint", "release", "stop_cron"].includes(action)) throw new Error("Unknown action");
    if (input.run_token != null && !/^[0-9a-f-]{36}$/i.test(input.run_token)) throw new Error("Invalid lease");
    let result = action === "ping" ? { ok: true, action: "ping" }
      : await dependencies.rpc("ss_oci_provisioner_control", { requested_action: action, run_token: input.run_token || null, input: input.input || {} });
    if (action === "checkpoint" && input.input?.webhook_url && result.status === "VM_ALLOCATED_INSTALLING")
      await dependencies.rpc("ss_whatsapp_stage_webhook", { webhook: result.webhook_url });
    if (action === "stop_cron" && result.status === "AWAITING_WHATSAPP_QR") {
      let sent = result.notification_status === "sent";
      if (!sent && config.oci_provisioner_github_pat) {
        try { sent = await dependencies.notify(result, config.oci_provisioner_github_pat); } catch { sent = false; }
        result = await dependencies.rpc("ss_oci_provisioner_control", { requested_action: "notification_result", run_token: null, input: { sent } });
      }
      result = { ...result, notification_sent: sent };
    }
    const response = JSON.stringify({ action, result });
    return new Response(response, { headers: { ...headers, ...await ociHeaders(secret, response, now, true) } });
  } catch {
    const response = JSON.stringify({ error: "Control action refused or temporarily unavailable" });
    return new Response(response, { status: 409, headers: { ...headers, ...await ociHeaders(secret, response, now, true) } });
  }
}
