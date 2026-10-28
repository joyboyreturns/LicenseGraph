/**
 * The what-if panel's choices as a link, so one scenario can be sent to someone and opened exactly as it was.
 * Only the choices that differ from the brief are written, and anything read back is checked: a link is input
 * from outside, so a bad one is ignored rather than trusted.
 */

export interface WhatIfState {
  commercial: boolean;
  territories: string[];
  termMonths: number;
  mediums: string[];
  cannotCredit: boolean;
  sublicensing: boolean;
  exclusive: boolean;
}

export const WHATIF_PARAM = "whatif";
const MEDIA = new Set(["web", "social", "broadcast", "print", "audio", "film", "app"]);
const PLACE = /^(WORLD|[A-Z]{2})$/;

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** The differences from the brief as a short string, or undefined when nothing differs. */
export function encodeWhatIf(state: WhatIfState, brief: WhatIfState): string | undefined {
  const diff: Partial<WhatIfState> = {};
  if (state.commercial !== brief.commercial) diff.commercial = state.commercial;
  if (!same(state.territories, brief.territories)) diff.territories = state.territories;
  if (state.termMonths !== brief.termMonths) diff.termMonths = state.termMonths;
  if (!same(state.mediums, brief.mediums)) diff.mediums = state.mediums;
  if (state.cannotCredit !== brief.cannotCredit) diff.cannotCredit = state.cannotCredit;
  if (state.sublicensing !== brief.sublicensing) diff.sublicensing = state.sublicensing;
  if (state.exclusive !== brief.exclusive) diff.exclusive = state.exclusive;
  return Object.keys(diff).length ? JSON.stringify(diff) : undefined;
}

const isStrings = (v: unknown, ok: (s: string) => boolean, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && ok(x));

/** The state a link describes, applied on top of the brief. Anything invalid in the link is left as the brief has it. */
export function decodeWhatIf(raw: string | null | undefined, brief: WhatIfState): WhatIfState {
  if (!raw || raw.length > 2000) return brief;
  let diff: unknown;
  try {
    diff = JSON.parse(raw);
  } catch {
    return brief;
  }
  if (typeof diff !== "object" || diff === null || Array.isArray(diff)) return brief;
  const d = diff as Record<string, unknown>;
  const next = { ...brief, territories: [...brief.territories], mediums: [...brief.mediums] };
  if (typeof d.commercial === "boolean") next.commercial = d.commercial;
  if (isStrings(d.territories, (s) => PLACE.test(s), 250) && d.territories.length) next.territories = [...new Set(d.territories)];
  if (typeof d.termMonths === "number" && Number.isInteger(d.termMonths) && d.termMonths >= 1 && d.termMonths <= 1200) next.termMonths = d.termMonths;
  if (isStrings(d.mediums, (s) => MEDIA.has(s), MEDIA.size)) next.mediums = [...new Set(d.mediums)];
  if (typeof d.cannotCredit === "boolean") next.cannotCredit = d.cannotCredit;
  if (typeof d.sublicensing === "boolean") next.sublicensing = d.sublicensing;
  if (typeof d.exclusive === "boolean") next.exclusive = d.exclusive;
  return next;
}
