/**
 * Presentation helpers: money, licence terms, dates and identifiers in plain language.
 * Pure and browser-safe. Nothing here decides anything; it only describes data.
 */
import type { LicenseTerms, Project } from "@/src/core/types";

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, trim: boolean): Intl.NumberFormat | undefined {
  const key = `${currency}|${trim}`;
  const cached = moneyFormatters.get(key);
  if (cached) return cached;
  try {
    const f = new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: trim ? 0 : undefined, maximumFractionDigits: trim ? 0 : undefined });
    moneyFormatters.set(key, f);
    return f;
  } catch {
    return undefined;
  }
}

/**
 * Integer cents to a currency string. `trim` drops ".00" for whole amounts (graph labels) but keeps
 * real cents. An unknown currency code falls back to "12.34 XYZ" instead of throwing.
 */
export function formatMoney(cents: number | undefined | null, currency = "USD", options: { trim?: boolean } = {}): string {
  if (cents === undefined || cents === null || !Number.isFinite(cents)) return "—";
  const code = (currency || "USD").toUpperCase();
  const whole = Number.isInteger(cents / 100);
  const f = moneyFormatter(code, Boolean(options.trim && whole));
  if (!f) return `${(cents / 100).toFixed(2)} ${code}`;
  return f.format(cents / 100);
}

export const NOT_STATED = "Not stated";

export function termText(termMonths: LicenseTerms["termMonths"] | undefined, short = false): string {
  if (termMonths === undefined) return NOT_STATED;
  if (termMonths === "perpetual") return "Perpetual";
  if (!Number.isFinite(termMonths)) return NOT_STATED;
  if (short) return `${termMonths} mo`;
  return `${termMonths} ${termMonths === 1 ? "month" : "months"}`;
}

let regionNames: Intl.DisplayNames | null | undefined;
function regionName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** ["WORLD"] → "Worldwide"; ["US","CA"] → "United States, Canada" (or "US, CA" when short). */
export function territoriesText(territories: readonly string[] | undefined, short = false): string {
  if (!territories || territories.length === 0) return NOT_STATED;
  if (territories.includes("WORLD")) return "Worldwide";
  if (territories.length > 6) return `${territories.length} territories`;
  return territories.map((t) => (short ? t.toUpperCase() : regionName(t.toUpperCase()))).join(", ");
}

const MEDIUM_NAMES: Record<string, string> = { web: "Web", print: "Print", broadcast: "Broadcast TV", film: "Film", social: "Social", audio: "Audio", app: "Apps & games" };
export const mediumName = (m: string) => MEDIUM_NAMES[m.toLowerCase()] ?? capitalise(m);

export function mediumsText(mediums: LicenseTerms["mediums"]): string {
  if (mediums === undefined) return NOT_STATED;
  if (mediums === "ALL") return "Any medium";
  if (mediums.length === 0) return "None";
  return mediums.map(mediumName).join(", ");
}

export function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "2026-10-01" → "1 Oct 2026". Anything unparseable is returned as is. */
export function dateText(iso: string | undefined): string {
  if (!iso) return NOT_STATED;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** A timestamp as "27 Oct 2026, 14:05" in the viewer's zone. */
export function dateTimeText(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Milliseconds as "0.4 s", "12 s", "3 min 05 s", "2 h 10 min". */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

export function shortHash(hash: string | undefined, length = 10): string {
  if (!hash) return "—";
  return hash.length <= length ? hash : `${hash.slice(0, length)}…`;
}

export type TermKey = "price" | "commercialUse" | "territories" | "term" | "mediums" | "attribution" | "sublicensing" | "exclusivity" | "fixedEndDate" | "offerValidUntil";

export interface TermLine {
  key: TermKey;
  label: string;
  value: string;
  /** The licence is silent on this term. */
  stated: boolean;
}

/** Every term a licence can state, in reading order, with "Not stated" for the gaps. */
export function termLines(terms: LicenseTerms, priceCents?: number, currency?: string): TermLine[] {
  const yesNo = (v: boolean | undefined, yes: string, no: string) => (v === undefined ? NOT_STATED : v ? yes : no);
  const lines: TermLine[] = [];
  if (priceCents !== undefined) lines.push({ key: "price", label: "Price", value: formatMoney(priceCents, currency), stated: true });
  lines.push(
    { key: "commercialUse", label: "Commercial use", value: terms.commercialUse ? "Allowed" : "Not allowed", stated: true },
    { key: "territories", label: "Territory", value: territoriesText(terms.territories), stated: terms.territories.length > 0 },
    { key: "term", label: "Term", value: termText(terms.termMonths), stated: true },
    { key: "mediums", label: "Media", value: mediumsText(terms.mediums), stated: terms.mediums !== undefined },
    { key: "attribution", label: "Credit", value: yesNo(terms.attributionRequired, "Credit required", "No credit required"), stated: terms.attributionRequired !== undefined },
    { key: "sublicensing", label: "Sublicensing", value: yesNo(terms.sublicensing, "Allowed", "Not allowed"), stated: terms.sublicensing !== undefined },
    { key: "exclusivity", label: "Exclusivity", value: yesNo(terms.exclusive, "Exclusive", "Non-exclusive"), stated: terms.exclusive !== undefined },
  );
  if (terms.fixedEndDate) lines.push({ key: "fixedEndDate", label: "Ends on", value: dateText(terms.fixedEndDate), stated: true });
  lines.push({ key: "offerValidUntil", label: "Offer valid until", value: terms.offerValidUntil ? dateText(terms.offerValidUntil) : NOT_STATED, stated: Boolean(terms.offerValidUntil) });
  return lines;
}

/** A compact one-line description for tables: "Commercial · Worldwide · 24 months · Web, Social". */
export function termsSummary(terms: LicenseTerms): string {
  const parts = [terms.commercialUse ? "Commercial" : "Non-commercial", territoriesText(terms.territories), termText(terms.termMonths)];
  if (terms.mediums !== undefined) parts.push(mediumsText(terms.mediums));
  if (terms.attributionRequired !== undefined) parts.push(terms.attributionRequired ? "Credit required" : "No credit");
  if (terms.sublicensing !== undefined) parts.push(terms.sublicensing ? "Sublicensable" : "No sublicensing");
  if (terms.exclusive !== undefined) parts.push(terms.exclusive ? "Exclusive" : "Non-exclusive");
  if (terms.fixedEndDate) parts.push(`Ends ${dateText(terms.fixedEndDate)}`);
  return parts.join(" · ");
}

/** Short tags for a graph node: territory, term and media. */
export function termTags(terms: LicenseTerms): string[] {
  const tags = [territoriesText(terms.territories, true), termText(terms.termMonths, true)];
  if (terms.mediums === "ALL") tags.push("Any media");
  else if (terms.mediums) tags.push(terms.mediums.map((m) => mediumName(m).replace(" TV", "")).join("/"));
  if (!terms.commercialUse) tags.unshift("Non-comm.");
  return tags;
}

export interface Requirement {
  key: string;
  label: string;
  value: string;
}

/** What the project asks for, as the rules engine will check it. Only declared constraints appear. */
export function projectRequirements(p: Project, currency = "USD"): Requirement[] {
  const out: Requirement[] = [
    { key: "commercial", label: "Use", value: p.commercial ? "Commercial" : "Non-commercial" },
    { key: "territory", label: "Territory", value: territoriesText(p.territories) },
    { key: "term", label: "Term", value: termText(p.termMonths) },
  ];
  if (p.mediums?.length) out.push({ key: "media", label: "Media", value: p.mediums.map(mediumName).join(", ") });
  if (p.budgetCents !== undefined) out.push({ key: "budget", label: "Budget", value: formatMoney(p.budgetCents, currency, { trim: true }) });
  if (p.canCredit === false) out.push({ key: "credit", label: "Credit", value: "Cannot credit creators" });
  if (p.needsSublicensing) out.push({ key: "sublicensing", label: "Sublicensing", value: "Required" });
  if (p.requiresExclusive) out.push({ key: "exclusive", label: "Exclusivity", value: "Required" });
  if (p.endDate) out.push({ key: "endDate", label: "Needed until", value: dateText(p.endDate) });
  return out;
}

const ASSET_LABELS: Record<string, string> = {
  song: "Song",
  music: "Music",
  image: "Image",
  photo: "Photo",
  font: "Font",
  footage: "Footage",
  voiceover: "Voiceover",
  sfx: "Sound effects",
  archive: "Archive image",
};

/** "sfx" → "Sound effects", "key-art" → "Key art". */
export function assetLabel(assetId: string): string {
  const known = ASSET_LABELS[assetId.toLowerCase()];
  if (known) return known;
  return capitalise(assetId.replace(/[-_]+/g, " ").trim()) || assetId;
}

/** Lower-case asset noun for sentences: "song", "sound effects". */
export const assetNoun = (assetId: string) => assetLabel(assetId).toLowerCase();

/**
 * A licence document's display title from its first line. All-caps headings are put in sentence
 * case, and a leading licensor name is dropped when it repeats the licensor ("Pixel Hymns indie
 * starter licence" → "Indie starter licence").
 */
export function docTitle(text: string, licensorName?: string): string {
  const first = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  if (!first) return "Licence";
  let title = first.length > 90 ? `${first.slice(0, 88)}…` : first;
  if (title === title.toUpperCase() && /[A-Z]/.test(title)) title = capitalise(title.toLowerCase());
  if (licensorName) {
    const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const words = title.split(/\s+/);
    const lic = licensorName.trim().split(/\s+/);
    outer: for (let n = Math.min(words.length - 1, 4); n >= 1; n--) {
      const head = squash(words.slice(0, n).join(""));
      if (head === squash(licensorName)) {
        title = capitalise(words.slice(n).join(" "));
        break;
      }
      // "Soundharbor track licence" with licensor "SoundHarbor Music": restore the brand's casing.
      for (let k = 1; k < lic.length; k++) {
        if (head === squash(lic.slice(0, k).join(""))) {
          title = [...lic.slice(0, k), ...words.slice(n)].join(" ");
          break outer;
        }
      }
    }
  }
  return capitalise(title);
}

export type Tone = "neutral" | "agent" | "engine" | "ok" | "bad" | "warn" | "info";

const PHASES: Record<string, { label: string; tone: Tone }> = {
  created: { label: "Queued", tone: "neutral" },
  extracting: { label: "Reading licences", tone: "agent" },
  proposing: { label: "Agent proposing", tone: "agent" },
  verified: { label: "Verified, awaiting approval", tone: "ok" },
  failed: { label: "No compliant bundle", tone: "bad" },
  approved: { label: "Approved", tone: "ok" },
  order_created: { label: "Awaiting buyer approval", tone: "info" },
  captured: { label: "Payment captured", tone: "ok" },
  settled: { label: "Settled", tone: "ok" },
  refunded: { label: "Refunded", tone: "warn" },
};

export function phaseInfo(phase: string): { label: string; tone: Tone } {
  return PHASES[phase] ?? { label: capitalise(phase.replace(/_/g, " ")), tone: "neutral" };
}

export function runKindLabel(runKind: string | undefined): { label: string; long: string } {
  if (runKind === "live") return { label: "Live model run", long: "A live model read these licences and proposed each bundle." };
  return { label: "Replay of recorded model output", long: "Built-in scenario: the model's recorded answers are replayed, so the run is instant and repeatable. The rules engine still runs live." };
}

/** True for ids made by the local payment simulator rather than PayPal Sandbox. */
export const isSimulatedId = (id: string | undefined) => Boolean(id && /^SIM/i.test(id));

const PAYOUT_FINAL = new Set(["SUCCESS", "DENIED", "CANCELED", "FAILED", "PARTIAL", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED"]);
/** A payout batch or line status that will not change again. */
export const isPayoutFinal = (status: string | undefined) => Boolean(status && PAYOUT_FINAL.has(status.toUpperCase()));

export function payoutTone(status: string): Tone {
  const s = status.toUpperCase();
  if (s === "SUCCESS") return "ok";
  if (s === "FAILED" || s === "DENIED" || s === "CANCELED" || s === "RETURNED" || s === "BLOCKED" || s === "PARTIAL" || s === "REFUNDED" || s === "REVERSED") return "bad";
  if (s === "UNCLAIMED" || s === "ONHOLD") return "warn";
  return "info";
}

export const pluralise = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
