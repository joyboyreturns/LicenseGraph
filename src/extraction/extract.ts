import { z } from "zod";
import type { Evidence, LicenseOffer, LicenseTerms } from "../core/types";
import type { ModelClient } from "./model";

export interface SourceDocument {
  id: string;
  assetId: string;
  text: string;
}

/** Terms every licence must state; each needs evidence. */
const CORE_FIELDS = ["price", "commercialUse", "territories", "term"] as const;
/** Terms captured only when the text states them; each stated value needs evidence. */
const OPTIONAL_FIELDS = ["mediums", "attribution", "sublicensing", "exclusivity", "fixedEndDate", "offerValidUntil"] as const;
const FIELDS = [...CORE_FIELDS, ...OPTIONAL_FIELDS] as const;

/** Models sometimes label evidence with the JSON key instead of the evidence field name. */
const FIELD_ALIASES: Record<string, string> = {
  termmonths: "term",
  pricecents: "price",
  attributionrequired: "attribution",
  exclusive: "exclusivity",
};
const evidenceField = z.preprocess((v) => (typeof v === "string" ? (FIELD_ALIASES[v.trim().toLowerCase()] ?? v.trim()) : v), z.enum(FIELDS));

/** "ALL" (or ["ALL"]) means any medium; otherwise a lowercase list. */
function normaliseMediums(v: string | string[] | null | undefined): string[] | "ALL" | null | undefined {
  if (v == null) return v;
  const list = (Array.isArray(v) ? v : [v]).map((m) => m.trim().toLowerCase());
  return list.includes("all") ? "ALL" : list;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const modelOutput = z.object({
  priceCents: z.number().int().positive(),
  currency: z.string().length(3),
  commercialUse: z.boolean(),
  territories: z.array(z.string().min(2)).min(1),
  termMonths: z.union([z.number().int().positive(), z.literal("perpetual")]),
  // null (or absent) means the text does not state it.
  mediums: z
    .union([z.array(z.string().min(1)).min(1), z.string().min(1)])
    .nullish()
    .transform(normaliseMediums),
  attributionRequired: z.boolean().nullish(),
  sublicensing: z.boolean().nullish(),
  exclusive: z.boolean().nullish(),
  fixedEndDate: isoDate.nullish(),
  offerValidUntil: isoDate.nullish(),
  evidence: z.array(z.object({ field: evidenceField, quote: z.string().min(1) })),
});

type ModelOutput = z.infer<typeof modelOutput>;

/** Optional terms the model stated, and the evidence field that must back each one. */
function statedOptionalTerms(out: ModelOutput): { evidenceField: (typeof OPTIONAL_FIELDS)[number]; terms: Partial<LicenseTerms> }[] {
  const stated: { evidenceField: (typeof OPTIONAL_FIELDS)[number]; terms: Partial<LicenseTerms> }[] = [];
  if (out.mediums != null) stated.push({ evidenceField: "mediums", terms: { mediums: out.mediums } });
  if (out.attributionRequired != null) stated.push({ evidenceField: "attribution", terms: { attributionRequired: out.attributionRequired } });
  if (out.sublicensing != null) stated.push({ evidenceField: "sublicensing", terms: { sublicensing: out.sublicensing } });
  if (out.exclusive != null) stated.push({ evidenceField: "exclusivity", terms: { exclusive: out.exclusive } });
  if (out.fixedEndDate != null) stated.push({ evidenceField: "fixedEndDate", terms: { fixedEndDate: out.fixedEndDate } });
  if (out.offerValidUntil != null) stated.push({ evidenceField: "offerValidUntil", terms: { offerValidUntil: out.offerValidUntil } });
  return stated;
}

export interface ExtractionResult {
  offer?: LicenseOffer;
  /** Why no offer was produced (or what was dropped). Empty on success. */
  problems: string[];
}

export const SYSTEM_PROMPT = `You extract licence terms from licence text. Reply with one JSON object and nothing else.
Always include:
- priceCents: integer price in the smallest currency unit
- currency: ISO 4217 code
- commercialUse: true only if the text clearly permits commercial use
- territories: ["WORLD"] or ISO 3166-1 alpha-2 country codes
- termMonths: integer months of validity, or "perpetual"
Include these only if the text states them; otherwise use null. Never guess:
- mediums: array using only "web", "print", "broadcast", "film", "social", "audio", "app", or "ALL" if any medium is allowed
- attributionRequired: true if the Licensee must credit the creator, false if credit is explicitly not required
- sublicensing: true if sublicensing is permitted, false if it is prohibited
- exclusive: true if the licence is exclusive to the Licensee, false if it is non-exclusive
- fixedEndDate: "YYYY-MM-DD" if the licence ends on a stated calendar date
- offerValidUntil: "YYYY-MM-DD" if the offer can only be bought until a stated date
- evidence: one object {"field": "...", "quote": "..."} for each of price, commercialUse, territories and term, plus one for every optional term you filled in (use exactly these field names: price, commercialUse, territories, term, mediums, attribution, sublicensing, exclusivity, fixedEndDate, offerValidUntil). Each quote is copied VERBATIM from the licence text.
Never invent a quote. If the text does not state a core term, still answer with your best reading but quote the closest sentence.`;

export function buildPrompt(doc: SourceDocument): string {
  return `Licence text:\n"""\n${doc.text}\n"""`;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Find a quote in the source, tolerating whitespace and line-wrap differences. Returns source offsets. */
export function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  const q = collapse(quote);
  if (!q) return null;
  // Map each character of the whitespace-collapsed text back to its index in the original.
  let collapsed = "";
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < text.length; i++) {
    const isSpace = /\s/.test(text[i]!);
    if (isSpace && prevSpace) continue;
    collapsed += isSpace ? " " : text[i];
    map.push(i);
    prevSpace = isSpace;
  }
  const at = collapsed.indexOf(q);
  if (at === -1) return null;
  return { start: map[at]!, end: map[at + q.length - 1]! + 1 };
}

function parseJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model reply");
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * Ask the model for a document's terms, then check them. The model proposes; this function
 * only accepts quotes that really appear in the source, so an invented quote can never
 * reach the rules engine as evidence.
 */
export async function extractOffer(model: ModelClient, doc: SourceDocument, options: { attempts?: number } = {}): Promise<ExtractionResult> {
  const attempts = options.attempts ?? 2;
  let problems: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const hint = problems.length ? `\n\nYour previous reply was rejected: ${problems.join("; ")}. Fix this and reply with the JSON object only.` : "";
    let parsed: z.infer<typeof modelOutput>;
    try {
      const raw = await model.complete({ system: SYSTEM_PROMPT, user: buildPrompt(doc) + hint });
      parsed = modelOutput.parse(parseJson(raw));
    } catch (e) {
      problems = [`reply was not valid: ${e instanceof Error ? e.message : String(e)}`];
      continue;
    }

    const evidence: Evidence[] = [];
    problems = [];
    const optional = statedOptionalTerms(parsed);
    const required = [...CORE_FIELDS, ...optional.map((o) => o.evidenceField)];
    for (const field of required) {
      const quotes = parsed.evidence.filter((e) => e.field === field);
      if (quotes.length === 0) problems.push(`missing evidence for ${field}`);
      for (const { quote } of quotes) {
        const where = locateQuote(doc.text, quote);
        if (where) evidence.push({ documentId: doc.id, field, quote, ...where });
        else problems.push(`quote for ${field} not found in the document: "${quote.slice(0, 60)}"`);
      }
    }
    if (problems.length) continue;

    return {
      offer: {
        id: `offer-${doc.id}`,
        assetId: doc.assetId,
        priceCents: parsed.priceCents,
        currency: parsed.currency.toUpperCase(),
        terms: {
          commercialUse: parsed.commercialUse,
          territories: parsed.territories,
          termMonths: parsed.termMonths,
          ...Object.assign({}, ...optional.map((o) => o.terms)),
        },
        evidence,
      },
      problems: [],
    };
  }
  return { problems };
}
