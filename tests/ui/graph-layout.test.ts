import { describe, expect, it } from "vitest";
import { curve, layoutGraph, nodeKey, type GraphLayout, type LayoutInput } from "@/src/ui/lib/graph-layout";
import { scenarioView } from "./helpers";

const overlaps = (l: GraphLayout) => {
  for (const a of l.nodes)
    for (const b of l.nodes) {
      if (a === b || a.kind !== b.kind) continue;
      if (a.y < b.y + b.h && b.y < a.y + a.h) return [a.key, b.key];
    }
  return null;
};

function synthetic(assets: number, offersPerAsset: number[], width: number): LayoutInput {
  const ids = Array.from({ length: assets }, (_, i) => `asset${i}`);
  const documents: LayoutInput["documents"][number][] = [];
  const offers: LayoutInput["offers"][number][] = [];
  ids.forEach((a, i) => {
    for (let j = 0; j < (offersPerAsset[i] ?? 1); j++) {
      documents.push({ id: `d-${a}-${j}`, assetId: a });
      offers.push({ id: `o-${a}-${j}`, assetId: a, documentId: `d-${a}-${j}`, priceCents: 1000 * (5 - j) });
    }
  });
  return { width, documents, offers, assets: ids };
}

describe("layoutGraph", () => {
  it("lays out a real scenario in three columns with one edge per link", async () => {
    const view = await scenarioView("game-trailer");
    const l = layoutGraph({ width: 1200, documents: view.documents, offers: view.candidates.map((o) => ({ ...o, documentId: o.evidence[0]?.documentId })), assets: ["song", "image", "sfx"] });
    expect(l.density).toBe("regular");
    expect(l.nodes.filter((n) => n.kind === "doc")).toHaveLength(8);
    expect(l.nodes.filter((n) => n.kind === "offer")).toHaveLength(8);
    expect(l.nodes.filter((n) => n.kind === "asset")).toHaveLength(3);
    expect(l.edges.filter((e) => e.kind === "doc-offer")).toHaveLength(8);
    expect(l.edges.filter((e) => e.kind === "offer-asset")).toHaveLength(8);
    expect(l.columns.doc.x).toBeLessThan(l.columns.offer.x);
    expect(l.columns.offer.x).toBeLessThan(l.columns.asset.x);
    expect(l.columns.asset.x + l.columns.asset.w).toBeLessThanOrEqual(1200 + 0.5);
    expect(overlaps(l)).toBeNull();
  });

  it("orders offers cheapest first within each asset and centres the asset on its group", () => {
    const l = layoutGraph({
      width: 900,
      documents: [],
      offers: [
        { id: "b", assetId: "song", priceCents: 900 },
        { id: "a", assetId: "song", priceCents: 100 },
        { id: "c", assetId: "song", priceCents: 500 },
      ],
      assets: ["song"],
    });
    const offers = l.nodes.filter((n) => n.kind === "offer").sort((x, y) => x.y - y.y);
    expect(offers.map((o) => o.id)).toEqual(["a", "c", "b"]);
    const asset = l.nodes.find((n) => n.key === nodeKey("asset", "song"))!;
    const groupCentre = (offers[0]!.y + offers[2]!.y + offers[2]!.h) / 2;
    expect(asset.y + asset.h / 2).toBeCloseTo(groupCentre);
  });

  it.each([
    [3, [1, 1, 1]],
    [3, [4, 4, 4]],
    [6, [2, 2, 2, 2, 2, 2]],
    [6, [1, 3, 1, 3, 1, 3]],
    [4, [1, 1, 1, 9]],
  ])("handles %i assets with offers %j at desktop and phone widths", (assets, per) => {
    for (const width of [1280, 900, 358]) {
      const l = layoutGraph(synthetic(assets, per, width));
      expect(overlaps(l)).toBeNull();
      expect(l.nodes.every((n) => n.x >= 0 && n.x + n.w <= Math.max(280, width) + 0.5)).toBe(true);
      expect(l.nodes.every((n) => n.y >= 0 && n.y + n.h <= l.height + 0.5)).toBe(true);
      expect(l.density).toBe(width < 760 ? "compact" : "regular");
    }
  });

  it("keeps documents that produced no offer in their asset group", () => {
    const l = layoutGraph({ width: 1000, documents: [{ id: "bad", assetId: "song" }, { id: "good", assetId: "song" }], offers: [{ id: "o", assetId: "song", documentId: "good", priceCents: 1 }], assets: ["song"] });
    expect(l.nodes.find((n) => n.key === "doc:bad")).toBeDefined();
    expect(l.edges.map((e) => e.key)).toEqual(["doc:good->offer:o", "offer:o->asset:song"]);
  });

  it("shows a required asset with no offers, and data for unrequired assets without edges to them", () => {
    const l = layoutGraph({ width: 1000, documents: [], offers: [{ id: "x", assetId: "extra", priceCents: 1 }], assets: ["song"] });
    expect(l.nodes.find((n) => n.key === "asset:song")).toBeDefined();
    expect(l.nodes.find((n) => n.key === "asset:extra")).toBeUndefined();
    expect(l.nodes.find((n) => n.key === "offer:x")).toBeDefined();
    expect(l.edges).toHaveLength(0);
  });

  it("is safe with nothing to draw", () => {
    const l = layoutGraph({ width: 0, documents: [], offers: [], assets: [] });
    expect(l.nodes).toEqual([]);
    expect(l.height).toBe(120);
    expect(l.width).toBe(280);
  });

  it("draws smooth horizontal curves", () => {
    expect(curve(0, 10, 100, 50)).toBe("M 0 10 C 50 10, 50 50, 100 50");
  });
});
