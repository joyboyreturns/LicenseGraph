import { describe, expect, it } from "vitest";
import { cheapestBundle, licenceEndDates, whatIfBrief } from "../../src/mcp/tools";
import { runAgentSession, type Rpc, type Step } from "../../src/ui/lib/agent-console";
import { runExample } from "../mcp-fixtures";

const example = await runExample();
const data = { project: example.project, requiredAssetIds: example.requiredAssetIds, candidates: example.offers, currency: "USD" };

/** An MCP endpoint made from the real tool functions, so the session is checked against the real answers. */
const rpc: Rpc = async (method, params: any) => {
  if (method === "tools/list") return { result: { tools: ["check_licence_bundle", "cheapest_compliant_bundle", "what_if_brief", "licence_end_dates"].map((name) => ({ name })) } };
  const { name, arguments: args } = params;
  const out = name === "cheapest_compliant_bundle" ? cheapestBundle(args) : name === "what_if_brief" ? whatIfBrief(args) : licenceEndDates(args);
  return { result: { content: [{ type: "text", text: JSON.stringify(out) }] } };
};
const run = async (d = data, r = rpc) => {
  const steps: Step[] = [];
  await runAgentSession(r, d, (s) => steps.push(s));
  return steps;
};

describe("runAgentSession", () => {
  it("discovers the tools, prices the purchase, explores a change of scope and reads the end dates, with the real figures", async () => {
    const steps = await run();
    expect(steps.map((s) => s.tool)).toEqual(["tools/list", "cheapest_compliant_bundle", "what_if_brief", "licence_end_dates"]);
    expect(steps[1]!.result).toContain("$329.00 across 3 licences, proven minimal");
    expect(steps[1]!.result).toContain("could save up to $35.00 (a best case, not an offer)");
    expect(steps[2]!.intent).toBe("What if it were not for commercial use?");
    expect(steps[2]!.result).toMatch(/^\$294\.00, \$35\.00 less than the brief as written/);
    expect(steps[3]!.result).toMatch(/calendar reminder file/);
  });

  it("when nothing can be bought, says so and asks what dropping the blocking requirement would do", async () => {
    const blocked = { ...data, project: { ...data.project, requiresExclusive: true } };
    const steps = await run(blocked);
    expect(steps.map((s) => s.tool)).toEqual(["tools/list", "cheapest_compliant_bundle", "what_if_brief"]);
    expect(steps[1]!.result).toMatch(/Nothing can be bought as it stands/);
    expect(steps[1]!.result).toMatch(/If every licensor agreed/);
    expect(steps[2]!.intent).toBe("What if we did without exclusivity?");
    expect(steps[2]!.result).toMatch(/^\$329\.00/);
  });

  it("reports a server that does not answer a tool call instead of inventing a result", async () => {
    const broken: Rpc = async (method) => (method === "tools/list" ? { result: { tools: [] } } : { error: { message: "boom" } });
    await expect(run(data, broken)).rejects.toThrow("boom");
  });
});
