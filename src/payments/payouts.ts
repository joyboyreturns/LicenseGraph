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
  /** True when the batch was certainly never sent to PayPal, so no creator can have been paid. Absent when unsure. */
  notSent?: boolean;
}

const FINAL = new Set(["SUCCESS", "DENIED", "CANCELED", "PARTIAL"]);
export const isFinalPayout = (status: string) => FINAL.has(status);

/**
 * Work out who is paid what from the verified bundle: each licence's price goes to its licensor.
 * `payeeOverrides` (demo accounts) replace licensor emails in order, so a demo can pay real
 * Sandbox accounts. Offers whose document names no licensor, or a licensor with no payout email (and no override), are left out and reported.
 */
export function planPayouts(offers: LicenseOffer[], documents: SourceDocument[], payeeOverrides: string[] = []): { lines: Omit<PayoutLine, "status">[]; unpaid: { assetId: string; offerId: string }[] } {
  const lines: Omit<PayoutLine, "status">[] = [];
  const unpaid: { assetId: string; offerId: string }[] = [];
  // One payee per licensor, so two licences from the same licensor go to the same account.
  const receivers = new Map<string, string>();

  for (const offer of offers) {
    const documentId = offer.evidence[0]?.documentId ?? "";
    const licensor = documents.find((d) => d.id === documentId)?.licensor;
    // A licensor with no payout email can only be paid through a demo override; otherwise nobody can be paid.
    const key = licensor?.email ?? (licensor ? `name:${licensor.name.toLowerCase()}` : "");
    if (licensor && !receivers.has(key)) {
      const receiver = payeeOverrides.length ? payeeOverrides[receivers.size % payeeOverrides.length] : licensor.email;
      if (receiver) receivers.set(key, receiver);
    }
    const email = receivers.get(key);
    if (!licensor || !email) {
      unpaid.push({ assetId: offer.assetId, offerId: offer.id });
      continue;
    }
    lines.push({ assetId: offer.assetId, offerId: offer.id, documentId, licensorName: licensor.name, email, amountCents: offer.priceCents, currency: offer.currency });
  }
  return { lines, unpaid };
}

export const toPayoutItems = (lines: Omit<PayoutLine, "status">[], note: (l: Omit<PayoutLine, "status">) => string): PayoutItemInput[] =>
  lines.map((l) => ({ itemId: l.offerId, receiver: l.email, amountCents: l.amountCents, currency: l.currency, note: note(l) }));

/** Fold a fresh status from PayPal into the summary without losing the lines we already know. */
export function applyPayoutStatus(summary: PayoutSummary, status: PayoutStatus): PayoutSummary {
  if (status.batchId !== summary.batchId) throw new Error("Payout status belongs to a different batch");
  const updated = {
    ...summary,
    status: status.status,
    lines: summary.lines.map((l) => {
      const item = status.items.find((i) => i.itemId === l.offerId);
      return item ? { ...l, status: item.status, error: item.error } : l;
    }),
  };
  // A successful batch means processing finished, not that every recipient received funds.
  if (status.status === "SUCCESS" && !updated.lines.every((l) => l.status === "SUCCESS")) {
    const waiting = new Set(["PENDING", "UNCLAIMED", "ONHOLD"]);
    updated.status = updated.lines.some((l) => waiting.has(l.status)) ? "PROCESSING" : "PARTIAL";
  }
  return updated;
}
