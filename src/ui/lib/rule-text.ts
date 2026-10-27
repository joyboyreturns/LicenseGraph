/**
 * Plain-language names and explanations for the rules engine's rule ids. This only describes
 * rules; the rules themselves live in src/core/rules.ts and are never re-implemented here.
 */
import { RULE_CATALOG } from "@/src/core/rules";
import type { RuleId, Violation } from "@/src/core/types";
import { formatMoney } from "./format";

interface RuleText {
  name: string;
  /** What the rule checks, in one sentence. */
  checks: string;
}

const BUNDLE_RULES: Partial<Record<RuleId, RuleText>> = {
  coverage: { name: "Coverage", checks: "Every required asset has exactly one licence in the bundle." },
  "duplicate-asset": { name: "One licence per asset", checks: "The bundle does not buy two licences for the same asset." },
  currency: { name: "Single currency", checks: "Every licence in the bundle is priced in the same currency." },
  budget: { name: "Budget", checks: "The bundle total stays within the project's budget." },
};

const OFFER_RULE_CHECKS: Record<string, string> = {
  "commercial-use": "The licence allows commercial use when the project is commercial.",
  territory: "The licence covers every territory the project is released in.",
  term: "The licence lasts at least as long as the project needs it, and does not end on an earlier fixed date.",
  medium: "The licence covers every medium the project uses. A licence that does not say fails.",
  attribution: "The licence does not require a credit the project cannot give. A licence that does not say fails.",
  sublicensing: "The licence grants sublicensing when the project needs it.",
  exclusivity: "The licence is exclusive when the project needs exclusivity.",
  expiry: "The offer can still be bought on the day the run checked it.",
  evidence: "Every extracted term is linked to a quote from the licence text.",
};

export function ruleName(rule: RuleId | string): string {
  const fromCatalog = RULE_CATALOG.find((r) => r.id === rule)?.label;
  return fromCatalog ?? BUNDLE_RULES[rule as RuleId]?.name ?? rule;
}

export function ruleChecks(rule: RuleId | string): string {
  return OFFER_RULE_CHECKS[rule] ?? BUNDLE_RULES[rule as RuleId]?.checks ?? "";
}

/** True for rules that judge the bundle as a whole rather than one licence. */
export const isBundleRule = (rule: RuleId | string) => rule in BUNDLE_RULES;

/**
 * The verifier's message, with raw cent amounts turned into money. The wording is the engine's own;
 * only number formatting changes.
 */
export function violationText(v: Pick<Violation, "rule" | "message">, currency = "USD"): string {
  const budget = /^Bundle costs (\d+) cents; budget is (\d+)\.?$/.exec(v.message);
  if (budget) return `Bundle costs ${formatMoney(Number(budget[1]), currency)}; the budget is ${formatMoney(Number(budget[2]), currency)}.`;
  return v.message.replace(/\b(\d+) cents\b/g, (_, c: string) => formatMoney(Number(c), currency));
}
