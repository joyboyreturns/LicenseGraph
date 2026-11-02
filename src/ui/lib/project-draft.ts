import type { Project } from "../../core/types";

export interface ProjectDraft {
  name: string;
  commercial: boolean;
  worldwide: boolean;
  territories: string;
  termMonths: string;
  budget: string;
  mediums: string[];
  cannotCredit: boolean;
  needsSublicensing: boolean;
  requiresExclusive: boolean;
}

/** Convert decimal text to cents without rounding a user's limit or multiplying a fraction. */
export function budgetFromText(text: string): { ok: true; cents?: number } | { ok: false; message: string } {
  const value = text.trim();
  if (!value) return { ok: true };
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) {
    return { ok: false, message: "Enter the budget in USD with at most two decimal places, for example 2500.50." };
  }
  const [whole = "", fraction = ""] = value.split(".");
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return { ok: false, message: "The budget is too large to represent safely in cents." };
  return { ok: true, cents };
}

/** Validate before moving to licence intake, and again before submitting the same project. */
export function projectFromDraft(draft: ProjectDraft): { ok: true; project: Project } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const name = draft.name.trim();
  if (!name || name.length > 120) problems.push("Give the project a name of 1 to 120 characters.");
  const aliases: Record<string, string> = { UK: "GB", USA: "US", WORLDWIDE: "WORLD" };
  const territories = draft.worldwide ? ["WORLD"] : [...new Set(draft.territories.trim().split(/[,\s]+/).filter(Boolean).map((t) => aliases[t.toUpperCase()] ?? t.toUpperCase()))];
  if (!territories.length || territories.length > 250 || territories.some((t) => !/^(WORLD|[A-Z]{2})$/.test(t))) {
    problems.push("Choose worldwide or enter country codes such as US, CA or GB.");
  }
  const term = Number(draft.termMonths);
  if (!/^\d+$/.test(draft.termMonths) || !Number.isSafeInteger(term) || term < 1 || term > 1200) {
    problems.push("The term must be a whole number from 1 to 1,200 months.");
  }
  const budget = budgetFromText(draft.budget);
  if (!budget.ok) problems.push(budget.message);
  if (problems.length || !budget.ok) return { ok: false, problems };
  return {
    ok: true,
    project: {
      name,
      commercial: draft.commercial,
      territories: territories.includes("WORLD") ? ["WORLD"] : territories,
      termMonths: term,
      budgetCents: budget.cents,
      mediums: draft.mediums.length ? [...draft.mediums] : undefined,
      canCredit: draft.cannotCredit ? false : undefined,
      needsSublicensing: draft.needsSublicensing || undefined,
      requiresExclusive: draft.requiresExclusive || undefined,
    },
  };
}
