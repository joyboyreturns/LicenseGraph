import { licenceEnd } from "../core/renewals";
import type { LicenseOffer } from "../core/types";
import type { Passport } from "./passport";

/**
 * A cell that a spreadsheet could read as a formula (it starts with = + - @ or a control character) gets a leading
 * apostrophe, so a licensor's name can never run anything when the file is opened. Everything is quoted.
 */
const cell = (value: string | number | undefined): string => {
  const text = value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

const termsText = (o: LicenseOffer) => {
  const t = o.terms;
  return [t.commercialUse ? "commercial" : "non-commercial", t.territories.join("/"), t.termMonths === "perpetual" ? "perpetual" : `${t.termMonths} months`, t.mediums ? (t.mediums === "ALL" ? "any medium" : t.mediums.join("/")) : "media not stated"].join("; ");
};

const COLUMNS = ["Passport", "Project", "Asset", "Licensor", "Terms", "Price", "Currency", "Bought on", "Ends on", "Payout status", "PayPal capture", "Environment"];

/**
 * The licences in a passport as a spreadsheet, one row per licence: what was bought, from whom, on what terms, for how
 * much, when it ends, and whether the creator was paid. For whoever keeps the books; the passport itself stays the record.
 */
export function passportCsv(p: Passport): string {
  const licensor = new Map(p.documents.map((d) => [d.id, d.licensorName]));
  const payout = new Map((p.payouts?.lines ?? []).map((l) => [l.assetId, l.status]));
  const bought = p.issuedAt.slice(0, 10);
  const rows = p.bundle.offers.map((o) => {
    const end = licenceEnd(o, bought);
    return [p.id, p.project.name, o.assetId, licensor.get(o.evidence[0]?.documentId ?? "") ?? "", termsText(o), (o.priceCents / 100).toFixed(2), o.currency, bought, end.perpetual ? "perpetual" : (end.endsOn ?? ""), payout.get(o.assetId) ?? "", p.paypal.captureId, p.paypal.environment];
  });
  return [COLUMNS, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
