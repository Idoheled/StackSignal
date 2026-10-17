// WebCrypto-only protocol, shared by Deno and the Node notification host.
export const MAX_EVENT_BYTES = 24_576;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
export type NotificationPayload = {
  version: 1; kind: "article_approved" | "github_release"; article_id: string;
  title: string; summary: string; why: string; evidence: string;
  topic: string; source: string; source_url: string;
  discovered_at: string; evaluated_at: string; ui_url: string;
};
export type NotificationEvent = { id: string; payload: NotificationPayload };
export type Receipt = { id: string; status: "queued" | "sent" | "uncertain"; message_id?: string };

export function validateEvent(value: unknown, appOrigin: string): NotificationEvent {
  const event = value as NotificationEvent;
  if (!event || typeof event !== "object" || !uuid.test(event.id)) throw new Error("Invalid event ID");
  const p = event.payload;
  if (!p || p.version !== 1 || !["article_approved", "github_release"].includes(p.kind) || !uuid.test(p.article_id))
    throw new Error("Invalid event payload");
  const bounds = { title: 500, summary: 1400, why: 700, evidence: 800, topic: 256, source: 500, source_url: 2048 };
  for (const [key, limit] of Object.entries(bounds)) {
    const field = p[key as keyof typeof bounds];
    if (field != null && (typeof field !== "string" || field.length > limit)) throw new Error("Invalid content field");
  }
  for (const date of [p.discovered_at, p.evaluated_at])
    if (typeof date !== "string" || !timestamp.test(date) || !Number.isFinite(Date.parse(date))) throw new Error("Invalid timestamp");
  const origin = new URL(appOrigin);
  if (origin.protocol !== "https:" || origin.origin !== appOrigin || origin.username || origin.password)
    throw new Error("Invalid platform origin");
  if (p.ui_url !== appOrigin + "/?article=" + p.article_id) throw new Error("Invalid platform link");
  return event;
}

const encoder = new TextEncoder();
async function key(secret: string, usage: "sign" | "verify") {
  if (!/^[0-9a-f]{64,128}$/i.test(secret)) throw new Error("Signing secret must contain at least 32 random bytes in hex");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}
function input(purpose: "event" | "receipt", body: string, time: string) {
  return encoder.encode("stacksignal-whatsapp-v1\n" + purpose + "\n" + time + "\n" + body);
}
export async function signedHeaders(secret: string, purpose: "event" | "receipt", body: string, now = Date.now()): Promise<Record<string, string>> {
  const time = String(Math.floor(now / 1000));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret, "sign"), input(purpose, body, time)));
  return { "x-stacksignal-time": time, "x-stacksignal-signature": Array.from(signature, x => x.toString(16).padStart(2, "0")).join("") };
}
export async function verifySignature(secret: string, purpose: "event" | "receipt", body: string, headers: Headers, now = Date.now()): Promise<boolean> {
  const time = headers.get("x-stacksignal-time") || "", signature = headers.get("x-stacksignal-signature") || "";
  if (!/^\d{10,12}$/.test(time) || !/^[0-9a-f]{64}$/i.test(signature) || Math.abs(now / 1000 - Number(time)) > 300) return false;
  const bytes = Uint8Array.from(signature.match(/../g)!, pair => parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", await key(secret, "verify"), bytes, input(purpose, body, time));
}
export function validateReceipt(value: unknown, id: string): Receipt {
  const r = value as Receipt;
  if (!r || r.id !== id || !["queued", "sent", "uncertain"].includes(r.status)) throw new Error("Invalid receipt");
  if (r.status === "sent" && (typeof r.message_id !== "string" || !r.message_id.trim() || r.message_id.length > 256)) throw new Error("Missing provider message ID");
  return r;
}
export async function readBoundedBody(response: Response | Request, max = MAX_EVENT_BYTES): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new Error("Body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
