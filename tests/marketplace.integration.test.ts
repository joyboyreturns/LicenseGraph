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
});
