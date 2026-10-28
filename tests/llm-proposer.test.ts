import { describe, expect, it, vi } from "vitest";
import { createLlmProposer } from "../src/agent/llm";
import { runProposeVerifyLoop } from "../src/agent/loop";
import type { LicenseOffer, Project } from "../src/core/types";
import type { ModelClient } from "../src/extraction/model";
import { Ledger } from "../src/ledger/ledger";

const project: Project = { name: "Promo film", commercial: true, territories: ["US"], termMonths: 12 };
const offer = (id: string, price: number, commercialUse: boolean): LicenseOffer => ({
  id,
  assetId: "song",
  priceCents: price,
  currency: "USD",
  terms: { commercialUse, territories: ["WORLD"], termMonths: 24 },
  evidence: [{ documentId: id, quote: "q" }],
});
const candidates = [offer("cheap", 100, false), offer("good", 500, true)];

const modelReplying = (...replies: string[]) => {
  const complete = vi.fn();
  replies.forEach((r) => complete.mockResolvedValueOnce(r));
  return { complete } as ModelClient & { complete: ReturnType<typeof vi.fn> };
};

describe("createLlmProposer", () => {
  it("parses the model's choice and shows it the offers and earlier violations", async () => {
    const model = modelReplying('Sure: {"offerIds":["cheap"],"rationale":"cheapest"}', '{"offerIds":["good"]}');
    const result = await runProposeVerifyLoop({ project, requiredAssetIds: ["song"], candidates, proposer: createLlmProposer(model), ledger: new Ledger() });

    expect(result.status).toBe("verified");
    expect(result.bundle!.offers[0]!.id).toBe("good");
    const [first, second] = model.complete.mock.calls.map((c) => c[0].user as string);
    expect(first).toMatch(/cheap \| asset song/);
    expect(first).toMatch(/Earlier attempts:\nNone yet/);
    expect(second).toMatch(/commercial-use \(cheap\): Licence does not allow commercial use/);
  });

  it("turns an unusable reply into a recoverable error", async () => {
    const model = modelReplying("I think you should buy the good one.", '{"offerIds":["good"]}');
    const ledger = new Ledger();
    const result = await runProposeVerifyLoop({ project, requiredAssetIds: ["song"], candidates, proposer: createLlmProposer(model), ledger });

    expect(result.status).toBe("verified");
    expect(ledger.events()[0]).toMatchObject({ kind: "proposal_error" });
  });

  it("rejects an offerIds field of the wrong type", async () => {
    const proposer = createLlmProposer(modelReplying('{"offerIds":"good"}'));
    await expect(proposer.propose({ project, requiredAssetIds: ["song"], candidates, history: [] })).rejects.toThrow(/array of strings/);
  });
});

describe("reading the proposer's reply", () => {
  const ask = (reply: string) => createLlmProposer(modelReplying(reply)).propose({ project, requiredAssetIds: ["song"], candidates, history: [] });

  it("ignores a thinking block and an example before the answer, and a closing remark with braces", async () => {
    const reply = '<think>I should answer with {"offerIds": [...]}</think>Example: {"note": "x"}\n{"offerIds": ["good"], "rationale": "cheapest that fits"}\nHope this helps {:)}';
    expect(await ask(reply)).toEqual({ offerIds: ["good"], rationale: "cheapest that fits" });
  });

  it("still refuses a reply with no object, and one that is not valid JSON", async () => {
    await expect(ask("I would pick the good one.")).rejects.toThrow(/no JSON object/);
    await expect(ask("{offerIds: [good]}")).rejects.toThrow();
  });
});
