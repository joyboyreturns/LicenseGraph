import { privateRequest } from "@/src/marketplace/http";
import { json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const privateResponse = await privateRequest(req);
  if (privateResponse) return privateResponse;
  const { mode, model, paymentsEnabled, paymentsMode, llmProxy, intakeModel, passportSecret, appUrl, webhookId, deps } = getRuntime();
  return json({ mode, model, paymentsEnabled, paymentsMode, assistant: Boolean(llmProxy), intakeModel: Boolean(intakeModel), passportSigned: Boolean(passportSecret), webhooks: Boolean(webhookId && deps.payments?.verifyWebhookSignature), appUrl });
}
