"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="container" style={{ paddingTop: "clamp(56px, 12vh, 140px)", paddingBottom: 40 }} role="alert">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="display" style={{ fontSize: "clamp(40px, 5.4vw, 72px)", marginTop: 12, maxWidth: "16ch" }}>
        This page hit an unexpected error.
      </h1>
      <p style={{ marginTop: 16, fontSize: 17, color: "var(--ink-2)", maxWidth: "58ch" }}>
        No payment or approval happens without a confirmed server response, so nothing was changed by this error. Try again, or start from the home page.
      </p>
      {error.digest && (
        <p className="mono small muted" style={{ marginTop: 10 }}>
          Reference {error.digest}
        </p>
      )}
      <div className="row" style={{ marginTop: 28 }}>
        <button type="button" className="btn btn-primary btn-lg" onClick={reset}>
          Try again
        </button>
        <Link prefetch={false} href="/" className="btn btn-lg">
          Go home
        </Link>
      </div>
    </div>
  );
}
