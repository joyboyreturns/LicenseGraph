import { z } from "zod";
import { offerSchema } from "../mcp/tools";
import type { LicenseOffer, Project } from "../core/types";
import type { SourceDocument } from "../extraction/extract";

export const licensorSubmission = z.object({
  name: z.string().trim().min(1).max(160),
  recipientEmail: z.email().max(254),
  identityEvidence: z.string().trim().min(20).max(50_000),
  rightsEvidence: z.string().trim().min(20).max(100_000),
  declaration: z.literal(true),
}).strict();
export type LicensorDetails = z.infer<typeof licensorSubmission>;
export interface RecipientSnapshot {
  licensorId: string; licensorVersion: number; offerId: string; offerVersion: number;
  assetId: string; licensorName: string; email: string; amountCents: number; currency: string;
}
export interface AuthorizationV3 {
  version: 3; runId: string; approvedBy: string; approvedAt: string;
  project: Project; requiredAssetIds: string[]; offers: LicenseOffer[];
  documents: SourceDocument[]; recipients: RecipientSnapshot[];
  releasePolicy: { days: 7; buyerAcceptance: true; disputesHold: true };
}
export interface PurchaseDetails {
  authorization: AuthorizationV3; authorizationDigest: string;
}
export const disputeSubmission = z.object({ reason: z.string().trim().min(10).max(10_000), evidence: z.string().trim().min(1).max(100_000) }).strict();

export const marketplaceOfferSchema = offerSchema.extend({ evidence: z.array(z.object({
  documentId: z.string().min(1).max(55), field: z.string().min(1).max(40), quote: z.string().min(1).max(2000),
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
}).strict()).min(1).max(20) }).strict();
