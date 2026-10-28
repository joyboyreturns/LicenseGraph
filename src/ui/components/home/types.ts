import type { Project } from "@/src/core/types";

export interface ScenarioInfo {
  id: string;
  title: string;
  tagline: string;
  brief: string;
  project: Project;
  requiredAssetIds: string[];
  showcases: string[];
  documents: { id: string; assetId: string; text: string; licensorName?: string }[];
}

export interface RunSummary {
  id: string;
  createdAt: string;
  name: string;
  phase: string;
  runKind?: string;
  scenarioId?: string;
  /** The run this one answers, when a licensor's revised licence was added. */
  revisedFrom?: string;
  /** The run whose brief this one changed. */
  rebriefedFrom?: string;
  rounds?: number;
  totalCents?: number;
  currency?: string;
  naiveTotalCents?: number;
  blocked: number;
  paid: boolean;
}
