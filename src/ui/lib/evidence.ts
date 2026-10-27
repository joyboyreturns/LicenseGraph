/**
 * Split licence text into plain and highlighted segments from evidence offsets. Handles overlapping
 * quotes, offsets outside the text, missing offsets (falls back to finding the quote) and offsets
 * that no longer match the quote. Pure; used by the evidence viewer.
 */

export interface HighlightRange {
  /** Stable id for the range, e.g. the evidence field. */
  id: string;
  start?: number;
  end?: number;
  /** The quoted text, used to place a range whose offsets are missing or wrong. */
  quote?: string;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
  /** Ids of every range covering this segment, in input order. Empty for plain text. */
  marks: string[];
}

export interface Placement {
  id: string;
  start: number;
  end: number;
  /** "offsets": recorded offsets were used; "search": the quote was found by searching. */
  via: "offsets" | "search";
}

export interface SegmentResult {
  segments: Segment[];
  placed: Placement[];
  /** Ranges that could not be placed in the text at all. */
  unplaced: string[];
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Find `quote` in `text` ignoring differences in whitespace; returns offsets into the original text. */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const q = collapse(quote);
  if (!q) return null;
  let collapsed = "";
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const space = /\s/.test(ch);
    if (space && prevSpace) continue;
    collapsed += space ? " " : ch;
    map.push(i);
    prevSpace = space;
  }
  const at = collapsed.indexOf(q);
  if (at === -1) return null;
  return { start: map[at]!, end: map[at + q.length - 1]! + 1 };
}

const isOffset = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function place(text: string, r: HighlightRange): Placement | null {
  const len = text.length;
  if (isOffset(r.start) && isOffset(r.end)) {
    const start = Math.max(0, Math.min(len, Math.floor(r.start)));
    const end = Math.max(0, Math.min(len, Math.ceil(r.end)));
    if (start < end) {
      const matches = r.quote === undefined || collapse(text.slice(start, end)) === collapse(r.quote);
      if (matches) return { id: r.id, start, end, via: "offsets" };
      // The offsets point somewhere else; trust the quote if it exists in the text.
      const found = findQuote(text, r.quote ?? "");
      if (found) return { id: r.id, ...found, via: "search" };
      return { id: r.id, start, end, via: "offsets" };
    }
  }
  const found = r.quote ? findQuote(text, r.quote) : null;
  return found ? { id: r.id, ...found, via: "search" } : null;
}

export function segmentText(text: string, ranges: readonly HighlightRange[]): SegmentResult {
  const placed: Placement[] = [];
  const unplaced: string[] = [];
  for (const r of ranges) {
    const p = place(text, r);
    if (p) placed.push(p);
    else unplaced.push(r.id);
  }
  if (text.length === 0) return { segments: [], placed, unplaced };

  const cuts = new Set<number>([0, text.length]);
  for (const p of placed) {
    cuts.add(p.start);
    cuts.add(p.end);
  }
  const points = [...cuts].sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (start === end) continue;
    const marks = placed.filter((p) => p.start <= start && p.end >= end).map((p) => p.id);
    const last = segments.at(-1);
    if (last && last.end === start && sameMarks(last.marks, marks)) {
      last.end = end;
      last.text = text.slice(last.start, end);
    } else {
      segments.push({ start, end, text: text.slice(start, end), marks: [...new Set(marks)] });
    }
  }
  return { segments, placed, unplaced };
}

function sameMarks(a: string[], b: string[]): boolean {
  if (a.length !== new Set(b).size) return false;
  return b.every((x) => a.includes(x));
}
