import { createHash, createHmac, createPrivateKey, createPublicKey, hkdfSync, sign, timingSafeEqual, verify, type KeyObject } from "node:crypto";
import { signedMessage, type Passport } from "../passport/passport";

/** The fixed start of a PKCS#8 Ed25519 private key; the 32-byte seed follows. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SEED_SALT = "licensegraph/passport/ed25519/v1";

const hmac = (secret: string, p: Passport) => createHmac("sha256", secret).update(signedMessage(p)).digest("hex");

export interface PassportKey {
  privateKey: KeyObject;
  /** The raw 32-byte public key, base64url: what a third party pins to check passports without any secret. */
  publicKey: string;
  /** A short fingerprint of the public key, carried in each signature so a verifier knows which key to use. */
  keyId: string;
}

/**
 * The signing key is derived from the server's existing passport secret, so there is nothing new to configure. The secret
 * stays private; the public half can be published, and anyone holding it can check a passport offline.
 */
export function passportKey(secret: string): PassportKey {
  const seed = Buffer.from(hkdfSync("sha256", secret, SEED_SALT, "passport-signing-key", 32));
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey).export({ format: "jwk" }).x!;
  return { privateKey, publicKey, keyId: createHash("sha256").update(publicKey).digest("hex").slice(0, 16) };
}

/** Attach a signature so a passport can later be tied to this server. Without a secret the passport is unsigned. */
export function signPassport(p: Passport, secret: string | undefined): Passport {
  if (!secret) return p;
  const key = passportKey(secret);
  return { ...p, signature: { algorithm: "Ed25519", keyId: key.keyId, value: sign(null, Buffer.from(signedMessage(p)), key.privateKey).toString("base64url") } };
}

/** Check a signature against a public key alone: no secret and no server involved. */
export function verifyWithPublicKey(p: Passport, publicKey: string): "valid" | "invalid" | "unsigned" | "unsupported" {
  if (!p.signature) return "unsigned";
  if (p.signature.algorithm !== "Ed25519") return "unsupported";
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey }, format: "jwk" });
    return verify(null, Buffer.from(signedMessage(p)), key, Buffer.from(p.signature.value, "base64url")) ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}

export function checkSignature(p: Passport, secret: string | undefined): "valid" | "invalid" | "unsigned" | "unavailable" {
  if (!p.signature) return "unsigned";
  if (!secret) return "unavailable";
  if (p.signature.algorithm === "Ed25519") {
    const state = verifyWithPublicKey(p, passportKey(secret).publicKey);
    return state === "valid" ? "valid" : "invalid";
  }
  // Passports signed before the public key existed carry an HMAC that only this server can check.
  const expected = Buffer.from(hmac(secret, p));
  const given = Buffer.from(p.signature.value);
  return expected.length === given.length && timingSafeEqual(expected, given) ? "valid" : "invalid";
}

/** Legacy signer, kept so passports issued before the change still have a test fixture. */
export const signWithHmac = (p: Passport, secret: string): Passport => ({ ...p, signature: { algorithm: "HMAC-SHA256", value: hmac(secret, p) } });
