import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.loadEnvFile(".env.setup");
const base = new URL(process.env.SUPABASE_URL || "");
const ref = base.hostname.split(".")[0];
if (!/^[a-z0-9]+$/.test(ref))
  throw new Error("Invalid Supabase project reference");
if ((process.env.COLLECTOR_SECRET || "").length < 32)
  throw new Error("Generate the collector secret first");
const keys = [
  "COLLECTOR_SECRET",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "TAVILY_API_KEY",
  "GITHUB_READ_TOKEN",
  "COLLECTOR_ALLOWED_HOSTS",
];
const folder = mkdtempSync(join(tmpdir(), "stacksignal-"));
const file = join(folder, "secrets.env");
try {
  writeFileSync(
    file,
    keys
      .filter((k) => process.env[k])
      .map((k) => k + "=" + process.env[k])
      .join("\n"),
    { mode: 0o600 },
  );
  const result = spawnSync(
    "supabase",
    ["secrets", "set", "--env-file", file, "--project-ref", ref],
    { stdio: "inherit" },
  );
  if (result.error)
    throw new Error(
      "Install the official Supabase CLI and run supabase login first.",
    );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(folder, { recursive: true, force: true });
}
