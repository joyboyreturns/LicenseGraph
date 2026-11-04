import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Identity, type Principal } from "../src/auth/identity";
import { greedyProposer } from "../src/agent/greedy";
import { createSession, type Deps } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { fixtures } from "../src/demo/fixtures";
import { extractOffer } from "../src/extraction/extract";
import { Marketplace } from "../src/marketplace/service";
import { MarketplaceWorker } from "../src/marketplace/worker";
import { CatalogList, MyOffers, Res, ROUTE_SPECS } from "../src/marketplace/contract";
import { applyWebhook, processPendingWebhooks, type PayPalEvent } from "../src/marketplace/webhooks";
import type { PrivateRuntime } from "../src/marketplace/runtime";
import { privateRequest } from "../src/marketplace/http";
import { createPayPalSimulator } from "../src/payments/simulator";
import { RecordCipher, hashSecret } from "../src/storage/crypto";
import { Database } from "../src/storage/database";
import { JobQueue } from "../src/storage/jobs";
import { RunRepository } from "../src/storage/runs";
import type { LicenseOffer } from "../src/core/types";
import type { SourceDocument } from "../src/extraction/extract";

const enabled = process.env.RUN_DATABASE_TESTS === "1";
describe.skipIf(!enabled)("private marketplace integration", () => {
  const db = enabled ? Database.connect(process.env.DATABASE_URL!) : undefined!;
  const cipher = new RecordCipher("test", { test: "cd".repeat(32) });
  const runs = new RunRepository(db, cipher);
  const queue = new JobQueue(db, cipher);
  const market = new Marketplace(runs, queue);
  const sim = createPayPalSimulator({ appUrl: () => "http://localhost:3000", settleAfterMs: 0 });
  const deps: Deps = { model: demoModel, proposer: greedyProposer, payments: sim, paymentsMode: "simulator", today: () => new Date().toISOString().slice(0,10) };
  const worker = new MarketplaceWorker(market, deps);
  const identity = new Identity(db, cipher, "http://localhost:3000", "http://localhost:8081/realms/licensegraph", "licensegraph");
  let buyer: Principal, seller: Principal, staff: Principal, stranger: Principal;
  let buyerToken: string, strangerToken: string;
  let candidate: { offer: LicenseOffer; document: SourceDocument };
  let sellerId: string;
  let offerRef: { id: string; version: number };
  async function person(role = "buyer"): Promise<Principal> {
    const id = randomUUID();
    const p = { id, email: `${id}@example.invalid`, name: role, roles: ["buyer", role], mfa: role === "staff" };
    await db.pool.query("INSERT INTO licensegraph.users(id,issuer,subject,email,display_name,roles) VALUES ($1,'fixture',$2,$3,$4,$5)", [id, id, p.email, role, p.roles]);
    return p;
  }
  async function browser(principal: Principal) {
    const token = randomBytes(32).toString("base64url");
    await db.pool.query("INSERT INTO licensegraph.auth_sessions(token_hash,user_id,expires_at,mfa) VALUES ($1,$2,now()+interval '1 hour',$3)", [hashSecret(token), principal.id, principal.mfa]);
    return token;
  }
  async function call(path: string, method = "GET", body?: unknown, token = buyerToken) {
    const request = new Request(`http://localhost:3000${path}`, { method, headers: { Cookie: `lg_account=${token}`, Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await privateRequest(request))!;
  }
  async function runJob(id: string) {
    for (let i=0; i<30; i++) {
      const state = (await queue.get(id))!;
      if (state.status !== "queued" && state.status !== "running") return state;
      await worker.once();
    }
    throw new Error("Operation did not finish.");
  }
  async function readyRun() {
    const s = createSession({ project: { name: "Private release", commercial: true, territories: ["US"], termMonths: 6 }, requiredAssetIds: [candidate.offer.assetId], documents: [candidate.document] });
    s.ownerId = buyer.id;
    const job = await db.transaction(async (tx) => { await runs.create(s, buyer.id, tx); return queue.enqueue(tx, s.id, "pipeline", "initial", { offers: [candidate.offer] }); });
    expect((await runJob(job.id)).status).toBe("succeeded");
    expect((await runs.read(s.id))!.session.phase).toBe("verified");
    return s.id;
  }
  async function capturedRun() {
    const id = await readyRun();
    await market.approve(buyer, id);
    const order = await db.transaction((tx) => queue.enqueue(tx, id, "order", "initial"));
    expect((await runJob(order.id)).status).toBe("succeeded");
    sim.approveOrder((await runs.read(id))!.session.order!.id);
    const capture = await db.transaction((tx) => queue.enqueue(tx, id, "capture", "initial"));
    expect((await runJob(capture.id)).status).toBe("succeeded");
    return id;
  }
  beforeAll(async () => {
    await db.migrate();
    buyer = await person(); seller = await person("licensor"); staff = await person("staff"); stranger = await person();
    buyerToken = await browser(buyer); strangerToken = await browser(stranger);
    vi.stubEnv("LICENSEGRAPH_STORAGE", "postgres");
    const rt = { db, cipher, appUrl: "http://localhost:3000", identity, runs, queue, market, deps, worker, passportSecret: "fixture-only-signing-secret" } as PrivateRuntime;
    (globalThis as unknown as { __licensegraphPrivate: PrivateRuntime }).__licensegraphPrivate = rt;
    const submitted = await market.submitLicensor(seller, { name: "Reviewed Creator", recipientEmail: seller.email, identityEvidence: "Identity documentation reviewed in this fixture.", rightsEvidence: "Original work ownership documentation for this fixture.", declaration: true });
    sellerId = submitted.id;
    await market.confirmRecipient(seller);
    await market.reviewLicensor(staff, sellerId, "approved", "Evidence reviewed.");
    const f = fixtures[0]!;
    const offer = (await extractOffer(demoModel, f.doc)).offer!;
    const published = await market.publishOffer(seller, offer, f.doc);
    await market.reviewOffer(staff, published.id, published.version, "approved", "Quotes match the licence text.");
    offerRef = { id: published.id, version: published.version };
    const row = (await db.pool.query("SELECT sealed FROM licensegraph.offers WHERE id=$1 AND version=$2", [published.id,published.version])).rows[0];
    candidate = cipher.open(row.sealed, `offer:${published.id}:${published.version}`);
  });
  afterAll(async () => { vi.unstubAllEnvs(); delete (globalThis as any).__licensegraphPrivate; if (db) await db.pool.end(); });

  it("requires staff MFA and separates review from self-approval", async () => {
    await expect(market.reviewLicensor({ ...staff, mfa: false }, sellerId, "approved", "Review")).rejects.toThrow(/multi-factor/);
    await expect(market.reviewLicensor({ ...seller, roles: ["staff"], mfa: true }, sellerId, "approved", "Review")).rejects.toThrow(/own profile/);
  });
  it("keeps documents private across run, passport, dashboard and operation routes", async () => {
    const id = await readyRun();
    for (const path of [`/api/sessions/${id}`, `/api/passports/${id}`, `/api/passports/${id}/verify`]) expect((await call(path,"GET",undefined,strangerToken)).status).toBe(404);
    const response = await call(`/api/sessions/${id}`);
    expect(response.status).toBe(200);
    expect((await response.json()).documents[0].text).toBe(candidate.document.text);
  });
  it("binds approval to reviewed recipient versions and blocks changed seller details", async () => {
    const id = await readyRun();
    await market.approve(buyer, id);
    const row = (await db.pool.query("SELECT sealed FROM licensegraph.purchases WHERE run_id=$1",[id])).rows[0];
    const details = cipher.open<any>(row.sealed,`purchase:${id}`);
    expect(details.authorization.version).toBe(3);
    expect(details.authorization.recipients[0].email).toBe(seller.email);
    await db.pool.query("UPDATE licensegraph.licensors SET status='suspended' WHERE id=$1",[sellerId]);
    const job = await db.transaction((tx)=>queue.enqueue(tx,id,"order","initial"));
    expect((await runJob(job.id)).status).toBe("failed");
    expect((await runs.read(id))!.session.order).toBeUndefined();
    await db.pool.query("UPDATE licensegraph.licensors SET status='approved' WHERE id=$1",[sellerId]);
  });
  it("captures without paying creators, then releases exactly the authorized recipient", async () => {
    const id = await capturedRun();
    expect((await runs.read(id))!.session.payouts).toBeUndefined();
    const p = (await db.pool.query("SELECT payout_state,release_at,captured_at FROM licensegraph.purchases WHERE run_id=$1",[id])).rows[0];
    expect(p.payout_state).toBe("held");
    expect(p.release_at.getTime()-p.captured_at.getTime()).toBe(7*86_400_000);
    const release = await market.accept(buyer,id);
    expect((await runJob(release.id)).status).toBe("succeeded");
    const payout = (await runs.read(id))!.session.payouts!;
    expect(payout.lines.map((line)=>line.email)).toEqual([seller.email]);
    await db.pool.query("UPDATE licensegraph.operations SET available_at=now() WHERE run_id=$1 AND kind='refresh'",[id]);
    await worker.once();
    expect((await runs.read(id))!.session.phase).toBe("settled");
  });
  it("holds a disputed purchase and prevents unsafe release", async () => {
    const id=await capturedRun();
    const dispute=await market.dispute(buyer,id,{reason:"The delivered rights do not match the source.",evidence:"Attached source comparison text."});
    expect(dispute.status).toBe("open");
    await expect(market.accept(buyer,id)).rejects.toThrow(/dispute/);
    await db.pool.query("UPDATE licensegraph.operations SET available_at=now() WHERE run_id=$1 AND kind='payout'",[id]);
    await worker.once();
    expect((await runs.read(id))!.session.payouts).toBeUndefined();
  });
  it("redacts receipts, requires a separate full grant, and revokes access", async () => {
    const id=await capturedRun();
    const grant=await market.share(buyer,id,"receipt",1);
    const receipt=await (await call(`/api/marketplace/shared/${grant.token}`,"GET",undefined,strangerToken)).json();
    expect(receipt.kind).toBe("receipt");
    expect(JSON.stringify(receipt)).not.toContain(candidate.document.text);
    expect(JSON.stringify(receipt)).not.toContain(seller.email);
    const full=await market.share(buyer,id,"passport",1);
    const p=await (await call(`/api/marketplace/shared/${full.token}`,"GET",undefined,strangerToken)).json();
    expect(p.documents[0].text).toBe(candidate.document.text);
    expect((await call(`/api/marketplace/shares/${grant.id}`,"DELETE")).status).toBe(200);
    expect((await call(`/api/marketplace/shared/${grant.token}`)).status).toBe(404);
  });
  it("refuses cross-origin writes", async () => {
    const request=new Request("http://localhost:3000/api/marketplace/licensor/confirm",{method:"POST",headers:{Cookie:`lg_account=${buyerToken}`,Origin:"https://attacker.invalid"}});
    expect((await privateRequest(request))!.status).toBe(403);
  });

  async function approvedSeller() {
    const person2 = await person("licensor");
    const submitted = await market.submitLicensor(person2, { name: "Second Creator", recipientEmail: person2.email, identityEvidence: "Identity documentation reviewed in this fixture.", rightsEvidence: "Original work ownership documentation for this fixture.", declaration: true });
    await market.confirmRecipient(person2);
    await market.reviewLicensor(staff, submitted.id, "approved", "Evidence reviewed.");
    return { person: person2, id: submitted.id };
  }
  const status = async (id: string) => (await db.pool.query("SELECT status,recipient_confirmed_at FROM licensegraph.licensors WHERE id=$1", [id])).rows[0];

  it("withdraws seller approval and ends sessions when the account email changes", async () => {
    const { person: other, id } = await approvedSeller();
    const token = await browser(other);
    await db.transaction((tx) => (identity as unknown as { revalidateSeller(tx: unknown, id: string, previous: object, email: string, roles: string[]): Promise<void> })
      .revalidateSeller(tx, other.id, { email: other.email, roles: other.roles }, `changed-${other.email}`, other.roles));
    expect(await status(id)).toMatchObject({ status: "pending", recipient_confirmed_at: null });
    expect(await identity.principal(new Request("http://localhost:3000/", { headers: { Cookie: `lg_account=${token}` } }))).toBeUndefined();
    const audit = await db.pool.query("SELECT 1 FROM licensegraph.audit_events WHERE action='licensor.revalidation_required' AND resource_id=$1", [id]);
    expect(audit.rowCount).toBe(1);
  });

  it("suspends a seller whose licensor role is withdrawn, and leaves an unchanged account alone", async () => {
    const { person: other, id } = await approvedSeller();
    const revalidate = (previousRoles: string[], roles: string[]) => db.transaction((tx) => (identity as unknown as { revalidateSeller(tx: unknown, id: string, previous: object, email: string, roles: string[]): Promise<void> })
      .revalidateSeller(tx, other.id, { email: other.email, roles: previousRoles }, other.email, roles));
    await revalidate(other.roles, other.roles);
    expect((await status(id)).status).toBe("approved");
    await revalidate(["buyer", "licensor"], ["buyer"]);
    expect((await status(id)).status).toBe("suspended");
  });

  it("keeps the catalogue and staff queue available when one stored record cannot be read", async () => {
    const { id: licensorId } = await approvedSeller();
    const staffToken = await browser(staff);
    const offerId = randomUUID();
    const foreign = new RecordCipher("other", { other: "ab".repeat(32) }).seal({ offer: {}, document: {} }, `offer:${offerId}:1`);
    await db.pool.query("INSERT INTO licensegraph.offers(id,version,licensor_id,licensor_version,status,amount_cents,currency,sealed,reviewed_by,reviewed_at) VALUES ($1,1,$2,1,'approved',100,'USD',$3,$4,now())", [offerId, licensorId, foreign, staff.id]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const catalog = await call("/api/marketplace/catalog");
      expect(catalog.status).toBe(200);
      const body = await catalog.json() as { offers: { id: string }[] };
      expect(body.offers.length).toBeGreaterThan(0);
      expect(body.offers.some((o) => o.id === offerId)).toBe(false);
      expect((await call("/api/marketplace/staff/reviews", "GET", undefined, staffToken)).status).toBe(200);
      expect(errors.mock.calls.flat().join(" ")).toContain("unreadable_records");
    } finally { errors.mockRestore(); await db.pool.query("DELETE FROM licensegraph.offers WHERE id=$1", [offerId]); }
  });

  async function agentFor(owner: Principal, expiresSql = "now() + interval '1 hour'") {
    const token = randomBytes(32).toString("base64url");
    await db.pool.query(`INSERT INTO licensegraph.agent_tokens(id,user_id,token_hash,name,expires_at) VALUES ($1,$2,$3,'fixture agent',${expiresSql})`, [randomUUID(), owner.id, hashSecret(token)]);
    return token;
  }
  async function asAgent(token: string, path: string, method = "GET", body?: unknown) {
    const request = new Request(`http://localhost:3000${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await privateRequest(request))!;
  }
  const selection = () => ({ project: { name: "Agent release", commercial: true, territories: ["US"], termMonths: 6 }, requiredAssetIds: [candidate.offer.assetId], offerRefs: [offerRef] });

  it("lets an agent create and read a run but never approve, pay, claim, or trigger a capture by GET", async () => {
    const owner = await person();
    const agent = await agentFor(owner);
    const created = await asAgent(agent, "/api/sessions", "POST", selection());
    expect(created.status).toBe(202);
    const body = await created.json() as { id: string; handoff?: { claimUrl: string } };
    expect(body.handoff?.claimUrl).toContain(`/claim/${body.id}?token=`);
    expect((await asAgent(agent, `/api/sessions/${body.id}`)).status).toBe(200);
    for (const [path, method] of [[`/api/sessions/${body.id}/approve`, "POST"], [`/api/sessions/${body.id}/pay`, "POST"], [`/api/sessions/${body.id}/payouts`, "POST"], [`/api/sessions/${body.id}/refund`, "POST"],
      [`/api/sessions/${body.id}/claim`, "POST"], [`/api/sessions/${body.id}/return`, "GET"], ["/api/marketplace/licensor", "POST"], ["/api/marketplace/staff/reviews", "GET"], ["/api/marketplace/agent-tokens", "POST"], ["/api/marketplace/shares", "POST"]] as const) {
      expect((await asAgent(agent, path, method, method === "POST" ? {} : undefined)).status, `${method} ${path}`).toBe(403);
    }
    const operations = await db.pool.query("SELECT kind FROM licensegraph.operations WHERE run_id=$1", [body.id]);
    expect(operations.rows.map((r) => r.kind)).toEqual(["pipeline"]);
  });

  it("rejects expired, revoked and malformed agent credentials", async () => {
    const owner = await person();
    const expired = await agentFor(owner, "now() - interval '1 second'");
    expect((await asAgent(expired, "/api/sessions")).status).toBe(401);
    const revoked = await agentFor(owner);
    await db.pool.query("UPDATE licensegraph.agent_tokens SET revoked_at=now() WHERE user_id=$1", [owner.id]);
    expect((await asAgent(revoked, "/api/sessions")).status).toBe(401);
    expect((await asAgent("short", "/api/marketplace/catalog")).status).toBe(401);
  });

  it("transfers an agent-started run only to a different signed-in person holding the valid, unexpired, single-use link", async () => {
    const owner = await person();
    const agent = await agentFor(owner);
    const created = await (await asAgent(agent, "/api/sessions", "POST", selection())).json() as { id: string; handoff: { claimUrl: string } };
    const claimToken = new URL(created.handoff.claimUrl).searchParams.get("token")!;
    const claimer = await person();
    const claimerToken = await browser(claimer);
    expect((await call(`/api/sessions/${created.id}`, "GET", undefined, claimerToken)).status).not.toBe(200);
    expect((await call(`/api/sessions/${created.id}/claim`, "POST", { token: "x".repeat(43) }, claimerToken)).status).toBeLessThan(500);
    expect((await call(`/api/sessions/${created.id}/claim`, "POST", { token: "x".repeat(43) }, claimerToken)).status).toBeGreaterThanOrEqual(400);
    expect((await call(`/api/sessions/${created.id}`, "GET", undefined, claimerToken)).status).not.toBe(200);
    const preview = await call(`/api/sessions/${created.id}?claimToken=${claimToken}`, "GET", undefined, claimerToken);
    expect(preview.status).toBe(200);
    const claimed = await call(`/api/sessions/${created.id}/claim`, "POST", { token: claimToken }, claimerToken);
    expect(claimed.status).toBe(200);
    expect((await call(`/api/sessions/${created.id}`, "GET", undefined, claimerToken)).status).toBe(200);
    const replay = await call(`/api/sessions/${created.id}/claim`, "POST", { token: claimToken }, strangerToken);
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(replay.status).toBeLessThan(500);
    expect((await call(`/api/sessions/${created.id}`, "GET", undefined, strangerToken)).status).not.toBe(200);
    expect((await asAgent(agent, `/api/sessions/${created.id}`)).status).not.toBe(200);
  });

  it("refuses an expired claim link", async () => {
    const owner = await person();
    const agent = await agentFor(owner);
    const created = await (await asAgent(agent, "/api/sessions", "POST", selection())).json() as { id: string; handoff: { claimUrl: string } };
    const claimToken = new URL(created.handoff.claimUrl).searchParams.get("token")!;
    await db.transaction(async (tx) => { const loaded = await runs.lock(created.id, tx); loaded.session.claim!.expiresAt = new Date(Date.now() - 1000).toISOString(); await runs.save(loaded, tx); });
    const late = await call(`/api/sessions/${created.id}/claim`, "POST", { token: claimToken }, strangerToken);
    expect(late.status).toBeGreaterThanOrEqual(400);
    expect(late.status).toBeLessThan(500);
    expect((await call(`/api/sessions/${created.id}?claimToken=${claimToken}`, "GET", undefined, strangerToken)).status).toBe(404);
  });

  it("exposes no private run data to another account, that account's agent, or an anonymous caller on any route", async () => {
    const id = await readyRun();
    const marker = candidate.document.text.slice(0, 40);
    const operation = (await db.pool.query("SELECT id FROM licensegraph.operations WHERE run_id=$1 LIMIT 1", [id])).rows[0].id as string;
    const strangerAgent = await agentFor(stranger);
    const reads = [`/api/sessions/${id}`, `/api/passports/${id}`, `/api/passports/${id}/verify`, `/api/passports/${id}/badge`, `/api/passports/${id}/qr`, `/api/sessions/${id}/return`,
      `/api/marketplace/operations/${operation}`, `/api/sessions`, `/api/portfolio`, `/api/marketplace/catalog`, `/api/marketplace/licensor/purchases`] as const;
    const anonymous = (path: string) => privateRequest(new Request(`http://localhost:3000${path}`));
    for (const path of reads) {
      const results = [await call(path, "GET", undefined, strangerToken), await asAgent(strangerAgent, path), await anonymous(path)];
      for (const response of results) {
        // Anonymous callers of a few listing routes fall through to the separate public replay store, which holds no private runs.
        if (!response) { expect(["/api/sessions", "/api/portfolio", "/api/config"], path).toContain(path); continue; }
        const text = await response.text();
        expect(text, path).not.toContain(marker);
        expect(text, path).not.toContain(id);
        if (path.includes(id) || path.includes(operation)) expect([401, 403, 404], path).toContain(response.status);
      }
    }
    // The owner's own reads are never cacheable, whatever their type.
    for (const path of [`/api/sessions/${id}`, `/api/passports/${id}`, `/api/passports/${id}/badge`, `/api/passports/${id}/qr`, "/api/sessions", "/api/portfolio"]) {
      expect((await call(path)).headers.get("cache-control"), path).toContain("no-store");
    }
    // Writes by another account on the owner's run are refused as well.
    for (const action of ["approve", "pay", "capture", "payouts", "refund", "revise", "rebrief", "ask"]) {
      const response = await call(`/api/sessions/${id}/${action}`, "POST", {}, strangerToken);
      expect([400, 403, 404], action).toContain(response.status);
    }
    // Shares, disputes and acceptance are owner-only, too.
    for (const [path, body] of [[`/api/marketplace/runs/${id}/shares`, { kind: "receipt" }], [`/api/marketplace/runs/${id}/disputes`, { reason: "Not my run", evidence: "None at all." }], [`/api/marketplace/runs/${id}/accept`, {}]] as const) {
      expect([400, 403, 404], path).toContain((await call(path, "POST", body, strangerToken)).status);
    }
  });

  describe("Stage 2 behaviours", () => {
    const rt = () => (globalThis as unknown as { __licensegraphPrivate: PrivateRuntime }).__licensegraphPrivate;
    const offerBody = (over: Record<string, unknown> = {}, quoteFor: Record<string, string> = {}) => {
      const text = "Licence fee: USD 90.00. Commercial use is permitted. Territory: Worldwide. Term: 12 months. Attribution is required. Sublicensing is not permitted.";
      const q = (field: string, quote: string) => ({ documentId: "source", field, quote: quoteFor[field] ?? quote, start: text.indexOf(quote), end: text.indexOf(quote) + quote.length });
      return { offer: { id: "draft", assetId: "asset-http", priceCents: 9000, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: 12, attributionRequired: true, sublicensing: false, ...over },
        evidence: [q("price", "USD 90.00"), q("commercialUse", "Commercial use is permitted"), q("territories", "Territory: Worldwide"), q("term", "Term: 12 months"), q("attributionRequired", "Attribution is required"), q("sublicensing", "Sublicensing is not permitted")] },
      document: { id: "source", assetId: "asset-http", text } };
    };
    let sellerToken: string, staffToken: string;
    beforeAll(async () => { sellerToken = await browser(seller); staffToken = await browser(staff); });

    it("accepts a fully quoted offer over HTTP, then requires a reasoned review and records it in the audit trail", async () => {
      const created = await call("/api/marketplace/offers", "POST", offerBody(), sellerToken);
      expect(created.status).toBe(201);
      const { id, version } = await created.json() as { id: string; version: number };
      const noReason = await call(`/api/marketplace/staff/offers/${id}`, "POST", { version, decision: "approved" }, staffToken);
      expect(noReason.status).toBe(400);
      const reviewed = await call(`/api/marketplace/staff/offers/${id}`, "POST", { version, decision: "approved", reason: "Every quotation matches the source text." }, staffToken);
      expect(reviewed.status).toBe(200);
      const audit = await db.pool.query("SELECT sealed,id FROM licensegraph.audit_events WHERE action='offer_approved' AND resource_id=$1", [id]);
      expect(rt().cipher.open<{ reason: string }>(audit.rows[0].sealed, `audit:${audit.rows[0].id}`).reason).toBe("Every quotation matches the source text.");
    });

    it("rejects, over HTTP, an offer whose stated term has no quotation or whose quotation is not in the source", async () => {
      const body = offerBody();
      body.offer.evidence = body.offer.evidence.filter((e) => e.field !== "sublicensing");
      expect((await call("/api/marketplace/offers", "POST", body, sellerToken)).status).toBe(409);
      const forged = offerBody({}, { attributionRequired: "Attribution is never required" });
      expect((await call("/api/marketplace/offers", "POST", forged, sellerToken)).status).toBe(409);
      const strangerSeller = await call("/api/marketplace/offers", "POST", offerBody(), strangerToken);
      expect(strangerSeller.status).toBe(403);
    });

    it("lets a seller create a new version and withdraw one, and keeps withdrawn offers out of the catalogue", async () => {
      const first = await (await call("/api/marketplace/offers", "POST", offerBody(), sellerToken)).json() as { id: string; version: number };
      await call(`/api/marketplace/staff/offers/${first.id}`, "POST", { version: first.version, decision: "approved", reason: "Quotes verified against source." }, staffToken);
      const second = await (await call("/api/marketplace/offers", "POST", { ...offerBody(), existingId: first.id }, sellerToken)).json() as { version: number };
      expect(second.version).toBe(first.version + 1);
      expect((await call(`/api/marketplace/offers/${first.id}?version=${first.version}`, "DELETE", undefined, strangerToken)).status).toBe(404);
      expect((await call(`/api/marketplace/offers/${first.id}?version=${first.version}`, "DELETE", undefined, sellerToken)).status).toBe(200);
      const catalog = await (await call("/api/marketplace/catalog")).json() as { offers: { id: string; version: number }[] };
      expect(catalog.offers.some((o) => o.id === first.id && o.version === first.version)).toBe(false);
    });

    it("lets a catalogue selection request a person handoff", async () => {
      const response = await call("/api/sessions", "POST", { project: { name: "Handoff", commercial: true, territories: ["US"], termMonths: 6 }, requiredAssetIds: [candidate.offer.assetId], offerRefs: [offerRef], handoff: true });
      expect(response.status).toBe(202);
      expect((await response.json() as { handoff?: { claimUrl: string } }).handoff?.claimUrl).toContain("/claim/");
    });

    it("treats ORDER_NOT_APPROVED as a retryable waiting state, not an unknown capture", async () => {
      const id = await readyRun();
      await market.approve(buyer, id);
      const order = await db.transaction((tx) => queue.enqueue(tx, id, "order", "initial"));
      expect((await runJob(order.id)).status).toBe("succeeded");
      const early = await call(`/api/sessions/${id}/capture`, "POST", {});
      expect(early.status).toBe(202);
      const job = await runJob((await early.json() as { operation: { id: string } }).operation.id);
      expect(job).toMatchObject({ status: "failed", errorCode: "ORDER_NOT_APPROVED", stage: "prepared" });
      expect((await db.pool.query("SELECT payout_state FROM licensegraph.purchases WHERE run_id=$1", [id])).rows[0].payout_state).not.toBe("reconcile");
      sim.approveOrder((await runs.read(id))!.session.order!.id);
      const again = await call(`/api/sessions/${id}/capture`, "POST", {});
      expect(again.status).toBe(202);
      expect((await runJob((await again.json() as { operation: { id: string } }).operation.id)).status).toBe("succeeded");
      expect((await runs.read(id))!.session.phase).toBe("captured");
    });

    it("keeps an unmatched financial webhook queued until its purchase exists, then applies it once and blocks release and sharing", async () => {
      const id = await readyRun();
      await market.approve(buyer, id);
      const order = await db.transaction((tx) => queue.enqueue(tx, id, "order", "initial"));
      await runJob(order.id);
      const captureId = `CAP-${randomUUID()}`;
      const event: PayPalEvent = { id: `WH-${randomUUID()}`, event_type: "PAYMENT.CAPTURE.REVERSED", resource: { supplementary_data: { related_ids: { capture_id: captureId } } } };
      await db.transaction(async (tx) => {
        await tx.query("INSERT INTO licensegraph.webhook_deliveries(event_id,sealed) VALUES ($1,$2)", [event.id, rt().cipher.seal(event, `webhook:${event.id}`)]);
        expect(await applyWebhook(rt(), tx, event)).toBe(false);
      });
      expect((await db.pool.query("SELECT status FROM licensegraph.webhook_deliveries WHERE event_id=$1", [event.id])).rows[0].status).toBe("queued");
      // Staff can see that an unmatched event is waiting, without the payload.
      const waiting = (await (await call("/api/marketplace/staff/reviews", "GET", undefined, await browser(staff))).json()) as { webhooks: { eventId: string }[] };
      expect(waiting.webhooks.map((w) => w.eventId)).toContain(event.id);
      expect(JSON.stringify(waiting.webhooks)).not.toContain("PAYMENT.CAPTURE.REVERSED");
      sim.approveOrder((await runs.read(id))!.session.order!.id);
      const capture = await db.transaction((tx) => queue.enqueue(tx, id, "capture", "initial"));
      expect((await runJob(capture.id)).status).toBe("succeeded");
      const real = (await runs.read(id))!.session.capture!.captureId;
      const grant = await market.share(buyer, id, "receipt", 1);
      await db.pool.query("UPDATE licensegraph.webhook_deliveries SET sealed=$2,created_at=now()-interval '1 minute',last_attempt_at=now()-interval '1 minute' WHERE event_id=$1", [event.id, rt().cipher.seal({ ...event, resource: { supplementary_data: { related_ids: { capture_id: real } } } }, `webhook:${event.id}`)]);
      expect(await processPendingWebhooks(rt())).toBeGreaterThanOrEqual(1);
      expect(await processPendingWebhooks(rt())).toBe(0);
      expect((await db.pool.query("SELECT status FROM licensegraph.webhook_deliveries WHERE event_id=$1", [event.id])).rows[0].status).toBe("processed");
      const session = (await runs.read(id))!.session;
      expect(session.ledger.events().filter((e) => e.kind === "payment_reversed")).toHaveLength(1);
      await expect(market.accept(buyer, id)).rejects.toThrow(/reversal/);
      await expect(market.share(buyer, id, "receipt", 1)).rejects.toThrow(/un-reversed/);
      expect((await call(`/api/marketplace/shared/${grant.token}`, "GET", undefined, strangerToken)).status).toBe(404);
      expect((await db.pool.query("SELECT payout_state FROM licensegraph.purchases WHERE run_id=$1", [id])).rows[0].payout_state).toBe("reconcile");
    });

    it("releases payouts after the seven-day hold without buyer action, and not a moment earlier", async () => {
      const id = await capturedRun();
      const payout = (await db.pool.query("SELECT id FROM licensegraph.operations WHERE run_id=$1 AND kind='payout'", [id])).rows[0].id as string;
      await db.pool.query("UPDATE licensegraph.operations SET available_at=now() WHERE id=$1", [payout]);
      expect((await runJob(payout)).status).toBe("failed");
      expect((await runs.read(id))!.session.payouts).toBeUndefined();
      await db.pool.query("UPDATE licensegraph.purchases SET release_at=now()-interval '1 second' WHERE run_id=$1", [id]);
      const retry = await call(`/api/sessions/${id}/payouts`, "POST", {});
      expect(retry.status).toBe(202);
      expect((await runJob((await retry.json() as { operation: { id: string } }).operation.id)).status).toBe("succeeded");
      expect((await runs.read(id))!.session.payouts!.lines).toHaveLength(1);
    });
    it("does not let a stale worker record state after its lease expired, and recovers by reading the existing provider record only", async () => {
      const id = await readyRun();
      await market.approve(buyer, id);
      const order = await db.transaction((tx) => queue.enqueue(tx, id, "order", "initial"));
      await runJob(order.id);
      const orderId = (await runs.read(id))!.session.order!.id;
      sim.approveOrder(orderId);
      let captures = 0;
      const slow = { ...sim, captureOrder: async (oid: string, key: string) => {
        captures += 1;
        const result = await sim.captureOrder(oid, key);
        // The lease runs out while the provider call is in flight, as after a long stall or a paused process.
        await db.pool.query("UPDATE licensegraph.operations SET lease_until=now()-interval '1 second' WHERE run_id=$1 AND kind='capture'", [id]);
        return result;
      } };
      const stale = new MarketplaceWorker(market, { ...deps, payments: slow as typeof sim });
      const capture = await db.transaction((tx) => queue.enqueue(tx, id, "capture", "initial"));
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try { await stale.once(); } finally { errors.mockRestore(); }
      expect(captures).toBe(1);
      // The stale worker wrote nothing: the run is still waiting at order_created, and the job is not marked done.
      expect((await runs.read(id))!.session.phase).toBe("order_created");
      await worker.once();
      expect((await queue.get(capture.id))).toMatchObject({ status: "reconcile" });
      // Nothing was sent again: the provider was asked to capture exactly once.
      expect(captures).toBe(1);
      const staffToken = await browser(staff);
      const wrong = await call(`/api/marketplace/staff/reconcile/${capture.id}`, "POST", { providerId: "SIM-DOES-NOT-EXIST", reason: "Checking the original order record." }, staffToken);
      expect(wrong.status).toBeGreaterThanOrEqual(400);
      expect((await queue.get(capture.id))).toMatchObject({ status: "reconcile" });
      const ok = await call(`/api/marketplace/staff/reconcile/${capture.id}`, "POST", { providerId: orderId, reason: "Checked the original order record." }, staffToken);
      expect(ok.status).toBe(200);
      expect(captures).toBe(1);
      const recovered = (await runs.read(id))!.session;
      expect(recovered.phase).toBe("captured");
      expect(recovered.capture?.captureId).toMatch(/^SIMCAP-/);
      expect((await queue.get(capture.id))!.status).toBe("succeeded");
    });
  });
  describe("dispute outcomes and races", () => {
    const drain = async (runId: string) => {
      for (let i = 0; i < 12; i++) {
        await db.pool.query("UPDATE licensegraph.operations SET available_at=now() WHERE run_id=$1 AND status='queued' AND kind IN ('payout','refund')", [runId]);
        if (!(await worker.once())) break;
      }
    };
    const resolve = async (disputeId: string, decision: string) => call(`/api/marketplace/staff/disputes/${disputeId}`, "POST", { decision, reason: "Reviewed the private evidence." }, await browser(staff));
    const dispute = async (runId: string) => (await market.dispute(buyer, runId, { reason: "The delivered rights do not match the source.", evidence: "Source comparison text." })).id as string;

    it("pays the authorized recipient when staff release a disputed purchase", async () => {
      const id = await capturedRun();
      const d = await dispute(id);
      expect((await resolve(d, "release")).status).toBe(200);
      await drain(id);
      expect((await runs.read(id))!.session.payouts!.lines.map((l) => l.email)).toEqual([seller.email]);
      expect((await db.pool.query("SELECT status FROM licensegraph.disputes WHERE id=$1", [d])).rows[0].status).toBe("released");
    });

    it("refunds the buyer in full when staff refund a disputed purchase, and no creator is paid", async () => {
      const id = await capturedRun();
      const d = await dispute(id);
      expect((await resolve(d, "refund")).status).toBe(200);
      await drain(id);
      const session = (await runs.read(id))!.session;
      expect(session.phase).toBe("refunded");
      expect(session.payouts).toBeUndefined();
      expect((await db.pool.query("SELECT payout_state FROM licensegraph.purchases WHERE run_id=$1", [id])).rows[0].payout_state).toBe("refunded");
      expect((await db.pool.query("SELECT status FROM licensegraph.disputes WHERE id=$1", [d])).rows[0].status).toBe("refunded");
    });

    it("keeps payouts blocked while a dispute is escalated, and a second resolution is refused", async () => {
      const id = await capturedRun();
      const d = await dispute(id);
      expect((await resolve(d, "escalate")).status).toBe(200);
      await expect(market.accept(buyer, id)).rejects.toThrow(/dispute/);
      await drain(id);
      expect((await runs.read(id))!.session.payouts).toBeUndefined();
      expect((await resolve(d, "release")).status).toBe(200);
      expect((await resolve(d, "release")).status).toBe(409);
    });

    it("refuses a refund once payouts may have been submitted, and requires escalation instead", async () => {
      const id = await capturedRun();
      const release = await market.accept(buyer, id);
      await runJob(release.id);
      const late = await dispute(id);
      expect((await resolve(late, "refund")).status).toBe(409);
      expect((await resolve(late, "escalate")).status).toBe(200);
    });

    it("never both pays creators and holds a dispute, however accept and dispute interleave", async () => {
      for (let round = 0; round < 3; round++) {
        const id = await capturedRun();
        await Promise.allSettled([market.accept(buyer, id), dispute(id)]);
        await drain(id);
        const open = await db.pool.query("SELECT 1 FROM licensegraph.disputes WHERE run_id=$1 AND status IN ('open','escalated')", [id]);
        const paid = Boolean((await runs.read(id))!.session.payouts);
        expect(open.rowCount && paid, `round ${round}`).toBeFalsy();
      }
    });

    it("never both refunds the buyer and pays creators, however accept and refund interleave", async () => {
      for (let round = 0; round < 3; round++) {
        const id = await capturedRun();
        await Promise.allSettled([market.accept(buyer, id), call(`/api/sessions/${id}/refund`, "POST", {})]);
        await drain(id);
        const session = (await runs.read(id))!.session;
        expect(session.phase === "refunded" && Boolean(session.payouts), `round ${round}`).toBe(false);
      }
    });

    it("blocks release when the licensor is suspended after approval", async () => {
      const other = await approvedSeller();
      const f = fixtures[0]!;
      const offer = (await extractOffer(demoModel, f.doc)).offer!;
      const published = await market.publishOffer(other.person, offer, f.doc);
      await market.reviewOffer(staff, published.id, published.version, "approved", "Quotes match the source.");
      const sealed = (await db.pool.query("SELECT sealed FROM licensegraph.offers WHERE id=$1", [published.id])).rows[0].sealed;
      const own = cipher.open<{ offer: LicenseOffer; document: SourceDocument }>(sealed, `offer:${published.id}:${published.version}`);
      const s = createSession({ project: { name: "Suspension", commercial: true, territories: ["US"], termMonths: 6 }, requiredAssetIds: [own.offer.assetId], documents: [own.document] });
      s.ownerId = buyer.id;
      const job = await db.transaction(async (tx) => { await runs.create(s, buyer.id, tx); return queue.enqueue(tx, s.id, "pipeline", "initial", { offers: [own.offer] }); });
      await runJob(job.id);
      await market.approve(buyer, s.id);
      const order = await db.transaction((tx) => queue.enqueue(tx, s.id, "order", "initial"));
      await runJob(order.id);
      sim.approveOrder((await runs.read(s.id))!.session.order!.id);
      const capture = await db.transaction((tx) => queue.enqueue(tx, s.id, "capture", "initial"));
      await runJob(capture.id);
      await market.reviewLicensor(staff, other.id, "suspended", "Rights evidence withdrawn.");
      const release = await market.accept(buyer, s.id);
      expect((await runJob(release.id)).status).toBe("failed");
      expect((await runs.read(s.id))!.session.payouts).toBeUndefined();
    });
  });
  describe("multiple worker instances", () => {
    it("runs each queued job exactly once when several workers drain the queue together", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const s = createSession({ project: { name: `Parallel ${i}`, commercial: true, territories: ["US"], termMonths: 6 }, requiredAssetIds: [candidate.offer.assetId], documents: [candidate.document] });
        s.ownerId = buyer.id;
        await db.transaction(async (tx) => { await runs.create(s, buyer.id, tx); await queue.enqueue(tx, s.id, "pipeline", "initial", { offers: [candidate.offer] }); });
        ids.push(s.id);
      }
      const workers = [new MarketplaceWorker(market, deps), new MarketplaceWorker(market, deps), new MarketplaceWorker(market, deps)];
      await Promise.all(workers.map(async (w) => { for (let i = 0; i < 20; i++) if (!(await w.once())) break; }));
      for (const id of ids) {
        const ops = (await db.pool.query("SELECT status FROM licensegraph.operations WHERE run_id=$1 AND kind='pipeline'", [id])).rows;
        expect(ops, id).toEqual([{ status: "succeeded" }]);
        expect((await runs.read(id))!.session.phase).toBe("verified");
        const events = (await runs.read(id))!.session.ledger.events();
        expect(new Set(events.map((e) => e.seq)).size).toBe(events.length);
      }
    });

    it("sends one provider capture even when workers and duplicate requests race for it", async () => {
      const id = await readyRun();
      await market.approve(buyer, id);
      const order = await db.transaction((tx) => queue.enqueue(tx, id, "order", "initial"));
      await runJob(order.id);
      sim.approveOrder((await runs.read(id))!.session.order!.id);
      let captures = 0;
      const counting = { ...sim, captureOrder: async (oid: string, key: string) => { captures += 1; return sim.captureOrder(oid, key); } };
      const workers = [new MarketplaceWorker(market, { ...deps, payments: counting as typeof sim }), new MarketplaceWorker(market, { ...deps, payments: counting as typeof sim })];
      const requests = await Promise.all([1, 2, 3].map(() => call(`/api/sessions/${id}/capture`, "POST", {})));
      expect(new Set(await Promise.all(requests.map(async (r) => ((await r.json()) as { operation: { id: string } }).operation.id))).size).toBe(1);
      await Promise.all(workers.map(async (w) => { for (let i = 0; i < 6; i++) if (!(await w.once())) break; }));
      expect(captures).toBe(1);
      expect((await runs.read(id))!.session.phase).toBe("captured");
    });
  });
  describe("response contract", () => {
    const rt = () => (globalThis as unknown as { __licensegraphPrivate: PrivateRuntime }).__licensegraphPrivate;
    const parsed = async <T extends { safeParse: (v: unknown) => { success: boolean; error?: unknown } }>(schema: T, response: Response, status = 200) => {
      expect(response.status).toBe(status);
      const body = await response.json();
      const result = schema.safeParse(body);
      expect(result.success, JSON.stringify(result.error ?? body).slice(0, 400)).toBe(true);
      return body as Record<string, any>;
    };

    it("returns bodies matching the published response schemas on every exercised route", async () => {
      const sToken = await browser(seller), stToken = await browser(staff);
      await parsed(Res.Ready, await call("/api/marketplace/ready"));
      await parsed(CatalogList, await call("/api/marketplace/catalog"));
      await parsed(MyOffers, await call("/api/marketplace/offers", "GET", undefined, sToken));
      await parsed(Res.LicensorProfile, await call("/api/marketplace/licensor", "GET", undefined, sToken));
      await parsed(Res.Purchases, await call("/api/marketplace/licensor/purchases", "GET", undefined, sToken));
      await parsed(Res.StaffQueue, await call("/api/marketplace/staff/reviews", "GET", undefined, stToken));

      // Offer lifecycle: submit, review, withdraw.
      const text = "Licence fee: USD 55.00. Commercial use is permitted. Territory: Worldwide. Term: 12 months.";
      const q = (field: string, quote: string) => ({ documentId: "source", field, quote, start: text.indexOf(quote), end: text.indexOf(quote) + quote.length });
      const submitted = await parsed(Res.Submitted, await call("/api/marketplace/offers", "POST", { offer: { id: "draft", assetId: "asset-contract", priceCents: 5500, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: 12 },
        evidence: [q("price", "USD 55.00"), q("commercialUse", "Commercial use is permitted"), q("territories", "Territory: Worldwide"), q("term", "Term: 12 months")] }, document: { id: "source", assetId: "asset-contract", text } }, sToken), 201);
      await parsed(Res.Submitted, await call(`/api/marketplace/staff/offers/${submitted.id}`, "POST", { version: submitted.version, decision: "approved", reason: "Quotes match the source text." }, stToken));
      await parsed(Res.Submitted, await call(`/api/marketplace/offers/${submitted.id}?version=${submitted.version}`, "DELETE", undefined, sToken));

      // Purchase lifecycle: operation, disputes, shares, agent credentials.
      const id = await capturedRun();
      const op = (await db.pool.query("SELECT id FROM licensegraph.operations WHERE run_id=$1 LIMIT 1", [id])).rows[0].id as string;
      await parsed(Res.Operation, await call(`/api/marketplace/operations/${op}`));
      const share = await parsed(Res.ShareCreated, await call(`/api/marketplace/runs/${id}/shares`, "POST", { kind: "receipt", days: 1 }), 201);
      await parsed(Res.Shares, await call(`/api/marketplace/runs/${id}/shares`));
      const shared = await call(`/api/marketplace/shared/${share.token}`, "GET", undefined, strangerToken);
      await parsed(Res.SharedReceipt, shared);
      await parsed(Res.Revoked, await call(`/api/marketplace/shares/${share.id}`, "DELETE"));
      const opened = await parsed(Res.DisputeOpened, await call(`/api/marketplace/runs/${id}/disputes`, "POST", { reason: "The rights do not match the source.", evidence: "Comparison attached." }), 201);
      await parsed(Res.DisputeResolved, await call(`/api/marketplace/staff/disputes/${opened.id}`, "POST", { decision: "escalate", reason: "Escalated for review of evidence." }, stToken));
      const accepted = await capturedRun();
      await parsed(Res.Operation, await call(`/api/marketplace/runs/${accepted}/accept`, "POST", {}), 202);
      const created = await parsed(Res.AgentTokenCreated, await call("/api/marketplace/agent-tokens", "POST", { name: "contract agent" }), 201);
      await parsed(Res.AgentTokens, await call("/api/marketplace/agent-tokens"));
      await parsed(Res.Revoked, await call(`/api/marketplace/agent-tokens/${created.id}`, "DELETE"));
      const health = await call("/api/marketplace/health");
      expect([200, 503]).toContain(health.status);
      expect(Res.Health.safeParse(await health.json()).success).toBe(true);
    });

    it("documents a route spec for every marketplace route family the dispatcher serves", () => {
      const documented = new Set(ROUTE_SPECS.map((r) => `${r.method} ${r.path}`));
      for (const key of ["get /api/marketplace/catalog", "post /api/marketplace/offers", "delete /api/marketplace/offers/{id}", "post /api/marketplace/staff/reconcile/{id}", "get /api/marketplace/health"]) expect(documented.has(key), key).toBe(true);
      expect(rt()).toBeDefined();
    });
  });
});
