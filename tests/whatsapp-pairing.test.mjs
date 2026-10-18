import test from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import { encryptPairCode, validatePairRequest } from "../bot/deploy/pair-phone.mjs";

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
