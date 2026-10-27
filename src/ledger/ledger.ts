import { createHash } from "node:crypto";

export type LedgerKind =
  | "extracted"
  | "extraction_failed"
  | "proposed"
  | "rejected"
  | "revised"
  | "verified"
  | "proposal_error"
  | "approved"
  | "order_created"
  | "captured";

export interface LedgerEvent {
  seq: number;
  at: string;
  kind: LedgerKind;
  /** Must be JSON-serialisable. */
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

const hashOf = (e: Omit<LedgerEvent, "hash">) =>
  createHash("sha256").update(JSON.stringify([e.seq, e.at, e.kind, e.payload, e.prevHash])).digest("hex");

/** Recompute every hash and link; false if any event was changed, removed, reordered or inserted. */
export function verifyChain(events: readonly LedgerEvent[]): boolean {
  let prev = GENESIS;
  return events.every((e, i) => {
    const ok = e.seq === i + 1 && e.prevHash === prev && e.hash === hashOf(e);
    prev = e.hash;
    return ok;
  });
}

/**
 * Append-only, hash-chained event log. In memory for now; the dashboard reads `events()`.
 * Callers only ever get copies, so a recorded event cannot be edited in place.
 */
export class Ledger {
  private log: LedgerEvent[] = [];

  constructor(private readonly clock: () => Date = () => new Date()) {}

  append(kind: LedgerKind, payload: Record<string, unknown> = {}): LedgerEvent {
    const prev = this.log.at(-1);
    const body = {
      seq: this.log.length + 1,
      at: this.clock().toISOString(),
      kind,
      payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
      prevHash: prev?.hash ?? GENESIS,
    };
    const event: LedgerEvent = { ...body, hash: hashOf(body) };
    this.log.push(event);
    return structuredClone(event);
  }

  events(): LedgerEvent[] {
    return structuredClone(this.log);
  }

  verify(): boolean {
    return verifyChain(this.log);
  }
}
