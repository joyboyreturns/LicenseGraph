import { randomBytes, randomUUID } from "node:crypto";
import { AccessError, staffOnly, type Principal } from "../auth/identity";
import { approveSession, viewOf } from "../app-logic/session";
import { canonicalJson } from "../core/digest";
import { verifyBundle } from "../core/rules";
import type { LicenseOffer } from "../core/types";
import type { SourceDocument } from "../extraction/extract";
import { hashSecret } from "../storage/crypto";
import { JobQueue } from "../storage/jobs";
import { ConflictError, RunRepository, type StoredRun } from "../storage/runs";
import type { Transaction } from "../storage/database";
import { disputeSubmission, licensorSubmission, marketplaceOfferSchema, type AuthorizationV3, type LicensorDetails, type RecipientSnapshot } from "./types";

export class Marketplace {
  constructor(readonly runs: RunRepository, readonly queue: JobQueue) {}
  get db() { return this.runs.db; }
  get cipher() { return this.runs.cipher; }
  async owned(runId: string, principal: Principal, tx?: Transaction): Promise<StoredRun> {
    const loaded = tx ? await this.runs.lock(runId, tx) : await this.runs.read(runId);
    if (!loaded || loaded.ownerId !== principal.id) throw new AccessError("Run not found.", 404);
    return loaded;
  }
  async idle(tx: Transaction, runId: string) {
    const busy = await tx.query("SELECT 1 FROM licensegraph.operations WHERE run_id=$1 AND status IN ('queued','running','reconcile') AND kind<>'refresh'", [runId]);
    if (busy.rowCount) throw new ConflictError("A purchase operation is pending or needs reconciliation.");
  }
  async submitLicensor(principal: Principal, input: unknown) {
    const details = licensorSubmission.parse(input);
    if (details.recipientEmail.toLowerCase() !== principal.email.toLowerCase()) throw new AccessError("Use your verified account email as the recipient. A different address must first be verified through account settings.");
    return this.db.transaction(async (tx) => {
      const existing = await tx.query("SELECT id,version FROM licensegraph.licensors WHERE user_id=$1 FOR UPDATE", [principal.id]);
      const id = existing.rows[0]?.id ?? randomUUID();
      const version = (existing.rows[0]?.version ?? 0) + 1;
      await tx.query(`INSERT INTO licensegraph.licensors(id,user_id,version,sealed) VALUES ($1,$2,$3,$4)
        ON CONFLICT (user_id) DO UPDATE SET version=$3,status='pending',sealed=$4,recipient_confirmed_at=NULL,reviewed_by=NULL,reviewed_at=NULL,review_reason=NULL`,
      [id, principal.id, version, this.cipher.seal(details, `licensor:${id}:${version}`)]);
      await this.runs.audit(tx, principal.id, "licensor_submitted", id, { version });
      return { id, version, status: "pending" };
    });
  }
  async confirmRecipient(principal: Principal) {
    return this.db.transaction(async (tx) => {
      const row = (await tx.query("SELECT * FROM licensegraph.licensors WHERE user_id=$1 FOR UPDATE", [principal.id])).rows[0];
      if (!row) throw new ConflictError("Submit a licensor profile first.");
      const details = this.cipher.open<LicensorDetails>(row.sealed, `licensor:${row.id}:${row.version}`);
      if (details.recipientEmail.toLowerCase() !== principal.email.toLowerCase()) throw new AccessError("Recipient does not match your current verified email.");
      await tx.query("UPDATE licensegraph.licensors SET recipient_confirmed_at=now() WHERE id=$1", [row.id]);
      await this.runs.audit(tx, principal.id, "recipient_email_confirmed", row.id, { version: row.version });
      return { confirmed: true, assurance: "Verified account email; PayPal account ownership has not been verified." };
    });
  }
  async reviewLicensor(principal: Principal, id: string, decision: "approved" | "rejected" | "suspended", reason: string) {
    staffOnly(principal);
    if (!reason.trim()) throw new ConflictError("A review reason is required.");
    return this.db.transaction(async (tx) => {
      const row = (await tx.query("SELECT * FROM licensegraph.licensors WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!row) throw new AccessError("Licensor not found.", 404);
      if (row.user_id === principal.id) throw new AccessError("A licensor cannot review their own profile.");
      if (decision === "approved" && !row.recipient_confirmed_at) throw new ConflictError("The recipient email has not been confirmed.");
      await tx.query("UPDATE licensegraph.licensors SET status=$1,reviewed_by=$2,reviewed_at=now(),review_reason=$3 WHERE id=$4", [decision, principal.id, reason.trim(), id]);
      await this.runs.audit(tx, principal.id, `licensor_${decision}`, id, { version: row.version, reason });
      return { id, version: row.version, status: decision };
    });
  }
  async publishOffer(principal: Principal, offer: LicenseOffer, document: SourceDocument, existingId?: string) {
    offer = marketplaceOfferSchema.parse(offer);
    if (document.assetId !== offer.assetId) throw new ConflictError("The source document belongs to a different asset.");
    const supported = ["price","commercialUse","territories","term",...Object.keys(offer.terms).filter((key) => !["commercialUse","territories","termMonths"].includes(key))];
    if (supported.some((field) => !offer.evidence.some((e) => e.field === field))) throw new ConflictError("Every stated term requires its own supporting source quotation.");
    const verdict = verifyBundle({ name: "Offer validation", commercial: false, territories: ["WORLD"], termMonths: 1 }, [offer.assetId], { offers: [offer] });
    if (verdict.violations.some((v) => ["amount","currency","evidence","duplicate-asset","coverage"].includes(v.rule))) throw new ConflictError("The offer has invalid money or evidence.");
    if (offer.evidence.some((e) => e.documentId !== document.id || !Number.isInteger(e.start) || !Number.isInteger(e.end) || document.text.slice(e.start, e.end).replace(/\s+/g, " ").trim() !== e.quote.replace(/\s+/g, " ").trim())) throw new ConflictError("Every quote must match located source text.");
    return this.db.transaction(async (tx) => {
      const licensor = (await tx.query("SELECT * FROM licensegraph.licensors WHERE user_id=$1 FOR UPDATE", [principal.id])).rows[0];
      if (licensor?.status !== "approved") throw new AccessError("A reviewed licensor profile is required.");
      const id = existingId ?? randomUUID();
      const previous = await tx.query("SELECT licensor_id,version FROM licensegraph.offers WHERE id=$1 ORDER BY version DESC LIMIT 1", [id]);
      if (previous.rows[0] && previous.rows[0].licensor_id !== licensor.id) throw new AccessError("This offer belongs to another licensor.");
      const version = (previous.rows[0]?.version ?? 0) + 1;
      const sourceId = `${id}:${version}`;
      const candidate = { offer: { ...offer, id: `${id}:${version}`, evidence: offer.evidence.map((e) => ({ ...e, documentId: sourceId })) }, document: { ...document, id: sourceId, licensor: { name: this.cipher.open<LicensorDetails>(licensor.sealed, `licensor:${licensor.id}:${licensor.version}`).name } } };
      await tx.query("INSERT INTO licensegraph.offers(id,version,licensor_id,licensor_version,amount_cents,currency,sealed) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, version, licensor.id, licensor.version, offer.priceCents, offer.currency, this.cipher.seal(candidate, `offer:${id}:${version}`)]);
      await this.runs.audit(tx, principal.id, "offer_submitted", id, { version });
      return { id, version, status: "pending" };
    });
  }
  async reviewOffer(principal: Principal, id: string, version: number, decision: "approved" | "rejected") {
    staffOnly(principal);
    return this.db.transaction(async (tx) => {
      const row = (await tx.query(`SELECT o.*,l.user_id,l.status AS licensor_status,l.version AS current_version FROM licensegraph.offers o JOIN licensegraph.licensors l ON l.id=o.licensor_id WHERE o.id=$1 AND o.version=$2 FOR UPDATE OF o,l`, [id, version])).rows[0];
      if (!row) throw new AccessError("Offer not found.", 404);
      if (row.user_id === principal.id) throw new AccessError("You cannot review your own offer.");
      if (decision === "approved" && (row.licensor_status !== "approved" || row.current_version !== row.licensor_version)) throw new ConflictError("The licensor must be approved at the offer's version.");
      await tx.query("UPDATE licensegraph.offers SET status=$1,reviewed_by=$2,reviewed_at=now() WHERE id=$3 AND version=$4", [decision, principal.id, id, version]);
      await this.runs.audit(tx, principal.id, `offer_${decision}`, id, { version });
      return { id, version, status: decision };
    });
  }
  async recipients(tx: Transaction, offers: LicenseOffer[]): Promise<RecipientSnapshot[]> {
    const snapshots: RecipientSnapshot[] = [];
    for (const offer of offers) {
      const [id, versionText] = offer.id.split(":");
      if (!id || !versionText || !/^[0-9]+$/.test(versionText)) throw new ConflictError("Only approved marketplace offers can be purchased. Uploaded terms can be analyzed independently.");
      const row = (await tx.query(`SELECT o.*,l.sealed AS licensor_sealed,l.version AS current_version,l.status AS licensor_status,l.recipient_confirmed_at FROM licensegraph.offers o JOIN licensegraph.licensors l ON l.id=o.licensor_id WHERE o.id=$1 AND o.version=$2 FOR SHARE OF o,l`, [id, Number(versionText)])).rows[0];
      if (!row || row.status !== "approved" || row.licensor_status !== "approved" || row.licensor_version !== row.current_version || !row.recipient_confirmed_at) throw new ConflictError("An offer or licensor changed and requires review.");
      const registered = this.cipher.open<{ offer: LicenseOffer }>(row.sealed, `offer:${id}:${row.version}`);
      if (canonicalJson(registered.offer) !== canonicalJson(offer)) throw new ConflictError("The chosen offer does not match the reviewed offer.");
      const licensor = this.cipher.open<LicensorDetails>(row.licensor_sealed, `licensor:${row.licensor_id}:${row.current_version}`);
      snapshots.push({ licensorId: row.licensor_id, licensorVersion: row.current_version, offerId: id, offerVersion: row.version, assetId: offer.assetId, licensorName: licensor.name, email: licensor.recipientEmail, amountCents: offer.priceCents, currency: offer.currency });
    }
    return snapshots;
  }
  async approve(principal: Principal, runId: string) {
    return this.db.transaction(async (tx) => {
      const loaded = await this.owned(runId, principal, tx);
      await this.idle(tx, runId);
      const s = loaded.session;
      if (principal.agent || s.claim) throw new AccessError("An authenticated person must claim and approve this purchase.");
      if (s.phase !== "verified" || !s.loop?.bundle) throw new ConflictError("Only a verified bundle can be approved.");
      const verdict = verifyBundle(s.input.project, s.input.requiredAssetIds, s.loop.bundle, { today: new Date().toISOString().slice(0,10) });
      if (!verdict.ok) throw new ConflictError("The bundle no longer passes verification.");
      const recipients = await this.recipients(tx, s.loop.bundle.offers);
      const authorization: AuthorizationV3 = { version: 3, runId, approvedBy: principal.id, approvedAt: new Date().toISOString(), project: s.input.project, requiredAssetIds: s.input.requiredAssetIds, offers: s.loop.bundle.offers, documents: s.input.documents,
        recipients, releasePolicy: { days: 7, buyerAcceptance: true, disputesHold: true } };
      const id = randomUUID();
      const digest = hashSecret(canonicalJson(authorization));
      approveSession(s, principal.name, { purchaseDigest: digest, accountId: principal.id });
      await tx.query("INSERT INTO licensegraph.purchase_authorizations(id,run_id,approved_by,digest,amount_cents,currency,sealed) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, runId, principal.id, digest, verdict.totalCents, s.loop.bundle.offers[0]!.currency, this.cipher.seal(authorization, `authorization:${id}`)]);
      await tx.query("INSERT INTO licensegraph.purchases(run_id,authorization_id,sealed) VALUES ($1,$2,$3)", [runId, id, this.cipher.seal({ authorization, authorizationDigest: digest }, `purchase:${runId}`)]);
      for (const recipient of recipients) await tx.query("INSERT INTO licensegraph.purchase_recipients(run_id,licensor_id,offer_id,offer_version,amount_cents,currency) VALUES ($1,$2,$3,$4,$5,$6)", [runId, recipient.licensorId, recipient.offerId, recipient.offerVersion, recipient.amountCents, recipient.currency]);
      await this.runs.save(loaded, tx);
      await this.runs.audit(tx, principal.id, "purchase_approved", runId, { digest, authorizationId: id });
      return viewOf(s);
    });
  }
  async dispute(principal: Principal, runId: string, input: unknown) {
    const details = disputeSubmission.parse(input);
    return this.db.transaction(async (tx) => {
      const loaded = await this.runs.lock(runId, tx);
      const involved = await tx.query(`SELECT 1 FROM licensegraph.purchases p JOIN licensegraph.purchase_authorizations a ON a.id=p.authorization_id WHERE p.run_id=$1`, [runId]);
      if (loaded.ownerId !== principal.id) {
        const seller = await tx.query(`SELECT 1 FROM licensegraph.licensors l JOIN licensegraph.offers o ON o.licensor_id=l.id WHERE l.user_id=$1 AND (o.id::text||':'||o.version::text)=ANY($2::text[])`, [principal.id, loaded.session.loop?.bundle?.offers.map((o) => o.id) ?? []]);
        if (!seller.rowCount) staffOnly(principal);
      }
      if (!involved.rowCount || !loaded.session.capture || loaded.session.refund) throw new ConflictError("A captured, non-refunded purchase is required.");
      const purchase = (await tx.query("SELECT payout_state FROM licensegraph.purchases WHERE run_id=$1 FOR UPDATE", [runId])).rows[0];
      const status = purchase.payout_state === "held" ? "open" : "escalated";
      const id = randomUUID();
      await tx.query("INSERT INTO licensegraph.disputes(id,run_id,opened_by,status,sealed) VALUES ($1,$2,$3,$4,$5)", [id, runId, principal.id, status, this.cipher.seal(details, `dispute:${id}`)]);
      await this.runs.audit(tx, principal.id, "dispute_opened", runId, { disputeId: id, status });
      return { id, status };
    });
  }
  async accept(principal: Principal, runId: string) {
    return this.db.transaction(async (tx) => {
      const loaded = await this.owned(runId, principal, tx);
      if (!loaded.session.capture || loaded.session.refund) throw new ConflictError("A captured purchase is required.");
      const disputed = await tx.query("SELECT 1 FROM licensegraph.disputes WHERE run_id=$1 AND status IN ('open','escalated')", [runId]);
      if (disputed.rowCount) throw new ConflictError("Resolve the dispute before releasing payouts.");
      await tx.query("UPDATE licensegraph.purchases SET accepted_at=now() WHERE run_id=$1 AND payout_state='held'", [runId]);
      await this.runs.audit(tx, principal.id, "buyer_accepted", runId, {});
      return this.queue.enqueue(tx, runId, "payout", "release");
    });
  }
  async share(principal: Principal, runId: string, kind: "receipt" | "passport", days: number) {
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new ConflictError("Share links last between 1 and 30 days.");
    return this.db.transaction(async (tx) => {
      const loaded = await this.owned(runId, principal, tx);
      if (!loaded.session.capture || loaded.session.refund) throw new ConflictError("Only captured purchases can be shared.");
      const token = randomBytes(32).toString("base64url");
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + days * 86_400_000);
      await tx.query("INSERT INTO licensegraph.share_grants(id,run_id,token_hash,kind,expires_at) VALUES ($1,$2,$3,$4,$5)", [id, runId, hashSecret(token), kind, expiresAt]);
      await this.runs.audit(tx, principal.id, "share_created", runId, { id, kind, expiresAt });
      return { id, token, kind, expiresAt };
    });
  }
}
