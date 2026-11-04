import { staffOnly, type Principal } from "../auth/identity";
import { canonicalJson } from "../core/digest";
import { centsToValue } from "../payments/paypal";
import { applyPayoutStatus, type PayoutSummary } from "../payments/payouts";
import type { PayoutStatus } from "../payments/paypal";
import { hashSecret } from "../storage/crypto";
import { ConflictError } from "../storage/runs";
import type { PrivateRuntime } from "./runtime";
import type { PurchaseDetails } from "./types";

export function assertPayoutMatches(summary: PayoutSummary, status: PayoutStatus, requireAmounts = true, senderKey?: string) {
  if (summary.batchId !== status.batchId || status.items.length !== summary.lines.length || new Set(status.items.map((i) => i.itemId)).size !== summary.lines.length) throw new ConflictError("Provider payout items do not match the immutable plan.");
  if (senderKey && status.senderBatchId !== senderKey) throw new ConflictError("Provider sender batch does not match the original operation.");
  for (const line of summary.lines) {
    const item = status.items.find((i) => i.itemId === line.offerId);
    if (!item || item.receiver?.toLowerCase() !== line.email.toLowerCase()) throw new ConflictError("Provider payout recipient does not match the immutable plan.");
    if ((requireAmounts || item.amount) && (item.amount?.currency !== line.currency || item.amount.value !== centsToValue(line.amountCents))) throw new ConflictError("Provider payout amount does not match the immutable plan.");
  }
}

/** Reconciliation only reads provider records. It never sends or repeats a payment. */
export async function reconcileOperation(rt: PrivateRuntime, principal: Principal, operationId: string, providerId: string, reason: string) {
  staffOnly(principal);
  const job = await rt.queue.get(operationId);
  if (!job || job.status !== "reconcile") throw new ConflictError("Only uncertain operations can be reconciled.");
  if (job.kind === "pipeline" || job.kind === "webhook" || job.kind === "refresh") throw new ConflictError("This operation needs manual review; no financial resubmission is permitted.");
  const payments = rt.deps.payments;
  let order: Awaited<ReturnType<NonNullable<NonNullable<typeof payments>["inspectOrder"]>>> | undefined;
  let refund: Awaited<ReturnType<NonNullable<NonNullable<typeof payments>["inspectRefund"]>>> | undefined;
  let payout: PayoutStatus | undefined;
  if (job.kind === "order" || job.kind === "capture") {
    if (!payments?.inspectOrder) throw new ConflictError("Sandbox order inspection is unavailable.");
    order = await payments.inspectOrder(providerId);
  } else if (job.kind === "refund") {
    if (!payments?.inspectRefund) throw new ConflictError("Sandbox refund inspection is unavailable.");
    refund = await payments.inspectRefund(providerId);
  } else if (job.kind === "payout") {
    if (!payments?.getPayout) throw new ConflictError("Sandbox payout inspection is unavailable.");
    payout = await payments.getPayout(providerId);
  }
  return rt.db.transaction(async (tx) => {
    const loaded = await rt.runs.lock(job.runId, tx);
    const current = (await tx.query("SELECT status FROM licensegraph.operations WHERE id=$1 FOR UPDATE", [job.id])).rows[0];
    if (current?.status !== "reconcile") throw new ConflictError("Operation changed during reconciliation.");
    const row = (await tx.query("SELECT * FROM licensegraph.purchases WHERE run_id=$1 FOR UPDATE", [job.runId])).rows[0];
    if (!row) throw new ConflictError("Human purchase authorization is missing.");
    const details = rt.cipher.open<PurchaseDetails>(row.sealed, `purchase:${job.runId}`);
    const a = details.authorization;
    if (hashSecret(canonicalJson(a)) !== details.authorizationDigest) throw new ConflictError("Purchase authorization was altered.");
    const s = loaded.session;
    const amount = { currency: a.offers[0]!.currency, value: centsToValue(a.offers.reduce((n,o) => n+o.priceCents,0)) };
    if (order) {
      if (order.customId !== details.authorizationDigest || canonicalJson(order.amount) !== canonicalJson(amount) || s.order && s.order.id !== order.id || job.kind === "capture" && order.capture?.status !== "COMPLETED") throw new ConflictError("Sandbox order does not prove the authorized purchase.");
      if (!s.order) {
        s.order = { id: order.id, status: order.status, approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${encodeURIComponent(order.id)}` };
        s.ledger.append("order_created", { orderId: order.id, status: order.status });
      }
      s.paymentsMode = "paypal-sandbox";
      s.phase = "order_created";
      await tx.query("UPDATE licensegraph.purchases SET order_id=$1,payout_state='held' WHERE run_id=$2", [order.id,job.runId]);
      if (order.capture) {
        if (order.capture.status !== "COMPLETED" || !order.capture.captureId || canonicalJson(order.capture.amount) !== canonicalJson(amount)) throw new ConflictError("Capture is not completed for the approved total.");
        if (!s.capture) s.ledger.append("captured", { orderId: order.id, captureId: order.capture.captureId, amount: order.capture.amount });
        s.capture = order.capture;
        s.phase = "captured";
        await tx.query("UPDATE licensegraph.purchases SET capture_id=$1,captured_at=COALESCE(captured_at,now()),release_at=COALESCE(release_at,now()+interval '7 days') WHERE run_id=$2", [s.capture.captureId,job.runId]);
        await rt.queue.enqueue(tx,job.runId,"payout","release",null,new Date(Date.now()+7*86_400_000));
      }
    }
    if (refund) {
      if (refund.status !== "COMPLETED" || refund.captureId !== s.capture?.captureId || canonicalJson(refund.amount) !== canonicalJson(amount)) throw new ConflictError("Sandbox refund does not prove a completed full refund of this capture.");
      if (!s.refund) s.ledger.append("refunded", { refundId: refund.id, captureId: refund.captureId, amount: refund.amount, reason: "Provider refund reconciled" });
      s.refund = { id: refund.id, status: refund.status, amount: refund.amount!, at: new Date().toISOString() };
      s.phase = "refunded";
      await tx.query("UPDATE licensegraph.purchases SET payout_state='refunded' WHERE run_id=$1", [job.runId]);
      await tx.query("UPDATE licensegraph.operations SET status='canceled' WHERE run_id=$1 AND kind='payout' AND status='queued'", [job.runId]);
    }
    if (payout) {
      if (!s.payouts) throw new ConflictError("Original recipient plan is missing.");
      const original = { ...s.payouts, batchId: payout.batchId };
      assertPayoutMatches(original,payout,true,job.externalKey);
      s.payouts = applyPayoutStatus(original,payout);
      if (!s.ledger.events().some((e) => e.kind === "payout_created" && e.payload.batchId === payout!.batchId)) s.ledger.append("payout_created", { batchId: payout.batchId, status: payout.status, totalCents: original.totalCents, currency: original.currency, lines: original.lines.map((l) => ({assetId:l.assetId,licensor:l.licensorName,amountCents:l.amountCents})) });
      if (s.payouts.status === "SUCCESS") { s.phase="settled"; s.ledger.append("payout_settled", {batchId:payout.batchId,status:s.payouts.status,lines:s.payouts.lines.map((l)=>({assetId:l.assetId,status:l.status}))}); }
      await tx.query("UPDATE licensegraph.purchases SET payout_state=$1,payout_batch_id=$2 WHERE run_id=$3", [s.phase === "settled" ? "settled" : "submitted",payout.batchId,job.runId]);
      if (s.phase !== "settled") await rt.queue.enqueue(tx,job.runId,"refresh",`reconciled:${job.id}`,{attempt:0});
    }
    await rt.runs.save(loaded,tx);
    await tx.query("UPDATE licensegraph.operations SET status='succeeded',stage='recorded',error_code=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[job.id]);
    await rt.runs.audit(tx,principal.id,"operation_reconciled",job.runId,{operationId:job.id,providerId,reason});
    return { id:job.id,status:"succeeded",runId:job.runId };
  });
}
