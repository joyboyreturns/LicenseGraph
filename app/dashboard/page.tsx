"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SessionView } from "@/src/app-logic/session";

// AG Studio draws into the DOM, so it only runs in the browser.
const Studio = dynamic(() => import("./studio"), { ssr: false, loading: () => <p className="muted" style={{ padding: 16 }}>Loading dashboard…</p> });

function Dashboard() {
  const id = useSearchParams().get("session");
  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/sessions/${id}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? "Could not load the session"))))
      .then(setView)
      .catch((e) => setError(e.message));
  }, [id]);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
        <strong>LicenseGraph dashboard</strong>
        {view && <span className="chip ok">{view.project.name}</span>}
        <span style={{ flex: 1 }} />
        <Link href={id ? `/?session=${id}` : "/"}>Back to the run</Link>
      </div>
      {!id && <p className="muted" style={{ padding: 16 }}>Open a run first, then choose Dashboard.</p>}
      {error && <div className="error" style={{ margin: 16 }}>{error}</div>}
      {view && <Studio view={view} />}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
