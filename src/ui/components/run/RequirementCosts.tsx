"use client";

import type { RequirementCosts as Costs } from "@/src/core/insights";
import type { Project, RuleId } from "@/src/core/types";
import { formatMoney, projectRequirements } from "@/src/ui/lib/format";
import styles from "./Insights.module.css";

/** Which entry of `projectRequirements` states each relaxable rule's requirement. */
const REQUIREMENT_KEY: Partial<Record<RuleId, string>> = {
  "commercial-use": "commercial",
  territory: "territory",
  term: "term",
  medium: "media",
  attribution: "credit",
  sublicensing: "sublicensing",
  exclusivity: "exclusive",
};

/**
 * What each requirement of the brief adds to the cheapest compliant purchase. Each figure is the
 * independent cost check re-run with that one requirement dropped, so it is exact, not an estimate.
 */
export function RequirementCosts({ costs, project }: { costs: Costs; project: Project }) {
  const stated = new Map(projectRequirements(project, costs.currency).map((r) => [r.key, r.value]));
  const max = Math.max(1, ...costs.items.map((i) => i.extraCents));
  return (
    <div>
      <h3 className="eyebrow" style={{ marginBottom: 8 }}>
        What each requirement costs you
      </h3>
      <p className="small ink-2" style={{ marginBottom: 10 }}>
        The cheapest compliant bundle costs {formatMoney(costs.baselineCents, costs.currency)}. Here is what it would cost if you dropped one requirement at a time.
      </p>
      <ul className={styles.list}>
        {costs.items.map((item) => {
          const free = item.extraCents === 0;
          const requirement = stated.get(REQUIREMENT_KEY[item.rule] ?? "");
          return (
            <li key={item.rule} className={styles.row}>
              <span className={styles.name}>
                {item.label}
                {requirement && <span className={styles.value}> · {requirement}</span>}
              </span>
              <span className={`${styles.extra} num`} data-free={free}>
                {free ? "costs nothing" : `+${formatMoney(item.extraCents, costs.currency)}`}
              </span>
              <span className={styles.track} aria-hidden>
                <span className={styles.bar} data-free={free} style={{ width: `${free ? 4 : Math.max(4, (item.extraCents / max) * 100)}%` }} />
              </span>
              <span className={styles.hint}>{free ? "The cheapest licences already meet this." : `Without it the cheapest compliant bundle would be ${formatMoney(item.withoutCents, costs.currency)}.`}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
