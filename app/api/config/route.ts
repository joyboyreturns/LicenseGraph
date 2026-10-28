import { json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

export function GET() {
  const { mode, model, paymentsEnabled, paymentsMode, llmProxy, intakeModel, passportSecret, appUrl, webhookId, deps } = getRuntime();
  return json({ mode, model, paymentsEnabled, paymentsMode, assistant: Boolean(llmProxy), intakeModel: Boolean(intakeModel), passportSigned: Boolean(passportSecret), webhooks: Boolean(webhookId && deps.payments?.verifyWebhookSignature), appUrl });
}
