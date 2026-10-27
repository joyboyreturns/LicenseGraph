import { analyzeRun } from "../core/analysis";
import type { Session } from "../app-logic/session";
import { buildPassport, type Passport } from "./passport";

/** The passport for a paid run, with the price-only comparison worked out from the same candidates. */
export function issuePassport(session: Session): Passport {
  const bundle = session.loop?.bundle;
  const analysis = analyzeRun({
    project: session.input.project,
    requiredAssetIds: session.input.requiredAssetIds,
    candidates: session.candidates,
    chosenOfferIds: bundle?.offers.map((o) => o.id) ?? [],
    options: { today: session.runDate },
  });
  return buildPassport(session, { naiveTotalCents: analysis.naiveTotalCents, compliancePremiumCents: analysis.compliancePremiumCents, blockedPurchases: analysis.blockedPurchases });
}
