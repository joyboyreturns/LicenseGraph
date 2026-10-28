/**
 * The browser-safe half of the ledger: event shape, canonical text and chain verification using a
 * caller-supplied SHA-256. No Node imports, so the Licence Passport can be verified in a browser.
 */
export type LedgerKind =
  | "extracted"
  | "extraction_failed"
  | "proposed"
  | "rejected"
  | "revised"
  | "verified"
  | "proposal_error"
  | "handed_over"
  | "approved"
  | "order_created"
  | "captured"
  | "capture_mismatch"
  | "payout_created"
  | "payout_failed"
  | "payout_settled";

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
