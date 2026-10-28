import { addMonths, isIsoDate } from "./dates";
import type { LicenseOffer } from "./types";

/**
 * When each licence in a bundle stops covering the project, worked out from the offer's own terms and the
 * day it was bought. Plain dates only, no model and no clock: the caller says what "bought" means.
 */
export interface LicenceEnd {
  offerId: string;
  assetId: string;
  /** Last day of cover (YYYY-MM-DD), or undefined for a perpetual licence. */
  endsOn?: string;
  perpetual: boolean;
}

/** The earlier of the term's end and a fixed end date, if the licence has both. */
export function licenceEnd(offer: LicenseOffer, boughtOn: string): LicenceEnd {
  const { termMonths, fixedEndDate } = offer.terms;
  const fixed = fixedEndDate && isIsoDate(fixedEndDate) ? fixedEndDate : undefined;
  const byTerm = termMonths === "perpetual" ? undefined : addMonths(boughtOn, termMonths);
  const ends = [byTerm, fixed].filter((d): d is string => d !== undefined).sort()[0];
  return { offerId: offer.id, assetId: offer.assetId, endsOn: ends, perpetual: ends === undefined && termMonths === "perpetual" };
}

export const licenceEnds = (offers: readonly LicenseOffer[], boughtOn: string): LicenceEnd[] =>
  offers.map((o) => licenceEnd(o, boughtOn)).sort((a, b) => (a.endsOn ?? "9999").localeCompare(b.endsOn ?? "9999") || a.offerId.localeCompare(b.offerId));

/** RFC 5545 text escaping. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines over 75 octets are folded with CRLF + space, never inside a multi-byte character. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const compact = (d: string) => d.replace(/-/g, "");
const nextDay = (d: string) => new Date(new Date(`${d}T00:00:00.000Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

export interface ReminderItem {
  uid: string;
  /** What to call the licence, e.g. "SoundHarbor Music, song". */
  label: string;
  endsOn: string;
}

/**
 * An iCalendar file with an all-day event on the last day of each licence and an alarm `leadDays` before it,
 * so a licence is renewed or replaced before the project is exposed. Perpetual licences have no event.
 * `stamp` (a UTC timestamp, YYYYMMDDTHHMMSSZ) is passed in so the same input always gives the same file.
 */
export function buildIcs(projectName: string, items: readonly ReminderItem[], stamp: string, leadDays = 30): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LicenseGraph//Licence dates//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const it of items) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${it.uid}@licensegraph`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(it.endsOn)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(it.endsOn))}`,
      `SUMMARY:${esc(`Licence ends: ${it.label}`)}`,
      `DESCRIPTION:${esc(`The licence for ${it.label} in "${projectName}" stops covering the project today. Renew or replace it before it ends.`)}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(`${it.label} ends in ${leadDays} days`)}`,
      `TRIGGER:-P${leadDays}D`,
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
