import { describe, expect, it } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, runPipeline, SessionStore, startPayment, type Deps, type Session } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { scenarioById } from "../src/demo/scenarios";
import { createPayPalSimulator } from "../src/payments/simulator";

async function paidSession(wrongAmount: boolean) {
  const sim = createPayPalSimulator({ appUrl: () => "http://app", settleAfterMs: 0 });
  const payments = {
    createOrder: sim.createOrder,
    createPayout: sim.createPayout,
    getPayout: sim.getPayout,
    captureOrder: async (id: string, requestId: string) => {
      const captured = await sim.captureOrder(id, requestId);
      return wrongAmount ? { ...captured, amount: { ...captured.amount, value: "1.00" } } : captured;
    },
  };
  const deps: Deps = { model: demoModel, proposer: greedyProposer, payments, today: () => "2026-11-05" };
  const sc = scenarioById("documentary")!;
  const s = createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })) });
  await runPipeline(s, deps);
  approveSession(s, "Kiran");
  sim.approveOrder((await startPayment(s, deps)).id);
  return { s, deps };
}

describe("a capture that does not match the approval", () => {
  it("is written to the ledger, pays no creator and leaves the order waiting", async () => {
    const { s, deps } = await paidSession(true);
    await expect(completePayment(s, deps)).rejects.toThrow(/No creator payouts were sent/);
    expect(s.phase).toBe("order_created");
    expect(s.payouts).toBeUndefined();
    const event = s.ledger.events().find((e) => e.kind === "capture_mismatch");
    expect(event?.payload).toMatchObject({ amount: { value: "1.00" }, expectedCurrency: "USD" });
    expect(s.ledger.verify()).toBe(true);
  });

  it("leaves no mismatch record for a correct capture", async () => {
    const { s, deps } = await paidSession(false);
    await completePayment(s, deps);
    expect(s.ledger.events().some((e) => e.kind === "capture_mismatch")).toBe(false);
  });
});

describe("session store eviction", () => {
  const make = (phase: Session["phase"]) => {
    const sc = scenarioById("documentary")!;
    const s = createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })) });
    s.phase = phase;
    return s;
  };

  it("never drops a run with money in flight, even over the cap", () => {
    const store = new SessionStore(3);
    const paid = [make("approved"), make("order_created"), make("captured")];
    for (const s of paid) store.add(s);
    const extra = make("failed");
    store.add(extra);
    for (const s of paid) expect(store.get(s.id)).toBe(s);
  });

  it("drops finished runs, oldest first, to make room", () => {
    const store = new SessionStore(2);
    const [a, b, c] = [make("failed"), make("settled"), make("verified")];
    store.add(a);
    store.add(b);
    store.add(c);
    expect(store.get(a.id)).toBeUndefined();
    expect(store.get(b.id)).toBeDefined();
    expect(store.get(c.id)).toBe(c);
  });
});
