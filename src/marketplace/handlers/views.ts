import { viewOf, type Session } from "../../app-logic/session";
import { issuePassport } from "../../passport/issue";
import { signPassport } from "../../server/passport-signing";
import type { PrivateRuntime } from "../runtime";
import type { PurchaseDetails } from "../types";

export async function privateView(rt: PrivateRuntime, session: Session) {
  const pending = await rt.db.pool.query(
    "SELECT id,kind,status,error_code,available_at FROM licensegraph.operations WHERE run_id=$1 ORDER BY created_at DESC LIMIT 1",
    [session.id],
  );
  const purchase = (
    await rt.db.pool.query("SELECT payout_state,release_at,accepted_at FROM licensegraph.purchases WHERE run_id=$1", [session.id])
  ).rows[0];
  const disputes = await rt.db.pool.query(
    "SELECT id,status,created_at FROM licensegraph.disputes WHERE run_id=$1 ORDER BY created_at DESC",
    [session.id],
  );
  return {
    ...viewOf(session),
    privateMarketplace: true,
    pendingOperation:
      pending.rows[0] && ["queued", "running", "reconcile", "failed"].includes(pending.rows[0].status) ? pending.rows[0] : null,
    purchase: purchase ?? null,
    disputes: disputes.rows,
  };
}

export function summary(s: Session) {
  const view = viewOf(s);
  return {
    id: s.id,
    createdAt: s.createdAt,
    name: s.input.project.name,
    phase: s.phase,
    runKind: s.input.meta?.runKind,
    revisedFrom: s.input.meta?.revisedFrom,
    rebriefedFrom: s.input.meta?.rebriefedFrom,
    rounds: view.rounds,
    totalCents: view.bundle?.totalCents,
    currency: view.bundle?.currency,
    naiveTotalCents: view.analysis?.naiveTotalCents,
    blocked: view.analysis?.blockedPurchases.length ?? 0,
    paid: Boolean(s.capture),
  };
}

export async function passport(rt: PrivateRuntime, session: Session) {
  const p = issuePassport(session);
  const purchase = (await rt.db.pool.query("SELECT sealed FROM licensegraph.purchases WHERE run_id=$1", [session.id])).rows[0];
  const details = purchase ? rt.cipher.open<PurchaseDetails>(purchase.sealed, `purchase:${session.id}`) : undefined;
  return signPassport(
    { ...p, ...(details ? { purchaseAuthorization: { ...details.authorization, digest: details.authorizationDigest } } : {}) },
    rt.passportSecret,
  );
}
