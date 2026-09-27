import { spawnSync } from "node:child_process";
process.loadEnvFile(".env.setup");
const required = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_ORIGIN",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "SESSION_SECRET",
];
const values = {};
for (const k of required) {
  if (!process.env[k]) throw new Error("Missing " + k + " in .env.setup");
  values[k] = process.env[k];
}
// JSON is passed over stdin and never written to command arguments or a generated file.
const result = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "secret",
    "bulk",
    "--config",
    "dist/server/wrangler.json",
  ],
  {
    input: JSON.stringify(values),
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  },
);
process.exit(result.status ?? 1);
