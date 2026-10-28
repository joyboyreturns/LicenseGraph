"use client";

import { UserCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import { api, errorMessage } from "@/src/ui/lib/api";
import { Spinner } from "../bits";

/**
 * The page behind an agent's claim link. It only reads the run until the person clicks: link previews
 * and crawlers load this page without being able to take the run over.
 */
export function ClaimRun({ id, token }: { id: string; token: string }) {
  const router = useRouter();
  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SessionView>(`/api/sessions/${encodeURIComponent(id)}`)
      .then(setView)
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  async function take() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/sessions/${encodeURIComponent(id)}/claim`, { method: "POST", json: { token } });
      router.push(`/run/${encodeURIComponent(id)}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ paddingTop: "clamp(28px, 5vw, 56px)", maxWidth: 640 }}>
      <p className="eyebrow">Agent request</p>
      <h1 className="display" style={{ fontSize: "clamp(34px, 4.5vw, 52px)", marginTop: 10 }}>
        An agent started a purchase for you
      </h1>
      <p style={{ marginTop: 14, fontSize: 17, color: "var(--ink-2)" }}>
        The agent can look for licences and check them against your rules, but it cannot approve or pay. Taking control makes this run yours: you will see exactly what it found, and nothing is bought unless you approve it.
      </p>
      {view && (
        <div className="card" style={{ marginTop: 20, padding: 18 }}>
          <p className="eyebrow">Project</p>
          <p style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{view.project.name}</p>
          <p className="small muted" style={{ marginTop: 4 }}>
            {view.documents.length} licence {view.documents.length === 1 ? "document" : "documents"} · status: {view.phase.replace(/_/g, " ")}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="small" style={{ marginTop: 14, color: "var(--bad)" }}>
          {error}
        </p>
      )}
      <div className="row" style={{ marginTop: 20 }}>
        <button type="button" className="btn btn-lg btn-primary" onClick={take} disabled={busy || !token || !view?.awaitingPerson}>
          {busy ? <Spinner label="Taking control" /> : <UserCheck aria-hidden />} Take control of this run
        </button>
      </div>
      {view && !view.awaitingPerson && <p className="small muted" style={{ marginTop: 12 }}>This run is not waiting for anyone to take control. If you already did, open it from your runs.</p>}
    </div>
  );
}
