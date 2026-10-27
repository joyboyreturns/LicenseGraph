import { createHmac, timingSafeEqual } from "node:crypto";
import { signedMessage, type Passport } from "../passport/passport";

const hmac = (secret: string, p: Passport) => createHmac("sha256", secret).update(signedMessage(p)).digest("hex");

/** Attach an HMAC so this server can later confirm it issued the passport. Without a secret the passport is unsigned. */
export function signPassport(p: Passport, secret: string | undefined): Passport {
  return secret ? { ...p, signature: { algorithm: "HMAC-SHA256", value: hmac(secret, p) } } : p;
}

export function checkSignature(p: Passport, secret: string | undefined): "valid" | "invalid" | "unsigned" | "unavailable" {
  if (!p.signature) return "unsigned";
  if (!secret) return "unavailable";
  const expected = Buffer.from(hmac(secret, p));
  const given = Buffer.from(p.signature.value);
  return expected.length === given.length && timingSafeEqual(expected, given) ? "valid" : "invalid";
}
