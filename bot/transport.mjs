import { execFile } from "node:child_process";

// Intentionally narrow contract. Verify the pinned CLI's actual response before activation.
export function confirmedMessageID(value) {
  if (!value || value.action !== "send" || value.channel !== "whatsapp" || value.dryRun !== false ||
      value.ok === false || value.sentBeforeError === true ||
      (value.deliveryStatus && value.deliveryStatus !== "sent")) return null;
  const result = value.payload ?? value.result ?? value;
  if (result.ok === false || result.error || (result.channel && result.channel !== "whatsapp")) return null;
  const id = value.messageId ?? result.messageId ?? result.result?.messageId;
  return typeof id === "string" && id.trim() && id.length <= 256 ? id : null;
}
export function sendWhatsApp(message, { target, executable = "openclaw", run = execFile } = {}) {
  if (typeof target !== "string" || !/^\d{5,30}(?:-\d{5,20})?@g\.us$/.test(target)) throw new Error("A fixed WhatsApp group JID is required");
  if (typeof message !== "string" || !message.trim() || message.length > 3500) throw new Error("Invalid message size");
  return new Promise((resolve, reject) => {
    run(executable, ["message", "send", "--channel", "whatsapp", "--target", target, "--message", message, "--json"],
      { timeout: 45_000, maxBuffer: 128 * 1024, windowsHide: true }, (error, stdout) => {
        // A timeout/nonzero exit can follow a remote acceptance. Never blindly replay it.
        if (error) return reject(new Error("Delivery uncertain"));
        try {
          const id = confirmedMessageID(JSON.parse(stdout));
          if (!id) throw new Error("No confirmed provider receipt");
          resolve(id);
        } catch { reject(new Error("Delivery uncertain")); }
      });
  });
}
