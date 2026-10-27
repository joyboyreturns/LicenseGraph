import { NextResponse } from "next/server";
import { SessionError } from "../app-logic/session";
import { PaymentRefused } from "../payments/checkout";
import { getRuntime } from "./runtime";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Map known failures to useful statuses; never echo anything beyond the error message. */
export function fail(e: unknown) {
  if (e instanceof SessionError) return json({ error: e.message }, 400);
  if (e instanceof PaymentRefused) return json({ error: e.message, violations: e.violations }, 409);
  const message = e instanceof Error ? e.message : "Unexpected error";
  // PayPal answers 422 ORDER_NOT_APPROVED until the buyer has approved: a normal waiting state, not a gateway failure.
  if (message.includes("ORDER_NOT_APPROVED")) return json({ error: "The buyer has not approved this order yet. Approve it at checkout, then try again.", code: "ORDER_NOT_APPROVED" }, 409);
  return json({ error: message }, 502);
}

export function sessionOr404(id: string) {
  return getRuntime().store.get(id);
}

import { ownsRun } from "./owner";

/** 403 unless the request comes from the browser that created the run. */
export function forbidUnlessOwner(session: { ownerId?: string }, req: Request) {
  return ownsRun(session, req) ? undefined : json({ error: "This run belongs to another browser session. Start your own run to approve or pay." }, 403);
}
