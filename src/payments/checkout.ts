import { createHash } from "node:crypto";
import { bundleCanonical } from "../core/digest";
import { verifyBundle } from "../core/rules";
import type { Bundle, Project, Violation } from "../core/types";
import type { CreatedOrder, createPayPalClient } from "./paypal";

export type PayPalClient = ReturnType<typeof createPayPalClient>;

/** A human's sign-off on one specific bundle. */
export interface Approval {
  approvedBy: string;
  approvedAt: string;
  /** Digest of the bundle that was shown to the approver. */
  bundleDigest: string;
}

export class PaymentRefused extends Error {
  constructor(
    message: string,
    readonly violations: Violation[] = [],
  ) {
    super(message);
    this.name = "PaymentRefused";
  }
}

/** Stable fingerprint of what is being bought; any change to an offer or price changes it. */
export function bundleDigest(bundle: Bundle): string {
  return createHash("sha256").update(bundleCanonical(bundle.offers)).digest("hex");
}

export function approve(bundle: Bundle, approvedBy: string, now: Date = new Date()): Approval {
  return { approvedBy, approvedAt: now.toISOString(), bundleDigest: bundleDigest(bundle) };
}

/**
 * The only route to a PayPal order. It re-verifies the bundle itself (it never trusts a
 * caller-supplied verdict) and requires an approval for exactly this bundle.
 */
export async function startCheckout(
  client: Pick<PayPalClient, "createOrder">,
  input: { project: Project; requiredAssetIds: string[]; bundle: Bundle; approval: Approval | undefined; today?: string; returnUrl?: string; cancelUrl?: string; idempotencyScope?: string },
): Promise<CreatedOrder> {
  const { project, requiredAssetIds, bundle, approval } = input;

  // Offer expiry is checked against the real date at the moment of purchase.
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const verdict = verifyBundle(project, requiredAssetIds, bundle, { today });
  if (!verdict.ok) throw new PaymentRefused("Bundle failed verification", verdict.violations);
  if (bundle.offers.length === 0) throw new PaymentRefused("Bundle is empty");

  if (!approval) throw new PaymentRefused("Bundle has not been approved");
  const digest = bundleDigest(bundle);
  if (approval.bundleDigest !== digest) throw new PaymentRefused("Approval does not match this bundle");

  return client.createOrder({
    amountCents: verdict.totalCents,
    currency: bundle.offers[0]!.currency,
    referenceId: project.name,
    description: `LicenseGraph licence bundle for ${project.name}`,
    // Same approved bundle in the same scope (e.g. one session), same key: a retry can never
    // create a second order, while a genuine second purchase of the same bundle still can.
    requestId: `lg-${digest.slice(0, 32)}${input.idempotencyScope ? `-${input.idempotencyScope}` : ""}`,
    returnUrl: input.returnUrl,
    cancelUrl: input.cancelUrl,
  });
}
