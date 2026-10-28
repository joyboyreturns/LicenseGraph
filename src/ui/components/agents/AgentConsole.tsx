"use client";

import { Bot, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import { api, errorMessage } from "@/src/ui/lib/api";
import { runAgentSession, type Rpc, type Step } from "@/src/ui/lib/agent-console";
import { Spinner } from "../bits";
import styles from "./Agents.module.css";

interface ScenarioLite {
  id: string;
  title: string;
  tagline: string;
}

/** One JSON-RPC call to this server's own MCP endpoint, exactly as an agent would make it. */
const rpc: Rpc = async (method, params) => {
  const res = await fetch("/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
  return res.json();
};

async function settled(id: string): Promise<SessionView> {
  for (let i = 0; i < 60; i++) {
    const v = await api<SessionView>(`/api/sessions/${id}`);
    if (v.phase === "verified" || v.phase === "failed") return v;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("The scenario did not finish in time.");
}

/** Runs a built-in scenario, then plays an agent session against the MCP endpoint, one step at a time. */
export function AgentConsole() {
  const [scenarios, setScenarios] = useState<ScenarioLite[]>([]);
  const [chosen, setChosen] = useState("documentary");
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    api<{ scenarios: ScenarioLite[] }>("/api/scenarios")
      .then((r) => setScenarios(r.scenarios))
      .catch(() => setScenarios([]));
  }, []);

  const go = async () => {
    setBusy(true);
    setError(null);
    setSteps([]);
    setRunId(null);
    try {
      const started = await api<SessionView>("/api/sessions", { method: "POST", json: { scenarioId: chosen } });
      const view = await settled(started.id);
      setRunId(view.id);
      await runAgentSession(
        rpc,
        { project: view.project, requiredAssetIds: view.analysis?.assets.map((a) => a.assetId) ?? [], candidates: view.candidates, currency: view.candidates[0]?.currency ?? "USD" },
        (s) => setSteps((all) => [...all, s]),
      );
    } catch (e) {
      setError(errorMessage(e, "The agent session could not run."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.console}>
      <div className={styles.controls}>
        <label htmlFor="agent-scenario" className="small muted">
          Brief the agent with
        </label>
        <select id="agent-scenario" className="input" value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={busy}>
          {(scenarios.length ? scenarios : [{ id: "documentary", title: "Documentary promo", tagline: "" }]).map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={go} disabled={busy}>
          {busy ? <Spinner label="Running" /> : <Play aria-hidden />} Run as an agent
        </button>
      </div>

      {error && (
        <p className="callout tone-bad" role="alert">
          {error}
        </p>
      )}

      {steps.length > 0 && (
        <ol className={styles.steps} aria-label="What the agent did" aria-live="polite">
          {steps.map((s, i) => (
            <li key={i} className={styles.step}>
              <span className={styles.stepNum} aria-hidden>
                {i + 1}
              </span>
              <div className={styles.stepBody}>
                <p className={styles.intent}>
                  <Bot aria-hidden /> {s.intent}
                </p>
                <p className={styles.call}>
                  <code>{s.tool}</code>
                </p>
                <p className={styles.result}>{s.result}</p>
                <details>
                  <summary>Raw reply from the tool</summary>
                  <pre className={styles.raw}>{JSON.stringify(s.raw, null, 2)}</pre>
                </details>
              </div>
            </li>
          ))}
          {!busy && (
            <li className={`${styles.step} ${styles.handover}`}>
              <span className={styles.stepNum} aria-hidden>
                ✋
              </span>
              <div className={styles.stepBody}>
                <p className={styles.intent}>Here the agent stops.</p>
                <p className={styles.result}>
                  To buy, it would call <code>start_licence_purchase</code>, which returns a claim link for a person. It can pass the spending cap the person gave it, which is checked against the verified total and shown next to the Approve button. Only the person can approve and pay; the agent cannot.
                  {runId && (
                    <>
                      {" "}
                      <Link prefetch={false} href={`/run/${runId}`}>
                        Open the run this session priced.
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
