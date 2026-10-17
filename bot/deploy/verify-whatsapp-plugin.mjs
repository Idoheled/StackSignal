// Verify the pinned release through OpenClaw's authoritative installed index.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const name = "@openclaw/whatsapp", version = "2026.10.3", spec = `${name}@${version}`;
const fail = (reason) => { throw new Error(reason); };
export function validateWhatsAppReport(report, state) {
  const plugin = report?.plugin, install = report?.install;
  if (plugin?.id !== "whatsapp") fail("plugin_identity");
  if (!install || install.source !== "npm" || install.resolvedName !== name ||
      (install.resolvedVersion || install.version) !== version ||
      ![install.spec, install.resolvedSpec].some((value) => value === spec || value === `npm:${spec}`) ||
      (plugin.version && plugin.version !== version)) fail("plugin_provenance");
  if (typeof install.installPath !== "string" || typeof plugin.source !== "string") fail("plugin_path");
  const root = realpathSync(state), directory = realpathSync(install.installPath), source = realpathSync(plugin.source);
  if (!directory.startsWith(root + sep) || !(source === directory || source.startsWith(directory + sep))) fail("plugin_path");
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (pkg.name !== name || pkg.version !== version) fail("plugin_package");
  return { status: "whatsapp_plugin_verified", version };
}

export function verifyInstalledWhatsApp(state = process.env.OPENCLAW_STATE_DIR) {
  if (!state || !state.startsWith("/")) fail("plugin_path");
  let report;
  try {
    report = JSON.parse(execFileSync("/opt/node/bin/openclaw", ["plugins", "inspect", "whatsapp", "--json"],
      { encoding: "utf8", timeout: 90_000, maxBuffer: 1_048_576, stdio: ["ignore", "pipe", "pipe"] }));
  } catch { fail("plugin_inspection"); }
  return validateWhatsAppReport(report, state);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const proof = verifyInstalledWhatsApp();
    if (!process.argv.includes("--quiet")) console.log(JSON.stringify(proof));
  } catch (error) {
    const allowed = new Set(["plugin_identity", "plugin_provenance", "plugin_path", "plugin_package", "plugin_inspection"]);
    if (!process.argv.includes("--quiet")) console.error(JSON.stringify({ status: "plugin_verification_failed",
      reason: allowed.has(error.message) ? error.message : "plugin_inspection" }));
    process.exitCode = 1;
  }
}
