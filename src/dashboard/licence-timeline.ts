import { isIsoDate } from "../core/dates";

/**
 * The pure half of the "licence timeline" widget: licences as bars from the day they were bought to the day
 * they stop covering the project, on one shared time axis. Studio supplies the rows; this lays them out.
 */

export interface TimelineInput {
  label: unknown;
  start: unknown;
  /** An ISO date, or anything else (such as "Perpetual") for a licence with no end. */
  end: unknown;
}

export type Urgency = "ended" | "soon" | "later" | "perpetual";

export interface TimelineBar {
  label: string;
  start: string;
  end?: string;
  perpetual: boolean;
  /** 0..100 along the axis. A perpetual bar runs to 100. */
  startPct: number;
  endPct: number;
  urgency: Urgency;
  /** Whole days from today to the end; negative once it has ended. Absent for a perpetual licence. */
  daysLeft?: number;
}

export interface Timeline {
  bars: TimelineBar[];
  axisStart: string;
  axisEnd: string;
  /** Where today falls on the axis. The axis always reaches today, so a stale licence is never drawn without a "now". */
  todayPct: number;
  /** Year starts inside the axis, for tick marks. */
  ticks: { label: string; pct: number }[];
}

const DAY = 86_400_000;
const day = (d: string) => Math.floor(new Date(`${d}T00:00:00.000Z`).getTime() / DAY);
const iso = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const text = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));

/** Licences ending within this many days are flagged, the same lead time as the calendar reminder. */
export const SOON_DAYS = 90;

export function buildTimeline(rows: readonly TimelineInput[], today: string): Timeline | undefined {
  const dated = rows.flatMap((r) => {
    const start = text(r.start);
    if (!isIsoDate(start)) return [];
    const end = text(r.end);
    return [{ label: text(r.label) || "Licence", start, end: isIsoDate(end) ? end : undefined }];
  });
  if (!dated.length || !isIsoDate(today)) return undefined;

  const t = day(today);
  const finite = dated.flatMap((d) => [day(d.start), ...(d.end ? [day(d.end)] : [])]);
  const lo = Math.min(...finite, t);
  // A short axis needs room to read: always at least a year, and a margin past the last end for a perpetual bar's arrow.
  const hi = Math.max(...finite, t);
  const span = Math.max(hi - lo, 365);
  const axisEnd = lo + span + Math.ceil(span * 0.04);
  const width = axisEnd - lo;
  const pct = (n: number) => Math.round(((n - lo) / width) * 1000) / 10;

  const bars = dated
    .map((d): TimelineBar => {
      const s = day(d.start);
      const e = d.end ? day(d.end) : undefined;
      const daysLeft = e === undefined ? undefined : e - t;
      const urgency: Urgency = e === undefined ? "perpetual" : daysLeft! < 0 ? "ended" : daysLeft! <= SOON_DAYS ? "soon" : "later";
      return { label: d.label, start: d.start, end: d.end, perpetual: e === undefined, startPct: pct(s), endPct: e === undefined ? 100 : pct(e), urgency, daysLeft };
    })
    // Soonest end first, then perpetual ones; the same label never moves between runs of the same data.
    .sort((a, b) => (a.end ?? "9999").localeCompare(b.end ?? "9999") || a.label.localeCompare(b.label));

  const ticks: Timeline["ticks"] = [];
  for (let y = new Date(`${iso(lo)}T00:00:00Z`).getUTCFullYear() + 1; ; y++) {
    const n = day(`${y}-01-01`);
    if (n >= axisEnd) break;
    ticks.push({ label: String(y), pct: pct(n) });
  }
  return { bars, axisStart: iso(lo), axisEnd: iso(axisEnd), todayPct: pct(t), ticks };
}
