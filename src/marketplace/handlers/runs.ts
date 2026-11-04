import { z } from "zod";
import { AccessError, type Principal } from "../../auth/identity";
import { createSession, reserveForPerson, claimSession, viewOf, type Session } from "../../app-logic/session";
import { sessionInputSchema, rebriefInputSchema, reviseInputSchema } from "../../server/session-input";
import { verifyPassport } from "../../passport/passport";
import { checkSignature } from "../../server/passport-signing";
import { hashSecret } from "../../storage/crypto";
import { ConflictError } from "../../storage/runs";
import type { OperationKind } from "../../storage/jobs";
import { offerSchema } from "../../mcp/tools";
import { Req } from "../contract";
import type { PrivateRuntime } from "../runtime";
import { json, publicOperation, readJson, uuid } from "./common";
import { passport, privateView, summary } from "./views";

export async function createRun(rt: PrivateRuntime, principal: Principal, body: unknown) {
  const selection = Req.CatalogRun;
  const selected = selection.safeParse(body);
  return rt.db.transaction(async (tx) => {
    let session: Session;
    let payload: unknown = null;
    if (selected.success) {
      const candidates = [];
      for (const ref of selected.data.offerRefs) {
        const row = (
          await tx.query(
            `SELECT o.sealed FROM licensegraph.offers o JOIN licensegraph.licensors l ON l.id=o.licensor_id WHERE o.id=$1 AND o.version=$2 AND o.status='approved' AND l.status='approved' AND l.version=o.licensor_version`,
            [ref.id, ref.version],
          )
        ).rows[0];
        if (!row) throw new ConflictError("A selected offer is unavailable or awaiting review.");
        candidates.push(
          rt.cipher.open<{ offer: z.infer<typeof offerSchema>; document: Session["input"]["documents"][number] }>(
            row.sealed,
            `offer:${ref.id}:${ref.version}`,
          ),
        );
      }
      session = createSession({
        project: selected.data.project,
        requiredAssetIds: selected.data.requiredAssetIds,
        documents: candidates.map((c) => c.document),
      });
      payload = { offers: candidates.map((c) => c.offer) };
    } else {
      if (!rt.model)
        throw new ConflictError(
          "Custom licence analysis requires a configured free model. You can select reviewed marketplace offers without one.",
        );
      const parsed = sessionInputSchema.parse(body);
      session = createSession({
        project: parsed.project,
        requiredAssetIds: parsed.requiredAssetIds,
        documents: parsed.documents,
        meta: { brief: parsed.brief, runKind: "live", mandate: parsed.mandate },
      });
    }
    session.ownerId = principal.id;
    session.input.meta = { ...session.input.meta, runKind: rt.model ? "live" : "catalog" };
    const handoff =
      principal.agent || Boolean(body && typeof body === "object" && "handoff" in body && body.handoff === true)
        ? reserveForPerson(session)
        : undefined;
    await rt.runs.create(session, principal.id, tx);
    const job = await rt.queue.enqueue(tx, session.id, "pipeline", "initial", payload);
    await rt.runs.audit(tx, principal.id, "run_created", session.id, {});
    return json(
      {
        ...viewOf(session),
        privateMarketplace: true,
        operation: publicOperation(job),
        ...(handoff
          ? { handoff: { claimUrl: `${rt.appUrl}/claim/${session.id}?token=${handoff.token}`, expiresAt: handoff.expiresAt } }
          : {}),
      },
      202,
    );
  });
}

export async function queuePurchase(rt: PrivateRuntime, principal: Principal, runId: string, kind: OperationKind) {
  return rt.db.transaction(async (tx) => {
    const loaded = await rt.market.owned(runId, principal, tx);
    const s = loaded.session;
    const requiredPhase: Partial<Record<OperationKind, string>> = {
      order: "approved",
      capture: "order_created",
      payout: "captured",
      refund: "captured",
    };
    if (s.phase !== requiredPhase[kind]) throw new ConflictError(`Cannot start ${kind} from ${s.phase}.`);
    if (kind === "refund") {
      const purchase = (await tx.query("SELECT payout_state FROM licensegraph.purchases WHERE run_id=$1 FOR UPDATE", [runId])).rows[0];
      if (purchase?.payout_state !== "held") throw new ConflictError("Payouts may have been submitted; reconciliation is required.");
      await tx.query("UPDATE licensegraph.operations SET status='canceled' WHERE run_id=$1 AND kind='payout' AND status='queued'", [runId]);
    }
    const job = await rt.queue.enqueue(tx, runId, kind, kind === "payout" ? "release" : "initial");
    // A failed precondition may be retried by an explicit human request. Submitted or uncertain jobs never restart here.
    if (job.status === "failed" && job.stage !== "submitted" && job.stage !== "recorded") {
      await tx.query(
        "UPDATE licensegraph.operations SET status='queued',error_code=NULL,available_at=now() WHERE id=$1 AND status='failed' AND stage<>'submitted'",
        [job.id],
      );
      job.status = "queued";
    }
    return json({ ...viewOf(s), privateMarketplace: true, pendingOperation: publicOperation(job), operation: publicOperation(job) }, 202);
  });
}

async function linkedRun(rt: PrivateRuntime, principal: Principal, from: Session, action: string, body: unknown): Promise<Response> {
  if (!["failed", "verified"].includes(from.phase) || from.order || from.capture)
    throw new ConflictError("Wait for an unpaid run to finish before revising it.");
  const { rebriefInput, reviseInput, recordRebrief, recordRevision } = await import("../../app-logic/revision");
  const { describeChange } = await import("../../core/whatif");
  let next: Session;
  if (action === "rebrief") {
    const { change } = rebriefInputSchema.parse(body);
    next = createSession(rebriefInput(from.input, from.id, change));
    recordRebrief(next, from, change, describeChange(change));
  } else {
    if (!rt.model) throw new ConflictError("Revised licence analysis requires a configured free model.");
    const revision = reviseInputSchema.parse(body);
    if ("simulate" in revision) throw new ConflictError("Simulated revisions are only available in the public recorded scenarios.");
    next = createSession(reviseInput(from.input, from.id, revision));
    recordRevision(next, from);
  }
  next.ownerId = principal.id;
  return rt.db.transaction(async (tx) => {
    await rt.market.owned(from.id, principal, tx);
    await rt.runs.create(next, principal.id, tx);
    const job = await rt.queue.enqueue(tx, next.id, "pipeline", "initial", { offers: from.candidates });
    return json({ ...viewOf(next), privateMarketplace: true, operation: publicOperation(job) }, 202);
  });
}

/** Run, portfolio and passport routes of a signed-in account. Returns undefined when the path is not one of them. */
export async function handleRunRoutes(
  rt: PrivateRuntime,
  principal: Principal,
  request: Request,
  url: URL,
  path: string,
): Promise<Response | undefined> {
  if (path === "/api/sessions" && request.method === "POST") return await createRun(rt, principal, await readJson(request));
  if ((path === "/api/sessions" || path === "/api/portfolio") && request.method === "GET") {
    const rows = await rt.db.pool.query(
      "SELECT id FROM licensegraph.runs WHERE owner_id=$1 AND quarantine_reason IS NULL ORDER BY created_at DESC LIMIT 200",
      [principal.id],
    );
    const sessions = (await Promise.all(rows.rows.map((row) => rt.runs.read(row.id)))).flatMap((loaded) =>
      loaded ? [loaded.session] : [],
    );
    return path === "/api/portfolio"
      ? json({ views: sessions.map((s) => ({ ...viewOf(s), documents: viewOf(s).documents.map((d) => ({ ...d, text: "" })) })) })
      : json({ runs: sessions.map(summary) });
  }
  const runMatch = /^\/api\/sessions\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (runMatch) {
    const runId = uuid.parse(runMatch[1]);
    const action = runMatch[2];
    if (action === "claim" && request.method === "POST") {
      if (principal.agent) throw new AccessError("A person must claim this run.");
      const body = z
        .object({ token: z.string().min(1).max(200) })
        .strict()
        .parse(await readJson(request));
      const result = await rt.db.transaction(async (tx) => {
        const loaded = await rt.runs.lock(runId, tx);
        claimSession(loaded.session, body.token, principal.id);
        await rt.runs.save(loaded, tx);
        await tx.query("UPDATE licensegraph.runs SET owner_id=$1 WHERE id=$2", [principal.id, runId]);
        return viewOf(loaded.session);
      });
      return json(result);
    }
    const claimToken = url.searchParams.get("claimToken");
    if (!action && request.method === "GET" && claimToken && !principal.agent) {
      const preview = await rt.runs.read(runId);
      const claim = preview?.session.claim;
      if (!claim || Date.parse(claim.expiresAt) <= Date.now() || hashSecret(claimToken) !== claim.tokenHash)
        throw new AccessError("This claim link is expired or unavailable.", 404);
      return json({ ...viewOf(preview!.session), privateMarketplace: true });
    }
    const loaded = await rt.market.owned(runId, principal);
    if (!action && request.method === "GET") return json(await privateView(rt, loaded.session));
    if (action === "return" && request.method === "GET") {
      await queuePurchase(rt, principal, runId, "capture");
      return new Response(null, { status: 303, headers: { Location: `${rt.appUrl}/run/${runId}`, "Cache-Control": "no-store" } });
    }
    if (request.method !== "POST") throw new AccessError("Method not allowed.", 405);
    if (action === "approve") return json(await rt.market.approve(principal, runId));
    const kind = ({ pay: "order", capture: "capture", payouts: "payout", refund: "refund" } as const)[
      action as "pay" | "capture" | "payouts" | "refund"
    ];
    if (kind) return await queuePurchase(rt, principal, runId, kind);
    if (action === "ask") {
      const { answerQuestion } = await import("../../intake/explain");
      const body = z.object({ question: z.string().trim().min(1).max(1000) }).parse(await readJson(request));
      return json(await answerQuestion(viewOf(loaded.session), body.question, rt.model));
    }
    if (action === "rebrief" || action === "revise") return await linkedRun(rt, principal, loaded.session, action, await readJson(request));
    throw new AccessError("This action is not available for private runs.", 404);
  }
  const passportMatch = /^\/api\/passports\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (passportMatch) {
    const loaded = await rt.market.owned(uuid.parse(passportMatch[1]), principal);
    const p = await passport(rt, loaded.session);
    if (passportMatch[2] === "verify") return json({ ...(await verifyPassport(p)), signature: checkSignature(p, rt.passportSecret) });
    if (passportMatch[2] === "qr") {
      const { default: QRCode } = await import("qrcode");
      return new Response(
        await QRCode.toString(`${rt.appUrl}/passport/${loaded.session.id}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
        { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } },
      );
    }
    if (passportMatch[2] === "badge") {
      const { badgeSvg } = await import("../../passport/badge");
      const result = await verifyPassport(p);
      return new Response(
        badgeSvg({
          verified: result.ok,
          licences: p.bundle.offers.length,
          reversed: result.checks.some((c) => c.id === "payment-standing" && !c.ok),
        }),
        { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } },
      );
    }
    if (passportMatch[2]) throw new AccessError("Passport endpoint not found.", 404);
    const response = json(p);
    if (url.searchParams.has("download"))
      response.headers.set("Content-Disposition", `attachment; filename="licence-passport-${loaded.session.id}.json"`);
    return response;
  }
  return undefined;
}
