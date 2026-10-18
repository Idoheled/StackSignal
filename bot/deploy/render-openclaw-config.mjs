// Run as the service user, with its state directory configured, before pairing.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyInstalledWhatsApp } from "./verify-whatsapp-plugin.mjs";
process.umask(0o077);
const state = process.env.OPENCLAW_STATE_DIR;
if (!state || !state.startsWith("/") || state.includes("..")) throw new Error("Absolute OpenClaw state directory required");
const path = join(state, "openclaw.json");
const finalize = process.argv.includes("--finalize-plugin-install");
const coreOnly = process.argv.includes("--core-only");
const existing = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
if (existing && (!finalize || existing.channels?.whatsapp || !existing.agents?.entries?.notification))
  throw new Error("Configuration exists; review it rather than overwriting a paired session");
mkdirSync(join(state, "workspace"), { recursive: true, mode: 0o700 });
const config = {
  gateway: { mode: "local", bind: "loopback", port: 18789, auth: { mode: "token", token: randomBytes(32).toString("hex") } },
  agents: { defaults: { systemAgent: { agentId: "notification" }, heartbeat: { every: "0m", target: "none" } },
    entries: { notification: { workspace: join(state, "workspace"), model: "ollama/qwen3:4b", utilityModel: "ollama/qwen3:4b" } } },
  channels: { whatsapp: { enabled: true, dmPolicy: "disabled", groupPolicy: "disabled", groups: {},
    sendReadReceipts: false, textChunkLimit: 4000, configWrites: false } },
  tools: { deny: ["*"] },
  plugins: { allow: ["whatsapp"], entries: { whatsapp: { enabled: true } } },
};
if (coreOnly) { delete config.channels; config.plugins = { allow: [] }; }
if (finalize) {
  verifyInstalledWhatsApp(state);
  // 2026.10.3 stores installation provenance in the installed index, not JSON.
  if (existing.plugins?.load) config.plugins.load = existing.plugins.load;
  config.gateway = existing.gateway;
}
writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: existing ? "w" : "wx" });
console.log("Outbound-only configuration created; validate with the pinned OpenClaw CLI before starting.");
