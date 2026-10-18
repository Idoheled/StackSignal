import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export async function sendAnnouncementOnce({ directory, destination, deliver }) {
  if (!destination?.paired || !destination.group_verified || destination.group_name !== "StackSignal" ||
      !/^\d{5,30}(?:-\d{5,20})?@g\.us$/.test(destination.group_jid)) throw new Error("unverified_destination");
  const ledger = join(directory, "announcement.json");
  if (existsSync(ledger)) {
    const previous = JSON.parse(readFileSync(ledger, "utf8"));
    if (previous.group_jid !== destination.group_jid || previous.status !== "sent") throw new Error("reconcile_existing_announcement");
    return previous;
  }
  let receipt = { status: "sending", group_jid: destination.group_jid, started_at: new Date().toISOString() };
  writeFileSync(ledger, JSON.stringify(receipt), { mode: 0o600, flag: "wx" });
  try {
    const id = await deliver();
    if (typeof id !== "string" || !id.trim() || id.length > 256) throw new Error("invalid_receipt");
    receipt = { ...receipt, status: "sent", message_id: id, sent_at: new Date().toISOString() };
  } catch { receipt = { ...receipt, status: "uncertain" }; }
  writeFileSync(ledger, JSON.stringify(receipt), { mode: 0o600 });
  return receipt;
}
