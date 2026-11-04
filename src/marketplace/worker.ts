import { assertPayoutMatches } from "./reconcile";
import { canonicalJson } from "../core/digest";
import { runPipeline, startPayment, completePayment, refundPurchase, type Deps, type Session } from "../app-logic/session";
import { hashSecret } from "../storage/crypto";
import type { Operation } from "../storage/jobs";
import { ConflictError, type StoredRun } from "../storage/runs";
import { applyPayoutStatus, isFinalPayout, toPayoutItems, type PayoutSummary } from "../payments/payouts";
import { verifyBundle } from "../core/rules";
import type { LicenseOffer } from "../core/types";
import type { PurchaseDetails } from "./types";
import { Marketplace } from "./service";

export class MarketplaceWorker {
  constructor(
    readonly market: Marketplace,
    readonly deps: Deps,
  ) {}
  async once(): Promise<boolean> {
    const job = await this.market.queue.claim();
    if (!job) return false;
    let leaseLost = false;
    const pulse = setInterval(() => {
      void this.market.queue
        .heartbeat(job)
        .then((ok) => {
          if (!ok) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        });
    }, 10_000);
    let loaded: StoredRun | undefined;
    let submitted = false;
    // Set only when the provider definitely refused before acting (a buyer who has not approved yet): safe to try again.
    let definiteRefusal: string | undefined;
    const checkpoint = async (session: Session) => {
      if (leaseLost) throw new ConflictError("Operation lease lost.");
      await this.market.db.transaction(async (tx) => {
        await this.market.queue.assertLease(tx, job);
        await tx.query("SELECT id FROM licensegraph.runs WHERE id=$1 FOR UPDATE", [job.runId]);
        loaded!.session = session;
        await this.market.runs.save(loaded!, tx);
      });
    };
    try {
      loaded = await this.market.runs.read(job.runId);
      if (!loaded) throw new ConflictError("Run not found.");
      const s = loaded.session;
      if (job.kind === "pipeline") {
        await this.market.db.transaction(async (tx) => {
          await this.market.queue.submitted(tx, job);
        });
        submitted = true;
        const carried = job.payload as { offers?: LicenseOffer[] } | null;
        await runPipeline(
          s,
          { ...this.deps, extractionAttempts: 1, stopOnProposalError: true, checkpoint },
          carried?.offers ? { fromRunId: "marketplace", offers: carried.offers } : undefined,
        );
      } else if (job.kind === "refresh") {
        const payouts = s.payouts;
        if (!payouts || !this.deps.payments?.getPayout) throw new ConflictError("There is no payout batch to refresh.");
        const status = await this.deps.payments.getPayout(payouts.batchId);
        assertPayoutMatches(payouts, status, this.deps.paymentsMode !== "simulator");
        s.payouts = applyPayoutStatus(payouts, status);
        if (s.payouts.status === "SUCCESS") s.phase = "settled";
        if (isFinalPayout(s.payouts.status))
          s.ledger.append("payout_settled", {
            batchId: s.payouts.batchId,
            status: s.payouts.status,
            lines: s.payouts.lines.map((line) => ({ assetId: line.assetId, status: line.status })),
          });
      } else {
        if (!this.deps.payments) throw new ConflictError("Sandbox payments are not configured.");
        const prepare = async () => {
          if (leaseLost) throw new ConflictError("Operation lease lost.");
          return this.market.db.transaction(async (tx) => {
            await this.market.queue.assertLease(tx, job);
            await tx.query("SELECT id FROM licensegraph.runs WHERE id=$1 FOR UPDATE", [job.runId]);
            const purchase = (await tx.query("SELECT * FROM licensegraph.purchases WHERE run_id=$1 FOR UPDATE", [job.runId])).rows[0];
            if (!purchase) throw new ConflictError("A human purchase authorization is required.");
            const details = this.market.cipher.open<PurchaseDetails>(purchase.sealed, `purchase:${job.runId}`);
            const a = details.authorization;
            if (
              a.version !== 3 ||
              hashSecret(canonicalJson(a)) !== details.authorizationDigest ||
              canonicalJson(a.project) !== canonicalJson(s.input.project) ||
              canonicalJson(a.offers) !== canonicalJson(s.loop?.bundle?.offers) ||
              canonicalJson(a.documents) !== canonicalJson(s.input.documents) ||
              canonicalJson(a.requiredAssetIds) !== canonicalJson(s.input.requiredAssetIds)
            )
              throw new ConflictError("Purchase authorization does not match this run.");
            if (job.kind === "order" || job.kind === "capture") {
              const recipients = await this.market.recipients(tx, a.offers);
              if (canonicalJson(recipients) !== canonicalJson(a.recipients))
                throw new ConflictError("Recipients changed; approval is invalid.");
              if (!verifyBundle(a.project, a.requiredAssetIds, { offers: a.offers }, { today: new Date().toISOString().slice(0, 10) }).ok)
                throw new ConflictError("The authorized bundle no longer passes verification.");
            }
            if (job.kind === "payout") {
              if (!s.capture || s.refund || s.paymentIntents?.refund || purchase.payout_state !== "held")
                throw new ConflictError("Payout release is not safe from this state.");
              const dispute = await tx.query("SELECT 1 FROM licensegraph.disputes WHERE run_id=$1 AND status IN ('open','escalated')", [
                job.runId,
              ]);
              if (dispute.rowCount) throw new ConflictError("The dispute holds these payouts.");
              if (!purchase.accepted_at && (!purchase.release_at || purchase.release_at.getTime() > Date.now()))
                throw new ConflictError("The payout hold has not ended.");
              for (const recipient of a.recipients) {
                const licensor = (await tx.query("SELECT status FROM licensegraph.licensors WHERE id=$1 FOR SHARE", [recipient.licensorId]))
                  .rows[0];
                if (licensor?.status !== "approved") throw new ConflictError("A licensor is awaiting review or suspended.");
              }
              await tx.query("UPDATE licensegraph.purchases SET payout_state='submitting' WHERE run_id=$1", [job.runId]);
              const base: PayoutSummary = {
                batchId: job.externalKey!,
                status: "FAILED",
                totalCents: a.recipients.reduce((sum, r) => sum + r.amountCents, 0),
                currency: a.offers[0]!.currency,
                createdAt: new Date().toISOString(),
                error: "Submission awaiting confirmation.",
                lines: a.recipients.map((r) => ({
                  assetId: r.assetId,
                  offerId: `${r.offerId}:${r.offerVersion}`,
                  documentId: a.offers.find((o) => o.id === `${r.offerId}:${r.offerVersion}`)!.evidence[0]!.documentId,
                  licensorName: r.licensorName,
                  email: r.email,
                  amountCents: r.amountCents,
                  currency: r.currency,
                  status: "PENDING",
                })),
              };
              s.payouts = base;
            }
            if (job.kind === "refund" && purchase.payout_state !== "held")
              throw new ConflictError("Payouts may have been submitted. Reconcile before refunding.");
            await this.market.runs.save(loaded!, tx);
            await this.market.queue.submitted(tx, job);
            return details;
          });
        };
        if (job.kind === "order") {
          const payments = {
            ...this.deps.payments,
            createPayout: undefined,
            createOrder: async (input: Parameters<NonNullable<Deps["payments"]>["createOrder"]>[0]) => {
              const details = await prepare();
              submitted = true;
              return this.deps.payments!.createOrder({ ...input, customId: details.authorizationDigest, requestId: job.externalKey! });
            },
          };
          await startPayment(s, { ...this.deps, payments });
        } else if (job.kind === "capture") {
          const payments = {
            ...this.deps.payments,
            createPayout: undefined,
            captureOrder: async (id: string) => {
              await prepare();
              submitted = true;
              try {
                return await this.deps.payments!.captureOrder(id, job.externalKey!);
              } catch (error) {
                // PayPal answers 422 ORDER_NOT_APPROVED before capturing anything: a normal waiting state, not an unknown capture.
                if (error instanceof Error && error.message.includes("ORDER_NOT_APPROVED")) {
                  definiteRefusal = "ORDER_NOT_APPROVED";
                  submitted = false;
                }
                throw error;
              }
            },
          };
          await completePayment(s, { ...this.deps, payments });
        } else if (job.kind === "payout") {
          if (!this.deps.payments.createPayout) throw new ConflictError("Sandbox payouts are not configured.");
          await prepare();
          submitted = true;
          const p = s.payouts!;
          const created = await this.deps.payments.createPayout({
            batchId: job.externalKey!,
            subject: "Licence payment via LicenseGraph",
            items: toPayoutItems(p.lines, (line) => `Licence for ${line.assetId}`),
          });
          s.payouts = {
            ...p,
            batchId: created.batchId,
            status: created.status === "SUCCESS" ? "PROCESSING" : created.status,
            error: undefined,
          };
          s.ledger.append("payout_created", {
            batchId: created.batchId,
            status: created.status,
            totalCents: p.totalCents,
            currency: p.currency,
            lines: p.lines.map((line) => ({ assetId: line.assetId, licensor: line.licensorName, amountCents: line.amountCents })),
          });
        } else if (job.kind === "refund") {
          const payments = {
            ...this.deps.payments,
            refundCapture: async (id: string) => {
              await prepare();
              submitted = true;
              return this.deps.payments!.refundCapture!(id, job.externalKey!);
            },
          };
          if (!this.deps.payments.refundCapture) throw new ConflictError("Sandbox refunds are not configured.");
          await refundPurchase(s, { ...this.deps, payments });
        } else throw new ConflictError("Unsupported operation.");
      }
      await this.market.db.transaction(async (tx) => {
        await this.market.queue.assertLease(tx, job);
        await tx.query("SELECT id FROM licensegraph.runs WHERE id=$1 FOR UPDATE", [job.runId]);
        await this.market.runs.save(loaded!, tx);
        if (job.kind === "order") await tx.query("UPDATE licensegraph.purchases SET order_id=$1 WHERE run_id=$2", [s.order!.id, job.runId]);
        if (job.kind === "capture") {
          await tx.query(
            "UPDATE licensegraph.purchases SET capture_id=$1,captured_at=now(),release_at=now()+interval '7 days' WHERE run_id=$2",
            [s.capture!.captureId, job.runId],
          );
          await this.market.queue.enqueue(tx, job.runId, "payout", "release", null, new Date(Date.now() + 7 * 86_400_000));
        }
        if (job.kind === "payout") {
          await tx.query("UPDATE licensegraph.purchases SET payout_state='submitted',payout_batch_id=$2 WHERE run_id=$1", [
            job.runId,
            s.payouts!.batchId,
          ]);
          await this.market.queue.enqueue(tx, job.runId, "refresh", "status:0", { attempt: 0 }, new Date(Date.now() + 1000));
        }
        if (job.kind === "refresh") {
          if (s.phase === "settled")
            await tx.query("UPDATE licensegraph.purchases SET payout_state='settled' WHERE run_id=$1", [job.runId]);
          else if (s.payouts && !isFinalPayout(s.payouts.status)) {
            const attempt = Number((job.payload as { attempt?: number } | null)?.attempt ?? 0) + 1;
            if (attempt <= 10)
              await this.market.queue.enqueue(tx, job.runId, "refresh", `status:${attempt}`, { attempt }, new Date(Date.now() + 10_000));
            else await tx.query("UPDATE licensegraph.purchases SET payout_state='reconcile' WHERE run_id=$1", [job.runId]);
          }
        }
        if (job.kind === "refund") {
          await tx.query("UPDATE licensegraph.purchases SET payout_state='refunded' WHERE run_id=$1", [job.runId]);
          await tx.query(
            "UPDATE licensegraph.disputes SET status='refunded',resolved_at=now() WHERE run_id=$1 AND status IN ('open','escalated')",
            [job.runId],
          );
        }
        await this.market.queue.finish(tx, job, "succeeded");
      });
    } catch (error) {
      const code = error instanceof ConflictError ? "PRECONDITION_FAILED" : "PROVIDER_OR_STORAGE_FAILURE";
      try {
        await this.market.db.transaction(async (tx) => {
          await this.market.queue.assertLease(tx, job);
          if (loaded) {
            await tx.query("SELECT id FROM licensegraph.runs WHERE id=$1 FOR UPDATE", [job.runId]);
            if (job.kind === "pipeline") {
              loaded.session.phase = "failed";
              loaded.session.failure =
                "The background run stopped. Review its history and start a new run; no automatic model retry was sent.";
            }
            await this.market.runs.save(loaded, tx);
          }
          if (definiteRefusal) {
            await this.market.queue.failRetryable(tx, job, definiteRefusal);
            return;
          }
          if (submitted && job.kind !== "pipeline")
            await tx.query("UPDATE licensegraph.purchases SET payout_state='reconcile' WHERE run_id=$1 AND payout_state<>'refunded'", [
              job.runId,
            ]);
          await this.market.queue.finish(tx, job, submitted && job.kind !== "pipeline" ? "reconcile" : "failed", code);
        });
      } catch {
        console.error(JSON.stringify({ event: "operation_record_failed", operationId: job.id, runId: job.runId }));
      }
      console.error(JSON.stringify({ event: "operation_failed", operationId: job.id, runId: job.runId, code }));
    } finally {
      clearInterval(pulse);
    }
    return true;
  }
}
