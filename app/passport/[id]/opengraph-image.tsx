import { ImageResponse } from "next/og";
import { issuePassport } from "@/src/passport/issue";
import { getRuntime } from "@/src/server/runtime";
import { formatMoney } from "@/src/ui/lib/format";

export const alt = "A Licence Passport: a verified, approved and paid licence bundle";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

/** The card shown when a passport link is shared: what was bought and that anyone can re-check it. Falls back to a plain card when the passport cannot be issued. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let line = "A verified, approved and paid licence bundle";
  let title = "Licence Passport";
  let facts: string[] = ["Every quote checked", "Rules re-run on the exact terms", "Payment and payouts matched"];
  try {
    const session = getRuntime().store.get(id);
    if (session) {
      const p = issuePassport(session);
      title = p.project.name;
      const n = p.bundle.offers.length;
      line = `${n} ${n === 1 ? "licence" : "licences"}, ${formatMoney(p.bundle.totalCents, p.bundle.currency)}, approved by ${p.approval.approvedBy}`;
      facts = [`${p.ledger.events.length} hash-chained events`, `${p.payouts?.lines.length ?? 0} creators paid`, p.paypal.environment === "sandbox" ? "PayPal Sandbox" : "Payment simulator"];
    }
  } catch {
    // Not paid yet, or not found: the plain card above.
  }
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f4f2ed", color: "#15171c", padding: "64px 72px", border: "14px solid #12a866" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "#12a866" }} />
          LicenseGraph · Licence Passport
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 80, lineHeight: 1.05, letterSpacing: -1.5 }}>{title}</div>
          <div style={{ fontSize: 34, color: "#5a6070" }}>{line}</div>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          {facts.map((f) => (
            <div key={f} style={{ display: "flex", padding: "14px 22px", borderRadius: 14, border: "2px solid #cdc8bd", background: "#ffffff", fontSize: 24 }}>
              {f}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
