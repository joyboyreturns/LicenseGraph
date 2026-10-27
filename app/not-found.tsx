import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="container" style={{ paddingTop: "clamp(56px, 12vh, 140px)", paddingBottom: 40 }}>
      <p className="eyebrow">404</p>
      <h1 className="display" style={{ fontSize: "clamp(44px, 6vw, 80px)", marginTop: 12, maxWidth: "14ch" }}>
        No licence covers this page.
      </h1>
      <p style={{ marginTop: 16, fontSize: 17, color: "var(--ink-2)", maxWidth: "56ch" }}>The address may be mistyped, or the page has moved. Runs and passports are stored by the server that created them.</p>
      <div className="row" style={{ marginTop: 28 }}>
        <Link prefetch={false} href="/" className="btn btn-primary btn-lg">
          Go home
        </Link>
        <Link prefetch={false} href="/dashboard" className="btn btn-lg">
          Portfolio
        </Link>
        <Link prefetch={false} href="/verify" className="btn btn-lg btn-ghost">
          Verify a passport
        </Link>
      </div>
    </div>
  );
}
