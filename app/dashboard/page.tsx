"use client";

import { ArrowLeft, ArrowRight, History, LayoutGrid, Radio } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SessionView } from "@/src/app-logic/session";
import type { RunSummary } from "@/src/ui/components/home/types";
import { formatMoney, phaseInfo, pluralise, relativeTime } from "@/src/ui/lib/format";
import styles from "./dashboard.module.css";

// AG Studio draws into the DOM, so it only runs in the browser.
const Studio = dynamic(() => import("./studio"), {
  ssr: false,
  loading: () => (
    <div className={styles.loading} aria-busy="true">
      <div className="skeleton" style={{ height: "100%", borderRadius: 12 }} />
    </div>
  ),
});

function Dashboard() {
  const params = useSearchParams();
  const id = params.get("session");
  const portfolioMode = Boolean(params.get("portfolio"));
  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assistant, setAssistant] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setAssistant(Boolean(c.assistant)))
      .catch(() => setAssistant(false));
  }, []);

  useEffect(() => {
    if (!id) return;
    document.title = "Run dashboard · LicenseGraph";
    fetch(`/api/sessions/${id}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? "Could not load the session"))))
      .then(setView)
      .catch((e) => setError(e.message));
  }, [id]);

  if (portfolioMode) return <PortfolioStudio assistant={assistant} />;
  if (!id) return <Portfolio />;

  return (
    <div className={styles.studioPage}>
      <div className={styles.context}>
        <Link prefetch={false} href={`/run/${id}`} className="btn btn-sm btn-ghost">
          <ArrowLeft aria-hidden /> Back to the run
        </Link>
        {view && (
          <>
            <span className={styles.contextName} title={view.project.name}>
              {view.project.name}
            </span>
            <span className={`chip chip-sm tone-${phaseInfo(view.phase).tone}`}>{phaseInfo(view.phase).label}</span>
          </>
        )}
        {assistant === false && view && <span className={styles.contextNote}>Assistant needs live mode</span>}
      </div>
      {error && (
        <div className="container" style={{ paddingTop: 32 }}>
          <p className="callout tone-bad" role="alert">
            {error}
          </p>
          <Link prefetch={false} href="/dashboard" className="btn" style={{ marginTop: 16 }}>
            <LayoutGrid aria-hidden /> All runs
          </Link>
        </div>
      )}
      {view && assistant !== null && (
        <div className={styles.studio}>
          <Studio view={view} assistant={assistant} />
        </div>
      )}
      {view && assistant === false && <p className={`container ${styles.assistantNote}`}>The AI assistant needs live mode (a gateway key and a free model); demo mode shows the dashboard only.</p>}
    </div>
  );
}

function PortfolioStudio({ assistant }: { assistant: boolean | null }) {
  const [views, setViews] = useState<SessionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = "Portfolio dashboard · LicenseGraph";
    fetch("/api/portfolio")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load the runs."))))
      .then((d: { views: SessionView[] }) => setViews(d.views))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className={styles.studioPage}>
      <div className={styles.context}>
        <Link prefetch={false} href="/dashboard" className="btn btn-sm btn-ghost">
          <ArrowLeft aria-hidden /> All runs
        </Link>
        <span className={styles.contextName}>Portfolio dashboard</span>
        {views && <span className="chip chip-sm">{pluralise(views.length, "run")}</span>}
        {assistant === false && <span className={styles.contextNote}>Assistant needs a gateway key</span>}
      </div>
      {error && (
        <div className="container" style={{ paddingTop: 32 }}>
          <p className="callout tone-bad" role="alert">
            {error}
          </p>
        </div>
      )}
      {views && views.length === 0 && (
        <div className="container" style={{ paddingTop: 32 }}>
          <p className="callout">There are no runs yet. Run a scenario first, then come back to see them across projects.</p>
          <Link prefetch={false} href="/" className="btn btn-primary" style={{ marginTop: 16 }}>
            Run a scenario <ArrowRight aria-hidden />
          </Link>
        </div>
      )}
      {views && views.length > 0 && assistant !== null && (
        <div className={styles.studio}>
          <Studio portfolio={views} assistant={assistant} />
        </div>
      )}
    </div>
  );
}

function Portfolio() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    document.title = "Portfolio · LicenseGraph";
    setNow(Date.now());
    fetch("/api/sessions")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load the runs."))))
      .then((d: { runs: RunSummary[] }) => setRuns(d.runs))
      .catch((e: Error) => setError(e.message));
  }, []);

  const paid = runs?.filter((r) => r.paid) ?? [];
  const verified = runs?.filter((r) => r.totalCents !== undefined) ?? [];
  const blocked = runs?.reduce((n, r) => n + r.blocked, 0) ?? 0;
  const currency = paid[0]?.currency ?? verified[0]?.currency ?? "USD";
  const paidTotal = paid.filter((r) => (r.currency ?? "USD") === currency).reduce((n, r) => n + (r.totalCents ?? 0), 0);

  return (
    <div className="container-wide" style={{ paddingTop: "clamp(28px, 4vw, 48px)" }}>
      <div className={styles.head}>
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1 className={styles.title}>Every run on this server</h1>
          <p className={styles.lead}>Open a run to replay it, or open its AG Studio dashboard to explore offers, violations and the ledger as linked tables.</p>
        </div>
        <div className={styles.headActions}>
          {runs && runs.length > 0 && (
            <Link prefetch={false} href="/dashboard?portfolio=1" className="btn">
              <LayoutGrid aria-hidden /> Open portfolio dashboard
            </Link>
          )}
          <Link prefetch={false} href="/" className="btn btn-primary">
            Start a new run <ArrowRight aria-hidden />
          </Link>
        </div>
      </div>

      {error && (
        <p className="callout tone-bad" role="alert">
          {error}
        </p>
      )}

      {runs && runs.length > 0 && (
        <dl className={styles.kpis}>
          <div>
            <dt>Runs</dt>
            <dd className="num">{runs.length}</dd>
          </div>
          <div>
            <dt>Verified bundles</dt>
            <dd className="num">{verified.length}</dd>
          </div>
          <div>
            <dt>Paid{paid.some((r) => r.currency && r.currency !== currency) ? ` (${currency})` : ""}</dt>
            <dd className="num">{formatMoney(paidTotal, currency)}</dd>
          </div>
          <div>
            <dt>Unusable cheapest picks caught</dt>
            <dd className="num">{blocked}</dd>
          </div>
        </dl>
      )}

      {!runs && !error && <div className="skeleton" style={{ height: 320, borderRadius: 14 }} />}
      {runs && runs.length === 0 && (
        <div className={`card ${styles.emptyCard}`}>
          <p className={styles.emptyTitle}>No runs yet</p>
          <p className="muted">Run a scenario from the home page and it will appear here.</p>
          <Link prefetch={false} href="/#scenarios" className="btn btn-primary" style={{ marginTop: 12 }}>
            Choose a scenario
          </Link>
        </div>
      )}
      {runs && runs.length > 0 && (
        <div className={`card ${styles.tableCard}`}>
          <div className="table-scroll">
            <table className={`table ${styles.table}`}>
              <caption className="visually-hidden">All runs, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Status</th>
                  <th scope="col">Rounds</th>
                  <th scope="col" className="right">
                    Price-only
                  </th>
                  <th scope="col" className="right">
                    Verified bundle
                  </th>
                  <th scope="col">Caught</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const p = phaseInfo(r.phase);
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link prefetch={false} href={`/run/${r.id}`} className={styles.name}>
                          {r.name}
                        </Link>
                        <div className={styles.sub}>
                          {r.runKind === "live" ? <Radio aria-hidden /> : <History aria-hidden />}
                          {r.runKind === "live" ? "Live model" : "Replayed scenario"} · {relativeTime(r.createdAt, now)}
                          {r.revisedFrom && (
                            <>
                              {" · "}
                              <Link prefetch={false} href={`/run/${r.revisedFrom}`}>
                                revision of an earlier run
                              </Link>
                            </>
                          )}
                          {r.rebriefedFrom && (
                            <>
                              {" · "}
                              <Link prefetch={false} href={`/run/${r.rebriefedFrom}`}>
                                brief changed from an earlier run
                              </Link>
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`chip chip-sm tone-${p.tone}`}>{p.label}</span>
                      </td>
                      <td className="num">{r.rounds ?? "—"}</td>
                      <td className="right num muted">{r.naiveTotalCents !== undefined ? formatMoney(r.naiveTotalCents, r.currency ?? "USD") : "—"}</td>
                      <td className="right num" style={{ fontWeight: 650 }}>
                        {r.totalCents !== undefined ? formatMoney(r.totalCents, r.currency) : "—"}
                      </td>
                      <td>{r.blocked ? <span className="chip chip-sm tone-bad">{pluralise(r.blocked, "unusable licence")}</span> : <span className="muted">—</span>}</td>
                      <td className={styles.actions}>
                        <Link prefetch={false} href={`/run/${r.id}`} className="btn btn-sm">
                          Open run
                        </Link>
                        <Link prefetch={false} href={`/dashboard?session=${r.id}`} className="btn btn-sm btn-ghost">
                          <LayoutGrid aria-hidden /> Dashboard
                        </Link>
                        {r.paid ? (
                          <Link prefetch={false} href={`/passport/${r.id}`} className="btn btn-sm btn-ghost">
                            Passport
                          </Link>
                        ) : (
                          <span className="btn btn-sm btn-ghost" aria-hidden style={{ visibility: "hidden" }}>
                            Passport
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
