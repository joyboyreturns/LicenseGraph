// Calls the real AI Gateway. Skipped unless RUN_GATEWAY_LIVE=1 (use `npm run test:gateway`).
// Sends one request per fixture (no retries), and only after assertModelIsFree confirms the model costs nothing.
// Narrow the run with `-- -t photo` to send fewer requests.
import { describe, expect, it } from "vitest";
import { extractOffer } from "../src/extraction/extract";
import { createGatewayModel, gatewayConfigFromEnv } from "../src/extraction/model";
import { fixtures } from "./fixtures/licenses";

describe.skipIf(!process.env.RUN_GATEWAY_LIVE)("extraction against the AI Gateway (live)", () => {
  it.each(fixtures)("extracts $doc.id with verified evidence", async (f) => {
    const model = createGatewayModel(gatewayConfigFromEnv());

    const result = await extractOffer(model, f.doc, { attempts: 1 });

    expect(result.problems).toEqual([]);
    expect(result.offer?.priceCents).toBe(f.expected.priceCents);
    expect(result.offer?.terms).toEqual(f.expected.terms);
  }, 120_000);
});
