import handler from "vinext/server/fetch-handler";
export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const response = await handler.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    headers.set("Strict-Transport-Security", "max-age=31536000");
    const html = headers.get("content-type")?.includes("text/html");
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
    if (html) {
      // Each server-rendered script receives a fresh response nonce; streamed React bootstrap remains supported.
      headers.set(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic' 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com`,
      );
      headers.set("Cache-Control", "no-store, private");
    }
    const secured = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    return html
      ? new HTMLRewriter().on("script", { element(el) { el.setAttribute("nonce", nonce); } }).transform(secured)
      : secured;
  },
};
