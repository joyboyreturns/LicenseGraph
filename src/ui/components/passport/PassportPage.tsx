"use client";

import { ArrowLeft, CalendarPlus, Download, FileClock, Link2, Printer, RotateCcw, ServerCrash, ShieldCheck, ShieldQuestion } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { verifyPassport, type Passport, type PassportCheck } from "@/src/passport/passport";
import { api, ApiError, errorMessage } from "@/src/ui/lib/api";
import { passportCalendar } from "@/src/ui/lib/licence-dates";
import { useToast } from "../Providers";
import { Certificate } from "./Certificate";
import { VerifyChecks } from "./VerifyChecks";
import styles from "./PassportPage.module.css";

type Load = { status: "loading" } | { status: "ready"; passport: Passport } | { status: "pending"; message: string } | { status: "missing" } | { status: "error"; message: string };
type Signature = "valid" | "invalid" | "unsigned" | "unavailable";

const SIGNATURE_TEXT: Record<Signature, { title: string; text: string; tone: string }> = {
  valid: { title: "Issued and signed by this server", text: "The HMAC signature matches this server's secret.", tone: "ok" },
  invalid: { title: "Signature does not match", text: "This server's secret does not reproduce the signature. Treat the passport as altered.", tone: "bad" },
  unsigned: { title: "Unsigned", text: "This server has no signing secret, so the passport carries no signature. The content checks still stand on their own.", tone: "neutral" },
  unavailable: { title: "Signature not checkable here", text: "The passport is signed, but this server cannot check the signature.", tone: "neutral" },
};

export function PassportPage({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [result, setResult] = useState<{ ok: boolean; checks: PassportCheck[] } | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [signature, setSignature] = useState<Signature | "error" | null>(null);
  const [url, setUrl] = useState("");
  const toast = useToast();

  useEffect(() => {
    setUrl(window.location.href.split("#")[0] ?? "");
    let alive = true;
    api<Passport>(`/api/passports/${encodeURIComponent(id)}`)
      .then((p) => alive && setLoad({ status: "ready", passport: p }))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 409) setLoad({ status: "pending", message: e.message });
        else if (e instanceof ApiError && e.status === 404) setLoad({ status: "missing" });
        else setLoad({ status: "error", message: errorMessage(e) });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const runChecks = useCallback(async (p: Passport) => {
    setResult(null);
    try {
      const r = await verifyPassport(p);
      setResult(r);
    } catch (e) {
      setResult({ ok: false, checks: [{ id: "error", label: "Verification could not run", ok: false, detail: errorMessage(e) }] });
    }
    setRunKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (load.status !== "ready") return;
    document.title = `Licence Passport · ${load.passport.project.name}`;
    void runChecks(load.passport);
    api<{ signature: Signature }>(`/api/passports/${encodeURIComponent(id)}/verify`)
      .then((r) => setSignature(r.signature))
      .catch(() => setSignature("error"));
  }, [load, id, runChecks]);

  if (load.status === "loading")
    return (
      <div className={`container-wide ${styles.page}`} aria-busy="true">
        <div className={styles.layout}>
          <div className="skeleton" style={{ height: 900, borderRadius: 8 }} />
          <div className="skeleton" style={{ height: 520, borderRadius: 14 }} />
        </div>
      </div>
    );
  if (load.status !== "ready") {
    const pending = load.status === "pending";
    return (
      <div className={`container ${styles.empty}`}>
        <span className={styles.emptyIcon} aria-hidden>
          {pending ? <FileClock /> : <ServerCrash />}
        </span>
        <p className="eyebrow">Licence Passport</p>
        <h1 className={styles.emptyTitle}>{pending ? "Not issued yet" : load.status === "missing" ? "No passport with this id" : "The passport could not be loaded"}</h1>
        <p className={styles.emptyText}>
          {pending ? "A passport is issued once the payment for a verified, approved bundle has been captured. Finish the run first." : load.status === "missing" ? "There is no run with this id on this server. If someone sent you a passport file, verify it on the verify page." : load.message}
        </p>
        <div className="row">
          {pending && (
            <Link prefetch={false} href={`/run/${id}`} className="btn btn-primary">
              <ArrowLeft aria-hidden /> Back to the run
            </Link>
          )}
          <Link prefetch={false} href="/verify" className="btn">
            <ShieldCheck aria-hidden /> Verify a passport file
          </Link>
        </div>
      </div>
    );
  }

  const p = load.passport;
  const calendar = passportCalendar(p);
  const hasDates = calendar.count > 0;
  const downloadCalendar = () => {
    const url = URL.createObjectURL(new Blob([calendar.ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `licence-end-dates-${p.id.slice(0, 8)}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const sig = signature && signature !== "error" ? SIGNATURE_TEXT[signature] : null;
  return (
    <div className={`container-wide ${styles.page}`}>
      <div className={`${styles.toolbar} no-print`}>
        <Link prefetch={false} href={`/run/${p.id}`} className="btn btn-ghost">
          <ArrowLeft aria-hidden /> Run
        </Link>
        <span className="spacer" />
        <a href={`/api/passports/${encodeURIComponent(p.id)}?download=1`} className="btn" download>
          <Download aria-hidden /> Download JSON
        </a>
        {hasDates && (
          <button type="button" className="btn" onClick={downloadCalendar}>
            <CalendarPlus aria-hidden /> Add licence end dates to my calendar
          </button>
        )}
        <button type="button" className="btn" onClick={() => window.print()}>
          <Printer aria-hidden /> Print or save as PDF
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast.push({ tone: "ok", title: "Link copied", body: "Anyone with the link can open and re-verify this passport." });
            } catch {
              toast.push({ tone: "bad", title: "Could not copy", body: url });
            }
          }}
        >
          <Link2 aria-hidden /> Copy link
        </button>
      </div>

      <div className={styles.layout}>
        <div className={styles.certCol}>
          <Certificate passport={p} qrSrc={`/api/passports/${encodeURIComponent(p.id)}/qr`} verifyUrl={url || undefined} />
        </div>
        <aside className={`${styles.side} no-print`} aria-labelledby="live-verify">
          <section className={`card ${styles.verifyCard}`}>
            <div className={styles.verifyHead}>
              <div>
                <p className="eyebrow">Live verification</p>
                <h2 id="live-verify" className={styles.h2}>
                  Re-checked in your browser
                </h2>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => runChecks(p)} disabled={!result}>
                <RotateCcw aria-hidden /> Run again
              </button>
            </div>
            <p className={styles.verifyLead}>Nothing here is taken on trust from the server: your browser recomputes every hash, re-runs the rules engine on the exact terms, and finds every quote in the licence text.</p>
            <VerifyChecks checks={result?.checks ?? null} ok={result?.ok ?? null} runKey={runKey} />
            <div className={styles.sig} data-tone={sig?.tone ?? "neutral"}>
              {sig?.tone === "ok" ? <ShieldCheck aria-hidden /> : <ShieldQuestion aria-hidden />}
              <div>
                <p className={styles.sigTitle}>{signature === null ? "Asking the server about its signature…" : signature === "error" ? "Could not reach the server to check the signature" : sig!.title}</p>
                {sig && <p className={styles.sigText}>{sig.text}</p>}
              </div>
            </div>
          </section>
          <section className={`card ${styles.explain}`} aria-labelledby="proves">
            <h2 id="proves" className={styles.h3}>
              What &ldquo;verified&rdquo; proves
            </h2>
            <ul>
              <li>The record is internally consistent and has not been edited since it was issued: the ledger, bundle, approval and payment all agree.</li>
              <li>The licences in the bundle pass every rule for this project, re-checked by the same deterministic code.</li>
              <li>Every term is backed by a quote found at its recorded place in the licence text.</li>
            </ul>
            <h2 className={styles.h3}>What it does not prove</h2>
            <ul>
              <li>That the licence documents themselves are genuine or that the licensor owns the rights.</li>
              <li>That the extracted terms are the only reading of the licence. It is not legal advice.</li>
              <li>Who issued it. Only the server signature line above speaks to that.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
