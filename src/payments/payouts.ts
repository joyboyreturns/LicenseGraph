import type { Cents, LicenseOffer } from "../core/types";
import type { SourceDocument } from "../extraction/extract";
import type { PayoutItemInput, PayoutStatus } from "./paypal";

export interface PayoutLine {
  assetId: string;
  offerId: string;
  documentId: string;
  licensorName: string;
  email: string;
  amountCents: Cents;
  currency: string;
  status: string;
  error?: string;
}

export interface PayoutSummary {
  batchId: string;
  /** Batch status from PayPal: PENDING, PROCESSING, SUCCESS, DENIED, CANCELED. */
  status: string;
  totalCents: Cents;
  currency: string;
  lines: PayoutLine[];
  createdAt: string;
  error?: string;
}

const FINAL = new Set(["SUCCESS", "DENIED", "CANCELED"]);
export const isFinalPayout = (status: string) => FINAL.has(status);

/**
 * Work out who is paid what from the verified bundle: each licence's price goes to its licensor.
 * `payeeOverrides` (demo accounts) replace licensor emails in order, so a demo can pay real
 * Sandbox accounts. Offers whose document names no licensor are left out and reported.
 */
export function planPayouts(offers: LicenseOffer[], documents: SourceDocument[], payeeOverrides: string[] = []): { lines: Omit<PayoutLine, "status">[]; unpaid: { assetId: string; offerId: string }[] } {
  const lines: Omit<PayoutLine, "status">[] = [];
  const unpaid: { assetId: string; offerId: string }[] = [];
  const emails = new Map<string, string>();

  for (const offer of offers) {
    const documentId = offer.evidence[0]?.documentId ?? "";
    const licensor = documents.find((d) => d.id === documentId)?.licensor;
    if (!licensor) {
      unpaid.push({ assetId: offer.assetId, offerId: offer.id });
      continue;
    }
    if (!emails.has(licensor.email)) emails.set(licensor.email, payeeOverrides.length ? payeeOverrides[emails.size % payeeOverrides.length]! : licensor.email);
    lines.push({ assetId: offer.assetId, offerId: offer.id, documentId, licensorName: licensor.name, email: emails.get(licensor.email)!, amountCents: offer.priceCents, currency: offer.currency });
  }
  return { lines, unpaid };
}

export const toPayoutItems = (lines: Omit<PayoutLine, "status">[], note: (l: Omit<PayoutLine, "status">) => string): PayoutItemInput[] =>
  lines.map((l) => ({ itemId: l.offerId, receiver: l.email, amountCents: l.amountCents, currency: l.currency, note: note(l) }));

/** Fold a fresh status from PayPal into the summary without losing the lines we already know. */
export function applyPayoutStatus(summary: PayoutSummary, status: PayoutStatus): PayoutSummary {
  return {
    ...summary,
    status: status.status,
    lines: summary.lines.map((l) => {
      const item = status.items.find((i) => i.itemId === l.offerId);
      return item ? { ...l, status: item.status, error: item.error } : l;
    }),
  };
}
