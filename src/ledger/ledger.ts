import { createHash } from "node:crypto";
import { eventCanonical, GENESIS_HASH, type LedgerEvent, type LedgerKind } from "./chain";

export { eventCanonical, GENESIS_HASH, verifyChainAsync, type LedgerEvent, type LedgerKind } from "./chain";

const GENESIS = GENESIS_HASH;

const hashOf = (e: Omit<LedgerEvent, "hash">) => createHash("sha256").update(eventCanonical(e)).digest("hex");

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

  /** Rebuild a ledger from stored events. Refuses events whose chain does not verify. */
  static fromEvents(events: readonly LedgerEvent[], clock?: () => Date): Ledger {
    if (!verifyChain(events)) throw new Error("Stored ledger failed its hash chain check");
    const ledger = new Ledger(clock);
    ledger.log = structuredClone([...events]);
    return ledger;
  }

  /** Called after every append; used to persist the run as it happens. */
  onAppend?: (event: LedgerEvent) => void;

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
    this.onAppend?.(structuredClone(event));
    return structuredClone(event);
  }

  events(): LedgerEvent[] {
    return structuredClone(this.log);
  }

  verify(): boolean {
    return verifyChain(this.log);
  }
}
