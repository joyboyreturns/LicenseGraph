import { completePayment, refreshPayouts, refundSettled, SessionError, type Deps, type SessionStore } from "../app-logic/session";
import type { WebhookHeaders } from "./paypal";

/**
 * What PayPal tells this server on its own, instead of waiting for the buyer's browser or a page poll.
 * Nothing here is trusted until PayPal has confirmed the signature (see `readWebhookHeaders` and the
 * client's `verifyWebhookSignature`). Every action is one the app already takes, guarded the same way:
 *  - the buyer approved the order  -> capture it (so closing the tab after approving still completes the purchase)
 *  - a payout batch changed         -> bring the run's payout status up to date
 *  - the payment was refunded or reversed outside this app -> write it into the ledger, so the Licence
 *    Passport stops claiming the licences are covered
 */

/** Read PayPal's transmission headers; undefined when any is missing or the certificate is not on paypal.com. */
export function readWebhookHeaders(h: Headers): WebhookHeaders | undefined {
  const get = (name: string) => h.get(name)?.trim() ?? "";
  const headers: WebhookHeaders = {
    authAlgo: get("paypal-auth-algo"),
    certUrl: get("paypal-cert-url"),
    transmissionId: get("paypal-transmission-id"),
    transmissionSig: get("paypal-transmission-sig"),
    transmissionTime: get("paypal-transmission-time"),
  };
  if (Object.values(headers).some((v) => !v)) return undefined;
  try {
    const cert = new URL(headers.certUrl);
    if (cert.protocol !== "https:" || !/(^|\.)paypal\.com$/.test(cert.hostname)) return undefined;
  } catch {
    return undefined;
  }
  return headers;
}

export interface WebhookEvent {
  id?: string;
  event_type?: string;
  resource?: any;
}

export type WebhookOutcome = { handled: string; runId?: string } | { ignored: string };

const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** The capture a refund or reversal belongs to: PayPal links it as "up", and a capture event carries it directly. */
function captureIdOf(resource: any): string | undefined {
  const up = (Array.isArray(resource?.links) ? resource.links : []).find((l: any) => l?.rel === "up");
  return /\/captures\/([A-Za-z0-9-]+)/.exec(text(up?.href) ?? "")?.[1] ?? text(resource?.supplementary_data?.related_ids?.capture_id);
}

export async function handleWebhookEvent(event: WebhookEvent, ctx: { store: SessionStore; deps: Deps }): Promise<WebhookOutcome> {
  const { store, deps } = ctx;
  const sessions = store.list();
  const type = text(event.event_type) ?? "";
  const resource = event.resource ?? {};

  if (type === "CHECKOUT.ORDER.APPROVED") {
    const orderId = text(resource.id);
    const session = sessions.find((s) => s.order?.id === orderId);
    if (!session) return { ignored: "no run has this order" };
    if (session.phase !== "order_created") return { ignored: "this run's order is not waiting to be captured" };
    try {
      await completePayment(session, deps);
    } catch (e) {
      // A refusal the app itself explains (not approved yet, capture did not match) is final; anything else is worth a retry from PayPal.
      if (e instanceof SessionError) return { ignored: e.message };
      throw e;
    }
    return { handled: "captured the approved order", runId: session.id };
  }

  if (type.startsWith("PAYMENT.PAYOUTSBATCH.") || type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    const batchId = text(resource.batch_header?.payout_batch_id) ?? text(resource.payout_batch_id);
    const session = sessions.find((s) => s.payouts?.batchId === batchId);
    if (!session) return { ignored: "no run has this payout batch" };
    session.payoutsCheckedAt = undefined;
    await refreshPayouts(session, deps);
    return { handled: "refreshed the payout status", runId: session.id };
  }

  if (type === "PAYMENT.CAPTURE.REFUNDED" || type === "PAYMENT.CAPTURE.REVERSED") {
    const captureId = captureIdOf(resource);
    const session = sessions.find((s) => captureId !== undefined && s.capture?.captureId === captureId);
    if (!session) return { ignored: "no run has this capture" };
    // PayPal also reports the refunds this app makes itself; wait for ours to be recorded before deciding.
    await refundSettled(session);
    if (session.refund || session.phase === "refunded") return { ignored: "this is the refund the app made itself" };
    if (event.id && session.ledger.events().some((e) => e.kind === "payment_reversed" && e.payload.eventId === event.id)) return { ignored: "already recorded" };
    const amount = resource.amount?.value ? { currency: text(resource.amount.currency_code) ?? text(resource.amount.currency) ?? "", value: String(resource.amount.value) } : null;
    session.ledger.append("payment_reversed", { eventId: event.id ?? null, eventType: type, captureId, resourceId: text(resource.id) ?? null, amount });
    session.onChange?.();
    return { handled: "recorded a payment reversal", runId: session.id };
  }

  return { ignored: `${type || "unknown"} events are not used` };
}
