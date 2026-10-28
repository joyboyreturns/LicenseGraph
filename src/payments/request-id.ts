import { createHash } from "node:crypto";

/** PayPal request ids are at most 38 characters, including the operation prefix. */
export function paymentRequestId(operation: "order" | "capture" | "payout" | "refund", scope: string): string {
  return `lg-${operation[0]}-${createHash("sha256").update(scope).digest("hex").slice(0, 32)}`;
}
