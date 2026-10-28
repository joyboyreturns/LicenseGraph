import type { Cents } from "../core/types";
import { supportsCentCurrency } from "../core/money";

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface CreatedOrder {
  id: string;
  status: string;
  approveUrl: string;
}

export interface CapturedOrder {
  id: string;
  status: string;
  captureId: string;
  amount: { currency: string; value: string };
}

export interface RefundedCapture {
  id: string;
  status: string;
  /** PayPal's refund response usually leaves the amount out; a full refund is then the captured amount. */
  amount?: { currency: string; value: string };
}

export interface PayoutItemInput {
  itemId: string;
  receiver: string;
  amountCents: Cents;
  currency: string;
  note: string;
}

export interface PayoutStatus {
  batchId: string;
  /** PENDING, PROCESSING, SUCCESS, DENIED, CANCELED. */
  status: string;
  items: { itemId: string; status: string; receiver: string; error?: string }[];
}

const SANDBOX_HOST = "api-m.sandbox.paypal.com";

class PayPalRequestError extends Error {
  constructor(path: string, readonly status: number, readonly body: any) {
    const codes = [body?.name, ...(Array.isArray(body?.details) ? body.details.map((d: any) => d?.issue) : [])]
      .filter((code): code is string => typeof code === "string" && /^[A-Z0-9_]+$/.test(code));
    // The raw response is retained privately for duplicate recovery. Messages may be public
    // ledger entries, so never include echoed recipients, request values or provider prose.
    super(`PayPal ${path} failed: ${status} ${codes.join(", ")}`.trim());
  }
}

/** 1234 -> "12.34". Integer maths only; PayPal wants a decimal string. */
export function centsToValue(cents: Cents): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error(`Invalid amount in cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): PayPalConfig {
  const { PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret } = env;
  if (!clientId || !clientSecret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  return { clientId, clientSecret, baseUrl: env.PAYPAL_BASE_URL ?? `https://${SANDBOX_HOST}` };
}

export function createPayPalClient(config: PayPalConfig) {
  // Sandbox only: there is deliberately no live path.
  const base = new URL(config.baseUrl);
  if (base.origin !== `https://${SANDBOX_HOST}` || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error(`Refusing non-Sandbox PayPal host: ${config.baseUrl}`);
  }
  const doFetch = config.fetch ?? fetch;
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt) return token.value;
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const res = await doFetch(`${base.origin}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`PayPal token request failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return token.value;
  }

  async function request(method: "GET" | "POST", path: string, requestId?: string, body?: unknown): Promise<any> {
    const res = await doFetch(`${base.origin}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
        // Idempotency: retrying with the same id never double-charges.
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalRequestError(path, res.status, json);
    return json;
  }
  const call = (path: string, requestId: string, body?: unknown) => request("POST", path, requestId, body);

  return {
    async createOrder(input: {
      amountCents: Cents;
      currency: string;
      referenceId: string;
      description: string;
      requestId: string;
      returnUrl?: string;
      cancelUrl?: string;
    }): Promise<CreatedOrder> {
      if (!supportsCentCurrency(input.currency)) throw new Error("Unsupported currency for settlement in cents");
      const json = await call("/v2/checkout/orders", input.requestId, {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.referenceId,
            description: input.description,
            amount: { currency_code: input.currency, value: centsToValue(input.amountCents) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: "PAY_NOW",
              return_url: input.returnUrl ?? "https://example.com/return",
              cancel_url: input.cancelUrl ?? "https://example.com/cancel",
            },
          },
        },
      });
      const link = (json.links as { rel: string; href: string }[]).find((l) => l.rel === "payer-action" || l.rel === "approve");
      if (!link) throw new Error("PayPal order has no approval link");
      return { id: json.id, status: json.status, approveUrl: link.href };
    },

    /** Pay several recipients in one batch. `batchId` doubles as the idempotency key. */
    async createPayout(input: { batchId: string; subject: string; items: PayoutItemInput[] }): Promise<{ batchId: string; status: string }> {
      if (input.items.some((i) => !supportsCentCurrency(i.currency))) throw new Error("Unsupported payout currency for settlement in cents");
      let json;
      try {
        json = await call("/v1/payments/payouts", input.batchId, {
          sender_batch_header: { sender_batch_id: input.batchId, email_subject: input.subject },
          items: input.items.map((i) => ({
            recipient_type: "EMAIL",
            receiver: i.receiver,
            amount: { value: centsToValue(i.amountCents), currency: i.currency },
            note: i.note,
            sender_item_id: i.itemId,
          })),
        });
      } catch (error) {
        if (!(error instanceof PayPalRequestError) || !JSON.stringify(error.body).includes("BATCH_ID_ALREADY_EXISTS")) throw error;
        const links = [...(error.body.links ?? []), ...(error.body.details ?? []).flatMap((d: any) => d.links ?? [])];
        // PayPal supplies the original batch on duplicate submissions. Restrict the recovery
        // link to the Sandbox batch endpoint before sending a bearer token to it.
        const original = links.find((l: any) => {
          try {
            const url = new URL(l.href);
            return url.origin === base.origin && !url.username && !url.password && /^\/v1\/payments\/payouts\/[A-Za-z0-9-]+$/.test(url.pathname) && !url.search && !url.hash;
          } catch { return false; }
        });
        if (!original) throw error;
        json = await request("GET", new URL(original.href).pathname);
        if (json.batch_header?.sender_batch_header?.sender_batch_id !== input.batchId) throw new Error("Recovered payout does not match the original sender batch id");
      }
      return { batchId: json.batch_header.payout_batch_id, status: json.batch_header.batch_status };
    },

    async getPayout(batchId: string): Promise<PayoutStatus> {
      const json = await request("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
      return {
        batchId: json.batch_header.payout_batch_id,
        status: json.batch_header.batch_status,
        items: (json.items ?? []).map((i: any) => ({ itemId: i.payout_item?.sender_item_id, status: i.transaction_status, receiver: i.payout_item?.receiver, error: i.errors?.name })),
      };
    },

    /** Refund a whole capture. The request id makes a retry return the same refund instead of a second one. */
    async refundCapture(captureId: string, requestId: string): Promise<RefundedCapture> {
      const json = await call(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, requestId, { note_to_payer: "Your LicenseGraph licence purchase was not completed, so it has been refunded." });
      if (json.status !== "COMPLETED") throw new Error(`PayPal refund is not completed (status ${String(json.status)})`);
      return { id: json.id, status: json.status, ...(json.amount?.value ? { amount: { currency: json.amount.currency_code, value: json.amount.value } } : {}) };
    },

    async captureOrder(orderId: string, requestId: string): Promise<CapturedOrder> {
      const json = await call(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, requestId);
      const capture = json.purchase_units?.[0]?.payments?.captures?.[0];
      if (!capture) throw new Error(`PayPal capture returned no capture (status ${json.status})`);
      if (json.status !== "COMPLETED" || capture.status !== "COMPLETED") throw new Error("PayPal capture is not completed; no fulfilment is allowed yet");
      return { id: json.id, status: capture.status, captureId: capture.id, amount: { currency: capture.amount.currency_code, value: capture.amount.value } };
    },
  };
}
