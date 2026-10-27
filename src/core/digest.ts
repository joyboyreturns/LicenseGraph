import type { LicenseOffer } from "./types";

/**
 * The exact text that gets hashed for a bundle: each offer's id, asset, price and currency, sorted
 * by id. Both the server (node:crypto) and the browser (WebCrypto) hash this same string, so a
 * Licence Passport can be re-checked anywhere.
 */
export function bundleCanonical(offers: readonly Pick<LicenseOffer, "id" | "assetId" | "priceCents" | "currency">[]): string {
  const rows = offers.map((o) => [o.id, o.assetId, o.priceCents, o.currency] as const).sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(rows);
}

/** SHA-256 as lowercase hex using WebCrypto, which exists in browsers and in Node 20+. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
