import { describe, expect, it } from "vitest";
import { publishedKeys, retiredSecretsFromEnv, signPassport, verifyWithPublicKey } from "../src/server/passport-signing";
import { issuePassport } from "../src/passport/issue";
import { paidSession } from "./passport-fixtures";

const basePassport = async () => issuePassport(await paidSession());

describe("passport key rotation", () => {
  it("keeps verifying a passport signed before rotation through the retired public key, and never with the wrong one", async () => {
    const oldSecret = "old-signing-secret-for-rotation", newSecret = "new-signing-secret-for-rotation";
    const issuedBefore = signPassport(await basePassport(), oldSecret);
    const keys = publishedKeys(newSecret, [oldSecret]);
    expect(keys.map((k) => k.status)).toEqual(["current", "retired"]);
    const bySignature = keys.find((k) => k.keyId === issuedBefore.signature!.keyId)!;
    expect(bySignature.status).toBe("retired");
    expect(verifyWithPublicKey(issuedBefore, bySignature.publicKey)).toBe("valid");
    expect(verifyWithPublicKey(issuedBefore, keys.find((k) => k.status === "current")!.publicKey)).toBe("invalid");
    const issuedAfter = signPassport(await basePassport(), newSecret);
    expect(keys.find((k) => k.keyId === issuedAfter.signature!.keyId)!.status).toBe("current");
  });
  it("lists a key once even if it is configured as both current and retired", () => {
    expect(publishedKeys("same-secret-for-both", ["same-secret-for-both"])).toHaveLength(1);
  });
  it("refuses malformed retired-secret configuration instead of silently ignoring it", () => {
    expect(retiredSecretsFromEnv({})).toEqual([]);
    expect(() => retiredSecretsFromEnv({ LICENSEGRAPH_PASSPORT_RETIRED_SECRETS: "not json" })).toThrow();
    expect(() => retiredSecretsFromEnv({ LICENSEGRAPH_PASSPORT_RETIRED_SECRETS: '["x"]' })).toThrow(/JSON array/);
  });
  it("lets tampering with a retired-key passport be detected", async () => {
    const secret = "retired-secret-for-tamper-test";
    const p = signPassport(await basePassport(), secret);
    const tampered = { ...p, project: { ...p.project, name: "Altered" } };
    expect(verifyWithPublicKey(tampered, publishedKeys(undefined, [secret])[0]!.publicKey)).toBe("invalid");
  });
});
