import { randomUUID } from "node:crypto";
import type { CapturedOrder, CreatedOrder, PayoutItemInput, PayoutStatus } from "./paypal";
import { centsToValue } from "./paypal";

interface SimOrder {
  id: string;
  amountCents: number;
  currency: string;
  returnUrl?: string;
  cancelUrl?: string;
  approved: boolean;
  captured?: CapturedOrder;
}

interface SimPayout {
  batchId: string;
  createdAt: number;
  items: PayoutItemInput[];
}

/**
 * A stand-in for PayPal that anyone can run without an account. It follows the same rules the real
 * Sandbox does where they matter here: an order cannot be captured until the buyer approves it,
 * retries with the same request id return the same order, and payouts settle shortly after being
 * created. It moves no money and is always labelled as a simulator in the app.
 */
export function createPayPalSimulator(options: { appUrl: () => string; now?: () => number; settleAfterMs?: number; /** Make the first payout batch fail, so the failure and retry path can be shown and tested. */ failFirstPayout?: boolean }) {
  const now = options.now ?? Date.now;
  const settleAfterMs = options.settleAfterMs ?? 3_000;
  const orders = new Map<string, SimOrder>();
  const byRequest = new Map<string, string>();
  const payouts = new Map<string, SimPayout>();
  let failNext = options.failFirstPayout ?? false;

  return {
    async createOrder(input: { amountCents: number; currency: string; requestId: string; returnUrl?: string; cancelUrl?: string }): Promise<CreatedOrder> {
      const existing = byRequest.get(input.requestId);
      const id = existing ?? `SIM-${randomUUID().slice(0, 12).toUpperCase()}`;
      if (!existing) {
        centsToValue(input.amountCents); // same validation as the real client
        orders.set(id, { id, amountCents: input.amountCents, currency: input.currency, returnUrl: input.returnUrl, cancelUrl: input.cancelUrl, approved: false });
        byRequest.set(input.requestId, id);
      }
      return { id, status: "PAYER_ACTION_REQUIRED", approveUrl: `${options.appUrl()}/simulator/checkout?order=${id}` };
    },

    async captureOrder(orderId: string, _requestId: string): Promise<CapturedOrder> {
      const order = orders.get(orderId);
      if (!order) throw new Error(`PayPal /v2/checkout/orders/${orderId}/capture failed: 404 RESOURCE_NOT_FOUND (simulator)`);
      if (order.captured) return order.captured;
      if (!order.approved) throw new Error(`PayPal /v2/checkout/orders/${orderId}/capture failed: 422 ORDER_NOT_APPROVED (simulator)`);
      order.captured = { id: order.id, status: "COMPLETED", captureId: `SIMCAP-${randomUUID().slice(0, 10).toUpperCase()}`, amount: { currency: order.currency, value: centsToValue(order.amountCents) } };
      return order.captured;
    },

    async createPayout(input: { batchId: string; subject: string; items: PayoutItemInput[] }): Promise<{ batchId: string; status: string }> {
      if (failNext) {
        failNext = false;
        throw new Error("PayPal /v1/payments/payouts failed: 403 INSUFFICIENT_FUNDS (simulated failure)");
      }
      if (!payouts.has(input.batchId)) payouts.set(input.batchId, { batchId: input.batchId, createdAt: now(), items: input.items });
      return { batchId: input.batchId, status: "PENDING" };
    },

    async getPayout(batchId: string): Promise<PayoutStatus> {
      const payout = payouts.get(batchId);
      if (!payout) throw new Error(`PayPal /v1/payments/payouts/${batchId} failed: 404 (simulator)`);
      const settled = now() - payout.createdAt >= settleAfterMs;
      return { batchId, status: settled ? "SUCCESS" : "PROCESSING", items: payout.items.map((i) => ({ itemId: i.itemId, status: settled ? "SUCCESS" : "PENDING", receiver: i.receiver })) };
    },

    /** Simulator only: what the buyer's "Approve" button does. Returns where to send the browser next. */
    approveOrder(orderId: string): { returnUrl?: string } {
      const order = orders.get(orderId);
      if (!order) throw new Error("Unknown simulated order");
      order.approved = true;
      return { returnUrl: order.returnUrl };
    },

    /** Simulator only: what the page needs to render the checkout. */
    describeOrder(orderId: string): { id: string; amountCents: number; currency: string; approved: boolean; captured: boolean; cancelUrl?: string } | undefined {
      const o = orders.get(orderId);
      return o && { id: o.id, amountCents: o.amountCents, currency: o.currency, approved: o.approved, captured: Boolean(o.captured), cancelUrl: o.cancelUrl };
    },
  };
}

export type PayPalSimulator = ReturnType<typeof createPayPalSimulator>;
