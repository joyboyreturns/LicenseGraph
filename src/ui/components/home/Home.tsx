"use client";

import { ArrowRight, BadgeCheck, CreditCard, FileSearch, Play, Quote, Scale, Sparkles, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/src/ui/lib/api";
import { useConfig } from "../Providers";
import { Spinner } from "../bits";
import { useStartScenario } from "../useStartScenario";
import { BriefWizard } from "./BriefWizard";
import { HeroGraph } from "./HeroGraph";
import { RecentRuns } from "./RecentRuns";
import { ScenarioCards } from "./ScenarioCards";
import type { ScenarioInfo } from "./types";
import styles from "./Home.module.css";

const STAGES = [
  { n: 1, icon: FileSearch, title: "Read", text: "An AI model reads each licence and extracts its terms. Every term must quote the exact sentence it came from.", actor: "AI agent", tone: "agent" },
  { n: 2, icon: Sparkles, title: "Propose", text: "The agent proposes the cheapest bundle it believes fits the project.", actor: "AI agent", tone: "agent" },
  { n: 3, icon: Scale, title: "Verify", text: "A deterministic rules engine checks every licence against every rule and rejects what breaks. The agent revises.", actor: "Rules engine, code", tone: "engine" },
  { n: 4, icon: UserCheck, title: "Approve", text: "A person approves exactly the verified bundle. Nothing else can be bought.", actor: "You", tone: "neutral" },
  { n: 5, icon: CreditCard, title: "Settle and pay creators", text: "PayPal captures the payment and pays each licensor through Payouts. A Licence Passport records it all.", actor: "PayPal", tone: "pay" },
];

export function Home() {
  const { config } = useConfig();
  const { start, starting } = useStartScenario();
  const [scenarios, setScenarios] = useState<ScenarioInfo[] | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  useEffect(() => {
    api<{ scenarios: ScenarioInfo[] }>("/api/scenarios")
      .then((r) => setScenarios(r.scenarios))
      .catch((e: Error) => setScenarioError(e.message));
  }, []);

  const payLabel = config?.paymentsMode === "simulator" ? "Settled on a labelled payment simulator" : "Settled on the PayPal Sandbox";

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroBg} aria-hidden />
        <div className={`container ${styles.heroGrid}`}>
          <div className={styles.heroText}>
            <p className={styles.kicker}>
              <span className={styles.kickerDot} aria-hidden /> Rights and settlement for projects built on licensed work
            </p>
            <h1 className={styles.h1}>
              AI moves at machine speed. <em>Creator rights and payments should too.</em>
            </h1>
            <p className={styles.lead}>
              An AI agent reads every licence and proposes the cheapest bundle. A deterministic rules engine verifies it against your project and rejects anything that breaks a term. You approve, PayPal pays the creators, and a Licence Passport lets anyone check the result.
            </p>
            <div className={styles.ctas}>
              <button type="button" className="btn btn-primary btn-lg" onClick={() => start("documentary")} disabled={starting !== null}>
                {starting === "documentary" ? <Spinner label="Starting" /> : <Play aria-hidden />}
                Run the 60-second demo
              </button>
              <a href="#describe" className="btn btn-lg">
                Describe your project <ArrowRight aria-hidden />
              </a>
            </div>
            <ul className={styles.trust}>
              <li>
                <Quote aria-hidden /> Every term quoted from the licence
              </li>
              <li>
                <Scale aria-hidden /> Verified by code, not AI
              </li>
              <li>
                <BadgeCheck aria-hidden /> {payLabel}
              </li>
            </ul>
          </div>
          <div className={styles.heroArt}>
            <HeroGraph />
          </div>
        </div>
      </section>

      <section className={`container ${styles.section}`} aria-labelledby="how-title">
        <div className={styles.sectionHead}>
          <p className="eyebrow">How it works</p>
          <h2 id="how-title" className="section-title">
            The model proposes. Code decides. People approve. PayPal pays.
          </h2>
        </div>
        <ol className={styles.stages}>
          {STAGES.map(({ n, icon: Icon, title, text, actor, tone }) => (
            <li key={n} className={styles.stage} data-tone={tone}>
              <span className={styles.stageTop}>
                <span className={styles.stageIcon} aria-hidden>
                  <Icon />
                </span>
                <span className={styles.stageNum}>0{n}</span>
              </span>
              <h3 className={styles.stageTitle}>{title}</h3>
              <p className={styles.stageText}>{text}</p>
              <span className={styles.stageActor}>{actor}</span>
            </li>
          ))}
        </ol>
      </section>

      <section id="scenarios" className={`container ${styles.section}`} aria-labelledby="scenarios-title">
        <div className={styles.sectionHead}>
          <p className="eyebrow">Try it</p>
          <h2 id="scenarios-title" className="section-title">
            Three projects, three ways the cheapest licence goes wrong
          </h2>
          <p className={styles.sectionLead}>Each scenario replays recorded model output, so it is instant and repeatable. The rules engine, approval and payment steps run for real.</p>
        </div>
        <ScenarioCards scenarios={scenarios} error={scenarioError} onStart={start} starting={starting} />
      </section>

      <section id="describe" className={`container ${styles.section}`} aria-labelledby="describe-title">
        <div className={styles.sectionHead}>
          <p className="eyebrow">Your own project</p>
          <h2 id="describe-title" className="section-title">
            Describe your project in a sentence
          </h2>
          <p className={styles.sectionLead}>LicenseGraph turns it into requirements the rules engine can check, and shows what it found in your words and what it assumed.</p>
        </div>
        <BriefWizard scenarios={scenarios ?? []} onStartScenario={start} starting={starting} />
      </section>

      <RecentRuns />
    </>
  );
}
