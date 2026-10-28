import type { LicenseOffer } from "./types";

/**
 * The exact text that gets hashed for a bundle, including its terms and evidence, sorted by id.
 * Both the server (node:crypto) and the browser (WebCrypto) hash this same string, so a
 * Licence Passport can be re-checked anywhere.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
    return item;
  });
}

export function bundleCanonical(offers: readonly LicenseOffer[], version: 1 | 2 = 2): string {
  // Read-only compatibility for passports downloaded before terms were included in the digest.
  if (version === 1) return JSON.stringify(offers.map((o) => [o.id, o.assetId, o.priceCents, o.currency]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  return canonicalJson([...offers].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** SHA-256 as lowercase hex using WebCrypto, which exists in browsers and in Node 20+. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
