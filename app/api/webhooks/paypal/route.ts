import { fail, json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";
import { handleWebhookEvent, readWebhookHeaders, type WebhookEvent } from "@/src/payments/webhook";

export const dynamic = "force-dynamic";

const MAX_BODY = 256_000;

/**
 * PayPal's push notifications. A delivery is acted on only after PayPal itself confirms its signature
 * for this webhook id; anything else is refused before it can touch a run.
 */
export async function POST(req: Request) {
  const { webhookId, deps, store } = getRuntime();
  const verify = deps.payments?.verifyWebhookSignature;
  if (!webhookId || !verify) return json({ error: "Webhooks are not configured on this server." }, 503);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "Body too large." }, 413);
  const headers = readWebhookHeaders(req.headers);
  if (!headers) return json({ error: "Missing or invalid PayPal signature headers." }, 400);
  let event: WebhookEvent;
  try {
    event = JSON.parse(raw);
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("not an object");
  } catch {
    return json({ error: "The body is not a JSON event." }, 400);
  }

  try {
    // If PayPal cannot be reached this throws, and the 502 below makes PayPal deliver the event again.
    if (!(await verify({ headers, webhookId, event }))) return json({ error: "The signature could not be verified." }, 401);
    return json({ received: true, ...(await handleWebhookEvent(event, { store, deps })) });
  } catch (e) {
    return fail(e);
  }
}
