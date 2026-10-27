// Hits the real PayPal Sandbox. Skipped unless RUN_PAYPAL_SANDBOX=1 (use `npm run test:live`).
// Capturing needs a human buyer to approve the order, so capture is covered by `npm run sandbox:order`.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Bundle, Project } from "../src/core/types";
import { approve, startCheckout } from "../src/payments/checkout";
import { configFromEnv, createPayPalClient } from "../src/payments/paypal";

describe.skipIf(!process.env.RUN_PAYPAL_SANDBOX)("PayPal Sandbox (live)", () => {
  let client: ReturnType<typeof createPayPalClient>;
  beforeAll(() => {
    client = createPayPalClient(configFromEnv());
  });

  it("creates an order and returns a Sandbox approval link", async () => {
    const order = await client.createOrder({ amountCents: 500, currency: "USD", referenceId: "live-test", description: "live test", requestId: randomUUID() });
    expect(order.status).toBe("PAYER_ACTION_REQUIRED");
    expect(new URL(order.approveUrl).host).toBe("www.sandbox.paypal.com");
  });

  it("returns the same order when a request is retried with the same key", async () => {
    const requestId = randomUUID();
    const args = { amountCents: 500, currency: "USD", referenceId: "live-test", description: "live test", requestId };
    const [a, b] = [await client.createOrder(args), await client.createOrder(args)];
    expect(b.id).toBe(a.id);
  });

  it("goes from verified, approved bundle to a Sandbox order", async () => {
    const project: Project = { name: `live-${randomUUID().slice(0, 8)}`, commercial: true, territories: ["US"], termMonths: 12 };
    const bundle: Bundle = {
      offers: [
        {
          id: "o1",
          assetId: "song",
          priceCents: 1_250,
          currency: "USD",
          terms: { commercialUse: true, territories: ["WORLD"], termMonths: "perpetual" },
          evidence: [{ documentId: "d1", quote: "Worldwide, perpetual, commercial." }],
        },
      ],
    };
    const order = await startCheckout(client, { project, requiredAssetIds: ["song"], bundle, approval: approve(bundle, "owner") });
    expect(order.id).toBeTruthy();
  });
});
