/** Small typed fetch wrapper for the app's own JSON API. Errors carry the server's `{ error }` message. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface AppConfig {
  mode: "demo" | "live";
  model?: string;
  paymentsEnabled: boolean;
  paymentsMode: "paypal-sandbox" | "simulator" | "none";
  assistant: boolean;
  intakeModel: boolean;
  passportSigned: boolean;
  appUrl: string;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { Accept: "application/json", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0, null);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string" ? (body as { error: string }).error : `Request failed (${res.status}).`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

export const errorMessage = (e: unknown, fallback = "Something went wrong.") => (e instanceof Error && e.message ? e.message : fallback);
