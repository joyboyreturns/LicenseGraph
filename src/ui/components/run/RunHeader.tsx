"use client";

import { BadgeCheck, Check, CircleDot, Clock, History, Radio, X } from "lucide-react";
import type { ReactNode } from "react";
import { formatElapsed, phaseInfo, runKindLabel } from "@/src/ui/lib/format";
import { STEPS, type RunState, type StepStatus } from "@/src/ui/lib/replay";
import styles from "./RunHeader.module.css";

export function RunHeader({ name, runKind, phase, elapsedMs, live, actions, scenarioTitle }: { name: string; runKind?: string; phase: string; elapsedMs: number; live: boolean; actions?: ReactNode; scenarioTitle?: string }) {
  const kind = runKindLabel(runKind);
  const p = phaseInfo(phase);
  return (
    <div className={styles.head}>
      <div className={styles.titleBlock}>
        <p className="eyebrow">{scenarioTitle ? `Scenario · ${scenarioTitle}` : "Licence run"}</p>
        <h1 className={styles.title}>{name}</h1>
        <div className={styles.meta}>
          <span className={`chip ${runKind === "live" ? "tone-agent" : "tone-neutral"}`} title={kind.long}>
            {runKind === "live" ? <Radio aria-hidden /> : <History aria-hidden />}
            {kind.label}
          </span>
          <span className={`chip tone-${p.tone}`}>
            {live ? <span className="dot dot-live" aria-hidden /> : p.tone === "ok" ? <BadgeCheck aria-hidden /> : p.tone === "bad" ? <X aria-hidden /> : <CircleDot aria-hidden />}
            {p.label}
          </span>
          <span className={styles.elapsed} title="Time from the start of the run to its latest event">
            <Clock aria-hidden />
            <span className="num">{formatElapsed(elapsedMs)}</span>
            <span className="visually-hidden">elapsed</span>
          </span>
        </div>
        <p className={styles.kindNote}>{kind.long}</p>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

const STATUS_TEXT: Record<StepStatus, string> = { todo: "not started", current: "in progress", done: "complete", failed: "failed" };

export function StepRail({ state }: { state: RunState }) {
  return (
    <nav aria-label="Run progress" className={styles.railWrap}>
      <ol className={styles.rail}>
        {STEPS.map((s, i) => {
          const status = state.steps[s.id];
          return (
            <li key={s.id} className={styles.step} data-status={status} aria-current={status === "current" ? "step" : undefined}>
              <span className={styles.marker} aria-hidden>
                {status === "done" ? <Check /> : status === "failed" ? <X /> : <span className={styles.num}>{i + 1}</span>}
              </span>
              <span className={styles.stepText}>
                <span className={styles.stepLabel}>{s.label}</span>
                <span className={styles.actor}>{s.actor}</span>
              </span>
              <span className="visually-hidden">: {STATUS_TEXT[status]}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
