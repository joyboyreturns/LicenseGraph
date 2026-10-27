import type { Ledger } from "../ledger/ledger";
import { verifyBundle, type VerifyOptions } from "../core/rules";
import type { Bundle, LicenseOffer, Project, Verdict, Violation } from "../core/types";

/** What the proposer is told about its earlier attempts. */
export interface Attempt {
  offerIds: string[];
  violations: Violation[];
  /** Set when the proposal itself was unusable (e.g. an unknown offer id). */
  error?: string;
}

export interface ProposalRequest {
  project: Project;
  requiredAssetIds: string[];
  /** The only offers that exist. The proposer picks from these by id. */
  candidates: LicenseOffer[];
  history: Attempt[];
}

/** The agent. It proposes; it never verifies its own work. */
export interface Proposer {
  propose(request: ProposalRequest): Promise<{ offerIds: string[]; rationale?: string }>;
}

export type LoopStatus = "verified" | "exhausted" | "stalled";

export interface LoopResult {
  status: LoopStatus;
  rounds: number;
  /** Present only when status is "verified". */
  bundle?: Bundle;
  /** The verdict of the last bundle checked, if any was checked. */
  verdict?: Verdict;
}

export interface LoopInput {
  project: Project;
  requiredAssetIds: string[];
  candidates: LicenseOffer[];
  proposer: Proposer;
  ledger: Ledger;
  verifyOptions?: VerifyOptions;
  /** Hard cap on proposals. Default 4. */
  maxRounds?: number;
}

const key = (ids: string[]) => [...ids].sort().join("|");

/**
 * Propose, verify, reject, revise. Violations go back to the proposer verbatim; only a bundle
 * the rules engine accepts is returned as verified. The loop stops early when the proposer
 * repeats a bundle it has already seen rejected, and never exceeds `maxRounds`.
 */
export async function runProposeVerifyLoop(input: LoopInput): Promise<LoopResult> {
  const { project, requiredAssetIds, candidates, proposer, ledger } = input;
  const maxRounds = input.maxRounds ?? 4;
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const history: Attempt[] = [];
  const tried = new Set<string>();
  let last: Verdict | undefined;

  for (let round = 1; round <= maxRounds; round++) {
    let offerIds: string[];
    let rationale: string | undefined;
    try {
      ({ offerIds, rationale } = await proposer.propose({ project, requiredAssetIds, candidates, history: structuredClone(history) }));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      ledger.append("proposal_error", { round, error });
      history.push({ offerIds: [], violations: [], error });
      continue;
    }

    const unknown = offerIds.filter((id) => !byId.has(id));
    if (unknown.length) {
      const error = `Unknown offer ids: ${unknown.join(", ")}`;
      ledger.append("proposal_error", { round, offerIds, error });
      history.push({ offerIds, violations: [], error });
      continue;
    }

    ledger.append(round === 1 ? "proposed" : "revised", { round, offerIds, rationale });

    if (tried.has(key(offerIds))) {
      return { status: "stalled", rounds: round, verdict: last };
    }
    tried.add(key(offerIds));

    const bundle: Bundle = { offers: offerIds.map((id) => byId.get(id)!) };
    last = verifyBundle(project, requiredAssetIds, bundle, input.verifyOptions);

    if (last.ok) {
      ledger.append("verified", { round, offerIds, totalCents: last.totalCents });
      return { status: "verified", rounds: round, bundle, verdict: last };
    }
    ledger.append("rejected", { round, offerIds, violations: last.violations });
    history.push({ offerIds, violations: last.violations });
  }

  return { status: "exhausted", rounds: maxRounds, verdict: last };
}
