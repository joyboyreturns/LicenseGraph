import { z } from "zod";
import { finePrint } from "../core/fine-print";
import { compareRuns, type RunOutcome } from "../core/compare";
import { gapRequests, requirementCosts } from "../core/insights";
import { negotiationOutlook, savingLevers } from "../core/negotiation";
import { buildIcs, licenceEnds } from "../core/renewals";
import { isIsoDate } from "../core/dates";
import { minimumCompliantCost } from "../core/optimizer";
import { RULE_CATALOG, verifyBundle } from "../core/rules";
import { RULE_NOTES } from "../ui/lib/rule-notes";
import { whatIf } from "../core/whatif";
import type { LicenseOffer, Project } from "../core/types";

/**
 * What an AI agent may do through the Model Context Protocol. Checking and costing are pure and run
 * locally on the rules engine. Starting a purchase goes through the app's own API, and the app keeps
 * the money rules: an agent-started run cannot be approved or paid until a person takes control.
 */

const territory = z.string().trim().toUpperCase().regex(/^(WORLD|[A-Z]{2})$/, 'Use "WORLD" or an ISO 3166-1 alpha-2 country code');
const textId = z.string().trim().min(1).max(55);
/** Caps on what one call may carry, so a public endpoint cannot be handed an unbounded amount of work. */
const MAX_OFFERS = 200;
const MAX_ASSETS = 50;

export const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  commercial: z.boolean().describe("True if the project earns or promotes money."),
  territories: z.array(territory).min(1).max(250).describe('Where the project is released: ["WORLD"] or country codes such as "US".'),
  termMonths: z.number().int().safe().positive().max(1200).describe("How many months the assets are needed."),
  budgetCents: z.number().int().safe().nonnegative().optional().describe("Budget in the smallest currency unit."),
  currency: z.string().length(3).toUpperCase().optional().describe("Budget and settlement currency; USD if omitted."),
  mediums: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional().describe('Media used, e.g. "web", "broadcast".'),
  canCredit: z.boolean().optional().describe("False if the project cannot credit creators."),
  needsSublicensing: z.boolean().optional(),
  requiresExclusive: z.boolean().optional(),
  endDate: z.string().refine(isIsoDate, "Expected a real calendar date (YYYY-MM-DD)").optional(),
});

export const offerSchema = z.object({
  id: textId,
  assetId: textId,
  priceCents: z.number().int().safe().positive(),
  currency: z.string().length(3).toUpperCase(),
  terms: z.object({
    commercialUse: z.boolean(),
    territories: z.array(territory).min(1).max(250),
    termMonths: z.union([z.number().int().safe().positive(), z.literal("perpetual")]),
    mediums: z.union([z.array(z.string().toLowerCase().max(40)).max(20), z.literal("ALL")]).optional(),
    attributionRequired: z.boolean().optional(),
    sublicensing: z.boolean().optional(),
    exclusive: z.boolean().optional(),
    fixedEndDate: z.string().refine(isIsoDate).optional(),
    offerValidUntil: z.string().refine(isIsoDate).optional(),
  }),
  evidence: z.array(z.object({ documentId: z.string().min(1).max(55), quote: z.string().min(1).max(2000), field: z.string().max(40).optional() })).min(1).max(20).describe("Quotes from the licence text that support the terms."),
});

export const documentSchema = z.object({
  id: textId,
  assetId: textId,
  text: z.string().min(1).max(20_000).describe("The licence text, verbatim."),
  licensor: z.object({ name: z.string().trim().min(1).max(80), email: z.string().email().max(127).optional().describe("Where to pay this creator. Without it the purchase cannot be paid.") }).optional().describe("Who is paid for this licence."),
});

const today = () => new Date().toISOString().slice(0, 10);

export const checkBundleInput = z.object({ project: projectSchema, requiredAssetIds: z.array(textId).min(1).max(MAX_ASSETS), offers: z.array(offerSchema).min(1).max(MAX_OFFERS), chosenOfferIds: z.array(textId).min(1).max(MAX_ASSETS) });
export const cheapestBundleInput = z.object({ project: projectSchema, requiredAssetIds: z.array(textId).min(1).max(MAX_ASSETS), offers: z.array(offerSchema).min(1).max(MAX_OFFERS) });

/** The rules engine's verdict on one proposed bundle. Same code that gates payment in the app. */
export function checkBundle(input: z.infer<typeof checkBundleInput>) {
  const byId = new Map(input.offers.map((o) => [o.id, o as LicenseOffer]));
  const unknown = input.chosenOfferIds.filter((id) => !byId.has(id));
  if (unknown.length) return { ok: false as const, error: `Unknown offer ids: ${unknown.join(", ")}` };
  const verdict = verifyBundle(input.project as Project, input.requiredAssetIds, { offers: input.chosenOfferIds.map((id) => byId.get(id)!) }, { today: today() });
  return { ok: verdict.ok, totalCents: verdict.totalCents, violations: verdict.violations };
}

/** The exact minimum compliant cost, what each requirement adds to it, and what to ask for where nothing passes. */
export function cheapestBundle(input: z.infer<typeof cheapestBundleInput>) {
  const options = { today: today() };
  const candidates = input.offers as LicenseOffer[];
  const project = input.project as Project;
  const frontier = minimumCompliantCost(project, input.requiredAssetIds, candidates, options);
  return {
    plans: frontier.plans,
    uncoveredAssets: frontier.uncoveredAssets,
    requirementCosts: requirementCosts(project, input.requiredAssetIds, candidates, options) ?? null,
    gapRequests: gapRequests(project, input.requiredAssetIds, candidates, options),
    // Best case if every licensor agreed to every ask at its quoted price, and how much each asset could rise before the budget breaks. Not an offer.
    ifLicensorsAgree: negotiationOutlook(project, input.requiredAssetIds, candidates, project.currency ?? "USD", options) ?? null,
    // Where the cheapest compliant bundle could cost less: a cheaper offer whose licensor would only have to change terms. Not an offer.
    savingLevers: frontier.plans[0] ? savingLevers(project, input.requiredAssetIds, candidates, frontier.plans[0].offerIds, options) : [],
  };
}

/** The parts of a brief an agent may change when asking "what if". Anything left out keeps the brief's own value. */
export const projectChangeSchema = z
  .object({
    commercial: z.boolean().describe("Whether the project earns or promotes money."),
    territories: z.array(territory).min(1).max(250).describe('Where it would be released: ["WORLD"] or country codes.'),
    termMonths: z.number().int().safe().positive().max(1200).describe("How many months the assets would be needed."),
    mediums: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).describe("Media used. An empty list means the project does not constrain media."),
    canCredit: z.boolean().describe("False if the project cannot credit creators."),
    needsSublicensing: z.boolean(),
    requiresExclusive: z.boolean(),
  })
  .partial();

export const whatIfInput = cheapestBundleInput.extend({
  change: projectChangeSchema.describe("What to change in the brief."),
  currency: z.string().length(3).toUpperCase().optional().describe("The currency to compare in; the project's own, or USD, if omitted."),
});

/**
 * "What if the brief changed?" The exact cheapest compliant bundle for the changed brief, the difference
 * from the brief as written, which asset's licence would change, and for assets nothing covers, what to
 * ask the licensor for. Same code as the what-if panel; nothing is estimated.
 */
export function whatIfBrief(input: z.infer<typeof whatIfInput>) {
  const project = input.project as Project;
  return whatIf(project, input.change, input.requiredAssetIds, input.offers as LicenseOffer[], input.currency ?? project.currency ?? "USD", { today: today() });
}

export const licenceEndDatesInput = z.object({
  offers: z.array(offerSchema).min(1).max(MAX_OFFERS),
  offerIds: z.array(textId).min(1).max(MAX_OFFERS).optional().describe("Only these offers (the ones bought). All offers if omitted."),
  boughtOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("The day of purchase, YYYY-MM-DD. Today if omitted."),
  projectName: z.string().trim().min(1).max(120).optional(),
});

/**
 * When each licence stops covering the project, counted from the day of purchase, soonest first, with an
 * iCalendar file holding a reminder 30 days before each one. Plain date arithmetic on the offers' own terms.
 */
export function licenceEndDates(input: z.infer<typeof licenceEndDatesInput>) {
  const all = input.offers as LicenseOffer[];
  const chosen = input.offerIds ? all.filter((o) => input.offerIds!.includes(o.id)) : all;
  const boughtOn = input.boughtOn ?? today();
  const ends = licenceEnds(chosen, boughtOn);
  const items = ends.flatMap((e) => (e.endsOn ? [{ uid: `${e.offerId}-${boughtOn}`, label: `${e.assetId} (${e.offerId})`, endsOn: e.endsOn }] : []));
  return { boughtOn, ends, calendar: buildIcs(input.projectName ?? "Licence project", items, `${boughtOn.replace(/-/g, "")}T000000Z`) };
}

export const licenceFinePrintInput = z.object({
  documents: z.array(z.object({ id: textId, text: z.string().min(1).max(20_000) })).min(1).max(12),
});

/**
 * The clauses in each licence that the rules engine does not check (termination, AI training, resale, liability,
 * reporting, changes to the work), quoted word for word. An agent should put these in front of the person before
 * they approve: a bundle that passes the rules can still contain a clause the person would not accept.
 */
export function licenceFinePrint(input: z.infer<typeof licenceFinePrintInput>) {
  return { documents: input.documents.map((d) => ({ id: d.id, clauses: finePrint(d.text, 6) })) };
}

/**
 * The order an agent should work in, as a prompt an MCP client can offer. It only names the tools and what each
 * is for; every figure still comes from the tools, and nothing is approved or paid by the agent.
 */
export function purchasePlaybook(brief?: string): string {
  return [
    "You are buying creative licences for a person. Work in this order, and take every figure from the tools, never from memory or arithmetic of your own.",
    brief ? `The brief: ${brief}` : "Start by getting the brief: where it will be shown, for how long, which media, whether it is commercial, whether you can credit creators, whether you must sublicense, whether it needs exclusivity, and the budget.",
    "1. Read each licence into an offer: the price, and each term it states, with the exact sentence it came from. A term the licence does not state stays blank; a blank is not a yes.",
    "2. Call cheapest_compliant_bundle. It gives the exact minimum cost, what each requirement adds to it, and, where an asset has no compliant offer, the closest offer and what to ask its licensor to change.",
    "3. If nothing can be bought, read gapRequests and ifLicensorsAgree. Tell the person plainly: what blocks each asset, what to ask each licensor, the best-case total if they all said yes, and how far each price could rise before the budget breaks. Call what_if_brief to price a smaller scope (a different territory, a shorter term, one requirement dropped). Do not offer to proceed with a bundle the tools did not verify.",
    "4. If a bundle exists, call licence_fine_print on the licence texts and tell the person any clause it returns, then call licence_end_dates so the person knows when each licence runs out, then start_licence_purchase with the raw licence texts and, if the person gave you a spending limit, that limit as the mandate. LicenseGraph re-reads the licences, re-verifies the bundle itself and checks its total against your mandate for the person to see.",
    "5. Give the person the claim link. Only they can approve and pay; you cannot, and you must not say a payment happened until get_purchase_status shows it.",
    "6. Once the purchase is paid, call verify_licence_passport and report the Licence Passport link with its result; if any check failed, say which and do not call the licences cleared.",
  ].join("\n\n");
}

export const startPurchaseInput = z.object({
  project: projectSchema,
  requiredAssetIds: z.array(textId).min(1).max(12),
  documents: z.array(documentSchema).min(1).max(12),
  mandate: z
    .object({
      maxSpend: z.number().positive().max(10_000_000).describe("The most the person said you may spend, in whole currency units, for example 800 for $800."),
      currency: z.string().length(3).optional().describe("Defaults to the project's currency, or USD."),
      note: z.string().max(200).optional().describe("The person's instruction in their own words."),
      maxPerLicence: z.number().positive().max(10_000_000).optional().describe("The most the person allowed for any one licence, in whole currency units."),
      avoidLicensors: z.array(z.string().min(1).max(80)).max(10).optional().describe("Licensors the person does not want to buy from, by name."),
    })
    .optional()
    .describe("Your spending mandate. It is recorded, checked against the verified bundle and shown to the person who approves; it does not let you pay."),
});

export interface AppClient {
  baseUrl: string;
  fetch?: typeof fetch;
}

async function call(app: AppClient, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await (app.fetch ?? fetch)(`${app.baseUrl.replace(/\/$/, "")}${path}`, init);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/**
 * Start a purchase for a person. The agent gets a status link and a claim link to give to the person;
 * it gets no way to approve or pay, because the run belongs to nobody until the person takes control.
 */
export async function startPurchase(app: AppClient, input: z.infer<typeof startPurchaseInput>) {
  const { mandate, ...run } = input;
  const stated = mandate && { maxTotalCents: Math.round(mandate.maxSpend * 100), currency: (mandate.currency ?? (run.project as { currency?: string }).currency ?? "USD").toUpperCase(), ...(mandate.note ? { note: mandate.note } : {}), ...(mandate.maxPerLicence ? { maxPerLicenceCents: Math.round(mandate.maxPerLicence * 100) } : {}), ...(mandate.avoidLicensors?.length ? { avoidLicensors: mandate.avoidLicensors } : {}) };
  const { status, body } = await call(app, "/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...run, ...(stated ? { mandate: stated } : {}), handoff: true }) });
  if (status !== 201) return { ok: false as const, error: body?.error ?? `The app answered ${status}.` };
  return {
    ok: true as const,
    runId: body.id as string,
    claimUrl: body.handoff.claimUrl as string,
    expiresAt: body.handoff.expiresAt as string,
    next: "Give claimUrl to the person you are buying for. They open it, take control, review the bundle and approve. Poll get_purchase_status for progress. You cannot approve or pay.",
  };
}

/**
 * Re-check a Licence Passport on the server: the hash chain, the bundle digest, every quote, the rules engine on the
 * exact terms, the payment and payouts, and whether this server signed it. An agent should call this before relying on
 * a licence as cleared for use, and report any failed check rather than assume.
 */
export async function verifyPassportTool(app: AppClient, runId: string) {
  const { status, body } = await call(app, `/api/passports/${encodeURIComponent(runId)}/verify`);
  if (status !== 200) return { ok: false as const, error: body?.error ?? `The app answered ${status}.` };
  const checks = (body.checks as { id: string; label: string; ok: boolean; detail: string }[]).map((c) => ({ id: c.id, label: c.label, ok: c.ok, detail: c.detail }));
  return { ok: true as const, verified: Boolean(body.ok), failedChecks: checks.filter((c) => !c.ok).map((c) => c.id), signature: String(body.signature) as "valid" | "invalid" | "unsigned" | "unavailable", checks, passportUrl: `${app.baseUrl.replace(/\/$/, "")}/passport/${runId}` };
}

export async function purchaseStatus(app: AppClient, runId: string) {
  const { status, body } = await call(app, `/api/sessions/${encodeURIComponent(runId)}`);
  if (status !== 200) return { ok: false as const, error: body?.error ?? `The app answered ${status}.` };
  return {
    ok: true as const,
    phase: body.phase as string,
    awaitingPerson: Boolean(body.awaitingPerson),
    failure: body.failure ?? null,
    bundle: body.bundle ? { offerIds: body.bundle.offers.map((o: LicenseOffer) => o.id), totalCents: body.bundle.totalCents, currency: body.bundle.currency } : null,
    approvedBy: body.approval?.approvedBy ?? null,
    payment: body.capture ? { orderId: body.capture.id, captureId: body.capture.captureId, amount: body.capture.amount } : null,
    creatorPayouts: body.payouts ? { status: body.payouts.status, lines: body.payouts.lines.map((l: any) => ({ assetId: l.assetId, status: l.status })) } : null,
    mandate: ((e) => (e ? { status: e.payload.status as string, capCents: e.payload.maxTotalCents as number, totalCents: e.payload.totalCents as number, currency: e.payload.currency as string, breaches: ((e.payload.breaches as { detail: string }[] | undefined) ?? []).map((b) => b.detail) } : null))((body.events as { kind: string; payload: Record<string, unknown> }[] | undefined)?.find((x) => x.kind === "mandate_checked")),
    ledgerIntact: body.chainValid as boolean,
    passportUrl: body.capture ? `${app.baseUrl.replace(/\/$/, "")}/passport/${runId}` : null,
    // Once paid, a printable receipt per creator, which the person can forward to each licensor.
    creatorReceipts: body.capture && body.bundle ? (body.bundle.offers as LicenseOffer[]).map((o) => ({ assetId: o.assetId, url: `${app.baseUrl.replace(/\/$/, "")}/passport/${runId}/receipt/${encodeURIComponent(o.assetId)}` })) : [],
  };
}

/** Every rule the engine checks, when it applies and what a licence's silence means, as Markdown an agent can read before it argues with a verdict. */
export function rulesGuide(): string {
  const lines = RULE_CATALOG.map((r) => {
    const n = RULE_NOTES[r.id];
    return `## ${r.label} (\`${r.id}\`)\n- Applies: ${n?.applies ?? "See the rules page."}\n- If the licence is silent: ${n?.silent ?? "Treated as not meeting it."}`;
  });
  return ["# The rules LicenseGraph checks every licence against", "", "Plain code decides, not a model: the same terms always get the same verdict. A rule applies only when the brief makes it relevant, and where it applies a licence that is silent does not get the benefit of the doubt. Bundle-level checks (coverage, one licence per asset, a single currency, the budget) are applied on top.", "", ...lines.flatMap((l) => [l, ""])].join("\n");
}

/** The signed Licence Passport of a paid purchase, as the JSON an agent can keep and re-check offline with the server's public key. */
export async function passportDocument(app: AppClient, runId: string): Promise<{ ok: true; json: string } | { ok: false; error: string }> {
  const { status, body } = await call(app, `/api/passports/${encodeURIComponent(runId)}`);
  if (status !== 200) return { ok: false, error: body?.error ?? `The app answered ${status}.` };
  return { ok: true, json: JSON.stringify(body, null, 2) };
}

export const compareRunsInput = {
  runId: z.string().min(1).max(100).describe("The newer run, for example one that checked a changed brief or a licensor's revised licence."),
  earlierRunId: z.string().min(1).max(100).describe("The run it came from."),
};

/**
 * Two runs side by side, from their verified bundles: which asset's licence changed, what each now costs, and the difference
 * in the total. Read-only; nothing is bought or changed.
 */
export async function compareRunsTool(app: AppClient, input: { runId: string; earlierRunId: string }) {
  const outcome = async (id: string): Promise<{ ok: true; value: RunOutcome | undefined } | { ok: false; error: string }> => {
    const { status, body } = await call(app, `/api/sessions/${encodeURIComponent(id)}`);
    if (status !== 200) return { ok: false, error: `Run ${id}: ${body?.error ?? `the app answered ${status}.`}` };
    return { ok: true, value: body.bundle ? { offers: body.bundle.offers, totalCents: body.bundle.totalCents, currency: body.bundle.currency } : undefined };
  };
  const [now, before] = await Promise.all([outcome(input.runId), outcome(input.earlierRunId)]);
  if (!now.ok) return now;
  if (!before.ok) return before;
  const c = compareRuns(before.value, now.value);
  return {
    ok: true as const,
    earlierTotalCents: before.value?.totalCents ?? null,
    totalCents: now.value?.totalCents ?? null,
    currency: c.currency,
    deltaCents: c.deltaCents,
    assets: c.assets,
    note: "Taken from each run's verified bundle. A run with no compliant bundle has nothing to compare, so its assets read as gained or lost.",
  };
}
