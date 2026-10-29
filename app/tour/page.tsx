import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { StartScenarioButton } from "@/src/ui/components/tour/StartScenarioButton";

export const metadata: Metadata = {
  title: "Take the tour",
  description: "Seven things to try in LicenseGraph, in order, with what to look for in each: a model corrected by code, an honest no, a person approving, a payment settled, a passport anyone can re-check, an agent shopping, and a portfolio of runs.",
};

interface Step {
  title: string;
  look: string;
  action: ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Watch a model be corrected by code",
    look: "The agent proposes a bundle, the rules engine rejects offers that break a rule (territory, term, media, an expired offer) and says which sentence of which licence it relied on, and the agent revises. Open any offer to see the exact quote behind each term.",
    action: <StartScenarioButton scenarioId="game-trailer">Start the game launch trailer</StartScenarioButton>,
  },
  {
    title: "See an honest no",
    look: "Nobody sells exclusivity here, so no bundle is proposed. The run names the closest licence per asset, what to ask each licensor, the best case if they all agreed, and drafts the messages. Then play the simulated licensor reply: the revised licence is checked as a new run linked to this one, and sits beside it.",
    action: <StartScenarioButton scenarioId="exclusive-theme">Start the exclusive theme tune</StartScenarioButton>,
  },
  {
    title: "Approve as the person, then settle",
    look: "Beside the Approve button: who will be paid what (addresses masked), the clauses the engine does not check quoted word for word, and any spending cap an agent was given. Approval binds a fingerprint of the exact bundle; the payment can only be created for it. Payments here run on a labelled simulator unless this server is connected to the PayPal Sandbox.",
    action: <StartScenarioButton scenarioId="documentary">Start the documentary promo</StartScenarioButton>,
  },
  {
    title: "Re-check a passport, then tamper with one",
    look: "A paid run issues a Licence Passport. The Verify page re-checks it in your browser: the hash chain, every quote at its position, the rules re-run, the payment and payouts. Try a tampered copy and watch which checks catch it. Paste the issuer's public key to check who signed it, with no server involved.",
    action: (
      <Link prefetch={false} className="btn btn-primary" href="/verify">
        Open the Verify page
      </Link>
    ),
  },
  {
    title: "Let an agent shop",
    look: "Everything is an MCP server, so any agent can check, price, negotiate and start a purchase. It gets a claim link for the person it works for. It cannot approve or pay. The page plays a real agent session against this server's own endpoint.",
    action: (
      <Link prefetch={false} className="btn btn-primary" href="/agents">
        Watch an agent work
      </Link>
    ),
  },
  {
    title: "See every run together",
    look: "The portfolio dashboard (AG Grid and AG Studio) shows spend, licences the rules blocked, creators paid, how each run began, and a rule-by-asset matrix, with custom widgets for licence end dates and money flow. Its assistant builds new views from the data.",
    action: (
      <Link prefetch={false} className="btn btn-primary" href="/dashboard?portfolio=1">
        Open the portfolio
      </Link>
    ),
  },
  {
    title: "Read the rules",
    look: "Every rule the engine checks, when it applies, and what a licence's silence means. Plain code, no AI: the same terms always get the same verdict.",
    action: (
      <Link prefetch={false} className="btn btn-primary" href="/rules">
        How the rules decide
      </Link>
    ),
  },
];

export default function Page() {
  return (
    <div className="container-wide" style={{ paddingTop: "clamp(28px, 5vw, 56px)", paddingBottom: 64, display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ maxWidth: 760 }}>
        <p className="eyebrow">The tour</p>
        <h1 className="display" style={{ fontSize: "clamp(40px, 5vw, 60px)", marginTop: 10 }}>
          Seven things to try
        </h1>
        <p style={{ marginTop: 14, fontSize: 17, color: "var(--ink-2)", maxWidth: "64ch" }}>
          About ten minutes, in order. The built-in scenarios replay recorded model output and say so, and nothing here needs an account: the figures all come from the licence texts.
        </p>
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {STEPS.map((s, i) => (
          <li key={s.title} className="card" style={{ padding: 22, display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>
              <span className="muted num" style={{ marginRight: 10 }}>
                {i + 1}
              </span>
              {s.title}
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px 28px" }}>
              <p className="ink-2" style={{ margin: 0, flex: "1 1 440px", maxWidth: "72ch" }}>
                <b>Look for:</b> {s.look}
              </p>
              <div>{s.action}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
