import type { Transaction } from "../storage/database";
import type { PrivateRuntime } from "./runtime";
import type { PurchaseDetails } from "./types";
import { AccessError } from "../auth/identity";

export interface PayPalEvent {
  id: string;
  event_type: string;
  resource: Record<string, unknown>;
}

/** Event types that change money or standing and therefore must never be dropped for want of a match. */
const FINANCIAL = /^(CHECKOUT\.ORDER\.APPROVED|PAYMENT\.CAPTURE\.(REFUNDED|REVERSED)|PAYMENT\.PAYOUT)/;

/**
 * Applies a verified event inside the caller's transaction. A financial event that matches no purchase yet (it can
 * arrive before the provider id is committed) stays queued for the sweeper instead of being marked processed.
 */
export async function applyWebhook(rt: PrivateRuntime, tx: Transaction, event: PayPalEvent): Promise<boolean> {
  let matched = !FINANCIAL.test(event.event_type);
  if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
    const purchase = (await tx.query("SELECT run_id,sealed FROM licensegraph.purchases WHERE order_id=$1", [String(event.resource.id)]))
      .rows[0];
    if (purchase) {
      matched = true;
      const details = rt.cipher.open<PurchaseDetails>(purchase.sealed, `purchase:${purchase.run_id}`);
      const units = event.resource.purchase_units as { custom_id?: string }[] | undefined;
      if (units?.[0]?.custom_id !== details.authorizationDigest) throw new AccessError("Webhook purchase authorization mismatch.");
      await rt.runs.lock(purchase.run_id, tx);
      const job = await rt.queue.enqueue(tx, purchase.run_id, "capture", "initial");
      // A capture that waited for the buyer is safe to run again now that the buyer has approved.
      if (job.status === "failed" && job.errorCode === "ORDER_NOT_APPROVED")
        await tx.query("UPDATE licensegraph.operations SET status='queued',error_code=NULL,available_at=now() WHERE id=$1", [job.id]);
    }
  } else if (event.event_type === "PAYMENT.CAPTURE.REFUNDED" || event.event_type === "PAYMENT.CAPTURE.REVERSED") {
    const related = event.resource.supplementary_data as { related_ids?: { capture_id?: string } } | undefined;
    const links = Array.isArray(event.resource.links) ? (event.resource.links as { rel?: string; href?: string }[]) : [];
    const captureId =
      related?.related_ids?.capture_id ?? /\/captures\/([A-Za-z0-9-]+)/.exec(links.find((link) => link.rel === "up")?.href ?? "")?.[1];
    const purchase = captureId && (await tx.query("SELECT run_id FROM licensegraph.purchases WHERE capture_id=$1", [captureId])).rows[0];
    if (purchase) {
      matched = true;
      const loaded = await rt.runs.lock(purchase.run_id, tx);
      if (
        !loaded.session.refund &&
        !loaded.session.ledger.events().some((e) => e.kind === "payment_reversed" && e.payload.eventId === event.id)
      ) {
        loaded.session.ledger.append("payment_reversed", { eventId: event.id, captureId, reason: event.event_type });
        await rt.runs.save(loaded, tx);
        await tx.query("UPDATE licensegraph.purchases SET payout_state='reconcile' WHERE run_id=$1", [purchase.run_id]);
        await tx.query("UPDATE licensegraph.operations SET status='canceled' WHERE run_id=$1 AND kind='payout' AND status='queued'", [
          purchase.run_id,
        ]);
        await tx.query("UPDATE licensegraph.share_grants SET revoked_at=now() WHERE run_id=$1 AND revoked_at IS NULL", [purchase.run_id]);
      }
    }
  } else if (event.event_type.startsWith("PAYMENT.PAYOUT")) {
    const batch = event.resource.batch_header as { payout_batch_id?: string } | undefined;
    const batchId = batch?.payout_batch_id ?? event.resource.payout_batch_id;
    if (typeof batchId === "string") {
      const purchase = (await tx.query("SELECT run_id FROM licensegraph.purchases WHERE payout_batch_id=$1", [batchId])).rows[0];
      if (purchase) {
        matched = true;
        await rt.runs.lock(purchase.run_id, tx);
        await rt.queue.enqueue(tx, purchase.run_id, "refresh", `webhook:${event.id}`, { attempt: 0 });
      }
    }
  }
  await tx.query("UPDATE licensegraph.webhook_deliveries SET status=$2,attempts=attempts+1,last_attempt_at=now() WHERE event_id=$1", [
    event.id,
    matched ? "processed" : "queued",
  ]);
  return matched;
}

/**
 * Re-applies deliveries that matched nothing when they arrived. After a day an unmatched financial event is escalated
 * to 'reconcile' so staff see it; it is never discarded.
 */
export async function processPendingWebhooks(rt: PrivateRuntime, limit = 25): Promise<number> {
  const pending = await rt.db.pool.query(
    "SELECT event_id,sealed,created_at FROM licensegraph.webhook_deliveries WHERE status='queued' AND created_at < now() - interval '5 seconds' AND (last_attempt_at IS NULL OR last_attempt_at < now() - interval '5 seconds') ORDER BY created_at LIMIT $1",
    [limit],
  );
  let applied = 0;
  for (const row of pending.rows) {
    try {
      await rt.db.transaction(async (tx) => {
        const locked = await tx.query(
          "SELECT 1 FROM licensegraph.webhook_deliveries WHERE event_id=$1 AND status='queued' FOR UPDATE SKIP LOCKED",
          [row.event_id],
        );
        if (!locked.rowCount) return;
        const matched = await applyWebhook(rt, tx, rt.cipher.open<PayPalEvent>(row.sealed, `webhook:${row.event_id}`));
        if (matched) applied += 1;
        else if (Date.now() - new Date(row.created_at).getTime() > 86_400_000)
          await tx.query("UPDATE licensegraph.webhook_deliveries SET status='reconcile' WHERE event_id=$1", [row.event_id]);
      });
    } catch {
      console.error(JSON.stringify({ event: "webhook_retry_failed", id: row.event_id }));
    }
  }
  return applied;
}
