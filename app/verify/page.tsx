import type { Metadata } from "next";
import { VerifyClient } from "@/src/ui/components/passport/VerifyClient";

export const metadata: Metadata = {
  title: "Verify a Licence Passport",
  description: "Check a downloaded Licence Passport entirely in your browser: hash chain, rules engine, quotes and payment records. Nothing is uploaded.",
};

export default function Page() {
  return (
    <div className="container" style={{ paddingTop: "clamp(28px, 5vw, 56px)" }}>
      <div style={{ maxWidth: 760, marginBottom: 28 }}>
        <p className="eyebrow">Verify</p>
        <h1 className="display" style={{ fontSize: "clamp(40px, 5vw, 64px)", marginTop: 10 }}>
          Check a Licence Passport yourself
        </h1>
        <p style={{ marginTop: 14, fontSize: 17, color: "var(--ink-2)", maxWidth: "62ch" }}>
          Everything runs in this browser with the same open-source code the server uses. The file is never uploaded, and the result does not depend on trusting this site.
        </p>
      </div>
      <VerifyClient />
    </div>
  );
}
