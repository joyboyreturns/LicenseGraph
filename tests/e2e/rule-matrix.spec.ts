import { expect, test } from "@playwright/test";

test("the custom rule matrix widget shows which rule rejected which asset on a run's dashboard", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const started = await request.post("/api/sessions", { data: { scenarioId: "documentary" } });
  const { id } = await started.json();
  await expect.poll(async () => (await (await request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");
  const rejections = (await (await request.get(`/api/sessions/${id}`)).json()).events.filter((e: { kind: string }) => e.kind === "rejected").flatMap((e: { payload: { violations: { assetId?: string; rule: string }[] } }) => e.payload.violations);
  expect(rejections.length).toBeGreaterThan(0);

  await page.goto(`/dashboard?session=${id}`);
  const grid = page.getByRole("table", { name: /How many times each rule rejected each asset/ });
  await expect(grid).toBeVisible({ timeout: 30_000 });
  // Every rejection recorded in the ledger appears in the grid exactly once: the cell counts add up.
  const counts = await grid.locator("tbody td").allInnerTexts();
  const total = counts.map((t) => Number(t) || 0).reduce((a, b) => a + b, 0);
  expect(total).toBe(rejections.length);
  await expect(grid.locator("thead th").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the portfolio dashboard has the rule matrix too, across every run", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Started through the page's own context so this browser owns the run, and the portfolio lists it.
  const started = await page.request.post("/api/sessions", { data: { scenarioId: "documentary" } });
  const { id } = await started.json();
  await expect.poll(async () => (await (await page.request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");
  await page.goto("/dashboard?portfolio=1");
  const grid = page.getByRole("table", { name: /How many times each rule rejected each asset/ });
  await expect(grid).toBeVisible({ timeout: 30_000 });
  expect((await grid.locator("tbody td").allInnerTexts()).some((t) => Number(t) > 0)).toBe(true);
  expect(errors).toEqual([]);
});


test("the custom licence timeline widget draws a bar for every licence a paid run bought, with its end date", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const started = await page.request.post("/api/sessions", { data: { scenarioId: "podcast" } });
  const { id } = await started.json();
  await expect.poll(async () => (await (await page.request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");
  await page.request.post(`/api/sessions/${id}/approve`, { data: { approvedBy: "Kiran" } });
  const paid = await (await page.request.post(`/api/sessions/${id}/pay`)).json();
  await page.request.post(`/api/simulator/orders/${paid.order.id}`);
  await page.request.post(`/api/sessions/${id}/capture`);

  await page.goto("/dashboard?portfolio=1");
  const timeline = page.getByRole("list", { name: "Licence end dates" });
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  // The podcast bundle has three licences: a 36 month song, perpetual cover art, and a 36 month voiceover.
  await expect(timeline.getByRole("listitem")).toHaveCount(3);
  await expect(timeline.getByRole("img", { name: /Tapeloop · song: .* to \d{4}-\d{2}-\d{2}, \d+ days left/ })).toBeVisible();
  await expect(timeline.getByRole("img", { name: /Greyscale Lane · image: perpetual/ })).toBeVisible();

  // The same run's payouts, drawn as money flowing to each creator: $340 + $140 + $210 = $690.
  const flow = page.getByRole("img", { name: /^Where the \$690\.00 went:/ });
  await expect(flow).toBeVisible();
  await expect(flow).toHaveAccessibleName(/Tapeloop \$340\.00/);
  await expect(flow).toHaveAccessibleName(/Greyscale Lane \$140\.00/);
  await expect(flow).toHaveAccessibleName(/Marlow Voice \$210\.00/);
  expect(errors).toEqual([]);
});
