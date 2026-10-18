// Resolve only the supplied invite and verify membership; never sends a message.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateWhatsAppReport } from "./verify-whatsapp-plugin.mjs";
import { validatePairRequest } from "./pair-phone.mjs";
import { verifiedGroup } from "./group-identity.mjs";

const request = validatePairRequest(JSON.parse(readFileSync(0, "utf8")));
const statePath = process.env.OPENCLAW_STATE_DIR;
const url = new URL(request.invite_url);
if (url.origin !== "https://chat.whatsapp.com" || !/^\/[A-Za-z0-9]{16,64}$/.test(url.pathname) || request.group_name !== "StackSignal") throw new Error("invalid_destination_request");
const report = JSON.parse(execFileSync("/opt/node/bin/openclaw", ["plugins", "inspect", "whatsapp", "--json"],
  { encoding: "utf8", timeout: 90_000, maxBuffer: 1_048_576, stdio: ["ignore", "pipe", "pipe"] }));
validateWhatsAppReport(report, statePath);
const require = createRequire(join(report.install.installPath, "package.json"));
const wa = await import(pathToFileURL(require.resolve("baileys")).href);
const { state, saveCreds } = await wa.useMultiFileAuthState(join(statePath, "credentials", "whatsapp", "default"));
if (!state.creds.registered || (state.creds.me?.id || "").split(":")[0].split("@")[0] !== request.phone) throw new Error("paired_identity_mismatch");
const logger = { level: "silent", child() { return this; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
const { version } = await wa.fetchLatestBaileysVersion();
const sock = (wa.makeWASocket || wa.default)({ version, auth: state, logger, browser: wa.Browsers.macOS("Chrome"),
  syncFullHistory: false, fireInitQueries: false, markOnlineOnConnect: false });
// Same directory-only receive boundary as pinned OpenClaw: no chat consumption.
for (const event of ["CB:message", "CB:call", "CB:receipt", "CB:notification", "CB:ack,class:message",
  "CB:presence", "CB:chatstate", "CB:ib,,dirty", "CB:ib,,offline_preview", "CB:ib,,offline", "CB:ib,,edge_routing"])
  sock.ws.removeAllListeners(event);
let saves = Promise.resolve();
sock.ev.on("creds.update", () => { saves = saves.then(saveCreds); });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("connection_timeout")), 60_000);
    sock.ev.on("connection.update", update => {
      if (update.connection === "open") { clearTimeout(timer); resolve(); }
      if (update.connection === "close") { clearTimeout(timer); reject(new Error("connection_closed")); }
    });
  });
  const invite = await sock.groupGetInviteInfo(url.pathname.slice(1));
  const group = await sock.groupMetadata(invite.id);
  const normalize = value => typeof value === "string" ? wa.jidNormalizedUser(value) : "";
  const identities = new Set([state.creds.me?.id, state.creds.me?.lid, request.phone + "@s.whatsapp.net"].map(normalize).filter(Boolean));
  console.log(JSON.stringify(verifiedGroup(invite, group, identities, normalize)));
} finally { await saves; await saveCreds(); sock.end(undefined); }
process.exit(0);
