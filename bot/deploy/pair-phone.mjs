// One-time owner-requested phone-code login. Never emits phone/auth/code to logs.
import { createCipheriv, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, join, dirname, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { validateWhatsAppReport } from "./verify-whatsapp-plugin.mjs";

export function validatePairRequest(value, now = Date.now()) {
  if (!value || !/^[1-9][0-9]{7,14}$/.test(value.phone || "") ||
      !/^[0-9a-f]{64}$/.test(value.key || "") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.session || "") ||
      !Number.isSafeInteger(value.expires_at) || value.expires_at <= now || value.expires_at > now + 900_000)
    throw new Error("invalid_pair_request");
  return value;
}

export function encryptPairCode(code, request) {
  if (!/^[A-Z0-9]{8}$/.test(code)) throw new Error("invalid_pair_code");
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(request.key, "hex"), nonce);
  cipher.setAAD(Buffer.from(request.session));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ code, session: request.session }), "utf8"), cipher.final()]);
  return { status: "code_ready", session: request.session, nonce: nonce.toString("base64"),
    encrypted: encrypted.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

let stage = "service_context", session;
async function main() {
  process.umask(0o077);
  const base = "/var/lib/stacksignal-bot", requestPath = base + "/pairing/request.json", resultPath = base + "/pairing/result.json";
  if (process.getuid?.() === 0 || process.env.OPENCLAW_STATE_DIR !== base + "/openclaw") throw new Error("service_context");
  const info = lstatSync(requestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096 || (info.mode & 0o077)) throw new Error("request_permissions");
  const request = validatePairRequest(JSON.parse(readFileSync(requestPath, "utf8")));
  session = request.session;
  unlinkSync(requestPath); // Phone and encryption key remain only in process memory.
  stage = "verify_plugin";
  const report = JSON.parse(execFileSync("/opt/node/bin/openclaw", ["plugins", "inspect", "whatsapp", "--json"],
    { encoding: "utf8", timeout: 90_000, maxBuffer: 1_048_576, stdio: ["ignore", "pipe", "pipe"] }));
  validateWhatsAppReport(report, process.env.OPENCLAW_STATE_DIR);
  stage = "load_baileys";
  const plugin = realpathSync(report.install.installPath), require = createRequire(join(plugin, "package.json"));
  const entry = require.resolve("baileys"), baileysRoot = dirname(dirname(realpathSync(entry)));
  const baileysPackage = JSON.parse(readFileSync(join(baileysRoot, "package.json"), "utf8"));
  if (baileysPackage.version !== "7.0.0-rc14") throw new Error("baileys_version");
  const wa = await import(pathToFileURL(entry).href);
  stage = "load_account";
  const cfg = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, "utf8"));
  const channel = cfg.channels?.whatsapp;
  if (!channel || channel.dmPolicy !== "disabled" || channel.groupPolicy !== "disabled" ||
      Object.keys(channel.accounts || {}).length || channel.authDir) throw new Error("unexpected_account_configuration");
  const auth = join(process.env.OPENCLAW_STATE_DIR, "credentials", "whatsapp", "default");
  mkdirSync(auth, { recursive: true, mode: 0o700 });
  if (!realpathSync(auth).startsWith(realpathSync(process.env.OPENCLAW_STATE_DIR) + sep)) throw new Error("auth_path");
  const { state, saveCreds } = await wa.useMultiFileAuthState(auth);
  if (state.creds.registered) throw new Error("already_registered");
  stage = "connect";
  let pendingSaves = Promise.resolve(), sock, codeRequested = false, settled = false;
  const persist = value => { const tmp = resultPath + ".tmp"; writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, resultPath); };
  const logger = { level: "silent", child() { return this; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
  const { version } = await wa.fetchLatestBaileysVersion();
  const makeSocket = wa.makeWASocket || wa.default;
  sock = makeSocket({ version, auth: state, logger, browser: wa.Browsers.macOS("Chrome"),
    syncFullHistory: false, markOnlineOnConnect: false, fireInitQueries: false });
  const finish = async (status) => {
    if (settled) return;
    settled = true;
    try { await new Promise(r => setImmediate(r)); await pendingSaves; await saveCreds(); await new Promise(r => setTimeout(r, 300)); }
    finally { sock.end(undefined); }
    persist({ status, session: request.session });
    clearTimeout(timer);
  };
  const timer = setTimeout(() => { void finish("expired"); }, Math.min(540_000, request.expires_at - Date.now()));
  sock.ev.on("creds.update", () => { pendingSaves = pendingSaves.then(saveCreds).catch(() => { void finish("credential_save_failed"); }); });
  sock.ev.on("connection.update", update => {
    void (async () => {
      if (settled) return;
      if (update.qr && !codeRequested && !state.creds.registered) {
        codeRequested = true;
        stage = "request_code";
        const code = await sock.requestPairingCode(request.phone);
        if (!settled) persist(encryptPairCode(code.replace(/-/g, "").toUpperCase(), request));
      }
      if (update.connection === "open") {
        const self = (state.creds.me?.id || "").split(":")[0].split("@")[0];
        await finish(self === request.phone ? "paired" : "identity_mismatch");
      } else if (update.connection === "close") {
        const status = update.lastDisconnect?.error?.output?.statusCode;
        await finish(status === 515 && state.creds.registered ? "linked_restart_required" : "connection_closed");
      }
    })().catch(() => { void finish("pairing_failed"); });
  });
  await new Promise(resolve => {
    const poll = setInterval(() => { if (settled) { clearInterval(poll); resolve(); } }, 500);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // systemd also discards stderr. Preserve no raw provider errors/phone data.
    if (session) {
      try { writeFileSync("/var/lib/stacksignal-bot/pairing/result.json", JSON.stringify({ status: "failed", session, stage }), { mode: 0o600 }); } catch {}
    }
    process.exitCode = 1;
  });
}
