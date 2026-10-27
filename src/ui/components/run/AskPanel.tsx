"use client";

import { CornerDownLeft, MessageSquareText } from "lucide-react";
import { useId, useState } from "react";
import { api, errorMessage } from "@/src/ui/lib/api";
import type { Catalog } from "@/src/ui/lib/catalog";
import { Spinner } from "../bits";
import styles from "./AskPanel.module.css";

interface Answer {
  answer: string;
  source: "model" | "local";
  citations: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Offer ids become names; a following "(asset, price)" aside is dropped because the name already says it. */
function nameOffers(text: string, catalog: Catalog): string {
  let out = text;
  for (const id of [...catalog.offers.keys()].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`${escapeRe(id)}(?: \\([a-z][a-z -]*, [^)]*\\d[^)]*\\))?`, "g"), catalog.offerName(id));
  }
  return out;
}

/** Questions answered only from this run's recorded facts, by the model when available or the offline reader. */
export function AskPanel({ runId, catalog, suggestions, onSelectOffer }: { runId: string; catalog: Catalog; suggestions: string[]; onSelectOffer: (id: string) => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ question: string; answer: Answer } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (question: string) => {
    const text = question.trim();
    if (text.length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await api<Answer>(`/api/sessions/${encodeURIComponent(runId)}/ask`, { method: "POST", json: { question: text } });
      setResult({ question: text, answer });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <label htmlFor={id} className="visually-hidden">
          Ask a question about this run
        </label>
        <input id={id} className="input" placeholder="Why was the cheapest song rejected?" value={q} maxLength={400} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy || q.trim().length < 3}>
          {busy ? <Spinner label="Asking" /> : <CornerDownLeft aria-hidden />}
          Ask
        </button>
      </form>
      <div className={styles.suggestions}>
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className={styles.suggestion}
            onClick={() => {
              setQ(s);
              void ask(s);
            }}
            disabled={busy}
          >
            {s}
          </button>
        ))}
      </div>
      {error && (
        <p className="callout tone-bad" role="alert">
          {error}
        </p>
      )}
      <div aria-live="polite">
        {result && (
          <div className={styles.answer}>
            <p className={styles.question}>
              <MessageSquareText aria-hidden /> {result.question}
            </p>
            <div className={styles.text}>
              {nameOffers(result.answer.answer, catalog)
                .split("\n")
                .map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
            </div>
            {result.answer.citations.length > 0 && (
              <div className={styles.cites}>
                <span>Sources</span>
                {result.answer.citations.map((c) => (
                  <button key={c} type="button" className="chip chip-sm tone-neutral" onClick={() => onSelectOffer(c)}>
                    {catalog.offerName(c)}
                  </button>
                ))}
              </div>
            )}
            <p className={styles.source}>{result.answer.source === "model" ? "Answered by the model from this run's recorded facts only; every cited licence exists in the run." : "Answered by the offline reader from this run's recorded facts. No model was used."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
