#!/usr/bin/env node
// Run locally with Node 24. Secrets belong in your ignored .env.setup file, never in chat or git.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { SEED_SOURCES } from "../lib/domain.ts";
if (existsSync(".env.setup")) process.loadEnvFile(".env.setup");
const base = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base || "") || !key)
  throw new Error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.setup first.",
  );
async function request(path, method = "GET", body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const out = await r.json().catch(() => null);
  if (!r.ok)
    throw new Error(
      "Setup request failed (" +
        r.status +
        "). Check the SQL migration, project URL and service key.",
    );
  return out;
}
const owners = await request("/rest/v1/ss_members?role=eq.admin&select=id");
let owner = owners[0]?.id;
if (!owner) {
  const password = randomBytes(32).toString("base64url");
  const created = await request("/auth/v1/admin/users", "POST", {
    email: "administrator@accounts.stacksignal.invalid",
    password,
    email_confirm: true,
  });
  owner = created.id;
  try {
    await request("/rest/v1/ss_members", "POST", {
      id: owner,
      username: "administrator",
      display_name: "Administrator",
      role: "admin",
      must_change_password: true,
    });
  } catch (e) {
    await request("/auth/v1/admin/users/" + owner, "DELETE").catch(() => {});
    throw e;
  }
  try {
    writeFileSync(
      ".bootstrap-credentials.txt",
      "Username: administrator\nTemporary password: " +
        password +
        "\nChange this at first login, then delete this file.\n",
      { mode: 0o600, flag: "wx" },
    );
  } catch {
    throw new Error(
      "Owner created but credential file could not be written. Reset the owner password through your Supabase dashboard before signing in.",
    );
  }
  console.log(
    "Administrator created. Temporary credentials are in .bootstrap-credentials.txt (local file, mode 0600).",
  );
} else console.log("Administrator already exists; password preserved.");
const sources = await request("/rest/v1/ss_sources?select=url");
const urls = new Set(sources.map((s) => s.url));
const missing = SEED_SOURCES.filter((s) => !urls.has(s[1])).map((s) => ({
  name: s[0],
  url: s[1],
  type: s[2],
  topic: s[3],
  interval_minutes: 120,
}));
if (missing.length) await request("/rest/v1/ss_sources", "POST", missing);
const folders = await request(
  "/rest/v1/ss_folders?parent_id=is.null&deleted_at=is.null&select=name",
);
const names = new Set(folders.map((f) => f.name));
const desired = [
  "Inbox",
  "Inference & serving",
  "Networking & fabric",
  "Platforms",
  "Hardware",
  "Models & research",
  "Operations",
];
const fresh = desired
  .filter((n) => !names.has(n))
  .map((name) => ({ name, created_by: owner }));
if (fresh.length) await request("/rest/v1/ss_folders", "POST", fresh);
console.log(
  `Ready: ${SEED_SOURCES.length} source definitions and starter collections. Verify source health after the first scan.`,
);
