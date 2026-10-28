import { describe, expect, it, vi } from "vitest";
import type { Bundle, LicenseOffer, Project } from "../src/core/types";
import { approve, bundleDigest, PaymentRefused, startCheckout } from "../src/payments/checkout";
import { paymentRequestId } from "../src/payments/request-id";

const project: Project = { name: "Promo film", commercial: true, territories: ["US"], termMonths: 12, budgetCents: 50_000 };

const offer = (over: Partial<LicenseOffer> = {}): LicenseOffer => ({
  id: "o1",
  assetId: "song",
  priceCents: 20_000,
  currency: "USD",
  terms: { commercialUse: true, territories: ["WORLD"], termMonths: 24 },
  evidence: [{ documentId: "d1", quote: "Worldwide commercial use, 24 months." }],
  ...over,
});

const good: Bundle = { offers: [offer()] };
const created = { id: "ORD1", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://pp/approve" };
const makeClient = () => ({ createOrder: vi.fn().mockResolvedValue(created) });

const input = (bundle: Bundle, approval = approve(bundle, "owner")) => ({ project, requiredAssetIds: ["song"], bundle, approval });

describe("startCheckout", () => {
  it("creates an order for a verified, approved bundle", async () => {
    const client = makeClient();
    const order = await startCheckout(client, input(good));

    expect(order).toEqual(created);
    expect(client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 20_000, currency: "USD", requestId: paymentRequestId("order", JSON.stringify([bundleDigest(good), ""])) }),
    );
  });

  it("itemises the order by licence and tags it with the approved bundle's digest", async () => {
    const client = makeClient();
    await startCheckout(client, input(good));
    expect(client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ name: "Licence for song", description: "Offer o1", amountCents: 20_000 }], customId: bundleDigest(good) }),
    );
  });

  it("scopes the idempotency key, so the same bundle can be bought again in a new session", async () => {
    const keys: string[] = [];
    const client = { createOrder: vi.fn(async (o: { requestId: string }) => (keys.push(o.requestId), created)) };
    await startCheckout(client, { ...input(good), idempotencyScope: "s1" });
    await startCheckout(client, { ...input(good), idempotencyScope: "s1" });
    await startCheckout(client, { ...input(good), idempotencyScope: "s2" });
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[0]!.length).toBeLessThanOrEqual(38);
  });

  it("refuses a bundle that fails verification, even if approved", async () => {
    const client = makeClient();
    const bad: Bundle = { offers: [offer({ terms: { commercialUse: false, territories: ["WORLD"], termMonths: 24 } })] };

    const err = await startCheckout(client, input(bad)).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRefused);
    expect(err.violations.map((v: { rule: string }) => v.rule)).toEqual(["commercial-use"]);
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it("refuses without an approval", async () => {
    const client = makeClient();
    await expect(startCheckout(client, { ...input(good), approval: undefined })).rejects.toThrow(/not been approved/);
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it("refuses when the approval was for a different bundle", async () => {
    const client = makeClient();
    const approvedOther = approve({ offers: [offer({ priceCents: 1_000 })] }, "owner");
    await expect(startCheckout(client, input(good, approvedOther))).rejects.toThrow(/does not match/);
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it("requires approval again if compliant terms or evidence change after sign-off", async () => {
    const original = { offers: [offer()] };
    const approval = approve(original, "owner");
    const client = makeClient();
    original.offers[0]!.terms.termMonths = 36;
    await expect(startCheckout(client, input(original, approval))).rejects.toThrow(/does not match/);
    original.offers[0]!.terms.termMonths = 24;
    original.offers[0]!.evidence[0]!.quote += " changed";
    await expect(startCheckout(client, input(original, approval))).rejects.toThrow(/does not match/);
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it("refuses an offer that expired before the purchase date", async () => {
    const client = makeClient();
    const expiring: Bundle = { offers: [offer({ terms: { commercialUse: true, territories: ["WORLD"], termMonths: 24, offerValidUntil: "2026-11-30" } })] };

    await expect(startCheckout(client, { ...input(expiring), today: "2026-12-01" })).rejects.toThrow(/failed verification/);
    expect(client.createOrder).not.toHaveBeenCalled();
    await expect(startCheckout(client, { ...input(expiring), today: "2026-11-30" })).resolves.toEqual(created);
  });

  it("refuses an empty bundle", async () => {
    const client = makeClient();
    const empty: Bundle = { offers: [] };
    await expect(startCheckout(client, { project, requiredAssetIds: [], bundle: empty, approval: approve(empty, "owner") })).rejects.toThrow(/empty/);
  });
});

describe("bundleDigest", () => {
  it("changes when a price changes and ignores offer order", () => {
    const a = offer({ id: "a" });
    const b = offer({ id: "b", assetId: "font" });
    expect(bundleDigest({ offers: [a, b] })).toBe(bundleDigest({ offers: [b, a] }));
    expect(bundleDigest({ offers: [a] })).not.toBe(bundleDigest({ offers: [{ ...a, priceCents: a.priceCents + 1 }] }));
  });
});
