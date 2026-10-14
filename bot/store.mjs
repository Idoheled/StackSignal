import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export class DeliveryStore {
  constructor(path, { maxPending = 5000 } = {}) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.maxPending = maxPending;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS deliveries (
        id TEXT PRIMARY KEY, hash TEXT NOT NULL, payload TEXT,
        phase TEXT NOT NULL CHECK (phase IN ('queued','generating','sending','sent','uncertain')),
        message TEXT, message_id TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        available_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries(phase,available_at);`);
    // A crash before sending can retry safely. A crash during a send cannot.
    this.db.exec("UPDATE deliveries SET phase='queued' WHERE phase='generating'; UPDATE deliveries SET phase='uncertain' WHERE phase='sending';");
  }
  accept(event, now = Date.now()) {
    const body = JSON.stringify(canonical(event.payload));
    const hash = createHash("sha256").update(body).digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT * FROM deliveries WHERE id=?").get(event.id);
      if (existing) {
        this.db.exec("COMMIT");
        return { conflict: existing.hash !== hash, receipt: existing.hash !== hash ? { id: event.id, status: "uncertain" } : this.receipt(existing) };
      }
      const count = this.db.prepare("SELECT count(*) AS n FROM deliveries WHERE phase<>'sent'").get().n;
      if (count >= this.maxPending) throw new Error("Queue full");
      this.db.prepare("INSERT INTO deliveries(id,hash,payload,phase,available_at,updated_at) VALUES(?,?,?,'queued',?,?)").run(event.id, hash, body, now, now);
      this.db.exec("COMMIT");
      return { conflict: false, receipt: { id: event.id, status: "queued" } };
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
  }
  receipt(row) {
    return { id: row.id, status: row.phase === "sent" ? "sent" : row.phase === "uncertain" ? "uncertain" : "queued", ...(row.phase === "sent" ? { message_id: row.message_id } : {}) };
  }
  get(id) { return this.db.prepare("SELECT * FROM deliveries WHERE id=?").get(id); }
  claim(now = Date.now()) {
    return this.db.prepare(`UPDATE deliveries SET phase='generating',updated_at=? WHERE id=(
      SELECT id FROM deliveries WHERE phase='queued' AND available_at<=? ORDER BY available_at,id LIMIT 1
    ) AND phase='queued' RETURNING *`).get(now, now);
  }
  prepareSend(id, message, now = Date.now()) {
    return this.db.prepare("UPDATE deliveries SET phase='sending',message=?,updated_at=? WHERE id=? AND phase='generating'").run(message, now, id).changes === 1;
  }
  confirm(id, messageID, now = Date.now()) {
    if (typeof messageID !== "string" || !messageID.trim() || messageID.length > 256) throw new Error("Invalid provider message ID");
    return this.db.prepare("UPDATE deliveries SET phase='sent',message_id=?,payload=NULL,message=NULL,updated_at=? WHERE id=? AND phase='sending'").run(messageID, now, id).changes === 1;
  }
  uncertain(id, now = Date.now()) {
    this.db.prepare("UPDATE deliveries SET phase='uncertain',updated_at=? WHERE id=? AND phase IN ('sending','generating')").run(now, id);
  }
  retryGeneration(id, now = Date.now()) {
    const row = this.get(id);
    if (!row || row.phase !== "generating") return;
    const attempts = row.attempts + 1;
    const delay = Math.min(3_600_000, 30_000 * 2 ** Math.min(attempts - 1, 7));
    this.db.prepare("UPDATE deliveries SET phase=?,attempts=?,available_at=?,updated_at=? WHERE id=? AND phase='generating'")
      .run(attempts >= 8 ? "uncertain" : "queued", attempts, now + delay, now, id);
  }
  close() { this.db.close(); }
}
