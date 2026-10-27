import { z } from "zod";
import type { Evidence, LicenseOffer } from "../core/types";
import type { ModelClient } from "./model";

export interface SourceDocument {
  id: string;
  assetId: string;
  text: string;
}

const FIELDS = ["price", "commercialUse", "territories", "term"] as const;

const modelOutput = z.object({
  priceCents: z.number().int().positive(),
  currency: z.string().length(3),
  commercialUse: z.boolean(),
  territories: z.array(z.string().min(2)).min(1),
  termMonths: z.union([z.number().int().positive(), z.literal("perpetual")]),
  evidence: z.array(z.object({ field: z.enum(FIELDS), quote: z.string().min(1) })),
});

export interface ExtractionResult {
  offer?: LicenseOffer;
  /** Why no offer was produced (or what was dropped). Empty on success. */
  problems: string[];
}

export const SYSTEM_PROMPT = `You extract licence terms from licence text. Reply with one JSON object and nothing else.
Fields:
- priceCents: integer price in the smallest currency unit
- currency: ISO 4217 code
- commercialUse: true only if the text clearly permits commercial use
- territories: ["WORLD"] or ISO 3166-1 alpha-2 country codes
- termMonths: integer months of validity, or "perpetual"
- evidence: for EACH of price, commercialUse, territories and term, one object {"field": "...", "quote": "..."} where quote is copied VERBATIM from the licence text.
Never invent a quote. If the text does not state a term, still answer with your best reading but quote the closest sentence.`;

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
    for (const field of FIELDS) {
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
        terms: { commercialUse: parsed.commercialUse, territories: parsed.territories, termMonths: parsed.termMonths },
        evidence,
      },
      problems: [],
    };
  }
  return { problems };
}
