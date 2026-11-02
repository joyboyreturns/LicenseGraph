import { describe, expect, it } from "vitest";
import { dashboardSuggestions } from "../src/dashboard/suggestions";
import { catalogFrom } from "../src/dashboard/widget-tools";
import { buildPortfolioData } from "../src/dashboard/portfolio";
import { buildStudioData } from "../src/dashboard/data";
import { createSession, runPipeline, viewOf } from "../src/app-logic/session";
import { greedyProposer } from "../src/agent/greedy";
import { demoModel } from "../src/demo/mock-model";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";

describe("offline dashboard suggestions", () => {
  it("builds every portfolio action against the real schema", () => {
    const catalog = catalogFrom(buildPortfolioData([]));
    for (const suggestion of dashboardSuggestions(true)) expect(suggestion.build(catalog), suggestion.label).toMatchObject({ ok: true });
  });
  it("builds run actions against the real schema", async () => {
    const session = createSession({ project: { ...sampleProject }, requiredAssetIds: [...sampleRequiredAssets], documents: sampleDocuments.map((d) => ({ ...d })) });
    await runPipeline(session, { model: demoModel, proposer: greedyProposer, today: () => "2026-11-05" });
    const catalog = catalogFrom(buildStudioData(viewOf(session)));
    for (const suggestion of dashboardSuggestions(false)) expect(suggestion.build(catalog), suggestion.label).toMatchObject({ ok: true });
  });
});
