import { scenarioById } from "../demo/scenarios";
import { SessionError, viewOf, type Session, type SessionInput } from "./session";

/**
 * A licensor's answer to a gap request, added to the run it answers. Either their revised licence text for
 * one asset, or (demo only) the replies a built-in scenario carries so the whole loop can be shown offline.
 */
export type Revision = { simulate: true } | { assetId: string; text: string; licensor?: { name: string; email?: string } };

const MAX_DOCS = 12;

/**
 * The input for a new run: everything the earlier run read, plus the revised licence(s). The earlier run
 * is left exactly as it was, so its failure, its ledger and its reasons stay on record; the new run checks
 * the revised terms from scratch, and only a bundle that passes the rules can be approved and paid.
 */
export function reviseInput(input: SessionInput, fromRunId: string, revision: Revision): SessionInput {
  const have = new Set(input.documents.map((d) => d.id));
  let added: SessionInput["documents"];
  if ("simulate" in revision) {
    const replies = scenarioById(input.meta?.scenarioId ?? "")?.replies ?? [];
    added = replies.filter((d) => !have.has(d.id)).map((d) => ({ ...d }));
    if (!added.length) throw new SessionError("This run has no simulated licensor replies.");
  } else {
    if (!input.requiredAssetIds.includes(revision.assetId)) throw new SessionError(`This run does not need a licence for "${revision.assetId}".`);
    if (!revision.text.trim()) throw new SessionError("Paste the revised licence text.");
    let n = 1;
    while (have.has(`${revision.assetId}-rev${n}`)) n++;
    added = [{ id: `${revision.assetId}-rev${n}`, assetId: revision.assetId, text: revision.text, ...(revision.licensor ? { licensor: revision.licensor } : {}) }];
  }
  const documents = [...input.documents.map((d) => ({ ...d })), ...added];
  if (documents.length > MAX_DOCS) throw new SessionError(`A run can read at most ${MAX_DOCS} licences.`);
  return { ...structuredClone(input), documents, meta: { ...input.meta, revisedFrom: fromRunId } };
}

/**
 * Put the link to the earlier run into the new run's hash-chained ledger, as its first event, so the
 * negotiation is part of the record that travels with the Licence Passport: what had failed, what was
 * asked, and which revised licences were added.
 */
export function recordRevision(session: Session, from: Session) {
  const before = new Set(from.input.documents.map((d) => d.id));
  session.ledger.append("answers_run", {
    fromRunId: from.id,
    earlierOutcome: from.phase === "verified" ? "verified" : "no compliant bundle",
    asked: (viewOf(from).analysis?.gaps ?? []).map((g) => ({ assetId: g.assetId, offerId: g.offerId, priceCents: g.priceCents, currency: g.currency, rules: g.asks.map((a) => a.rule) })),
    addedDocumentIds: session.input.documents.filter((d) => !before.has(d.id)).map((d) => d.id),
  });
}
