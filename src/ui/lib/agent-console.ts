import { formatMoney } from "./format";

/**
 * A scripted "agent" session against the MCP endpoint: discover the tools, price a purchase, explore a change of
 * scope, and read when the licences would end. It only calls the same tools any MCP client can, so what it shows
 * is what an agent really gets. It stops before buying: that is a person's decision.
 */

export type Rpc = (method: string, params?: unknown) => Promise<any>;

export interface AgentRunData {
  project: { termMonths: number; requiresExclusive?: boolean; needsSublicensing?: boolean; name: string };
  requiredAssetIds: string[];
  candidates: unknown[];
  currency: string;
}

export interface Step {
  /** The MCP method or tool, as an agent would name it. */
  tool: string;
  /** What the agent asked, in words. */
  intent: string;
  /** What came back, in one or two sentences. */
  result: string;
  /** The raw JSON the tool returned. */
  raw: unknown;
}

const toolResult = (reply: any) => {
  const text = reply?.result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error(reply?.error?.message ?? "The server did not answer the tool call.");
  return JSON.parse(text);
};

export async function runAgentSession(rpc: Rpc, data: AgentRunData, onStep: (s: Step) => void): Promise<void> {
  const money = (c: number) => formatMoney(c, data.currency);

  const listed = (await rpc("tools/list")).result?.tools?.map((t: { name: string }) => t.name) ?? [];
  onStep({ tool: "tools/list", intent: "What can I do here?", result: `${listed.length} tools: ${listed.join(", ")}.`, raw: listed });

  // The rules are a resource: read them before arguing with a verdict. An older server without it is simply skipped.
  const rules = (await rpc("resources/read", { uri: "licensegraph://rules" }).catch(() => undefined))?.result?.contents?.[0]?.text;
  if (typeof rules === "string" && rules.includes("\n## ")) {
    const count = rules.split("\n## ").length - 1;
    onStep({ tool: "resources/read", intent: "What are the rules my work will be checked against?", result: `${count} rules, each with when it applies and what a licence that says nothing about it gets. Silence never passes.`, raw: rules });
  }

  const base = { project: data.project, requiredAssetIds: data.requiredAssetIds, offers: data.candidates };
  const cheapest = toolResult(await rpc("tools/call", { name: "cheapest_compliant_bundle", arguments: base }));
  const plan = cheapest.plans?.find((p: { currency: string }) => p.currency === data.currency) ?? cheapest.plans?.[0];
  if (plan) {
    const top = cheapest.requirementCosts?.items?.[0];
    const levers: { savingCents: number }[] = cheapest.savingLevers ?? [];
    const saving = levers.reduce((n, l) => n + l.savingCents, 0);
    onStep({
      tool: "cheapest_compliant_bundle",
      intent: "What is the cheapest bundle that meets every requirement?",
      result: `${money(plan.totalCents)} across ${plan.offerIds.length} licences, proven minimal${top && top.extraCents > 0 ? `. The costliest requirement is ${top.label.toLowerCase()}, adding ${money(top.extraCents)}` : ""}${levers.length ? `. Asking ${levers.length} licensor${levers.length === 1 ? "" : "s"} to change terms could save up to ${money(saving)} (a best case, not an offer)` : ""}.`,
      raw: cheapest,
    });
  } else {
    const out = cheapest.ifLicensorsAgree;
    onStep({
      tool: "cheapest_compliant_bundle",
      intent: "What is the cheapest bundle that meets every requirement?",
      result: `Nothing can be bought as it stands: ${cheapest.gapRequests?.length ?? 0} asset${cheapest.gapRequests?.length === 1 ? "" : "s"} have no compliant licence.${out ? ` If every licensor agreed to the changes asked for, at their quoted prices, it would cost ${money(out.totalCents)}.` : ""}`,
      raw: cheapest,
    });
  }

  // Argue with one verdict: take an offer the cheapest bundle did not use and ask which rules it fails.
  const chosen = new Set<string>(plan?.offerIds ?? []);
  const unused = (data.candidates as { id: string }[]).find((o) => !chosen.has(o.id));
  // An older server without the tool is skipped, as with the rules resource.
  const verdict = unused ? await rpc("tools/call", { name: "evaluate_licence_offer", arguments: { project: data.project, offer: unused } }).then(toolResult).catch(() => undefined) : undefined;
  if (unused && verdict) {
    const failed: string[] = verdict.failedRules ?? [];
    onStep({
      tool: "evaluate_licence_offer",
      intent: `Why is ${unused.id} not in that bundle?`,
      result: verdict.compliant ? "It passes every rule; the bundle simply found a cheaper licence for that asset." : `It fails ${failed.length} rule${failed.length === 1 ? "" : "s"}: ${failed.join(", ")}.`,
      raw: verdict,
    });
  }

  // Explore a change of scope: drop what blocks a purchase, or else ask what commercial use costs.
  const dropped = plan ? undefined : { ...(data.project.requiresExclusive ? { requiresExclusive: false } : {}), ...(data.project.needsSublicensing ? { needsSublicensing: false } : {}) };
  const change = dropped && Object.keys(dropped).length ? dropped : { commercial: false };
  const asked = "commercial" in change ? "What if it were not for commercial use?" : `What if we did without ${Object.keys(change).map((k) => (k === "requiresExclusive" ? "exclusivity" : "sublicensing")).join(" and ")}?`;
  const what = toolResult(await rpc("tools/call", { name: "what_if_brief", arguments: { ...base, change } }));
  onStep({
    tool: "what_if_brief",
    intent: asked,
    result:
      what.totalCents === undefined
        ? `Still nothing compliant for ${(what.uncoveredAssets ?? []).join(", ") || "some assets"}.`
        : `${money(what.totalCents)}${what.deltaCents === undefined || what.deltaCents === 0 ? "" : what.deltaCents > 0 ? `, ${money(what.deltaCents)} more than the brief as written` : `, ${money(-what.deltaCents)} less than the brief as written`}${what.shifts?.length ? `; ${what.shifts.length} licence${what.shifts.length === 1 ? "" : "s"} would change` : ""}.`,
    raw: what,
  });

  // Only a bundle the rules accept has dates worth knowing.
  const best: string[] | undefined = plan?.offerIds;
  if (best) {
    const ends = toolResult(await rpc("tools/call", { name: "licence_end_dates", arguments: { offers: data.candidates, offerIds: best, projectName: data.project.name } }));
    const dated = (ends.ends ?? []).filter((e: { endsOn?: string }) => e.endsOn);
    onStep({
      tool: "licence_end_dates",
      intent: "When would each of those licences run out?",
      result: dated.length ? `First one ends ${dated[0].endsOn}; ${ends.ends.length - dated.length} of ${ends.ends.length} never end. A calendar reminder file is included.` : "All of them are perpetual.",
      raw: { boughtOn: ends.boughtOn, ends: ends.ends },
    });
  }
}

