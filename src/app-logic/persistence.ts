import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Ledger, type LedgerEvent } from "../ledger/ledger";
import type { Phase, Session, SessionInput } from "./session";

const ACTIVE: Phase[] = ["created", "extracting", "proposing"];

/** Everything about a run that can be written as JSON. The ledger is stored as its events. */
export interface StoredSession {
  v: 1;
  id: string;
  ownerId?: string;
  createdAt: string;
  runDate?: string;
  input: SessionInput;
  phase: Phase;
  failure?: string;
  candidates: Session["candidates"];
  loop?: Session["loop"];
  approval?: Session["approval"];
  order?: Session["order"];
  capture?: Session["capture"];
  payouts?: Session["payouts"];
  refund?: Session["refund"];
  paymentsMode?: Session["paymentsMode"];
  claim?: Session["claim"];
  payoutBlockedAssets?: Session["payoutBlockedAssets"];
  events: LedgerEvent[];
}

export function serializeSession(s: Session): StoredSession {
  return {
    v: 1,
    id: s.id,
    ownerId: s.ownerId,
    createdAt: s.createdAt,
    runDate: s.runDate,
    input: s.input,
    phase: s.phase,
    failure: s.failure,
    candidates: s.candidates,
    loop: s.loop,
    approval: s.approval,
    order: s.order,
    capture: s.capture,
    payouts: s.payouts,
    refund: s.refund,
    paymentsMode: s.paymentsMode,
    claim: s.claim,
    payoutBlockedAssets: s.payoutBlockedAssets,
    events: s.ledger.events(),
  };
}

/** Rebuild a session. A run that was still working when the server stopped cannot resume, so it is marked failed. */
export function deserializeSession(stored: StoredSession): Session {
  if (stored.v !== 1) throw new Error(`Unknown session format ${String(stored.v)}`);
  const ledger = Ledger.fromEvents(stored.events);
  const session: Session = {
    id: stored.id,
    ownerId: stored.ownerId,
    createdAt: stored.createdAt,
    runDate: stored.runDate,
    input: stored.input,
    ledger,
    phase: stored.phase,
    failure: stored.failure,
    candidates: stored.candidates,
    loop: stored.loop,
    approval: stored.approval,
    order: stored.order,
    capture: stored.capture,
    payouts: stored.payouts,
    refund: stored.refund,
    paymentsMode: stored.paymentsMode,
    claim: stored.claim,
    payoutBlockedAssets: stored.payoutBlockedAssets,
  };
  if (ACTIVE.includes(session.phase)) {
    session.phase = "failed";
    session.failure = "This run was interrupted by a server restart. Start it again.";
  }
  // Unpaid legacy approvals covered prices only. Ask the owner to approve the full terms once
  // before creating a new order; historical paid passports retain their original digest format.
  if (session.phase === "approved" && session.approval?.digestVersion !== 2 && !session.order && !session.capture) {
    session.phase = "verified";
    session.approval = undefined;
  }
  ledger.onAppend = () => session.onChange?.();
  return session;
}

export interface SessionRepository {
  save(session: Session): void;
  loadAll(): Session[];
}

const SAFE_ID = /^[a-zA-Z0-9-]{8,64}$/;

/** One JSON file per run, written atomically (temp file, then rename) so a crash never leaves half a file. */
export class FileSessionRepository implements SessionRepository {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  save(session: Session): void {
    if (!SAFE_ID.test(session.id)) throw new Error("Refusing to store a session with an unsafe id");
    const file = join(this.dir, `${session.id}.json`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(serializeSession(session)));
    renameSync(tmp, file);
  }

  /** Corrupt or tampered files are skipped, not fatal: one bad run must not stop the server. */
  loadAll(): Session[] {
    const sessions: Session[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        sessions.push(deserializeSession(JSON.parse(readFileSync(join(this.dir, name), "utf8")) as StoredSession));
      } catch {
        // skipped
      }
    }
    return sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
