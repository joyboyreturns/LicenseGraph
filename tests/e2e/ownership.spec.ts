import { expect, test } from "@playwright/test";
import { startScenario } from "./helpers";

test("only the browser that started a run can approve it, but anyone with the link can read it", async ({ page, browser }) => {
  const runUrl = await startScenario(page, "Podcast network");
  const id = runUrl.split("/run/")[1]!;

  const stranger = await browser.newContext();
  const api = stranger.request;
  const approve = await api.post(`/api/sessions/${id}/approve`, { data: { approvedBy: "Mallory" } });
  expect(approve.status()).toBe(403);
  expect((await approve.json()).error).toMatch(/another browser session/);
  expect((await api.get(`/api/sessions/${id}`)).status()).toBe(200);

  // The stranger's run list does not include it; the owner's does.
  expect((await (await api.get("/api/sessions")).json()).runs).toEqual([]);
  await page.goto("/dashboard");
  await expect(page.getByText("Signal & Noise podcast network").first()).toBeVisible();
  await stranger.close();
});
