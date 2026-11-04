import { describe, expect, it, vi } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, refundPurchase, runPipeline, SessionStore, startPayment, type Deps } from "../src/app-logic/session";
import { serializeSession, deserializeSession } from "../src/app-logic/persistence";
import { demoModel } from "../src/demo/mock-model";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";

async function setup() {
  let broken = false;
  const saved: unknown[] = [];
  const repo = { save: vi.fn((s) => { if (broken) throw new Error("private disk details"); saved.push(structuredClone(serializeSession(s))); }), loadAll: () => [] };
  const payments = {
    createOrder: vi.fn(async () => ({ id: "order", status: "CREATED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=order" })),
    captureOrder: vi.fn(async () => ({ id: "order", captureId: "capture", status: "COMPLETED", amount: { currency: "USD", value: "329.00" } })),
    refundCapture: vi.fn(async () => ({ id: "refund", status: "COMPLETED" })),
  };
  const deps: Deps = { model: demoModel, proposer: greedyProposer, payments, today: () => "2026-11-05" };
  const s = new SessionStore(10, repo).add(createSession({ project: sampleProject, requiredAssetIds: sampleRequiredAssets, documents: sampleDocuments }));
  await runPipeline(s, deps);
  return { s, deps, payments, saved, breakDisk: () => { broken = true; }, recoverDisk: () => { broken = false; } };
}

describe("durability before payment", () => {
  it("rolls back an approval and its ledger event if saving it fails", async () => {
    const { s, breakDisk } = await setup();
    const before = s.ledger.events();
    breakDisk();
    expect(() => approveSession(s, "Buyer")).toThrow(/durably save/);
    expect(s.phase).toBe("verified");
    expect(s.approval).toBeUndefined();
    expect(s.ledger.events()).toEqual(before);
  });

  it("refuses order creation on disk failure and persists its stable intent on recovery", async () => {
    const { s, deps, payments, breakDisk, recoverDisk, saved } = await setup();
    approveSession(s, "Buyer");
    breakDisk();
    await expect(startPayment(s, deps)).rejects.toThrow(/durably save/);
    expect(payments.createOrder).not.toHaveBeenCalled();
    recoverDisk();
    await startPayment(s, deps);
    expect(saved.some((v) => Boolean((v as typeof s).paymentIntents?.order))).toBe(true);
    expect(deserializeSession(serializeSession(s)).paymentIntents).toEqual(s.paymentIntents);
  });

  it("refuses capture and refund requests when their intent cannot be saved", async () => {
    const { s, deps, payments, breakDisk, recoverDisk } = await setup();
    approveSession(s, "Buyer");
    await startPayment(s, deps);
    breakDisk();
    await expect(completePayment(s, deps)).rejects.toThrow(/durably save/);
    expect(payments.captureOrder).not.toHaveBeenCalled();
    recoverDisk();
    await completePayment(s, deps);
    breakDisk();
    await expect(refundPurchase(s, deps)).rejects.toThrow(/durably save/);
    expect(payments.refundCapture).not.toHaveBeenCalled();
  });
});
