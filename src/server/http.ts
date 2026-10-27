import { NextResponse } from "next/server";
import { SessionError } from "../app-logic/session";
import { PaymentRefused } from "../payments/checkout";
import { getRuntime } from "./runtime";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Map known failures to useful statuses; never echo anything beyond the error message. */
export function fail(e: unknown) {
  if (e instanceof SessionError) return json({ error: e.message }, 400);
  if (e instanceof PaymentRefused) return json({ error: e.message, violations: e.violations }, 409);
  return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 502);
}

export function sessionOr404(id: string) {
  return getRuntime().store.get(id);
}
