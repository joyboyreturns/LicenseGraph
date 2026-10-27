import { describe, expect, it } from "vitest";
import { greedyProposer } from "@/src/agent/greedy";
import { approveSession, completePayment, createSession, runPipeline, startPayment, type Deps } from "@/src/app-logic/session";
import { demoModel } from "@/src/demo/mock-model";
import { scenarioById } from "@/src/demo/scenarios";
import { createPayPalSimulator } from "@/src/payments/simulator";
import { issuePassport } from "@/src/passport/issue";
import { verifyPassport } from "@/src/passport/passport";
import { parsePassport, tamperPrice } from "@/src/ui/lib/passport-file";

async function paidPassport() {
  const s = scenarioById("documentary")!;
  const sim = createPayPalSimulator({ appUrl: () => "http://app" });
  const deps: Deps = { model: demoModel, proposer: greedyProposer, payments: sim, today: () => "2026-10-27", returnUrl: (id) => `http://app/api/sessions/${id}/return` };
  const session = createSession({ project: s.project, requiredAssetIds: s.requiredAssetIds, documents: s.documents });
  await runPipeline(session, deps);
  approveSession(session, "Ada");
  const order = await startPayment(session, deps);
  sim.approveOrder(order.id);
  await completePayment(session, deps);
  return issuePassport(session);
}

describe("parsePassport", () => {
  it("accepts a real passport and round-trips through JSON", async () => {
    const p = await paidPassport();
    const r = parsePassport(JSON.stringify(p));
    expect(r.ok).toBe(true);
    if (r.ok) expect((await verifyPassport(r.passport)).ok).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["{not json", "not valid JSON"],
    ["[1,2]", "expected an object"],
    ['{"version":2}', "Unsupported passport version (2)"],
    ['{"hello":1}', "Unsupported passport version."],
    ['{"version":1,"id":"x"}', "missing parts"],
  ])("explains what is wrong with %j", (text, message) => {
    const r = parsePassport(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });

  it("rejects malformed offers and events", async () => {
    const p = await paidPassport();
    const badOffer = structuredClone(p) as unknown as { bundle: { offers: unknown[] } };
    badOffer.bundle.offers[0] = { id: 3 };
    expect(parsePassport(JSON.stringify(badOffer))).toMatchObject({ ok: false });
    const badEvent = structuredClone(p) as unknown as { ledger: { events: unknown[] } };
    badEvent.ledger.events[0] = "x";
    expect(parsePassport(JSON.stringify(badEvent))).toMatchObject({ ok: false });
  });
});

describe("tamperPrice", () => {
  it("edits a copy so verification fails, leaving the original valid", async () => {
    const p = await paidPassport();
    const t = tamperPrice(p);
    expect(t.toCents).toBe((t.fromCents ?? 0) + 100);
    expect(p.bundle.offers[0]!.priceCents).toBe(t.fromCents);
    const tampered = await verifyPassport(t.passport);
    expect(tampered.ok).toBe(false);
    expect(tampered.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(expect.arrayContaining(["bundle-digest", "terms-in-ledger"]));
    expect((await verifyPassport(p)).ok).toBe(true);
  });
});
