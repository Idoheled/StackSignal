import { handleOCIControl } from "../_shared/oci-control.ts";
const env = (name: string) => Deno.env.get(name) || "";
const url = env("SUPABASE_URL"), serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const rpc = async (name: string, args: Record<string, unknown>) => {
  const response = await fetch(url + "/rest/v1/rpc/" + name, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
    headers: { apikey: serviceKey, authorization: "Bearer " + serviceKey, "content-type": "application/json" }, body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error("Control database unavailable");
  // PostgREST returns an empty 204 for the staging RPC's void result.
  const body = await response.text();
  return body ? JSON.parse(body) : null;
};
const notify = async (state: any, token: string) => {
  const endpoint = "https://api.github.com/repos/Idoheled/StackSignal/issues/4/comments";
  const headers = { authorization: "Bearer " + token, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2026-03-10" };
  const marker = "<!-- stacksignal-oci-qr-ready -->";
  const list = await fetch(endpoint + "?per_page=100", { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!list.ok) return false;
  if ((await list.json()).some((x: any) => typeof x.body === "string" && x.body.includes(marker))) return true;
  const body = `@Idoheled **HOST READY — WHATSAPP QR SCAN REQUIRED**\n\n` +
    `Oracle ARM host: ${state.instance_ocid}; ${state.shape_allocated}; region il-jerusalem-1.\n` +
    `HTTPS process/model setup checks passed. WhatsApp is awaiting pairing; alerts remain disabled. The capacity cron is stopped.\n\n` +
    `To open the secure QR terminal:\n1. Sign into your Supabase project dashboard and open SQL Editor. Retrieve only your administration key with ` +
    '`select decrypted_secret from vault.decrypted_secrets where name=\'oci_ssh_admin_private_key\';`' +
    ` Save it locally as a private SSH key, then run ` + '`chmod 600 stacksignal_ed25519`.' +
    `\n2. Verify the host fingerprint ${state.manifest.host_fingerprint || "from the protected provisioning state"}, then connect with ` +
    '`ssh -i stacksignal_ed25519 ubuntu@' + state.public_ip + '`.' +
    ` Before connecting, open Oracle Console → Networking → Virtual Cloud Networks → stacksignal-whatsapp → Security Lists → stacksignal-whatsapp → Add Ingress Rules. Set source to your current public IPv4 followed by /32, protocol TCP, destination port 22, then save. The runner's temporary SSH ingress was removed after setup.\n` +
    `3. Run ` + '`sudo -u stacksignal env PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin OPENCLAW_STATE_DIR=/var/lib/stacksignal-bot/openclaw OPENCLAW_CONFIG_PATH=/var/lib/stacksignal-bot/openclaw/openclaw.json /opt/node/bin/openclaw channels login --channel whatsapp`.' +
    `\n4. On your intended phone/account: WhatsApp → Linked devices → Link a device → scan the live QR.\n` +
    `5. Reply after pairing so the exact destination group can be verified and the first article/release test receipts checked.\n\n` + marker;
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ body }), redirect: "error", signal: AbortSignal.timeout(15_000) });
  return response.ok;
};
Deno.serve(request => handleOCIControl(request, { configuration: () => rpc("ss_oci_control_configuration", {}), rpc, notify }));
