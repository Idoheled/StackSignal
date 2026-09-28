import { canonicalLink } from "../links.ts";
// Shared between the Worker and security tests. No application secrets are embedded here.
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function bytesToBase64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
export function base64ToBytes(s: string) {
  return Uint8Array.from(
    atob(s.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
export async function sha256(s: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function randomToken() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
}
export async function seal(data: unknown, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(secret),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode("StackSignal.session.v1"),
      },
      key,
      new TextEncoder().encode(JSON.stringify(data)),
    ),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(encrypted)}`;
}
export async function unseal<T>(
  value: string,
  secret: string,
): Promise<T | null> {
  try {
    const [a, b] = value.split(".");
    if (!a || !b || value.length > 10000) return null;
    const key = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(secret),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(a),
        additionalData: new TextEncoder().encode("StackSignal.session.v1"),
      },
      key,
      base64ToBytes(b),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(
      new TextDecoder().decode(base64ToBytes(token.split(".")[1])),
    );
  } catch {
    throw new HttpError(401, "Please sign in again.");
  }
}
export function validateOrigin(request: Request, origin: string) {
  if (!origin || request.headers.get("origin") !== origin)
    throw new HttpError(403, "Request origin rejected.");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new HttpError(403, "Cross-site request rejected.");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "JSON request required.");
}
export async function boundedJSON(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 32768)
    throw new HttpError(413, "Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) return {};
  let n = 0,
    text = "";
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > 32768) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
export function publicHttpsURL(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HttpError(400, "Enter a valid HTTPS link.");
  }
  const h = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    h === "localhost" ||
    !h.includes(".") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".localhost") ||
    h.endsWith(".invalid") ||
    h.endsWith(".test") ||
    h.startsWith("[") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(h) ||
    h === "metadata.google.internal"
  )
    throw new HttpError(400, "Only public HTTPS websites are accepted.");
  url.hash = "";
  for (const k of [...url.searchParams.keys()])
    if (k.startsWith("utm_") || ["fbclid", "gclid"].includes(k))
      url.searchParams.delete(k);
  return url.toString();
}
export const API_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie, Origin",
};
