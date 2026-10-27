import { greedyProposer } from "@/src/agent/greedy";
import { approveSession, createSession, runPipeline, viewOf, type SessionView } from "@/src/app-logic/session";
import { demoModel } from "@/src/demo/mock-model";
import { scenarioById } from "@/src/demo/scenarios";

/** A real replayed scenario run, exactly as the API would return it. */
export async function scenarioView(id: string, options: { approve?: boolean } = {}): Promise<SessionView> {
  const s = scenarioById(id);
  if (!s) throw new Error(`no scenario ${id}`);
  const session = createSession({ project: s.project, requiredAssetIds: s.requiredAssetIds, documents: s.documents, meta: { scenarioId: id, runKind: "demo" } });
  await runPipeline(session, { model: demoModel, proposer: greedyProposer, today: () => "2026-10-27" });
  if (options.approve) approveSession(session, "Test Approver");
  return viewOf(session);
}
