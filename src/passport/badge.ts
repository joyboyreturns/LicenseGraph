/**
 * A small status badge for a Licence Passport, in the flat two-part style used on repositories and sites.
 * The wording comes from the passport's own re-verification, so a badge never says more than the record proves.
 */

export interface BadgeInput {
  /** The passport re-checked end to end (hash chain, rules, quotes, payment records). */
  verified: boolean;
  licences: number;
  /** A reversed payment is shown as such, never as verified. */
  reversed?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Rough text width in px at 11px Verdana-like type, good enough to size the two halves. */
const width = (s: string) => Math.round(s.length * 6.4 + 14);

export function badgeText(b: BadgeInput): { label: string; message: string; colour: string } {
  const label = "LicenseGraph passport";
  if (b.reversed) return { label, message: "payment reversed", colour: "#b02417" };
  if (!b.verified) return { label, message: "check failed", colour: "#b02417" };
  return { label, message: `${b.licences} ${b.licences === 1 ? "licence" : "licences"} verified`, colour: "#1a7f4b" };
}

export function badgeSvg(b: BadgeInput): string {
  const { label, message, colour } = badgeText(b);
  const lw = width(label);
  const rw = width(message);
  const total = lw + rw;
  const title = `${label}: ${message}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="22" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${total}" height="22" rx="4" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="22" fill="#111318"/><rect x="${lw}" width="${rw}" height="22" fill="${colour}"/><rect width="${total}" height="22" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="15">${esc(label)}</text><text x="${lw + rw / 2}" y="15">${esc(message)}</text></g></svg>`;
}
