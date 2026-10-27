"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import type { LicenseOffer, LicenseTerms, Violation } from "@/src/core/types";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "@/src/demo/sample";

interface Config {
  mode: "demo" | "live";
  model?: string;
  paymentsEnabled: boolean;
}

interface DocField {
  id: string;
  assetId: string;
  text: string;
}

const money = (cents: number, currency = "USD") => (cents / 100).toLocaleString("en-US", { style: "currency", currency });

function termsSummary(t: LicenseTerms): string {
  const parts = [
    t.commercialUse ? "commercial" : "non-commercial",
    t.territories.join(", "),
    t.termMonths === "perpetual" ? "perpetual" : `${t.termMonths} months`,
  ];
  if (t.mediums) parts.push(t.mediums === "ALL" ? "any medium" : t.mediums.join("/"));
  if (t.attributionRequired !== undefined) parts.push(t.attributionRequired ? "credit required" : "no credit needed");
  if (t.sublicensing !== undefined) parts.push(t.sublicensing ? "sublicensable" : "no sublicensing");
  if (t.exclusive !== undefined) parts.push(t.exclusive ? "exclusive" : "non-exclusive");
  if (t.fixedEndDate) parts.push(`ends ${t.fixedEndDate}`);
  if (t.offerValidUntil) parts.push(`offer until ${t.offerValidUntil}`);
  return parts.join(" · ");
}

const sampleFields = (): DocField[] => sampleDocuments.map((d) => ({ id: d.id, assetId: d.assetId, text: d.text }));

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export default function Home() {
  const [config, setConfig] = useState<Config | null>(null);
  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState(sampleProject.name);
  const [commercial, setCommercial] = useState(sampleProject.commercial);
  const [territories, setTerritories] = useState(sampleProject.territories.join(", "));
  const [termMonths, setTermMonths] = useState(String(sampleProject.termMonths));
  const [budget, setBudget] = useState(String((sampleProject.budgetCents ?? 0) / 100));
  const [mediums, setMediums] = useState("");
  const [cannotCredit, setCannotCredit] = useState(false);
  const [needsSublicensing, setNeedsSublicensing] = useState(false);
  const [requiresExclusive, setRequiresExclusive] = useState(false);
  const [assets, setAssets] = useState(sampleRequiredAssets.join(", "));
  const [docs, setDocs] = useState<DocField[]>(sampleFields);
  const [approver, setApprover] = useState("");

  useEffect(() => {
    api<Config>("/api/config").then(setConfig).catch((e) => setError(e.message));
    const id = new URLSearchParams(window.location.search).get("session");
    if (id) api<SessionView>(`/api/sessions/${id}`).then(setView).catch(() => undefined);
  }, []);

  const running = view?.phase === "extracting" || view?.phase === "proposing";
  useEffect(() => {
    if (!view || !running) return;
    const t = setInterval(() => api<SessionView>(`/api/sessions/${view.id}`).then(setView).catch((e) => setError(e.message)), 1500);
    return () => clearInterval(t);
  }, [view, running]);

  const act = useCallback(async (fn: () => Promise<SessionView>) => {
    setBusy(true);
    setError(null);
    try {
      setView(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, []);

  const run = () =>
    act(async () => {
      const v = await api<SessionView>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          project: {
            name,
            commercial,
            territories: list(territories).map((t) => t.toUpperCase()),
            termMonths: Number(termMonths),
            budgetCents: budget.trim() ? Math.round(Number(budget) * 100) : undefined,
            mediums: list(mediums).map((m) => m.toLowerCase()),
            canCredit: cannotCredit ? false : undefined,
            needsSublicensing,
            requiresExclusive,
          },
          requiredAssetIds: list(assets),
          documents: docs,
        }),
      });
      window.history.replaceState(null, "", `/?session=${v.id}`);
      return v;
    });

  const post = (suffix: string, body?: unknown) => act(() => api<SessionView>(`/api/sessions/${view!.id}/${suffix}`, { method: "POST", body: JSON.stringify(body ?? {}) }));

  const reset = () => {
    setView(null);
    setError(null);
    window.history.replaceState(null, "", "/");
  };

  const loadFile = async (i: number, file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setDocs((d) => d.map((x, j) => (j === i ? { ...x, text } : x)));
  };

  return (
    <main>
      <h1>LicenseGraph</h1>
      <p className="tag">AI moves at machine speed. Creator rights and payments should too.</p>
      <div className="badges">
        {config && (config.mode === "demo" ? <span className="chip warn">Demo mode · built-in sample licences</span> : <span className="chip ok">Live · {config.model}</span>)}
        {config && <span className={`chip ${config.paymentsEnabled ? "ok" : "bad"}`}>PayPal Sandbox {config.paymentsEnabled ? "ready" : "not configured"}</span>}
      </div>

      {!view && (
        <>
          <section className="card">
            <h2>1. Project</h2>
            <div className="grid">
              <div>
                <label htmlFor="name">Project name</label>
                <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="territories">Territories (ISO codes or WORLD)</label>
                <input id="territories" type="text" value={territories} onChange={(e) => setTerritories(e.target.value)} />
              </div>
              <div>
                <label htmlFor="term">Months needed</label>
                <input id="term" type="number" min={1} value={termMonths} onChange={(e) => setTermMonths(e.target.value)} />
              </div>
              <div>
                <label htmlFor="budget">Budget (USD, optional)</label>
                <input id="budget" type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
              </div>
              <div>
                <label htmlFor="mediums">Media (optional: web, print, broadcast…)</label>
                <input id="mediums" type="text" value={mediums} onChange={(e) => setMediums(e.target.value)} />
              </div>
              <div>
                <label htmlFor="assets">Required assets (comma separated)</label>
                <input id="assets" type="text" value={assets} onChange={(e) => setAssets(e.target.value)} />
              </div>
            </div>
            <div className="checks">
              <label><input type="checkbox" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} /> Commercial use</label>
              <label><input type="checkbox" checked={needsSublicensing} onChange={(e) => setNeedsSublicensing(e.target.checked)} /> Needs sublicensing</label>
              <label><input type="checkbox" checked={requiresExclusive} onChange={(e) => setRequiresExclusive(e.target.checked)} /> Needs an exclusive licence</label>
              <label><input type="checkbox" checked={cannotCredit} onChange={(e) => setCannotCredit(e.target.checked)} /> Cannot credit creators</label>
            </div>
          </section>

          <section className="card">
            <h2>2. Licence documents</h2>
            {config?.mode === "demo" && <p className="muted">Demo mode reads only the built-in sample licences. Set a gateway key and model to read your own.</p>}
            {docs.map((d, i) => (
              <div className="doc" key={i}>
                <div className="doc-head">
                  <div>
                    <label htmlFor={`asset-${i}`}>Asset this licence is for</label>
                    <input id={`asset-${i}`} type="text" value={d.assetId} onChange={(e) => setDocs(docs.map((x, j) => (j === i ? { ...x, assetId: e.target.value } : x)))} />
                  </div>
                  <button type="button" onClick={() => setDocs(docs.filter((_, j) => j !== i))} aria-label={`Remove document ${i + 1}`}>Remove</button>
                </div>
                <label htmlFor={`text-${i}`}>Licence text</label>
                <textarea id={`text-${i}`} value={d.text} onChange={(e) => setDocs(docs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                <div className="row"><input type="file" accept=".txt,.md,text/plain" aria-label={`Load text file for document ${i + 1}`} onChange={(e) => loadFile(i, e.target.files?.[0])} /></div>
              </div>
            ))}
            <div className="row">
              <button type="button" onClick={() => setDocs([...docs, { id: `doc-${Date.now()}`, assetId: "", text: "" }])}>Add document</button>
              <button type="button" onClick={() => setDocs(sampleFields())}>Load sample</button>
            </div>
          </section>

          <div className="row">
            <button className="primary" type="button" onClick={run} disabled={busy}>{busy ? "Starting…" : "Find a compliant bundle"}</button>
          </div>
        </>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      {view && (
        <>
          <section className="card">
            <h2>Agent loop <PhaseChip view={view} /></h2>
            <p className="muted" style={{ marginTop: 0 }}>{view.project.name}. The agent proposes, the rules engine verifies, and only a verified bundle can reach payment.</p>
            <ol className="steps">
              {view.events.filter((e) => ["extracted", "extraction_failed", "proposed", "revised", "rejected", "verified", "proposal_error"].includes(e.kind)).map((e) => (
                <EventRow key={e.seq} kind={e.kind} payload={e.payload} />
              ))}
              {running && <li className="step"><span className="chip">working</span><span className="muted">{view.phase === "extracting" ? "Reading licences…" : "Agent is choosing a bundle…"}</span></li>}
            </ol>
            {view.failure && <div className="error">{view.failure}</div>}
            {view.phase === "failed" && <div className="row"><button type="button" onClick={reset}>Start over</button></div>}
          </section>

          {view.bundle && (
            <section className="card">
              <h2>Verified bundle</h2>
              <table>
                <thead><tr><th>Asset</th><th>Licence</th><th className="num">Price</th></tr></thead>
                <tbody>
                  {view.bundle.offers.map((o) => (
                    <tr key={o.id}>
                      <td>{o.assetId}</td>
                      <td>{termsSummary(o.terms)}<Evidence offer={o} /></td>
                      <td className="num">{money(o.priceCents, o.currency)}</td>
                    </tr>
                  ))}
                  <tr className="total"><td colSpan={2}>Total</td><td className="num">{money(view.bundle.totalCents, view.bundle.currency)}</td></tr>
                </tbody>
              </table>

              {view.phase === "verified" && (
                <div className="row">
                  <div style={{ flex: "1 1 220px" }}>
                    <label htmlFor="approver">Approve as</label>
                    <input id="approver" type="text" placeholder="Your name" value={approver} onChange={(e) => setApprover(e.target.value)} />
                  </div>
                  <button className="primary" type="button" disabled={busy || !approver.trim()} onClick={() => post("approve", { approvedBy: approver })}>Approve this bundle</button>
                </div>
              )}
              {view.approval && <p className="muted">Approved by {view.approval.approvedBy}. Digest <span className="mono">{view.approval.bundleDigest.slice(0, 16)}…</span></p>}
            </section>
          )}

          {(view.phase === "approved" || view.phase === "order_created" || view.phase === "captured") && (
            <section className="card">
              <h2>Payment (PayPal Sandbox)</h2>
              {view.phase === "approved" && (
                <>
                  <p className="muted" style={{ marginTop: 0 }}>The agent proposed this purchase and you approved it. Creating the order re-verifies the bundle first.</p>
                  <button className="primary" type="button" disabled={busy || !config?.paymentsEnabled} onClick={() => post("pay")}>{busy ? "Creating order…" : `Create PayPal order for ${money(view.bundle!.totalCents, view.bundle!.currency)}`}</button>
                  {!config?.paymentsEnabled && <div className="note">PayPal credentials are not configured on this server.</div>}
                </>
              )}
              {view.phase === "order_created" && view.order && (
                <>
                  <p className="muted" style={{ marginTop: 0 }}>Order <span className="mono">{view.order.id}</span> is ready. Approve it as the Sandbox buyer; PayPal returns you here and the payment is captured.</p>
                  <div className="row">
                    <a className="button" href={view.order.approveUrl}>Open PayPal Sandbox checkout</a>
                    <button type="button" disabled={busy} onClick={() => post("capture")}>I have approved it, complete payment</button>
                  </div>
                </>
              )}
              {view.phase === "captured" && view.capture && (
                <p style={{ marginTop: 0 }}><span className="chip ok">Paid</span> {view.capture.amount.value} {view.capture.amount.currency} captured. Capture <span className="mono">{view.capture.captureId}</span>.</p>
              )}
            </section>
          )}

          <section className="card">
            <h2>Ledger <span className={`chip ${view.chainValid ? "ok" : "bad"}`}>{view.chainValid ? "chain verified" : "chain broken"}</span></h2>
            <details>
              <summary>{view.events.length} events</summary>
              <table>
                <thead><tr><th>#</th><th>Event</th><th>Hash</th></tr></thead>
                <tbody>
                  {view.events.map((e) => (
                    <tr key={e.seq}><td>{e.seq}</td><td>{e.kind}<div className="muted">{e.at}</div></td><td className="mono">{e.hash.slice(0, 16)}…</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <div className="row">
            <a className="button" href={`/dashboard?session=${view.id}`}>Open dashboard</a>
            <button type="button" onClick={reset}>New project</button>
          </div>
        </>
      )}
    </main>
  );
}

function PhaseChip({ view }: { view: SessionView }) {
  const tone = view.phase === "failed" ? "bad" : view.phase === "extracting" || view.phase === "proposing" ? "warn" : "ok";
  const text: Record<string, string> = { extracting: "reading licences", proposing: "proposing", verified: "verified", failed: "no compliant bundle", approved: "approved", order_created: "awaiting buyer", captured: "paid", created: "queued" };
  return <span className={`chip ${tone}`}>{text[view.phase] ?? view.phase}</span>;
}

function Evidence({ offer }: { offer: LicenseOffer }) {
  return (
    <details>
      <summary>Evidence ({offer.evidence.length} quotes from the licence)</summary>
      {offer.evidence.map((e, i) => (
        <blockquote key={i}><strong>{e.field}:</strong> “{e.quote}”</blockquote>
      ))}
    </details>
  );
}

function EventRow({ kind, payload }: { kind: string; payload: Record<string, unknown> }) {
  const ids = (payload.offerIds as string[] | undefined)?.join(", ") || "nothing";
  switch (kind) {
    case "extracted": {
      const terms = payload.terms as LicenseTerms;
      const evidence = payload.evidence as { field?: string; quote: string }[];
      return (
        <li className="step">
          <span className="chip">read</span>
          <div className="what">
            <strong>{String(payload.documentId)}</strong> for {String(payload.assetId)}: {money(Number(payload.priceCents))}
            <div className="muted">{termsSummary(terms)}</div>
            <details><summary>Evidence ({evidence.length} quotes)</summary>{evidence.map((e, i) => <blockquote key={i}><strong>{e.field}:</strong> “{e.quote}”</blockquote>)}</details>
          </div>
        </li>
      );
    }
    case "extraction_failed":
      return (
        <li className="step"><span className="chip bad">unreadable</span><div className="what"><strong>{String(payload.documentId)}</strong>: could not verify its terms<ul className="viol">{(payload.problems as string[]).map((p, i) => <li key={i}>{p}</li>)}</ul></div></li>
      );
    case "proposed":
    case "revised":
      return (
        <li className="step"><span className="chip">{kind === "proposed" ? "proposed" : "revised"}</span><div className="what">Agent chose <strong>{ids}</strong>{payload.rationale ? <div className="muted">{String(payload.rationale)}</div> : null}</div></li>
      );
    case "rejected":
      return (
        <li className="step"><span className="chip bad">rejected</span><div className="what">Rules engine rejected <strong>{ids}</strong><ul className="viol">{(payload.violations as Violation[]).map((v, i) => <li key={i}>{v.message}{v.offerId ? ` (${v.offerId})` : ""}</li>)}</ul></div></li>
      );
    case "verified":
      return (
        <li className="step"><span className="chip ok">verified</span><div className="what">Rules engine accepted <strong>{ids}</strong>, total {money(Number(payload.totalCents))}</div></li>
      );
    case "proposal_error":
      return (
        <li className="step"><span className="chip bad">invalid</span><div className="what">Proposal could not be used: {String(payload.error)}</div></li>
      );
    default:
      return null;
  }
}
