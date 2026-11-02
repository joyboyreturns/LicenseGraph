"use client";

import { ArrowRight, BadgeCheck, CreditCard, FileSearch, Play, Quote, Scale, Sparkles, UserCheck } from "lucide-react";
import Link from "next/link";
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

  const simulated = config?.paymentsMode === "simulator";
  const payLabel = simulated ? "No account or real payment needed" : config?.paymentsMode === "paypal-sandbox" ? "PayPal Sandbox · test money only" : "Payment mode shown above";

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
              Find a licence bundle that fits your project, see the evidence behind each term, and check the result before you approve. A Licence Passport makes the purchase and creator payments independently verifiable.
            </p>
            <div className={styles.ctas}>
              <button type="button" className="btn btn-primary btn-lg" onClick={() => start("game-trailer")} disabled={starting !== null}>
                {starting === "game-trailer" ? <Spinner label="Starting" /> : <Play aria-hidden />}
                Explore the game trailer demo
              </button>
            </div>
            <p className="small ink-2">Follow recorded proposals through rejection and verification, then approve the bundle yourself. {simulated ? "Payment is simulated; no money moves." : "Payment mode is shown above."}</p>
            <p className="small ink-2" style={{ margin: "14px 0 0" }}>
              New here? <Link prefetch={false} href="/tour">Take the ten-minute tour</Link>: seven things to try, and what to look for in each.
            </p>
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
            The model proposes. Code decides. People approve.
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
              <p className={styles.stageText}>{n === 5 && simulated ? "The simulator records the capture and creator payouts. A Licence Passport records the result." : text}</p>
              <span className={styles.stageActor}>{n === 5 && simulated ? "Payment simulator" : actor}</span>
            </li>
          ))}
        </ol>
      </section>

      <section id="scenarios" className={`container ${styles.section}`} aria-labelledby="scenarios-title">
        <div className={styles.sectionHead}>
          <p className="eyebrow">Try it</p>
          <h2 id="scenarios-title" className="section-title">
            Four projects, four ways the cheapest licence goes wrong
          </h2>
          <p className={styles.sectionLead}>Each scenario replays recorded model output. The rules engine checks it again and a person approves the result. {simulated ? "Payments are simulated; no money moves." : config?.paymentsMode === "paypal-sandbox" ? "Payments use PayPal Sandbox test accounts." : "Payment availability is shown above."}</p>
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

      <section className={`container ${styles.section}`} aria-labelledby="agents-title">
        <div className={styles.agentBand}>
          <div>
            <p className="eyebrow">For agents</p>
            <h2 id="agents-title" className="section-title">
              Agents can shop. Only people can spend.
            </h2>
            <p className={styles.sectionLead}>Any AI agent can connect over the Model Context Protocol to check licences, find the exact cheapest bundle and start a purchase. Approval and payment need a person with the claim link.</p>
          </div>
          <Link prefetch={false} href="/agents" className="btn btn-primary btn-lg">
            Connect an agent <ArrowRight aria-hidden />
          </Link>
        </div>
      </section>

      <RecentRuns />
    </>
  );
}
