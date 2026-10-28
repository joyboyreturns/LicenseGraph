import type { SessionView } from "../app-logic/session";
import { compareRuns, type AssetChange } from "../core/compare";
import { negotiationOutlook, savingLevers } from "../core/negotiation";
import type { ModelClient } from "../extraction/model";

export interface Answer {
  answer: string;
  source: "model" | "local";
  /** Offer ids the answer refers to; every one exists in this run. */
  citations: string[];
}

const usd = (cents: number, currency = "USD") => (cents / 100).toLocaleString("en-US", { style: "currency", currency });
/** Totals that are not tied to one offer (price-only total, premium, budget) are in the run's settlement currency, not always dollars. */
const runCurrency = (v: SessionView) => v.bundle?.currency ?? v.project.currency ?? "USD";
const termText = (t: SessionView["candidates"][number]["terms"]) =>
  [t.commercialUse ? "commercial" : "non-commercial", t.territories.join("/"), t.termMonths === "perpetual" ? "perpetual" : `${t.termMonths} months`, t.mediums ? (t.mediums === "ALL" ? "any medium" : t.mediums.join("/")) : "media not stated"].join(", ");

/** For a run with no compliant bundle: the best case if every licensor agreed to every ask, at the prices already quoted. */
const outlookOf = (v: SessionView) => (v.bundle || !v.analysis?.gaps.length ? undefined : negotiationOutlook(v.project, v.analysis.assets.map((a) => a.assetId), v.candidates, runCurrency(v), { today: v.runDate }));

/** For a verified bundle: cheaper offers whose licensor would only have to change terms, with the saving if they agreed at their quoted price. */
const leversOf = (v: SessionView) => (v.bundle && v.analysis ? savingLevers(v.project, v.analysis.assets.map((a) => a.assetId), v.candidates, v.bundle.offers.map((o) => o.id), { today: v.runDate }) : []);

const CHANGE_WORDS: Record<AssetChange, string> = { same: "is the same licence", cheaper: "now costs less", dearer: "now costs more", "other-licence": "is now a different licence at the same price", gained: "is covered only now", lost: "is no longer covered" };

/** This run beside the run it came from, asset by asset, from the two verified bundles. Absent when there is nothing to compare. */
function comparisonOf(v: SessionView, earlier: SessionView | undefined): { text: string; offerIds: string[] } | undefined {
  if (!earlier) return undefined;
  const { assets, deltaCents, currency } = compareRuns(earlier.bundle, v.bundle);
  if (!assets.length) return { text: earlier.bundle || v.bundle ? "Neither run has anything to compare." : "Neither this run nor the one it came from found a compliant bundle, so there is nothing to compare.", offerIds: [] };
  const head = `${earlier.bundle ? `The run this came from cost ${usd(earlier.bundle.totalCents, earlier.bundle.currency)}` : "The run this came from found no compliant bundle"}; ${v.bundle ? `this one costs ${usd(v.bundle.totalCents, v.bundle.currency)}` : "this one found no compliant bundle"}${deltaCents === null ? "" : deltaCents === 0 ? ", the same" : `, ${usd(Math.abs(deltaCents), currency!)} ${deltaCents < 0 ? "less" : "more"}`}.`;
  const lines = assets.map((a) => `The ${a.assetId} ${CHANGE_WORDS[a.change]}${a.before ? ` (was ${a.before.offerId} at ${usd(a.before.priceCents, earlier.bundle!.currency)}` : " ("}${a.after ? `${a.before ? ", now" : "now"} ${a.after.offerId} at ${usd(a.after.priceCents, v.bundle!.currency)}` : ""}).`);
  return { text: [head, ...lines].join("\n"), offerIds: assets.flatMap((a) => [a.before?.offerId, a.after?.offerId]).filter((id): id is string => Boolean(id)) };
}

/** The facts of a run as compact text: the only thing the model is allowed to answer from. */
export function runFacts(v: SessionView, earlier?: SessionView): string {
  const failedBy = new Map<string, string[]>();
  for (const e of v.events.filter((e) => e.kind === "rejected")) {
    for (const viol of e.payload.violations as { offerId?: string; message: string; rule: string }[]) {
      if (viol.offerId) failedBy.set(viol.offerId, [...(failedBy.get(viol.offerId) ?? []), `${viol.rule}: ${viol.message}`]);
    }
  }
  const chosen = new Set(v.bundle?.offers.map((o) => o.id));
  const lines = [
    `Project: ${v.project.name}. Commercial: ${v.project.commercial}. Territories: ${v.project.territories.join(", ")}. Needs ${v.project.termMonths} months.${v.project.mediums ? ` Media: ${v.project.mediums.join(", ")}.` : ""}${v.project.budgetCents ? ` Budget ${usd(v.project.budgetCents, v.project.currency)}.` : ""}`,
    `Status: ${v.phase}. Agent rounds: ${v.rounds ?? "n/a"}.`,
    ...v.candidates.map((o) => `Offer ${o.id} for ${o.assetId}: ${usd(o.priceCents, o.currency)}; ${termText(o.terms)}. ${chosen.has(o.id) ? "CHOSEN." : failedBy.has(o.id) ? `REJECTED (${failedBy.get(o.id)!.join("; ")}).` : "Not chosen."} Evidence: ${o.evidence.map((e) => `${e.field ?? "term"}: "${e.quote}"`).join(" | ")}`),
  ];
  for (const g of v.analysis?.gaps ?? []) lines.push(`Gap for ${g.assetId}: no compliant offer. Closest is ${g.offerId} at ${usd(g.priceCents, g.currency)}. Ask the licensor to: ${g.asks.map((a) => a.ask).join(" ")}`);
  const outlook = outlookOf(v);
  if (outlook) lines.push(`If every licensor agreed to those changes at their quoted prices, the cheapest compliant bundle would cost ${usd(outlook.totalCents, outlook.currency)}${outlook.headroomCents !== undefined ? (outlook.headroomCents >= 0 ? `, ${usd(outlook.headroomCents, outlook.currency)} under budget` : `, ${usd(-outlook.headroomCents, outlook.currency)} over budget`) : ""}. This is a best case, not an offer.`);
  for (const l of leversOf(v)) lines.push(`Saving lever for ${l.assetId}: ${l.offerId} costs ${usd(l.priceCents, l.currency)} instead of ${usd(l.chosenPriceCents, l.currency)} (saves ${usd(l.savingCents, l.currency)}) if its licensor would: ${l.asks.map((a) => a.ask).join(" ")} A best case, not an offer.`);
  const compared = comparisonOf(v, earlier);
  if (compared) lines.push(`Compared with the run it came from: ${compared.text.replace(/\n/g, " ")}`);
  if (v.bundle) lines.push(`Verified bundle total ${usd(v.bundle.totalCents, v.bundle.currency)}.`);
  if (v.analysis) lines.push(`A price-only buyer would pay ${usd(v.analysis.naiveTotalCents, runCurrency(v))}; compliance premium ${usd(v.analysis.compliancePremiumCents, runCurrency(v))}; blocked purchases: ${v.analysis.blockedPurchases.map((b) => `${b.offerId} (${b.reasons.join(", ")})`).join("; ") || "none"}.`);
  if (v.payouts) lines.push(`Creators paid: ${v.payouts.lines.map((l) => `${l.licensorName} ${usd(l.amountCents, l.currency)} for ${l.assetId} (${l.status})`).join("; ")}.`);
  if (v.capture) lines.push(`PayPal capture ${v.capture.captureId} for ${v.capture.amount.value} ${v.capture.amount.currency}.`);
  return lines.join("\n");
}

/** Plain, deterministic answers for the common questions. Always available, never invents anything. */
export function answerLocally(v: SessionView, question: string, earlier?: SessionView): Answer {
  const q = question.toLowerCase();
  const failed = new Map<string, string[]>();
  for (const e of v.events.filter((e) => e.kind === "rejected")) {
    for (const viol of e.payload.violations as { offerId?: string; message: string }[]) if (viol.offerId) failed.set(viol.offerId, [...(failed.get(viol.offerId) ?? []), viol.message]);
  }
  const mentioned = v.candidates.filter((o) => q.includes(o.id.toLowerCase()) || q.includes(o.id.replace(/^offer-/, "").toLowerCase()));
  const cite = (ids: string[]) => ({ citations: [...new Set(ids)], source: "local" as const });

  // A run that came from another: what is different from it.
  const compared = comparisonOf(v, earlier);
  if (compared && /(differ|compar|what changed|has changed|changed (from|since)|(earlier|previous|first|original|last) (run|one|time|version)|before the (change|reply|rebrief)|(since|from) the (change|reply))/.test(q)) return { answer: compared.text, ...cite(compared.offerIds) };

  // A verified run: where it could cost less, from the exact checks.
  const levers = leversOf(v);
  if (levers.length && /((could|can|would|might|where).*(save|saving|cheaper|pay less|lower|reduce)|negotiat|discount|pay less)/.test(q)) {
    const total = levers.reduce((n, l) => n + l.savingCents, 0);
    return { answer: `${levers.map((l) => `For the ${l.assetId}: ${l.offerId} costs ${usd(l.priceCents, l.currency)} instead of ${usd(l.chosenPriceCents, l.currency)}, saving ${usd(l.savingCents, l.currency)}, if its licensor would ${l.asks.map((a) => a.ask.replace(/\.$/, "")).join("; ")}.`).join("\n")}\nIf every licensor agreed at the price they quoted you would pay ${usd(total, levers[0]!.currency)} less. A best case, not an offer: ask first, then have the revised licence checked before buying.`, ...cite(levers.map((l) => l.offerId)) };
  }

  // A run with nothing to buy: what blocks each asset, what to ask, and what a yes would cost, from the exact checks.
  const gaps = v.bundle ? [] : (v.analysis?.gaps ?? []);
  if (gaps.length) {
    const ids = gaps.map((g) => g.offerId);
    if (/(if|when).*(agree|accept|yes|say)|best case|would it cost|how much.*(agree|yes)/.test(q)) {
      const out = outlookOf(v);
      if (out) return { answer: `If every licensor agreed to the changes asked for, at the prices they already quoted, the cheapest compliant bundle would cost ${usd(out.totalCents, out.currency)}${out.headroomCents === undefined ? "" : out.headroomCents >= 0 ? `, which is ${usd(out.headroomCents, out.currency)} under the budget` : `, which is ${usd(-out.headroomCents, out.currency)} over the budget`}. That is a best case, not an offer: a licensor may ask for more, and nothing is bought until revised terms are checked.`, ...cite(out.assets.map((a) => a.offerId)) };
    }
    if (/(ask|request|change|negotiat|what (should|do|can) (i|we)|next|fix|close the gap)/.test(q)) {
      return { answer: gaps.map((g) => `For the ${g.assetId}, ask the licensor of ${g.offerId} (${usd(g.priceCents, g.currency)}) to: ${g.asks.map((a) => a.ask).join(" ")}`).join("\n"), ...cite(ids) };
    }
    if (/(why|what).*(nothing|no bundle|not (be )?(bought|buy)|can'?t|cannot|block|fail|reject|wrong)|nothing|no bundle/.test(q)) {
      return { answer: `Nothing can be bought as it stands: ${gaps.length === 1 ? "one asset has" : `${gaps.length} assets have`} no licence that meets every requirement. ${gaps.map((g) => `${g.assetId}: the closest offer, ${g.offerId}, fails because it needs ${g.asks.map((a) => a.rule).join(", ")} changed`).join("; ")}. The agent was not asked to propose a bundle, because the independent cost check proves none can pass.`, ...cite(ids) };
    }
  }

  if (/(why|what).*(reject|fail|block|wrong|not chosen|skip)|rejected|blocked/.test(q)) {
    const subject = mentioned.length ? mentioned : v.candidates.filter((o) => failed.has(o.id));
    if (!subject.length) return { answer: "Nothing was rejected in this run: the first proposal already passed every rule.", ...cite([]) };
    return {
      answer: subject.map((o) => (failed.has(o.id) ? `${o.id} (${o.assetId}, ${usd(o.priceCents, o.currency)}) was rejected: ${[...new Set(failed.get(o.id)!)].join(" ")}` : `${o.id} was not rejected by a rule${v.bundle?.offers.some((b) => b.id === o.id) ? "; it is in the verified bundle." : ", but it was not the cheapest compliant choice."}`)).join("\n"),
      ...cite(subject.map((o) => o.id)),
    };
  }
  if (/(cost|total|price|pay|spend|save|saving|premium|cheap|how much)/.test(q) && !/(who|creator|licensor)/.test(q)) {
    if (!v.bundle || !v.analysis) return { answer: "No bundle has been verified yet, so there is no total.", ...cite([]) };
    return {
      answer: `The verified bundle costs ${usd(v.bundle.totalCents, v.bundle.currency)}. Buying the cheapest offer for every asset would have cost ${usd(v.analysis.naiveTotalCents, runCurrency(v))}, but ${v.analysis.blockedPurchases.length} of those licences break the project's rules, so staying compliant costs ${usd(v.analysis.compliancePremiumCents, runCurrency(v))} more.`,
      ...cite(v.bundle.offers.map((o) => o.id)),
    };
  }
  if (/(who|creator|licensor|artist|payout)/.test(q)) {
    if (!v.payouts) return { answer: v.capture ? "The payment is captured but no creator payout has been recorded." : "Creators are paid after the payment is captured.", ...cite([]) };
    return { answer: v.payouts.lines.map((l) => `${l.licensorName} receives ${usd(l.amountCents, l.currency)} for ${l.assetId} (${l.status.toLowerCase()}).`).join("\n"), ...cite(v.payouts.lines.map((l) => l.offerId)) };
  }
  if (/(evidence|quote|source|sentence|where|prove|sure)/.test(q) && mentioned.length) {
    return { answer: mentioned.map((o) => `${o.id}: ${o.evidence.map((e) => `${e.field ?? "term"} is backed by "${e.quote}"`).join("; ")}`).join("\n"), ...cite(mentioned.map((o) => o.id)) };
  }
  return {
    answer: `This run has ${v.candidates.length} licence offers for ${new Set(v.candidates.map((c) => c.assetId)).size} assets. ${v.bundle ? `The verified bundle costs ${usd(v.bundle.totalCents, v.bundle.currency)}.` : "No bundle has been verified yet."} Try asking ${gaps.length ? "why nothing can be bought, what to ask the licensors, or what a yes would cost" : "why an offer was rejected, what the total is, or who gets paid"}.`,
    ...cite([]),
  };
}

const SYSTEM = `You answer questions about one licensing run. Use ONLY the facts provided. If the facts do not contain the answer, say you do not know. Answer in at most four short sentences. When you mention an offer, write its id exactly as given. Never give legal advice; say what the licence text and rules show.`;

/**
 * Ask the model, grounded in the run's facts. Any offer id it cites must exist in the run;
 * otherwise the deterministic answer is used instead. Failures fall back the same way.
 */
export async function answerQuestion(v: SessionView, question: string, model?: ModelClient, earlier?: SessionView): Promise<Answer> {
  const local = answerLocally(v, question, earlier);
  if (!model) return local;
  try {
    const raw = (await model.complete({ system: SYSTEM, user: `Facts:\n${runFacts(v, earlier)}\n\nQuestion: ${question}` })).trim();
    if (!raw) return local;
    const known = new Set(v.candidates.map((c) => c.id));
    const cited = [...new Set([...raw.matchAll(/\boffer-[a-z0-9-]+/gi)].map((m) => m[0]))];
    if (cited.some((id) => !known.has(id))) return local;
    return { answer: raw.slice(0, 1200), source: "model", citations: cited };
  } catch {
    return local;
  }
}
