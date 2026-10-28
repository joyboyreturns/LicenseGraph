import { readJsonObject } from "../extraction/json-reply";
import { z } from "zod";
import type { Project } from "../core/types";
import type { ModelClient } from "../extraction/model";

export interface BriefResult {
  project: Project;
  requiredAssetIds: string[];
  /** What the text actually said, as short labels for the UI. */
  found: string[];
  /** Defaults applied because the text was silent. Shown so nothing is guessed quietly. */
  assumed: string[];
  source: "local" | "model";
}

const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
const PLACES: [RegExp, string[]][] = [
  [/\b(worldwide|world-wide|global(?:ly)?|international(?:ly)?|anywhere|all countries)\b/i, ["WORLD"]],
  [/\b(united states|america(?:n)?)\b/i, ["US"]],
  // Case-sensitive, so the pronoun "us" ("a song for us") is not read as the United States.
  [/(?<![\w.])(?:U\.S\.A?\.?|USA?)(?!\w)/, ["US"]],
  [/\b(uk|u\.k\.|united kingdom|britain|british|england)\b/i, ["GB"]],
  [/\b(india|indian)\b/i, ["IN"]],
  [/\b(canada|canadian)\b/i, ["CA"]],
  [/\b(australia|australian)\b/i, ["AU"]],
  [/\b(germany|german)\b/i, ["DE"]],
  [/\b(france|french)\b/i, ["FR"]],
  [/\b(japan|japanese)\b/i, ["JP"]],
  [/\b(brazil|brazilian)\b/i, ["BR"]],
  [/\b(mexico|mexican)\b/i, ["MX"]],
  [/\b(europe|european union|the eu|eu)\b/i, EU],
];
const MEDIA: [RegExp, string][] = [
  [/\b(web|website|online|internet|blog)\b/i, "web"],
  [/\b(print|poster|magazine|flyer|brochure|billboard)\b/i, "print"],
  [/\b(tv|television|broadcast|radio)\b/i, "broadcast"],
  [/\b(film|cinema|movie|theatrical)\b/i, "film"],
  [/\b(social|youtube|instagram|tiktok|facebook|reels|shorts)\b/i, "social"],
  [/\b(podcast|audio|streaming)\b/i, "audio"],
  [/\b(app|mobile|game|games)\b/i, "app"],
];
const ASSETS: [RegExp, string][] = [
  [/\b(song|songs|music|track|tracks|soundtrack|beat|jingle|theme tune)\b/i, "song"],
  [/\b(image|images|photo|photos|picture|pictures|illustration|artwork|key art|cover art|graphic)\b/i, "image"],
  [/\b(font|fonts|typeface|typefaces)\b/i, "font"],
  [/\b(footage|video clip|b-roll|stock video|clips)\b/i, "footage"],
  [/\b(voiceover|voice-over|narration|narrator|voice)\b/i, "voiceover"],
  [/\b(sfx|sound effects?)\b/i, "sfx"],
];
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function months(text: string): number | undefined {
  if (/\b(perpetual|forever|lifetime|permanent(?:ly)?|in perpetuity)\b/i.test(text)) return 1200;
  // Decimals are read whole ("1.5 years" is 18 months, not "5 years").
  const m = /(?<![\d.])\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an)[\s-]*(month|months|mo|year|years|yr|yrs)\b/i.exec(text);
  if (!m) return /\b(annual|yearly)\b/i.test(text) ? 12 : undefined;
  const raw = m[1]!.toLowerCase();
  const n = /^\d/.test(raw) ? Number(raw) : (WORDS[raw] ?? 1);
  const result = Math.round(/^y/i.test(m[2]!) ? n * 12 : n);
  return result >= 1 ? result : undefined;
}

const AMOUNT = String.raw`([\d][\d,]*(?:\.\d+)?)`;
const LIMIT_WORD = String.raw`(?:under|below|up to|at most|max(?:imum)?|less than|within|no more than|cap(?:ped)?\s+at|<)`;

/**
 * A number is a budget only when the text says so: after the word "budget", or with a money signal
 * ($, usd, dollars, k). "within 12 months", "up to 3 songs" and "under 30 seconds" are not budgets.
 */
function budgetCents(text: string): number | undefined {
  const m =
    new RegExp(String.raw`\bbudget(?:\s+(?:of|is))?\s*(?:us)?\s*\$?\s*${AMOUNT}\s*(k\b|usd|dollars?)?`, "i").exec(text) ??
    new RegExp(String.raw`${LIMIT_WORD}\s*(?:of\s*)?(?:us)?\s*\$\s*${AMOUNT}\s*(k\b|usd|dollars?)?`, "i").exec(text) ??
    new RegExp(String.raw`${LIMIT_WORD}\s*(?:of\s*)?${AMOUNT}\s*(k\b|usd|dollars?)`, "i").exec(text) ??
    /\$\s*([\d][\d,]*(?:\.\d+)?)\s*(k\b)?\s*(?:budget|max|cap|limit)/i.exec(text);
  if (!m) return undefined;
  const value = Number(m[1]!.replace(/,/g, "")) * (/^k$/i.test(m[2] ?? "") ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : undefined;
}

/** Read a plain-English brief with rules of thumb. Instant, offline, and says what it assumed. */
export function parseBriefLocally(text: string): BriefResult {
  const found: string[] = [];
  const assumed: string[] = [];

  const name = /["“]([^"”]{3,60})["”]/.exec(text)?.[1]?.trim() ?? /\b(?:called|named|project)\s+([A-Z][\w' -]{2,40})/.exec(text)?.[1]?.trim();
  if (name) found.push(`Project: ${name}`);

  const commercialCue = /\b(commercial|advert\w*|\bads?\b|sell\w*|monetiz\w*|paid|brand\w*|client\w*|campaign|promo\w*|product|business|revenue)\b/i.test(text);
  // "school" or "hobby" only suggest non-commercial use when nothing in the brief points to a commercial one
  // ("a commercial ad for a school fundraiser" is commercial). Reading a commercial project as non-commercial is the unsafe mistake.
  const nonCommercial =
    /\b(non[- ]?commercial|personal (?:use|project)|not[- ]for[- ]profit|editorial only)\b/i.test(text) || (/\b(hobby|school|student)\b/i.test(text) && !commercialCue);
  const commercial = !nonCommercial;
  if (nonCommercial) found.push("Non-commercial use");
  else if (commercialCue) found.push("Commercial use");
  else assumed.push("Commercial use (to be safe)");

  const territories = [...new Set(PLACES.flatMap(([re, codes]) => (re.test(text) ? codes : [])))];
  const hasWorld = territories.includes("WORLD");
  const finalTerritories = hasWorld ? ["WORLD"] : territories;
  if (finalTerritories.length) found.push(`Territory: ${finalTerritories.length > 6 ? "EU" : finalTerritories.join(", ")}`);
  else assumed.push("Territory: worldwide");

  const termMonths = months(text);
  if (termMonths !== undefined) found.push(termMonths >= 1200 ? "Term: perpetual" : `Term: ${termMonths} months`);
  else assumed.push("Term: 12 months");

  const budget = budgetCents(text);
  if (budget !== undefined) found.push(`Budget: $${(budget / 100).toLocaleString("en-US")}`);

  const mediums = [...new Set(MEDIA.filter(([re]) => re.test(text)).map(([, m]) => m))];
  if (mediums.length) found.push(`Media: ${mediums.join(", ")}`);

  const canCredit = /\b(?:no|without|can'?t|cannot|unable to|don'?t want to|not able to)\s+(?:\w+\s+)?(?:credit|credits|attribution)\b/i.test(text) ? false : undefined;
  if (canCredit === false) found.push("Cannot credit creators");
  const needsSublicensing = /\b(sublicens\w*|resell\w*|white[- ]?label|for (?:our |my )?clients|agency|redistribut\w*)\b/i.test(text) ? true : undefined;
  if (needsSublicensing) found.push("Needs sublicensing");
  // "non-exclusive", "not exclusive" and "don't need exclusivity" say the opposite of requiring it.
  const withoutNegated = text.replace(/\b(?:non[- ]?exclusiv\w*|not\s+(?:\w+\s+)?exclusiv\w*|no\s+exclusiv\w*|(?:don'?t|do not|doesn'?t|does not|needn'?t|need not|no need)\s+(?:\w+\s+){0,4}?exclusiv\w*)/gi, " ");
  const requiresExclusive = /\b(exclusive|exclusivity|no one else|nobody else)\b/i.test(withoutNegated) ? true : undefined;
  if (requiresExclusive) found.push("Needs an exclusive licence");

  const required = [...new Set(ASSETS.filter(([re]) => re.test(text)).map(([, a]) => a))];
  if (required.length) found.push(`Assets: ${required.join(", ")}`);
  else assumed.push("Assets: choose them below");

  return {
    project: {
      name: name ?? "My project",
      commercial,
      territories: finalTerritories.length ? finalTerritories : ["WORLD"],
      termMonths: termMonths ?? 12,
      budgetCents: budget,
      mediums: mediums.length ? mediums : undefined,
      canCredit,
      needsSublicensing,
      requiresExclusive,
    },
    requiredAssetIds: required,
    found,
    assumed,
    source: "local",
  };
}

const TERRITORY_ALIASES: Record<string, string> = { USA: "US", UK: "GB", WORLDWIDE: "WORLD" };
/** The same codes the run API accepts, so a model's "usa" or "uk" never reaches the form as an invalid code. */
const briefTerritory = z
  .string()
  .trim()
  .toUpperCase()
  .transform((t) => TERRITORY_ALIASES[t] ?? t)
  .pipe(z.string().regex(/^(WORLD|[A-Z]{2})$/));

const modelBrief = z.object({
  name: z.string().min(1).max(80).optional(),
  commercial: z.boolean().optional(),
  territories: z.array(briefTerritory).min(1).max(30).optional(),
  termMonths: z.number().int().min(1).max(1200).optional(),
  budgetUsd: z.number().positive().max(10_000_000).optional(),
  mediums: z.array(z.string().min(1).max(20)).max(10).optional(),
  canCredit: z.boolean().optional(),
  needsSublicensing: z.boolean().optional(),
  requiresExclusive: z.boolean().optional(),
  assets: z.array(z.string().min(1).max(20)).max(12).optional(),
});

const SYSTEM = `You turn a short description of a creative project into licensing requirements. Reply with one JSON object and nothing else. Include only fields the description states or clearly implies; never guess.
Fields: name (string), commercial (boolean), territories (["WORLD"] or ISO 3166-1 alpha-2 codes), termMonths (integer months; 1200 for perpetual), budgetUsd (number), mediums (array of: web, print, broadcast, film, social, audio, app), canCredit (false only if the project cannot credit creators), needsSublicensing (true if it must sublicense or resell), requiresExclusive (true if it needs an exclusive licence), assets (array of: song, image, font, footage, voiceover, sfx).`;

/**
 * Ask the model to read the brief, validate its answer, and let it fill in or correct what the
 * rules of thumb found. A failed or invalid reply falls back to the local reading, never to a guess.
 */
export async function parseBrief(text: string, model?: ModelClient): Promise<BriefResult> {
  const local = parseBriefLocally(text);
  if (!model) return local;
  try {
    const raw = await model.complete({ system: SYSTEM, user: `Description:\n"""\n${text}\n"""` });
    const m = modelBrief.parse(readJsonObject(raw, ["name", "commercial", "territories", "termMonths", "budgetUsd", "assets"]));
    const project: Project = {
      ...local.project,
      name: m.name ?? local.project.name,
      commercial: m.commercial ?? local.project.commercial,
      territories: m.territories ?? local.project.territories,
      termMonths: m.termMonths ?? local.project.termMonths,
      budgetCents: m.budgetUsd !== undefined ? Math.round(m.budgetUsd * 100) : local.project.budgetCents,
      mediums: m.mediums ?? local.project.mediums,
      canCredit: m.canCredit === false ? false : local.project.canCredit,
      needsSublicensing: m.needsSublicensing ?? local.project.needsSublicensing,
      requiresExclusive: m.requiresExclusive ?? local.project.requiresExclusive,
    };
    return { ...local, project, requiredAssetIds: m.assets?.length ? [...new Set(m.assets)] : local.requiredAssetIds, source: "model" };
  } catch {
    return local;
  }
}
