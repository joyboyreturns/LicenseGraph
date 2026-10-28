"use client";

import { ClipboardPaste, FileJson, FlaskConical, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { verifyPassport, type Passport, type PassportCheck } from "@/src/passport/passport";
import { verifySignature, type SignatureState } from "@/src/passport/signature";
import { api, errorMessage } from "@/src/ui/lib/api";
import { formatMoney } from "@/src/ui/lib/format";
import { parsePassport, tamperPrice } from "@/src/ui/lib/passport-file";
import { Spinner } from "../bits";
import type { RunSummary } from "../home/types";
import { VerifyChecks } from "./VerifyChecks";
import styles from "./VerifyClient.module.css";

const ISSUER_TEXT: Record<SignatureState, { title: string; text: string; tone: string }> = {
  valid: { title: "Issued by the holder of this key", text: "The signature matches the public key you gave, checked here with no server involved.", tone: "ok" },
  invalid: { title: "Not issued by that key", text: "The signature does not match that key. Either the passport was changed after signing, or another issuer signed it.", tone: "bad" },
  unsigned: { title: "Not signed", text: "This passport carries no signature, so it cannot be tied to an issuer. The content checks above still stand on their own.", tone: "neutral" },
  unsupported: { title: "Signed in an older way", text: "This passport uses a shared-secret signature that only its server can check. Open it on that server to see the result.", tone: "neutral" },
  unavailable: { title: "This browser cannot check it", text: "This browser has no Ed25519 in WebCrypto. Use a current Chrome, Firefox or Safari, or the command-line verifier.", tone: "neutral" },
};

interface Loaded {
  passport: Passport;
  source: string;
  tampered?: { offerId?: string; fromCents?: number; toCents?: number };
}

export function VerifyClient() {
  const ids = useId();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [original, setOriginal] = useState<Passport | null>(null);
  const [result, setResult] = useState<{ ok: boolean; checks: PassportCheck[] } | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState(false);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fetching, setFetching] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const [issuerKey, setIssuerKey] = useState("");
  const [issuer, setIssuer] = useState<SignatureState | null>(null);
  const [keyNote, setKeyNote] = useState<string | null>(null);

  // The issuer's signature is checked on its own, as soon as there is both a passport and a key to check it with.
  useEffect(() => {
    let current = true;
    setIssuer(null);
    if (!loaded || !issuerKey.trim()) return;
    void verifySignature(loaded.passport, issuerKey).then((s) => current && setIssuer(s));
    return () => {
      current = false;
    };
  }, [loaded, issuerKey]);

  const useServerKey = async () => {
    setKeyNote(null);
    try {
      const { keys } = await api<{ keys: { publicKey: string; keyId: string }[] }>("/.well-known/licensegraph-keys.json");
      setIssuerKey(keys[0]!.publicKey);
      setKeyNote(`Key ${keys[0]!.keyId} from this server. For a real check, use a key you were given by the issuer instead.`);
    } catch (e) {
      setKeyNote(errorMessage(e, "This server does not publish a key."));
    }
  };

  const check = useCallback(async (p: Passport, source: string, tampered?: Loaded["tampered"]) => {
    setError(null);
    setLoaded({ passport: p, source, tampered });
    setResult(null);
    try {
      setResult(await verifyPassport(p));
    } catch (e) {
      setResult({ ok: false, checks: [{ id: "error", label: "Verification could not run", ok: false, detail: errorMessage(e) }] });
    }
    setRunKey((k) => k + 1);
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  const fromText = useCallback(
    (text: string, source: string) => {
      const r = parsePassport(text);
      if (!r.ok) {
        setError(r.error);
        setLoaded(null);
        setResult(null);
        return;
      }
      setOriginal(r.passport);
      void check(r.passport, source);
    },
    [check],
  );

  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      setError("That file is too large to be a Licence Passport (over 5 MB).");
      return;
    }
    fromText(await file.text(), file.name);
  };

  const sample = async () => {
    setFetching(true);
    setError(null);
    try {
      const { runs } = await api<{ runs: RunSummary[] }>("/api/sessions");
      const paid = runs.find((r) => r.paid);
      if (!paid) {
        setError("No paid run on this server yet. Run a scenario to the end, then come back, or load a passport file.");
        return;
      }
      const p = await api<Passport>(`/api/passports/${encodeURIComponent(paid.id)}`);
      setOriginal(p);
      await check(p, `${p.project.name} (from this server)`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setFetching(false);
    }
  };

  const tamper = () => {
    if (!original) return;
    const t = tamperPrice(original);
    void check(t.passport, "Tampered copy", { offerId: t.offerId, fromCents: t.fromCents, toCents: t.toCents });
  };

  return (
    <div className={styles.layout}>
      <div className={styles.inputCol}>
        <label
          className={styles.drop}
          data-dragging={dragging || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void fromFile(e.dataTransfer.files?.[0]);
          }}
        >
          <input type="file" accept="application/json,.json" className="visually-hidden" onChange={(e) => fromFile(e.target.files?.[0])} />
          <span className={styles.dropIcon} aria-hidden>
            <Upload />
          </span>
          <span className={styles.dropTitle}>Drop a passport file here, or choose one</span>
          <span className={styles.dropText}>The licence-passport-….json you downloaded. It is read and checked in this browser; nothing is uploaded.</span>
        </label>

        <div className={styles.alt}>
          <button type="button" className="btn" onClick={() => setPaste((v) => !v)} aria-expanded={paste} aria-controls={`${ids}-paste`}>
            <ClipboardPaste aria-hidden /> Paste JSON
          </button>
          <button type="button" className="btn" onClick={sample} disabled={fetching}>
            {fetching ? <Spinner label="Loading" /> : <FileJson aria-hidden />} Use the latest passport from this server
          </button>
        </div>

        {paste && (
          <div id={`${ids}-paste`} className={styles.paste}>
            <label className="label" htmlFor={`${ids}-ta`}>
              Passport JSON
            </label>
            <textarea id={`${ids}-ta`} className="textarea mono" rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"version": 1, "id": "…", …}' />
            <button type="button" className="btn btn-primary" onClick={() => fromText(pasted, "Pasted JSON")} disabled={!pasted.trim()}>
              <ShieldCheck aria-hidden /> Verify pasted JSON
            </button>
          </div>
        )}

        <div className={styles.paste}>
          <label className="label" htmlFor={`${ids}-key`}>
            Issuer&rsquo;s public key (optional)
          </label>
          <input id={`${ids}-key`} className="input mono" value={issuerKey} onChange={(e) => setIssuerKey(e.target.value)} placeholder="Paste the key the issuer gave you" spellCheck={false} autoComplete="off" aria-describedby={`${ids}-key-help`} />
          <p id={`${ids}-key-help`} className="small muted">
            Adds a check of who issued the passport, offline in this browser. Without it, the checks above show the record is consistent and unchanged, not who made it.
          </p>
          <button type="button" className="btn btn-sm" onClick={useServerKey}>
            Use this server&rsquo;s published key
          </button>
          {keyNote && (
            <p className="small ink-2" role="status">
              {keyNote}
            </p>
          )}
        </div>

        {error && (
          <p className="callout tone-bad" role="alert">
            {error}
          </p>
        )}

        <div className={styles.how}>
          <h2 className={styles.h3}>What gets checked</h2>
          <ol>
            <li>The ledger&rsquo;s SHA-256 hash chain, event by event.</li>
            <li>The approved bundle&rsquo;s fingerprint against what was bought.</li>
            <li>Approval and verification recorded in the ledger.</li>
            <li>Every term, price and quote against the ledger record.</li>
            <li>Every quote found at its recorded place in the licence text.</li>
            <li>The rules engine, re-run here on the exact terms.</li>
            <li>The payment capture and creator payouts against the total.</li>
          </ol>
        </div>
      </div>

      <div ref={resultRef} className={styles.resultCol} aria-live="polite">
        {!loaded ? (
          <div className={`card ${styles.placeholder}`}>
            <ShieldCheck aria-hidden />
            <p>Load a passport to see each check run.</p>
          </div>
        ) : (
          <section className={`card ${styles.result}`} data-tampered={loaded.tampered ? true : undefined} aria-labelledby="verify-result">
            <div className={styles.resultHead}>
              <div className={styles.resultTitles}>
                <p className="eyebrow">{loaded.source}</p>
                <h2 id="verify-result" className={styles.h2}>
                  {loaded.passport.project.name}
                </h2>
                <p className={styles.meta}>
                  {formatMoney(loaded.passport.bundle.totalCents, loaded.passport.bundle.currency)} · {loaded.passport.bundle.offers.length} licences · <code className="mono">{loaded.passport.id.slice(0, 8)}</code>
                </p>
              </div>
              {!loaded.tampered && (
                <Link prefetch={false} href={`/passport/${encodeURIComponent(loaded.passport.id)}`} className="btn btn-sm btn-ghost">
                  Open on this server
                </Link>
              )}
            </div>
            {loaded.tampered && (
              <p className={`callout tone-bad ${styles.tamperNote}`}>
                <FlaskConical aria-hidden />
                <span>
                  This is a deliberately edited copy: the price of one licence was changed from {formatMoney(loaded.tampered.fromCents, loaded.passport.bundle.currency)} to {formatMoney(loaded.tampered.toCents, loaded.passport.bundle.currency)}. Watch which checks catch it.
                </span>
              </p>
            )}
            <VerifyChecks checks={result?.checks ?? null} ok={result?.ok ?? null} runKey={runKey} stepMs={360} />
            {issuer && (
              <p className={`callout tone-${ISSUER_TEXT[issuer].tone}`} data-testid="issuer-signature">
                <b>{ISSUER_TEXT[issuer].title}.</b> {ISSUER_TEXT[issuer].text}
              </p>
            )}
            <div className={styles.resultActions}>
              {original && !loaded.tampered && (
                <button type="button" className="btn" onClick={tamper}>
                  <FlaskConical aria-hidden /> Try a tampered copy
                </button>
              )}
              {original && loaded.tampered && (
                <button type="button" className="btn" onClick={() => check(original, "Original passport")}>
                  <RotateCcw aria-hidden /> Back to the original
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
