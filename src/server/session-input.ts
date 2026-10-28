import { z } from "zod";
import { isIsoDate } from "../core/dates";
import { supportsCentCurrency } from "../core/money";

/** The body of POST /api/sessions for a run on the caller's own licences. Shared with the OpenAPI document. */
const MAX_DOCS = 12;
const MAX_TEXT = 20_000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const textId = z.string().trim().min(1).max(55);
/** The body of POST /api/sessions/{id}/revise: one licensor's revised licence, or (demo scenarios) their simulated replies. */
export const reviseInputSchema = z.union([
  z.object({ simulate: z.literal(true) }),
  z.object({
    assetId: textId,
    text: z.string().min(1).max(MAX_TEXT),
    licensor: z.object({ name: z.string().trim().min(1).max(80), email: z.string().max(127).regex(EMAIL).optional() }).optional(),
  }),
]);
export const sessionInputSchema = z.object({
  project: z.object({
    name: z.string().trim().min(1).max(120),
    commercial: z.boolean(),
    territories: z.array(z.string().trim().toUpperCase().regex(/^(WORLD|[A-Z]{2})$/)).min(1).max(250),
    termMonths: z.number().int().safe().positive().max(1200),
    budgetCents: z.number().int().safe().nonnegative().optional(),
    currency: z.string().refine(supportsCentCurrency, "Unsupported settlement currency").optional(),
    mediums: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional(),
    canCredit: z.boolean().optional(),
    needsSublicensing: z.boolean().optional(),
    requiresExclusive: z.boolean().optional(),
    endDate: z.string().refine(isIsoDate, "Expected a real calendar date").optional(),
  }),
  requiredAssetIds: z.array(textId).min(1).max(MAX_DOCS),
  documents: z.array(z.object({
    id: textId, assetId: textId,
    text: z.string().min(1).max(MAX_TEXT),
    licensor: z.object({ name: z.string().trim().min(1).max(80), email: z.string().max(127).regex(EMAIL).optional() }).optional(),
  })).min(1).max(MAX_DOCS),
  brief: z.string().max(2000).optional(),
});
