// Exactly one explicit announcement, using the production OpenClaw transport.
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { encryptPrivateResult, validatePairRequest } from "./pair-phone.mjs";
import { sendWhatsApp } from "/opt/stacksignal/bot/transport.mjs";
import { sendAnnouncementOnce } from "./activation-ledger.mjs";

process.umask(0o077);
const request = validatePairRequest(JSON.parse(readFileSync(0, "utf8")));
const destination = request.destination;
if (!destination?.paired || !destination.group_verified || destination.group_name !== "StackSignal" || !/^\d{5,30}(?:-\d{5,20})?@g\.us$/.test(destination.group_jid)) throw new Error("unverified_destination");
const receipt = await sendAnnouncementOnce({ directory: "/var/lib/stacksignal-bot/activation", destination, deliver: async () => {
  const message = ["🤖 StackSignal is live and connected!", "",
    "Your mildly sarcastic knowledge scout has officially entered the chat.", "",
    "✅ WhatsApp connection: active", "✅ Verified destination: StackSignal", "",
    "🧪 This is the activation test. Automatic article and GitHub-release alerts are completing their final end-to-end checks.", "",
    "Expect curated summaries, why each discovery matters, exact timestamps, and links back to StackSignal.", "",
    "https://stacksignal.stacksignal-idoheled.workers.dev", "", "Connected at: " + new Date().toISOString()].join("\n");
  const run = (file, args, options, callback) => execFile(file, args, options, (error, stdout, stderr) => {
    // Private provider evidence is retained even if the CLI receipt shape differs.
    writeFileSync("/var/lib/stacksignal-bot/activation/provider-response.json", JSON.stringify({ exit: error?.code || 0, stdout }), { mode: 0o600 });
    callback(error, stdout, stderr);
  });
  return sendWhatsApp(message, { target: destination.group_jid, executable: "/opt/node/bin/openclaw", run });
} });
console.log(JSON.stringify(encryptPrivateResult({ ...destination, announcement: receipt }, request)));
