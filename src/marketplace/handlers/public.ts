import { z } from "zod";
import { AccessError } from "../../auth/identity";
import { hashSecret } from "../../storage/crypto";
import { readWebhookHeaders } from "../../payments/webhook";
import { paymentReversed } from "../service";
import { applyWebhook } from "../webhooks";
import type { PrivateRuntime } from "../runtime";
import { json, readJson } from "./common";
import { passport } from "./views";

async function receiveWebhook(rt: PrivateRuntime, request: Request) {
  const headers = readWebhookHeaders(request.headers);
  if (!headers || !process.env.PAYPAL_WEBHOOK_ID || !rt.deps.payments?.verifyWebhookSignature)
    throw new AccessError("Sandbox webhook verification is unavailable.", 503);
  const event = z
    .object({ id: z.string().min(1).max(160), event_type: z.string().min(1).max(160), resource: z.record(z.string(), z.unknown()) })
    .passthrough()
    .parse(await readJson(request));
  if (!(await rt.deps.payments.verifyWebhookSignature({ headers, webhookId: process.env.PAYPAL_WEBHOOK_ID, event })))
    throw new AccessError("Invalid webhook signature.", 401);
  return rt.db.transaction(async (tx) => {
    const inserted = await tx.query(
      "INSERT INTO licensegraph.webhook_deliveries(event_id,sealed) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id",
      [event.id, rt.cipher.seal(event, `webhook:${event.id}`)],
    );
    if (!inserted.rowCount) return json({ accepted: true, duplicate: true });
    await applyWebhook(rt, tx, event);
    return json({ accepted: true }, 202);
  });
}

/** Routes that need no signed-in account: sign-in, health, shares and the provider webhook. */
export async function handlePublicRoutes(rt: PrivateRuntime, request: Request, url: URL, path: string): Promise<Response | undefined> {
  if (path.startsWith("/api/auth/")) {
    const action = path.split("/").at(-1);
    if (action === "login" && request.method === "GET") return await rt.identity.start(url.searchParams.get("returnTo") ?? "/workspace");
    if (action === "callback" && request.method === "GET") return await rt.identity.callback(request);
    if (action === "logout" && request.method === "POST") return await rt.identity.logout(request);
    if (action === "me" && request.method === "GET") return json({ enabled: true, user: await rt.identity.principal(request) });
    throw new AccessError("Unknown account action.", 404);
  }
  if (path === "/api/marketplace/ready") {
    const ready = await rt.db.pool.query("SELECT version FROM public.licensegraph_migrations WHERE version=3");
    if (!ready.rowCount) throw new AccessError("Database migrations are required.", 503);
    return json({ ready: true, payments: "sandbox-only" });
  }
  if (path === "/api/marketplace/health") {
    // Counts only: no identifiers, no record contents.
    const health = (
      await rt.db.pool.query(`SELECT
        (SELECT count(*) FROM licensegraph.operations WHERE status='queued' AND available_at<=now())::int AS ready_jobs,
        (SELECT COALESCE(EXTRACT(EPOCH FROM now()-min(available_at)),0) FROM licensegraph.operations WHERE status='queued' AND available_at<=now())::int AS oldest_ready_seconds,
        (SELECT count(*) FROM licensegraph.operations WHERE status='running')::int AS running_jobs,
        (SELECT count(*) FROM licensegraph.operations WHERE status='reconcile')::int AS reconcile_jobs,
        (SELECT count(*) FROM licensegraph.webhook_deliveries WHERE status IN ('queued','reconcile'))::int AS unmatched_webhooks,
        (SELECT count(*) FROM licensegraph.worker_heartbeats WHERE beat_at > now() - interval '60 seconds')::int AS live_workers`)
    ).rows[0];
    const stalled = health.ready_jobs > 0 && (health.live_workers === 0 || health.oldest_ready_seconds > 120);
    return json(
      {
        status: stalled ? "degraded" : "ok",
        ...health,
        reasons: stalled
          ? [health.live_workers === 0 ? "No worker has reported in the last 60 seconds." : "Queued work is older than two minutes."]
          : [],
      },
      stalled ? 503 : 200,
    );
  }
  if (path.startsWith("/api/marketplace/shared/")) {
    const token = path.split("/").at(-1)!;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AccessError("Share not found.", 404);
    const grant = (
      await rt.db.pool.query(
        "SELECT run_id,kind FROM licensegraph.share_grants WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()",
        [hashSecret(token)],
      )
    ).rows[0];
    const loaded = grant && (await rt.runs.read(grant.run_id));
    if (!loaded || !loaded.session.capture || loaded.session.refund || paymentReversed(loaded.session))
      throw new AccessError("Share not found.", 404);
    if (grant.kind === "passport") return json(await passport(rt, loaded.session));
    const s = loaded.session;
    return json({
      kind: "receipt",
      status: s.phase,
      currency: s.capture!.amount.currency,
      totalCents: s.loop!.verdict!.totalCents,
      environment: "sandbox",
      bundleCommitment: s.approval!.bundleDigest,
      ledgerCommitment: s.ledger.events().at(-1)?.hash,
      verification: "Receipt only; full source and passport checks require an explicit full-passport grant.",
    });
  }
  if (path === "/api/webhooks/paypal") return await receiveWebhook(rt, request);
  return undefined;
}
