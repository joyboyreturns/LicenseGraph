import { expect, test } from "@playwright/test";
import { accessibilityViolations } from "./helpers";

test("the Agents page lists the tools live, and plays an agent session whose figures come from the MCP endpoint", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/agents");
  await expect(page.getByRole("heading", { name: "Agents can shop. Only people can spend." })).toBeVisible();
  // The tools are read from the server's own MCP endpoint, not written into the page.
  const tools = page.getByRole("region", { name: "What it finds there" });
  await expect(tools.getByText("cheapest_compliant_bundle")).toBeVisible({ timeout: 20_000 });
  await expect(tools.getByText("start_licence_purchase")).toBeVisible();
  // The configuration points at this server.
  await expect(page.getByText(/"url": "http:\/\/localhost:3300\/api\/mcp"/)).toBeVisible();

  await page.getByRole("button", { name: "Run as an agent" }).click();
  const steps = page.getByRole("list", { name: "What the agent did" });
  await expect(steps.getByText("$329.00 across 3 licences, proven minimal")).toBeVisible({ timeout: 30_000 });
  await expect(steps.getByText("What are the rules my work will be checked against?")).toBeVisible();
  await expect(steps.getByText(/11 rules, each with when it applies/)).toBeVisible();
  await expect(steps.getByText("What if it were not for commercial use?")).toBeVisible();
  await expect(steps.getByText(/less than the brief as written/)).toBeVisible();
  await expect(steps.getByText("Here the agent stops.")).toBeVisible();
  await expect(steps.getByRole("link", { name: "Open the run this session priced." })).toBeVisible();

  // A brief nothing can satisfy: the agent is told so, and what a yes would cost.
  await page.getByLabel("Brief the agent with").selectOption({ label: "Exclusive theme tune" });
  await page.getByRole("button", { name: "Run as an agent" }).click();
  await expect(steps.getByText(/Nothing can be bought as it stands: 3 assets have no compliant licence/)).toBeVisible({ timeout: 30_000 });
  await expect(steps.getByText(/would cost \$690\.00/)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});
