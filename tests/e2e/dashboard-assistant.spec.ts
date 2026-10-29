import { expect, test } from "@playwright/test";

test("the dashboard assistant executes a validated tool, renders the widget and keeps it after reloading", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Exercise the real assistant and adapter with deterministic responses; no gateway key or external model call is needed.
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), assistant: true } });
  });
  let calls = 0;
  await page.route("**/api/llm", async (route) => {
    calls++;
    const request = route.request().postDataJSON();
    expect(request.model).toBeUndefined();
    expect(request.messages[0].content).toContain("Chosen price [assets.chosenPrice]");
    expect(request.messages[0].content).not.toContain("assets.assets.chosenPrice");
    expect(request.tools.some((tool: { function: { name: string } }) => tool.function.name === "create_kpi")).toBe(true);
    if (calls === 1) {
      await route.fulfill({ json: { message: { role: "assistant", content: null, tool_calls: [{ id: "demo-kpi", type: "function", function: { name: "create_kpi", arguments: JSON.stringify({ title: "Demo verified spend", value: "assets.chosenPrice", aggregation: "sum" }) } }] } } });
    } else {
      expect(calls).toBe(2);
      expect(request.messages.some((message: { role: string; tool_call_id?: string }) => message.role === "tool" && message.tool_call_id === "demo-kpi")).toBe(true);
      await route.fulfill({ json: { message: { role: "assistant", content: "Added the Demo verified spend KPI." } } });
    }
  });

  const { id } = await (await page.request.post("/api/sessions", { data: { scenarioId: "documentary" } })).json();
  await page.goto(`/dashboard?session=${id}`);
  await page.getByRole("table", { name: /How many times each rule rejected each asset/ }).waitFor();
  await page.getByRole("button", { name: "Edit dashboard", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Message input", exact: true });
  if (!(await input.isVisible())) await page.getByRole("button", { name: "AI Assistant", exact: true }).click();
  await input.fill("Add a KPI titled Demo verified spend using assets.chosenPrice with sum aggregation.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Demo verified spend", { exact: true })).toBeVisible();
  await expect(page.getByText("Added the Demo verified spend KPI.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("licensegraph.studio.run.v1");
    return raw ? JSON.parse(raw).pages.some((p: { widgets: Record<string, { format?: { title?: { text?: string } } }> }) => Object.values(p.widgets).some((w) => w.format?.title?.text === "Demo verified spend")) : false;
  })).toBe(true);
  await page.reload();
  await expect(page.getByText("Demo verified spend", { exact: true })).toBeVisible();
  expect(calls).toBe(2);
  expect(errors).toEqual([]);
});
