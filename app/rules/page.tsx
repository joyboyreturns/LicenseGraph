import type { Metadata } from "next";
import Link from "next/link";
import { RULE_CATALOG } from "@/src/core/rules";
import { RULE_NOTES } from "@/src/ui/lib/rule-notes";
import { ruleChecks, ruleName } from "@/src/ui/lib/rule-text";

export const metadata: Metadata = {
  title: "How the rules work",
  description: "The rules the deterministic rules engine checks every licence against, when each one applies, and what happens when a licence is silent. Plain code, no AI: the same terms always get the same verdict.",
};

const BUNDLE_RULES = [
  { id: "coverage", name: "Coverage" },
  { id: "duplicate-asset", name: "One licence per asset" },
  { id: "currency", name: "Single currency" },
  { id: "budget", name: "Budget" },
] as const;

export default function Page() {
  return (
    <div className="container-wide" style={{ paddingTop: "clamp(28px, 5vw, 56px)", paddingBottom: 64, display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ maxWidth: 760 }}>
        <p className="eyebrow">The rules engine</p>
        <h1 className="display" style={{ fontSize: "clamp(40px, 5vw, 60px)", marginTop: 10 }}>
          How the rules decide
        </h1>
        <p style={{ marginTop: 14, fontSize: 17, color: "var(--ink-2)", maxWidth: "64ch" }}>
          A model reads the licences and proposes a bundle. It never decides whether the bundle is allowed. Plain code does, with the rules below: the same terms always get the same verdict, and nothing can be paid for until a bundle passes. A rule only applies when your brief makes it relevant, and where it does, a licence that is <b>silent</b> does not get the benefit of the doubt.
        </p>
      </div>

      <section aria-labelledby="offer-rules" className="card" style={{ padding: 0 }}>
        <div className="card-head">
          <h2 id="offer-rules" className="card-title">
            Checked on every licence
          </h2>
          <span className="small muted">Each offer is checked against each rule, not only the proposed bundle</span>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="The rules every licence offer is checked against">
          <table className="table">
            <caption className="visually-hidden">The rules every licence offer is checked against</caption>
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">What it checks</th>
                <th scope="col">Applies when</th>
                <th scope="col">If the licence is silent or falls short</th>
              </tr>
            </thead>
            <tbody>
              {RULE_CATALOG.map((r) => (
                <tr key={r.id}>
                  <th scope="row" style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                    {ruleName(r.id)}
                  </th>
                  <td>{RULE_NOTES[r.id]?.checks ?? ruleChecks(r.id)}</td>
                  <td>{RULE_NOTES[r.id]?.applies}</td>
                  <td>{RULE_NOTES[r.id]?.silent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="bundle-rules" className="card" style={{ padding: 0 }}>
        <div className="card-head">
          <h2 id="bundle-rules" className="card-title">
            Checked on the bundle as a whole
          </h2>
        </div>
        <ul style={{ margin: 0, padding: "4px 20px 18px 36px", display: "grid", gap: 8 }}>
          {BUNDLE_RULES.map((r) => (
            <li key={r.id}>
              <b>{r.name}.</b> {ruleChecks(r.id)}
            </li>
          ))}
        </ul>
      </section>

      <p className="small ink-2" style={{ maxWidth: "70ch" }}>
        What is not here, on purpose: whether a clause means what the model thought it meant (a person reads the quoted sentences and approves), and the clauses outside these rules, such as early termination or a ban on training AI, which are quoted beside the Approve button instead of being judged. The checks run in the browser too: <Link href="/verify">re-verify a Licence Passport</Link> and the rules engine runs again on the exact terms.
      </p>
    </div>
  );
}
