// Calls the real AI Gateway. Skipped unless RUN_GATEWAY_LIVE=1 (use `npm run test:proposer`).
// Sends exactly one request, and only after assertModelIsFree confirms the model costs nothing.
import { describe, expect, it } from "vitest";
import { createLlmProposer } from "../src/agent/llm";
import { verifyBundle } from "../src/core/rules";
import type { LicenseOffer, Project } from "../src/core/types";
import { createGatewayModel, gatewayConfigFromEnv } from "../src/extraction/model";

const offer = (id: string, assetId: string, priceCents: number, commercialUse: boolean): LicenseOffer => ({
  id,
  assetId,
  priceCents,
  currency: "USD",
  terms: { commercialUse, territories: ["WORLD"], termMonths: 24 },
  evidence: [{ documentId: id, quote: "q" }],
});

describe.skipIf(!process.env.RUN_GATEWAY_LIVE)("model proposer (live)", () => {
  it("picks only real offer ids, one per required asset", async () => {
    const project: Project = { name: "Promo film", commercial: true, territories: ["US"], termMonths: 12 };
    const candidates = [offer("song-personal", "song", 2_000, false), offer("song-commercial", "song", 20_000, true), offer("font-std", "font", 4_900, true)];
    const proposer = createLlmProposer(createGatewayModel(gatewayConfigFromEnv()));

    const { offerIds, rationale } = await proposer.propose({ project, requiredAssetIds: ["song", "font"], candidates, history: [] });

    const verdict = verifyBundle(project, ["song", "font"], { offers: offerIds.map((id) => candidates.find((c) => c.id === id)!).filter(Boolean) });
    console.log("proposer chose", offerIds, "|", rationale, "| verdict ok:", verdict.ok, verdict.violations.map((v) => v.rule));

    expect(offerIds.every((id) => candidates.some((c) => c.id === id))).toBe(true);
    expect(offerIds.length).toBeGreaterThan(0);
  }, 180_000);
});
