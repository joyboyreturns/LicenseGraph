import { describe, expect, it, vi } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { demoModel } from "../src/demo/mock-model";
import { reviseInput } from "../src/app-logic/revision";
import { createSession, runPipeline, SessionError, viewOf, type Deps, type SessionInput } from "../src/app-logic/session";
import { scenarioById } from "../src/demo/scenarios";

const sc = scenarioById("exclusive-theme")!;
const input = (): SessionInput => ({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })), meta: { scenarioId: sc.id, brief: sc.brief, runKind: "demo" } });

describe("reviseInput", () => {
  it("adds the simulated replies to everything already read, links the run, and leaves the original input alone", () => {
    const before = input();
    const next = reviseInput(before, "run-1", { simulate: true });
    expect(next.documents.map((d) => d.id)).toEqual([...before.documents.map((d) => d.id), "pod-song-exclusive", "pod-art-exclusive", "pod-voice-exclusive"]);
    expect(next.meta).toMatchObject({ scenarioId: sc.id, revisedFrom: "run-1" });
    expect(next.project).toEqual(before.project);
    expect(before.documents).toHaveLength(sc.documents.length);
    expect(before.meta?.revisedFrom).toBeUndefined();
  });

  it("does not add the same replies twice", () => {
    const once = reviseInput(input(), "run-1", { simulate: true });
    expect(() => reviseInput(once, "run-2", { simulate: true })).toThrow(/no simulated licensor replies/);
  });

  it("has no simulated replies for a run that is not a scenario with them", () => {
    const other = { ...input(), meta: { scenarioId: "documentary" } };
    expect(() => reviseInput(other, "run-1", { simulate: true })).toThrow(SessionError);
  });

  it("adds a pasted licence for one asset under a fresh id, as an extra offer rather than a replacement", () => {
    const first = reviseInput(input(), "run-1", { assetId: "song", text: "Price: USD 500.00. Exclusive.", licensor: { name: "Tapeloop" } });
    const added = first.documents.at(-1)!;
    expect(added).toMatchObject({ id: "song-rev1", assetId: "song", text: "Price: USD 500.00. Exclusive.", licensor: { name: "Tapeloop" } });
    expect(first.documents).toHaveLength(sc.documents.length + 1);
    const second = reviseInput(first, "run-2", { assetId: "song", text: "Price: USD 450.00. Exclusive." });
    expect(second.documents.at(-1)!.id).toBe("song-rev2");
    expect(second.documents.at(-1)).not.toHaveProperty("licensor");
  });

  it("refuses a licence for an asset the run does not need, an empty one, and too many documents", () => {
    expect(() => reviseInput(input(), "r", { assetId: "font", text: "x" })).toThrow(/does not need a licence for "font"/);
    expect(() => reviseInput(input(), "r", { assetId: "song", text: "   " })).toThrow(/Paste the revised licence/);
    let big = input();
    for (let i = 0; i < 6; i++) big = reviseInput(big, "r", { assetId: "song", text: `Price: USD ${i + 1}.00.` });
    expect(() => reviseInput(big, "r", { assetId: "song", text: "one more" })).toThrow(/at most 12/);
  });
});

describe("a revised run does not read the earlier licences again", () => {
  it("asks the model only about the added licences, records the carried ones, and still verifies", async () => {
    const complete = vi.fn((req: Parameters<typeof demoModel.complete>[0]) => demoModel.complete(req));
    const deps: Deps = { model: { complete }, proposer: greedyProposer, today: () => "2026-11-05" };
    const first = createSession(input());
    await runPipeline(first, deps);
    expect(first.phase).toBe("failed");
    expect(complete).toHaveBeenCalledTimes(sc.documents.length);

    complete.mockClear();
    const second = createSession(reviseInput(first.input, first.id, { simulate: true }));
    await runPipeline(second, deps, { fromRunId: first.id, offers: first.candidates });
    expect(complete).toHaveBeenCalledTimes(3); // only the three replies
    expect(second.phase).toBe("verified");
    const extracted = second.ledger.events().filter((e) => e.kind === "extracted");
    expect(extracted).toHaveLength(sc.documents.length + 3);
    expect(extracted.filter((e) => e.payload.carriedFromRun === first.id)).toHaveLength(sc.documents.length);
    expect(second.ledger.verify()).toBe(true);
    // The carried terms are exactly what the first run read.
    expect(second.candidates.slice(0, sc.documents.length)).toEqual(first.candidates);
    expect(viewOf(second).bundle!.totalCents).toBe(116_000);
  });
});
