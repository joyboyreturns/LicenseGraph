import { describe, expect, it } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, createSession, runPipeline, viewOf } from "../src/app-logic/session";
import { buildDashboardData, buildStudioData } from "../src/dashboard/data";
import { demoModel } from "../src/demo/mock-model";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";

const finishedView = async () => {
  const s = createSession({ project: { ...sampleProject }, requiredAssetIds: [...sampleRequiredAssets], documents: sampleDocuments.map((d) => ({ ...d })) });
  await runPipeline(s, { model: demoModel, proposer: greedyProposer, today: () => "2026-11-05" });
  return { s, view: viewOf(s) };
};

describe("buildDashboardData", () => {
  it("flattens a session into assets, offers, violations and events", async () => {
    const { view } = await finishedView();
    const t = buildDashboardData(view);

    expect(t.assets.map((a) => a.asset)).toEqual(["song", "image", "font"]);
    expect(t.offers).toHaveLength(4);
    expect(t.events.map((e) => e.kind)).toEqual(["extracted", "extracted", "extracted", "extracted", "proposed", "rejected", "revised", "verified"]);
    expect(t.violations).toEqual([expect.objectContaining({ round: 1, offerId: "offer-photo", asset: "image", rule: "commercial-use" })]);
  });

  it("marks which offers the verified bundle used and which the rules rejected", async () => {
    const t = buildDashboardData((await finishedView()).view);
    const status = Object.fromEntries(t.offers.map((o) => [o.offerId, o.status]));
    expect(status).toEqual({ "offer-song": "In verified bundle", "offer-photo": "Rejected by rules", "offer-archive": "In verified bundle", "offer-font": "In verified bundle" });
  });

  it("reports prices in dollars and shows the cheapest versus chosen price per asset", async () => {
    const t = buildDashboardData((await finishedView()).view);
    const image = t.assets.find((a) => a.asset === "image")!;
    expect(image).toMatchObject({ chosenOffer: "offer-archive", chosenPrice: 80, cheapestPrice: 45, candidates: 2 });
  });

  it("says 'Not stated' for terms a licence is silent on, so gaps are visible", async () => {
    const t = buildDashboardData((await finishedView()).view);
    const song = t.offers.find((o) => o.offerId === "offer-song")!;
    expect(song).toMatchObject({ mediums: "Not stated", attribution: "Not stated", sublicensing: "Not stated", exclusivity: "Not stated", term: "24 months" });
    expect(t.offers.find((o) => o.offerId === "offer-font")).toMatchObject({ term: "Perpetual", termMonths: null });
  });

  it("describes ledger events and follows the run through to payment", async () => {
    const { s } = await finishedView();
    approveSession(s, "Kiran");
    const t = buildDashboardData(viewOf(s));
    expect(t.events.at(-1)).toMatchObject({ kind: "approved", detail: "Approved by Kiran" });
    expect(String(t.events[0]!.hash)).toHaveLength(12);
  });

  it("has no chosen offers or prices when the run found no compliant bundle", async () => {
    const s = createSession({ project: { ...sampleProject }, requiredAssetIds: ["image"], documents: sampleDocuments.filter((d) => d.id === "photo").map((d) => ({ ...d })) });
    await runPipeline(s, { model: demoModel, proposer: greedyProposer });
    const t = buildDashboardData(viewOf(s));
    expect(t.assets[0]).toMatchObject({ chosenOffer: "None", chosenPrice: null });
    expect(t.offers[0]!.status).toBe("Rejected by rules");
  });
});

describe("buildStudioData", () => {
  it("defines its tables linked by relationships that point at real fields", async () => {
    const def = buildStudioData((await finishedView()).view);
    const fields = Object.fromEntries(def.sources.map((s) => [s.id, new Set(s.fields.map((f) => f.id))]));

    expect(def.sources.map((s) => s.id)).toEqual(["assets", "offers", "violations", "requirements", "gaps", "events"]);
    for (const r of def.relationships) {
      expect(fields[r.source.tableId]!.has(r.source.fieldId)).toBe(true);
      expect(fields[r.target.tableId]!.has(r.target.fieldId)).toBe(true);
    }
    for (const s of def.sources) for (const row of s.data) for (const f of s.fields) expect(f.id in row).toBe(true);
  });
});

describe("requirement costs and gap requests in the dashboard data", () => {
  it("lists what each declared requirement adds, in the run's currency", async () => {
    const { view } = await finishedView();
    const t = buildDashboardData(view);
    const commercial = t.requirements.find((r) => r.requirementId === "commercial-use")!;
    expect(commercial).toMatchObject({ requirement: "Commercial use", value: "Commercial", extraCost: 35, costWithout: 294, impact: "Adds cost" });
    expect(t.requirements.find((r) => r.requirementId === "territory")).toMatchObject({ extraCost: 0, impact: "Costs nothing" });
    expect(t.gaps).toEqual([]);

    const def = buildStudioData(view);
    expect(def.currency).toBe("USD");
    expect(def.sources.map((x) => x.id)).toEqual(["assets", "offers", "violations", "requirements", "gaps", "events"]);
    expect(def.sources.find((x) => x.id === "requirements")!.data).toEqual(t.requirements);
  });

  it("turns a dead-end run into one row per change to ask a licensor for", async () => {
    const s = createSession({ project: { ...sampleProject, requiresExclusive: true }, requiredAssetIds: [...sampleRequiredAssets], documents: sampleDocuments.map((d) => ({ ...d })) });
    await runPipeline(s, { model: demoModel, proposer: greedyProposer, today: () => "2026-11-05" });
    const view = viewOf(s);
    expect(view.phase).toBe("failed");
    const t = buildDashboardData(view);
    expect(t.requirements).toEqual([]);
    expect(t.gaps.length).toBeGreaterThanOrEqual(sampleRequiredAssets.length);
    expect(t.gaps.every((g) => typeof g.ask === "string" && String(g.gapId).includes(String(g.offerId)))).toBe(true);
    expect(t.gaps.map((g) => g.rule)).toContain("exclusivity");
  });

  it("labels a euro run's prices as euros, not dollars", async () => {
    const { view } = await finishedView();
    const eur = { ...view, project: { ...view.project, currency: "EUR" }, bundle: { ...view.bundle!, currency: "EUR" } };
    const def = buildStudioData(eur);
    expect(def.currency).toBe("EUR");
    expect(def.description).toContain("Prices are in EUR");
  });
});
