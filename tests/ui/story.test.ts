import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "@/src/ledger/chain";
import { buildCatalog, humaniseIds } from "@/src/ui/lib/catalog";
import { buildStory, violationsByOffer } from "@/src/ui/lib/rounds";
import { isBundleRule, ruleChecks, ruleName, violationText } from "@/src/ui/lib/rule-text";
import { scenarioView } from "./helpers";

const ev = (seq: number, kind: LedgerEvent["kind"], payload: Record<string, unknown> = {}): LedgerEvent => ({ seq, at: `2026-10-27T00:00:0${seq % 10}Z`, kind, payload, prevHash: "", hash: `h${seq}` });

describe("buildStory", () => {
  it("groups the game trailer into reading plus three rounds", async () => {
    const view = await scenarioView("game-trailer");
    const story = buildStory(view.events, view.loopStatus);
    expect(story.reading.read).toHaveLength(8);
    expect(story.reading.failed).toHaveLength(0);
    expect(story.reading.quotes).toBeGreaterThan(30);
    expect(story.rounds.map((r) => [r.round, r.proposal?.kind, r.verdict?.status])).toEqual([
      [1, "proposed", "rejected"],
      [2, "revised", "rejected"],
      [3, "revised", "verified"],
    ]);
    const first = story.rounds[0]!.verdict!;
    expect(first.status === "rejected" && first.violations.map((v) => v.rule)).toEqual(["territory", "term", "medium", "commercial-use", "expiry"]);
    const last = story.rounds[2]!.verdict!;
    expect(last.status === "verified" && last.totalCents).toBe(view.bundle!.totalCents);
    expect(story.after).toEqual([]);
  });

  it("puts approval and payment events after the rounds", async () => {
    const view = await scenarioView("documentary", { approve: true });
    const story = buildStory(view.events, view.loopStatus);
    expect(story.rounds).toHaveLength(2);
    expect(story.after.map((e) => e.kind)).toEqual(["approved"]);
  });

  it("handles errors, failed reads, stalls and missing fields", () => {
    const story = buildStory(
      [
        ev(1, "extraction_failed", { documentId: "d1", assetId: "song", problems: ["no price"] }),
        ev(2, "extracted", { documentId: "d2", assetId: "song", offerId: "o2", priceCents: 100 }),
        ev(3, "proposal_error", { round: 1, error: "Unknown offer ids: zz" }),
        ev(4, "revised", { round: 2, offerIds: ["o2"] }),
        ev(5, "rejected", { round: 2, violations: [{ rule: "budget", message: "Bundle costs 100 cents; budget is 50." }, { junk: true }] }),
        ev(6, "revised", { round: 3, offerIds: ["o2"], rationale: "" }),
      ],
      "stalled",
    );
    expect(story.reading.failed[0]).toMatchObject({ documentId: "d1", problems: ["no price"] });
    expect(story.reading.read[0]).toMatchObject({ quotes: 0, priceCents: 100 });
    expect(story.rounds.map((r) => r.round)).toEqual([1, 2, 3]);
    expect(story.rounds[0]!.error?.message).toContain("Unknown offer ids");
    const v = story.rounds[1]!.verdict!;
    expect(v.status === "rejected" && v.violations).toHaveLength(1);
    expect(story.rounds[2]).toMatchObject({ repeated: true });
    expect(story.rounds[2]!.proposal?.rationale).toBeUndefined();
  });

  it("is empty for no events", () => {
    expect(buildStory([])).toEqual({ reading: { read: [], failed: [], quotes: 0 }, rounds: [], after: [] });
  });

  it("groups violations by offer with bundle-level ones under the empty key", () => {
    const g = violationsByOffer([
      { rule: "term", offerId: "a", message: "x" },
      { rule: "budget", message: "y" },
      { rule: "medium", offerId: "a", message: "z" },
    ]);
    expect([...g.keys()]).toEqual(["a", ""]);
    expect(g.get("a")).toHaveLength(2);
  });
});

describe("catalog", () => {
  it("names offers the way people read them", async () => {
    const view = await scenarioView("documentary");
    const c = buildCatalog(view.documents, view.candidates);
    expect(c.offerName("offer-song")).toBe("SoundHarbor Music · song · $200");
    expect(c.offer("offer-photo")).toMatchObject({ licensor: "PixelLeaf Images", price: "$45" });
    expect(c.offerName("unknown")).toBe("unknown");
    expect(humaniseIds("Avoiding offer-photo", c)).toBe("Avoiding PixelLeaf Images · image · $45");
  });
  it("replaces longer ids first", () => {
    const c = buildCatalog(
      [
        { id: "a", assetId: "song", text: "A", licensorName: "Alpha" },
        { id: "b", assetId: "song", text: "B", licensorName: "Beta" },
      ],
      [
        { id: "offer-a", assetId: "song", priceCents: 100, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: 1 }, evidence: [{ documentId: "a", quote: "A" }] },
        { id: "offer-a-pro", assetId: "song", priceCents: 200, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: 1 }, evidence: [{ documentId: "b", quote: "B" }] },
      ],
    );
    expect(humaniseIds("offer-a-pro, offer-a", c)).toBe("Beta · song · $2, Alpha · song · $1");
  });
  it("falls back when a document has no licensor", () => {
    const c = buildCatalog([{ id: "d", assetId: "font", text: "FONT LICENCE" }], [{ id: "o", assetId: "font", priceCents: 4900, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: "perpetual" }, evidence: [] }]);
    expect(c.offerName("o")).toBe("o · font · $49");
  });
});

describe("rule text", () => {
  it("uses the engine's own labels and explains every rule", () => {
    expect(ruleName("commercial-use")).toBe("Commercial use");
    expect(ruleName("budget")).toBe("Budget");
    expect(ruleName("mystery")).toBe("mystery");
    for (const r of ["coverage", "duplicate-asset", "commercial-use", "territory", "term", "medium", "attribution", "sublicensing", "exclusivity", "expiry", "currency", "evidence", "budget"]) expect(ruleChecks(r)).not.toBe("");
    expect(isBundleRule("budget")).toBe(true);
    expect(isBundleRule("term")).toBe(false);
  });
  it("formats cent amounts in verifier messages", () => {
    expect(violationText({ rule: "budget", message: "Bundle costs 350000 cents; budget is 300000." })).toBe("Bundle costs $3,500.00; the budget is $3,000.00.");
    expect(violationText({ rule: "term", message: "Licence lasts 12 months; project needs 24." })).toBe("Licence lasts 12 months; project needs 24.");
  });
});
