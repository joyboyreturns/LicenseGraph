import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "@/src/ui/components/Providers";
import { SiteFooter } from "@/src/ui/components/SiteFooter";
import { SiteHeader } from "@/src/ui/components/SiteHeader";
import { themeBootScript } from "@/src/ui/components/ThemeToggle";
import "./globals.css";

// Self-hosted fonts (no runtime font fetches): Hanken Grotesk for the interface, Instrument Serif for
// display type, JetBrains Mono for hashes, ids and the rules engine's voice.
const sans = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2", weight: "100 900", style: "normal" },
    { path: "../node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-sans",
  display: "swap",
});
const serif = localFont({
  src: [
    { path: "../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
});
const mono = localFont({
  src: [{ path: "../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2", weight: "100 800", style: "normal" }],
  variable: "--font-mono",
  display: "swap",
});

const appUrl = (() => {
  try {
    return new URL(process.env.APP_URL ?? "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
})();

const description = "An AI agent reads every licence and proposes the cheapest bundle. A deterministic rules engine verifies it. You approve. PayPal pays the creators. Then anyone can re-verify the Licence Passport.";

export const metadata: Metadata = {
  metadataBase: appUrl,
  title: { default: "LicenseGraph: verified licence bundles, creators paid", template: "%s · LicenseGraph" },
  description,
  applicationName: "LicenseGraph",
  openGraph: {
    type: "website",
    siteName: "LicenseGraph",
    title: "LicenseGraph: AI moves at machine speed. Creator rights and payments should too.",
    description,
  },
  twitter: { card: "summary_large_image", title: "LicenseGraph", description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f2ed" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c10" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <Providers>
          <SiteHeader />
          <main id="main" tabIndex={-1} style={{ outline: "none" }}>
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
