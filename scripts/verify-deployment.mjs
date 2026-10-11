import assert from "node:assert/strict";

const origin = "https://stacksignal.stacksignal-idoheled.workers.dev";
async function request(path, options = {}) {
  return fetch(origin + path, { ...options, redirect: "error", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0 StackSignal-CI", ...options.headers } });
}
// Retry transient edge propagation only. Authentication is never bypassed.
for (let attempt = 0; ; attempt++) {
  try {
    const response = await request("/api/status");
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.configured, true);
    assert.equal(status.preview_enabled, false);
    assert.equal(status.username_login, true);
    assert.ok(status.site_key);
    break;
  } catch (error) {
    if (attempt >= 5) throw error;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
for (const path of ["/api/me", "/api/preview"]) {
  const response = await request(path);
  assert.equal(response.status, 401, `Anonymous access at ${path}`);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
}
const crossSite = await request("/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://invalid.example" }, body: "{}" });
assert.equal(crossSite.status, 403);
const html = await request("/");
assert.equal(html.status, 200);
assert.match(html.headers.get("content-security-policy") || "", /script-src 'nonce-/);
assert.match(html.headers.get("cache-control") || "", /no-store/);
assert.equal(html.headers.get("x-content-type-options"), "nosniff");
console.log("Production smoke checks passed: configured, private, same-origin protected and secured HTML.");
