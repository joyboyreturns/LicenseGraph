import { greedyProposer } from "../src/agent/greedy";
import { createSession, runPipeline } from "../src/app-logic/session";
import type { LicenseOffer, Project } from "../src/core/types";
import { demoModel } from "../src/demo/mock-model";
import { scenarioById } from "../src/demo/scenarios";

/** The documentary scenario's project and its four extracted offers, in the plain-data form an agent would pass. */
export async function runExample(): Promise<{ project: Project; requiredAssetIds: string[]; offers: LicenseOffer[] }> {
  const sc = scenarioById("documentary")!;
  const s = createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })) });
  await runPipeline(s, { model: demoModel, proposer: greedyProposer, today: () => "2026-11-05" });
  return { project: sc.project, requiredAssetIds: sc.requiredAssetIds, offers: s.candidates };
}
