import { buildIcs, licenceEnds, type LicenceEnd } from "@/src/core/renewals";
import type { Passport } from "@/src/passport/passport";
import { assetLabel } from "./format";

/** The day the licences were bought: the day the payment was captured, as recorded in the passport. */
export const boughtOn = (p: Passport) => p.issuedAt.slice(0, 10);

export interface LicenceDate extends LicenceEnd {
  label: string;
}

/** When each licence in a passport stops covering the project, soonest first. */
export function passportLicenceDates(p: Passport): LicenceDate[] {
  const licensor = new Map(p.documents.map((d) => [d.id, d.licensorName]));
  const byId = new Map(p.bundle.offers.map((o) => [o.id, o]));
  return licenceEnds(p.bundle.offers, boughtOn(p)).map((e) => {
    const who = licensor.get(byId.get(e.offerId)?.evidence[0]?.documentId ?? "");
    return { ...e, label: `${who ? `${who}, ` : ""}${assetLabel(e.assetId).toLowerCase()}` };
  });
}

/** An .ics file with a reminder 30 days before each licence that ends. */
export function passportCalendar(p: Passport): { ics: string; count: number } {
  const items = passportLicenceDates(p).flatMap((d) => (d.endsOn ? [{ uid: `${p.id}-${d.offerId}`, label: d.label, endsOn: d.endsOn }] : []));
  // The stamp is the capture time, so the same passport always gives the same file.
  const stamp = p.issuedAt.replace(/[-:]/g, "").replace(/\.\d+/, "").slice(0, 15) + "Z";
  return { ics: buildIcs(p.project.name, items, stamp), count: items.length };
}
