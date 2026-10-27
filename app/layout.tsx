import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LicenseGraph",
  description: "Verified licence bundles: the agent proposes, the rules engine verifies, you approve, PayPal settles.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
