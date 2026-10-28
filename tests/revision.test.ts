import { describe, expect, it } from "vitest";
import { reviseInput } from "../src/app-logic/revision";
import { SessionError, type SessionInput } from "../src/app-logic/session";
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
