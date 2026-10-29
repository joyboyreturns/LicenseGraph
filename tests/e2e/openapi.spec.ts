import { expect, test } from "@playwright/test";

test("the running server publishes its own OpenAPI document, pointing at itself", async ({ request, baseURL }) => {
  const res = await request.get("/api/openapi.json");
  expect(res.status()).toBe(200);
  const spec = await res.json();
  expect(spec.openapi).toBe("3.1.0");
  expect(spec.paths["/api/llm"].post.responses["504"].description).toMatch(/deadline/);
  expect(spec.servers[0].url).toBe(baseURL);
  expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(["/api/sessions", "/api/sessions/{id}/refund", "/api/passports/{id}/verify"]));
  // A real run answers with the shape the document promises.
  const started = await request.post("/api/sessions", { data: { scenarioId: "documentary" } });
  expect(started.status()).toBe(201);
  const run = await started.json();
  for (const key of spec.components.schemas.RunCreated.required) expect(run, key).toHaveProperty(key);
});
