import { describe, expect, it } from "vitest";
import { issuePassport } from "../src/passport/issue";
import { verifySignature } from "../src/passport/signature";
import { passportKey, signPassport, verifyWithPublicKey } from "../src/server/passport-signing";
import { paidSession } from "./passport-fixtures";

describe("verifySignature (WebCrypto, as the browser runs it)", () => {
  it("agrees with the server-side check on a good key, a wrong key, a changed passport and a junk key", async () => {
    const signed = signPassport(issuePassport(await paidSession()), "s3cret");
    const { publicKey } = passportKey("s3cret");
    expect(await verifySignature(signed, publicKey)).toBe("valid");
    expect(await verifySignature(signed, ` ${publicKey}\n`)).toBe("valid");
    expect(await verifySignature(signed, passportKey("other").publicKey)).toBe("invalid");
    const tampered = structuredClone(signed);
    tampered.bundle.totalCents += 1;
    expect(await verifySignature(tampered, publicKey)).toBe("invalid");
    expect(await verifySignature(signed, "not a key")).toBe("invalid");
    for (const [p, key] of [[signed, publicKey], [tampered, publicKey], [signed, passportKey("other").publicKey]] as const) {
      expect((await verifySignature(p, key)) === "valid").toBe(verifyWithPublicKey(p, key) === "valid");
    }
  });

  it("says unsigned or unsupported instead of guessing", async () => {
    const plain = issuePassport(await paidSession());
    expect(await verifySignature(plain, passportKey("s3cret").publicKey)).toBe("unsigned");
    const old = { ...plain, signature: { algorithm: "HMAC-SHA256" as const, value: "00" } };
    expect(await verifySignature(old, passportKey("s3cret").publicKey)).toBe("unsupported");
  });
});
