import { createHmac } from "node:crypto";
/** Standard TOTP used only to drive the local identity provider's browser fixture. */
export function totp(secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.toUpperCase().replace(/[\s=-]/g, "")) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("Invalid fixture OTP encoding.");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hash = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = hash.at(-1)! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** A code from the next 30-second step. Keycloak rejects a code it has already accepted, as a real user would find. */
export async function freshTotp(secret: string, previousStep = Math.floor(Date.now() / 30_000)): Promise<string> {
  const wait = (previousStep + 1) * 30_000 - Date.now() + 500;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return totp(secret);
}
