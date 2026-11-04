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
    await market.reviewOffer(staff, published.id, published.version, "approved");
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
});
