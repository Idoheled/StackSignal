import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const account = "49c94d7ba2a9124b3e0ddea7a329ad05";
if (process.env.CLOUDFLARE_ACCOUNT_ID !== account || !process.env.CLOUDFLARE_API_TOKEN)
  throw new Error("Provide the existing account ID and a scoped Cloudflare deployment token.");
const config = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));
const build = JSON.parse(readFileSync("dist/standalone-build.json", "utf8"));
if (build.format !== 1 || build.worker !== "stacksignal")
  throw new Error("Not a verified standalone build.");
if (config.name !== "stacksignal" || config.d1_databases?.length || config.r2_buckets?.length)
  throw new Error("Unexpected deployment target or resources. Build the standalone app first.");
if (process.env.GITHUB_ACTIONS === "true") {
  if (build.source_commit !== process.env.GITHUB_SHA)
    throw new Error("Artifact source does not match this workflow commit.");
  if (process.env.GITHUB_REPOSITORY !== "Idoheled/StackSignal" || process.env.GITHUB_REF !== "refs/heads/main" || !["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME))
    throw new Error("Production deployment is restricted to this repository's main branch.");
  const response = await fetch("https://api.github.com/repos/Idoheled/StackSignal/git/ref/heads/main", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" },
    redirect: "error", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Cannot verify the current main branch (${response.status}).`);
  if ((await response.json()).object.sha !== process.env.GITHUB_SHA) {
    console.log("A newer main commit superseded this run; skipping its deployment.");
    process.exit(0);
  }
}
const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "deploy", "--config", "dist/server/wrangler.json", "--keep-vars"], {
  stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
