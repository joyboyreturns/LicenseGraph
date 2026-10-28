// Calls the real AI Gateway. Skipped unless RUN_GATEWAY_LIVE=1 (use `npm run test:gateway`).
// Runs each fixture the way the app does (up to 3 attempts, with the targeted follow-up), and only after
// assertModelIsFree confirms the model costs nothing. LIVE_ATTEMPTS=1 measures the raw single-attempt rate.
// Narrow the run with `-- -t photo` to send fewer requests.
import { describe, expect, it } from "vitest";
import { extractOffer } from "../src/extraction/extract";
import { createGatewayModel, gatewayConfigFromEnv } from "../src/extraction/model";
import { fixtures } from "../src/demo/fixtures";

describe.skipIf(!process.env.RUN_GATEWAY_LIVE)("extraction against the AI Gateway (live)", () => {
  it.each(fixtures)("extracts $doc.id with verified evidence", async (f) => {
    const model = createGatewayModel(gatewayConfigFromEnv());

    const result = await extractOffer(model, f.doc, process.env.LIVE_ATTEMPTS ? { attempts: Number(process.env.LIVE_ATTEMPTS) } : {});

    expect(result.problems).toEqual([]);
    expect(result.offer?.priceCents).toBe(f.expected.priceCents);
    // Strict: stated terms must match, and terms the text is silent on must stay blank.
    expect(result.offer?.terms).toEqual(f.expected.terms);
  }, 360_000); // up to three attempts, each possibly slow on a free model
});
