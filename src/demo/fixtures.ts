import type { LicenseTerms } from "../core/types";
import type { SourceDocument } from "../extraction/extract";

export interface Fixture {
  doc: SourceDocument;
  expected: { priceCents: number; currency: string; terms: LicenseTerms };
  /** Verbatim sentences a correct extraction would quote, by evidence field. */
  quotes: Record<string, string>;
}

/** Optional terms a correct extraction leaves blank when the text is silent. */
export const OPTIONAL_TERM_KEYS = ["mediums", "attributionRequired", "sublicensing", "exclusive", "fixedEndDate", "offerValidUntil"] as const;

export const fixtures: Fixture[] = [
  {
    doc: {
      id: "song",
      assetId: "song",
      licensor: { name: "SoundHarbor Music", email: "soundharbor@licensegraph-demo.example" },
      text: `SOUNDHARBOR TRACK LICENCE
Track: "Morning Tide"
Licence fee: USD 200.00.
Grant: The Licensee may use the Track in commercial productions, including advertising and paid distribution.
Territory: Worldwide.
Term: This licence is valid for 24 months from the date of purchase.`,
    },
    expected: { priceCents: 20_000, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: 24 } },
    quotes: {
      price: "Licence fee: USD 200.00.",
      commercialUse: "The Licensee may use the Track in commercial productions, including advertising and paid distribution.",
      territories: "Territory: Worldwide.",
      term: "This licence is valid for 24 months from the date of purchase.",
    },
  },
  {
    doc: {
      id: "photo",
      assetId: "photo",
      licensor: { name: "PixelLeaf Images", email: "pixelleaf@licensegraph-demo.example" },
      text: `PIXELLEAF IMAGE LICENCE (EDITORIAL)
Image: "Harbour at Dawn"
Price: USD 45.00 per image.
Use: Editorial and personal use only.
Commercial use, advertising and merchandise are not permitted.
Territory: Worldwide.
Term: Perpetual.`,
    },
    expected: { priceCents: 4_500, currency: "USD", terms: { commercialUse: false, territories: ["WORLD"], termMonths: "perpetual" } },
    quotes: {
      price: "Price: USD 45.00 per image.",
      commercialUse: "Commercial use, advertising and merchandise are not permitted.",
      territories: "Territory: Worldwide.",
      term: "Term: Perpetual.",
    },
  },
  {
    doc: {
      id: "font",
      assetId: "font",
      licensor: { name: "TypeForge Studio", email: "typeforge@licensegraph-demo.example" },
      text: `TYPEFORGE DESKTOP AND WEB FONT LICENCE
Family: Lumen Sans
Fee: USD 49.00, one-time.
Permitted use: Personal and commercial projects, print and digital.
Territory: Worldwide.
Duration: The licence never expires (perpetual).`,
    },
    expected: { priceCents: 4_900, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: "perpetual" } },
    quotes: {
      price: "Fee: USD 49.00, one-time.",
      commercialUse: "Permitted use: Personal and commercial projects, print and digital.",
      territories: "Territory: Worldwide.",
      term: "The licence never expires (perpetual).",
    },
  },
  {
    doc: {
      id: "footage",
      assetId: "footage",
      licensor: { name: "NorthReel Footage", email: "northreel@licensegraph-demo.example" },
      text: `NORTHREEL STOCK FOOTAGE LICENCE
Clip: "City Timelapse 4K"
Price: USD 350.00.
The Licensee may use the clip in commercial
works distributed in the United States
and Canada only.
Licence period: 12 months from purchase.`,
    },
    expected: { priceCents: 35_000, currency: "USD", terms: { commercialUse: true, territories: ["US", "CA"], termMonths: 12 } },
    quotes: {
      price: "Price: USD 350.00.",
      commercialUse: "The Licensee may use the clip in commercial works distributed in the United States and Canada only.",
      territories: "distributed in the United States and Canada only.",
      term: "Licence period: 12 months from purchase.",
    },
  },
  {
    doc: {
      id: "voiceover",
      assetId: "voiceover",
      licensor: { name: "Studio Reed", email: "studioreed@licensegraph-demo.example" },
      text: `STUDIOREED VOICEOVER LICENCE
Recording: "Welcome Aboard" narration
Price: USD 120.00.
Use: Commercial use is permitted.
Media: Web and broadcast television only.
Territory: Worldwide.
Term: 12 months from purchase.
Credit: The Licensee must credit "Voice by Studio Reed" wherever the recording is used.
Sublicensing: The Licensee may not sublicense the recording.
Exclusivity: This licence is exclusive to the Licensee for the term.
This offer is valid until 30 November 2026.`,
    },
    expected: {
      priceCents: 12_000,
      currency: "USD",
      terms: {
        commercialUse: true,
        territories: ["WORLD"],
        termMonths: 12,
        mediums: ["web", "broadcast"],
        attributionRequired: true,
        sublicensing: false,
        exclusive: true,
        offerValidUntil: "2026-11-30",
      },
    },
    quotes: {
      price: "Price: USD 120.00.",
      commercialUse: "Use: Commercial use is permitted.",
      territories: "Territory: Worldwide.",
      term: "Term: 12 months from purchase.",
      mediums: "Media: Web and broadcast television only.",
      attribution: 'Credit: The Licensee must credit "Voice by Studio Reed" wherever the recording is used.',
      sublicensing: "Sublicensing: The Licensee may not sublicense the recording.",
      exclusivity: "Exclusivity: This licence is exclusive to the Licensee for the term.",
      offerValidUntil: "This offer is valid until 30 November 2026.",
    },
  },
  {
    doc: {
      id: "archive",
      assetId: "archive",
      licensor: { name: "HistoryVault Archive", email: "historyvault@licensegraph-demo.example" },
      text: `HISTORYVAULT ARCHIVE IMAGE LICENCE
Image: "Dockside, 1932"
Price: USD 80.00.
Use: Commercial and editorial use is permitted in any medium.
Territory: Worldwide.
Term: 24 months from purchase, and in any case ending on 31 December 2027.
No credit line is required.
The Licensee may sublicense the image to its clients.
This licence is non-exclusive.`,
    },
    expected: {
      priceCents: 8_000,
      currency: "USD",
      terms: {
        commercialUse: true,
        territories: ["WORLD"],
        termMonths: 24,
        mediums: "ALL",
        attributionRequired: false,
        sublicensing: true,
        exclusive: false,
        fixedEndDate: "2027-12-31",
      },
    },
    quotes: {
      price: "Price: USD 80.00.",
      commercialUse: "Use: Commercial and editorial use is permitted in any medium.",
      territories: "Territory: Worldwide.",
      term: "Term: 24 months from purchase, and in any case ending on 31 December 2027.",
      mediums: "Use: Commercial and editorial use is permitted in any medium.",
      attribution: "No credit line is required.",
      sublicensing: "The Licensee may sublicense the image to its clients.",
      exclusivity: "This licence is non-exclusive.",
      fixedEndDate: "ending on 31 December 2027.",
    },
  },
];

/** What a well-behaved model would answer for a fixture. */
export function cannedReply(f: Fixture): string {
  const t = f.expected.terms;
  return JSON.stringify({
    priceCents: f.expected.priceCents,
    currency: f.expected.currency,
    commercialUse: t.commercialUse,
    territories: t.territories,
    termMonths: t.termMonths,
    mediums: t.mediums ?? null,
    attributionRequired: t.attributionRequired ?? null,
    sublicensing: t.sublicensing ?? null,
    exclusive: t.exclusive ?? null,
    fixedEndDate: t.fixedEndDate ?? null,
    offerValidUntil: t.offerValidUntil ?? null,
    evidence: Object.entries(f.quotes).map(([field, quote]) => ({ field, quote })),
  });
}
