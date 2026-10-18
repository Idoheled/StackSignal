import test from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import { encryptPairCode, validatePairRequest } from "../bot/deploy/pair-phone.mjs";
import { verifiedGroup } from "../bot/deploy/group-identity.mjs";
import { sendAnnouncementOnce } from "../bot/deploy/activation-ledger.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("phone linking requests expire, and the code is authenticated/encrypted per session", () => {
  const now = 1_800_000_000_000;
  const request = { phone: "15555550123", key: "ab".repeat(32),
    session: "00000000-0000-4000-8000-000000000001", expires_at: now + 600_000 };
  assert.equal(validatePairRequest(request, now), request);
  for (const changed of [{ phone: "+15555550123" }, { phone: "../invalid" }, { key: "short" },
    { expires_at: now }, { expires_at: now + 900_001 }, { session: "invalid" }])
    assert.throws(() => validatePairRequest({ ...request, ...changed }, now));
  const result = encryptPairCode("ABCD1234", request);
  assert.equal(JSON.stringify(result).includes(request.phone), false);
  assert.equal(JSON.stringify(result).includes("ABCD1234"), false);
  const decrypt = value => {
    const cipher = createDecipheriv("aes-256-gcm", Buffer.from(request.key, "hex"), Buffer.from(value.nonce, "base64"));
    cipher.setAAD(Buffer.from(value.session)); cipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.encrypted, "base64")), cipher.final()]));
  };
  assert.deepEqual(decrypt(result), { code: "ABCD1234", session: request.session });
  assert.throws(() => decrypt({ ...result, session: "00000000-0000-4000-8000-000000000002" }));
  const tampered = Buffer.from(result.encrypted, "base64"); tampered[0] ^= 1;
  assert.throws(() => decrypt({ ...result, encrypted: tampered.toString("base64") }));
});

test("invite/name/membership must all identify the same group before an announcement", () => {
  const invite = { id: "123456789@g.us", subject: "StackSignal" };
  const group = { ...invite, participants: [{ id: "owner@lid", phoneNumber: "15555550123@s.whatsapp.net" }] };
  const identities = new Set(["15555550123@s.whatsapp.net"]), normalize = value => value || "";
  assert.equal(verifiedGroup(invite, group, identities, normalize).group_verified, true);
  for (const changed of [{ id: "999999999@g.us" }, { subject: "Other group" }, { participants: [{ id: "someone@lid" }] }])
    assert.throws(() => verifiedGroup(invite, { ...group, ...changed }, identities, normalize));
});

test("a confirmed or uncertain announcement is never automatically sent twice", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wa-announcement-")); let sends = 0;
  const destination = { paired: true, group_verified: true, group_name: "StackSignal", group_jid: "123456789@g.us" };
  try {
    const args = { directory, destination, deliver: async () => { sends++; return "provider-1"; } };
    const first = await sendAnnouncementOnce(args);
    assert.equal(first.status, "sent"); assert.deepEqual(await sendAnnouncementOnce(args), first); assert.equal(sends, 1);
    await assert.rejects(sendAnnouncementOnce({ ...args, destination: { ...destination, group_jid: "999999999@g.us" } }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
  const uncertain = mkdtempSync(join(tmpdir(), "wa-uncertain-")); sends = 0;
  try {
    const args = { directory: uncertain, destination, deliver: async () => { sends++; throw new Error("reply lost after acceptance"); } };
    assert.equal((await sendAnnouncementOnce(args)).status, "uncertain");
    await assert.rejects(sendAnnouncementOnce(args), /reconcile/); assert.equal(sends, 1);
  } finally { rmSync(uncertain, { recursive: true, force: true }); }
});
