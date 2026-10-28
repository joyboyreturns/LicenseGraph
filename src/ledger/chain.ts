/**
 * The browser-safe half of the ledger: event shape, canonical text and chain verification using a
 * caller-supplied SHA-256. No Node imports, so the Licence Passport can be verified in a browser.
 */
/** Every kind of event the ledger records. The one list the type, the API schema and the UI labels are checked against. */
export const LEDGER_KINDS = [
  "extracted",
  "extraction_failed",
  "proposed",
  "rejected",
  "revised",
  "verified",
  "proposal_error",
  "handed_over",
  "approved",
  "order_created",
  "captured",
  "capture_mismatch",
  "refunded",
  "payment_reversed",
  "payout_created",
  "payout_failed",
  "payout_settled",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export interface LedgerEvent {
  seq: number;
  at: string;
  kind: LedgerKind;
  /** Must be JSON-serialisable. */
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export const GENESIS_HASH = "0".repeat(64);

/** The exact text hashed for an event; shared by the server and the browser-side verifier. */
export const eventCanonical = (e: Omit<LedgerEvent, "hash">) => JSON.stringify([e.seq, e.at, e.kind, e.payload, e.prevHash]);

export async function verifyChainAsync(events: readonly LedgerEvent[], sha256: (text: string) => Promise<string>): Promise<boolean> {
  let prev = GENESIS_HASH;
  for (const [i, e] of events.entries()) {
    if (e.seq !== i + 1 || e.prevHash !== prev || e.hash !== (await sha256(eventCanonical(e)))) return false;
    prev = e.hash;
  }
  return true;
}
