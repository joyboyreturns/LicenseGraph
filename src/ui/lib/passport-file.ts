/**
 * Read a Licence Passport file a person dropped or pasted, with friendly errors, before handing it
 * to verifyPassport (which assumes the shape is right).
 */
import type { Passport } from "@/src/passport/passport";

export type ParseResult = { ok: true; passport: Passport } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const MAX_PASSPORT_BYTES = 5_000_000;

export function parsePassport(text: string): ParseResult {
  if (!text.trim()) return { ok: false, error: "The file is empty." };
  if (text.length > MAX_PASSPORT_BYTES) return { ok: false, error: "That file is too large to be a Licence Passport (over 5 MB)." };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "This is not valid JSON. Download the passport again with the Download JSON button and try that file." };
  }
  if (!isObj(data)) return { ok: false, error: "This JSON is not a Licence Passport (expected an object)." };
  if (data.version !== 1) return { ok: false, error: `Unsupported passport version${data.version === undefined ? "" : ` (${String(data.version)})`}. This page reads version 1.` };

  const missing: string[] = [];
  if (typeof data.id !== "string") missing.push("id");
  if (!isObj(data.project)) missing.push("project");
  if (!Array.isArray(data.requiredAssetIds)) missing.push("requiredAssetIds");
  if (!Array.isArray(data.documents)) missing.push("documents");
  const bundle = data.bundle;
  if (!isObj(bundle) || !Array.isArray(bundle.offers) || typeof bundle.totalCents !== "number" || typeof bundle.digest !== "string") missing.push("bundle");
  if (!isObj(data.approval) || typeof data.approval.bundleDigest !== "string") missing.push("approval");
  if (!isObj(data.paypal) || !isObj(data.paypal.amount)) missing.push("paypal");
  if (!isObj(data.ledger) || !Array.isArray(data.ledger.events) || typeof data.ledger.head !== "string") missing.push("ledger");
  if (!isObj(data.comparison)) missing.push("comparison");
  if (missing.length) return { ok: false, error: `This JSON is missing parts of a Licence Passport: ${missing.join(", ")}.` };

  const offersOk = (bundle as { offers: unknown[] }).offers.every((o) => isObj(o) && typeof o.id === "string" && typeof o.priceCents === "number" && isObj(o.terms) && Array.isArray(o.evidence));
  if (!offersOk) return { ok: false, error: "A licence in this passport's bundle is malformed." };
  const eventsOk = (data.ledger as { events: unknown[] }).events.every((e) => isObj(e) && typeof e.seq === "number" && typeof e.hash === "string" && isObj(e.payload));
  if (!eventsOk) return { ok: false, error: "A ledger event in this passport is malformed." };

  return { ok: true, passport: data as unknown as Passport };
}

/**
 * A deliberately edited copy for the "tampered sample" demo: the first licence's price is raised by
 * one currency unit, as if someone changed what was paid after the fact. The original is untouched.
 */
export function tamperPrice(passport: Passport, deltaCents = 100): { passport: Passport; offerId?: string; fromCents?: number; toCents?: number } {
  const copy = structuredClone(passport);
  const offer = copy.bundle.offers[0];
  if (!offer) return { passport: copy };
  const fromCents = offer.priceCents;
  offer.priceCents = fromCents + deltaCents;
  return { passport: copy, offerId: offer.id, fromCents, toCents: offer.priceCents };
}
