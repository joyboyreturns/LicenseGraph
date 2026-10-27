"use client";

import { ArrowRight, OctagonX } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import { api } from "@/src/ui/lib/api";
import type { Catalog } from "@/src/ui/lib/catalog";
import { buildStory } from "@/src/ui/lib/rounds";
import { ruleName, violationText } from "@/src/ui/lib/rule-text";
import { Spinner } from "../bits";
import { useStartScenario } from "../useStartScenario";
import styles from "./Panels.module.css";

interface ScenarioLite {
  id: string;
  title: string;
  tagline: string;
}

export function FailurePanel({ view, catalog }: { view: SessionView; catalog: Catalog }) {
  const [scenarios, setScenarios] = useState<ScenarioLite[]>([]);
  const { start, starting } = useStartScenario();
  useEffect(() => {
    api<{ scenarios: ScenarioLite[] }>("/api/scenarios")
      .then((r) => setScenarios(r.scenarios))
      .catch(() => setScenarios([]));
  }, []);
  const story = buildStory(view.events, view.loopStatus);
  const lastRejection = [...story.rounds].reverse().find((r) => r.verdict?.status === "rejected")?.verdict;
  const currency = view.candidates[0]?.currency ?? "USD";

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.stepBadge} data-tone="bad">
          <OctagonX aria-hidden />
        </span>
        <div>
          <h2 className={styles.h2}>No compliant bundle</h2>
          <p className={styles.lead}>{view.failure ?? "The run ended without a verified bundle."}</p>
        </div>
      </div>
      <p className="small ink-2">
        This is the system working as intended: the rules engine would not accept any combination the agent tried, so nothing could be approved or paid. Loosen a project constraint, or add a licence that meets it.
      </p>
      {lastRejection && lastRejection.status === "rejected" && lastRejection.violations.length > 0 && (
        <div>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            What blocked the last attempt
          </p>
          <ul className={styles.failList}>
            {lastRejection.violations.map((v, i) => (
              <li key={i}>
                <b>{ruleName(v.rule)}</b>
                {v.offerId ? ` · ${catalog.offerName(v.offerId)}` : ""}: {violationText(v, currency)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="eyebrow" style={{ marginBottom: 8 }}>
          Try a built-in scenario
        </p>
        <div className="row">
          {scenarios.map((s) => (
            <button key={s.id} type="button" className="btn" onClick={() => start(s.id)} disabled={starting !== null} title={s.tagline}>
              {starting === s.id ? <Spinner label="Starting" /> : <ArrowRight aria-hidden />} {s.title}
            </button>
          ))}
          <Link href="/#describe" className="btn btn-ghost">
            Describe a new project
          </Link>
        </div>
      </div>
    </div>
  );
}
