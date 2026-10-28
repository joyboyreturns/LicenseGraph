import { describe, expect, it, vi } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, runPipeline, startPayment, viewOf, type Deps } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { scenarioById } from "../src/demo/scenarios";
import { answerLocally, answerQuestion, runFacts } from "../src/intake/explain";
import { createPayPalSimulator } from "../src/payments/simulator";
import { createRateLimiter } from "../src/server/rate-limit";

const sim = createPayPalSimulator({ appUrl: () => "http://app", settleAfterMs: 0 });
const deps: Deps = { model: demoModel, proposer: greedyProposer, payments: sim, today: () => "2026-11-05" };

async function view(id = "documentary", pay = false) {
  const sc = scenarioById(id)!;
  const s = createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })) });
  await runPipeline(s, deps);
  if (pay) {
    approveSession(s, "Kiran");
    sim.approveOrder((await startPayment(s, deps)).id);
    await completePayment(s, deps);
  }
  return viewOf(s);
}

describe("runFacts", () => {
  it("states every offer with its outcome, terms and evidence, and the totals", async () => {
    const facts = runFacts(await view());
    expect(facts).toContain("Offer offer-photo for image: $45.00; non-commercial");
    expect(facts).toContain("REJECTED (commercial-use: Licence does not allow commercial use.)");
    expect(facts).toContain("CHOSEN.");
    expect(facts).toContain("Verified bundle total $329.00");
    expect(facts).toContain("price-only buyer would pay $294.00");
  });
});

describe("currency", () => {
  it("states totals in the run's currency, not always dollars", async () => {
    const v = await view();
    const eur = { ...v, project: { ...v.project, currency: "EUR", budgetCents: 100_000 }, bundle: { ...v.bundle!, currency: "EUR" }, payouts: { batchId: "b", status: "SUCCESS", totalCents: 100, currency: "EUR", createdAt: "x", lines: [{ assetId: "song", offerId: "offer-song", documentId: "d", licensorName: "Ana", currency: "EUR", amountCents: 12_345, status: "SUCCESS", emailMasked: "a•@x.com" }] } };
    const facts = runFacts(eur);
    expect(facts).toContain("Budget €1,000.00");
    expect(facts).toContain("price-only buyer would pay €294.00");
    expect(facts).toContain("Ana €123.45 for song");
    expect(facts).not.toContain("$294.00");
    const cost = answerLocally(eur, "How much did it cost in total?").answer;
    expect(cost).toContain("€329.00");
    expect(cost).toContain("would have cost €294.00");
    expect(cost).not.toContain("$");
  });
});

describe("answerLocally", () => {
  it("explains a rejection with the rule's own message", async () => {
    const a = answerLocally(await view(), "Why was the photo rejected?");
    expect(a).toMatchObject({ source: "local", citations: ["offer-photo"] });
    expect(a.answer).toContain("Licence does not allow commercial use.");
  });

  it("says when nothing was rejected, and answers about unrejected offers honestly", async () => {
    const v = await view("documentary");
    expect(answerLocally(v, "why was offer-song rejected").answer).toMatch(/was not rejected by a rule/);
  });

  it("answers cost questions with the premium over a price-only purchase", async () => {
    const a = answerLocally(await view(), "How much did this cost and what did we save?");
    expect(a.answer).toContain("$329.00");
    expect(a.answer).toContain("$294.00");
    expect(a.answer).toContain("$35.00 more");
  });

  it("answers who is paid, before and after settlement", async () => {
    expect(answerLocally(await view(), "who gets paid?").answer).toMatch(/after the payment is captured/);
    const after = answerLocally(await view("documentary", true), "Who are the creators paid?");
    expect(after.answer).toContain("SoundHarbor Music receives $200.00 for song");
    expect(after.citations).toHaveLength(3);
  });

  it("quotes the evidence for a named offer", async () => {
    expect(answerLocally(await view(), "What is the evidence for offer-song?").answer).toContain("Territory: Worldwide.");
  });

  it("gives a helpful summary for anything else", async () => {
    expect(answerLocally(await view(), "tell me a joke").answer).toContain("Try asking why an offer was rejected");
  });
});

describe("answerLocally when no licence can be bought", () => {
  it("explains the blockers, the asks and the best case from the exact checks", async () => {
    const v = await view("exclusive-theme");
    expect(v.bundle).toBeUndefined();
    const why = answerLocally(v, "Why could nothing be bought?");
    expect(why.answer).toMatch(/3 assets have no licence/);
    expect(why.answer).toContain("offer-pod-song-network");
    const ask = answerLocally(v, "What should I ask the licensors?");
    expect(ask.answer.split("\n")).toHaveLength(3);
    expect(ask.answer).toContain("Make the licence exclusive.");
    expect(ask.answer).toContain("$340.00");
    const yes = answerLocally(v, "How much would it cost if they agree?");
    expect(yes.answer).toContain("$690.00");
    expect(yes.answer).toMatch(/\$810\.00 under the budget/);
    expect(yes.answer).toMatch(/best case, not an offer/);
    expect(yes.citations).toEqual(expect.arrayContaining(["offer-pod-song-network"]));
    expect(answerLocally(v, "tell me a joke").answer).toContain("what to ask the licensors");
  });

  it("puts the gaps and the best case in the facts a model is given", async () => {
    const facts = runFacts(await view("exclusive-theme"));
    expect(facts).toContain("Gap for song");
    expect(facts).toContain("$690.00");
  });

  it("leaves verified runs alone", async () => {
    expect(runFacts(await view())).not.toContain("Gap for");
  });
});

describe("answerLocally on a verified run: where it could cost less", () => {
  it("lists each lever with the exact saving, the ask, and a total that is a best case", async () => {
    const a = answerLocally(await view(), "Where could we save money?");
    expect(a.answer).toContain("offer-photo costs $45.00 instead of $80.00, saving $35.00");
    expect(a.answer).toContain("Allow commercial use");
    expect(a.answer).toContain("$35.00 less");
    expect(a.answer).toMatch(/best case, not an offer/);
    expect(a.citations).toEqual(["offer-photo"]);
  });

  it("is in the facts given to a model, and stays out of a run with nothing to save", async () => {
    expect(runFacts(await view())).toContain("Saving lever for image: offer-photo");
    expect(runFacts(await view("exclusive-theme"))).not.toContain("Saving lever");
  });
});

describe("answerQuestion with a model", () => {
  const reply = (text: string) => ({ complete: vi.fn().mockResolvedValue(text) });

  it("returns the model's answer with the offers it cites", async () => {
    const m = reply("offer-photo was rejected because its licence is editorial only.");
    const a = await answerQuestion(await view(), "why photo?", m);
    expect(a).toEqual({ answer: "offer-photo was rejected because its licence is editorial only.", source: "model", citations: ["offer-photo"] });
    expect(m.complete.mock.calls[0]![0].user).toContain("Facts:");
  });

  it("falls back when the model cites an offer that does not exist", async () => {
    const a = await answerQuestion(await view(), "why photo rejected?", reply("offer-invented was rejected."));
    expect(a.source).toBe("local");
  });

  it("falls back on empty replies and on errors", async () => {
    expect((await answerQuestion(await view(), "total?", reply("  "))).source).toBe("local");
    expect((await answerQuestion(await view(), "total?", { complete: vi.fn().mockRejectedValue(new Error("limit")) })).source).toBe("local");
  });

  it("caps very long answers", async () => {
    expect((await answerQuestion(await view(), "total?", reply("x".repeat(5000)))).answer).toHaveLength(1200);
  });
});

describe("createRateLimiter", () => {
  it("allows a budget per window and recovers", () => {
    let t = 0;
    const l = createRateLimiter(2, 1000, () => t);
    expect([l.take(), l.take(), l.take()]).toEqual([true, true, false]);
    t = 1001;
    expect(l.take()).toBe(true);
  });
});
