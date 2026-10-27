import { describe, expect, it } from "vitest";
import { createPayPalSimulator } from "../src/payments/simulator";

const make = (start = 0) => {
  let t = start;
  const sim = createPayPalSimulator({ appUrl: () => "http://app", now: () => t });
  return { sim, advance: (ms: number) => void (t += ms) };
};
const order = { amountCents: 32_900, currency: "USD", requestId: "r1", returnUrl: "http://app/api/sessions/s1/return" };

describe("PayPal simulator", () => {
  it("creates an order whose checkout link points at the local simulated page", async () => {
    const { sim } = make();
    const o = await sim.createOrder(order);
    expect(o).toMatchObject({ status: "PAYER_ACTION_REQUIRED", approveUrl: `http://app/simulator/checkout?order=${o.id}` });
    expect(sim.describeOrder(o.id)).toMatchObject({ amountCents: 32_900, approved: false, captured: false });
  });

  it("returns the same order for the same request id, and a new one for a new id", async () => {
    const { sim } = make();
    const a = await sim.createOrder(order);
    expect((await sim.createOrder(order)).id).toBe(a.id);
    expect((await sim.createOrder({ ...order, requestId: "r2" })).id).not.toBe(a.id);
  });

  it("refuses to capture before the buyer approves, like PayPal", async () => {
    const { sim } = make();
    const o = await sim.createOrder(order);
    await expect(sim.captureOrder(o.id, "c1")).rejects.toThrow(/ORDER_NOT_APPROVED/);
  });

  it("captures exactly the ordered amount once approved, and capturing again returns the same capture", async () => {
    const { sim } = make();
    const o = await sim.createOrder(order);
    expect(sim.approveOrder(o.id)).toEqual({ returnUrl: order.returnUrl });
    const cap = await sim.captureOrder(o.id, "c1");
    expect(cap).toMatchObject({ status: "COMPLETED", amount: { currency: "USD", value: "329.00" } });
    expect(cap.captureId).toMatch(/^SIMCAP-/);
    expect(await sim.captureOrder(o.id, "c2")).toEqual(cap);
  });

  it("reports unknown orders", async () => {
    const { sim } = make();
    await expect(sim.captureOrder("nope", "c")).rejects.toThrow(/404/);
    expect(() => sim.approveOrder("nope")).toThrow();
    expect(sim.describeOrder("nope")).toBeUndefined();
  });

  it("settles payouts a few seconds after they are created, idempotently by batch id", async () => {
    const { sim, advance } = make();
    const items = [{ itemId: "i1", receiver: "a@x.test", amountCents: 100, currency: "USD", note: "n" }];
    expect(await sim.createPayout({ batchId: "B1", subject: "s", items })).toEqual({ batchId: "B1", status: "PENDING" });
    expect((await sim.getPayout("B1")).status).toBe("PROCESSING");
    advance(3_000);
    expect(await sim.getPayout("B1")).toMatchObject({ status: "SUCCESS", items: [{ itemId: "i1", status: "SUCCESS" }] });
    await sim.createPayout({ batchId: "B1", subject: "s", items });
    expect((await sim.getPayout("B1")).status).toBe("SUCCESS");
    await expect(sim.getPayout("nope")).rejects.toThrow(/404/);
  });
});
