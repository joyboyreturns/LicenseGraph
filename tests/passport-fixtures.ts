import { vi } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, runPipeline, startPayment, type Deps, type Session } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";

const payments = {
  createOrder: vi.fn().mockResolvedValue({ id: "ORD1", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORD1" }),
  captureOrder: vi.fn().mockResolvedValue({ id: "ORD1", status: "COMPLETED", captureId: "CAP1", amount: { currency: "USD", value: "329.00" } }),
  createPayout: vi.fn().mockResolvedValue({ batchId: "BATCH1", status: "PENDING" }),
  getPayout: vi.fn(),
};
const deps: Deps = { model: demoModel, proposer: greedyProposer, payments, today: () => "2026-11-05" };

/** A run taken all the way to a captured payment, for tests that need a real passport. */
export async function paidSession(): Promise<Session> {
  const s = createSession({ project: { ...sampleProject }, requiredAssetIds: [...sampleRequiredAssets], documents: sampleDocuments.map((d) => ({ ...d })) });
  await runPipeline(s, deps);
  approveSession(s, "Kiran");
  await startPayment(s, deps);
  await completePayment(s, deps);
  return s;
}
