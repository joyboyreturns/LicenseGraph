import { bundleCanonical, sha256Hex } from "../core/digest";
import { verifyBundle } from "../core/rules";
import type { LicenseOffer, Project } from "../core/types";
import { verifyChainAsync, type LedgerEvent } from "../ledger/chain";
import type { PayoutSummary } from "../payments/payouts";
import type { Session } from "../app-logic/session";

export interface Passport {
  version: 1;
  id: string;
  /** When the payment was captured, taken from the ledger so the passport is reproducible. */
  issuedAt: string;
  project: Project;
  requiredAssetIds: string[];
  /** The date offers were checked against when the run started. */
  runDate?: string;
  /** Only the licence documents behind the chosen offers. */
  documents: { id: string; assetId: string; licensorName?: string; text: string }[];
  bundle: { offers: LicenseOffer[]; totalCents: number; currency: string; digest: string };
  approval: { approvedBy: string; approvedAt: string; bundleDigest: string };
  paypal: { orderId: string; captureId: string; amount: { currency: string; value: string }; environment: "sandbox" };
  payouts?: { batchId: string; status: string; totalCents: number; currency: string; lines: { assetId: string; licensor: string; amountCents: number; status: string }[] };
  comparison: { naiveTotalCents: number; compliancePremiumCents: number; blockedPurchases: { assetId: string; offerId: string; priceCents: number; reasons: string[] }[] };
  ledger: { events: LedgerEvent[]; head: string };
  /** Present when the server holds a signing secret. Checked by the server, not in the browser. */
  signature?: { algorithm: "HMAC-SHA256"; value: string };
}

export class PassportError extends Error {}

/** What the signature covers. The server signs this with its secret; the browser cannot check it. */
export const signedMessage = (p: Pick<Passport, "id" | "bundle" | "ledger" | "paypal">) => [p.id, p.bundle.digest, p.ledger.head, p.paypal.captureId].join("|");

/** Build a passport for a paid run. Throws if the run has not been paid. */
export function buildPassport(session: Session, comparison: Passport["comparison"]): Passport {
  const bundle = session.loop?.status === "verified" ? session.loop.bundle : undefined;
  const events = session.ledger.events();
  const captured = events.find((e) => e.kind === "captured");
  if (!bundle || !session.approval || !session.order || !session.capture || !captured) throw new PassportError("A passport is issued once the payment has been captured.");

  const used = new Set(bundle.offers.map((o) => o.evidence[0]?.documentId));
  const payouts: PayoutSummary | undefined = session.payouts && session.payouts.status !== "FAILED" ? session.payouts : undefined;
  return {
    version: 1,
    id: session.id,
    issuedAt: captured.at,
    project: session.input.project,
    requiredAssetIds: session.input.requiredAssetIds,
    runDate: session.runDate,
    documents: session.input.documents.filter((d) => used.has(d.id)).map((d) => ({ id: d.id, assetId: d.assetId, licensorName: d.licensor?.name, text: d.text })),
    bundle: { offers: bundle.offers, totalCents: session.loop!.verdict!.totalCents, currency: bundle.offers[0]?.currency ?? "USD", digest: session.approval.bundleDigest },
    approval: session.approval,
    paypal: { orderId: session.capture.id, captureId: session.capture.captureId, amount: session.capture.amount, environment: "sandbox" },
    payouts: payouts && { batchId: payouts.batchId, status: payouts.status, totalCents: payouts.totalCents, currency: payouts.currency, lines: payouts.lines.map((l) => ({ assetId: l.assetId, licensor: l.licensorName, amountCents: l.amountCents, status: l.status })) },
    comparison,
    ledger: { events, head: events.at(-1)!.hash },
  };
}

export interface PassportCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const cents = (value: string) => Math.round(Number(value) * 100);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Re-check a passport from nothing but its own contents. Runs in a browser or in Node (WebCrypto):
 * it recomputes every hash, re-runs the rules engine on the exact terms, and compares the payment
 * and payout records with the hash-chained ledger. It proves the record is internally consistent
 * and untampered; the server signature (checked separately) proves who issued it.
 */
export async function verifyPassport(p: Passport): Promise<{ ok: boolean; checks: PassportCheck[] }> {
  const checks: PassportCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail });
  const events = p.ledger.events;

  const chain = await verifyChainAsync(events, sha256Hex);
  add("ledger-chain", "Ledger hash chain", chain && events.at(-1)?.hash === p.ledger.head, chain ? `${events.length} events, each linked to the one before` : "A ledger event was changed, removed or reordered");

  const digest = await sha256Hex(bundleCanonical(p.bundle.offers));
  add("bundle-digest", "Approved bundle matches what was bought", digest === p.bundle.digest && digest === p.approval.bundleDigest, `SHA-256 ${digest.slice(0, 16)}…`);

  const approved = events.find((e) => e.kind === "approved");
  const verified = events.find((e) => e.kind === "verified");
  const chosenIds = p.bundle.offers.map((o) => o.id).sort();
  add(
    "approval-recorded",
    "Approval and verification recorded in the ledger",
    approved?.payload.bundleDigest === p.bundle.digest && approved?.payload.approvedBy === p.approval.approvedBy && same([...((verified?.payload.offerIds as string[]) ?? [])].sort(), chosenIds),
    `Approved by ${p.approval.approvedBy}`,
  );

  const extracted = new Map(events.filter((e) => e.kind === "extracted").map((e) => [e.payload.offerId as string, e.payload]));
  const mismatched = p.bundle.offers.filter((o) => {
    const rec = extracted.get(o.id);
    return !rec || !same(rec.terms, o.terms) || !same(rec.evidence, o.evidence) || rec.priceCents !== o.priceCents;
  });
  add("terms-in-ledger", "Terms and evidence match the ledger", mismatched.length === 0, mismatched.length ? `Differs from the ledger: ${mismatched.map((o) => o.id).join(", ")}` : "Every term, price and quote was recorded when the licence was read");

  let located = 0;
  let total = 0;
  for (const offer of p.bundle.offers) {
    const doc = p.documents.find((d) => d.id === offer.evidence[0]?.documentId);
    for (const e of offer.evidence) {
      total++;
      if (doc && e.start !== undefined && e.end !== undefined && collapse(doc.text.slice(e.start, e.end)) === collapse(e.quote)) located++;
    }
  }
  add("evidence", "Every quote appears in the licence text", total > 0 && located === total, `${located} of ${total} quotes found at their recorded position`);

  const rules = verifyBundle(p.project, p.requiredAssetIds, { offers: p.bundle.offers }, { today: p.runDate });
  add("rules", "Rules engine agrees", rules.ok, rules.ok ? "Re-run in this browser on the exact terms: no violations" : rules.violations.map((v) => v.message).join("; "));

  const sum = p.bundle.offers.reduce((n, o) => n + o.priceCents, 0);
  const captured = events.find((e) => e.kind === "captured");
  const capturedAmount = captured?.payload.amount as { currency: string; value: string } | undefined;
  add(
    "payment",
    "PayPal capture matches the bundle total",
    sum === p.bundle.totalCents && captured?.payload.captureId === p.paypal.captureId && capturedAmount?.currency === p.bundle.currency && cents(capturedAmount.value) === p.bundle.totalCents && cents(p.paypal.amount.value) === p.bundle.totalCents,
    `Capture ${p.paypal.captureId} for ${p.paypal.amount.value} ${p.paypal.amount.currency}`,
  );

  if (p.payouts) {
    const lineSum = p.payouts.lines.reduce((n, l) => n + l.amountCents, 0);
    const recorded = events.find((e) => e.kind === "payout_created");
    add("payouts", "Creator payouts add up to the payment", lineSum === p.payouts.totalCents && lineSum === p.bundle.totalCents && recorded?.payload.batchId === p.payouts.batchId, `${p.payouts.lines.length} creators, batch ${p.payouts.batchId}`);
  }

  return { ok: checks.every((c) => c.ok), checks };
}
