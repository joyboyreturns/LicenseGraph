/**
 * Group the ledger into what people read as a story: the licences that were read, then one entry per
 * round of propose → verify, then what happened after (approval, payment, payouts).
 */
import type { LedgerEvent } from "@/src/ledger/chain";
import type { LicenseTerms, Violation } from "@/src/core/types";

export interface ReadSummary {
  read: { seq: number; documentId: string; assetId: string; offerId: string; priceCents: number; terms?: LicenseTerms; quotes: number }[];
  failed: { seq: number; documentId: string; assetId: string; problems: string[] }[];
  quotes: number;
}

export interface Round {
  round: number;
  proposal?: { seq: number; kind: "proposed" | "revised"; offerIds: string[]; rationale?: string };
  verdict?:
    | { seq: number; status: "rejected"; violations: Violation[] }
    | { seq: number; status: "verified"; offerIds: string[]; totalCents: number };
  /** The proposal could not be used at all (unknown ids, model error). */
  error?: { seq: number; message: string; offerIds?: string[] };
  /** The agent repeated a bundle that was already rejected, so the loop stopped. */
  repeated?: boolean;
}

export interface Story {
  reading: ReadSummary;
  rounds: Round[];
  after: LedgerEvent[];
}

const LOOP_KINDS = new Set(["proposed", "revised", "rejected", "verified", "proposal_error"]);
const AFTER_KINDS = new Set(["approved", "order_created", "captured", "capture_mismatch", "refunded", "payout_created", "payout_failed", "payout_settled"]);

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const asNumber = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const asViolations = (v: unknown): Violation[] =>
  Array.isArray(v) ? v.filter((x): x is Violation => typeof x === "object" && x !== null && typeof (x as Violation).message === "string" && typeof (x as Violation).rule === "string") : [];

export const isLoopEvent = (e: Pick<LedgerEvent, "kind">) => LOOP_KINDS.has(e.kind);

/**
 * `loopStatus` comes from the session: "stalled" means the last proposal repeated a rejected
 * bundle and was never re-verified, which the ledger alone cannot show.
 */
export function buildStory(events: readonly LedgerEvent[], loopStatus?: string): Story {
  const reading: ReadSummary = { read: [], failed: [], quotes: 0 };
  const rounds: Round[] = [];
  const after: LedgerEvent[] = [];
  const roundFor = (n: number): Round => {
    let r = rounds.find((x) => x.round === n);
    if (!r) {
      r = { round: n };
      rounds.push(r);
    }
    return r;
  };
  const nextRound = () => (rounds.at(-1)?.round ?? 0) + 1;

  for (const e of events) {
    const p = e.payload;
    switch (e.kind) {
      case "extracted": {
        const quotes = Array.isArray(p.evidence) ? p.evidence.length : 0;
        reading.quotes += quotes;
        reading.read.push({ seq: e.seq, documentId: String(p.documentId ?? ""), assetId: String(p.assetId ?? ""), offerId: String(p.offerId ?? ""), priceCents: asNumber(p.priceCents), terms: p.terms as LicenseTerms | undefined, quotes });
        break;
      }
      case "extraction_failed":
        reading.failed.push({ seq: e.seq, documentId: String(p.documentId ?? ""), assetId: String(p.assetId ?? ""), problems: asStrings(p.problems) });
        break;
      case "proposed":
      case "revised": {
        const r = roundFor(asNumber(p.round, nextRound()));
        r.proposal = { seq: e.seq, kind: e.kind, offerIds: asStrings(p.offerIds), rationale: typeof p.rationale === "string" && p.rationale ? p.rationale : undefined };
        break;
      }
      case "rejected": {
        const r = roundFor(asNumber(p.round, rounds.at(-1)?.round ?? 1));
        r.verdict = { seq: e.seq, status: "rejected", violations: asViolations(p.violations) };
        break;
      }
      case "verified": {
        const r = roundFor(asNumber(p.round, rounds.at(-1)?.round ?? 1));
        r.verdict = { seq: e.seq, status: "verified", offerIds: asStrings(p.offerIds), totalCents: asNumber(p.totalCents) };
        break;
      }
      case "proposal_error": {
        const r = roundFor(asNumber(p.round, nextRound()));
        r.error = { seq: e.seq, message: typeof p.error === "string" ? p.error : "The proposal could not be used.", offerIds: Array.isArray(p.offerIds) ? asStrings(p.offerIds) : undefined };
        break;
      }
      default:
        if (AFTER_KINDS.has(e.kind)) after.push(e);
    }
  }

  rounds.sort((a, b) => a.round - b.round);
  const last = rounds.at(-1);
  if (loopStatus === "stalled" && last?.proposal && !last.verdict && !last.error) last.repeated = true;
  return { reading, rounds, after };
}

/** Violations grouped by offer (bundle-level ones under the key ""), keeping engine order. */
export function violationsByOffer(violations: readonly Violation[]): Map<string, Violation[]> {
  const out = new Map<string, Violation[]>();
  for (const v of violations) {
    const key = v.offerId ?? "";
    const list = out.get(key) ?? [];
    list.push(v);
    out.set(key, list);
  }
  return out;
}
