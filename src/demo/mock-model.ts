import type { ModelClient } from "../extraction/model";
import { cannedReply, fixtures } from "./fixtures";

/**
 * Offline stand-in for the model. It recognises the sample licences and answers as a careful
 * model would, so the whole app runs with no API key and no credits.
 */
export const demoModel: ModelClient = {
  async complete({ user }) {
    const match = fixtures.find((f) => user.includes(f.doc.text));
    if (!match) throw new Error("Demo mode only understands the built-in sample licences. Set AI_GATEWAY_API_KEY and LICENSEGRAPH_MODEL for live extraction.");
    return cannedReply(match);
  },
};
