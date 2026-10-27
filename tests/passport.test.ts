import { describe, expect, it, vi } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, runPipeline, startPayment, type Deps, type Session } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";
import { issuePassport } from "../src/passport/issue";
import { PassportError, verifyPassport, type Passport } from "../src/passport/passport";
import { checkSignature, signPassport } from "../src/server/passport-signing";

const payments = {
  createOrder: vi.fn().mockResolvedValue({ id: "ORD1", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORD1" }),
  captureOrder: vi.fn().mockResolvedValue({ id: "ORD1", status: "COMPLETED", captureId: "CAP1", amount: { currency: "USD", value: "329.00" } }),
  createPayout: vi.fn().mockResolvedValue({ batchId: "BATCH1", status: "PENDING" }),
  getPayout: vi.fn(),
};
const deps: Deps = { model: demoModel, proposer: greedyProposer, payments, today: () => "2026-11-05" };

async function paidSession(): Promise<Session> {
  const s = createSession({ project: { ...sampleProject }, requiredAssetIds: [...sampleRequiredAssets], documents: sampleDocuments.map((d) => ({ ...d })) });
  await runPipeline(s, deps);
  approveSession(s, "Kiran");
  await startPayment(s, deps);
  await completePayment(s, deps);
  return s;
}

const clone = (p: Passport): Passport => JSON.parse(JSON.stringify(p));
const failing = async (p: Passport) => (await verifyPassport(p)).checks.filter((c) => !c.ok).map((c) => c.id);

describe("issuePassport", () => {
  it("refuses a run that has not been paid", async () => {
    const s = createSession({ project: { ...sampleProject }, requiredAssetIds: [...sampleRequiredAssets], documents: sampleDocuments.map((d) => ({ ...d })) });
    await runPipeline(s, deps);
    expect(() => issuePassport(s)).toThrow(PassportError);
  });

  it("describes the purchase, the payouts and the price-only comparison, with no email addresses", async () => {
    const p = issuePassport(await paidSession());
    expect(p).toMatchObject({
      version: 1,
      paypal: { orderId: "ORD1", captureId: "CAP1", environment: "sandbox" },
      bundle: { totalCents: 32_900, currency: "USD" },
      approval: { approvedBy: "Kiran" },
      payouts: { batchId: "BATCH1", totalCents: 32_900 },
      comparison: { naiveTotalCents: 20_000 + 4_500 + 4_900, compliancePremiumCents: 32_900 - 29_400 },
    });
    expect(p.comparison.blockedPurchases[0]).toMatchObject({ assetId: "image", offerId: "offer-photo" });
    expect(p.documents.map((d) => d.id).sort()).toEqual(["archive", "font", "song"]);
    expect(JSON.stringify(p)).not.toContain("licensegraph-demo.example");
  });

  it("is reproducible: same run, same passport", async () => {
    const s = await paidSession();
    expect(issuePassport(s)).toEqual(issuePassport(s));
  });
});

describe("verifyPassport", () => {
  it("passes an untouched passport on every check", async () => {
    const result = await verifyPassport(issuePassport(await paidSession()));
    expect(result.checks.map((c) => c.id)).toEqual(["ledger-chain", "bundle-digest", "approval-recorded", "terms-in-ledger", "evidence", "rules", "payment", "payouts"]);
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("survives a JSON round trip, as a downloaded file would", async () => {
    expect((await verifyPassport(clone(issuePassport(await paidSession())))).ok).toBe(true);
  });

  it("catches a changed price", async () => {
    const p = clone(issuePassport(await paidSession()));
    p.bundle.offers[0]!.priceCents = 1;
    expect(await failing(p)).toEqual(expect.arrayContaining(["bundle-digest", "terms-in-ledger", "payment"]));
  });

  it("catches changed terms, even ones the digest does not cover", async () => {
    const p = clone(issuePassport(await paidSession()));
    p.bundle.offers[0]!.terms.territories = ["US"];
    expect(await failing(p)).toContain("terms-in-ledger");
  });

  it("catches an edited ledger event", async () => {
    const p = clone(issuePassport(await paidSession()));
    p.ledger.events[3]!.payload.priceCents = 5;
    expect(await failing(p)).toContain("ledger-chain");
  });

  it("catches a quote that is not in the licence text", async () => {
    const p = clone(issuePassport(await paidSession()));
    p.documents[0]!.text = p.documents[0]!.text.replace("24 months", "99 months");
    expect(await failing(p)).toContain("evidence");
  });

  it("catches a different capture id or amount", async () => {
    const p = clone(issuePassport(await paidSession()));
    p.paypal.captureId = "FAKE";
    expect(await failing(p)).toContain("payment");
    const q = clone(issuePassport(await paidSession()));
    q.paypal.amount.value = "1.00";
    expect(await failing(q)).toContain("payment");
  });

  it("catches a bundle that would not pass the rules, by re-running them", async () => {
    const p = clone(issuePassport(await paidSession()));
    p.project.territories = ["WORLD"];
    p.bundle.offers[1]!.terms.territories = ["US"]; // narrower licence than the project needs
    const failed = await failing(p);
    expect(failed).toContain("rules");
  });

  it("catches payouts that do not add up", async () => {
    const p = clone(issuePassport(await paidSession()));
    p.payouts!.lines[0]!.amountCents += 100;
    expect(await failing(p)).toContain("payouts");
  });

  it("omits the payout check when there were no payouts", async () => {
    const s = await paidSession();
    s.payouts = undefined;
    expect((await verifyPassport(issuePassport(s))).checks.map((c) => c.id)).not.toContain("payouts");
  });
});

describe("passport signing", () => {
  it("signs with a secret and recognises its own signature", async () => {
    const signed = signPassport(issuePassport(await paidSession()), "s3cret");
    expect(signed.signature).toMatchObject({ algorithm: "HMAC-SHA256" });
    expect(checkSignature(signed, "s3cret")).toBe("valid");
  });

  it("rejects a changed passport or a wrong secret", async () => {
    const signed = signPassport(issuePassport(await paidSession()), "s3cret");
    expect(checkSignature(signed, "other")).toBe("invalid");
    const tampered = clone(signed);
    tampered.paypal.captureId = "FAKE";
    expect(checkSignature(tampered, "s3cret")).toBe("invalid");
  });

  it("says so when there is nothing to check or nothing to check with", async () => {
    const unsigned = issuePassport(await paidSession());
    expect(signPassport(unsigned, undefined)).toBe(unsigned);
    expect(checkSignature(unsigned, "s3cret")).toBe("unsigned");
    expect(checkSignature(signPassport(unsigned, "s3cret"), undefined)).toBe("unavailable");
  });
});
