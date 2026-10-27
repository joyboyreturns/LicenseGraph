import type { ProposalRequest, Proposer } from "./loop";

/**
 * Deterministic stand-in for the model, used in tests and offline demos. Round one takes the
 * cheapest offer per asset and ignores the project's constraints; every revision drops the
 * offers named in earlier violations. It shows the loop working without any API key.
 */
export const greedyProposer: Proposer = {
  async propose({ requiredAssetIds, candidates, history }: ProposalRequest) {
    const banned = new Set(history.flatMap((h) => h.violations.map((v) => v.offerId).filter((id): id is string => Boolean(id))));
    const offerIds: string[] = [];
    for (const asset of requiredAssetIds) {
      const best = candidates
        .filter((c) => c.assetId === asset && !banned.has(c.id))
        .sort((a, b) => a.priceCents - b.priceCents || a.id.localeCompare(b.id))[0];
      if (best) offerIds.push(best.id);
    }
    return { offerIds, rationale: banned.size ? `Avoiding ${[...banned].join(", ")}` : "Cheapest offer per asset" };
  },
};
