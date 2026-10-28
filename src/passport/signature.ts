import { signedMessage, type Passport } from "./passport";

export type SignatureState = "valid" | "invalid" | "unsigned" | "unsupported" | "unavailable";

const fromBase64Url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/**
 * Check a passport's Ed25519 signature against an issuer's public key, with WebCrypto, so it runs in a browser or in
 * Node with no secret and no server. "unavailable" means this runtime has no Ed25519 in WebCrypto: not a verdict on the passport.
 */
export async function verifySignature(p: Passport, publicKey: string): Promise<SignatureState> {
  if (!p.signature) return "unsigned";
  if (p.signature.algorithm !== "Ed25519") return "unsupported";
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "unavailable";
  let key: CryptoKey;
  try {
    key = await subtle.importKey("raw", fromBase64Url(publicKey.trim()), { name: "Ed25519" }, false, ["verify"]);
  } catch (e) {
    return e instanceof DOMException && e.name === "NotSupportedError" ? "unavailable" : "invalid";
  }
  try {
    return (await subtle.verify({ name: "Ed25519" }, key, fromBase64Url(p.signature.value), new TextEncoder().encode(signedMessage(p)))) ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}
