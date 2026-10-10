import test from "node:test";
import assert from "node:assert/strict";
import {
  randomToken,
  seal,
  unseal,
  validateOrigin,
  publicHttpsURL,
  boundedJSON,
} from "../lib/server/security.ts";
import { createService, isConfigured } from "../lib/server/service.ts";
import { strongPassword, validUsername } from "../lib/domain.ts";
import {
  safeURL,
  publicIPv4,
  parseFeed,
  htmlMeta,
  meaningfulChange,
} from "../supabase/functions/_shared/content.ts";
const origin = "https://stacksignal.example.com";
test("session ciphertext is authenticated and secrets never appear as plaintext", async () => {
  const key = randomToken();
  const data = {
    access_token: "private-token",
    refresh_token: "private-refresh",
  };
  const encrypted = await seal(data, key);
  assert.equal(encrypted.includes("private"), false);
  assert.deepEqual(await unseal(encrypted, key), data);
  const parts = encrypted.split(".");
  parts[1] = (parts[1][0] === "A" ? "B" : "A") + parts[1].slice(1);
  assert.equal(await unseal(parts.join("."), key), null);
  assert.equal(await unseal(encrypted, randomToken()), null);
});
test("origin and JSON checks reject cross-site writes", () => {
  assert.throws(() =>
    validateOrigin(
      new Request(origin, {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
      }),
      origin,
    ),
  );
  assert.throws(() =>
    validateOrigin(
      new Request(origin, {
        method: "POST",
        headers: { origin, "content-type": "text/plain" },
      }),
      origin,
    ),
  );
  assert.doesNotThrow(() =>
    validateOrigin(
      new Request(origin, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
      }),
      origin,
    ),
  );
});
test("oversized bodies are rejected without trusting content-length", async () => {
  await assert.rejects(
    boundedJSON(
      new Request(origin, {
        method: "POST",
        body: JSON.stringify({ s: "x".repeat(33000) }),
      }),
    ),
  );
});
test("usernames and passwords follow explicit constraints", () => {
  assert(validUsername("Network_Lead"));
  for (const name of ["ab", "2admin", "a@example.com", "root admin", "💻"])
    assert(!validUsername(name));
  assert(strongPassword("River!Fabric!Quartz!9284"));
  assert(!strongPassword("password-password-123"));
  assert(!strongPassword("X".repeat(30)));
  assert(!strongPassword("é".repeat(40)));
});
test("URLs reject protocol, credentials, localhost and encoded IP tricks", () => {
  for (const url of [
    "http://example.com",
    "https://localhost",
    "https://a.local",
    "https://user:pass@example.com",
    "https://127.0.0.1",
    "https://2130706433",
    "https://[::1]",
    "https://example.com:444",
  ])
    assert.throws(() => publicHttpsURL(url), url);
  assert.equal(
    publicHttpsURL("https://example.com/a?utm_source=x&v=1#b"),
    "https://example.com/a?v=1",
  );
  assert.throws(() => safeURL("https://attacker.example/"));
  assert.throws(() => safeURL("https://github.com.attacker.example/"));
  assert.throws(() => safeURL("https://github.com@attacker.example/"));
  assert.equal(
    safeURL("https://github.com/NVIDIA/nccl"),
    "https://github.com/NVIDIA/nccl",
  );
  for (const ip of [
    "127.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "10.0.0.1",
    "172.31.0.5",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
  ])
    assert(!publicIPv4(ip));
  assert(publicIPv4("8.8.8.8"));
});
test("source extraction preserves undated content and rejects XML entities", () => {
  assert.equal(htmlMeta("<title>GPU serving</title>").published_at, null);
  assert.equal(
    htmlMeta(
      '<meta property="article:published_time" content="2025-03-01"><title>X</title>',
    ).published_at,
    "2025-03-01T00:00:00.000Z",
  );
  const items = parseFeed(
    '<feed><entry><title>vLLM &amp; GPUs</title><link href="https://github.com/vllm-project/vllm"/><updated>2025-03-01</updated></entry></feed>',
  );
  assert.equal(items[0].published_at, null);
  assert.equal(items[0].updated_at, "2025-03-01T00:00:00.000Z");
  assert.throws(() =>
    parseFeed('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>'),
  );
  assert(!meaningfulChange("a b c", "a b c d"));
});
test("unconfigured application fails closed", async () => {
  assert(!isConfigured({}));
  const handler = createService({});
  assert.equal(
    (await handler(new Request(origin + "/api/action", { method: "POST" })))
      .status,
    503,
  );
  const status = await (
    await handler(new Request(origin + "/api/status"))
  ).json();
  assert.equal(status.configured, false);
});
const config = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  APP_ORIGIN: origin,
  SESSION_SECRET: randomToken(),
  TURNSTILE_SITE_KEY: "site",
  TURNSTILE_SECRET_KEY: "secret",
};
test("configured service rejects anonymous and cross-site access before data calls", async () => {
  let calls = 0;
  const handler = createService(config, async () => {
    calls++;
    throw new Error("Must not call");
  });
  assert.equal((await handler(new Request(origin + "/api/me"))).status, 401);
  assert.equal(
    (
      await handler(
        new Request(origin + "/api/action", {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            "content-type": "application/json",
          },
          body: "{}",
        }),
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
});
test("login delegates one CAPTCHA verification to Auth; failed credentials reveal nothing", async () => {
  const paths: string[] = [];
  const handler = createService(config, async (input) => {
    const path = String(input);
    paths.push(path);
    if (path.includes("ss_rate_limit")) return Response.json(true);
    if (path.includes("/auth/v1/token"))
      return Response.json({ error: "bad password" }, { status: 400 });
    throw new Error("Unexpected network");
  });
  const response = await handler(
    new Request(origin + "/api/login", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        username: "engineer",
        password: "not-a-real-password",
        captcha: "test-only",
      }),
    }),
  );
  assert.equal(response.status, 401);
  assert.equal(
    (await response.json()).error,
    "Username or password is incorrect.",
  );
  assert(!paths.some((p) => p.includes("siteverify")));
});
test("forged session cookies do not reach identity provider", async () => {
  let calls = 0;
  const handler = createService(config, async () => {
    calls++;
    throw new Error("not expected");
  });
  const res = await handler(
    new Request(origin + "/api/me", {
      headers: { cookie: "__Host-stacksignal=forged.payload" },
    }),
  );
  assert.equal(res.status, 401);
  assert.equal(calls, 0);
});

test("recovery CAPTCHA binds successful verification to the hostname and action", async () => {
  for (const [verification, status, accepted] of [
    [{ success: true, hostname: "stacksignal.example.com", action: "recover" }, 200, true],
    [{ success: true, hostname: "evil.example", action: "recover" }, 200, false],
    [{ success: true, hostname: "stacksignal.example.com", action: "register" }, 200, false],
    [{ success: true, hostname: "stacksignal.example.com" }, 200, false],
    [{ success: "true", hostname: "stacksignal.example.com", action: "recover" }, 200, false],
    [{ success: true, hostname: "stacksignal.example.com", action: "recover" }, 503, false],
  ] as const) {
    let reachedRecovery = false;
    const handler = createService(config, async (input) => {
      const url = String(input);
      if (url.includes("ss_rate_limit")) return Response.json(true);
      if (url.includes("siteverify")) return Response.json(verification, { status });
      if (url.includes("/ss_recovery?")) {
        reachedRecovery = true;
        return Response.json([]);
      }
      throw new Error("Unexpected network request");
    });
    const response = await handler(new Request(origin + "/api/recover", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ username: "engineer", password: "River!Fabric!Quartz!9284", captcha: "test-only", token: "expired-recovery" }),
    }));
    assert.equal(reachedRecovery, accepted);
    assert.equal(response.status, 400);
  }
});
