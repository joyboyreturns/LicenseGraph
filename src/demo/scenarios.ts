import type { Project } from "../core/types";
import type { SourceDocument } from "../extraction/extract";
import { fixtures, podcastFixtures, trailerFixtures } from "./fixtures";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "./sample";

export interface Scenario {
  id: string;
  title: string;
  tagline: string;
  /** The plain-English brief this scenario is written from. */
  brief: string;
  project: Project;
  requiredAssetIds: string[];
  documents: SourceDocument[];
  /** Rules the first, price-only proposal is expected to trip. */
  showcases: string[];
}

const docs = (list: typeof fixtures) => list.map((f) => ({ ...f.doc }));

export const scenarios: Scenario[] = [
  {
    id: "documentary",
    title: "Documentary promo",
    tagline: "The cheapest photo is editorial-only.",
    brief: 'A US promo for our documentary "Harbour at Dawn", 12 months, under $1,000, with a song, an image and a font.',
    project: sampleProject,
    requiredAssetIds: sampleRequiredAssets,
    documents: sampleDocuments,
    showcases: ["commercial-use"],
  },
  {
    id: "game-trailer",
    title: "Game launch trailer",
    tagline: "Three rounds: territory, term, media and an expired offer.",
    brief: 'Launch trailer for our game "Neon Drift", worldwide, 24 months, for web, social and broadcast TV, budget $3,000, with music, key art and sound effects.',
    project: { name: "Neon Drift launch trailer", commercial: true, territories: ["WORLD"], termMonths: 24, budgetCents: 300_000, mediums: ["web", "social", "broadcast"] },
    requiredAssetIds: ["song", "image", "sfx"],
    documents: docs(trailerFixtures),
    showcases: ["territory", "term", "medium", "commercial-use", "expiry"],
  },
  {
    id: "podcast",
    title: "Podcast network",
    tagline: "No credit lines, partners need sublicensing, three-year term.",
    brief: 'Our podcast network "Signal & Noise" in the US and Canada, 3 years, audio and web, we can\'t give credit, must sublicense to syndication partners, budget $1,500: theme music, cover art and an intro voiceover.',
    project: { name: "Signal & Noise podcast network", commercial: true, territories: ["US", "CA"], termMonths: 36, budgetCents: 150_000, mediums: ["audio", "web"], canCredit: false, needsSublicensing: true },
    requiredAssetIds: ["song", "image", "voiceover"],
    documents: docs(podcastFixtures),
    showcases: ["attribution", "sublicensing", "territory", "term"],
  },
];

export const scenarioById = (id: string) => scenarios.find((s) => s.id === id);
