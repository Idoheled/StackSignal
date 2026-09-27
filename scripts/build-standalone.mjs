// The same app on your own Cloudflare account, using StackSignal's username/password auth.
import { spawnSync } from "node:child_process";
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
process.exit(result.status ?? 1);
