// The same app on your own Cloudflare account, using StackSignal's username/password auth.
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
// Do not carry a previous Sites build or stale chunks into the team artifact.
rmSync("dist", { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      STACKSIGNAL_STANDALONE: "1",
      WRANGLER_SEND_METRICS: "false",
    },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (head.status !== 0) throw new Error("Cannot identify the source commit.");
writeFileSync("dist/standalone-build.json", JSON.stringify({
  format: 1, worker: "stacksignal", source_commit: head.stdout.trim(),
}) + "\n");
