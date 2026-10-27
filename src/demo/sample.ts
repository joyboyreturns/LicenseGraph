import type { Project } from "../core/types";
import type { SourceDocument } from "../extraction/extract";
import { fixtures } from "./fixtures";

const doc = (id: string) => fixtures.find((f) => f.doc.id === id)!.doc;

/**
 * A scenario where the cheapest option is wrong: the editorial photo costs least but forbids
 * commercial use, so the first proposal is rejected and the revision picks the archive image.
 */
export const sampleProject: Project = {
  name: "Harbour documentary promo",
  commercial: true,
  territories: ["US"],
  termMonths: 12,
  budgetCents: 100_000,
};

export const sampleRequiredAssets = ["song", "image", "font"];

export const sampleDocuments: SourceDocument[] = [
  doc("song"),
  { ...doc("photo"), assetId: "image" },
  { ...doc("archive"), assetId: "image" },
  doc("font"),
];
