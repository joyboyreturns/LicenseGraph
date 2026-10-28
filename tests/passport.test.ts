import { describe, expect, it, vi } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, runPipeline, startPayment, type Deps, type Session } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";
import { issuePassport } from "../src/passport/issue";
import { PassportError, verifyPassport, type Passport } from "../src/passport/passport";
import { checkSignature, passportKey, signPassport, signWithHmac, verifyWithPublicKey } from "../src/server/passport-signing";
import { bundleCanonical, sha256Hex } from "../src/core/digest";
import { eventCanonical, GENESIS_HASH } from "../src/ledger/chain";

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
  it("still verifies historical downloaded passports with the original digest format", async () => {
    const p = clone(issuePassport(await paidSession()));
    p.bundle.digestVersion = undefined;
    p.bundle.digest = await sha256Hex(bundleCanonical(p.bundle.offers, 1));
    p.approval.bundleDigest = p.bundle.digest;
    let previous = GENESIS_HASH;
    for (const event of p.ledger.events) {
      if (event.kind === "approved") event.payload.bundleDigest = p.bundle.digest;
      event.prevHash = previous;
      event.hash = await sha256Hex(eventCanonical(event));
      previous = event.hash;
    }
    p.ledger.head = previous;
    expect((await verifyPassport(p)).ok).toBe(true);
  });
  it("passes an untouched passport on every check", async () => {
    const result = await verifyPassport(issuePassport(await paidSession()));
    expect(result.checks.map((c) => c.id)).toEqual(["ledger-chain", "bundle-digest", "approval-recorded", "terms-in-ledger", "evidence", "rules", "payment", "payment-standing", "payouts"]);
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

  it("catches changed terms in both the digest and ledger", async () => {
    const p = clone(issuePassport(await paidSession()));
    p.bundle.offers[0]!.terms.territories = ["US"];
    expect(await failing(p)).toEqual(expect.arrayContaining(["bundle-digest", "terms-in-ledger"]));
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

  it("catches a different payment currency or order id", async () => {
    for (const change of [
      (p: Passport) => { p.paypal.amount.currency = "EUR"; },
      (p: Passport) => { p.paypal.orderId = "OTHER"; },
    ]) {
      const p = clone(issuePassport(await paidSession()));
      change(p);
      expect(await failing(p)).toContain("payment");
    }
  });

  it("catches redistributed creator payments even if the total is unchanged", async () => {
    const p = clone(issuePassport(await paidSession()));
    p.payouts!.lines[0]!.amountCents += 100;
    p.payouts!.lines[1]!.amountCents -= 100;
    expect(await failing(p)).toContain("payouts");
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
  it("authenticates every passport field, including source documents and project requirements", async () => {
    const signed = signPassport(issuePassport(await paidSession()), "secret");
    for (const change of [
      (p: Passport) => { p.project.name = "Other project"; },
      (p: Passport) => { p.project.commercial = false; },
      (p: Passport) => { p.documents[0]!.text += " Extra terms"; },
      (p: Passport) => { p.paypal.environment = "simulator"; },
      (p: Passport) => { p.payouts!.lines[0]!.licensor = "Other creator"; },
      (p: Passport) => { p.comparison.naiveTotalCents = 0; },
    ]) {
      const copy = clone(signed);
      change(copy);
      expect(checkSignature(copy, "secret")).toBe("invalid");
    }
  });
  it("signs with a secret and recognises its own signature", async () => {
    const signed = signPassport(issuePassport(await paidSession()), "s3cret");
    expect(signed.signature).toMatchObject({ algorithm: "Ed25519" });
    expect(checkSignature(signed, "s3cret")).toBe("valid");
  });

  it("can be checked with the public key alone, and the key does not reveal the secret", async () => {
    const signed = signPassport(issuePassport(await paidSession()), "s3cret");
    const { publicKey, keyId } = passportKey("s3cret");
    expect(signed.signature?.keyId).toBe(keyId);
    expect(publicKey).not.toContain("s3cret");
    expect(verifyWithPublicKey(signed, publicKey)).toBe("valid");
    // Someone else's key, or a changed passport, does not pass.
    expect(verifyWithPublicKey(signed, passportKey("another secret").publicKey)).toBe("invalid");
    const tampered = clone(signed);
    tampered.bundle.totalCents += 1;
    expect(verifyWithPublicKey(tampered, publicKey)).toBe("invalid");
    expect(verifyWithPublicKey(signed, "not a key")).toBe("invalid");
    expect(verifyWithPublicKey(issuePassport(await paidSession()), publicKey)).toBe("unsigned");
    // The same secret always gives the same key, so a restart does not orphan earlier passports.
    expect(passportKey("s3cret").publicKey).toBe(publicKey);
  });

  it("still recognises a passport signed with the earlier shared-secret signature, which only the server can check", async () => {
    const old = signWithHmac(issuePassport(await paidSession()), "s3cret");
    expect(old.signature?.algorithm).toBe("HMAC-SHA256");
    expect(checkSignature(old, "s3cret")).toBe("valid");
    expect(checkSignature(old, "other")).toBe("invalid");
    expect(verifyWithPublicKey(old, passportKey("s3cret").publicKey)).toBe("unsupported");
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
