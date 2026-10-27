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

/** Build a fixture from a few readable fields; the licence text and the quotes come from the same lines. */
function licence(o: {
  id: string;
  assetId: string;
  licensor: string;
  title: string;
  priceUsd: number;
  use: string;
  territory: string;
  term: string;
  media?: string;
  credit?: string;
  sublicensing?: string;
  exclusivity?: string;
  validUntil?: string;
  terms: LicenseTerms;
}): Fixture {
  const lines: [string, string | undefined][] = [
    ["price", `Price: USD ${o.priceUsd.toFixed(2)}.`],
    ["commercialUse", `Use: ${o.use}`],
    ["territories", `Territory: ${o.territory}`],
    ["term", `Term: ${o.term}`],
    ["mediums", o.media && `Media: ${o.media}`],
    ["attribution", o.credit && `Credit: ${o.credit}`],
    ["sublicensing", o.sublicensing && `Sublicensing: ${o.sublicensing}`],
    ["exclusivity", o.exclusivity && `Exclusivity: ${o.exclusivity}`],
    ["offerValidUntil", o.validUntil],
  ];
  const present = lines.filter((l): l is [string, string] => Boolean(l[1]));
  return {
    doc: {
      id: o.id,
      assetId: o.assetId,
      licensor: { name: o.licensor, email: `${o.licensor.toLowerCase().replace(/[^a-z0-9]+/g, "")}@licensegraph-demo.example` },
      text: [o.title.toUpperCase(), ...present.map(([, line]) => line)].join("\n"),
    },
    expected: { priceCents: Math.round(o.priceUsd * 100), currency: "USD", terms: o.terms },
    quotes: Object.fromEntries(present.map(([field, line]) => [field, line])),
  };
}

const WORLD = ["WORLD"];

/** Scenario 2: a game trailer. The cheap offers break territory, term, media and validity rules. */
export const trailerFixtures: Fixture[] = [
  licence({ id: "trailer-song-indie", assetId: "song", licensor: "Pixel Hymns", title: "Pixel Hymns indie starter licence", priceUsd: 150, use: "Commercial use is permitted.", territory: "United States and Canada only.", term: "12 months from purchase.", media: "Websites only.", terms: { commercialUse: true, territories: ["US", "CA"], termMonths: 12, mediums: ["web"] } }),
  licence({ id: "trailer-song-studio", assetId: "song", licensor: "Pixel Hymns", title: "Pixel Hymns studio standard licence", priceUsd: 900, use: "Commercial use is permitted.", territory: "Worldwide.", term: "24 months from purchase.", media: "Websites and social media.", terms: { commercialUse: true, territories: WORLD, termMonths: 24, mediums: ["web", "social"] } }),
  licence({ id: "trailer-song-pro", assetId: "song", licensor: "Pixel Hymns", title: "Pixel Hymns broadcast pro licence", priceUsd: 1600, use: "Commercial use is permitted.", territory: "Worldwide.", term: "36 months from purchase.", media: "Websites, social media and broadcast television.", terms: { commercialUse: true, territories: WORLD, termMonths: 36, mediums: ["web", "social", "broadcast"] } }),
  licence({ id: "trailer-art-personal", assetId: "image", licensor: "Vector Orchard", title: "Vector Orchard personal licence", priceUsd: 40, use: "Personal and non-commercial use only.", territory: "Worldwide.", term: "Perpetual.", media: "Any medium.", terms: { commercialUse: false, territories: WORLD, termMonths: "perpetual", mediums: "ALL" } }),
  licence({ id: "trailer-art-print", assetId: "image", licensor: "Vector Orchard", title: "Vector Orchard commercial print licence", priceUsd: 220, use: "Commercial use is permitted.", territory: "Worldwide.", term: "Perpetual.", media: "Print only.", terms: { commercialUse: true, territories: WORLD, termMonths: "perpetual", mediums: ["print"] } }),
  licence({ id: "trailer-art-all", assetId: "image", licensor: "Vector Orchard", title: "Vector Orchard all-media licence", priceUsd: 480, use: "Commercial use is permitted.", territory: "Worldwide.", term: "Perpetual.", media: "Any medium.", terms: { commercialUse: true, territories: WORLD, termMonths: "perpetual", mediums: "ALL" } }),
  licence({ id: "trailer-sfx-sale", assetId: "sfx", licensor: "Boomline Audio", title: "Boomline launch sale licence", priceUsd: 30, use: "Commercial use is permitted.", territory: "Worldwide.", term: "Perpetual.", media: "Any medium.", validUntil: "This offer is valid until 1 October 2026.", terms: { commercialUse: true, territories: WORLD, termMonths: "perpetual", mediums: "ALL", offerValidUntil: "2026-10-01" } }),
  licence({ id: "trailer-sfx-std", assetId: "sfx", licensor: "Boomline Audio", title: "Boomline standard licence", priceUsd: 90, use: "Commercial use is permitted.", territory: "Worldwide.", term: "Perpetual.", media: "Any medium.", terms: { commercialUse: true, territories: WORLD, termMonths: "perpetual", mediums: "ALL" } }),
];

/** Scenario 3: a podcast network. Credit lines, sublicensing, short terms and regions decide it. */
export const podcastFixtures: Fixture[] = [
  licence({ id: "pod-song-basic", assetId: "song", licensor: "Tapeloop", title: "Tapeloop podcast basic licence", priceUsd: 60, use: "Commercial use is permitted.", territory: "United States and Canada.", term: "36 months from purchase.", media: "Audio and websites.", credit: "The Licensee must credit Tapeloop in the show notes of every episode.", sublicensing: "The Licensee may not sublicense the track.", terms: { commercialUse: true, territories: ["US", "CA"], termMonths: 36, mediums: ["audio", "web"], attributionRequired: true, sublicensing: false } }),
  licence({ id: "pod-song-network", assetId: "song", licensor: "Tapeloop", title: "Tapeloop network licence", priceUsd: 340, use: "Commercial use is permitted.", territory: "United States and Canada.", term: "36 months from purchase.", media: "Audio and websites.", credit: "No credit is required.", sublicensing: "The Licensee may sublicense the track to syndication partners.", terms: { commercialUse: true, territories: ["US", "CA"], termMonths: 36, mediums: ["audio", "web"], attributionRequired: false, sublicensing: true } }),
  licence({ id: "pod-art-editorial", assetId: "image", licensor: "Greyscale Lane", title: "Greyscale Lane editorial image licence", priceUsd: 25, use: "Commercial use is permitted.", territory: "United States only.", term: "Perpetual.", media: "Any medium.", credit: "No credit is required.", sublicensing: "The Licensee may sublicense the image to partners.", terms: { commercialUse: true, territories: ["US"], termMonths: "perpetual", mediums: "ALL", attributionRequired: false, sublicensing: true } }),
  licence({ id: "pod-art-network", assetId: "image", licensor: "Greyscale Lane", title: "Greyscale Lane network cover art licence", priceUsd: 140, use: "Commercial use is permitted.", territory: "United States and Canada.", term: "Perpetual.", media: "Any medium.", credit: "No credit is required.", sublicensing: "The Licensee may sublicense the image to partners.", terms: { commercialUse: true, territories: ["US", "CA"], termMonths: "perpetual", mediums: "ALL", attributionRequired: false, sublicensing: true } }),
  licence({ id: "pod-voice-short", assetId: "voiceover", licensor: "Marlow Voice", title: "Marlow Voice intro licence, one year", priceUsd: 95, use: "Commercial use is permitted.", territory: "United States and Canada.", term: "12 months from purchase.", media: "Audio and websites.", credit: "No credit is required.", sublicensing: "The Licensee may sublicense the recording to partners.", terms: { commercialUse: true, territories: ["US", "CA"], termMonths: 12, mediums: ["audio", "web"], attributionRequired: false, sublicensing: true } }),
  licence({ id: "pod-voice-long", assetId: "voiceover", licensor: "Marlow Voice", title: "Marlow Voice intro licence, three years", priceUsd: 210, use: "Commercial use is permitted.", territory: "United States and Canada.", term: "36 months from purchase.", media: "Audio and websites.", credit: "No credit is required.", sublicensing: "The Licensee may sublicense the recording to partners.", terms: { commercialUse: true, territories: ["US", "CA"], termMonths: 36, mediums: ["audio", "web"], attributionRequired: false, sublicensing: true } }),
];

fixtures.push(...trailerFixtures, ...podcastFixtures);

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
