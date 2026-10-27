import { describe, expect, it, vi } from "vitest";
import type { Bundle, LicenseOffer, Project } from "../src/core/types";
import { approve, bundleDigest, PaymentRefused, startCheckout } from "../src/payments/checkout";

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
      expect.objectContaining({ amountCents: 20_000, currency: "USD", requestId: `lg-${bundleDigest(good).slice(0, 32)}` }),
    );
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
