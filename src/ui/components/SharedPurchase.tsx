"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, errorMessage } from "@/src/ui/lib/api";
import { formatMoney } from "@/src/ui/lib/format";
import { verifyPassport, type Passport, type PassportCheck } from "@/src/passport/passport";
import { verifySignature } from "@/src/passport/signature";
import { VerifyChecks } from "./passport/VerifyChecks";
import styles from "./Workspace.module.css";
interface Receipt {
  kind: "receipt";
  status: string;
  currency: string;
  totalCents: number;
  environment: string;
  bundleCommitment: string;
  ledgerCommitment: string;
  verification: string;
}
export function SharedPurchase({ token }: { token: string }) {
  const [record, setRecord] = useState<Receipt | Passport | null>(null),
    [error, setError] = useState("");
  const [checks, setChecks] = useState<{ ok: boolean; checks: PassportCheck[] } | null>(null);
  const [signature, setSignature] = useState("Checking issuer signature…");
  useEffect(() => {
    let active = true;
    api<Receipt | Passport>(`/api/marketplace/shared/${encodeURIComponent(token)}`)
      .then(async (value) => {
        if (!active) return;
        setRecord(value);
        if ("version" in value) {
          const result = await verifyPassport(value);
          if (active) setChecks(result);
          const keys = await api<{ keys: { keyId: string; publicKey: string }[] }>("/.well-known/licensegraph-keys.json");
          const key = keys.keys.find((k) => k.keyId === value.signature?.keyId);
          const state = key ? await verifySignature(value, key.publicKey) : "unavailable";
          if (active) setSignature(`Issuer signature: ${state}.`);
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <div className={`container ${styles.page}`}>
      <p className="eyebrow">Shared purchase · Sandbox only</p>
      <h1>{record && "version" in record ? "Shared Licence Passport" : "Shared purchase receipt"}</h1>
      {error ? (
        <p role="alert" className="callout">
          This sharing grant is expired, revoked or unavailable. {error}
        </p>
      ) : !record ? (
        <p aria-busy="true">Loading the shared record…</p>
      ) : "kind" in record ? (
        <section className={`card ${styles.panel}`}>
          <h2>{formatMoney(record.totalCents, record.currency)}</h2>
          <p>Status: {record.status.replaceAll("_", " ")}</p>
          <p>{record.verification}</p>
          <dl>
            <dt>Bundle commitment</dt>
            <dd className={styles.source}>{record.bundleCommitment}</dd>
            <dt>Ledger commitment</dt>
            <dd className={styles.source}>{record.ledgerCommitment}</dd>
          </dl>
          <p>This redacted receipt does not disclose the licence sources or prove legal ownership.</p>
        </section>
      ) : (
        <section className={`card ${styles.panel}`}>
          <h2>{record.project.name}</h2>
          <p>
            {formatMoney(record.bundle.totalCents, record.bundle.currency)} · {record.bundle.offers.length} licences · test money
          </p>
          <p>{signature}</p>
          <VerifyChecks checks={checks?.checks ?? null} ok={checks?.ok ?? null} runKey={1} />
          <button
            className="btn"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = `licence-passport-${record.id}.json`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download complete passport
          </button>
          {record.documents.map((doc) => (
            <details key={doc.id} className={styles.evidence}>
              <summary>Read source: {doc.assetId}</summary>
              <pre>{doc.text}</pre>
            </details>
          ))}
          <p>
            Downloads remain with their recipients after a sharing link expires or is revoked. Content checks establish internal
            consistency; they do not certify legal ownership.
          </p>
        </section>
      )}
      <p style={{ marginTop: 24 }}>
        <Link href="/verify">Verify a downloaded passport</Link>
      </p>
    </div>
  );
}
