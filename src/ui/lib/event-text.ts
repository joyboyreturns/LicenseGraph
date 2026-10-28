/** One-line, plain-language descriptions of every ledger event kind. */
import type { LedgerEvent, LedgerKind } from "@/src/ledger/chain";
import type { Catalog } from "./catalog";
import { formatMoney, pluralise } from "./format";

export const KIND_LABEL: Record<LedgerKind, string> = {
  extracted: "Licence read",
  extraction_failed: "Licence unreadable",
  proposed: "Agent proposed",
  revised: "Agent revised",
  rejected: "Rules engine rejected",
  verified: "Rules engine verified",
  proposal_error: "Proposal unusable",
  approved: "Human approved",
  order_created: "PayPal order created",
  captured: "Payment captured",
  capture_mismatch: "Capture did not match the approval",
  payout_created: "Creator payouts sent",
  payout_failed: "Creator payouts failed",
  payout_settled: "Creator payouts settled",
};

/** Who acted: the model, the deterministic verifier, a person, or the payment rail. */
export function eventActor(kind: LedgerKind | string): "agent" | "engine" | "human" | "payment" {
  if (kind === "extracted" || kind === "extraction_failed" || kind === "proposed" || kind === "revised" || kind === "proposal_error") return "agent";
  if (kind === "rejected" || kind === "verified") return "engine";
  if (kind === "approved") return "human";
  return "payment";
}

export function eventTitle(e: Pick<LedgerEvent, "kind" | "payload">, catalog?: Pick<Catalog, "docs">): string {
  const p = e.payload;
  const round = typeof p.round === "number" ? `Round ${p.round}: ` : "";
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  switch (e.kind) {
    case "extracted": {
      const doc = catalog?.docs.get(String(p.documentId));
      return `Read ${doc ? `${doc.licensor}, ${doc.title}` : String(p.documentId ?? "licence")}${typeof p.priceCents === "number" ? ` (${formatMoney(p.priceCents, "USD", { trim: true })})` : ""}`;
    }
    case "extraction_failed":
      return `Could not verify the terms of ${catalog?.docs.get(String(p.documentId))?.licensor ?? String(p.documentId ?? "a licence")}`;
    case "proposed":
      return `${round}agent proposed ${pluralise(count(p.offerIds), "licence")}`;
    case "revised":
      return `${round}agent revised its proposal`;
    case "rejected":
      return `${round}rules engine rejected it, ${pluralise(count(p.violations), "violation")}`;
    case "verified":
      return `${round}rules engine verified the bundle${typeof p.totalCents === "number" ? `, ${formatMoney(p.totalCents)}` : ""}`;
    case "proposal_error":
      return `${round}proposal could not be used`;
    case "approved":
      return `Approved by ${String(p.approvedBy ?? "a person")}`;
    case "order_created":
      return `Order ${String(p.orderId ?? "")} created`;
    case "captured":
      return `Payment captured${p.amount && typeof p.amount === "object" ? `: ${(p.amount as { value?: string }).value ?? ""} ${(p.amount as { currency?: string }).currency ?? ""}` : ""}`;
    case "capture_mismatch":
      return "Capture did not match the approved order; no creators were paid";
    case "payout_created":
      return `Payouts sent to ${pluralise(count(p.lines), "creator")}`;
    case "payout_failed":
      return "Creator payouts failed; the payment stays captured";
    case "payout_settled":
      return `Creator payouts ${String(p.status ?? "settled").toLowerCase()}`;
    default:
      return String(e.kind);
  }
}
