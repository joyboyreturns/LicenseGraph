import type { Cents } from "../core/types";

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

const SANDBOX_HOST = "api-m.sandbox.paypal.com";

/** 1234 -> "12.34". Integer maths only; PayPal wants a decimal string. */
export function centsToValue(cents: Cents): string {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error(`Invalid amount in cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): PayPalConfig {
  const { PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret } = env;
  if (!clientId || !clientSecret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  return { clientId, clientSecret, baseUrl: env.PAYPAL_BASE_URL ?? `https://${SANDBOX_HOST}` };
}

export function createPayPalClient(config: PayPalConfig) {
  // Sandbox only: there is deliberately no live path.
  if (new URL(config.baseUrl).host !== SANDBOX_HOST) {
    throw new Error(`Refusing non-Sandbox PayPal host: ${config.baseUrl}`);
  }
  const doFetch = config.fetch ?? fetch;
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt) return token.value;
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const res = await doFetch(`${config.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`PayPal token request failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return token.value;
  }

  async function call(path: string, requestId: string, body?: unknown): Promise<any> {
    const res = await doFetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": requestId, // idempotency: retrying with the same id never double-charges
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`PayPal ${path} failed: ${res.status} ${JSON.stringify(json)}`);
    return json;
  }

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

    async captureOrder(orderId: string, requestId: string): Promise<CapturedOrder> {
      const json = await call(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, requestId);
      const capture = json.purchase_units?.[0]?.payments?.captures?.[0];
      if (!capture) throw new Error(`PayPal capture returned no capture (status ${json.status})`);
      return { id: json.id, status: json.status, captureId: capture.id, amount: capture.amount };
    },
  };
}
