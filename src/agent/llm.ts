import { isObject, readJsonObject } from "../extraction/json-reply";
import type { ModelClient } from "../extraction/model";
import type { ProposalRequest, Proposer } from "./loop";

const SYSTEM = `You choose licence offers for a project. Reply with one JSON object and nothing else:
{"offerIds": ["..."], "rationale": "one short sentence"}
Rules:
- Choose exactly one offer for each required asset, using only the offer ids listed.
- Pick the cheapest bundle you believe satisfies the project's constraints.
- If earlier attempts were rejected, read the violations and choose different offers that avoid them.
- Never invent an offer id. Your choice will be checked by a separate rules engine, so do not claim it is verified.`;

function describe({ project, requiredAssetIds, candidates, history }: ProposalRequest): string {
  const attempts = history.length
    ? history
        .map((h, i) => {
          const why = h.error ?? h.violations.map((v) => `${v.rule}${v.offerId ? ` (${v.offerId})` : ""}: ${v.message}`).join("; ");
          return `Attempt ${i + 1}: ${h.offerIds.join(", ") || "(none)"} was rejected. ${why}`;
        })
        .join("\n")
    : "None yet.";
  return [
    `Project: ${JSON.stringify(project)}`,
    `Required assets: ${requiredAssetIds.join(", ")}`,
    "Available offers:",
    ...candidates.map((c) => `- ${c.id} | asset ${c.assetId} | ${c.priceCents} ${c.currency} cents | ${JSON.stringify(c.terms)}`),
    `Earlier attempts:\n${attempts}`,
  ].join("\n");
}

function parse(raw: string): { offerIds: string[]; rationale?: string } {
  const body = readJsonObject(raw, ["offerIds"]);
  if (!isObject(body)) throw new Error("no JSON object in model reply");
  if (!Array.isArray(body.offerIds) || !body.offerIds.every((x) => typeof x === "string")) throw new Error("offerIds must be an array of strings");
  return { offerIds: body.offerIds as string[], rationale: typeof body.rationale === "string" ? body.rationale : undefined };
}

/** Model-backed proposer. Pair it with the free-model gateway client; the loop verifies what it returns. */
export function createLlmProposer(model: ModelClient): Proposer {
  return {
    async propose(request) {
      return parse(await model.complete({ system: SYSTEM, user: describe(request) }));
    },
  };
}
