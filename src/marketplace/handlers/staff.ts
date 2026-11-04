import { AccessError, staffOnly, type Principal } from "../../auth/identity";
import type { PrivateRuntime } from "../runtime";
import { ConflictError } from "../../storage/runs";
import type { Operation } from "../../storage/jobs";
import { Req } from "../contract";
import type { MarketplaceContext } from "./context";
import { json, publicOperation, readable, readJson, uuid } from "./common";

/** Reviews, dispute resolution and reconciliation. Every route here requires staff with a second factor. */
export async function handleStaff({ rt, principal, request, area, id, action }: MarketplaceContext): Promise<Response | undefined> {
  if (area === "staff") {
    staffOnly(principal);
    if (id === "reviews" && request.method === "GET") {
      const licensors = await rt.db.pool.query("SELECT * FROM licensegraph.licensors ORDER BY reviewed_at NULLS FIRST LIMIT 200");
      const offers = await rt.db.pool.query("SELECT * FROM licensegraph.offers WHERE status='pending' LIMIT 200");
      const disputes = await rt.db.pool.query("SELECT * FROM licensegraph.disputes WHERE status IN ('open','escalated') LIMIT 200");
      const operations = await rt.db.pool.query(
        "SELECT id,run_id,kind,status,stage,error_code FROM licensegraph.operations WHERE status='reconcile' LIMIT 200",
      );
      return json({
        licensors: readable("staff_licensors", licensors.rows, (row) => ({
          id: row.id,
          userId: row.user_id,
          version: row.version,
          status: row.status,
          recipientConfirmed: Boolean(row.recipient_confirmed_at),
          details: rt.cipher.open(row.sealed, `licensor:${row.id}:${row.version}`),
        })),
        offers: readable("staff_offers", offers.rows, (row) => ({
          id: row.id,
          version: row.version,
          ...rt.cipher.open<object>(row.sealed, `offer:${row.id}:${row.version}`),
        })),
        disputes: readable("staff_disputes", disputes.rows, (row) => ({
          id: row.id,
          runId: row.run_id,
          status: row.status,
          details: rt.cipher.open(row.sealed, `dispute:${row.id}`),
        })),
        operations: operations.rows,
      });
    }
    if (id === "licensors" && action && request.method === "POST") {
      const body = Req.LicensorReview.parse(await readJson(request));
      return json(await rt.market.reviewLicensor(principal, uuid.parse(action), body.decision, body.reason));
    }
    if (id === "offers" && action && request.method === "POST") {
      const body = Req.OfferReview.parse(await readJson(request));
      return json(await rt.market.reviewOffer(principal, uuid.parse(action), body.version, body.decision, body.reason));
    }
    if (id === "disputes" && action && request.method === "POST") {
      const body = Req.DisputeResolution.parse(await readJson(request));
      return json(await resolveDispute(rt, principal, uuid.parse(action), body));
    }
    if (id === "reconcile" && action && request.method === "POST") {
      const body = Req.Reconciliation.parse(await readJson(request));
      const { reconcileOperation } = await import("../reconcile");
      return json(await reconcileOperation(rt, principal, uuid.parse(action), body.providerId, body.reason));
    }
    if (id === "assign-legacy" && request.method === "POST") {
      const body = Req.AssignLegacy.parse(await readJson(request));
      await rt.db.transaction(async (tx) => {
        const updated = await tx.query("UPDATE licensegraph.runs SET owner_id=$1,legacy_owner_hash=NULL WHERE id=$2 AND owner_id IS NULL", [
          body.ownerId,
          body.runId,
        ]);
        if (!updated.rowCount) throw new ConflictError("Only unassigned imported runs can be assigned.");
        await rt.runs.audit(tx, principal.id, "legacy_owner_assigned", body.runId, { ownerId: body.ownerId, reason: body.reason });
      });
      return json({ assigned: true });
    }
  }
  return undefined;
}

async function resolveDispute(
  rt: PrivateRuntime,
  principal: Principal,
  id: string,
  body: { decision: "release" | "refund" | "escalate"; reason: string },
) {
  return rt.db.transaction(async (tx) => {
    const ref = (await tx.query("SELECT run_id FROM licensegraph.disputes WHERE id=$1", [id])).rows[0];
    if (!ref) throw new AccessError("Dispute not found.", 404);
    await rt.runs.lock(ref.run_id, tx);
    const dispute = (await tx.query("SELECT * FROM licensegraph.disputes WHERE id=$1 FOR UPDATE", [id])).rows[0];
    const purchase = (await tx.query("SELECT * FROM licensegraph.purchases WHERE run_id=$1 FOR UPDATE", [ref.run_id])).rows[0];
    if (!["open", "escalated"].includes(dispute.status)) throw new ConflictError("This dispute is already resolved.");
    if (body.decision !== "escalate" && purchase.payout_state !== "held")
      throw new ConflictError("Funds may already have moved. Reconcile and escalate this case.");
    const previous = rt.cipher.open<object>(dispute.sealed, `dispute:${id}`);
    const status = body.decision === "release" ? "released" : body.decision === "refund" ? "open" : "escalated";
    await tx.query(
      "UPDATE licensegraph.disputes SET status=$1,sealed=$2,resolved_by=$3,resolved_at=CASE WHEN $1='released' THEN now() ELSE NULL END WHERE id=$4",
      [status, rt.cipher.seal({ ...previous, resolution: body }, `dispute:${id}`), principal.id, id],
    );
    let operation: Operation | undefined;
    if (body.decision === "release") {
      await tx.query("UPDATE licensegraph.purchases SET accepted_at=now() WHERE run_id=$1", [ref.run_id]);
      operation = await rt.queue.enqueue(tx, ref.run_id, "payout", "release");
      await tx.query(
        "UPDATE licensegraph.operations SET status='queued',error_code=NULL,available_at=now() WHERE id=$1 AND status='failed' AND stage='waiting'",
        [operation.id],
      );
    }
    if (body.decision === "refund") {
      await tx.query("UPDATE licensegraph.operations SET status='canceled' WHERE run_id=$1 AND kind='payout' AND status='queued'", [
        ref.run_id,
      ]);
      operation = await rt.queue.enqueue(tx, ref.run_id, "refund", "initial");
    }
    await rt.runs.audit(tx, principal.id, `dispute_${body.decision}`, ref.run_id, { disputeId: id, reason: body.reason });
    return { id, status, operation: operation && publicOperation(operation) };
  });
}
