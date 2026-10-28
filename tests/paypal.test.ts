import { describe, expect, it, vi } from "vitest";
import { centsToValue, configFromEnv, createPayPalClient } from "../src/payments/paypal";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const base = { clientId: "id", clientSecret: "secret", baseUrl: "https://api-m.sandbox.paypal.com" };

describe("centsToValue", () => {
  it("formats integer cents", () => {
    expect(centsToValue(1000)).toBe("10.00");
    expect(centsToValue(5)).toBe("0.05");
    expect(centsToValue(123456)).toBe("1234.56");
  });
  it("rejects non-integer or non-positive amounts", () => {
    expect(() => centsToValue(10.5)).toThrow();
    expect(() => centsToValue(0)).toThrow();
  });
});

describe("createPayPalClient", () => {
  it("refuses a non-Sandbox host", () => {
    expect(() => createPayPalClient({ ...base, baseUrl: "https://api-m.paypal.com" })).toThrow(/non-Sandbox/);
  });

  it.each(["http://api-m.sandbox.paypal.com", "https://user:secret@api-m.sandbox.paypal.com", "https://api-m.sandbox.paypal.com/other", "https://api-m.sandbox.paypal.com?redirect=evil"])("refuses unsafe Sandbox URL %s", (baseUrl) => {
    expect(() => createPayPalClient({ ...base, baseUrl })).toThrow(/non-Sandbox/);
  });

  it("refuses unsupported minor-unit currencies before making any network request", async () => {
    const fetchMock = vi.fn();
    const client = createPayPalClient({ ...base, fetch: fetchMock });
    await expect(client.createOrder({ amountCents: 100, currency: "JPY", referenceId: "r", description: "d", requestId: "key" })).rejects.toThrow(/Unsupported currency/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes a trailing slash on the Sandbox base URL", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ access_token: "t", expires_in: 3600 })).mockResolvedValueOnce(json({ name: "ORDER_NOT_APPROVED" }, 422));
    await createPayPalClient({ ...base, baseUrl: `${base.baseUrl}/`, fetch: fetchMock }).captureOrder("ORD1", "key").catch(() => undefined);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`${base.baseUrl}/v1/oauth2/token`, `${base.baseUrl}/v2/checkout/orders/ORD1/capture`]);
  });

  it("creates an order with an idempotency key and returns the approval link", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ id: "ORD1", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://pp/approve" }] }));
    const client = createPayPalClient({ ...base, fetch: fetchMock as unknown as typeof fetch });

    const order = await client.createOrder({ amountCents: 2500, currency: "USD", referenceId: "r", description: "d", requestId: "req-1" });

    expect(order).toEqual({ id: "ORD1", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://pp/approve" });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(init.headers["PayPal-Request-Id"]).toBe("req-1");
    expect(JSON.parse(init.body).purchase_units[0].amount).toEqual({ currency_code: "USD", value: "25.00" });
  });

  it("captures an order and reuses the cached token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ id: "ORD1", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "approve", href: "https://pp/a" }] }))
      .mockResolvedValueOnce(
        json({ id: "ORD1", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "25.00" } }] } }] }),
      );
    const client = createPayPalClient({ ...base, fetch: fetchMock as unknown as typeof fetch });
    await client.createOrder({ amountCents: 2500, currency: "USD", referenceId: "r", description: "d", requestId: "a" });
    const cap = await client.captureOrder("ORD1", "b");

    expect(cap.captureId).toBe("CAP1");
    expect(cap.amount).toEqual({ currency: "USD", value: "25.00" });
    expect(fetchMock).toHaveBeenCalledTimes(3); // one token fetch only
  });

  it("surfaces PayPal errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ access_token: "tok", expires_in: 3600 })).mockResolvedValueOnce(json({ name: "UNPROCESSABLE_ENTITY" }, 422));
    const client = createPayPalClient({ ...base, fetch: fetchMock as unknown as typeof fetch });
    await expect(client.captureOrder("ORD1", "x")).rejects.toThrow(/422/);
  });

  it("keeps echoed recipient addresses out of errors that may enter a public ledger", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ access_token: "t", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ name: "VALIDATION_ERROR", message: "Invalid recipient private@example.test", details: [{ issue: "INVALID_RECEIVER", value: "private@example.test" }] }, 400));
    const error = await createPayPalClient({ ...base, fetch: fetchMock }).createPayout({ batchId: "b", subject: "s", items: [] }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("INVALID_RECEIVER");
    expect((error as Error).message).not.toContain("private@example.test");
  });

  it.each(["PENDING", "DECLINED", "FAILED"])("refuses a %s capture even when the order is completed", async (status) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ access_token: "t", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ id: "ORD1", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "C", status, amount: { currency_code: "USD", value: "25.00" } }] } }] }));
    await expect(createPayPalClient({ ...base, fetch: fetchMock }).captureOrder("ORD1", "key")).rejects.toThrow(/not completed/);
  });
});

describe("configFromEnv", () => {
  it("requires credentials and defaults to the Sandbox host", () => {
    expect(() => configFromEnv({})).toThrow();
    expect(configFromEnv({ PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b" }).baseUrl).toBe("https://api-m.sandbox.paypal.com");
  });
});
