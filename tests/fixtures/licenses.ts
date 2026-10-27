import type { LicenseTerms } from "../../src/core/types";
import type { SourceDocument } from "../../src/extraction/extract";

export interface Fixture {
  doc: SourceDocument;
  expected: { priceCents: number; currency: string; terms: LicenseTerms };
  /** Verbatim sentences a correct extraction would quote. */
  quotes: { price: string; commercialUse: string; territories: string; term: string };
}

export const fixtures: Fixture[] = [
  {
    doc: {
      id: "song",
      assetId: "song",
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
];

/** What a well-behaved model would answer for a fixture. */
export function cannedReply(f: Fixture): string {
  return JSON.stringify({
    priceCents: f.expected.priceCents,
    currency: f.expected.currency,
    commercialUse: f.expected.terms.commercialUse,
    territories: f.expected.terms.territories,
    termMonths: f.expected.terms.termMonths,
    evidence: (Object.keys(f.quotes) as (keyof Fixture["quotes"])[]).map((field) => ({ field, quote: f.quotes[field] })),
  });
}
