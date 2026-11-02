import { describe, expect, it } from "vitest";
import { budgetFromText, projectFromDraft, type ProjectDraft } from "../../src/ui/lib/project-draft";

const draft: ProjectDraft = {
  name: "  Release  ", commercial: true, worldwide: false, territories: "US, uk, US", termMonths: "12", budget: "0.29",
  mediums: ["web"], cannotCredit: true, needsSublicensing: true, requiresExclusive: true,
};

describe("custom project budget", () => {
  it.each([["0", 0], ["0.29", 29], ["0.57", 57], ["1.01", 101], [".50", 50], ["12.", 1200], [" 2500.50 ", 250050], ["90071992547409.91", Number.MAX_SAFE_INTEGER]] as const)("preserves %s exactly in integer cents", (text, cents) => {
    expect(budgetFromText(text)).toEqual({ ok: true, cents });
  });
  it("allows an unstated limit", () => expect(budgetFromText("  ")).toEqual({ ok: true }));
  it.each(["1e3", "1..2", "0.009", "-5", "Infinity", ".", "USD 50", "90071992547409.92", "9".repeat(300)])("refuses malformed or unrepresentable limits: %s", (text) => {
    expect(budgetFromText(text).ok).toBe(false);
  });
});

describe("custom project requirements", () => {
  it("normalizes country aliases and preserves the stated limits without mutating the draft", () => {
    const original = structuredClone(draft);
    const checked = projectFromDraft(draft);
    expect(checked).toMatchObject({ ok: true, project: {
      name: "Release", commercial: true, territories: ["US", "GB"], termMonths: 12, budgetCents: 29,
      mediums: ["web"], canCredit: false, needsSublicensing: true, requiresExclusive: true,
    } });
    expect(draft).toEqual(original);
    if (checked.ok) checked.project.mediums!.push("audio");
    expect(draft.mediums).toEqual(["web"]);
  });
  it.each(["0", "-1", "1.5", "1e2", "1201", "", "9".repeat(100)])("refuses a term the run API cannot accept: %s", (termMonths) => {
    expect(projectFromDraft({ ...draft, termMonths })).toMatchObject({ ok: false, problems: [expect.stringContaining("1 to 1,200")] });
  });
  it.each(["", "United States", "U$, CA"]) ("explains invalid territory input: %s", (territories) => {
    expect(projectFromDraft({ ...draft, territories })).toMatchObject({ ok: false, problems: [expect.stringContaining("country codes")] });
  });
  it("keeps a zero-dollar project budget and a worldwide selection", () => {
    expect(projectFromDraft({ ...draft, budget: "0", worldwide: true, territories: "invalid" })).toMatchObject({ ok: true, project: { budgetCents: 0, territories: ["WORLD"] } });
  });
  it("reports every invalid field together", () => {
    const checked = projectFromDraft({ ...draft, name: "", termMonths: "1.5", territories: "", budget: "1.001" });
    expect(!checked.ok && checked.problems).toHaveLength(4);
  });
});
