import { ImageResponse } from "next/og";

export const alt = "LicenseGraph: AI moves at machine speed. Creator rights and payments should too.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STEPS = [
  { label: "Read", note: "AI agent" },
  { label: "Verify", note: "Rules engine" },
  { label: "Approve", note: "A person" },
  { label: "Pay", note: "PayPal" },
];

/** The card shown when a link to the site is shared: the pitch, and the four steps with who does each. */
export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f4f2ed", color: "#15171c", padding: "64px 72px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "#12a866" }} />
          LicenseGraph
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 76, lineHeight: 1.05, letterSpacing: -1.5 }}>
          <div>AI moves at machine speed.</div>
          <div style={{ color: "#5a6070" }}>Creator rights and payments should too.</div>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          {STEPS.map((s, i) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", flex: 1, padding: "18px 22px", borderRadius: 16, border: "2px solid #cdc8bd", background: "#ffffff" }}>
              <div style={{ fontSize: 26, fontWeight: 700 }}>
                {`${i + 1}. ${s.label}`}
              </div>
              <div style={{ fontSize: 22, color: "#5a6070" }}>{s.note}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
