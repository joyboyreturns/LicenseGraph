import { randomBytes, randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { AccessError, requireSameOrigin, staffOnly, type Principal } from "../auth/identity";
import { createSession, reserveForPerson, claimSession, viewOf, type Session } from "../app-logic/session";
import { sessionInputSchema, rebriefInputSchema, reviseInputSchema } from "../server/session-input";
import { getRuntime } from "../server/runtime";
import { issuePassport } from "../passport/issue";
import { verifyPassport } from "../passport/passport";
import { checkSignature, signPassport } from "../server/passport-signing";
import { hashSecret } from "../storage/crypto";
import { ConflictError } from "../storage/runs";
import { getPrivateRuntime, privateWorkspaceEnabled, type PrivateRuntime } from "./runtime";
import { type Operation, type OperationKind } from "../storage/jobs";
import { offerSchema } from "../mcp/tools";
import { canonicalJson } from "../core/digest";
import { readOwner } from "../server/owner";
import { readWebhookHeaders } from "../payments/webhook";
import { marketplaceOfferSchema } from "./types";
import type { PurchaseDetails } from "./types";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const uuid = z.uuid();
const publicOperation = (job: Operation) => ({ id: job.id, runId: job.runId, kind: job.kind, status: job.status, stage: job.stage });

async function readJson(request: Request): Promise<unknown> {
  const maximum = 500_000;
  if (Number(request.headers.get("content-length")) > maximum) throw new AccessError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await Promise.race([new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new AccessError("Request body timed out.", 408)); }, 10_000); }), (async () => {
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.length;
        if (length > maximum) { await reader.cancel(); throw new AccessError("Request is too large.", 413); }
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    })()]);
    return body;
  } catch (error) { if (error instanceof SyntaxError) throw new AccessError("Send valid JSON.", 400); throw error; }
  finally { clearTimeout(timer); reader.releaseLock(); }
}
async function privateView(rt: PrivateRuntime, session: Session) {
  const pending = await rt.db.pool.query("SELECT id,kind,status,error_code,available_at FROM licensegraph.operations WHERE run_id=$1 ORDER BY created_at DESC LIMIT 1", [session.id]);
  const purchase = (await rt.db.pool.query("SELECT payout_state,release_at,accepted_at FROM licensegraph.purchases WHERE run_id=$1", [session.id])).rows[0];
  const disputes = await rt.db.pool.query("SELECT id,status,created_at FROM licensegraph.disputes WHERE run_id=$1 ORDER BY created_at DESC", [session.id]);
  return { ...viewOf(session), privateMarketplace: true, pendingOperation: pending.rows[0] && ["queued","running","reconcile","failed"].includes(pending.rows[0].status) ? pending.rows[0] : null, purchase: purchase ?? null, disputes: disputes.rows };
}
function summary(s: Session) {
  const view = viewOf(s);
  return { id: s.id, createdAt: s.createdAt, name: s.input.project.name, phase: s.phase, runKind: s.input.meta?.runKind, revisedFrom: s.input.meta?.revisedFrom, rebriefedFrom: s.input.meta?.rebriefedFrom,
    rounds: view.rounds, totalCents: view.bundle?.totalCents, currency: view.bundle?.currency, naiveTotalCents: view.analysis?.naiveTotalCents, blocked: view.analysis?.blockedPurchases.length ?? 0, paid: Boolean(s.capture) };
}
async function createRun(rt: PrivateRuntime, principal: Principal, body: unknown) {
  const selection = z.object({ project: sessionInputSchema.shape.project, requiredAssetIds: sessionInputSchema.shape.requiredAssetIds, offerRefs: z.array(z.object({ id: z.uuid(), version: z.number().int().positive() }).strict()).min(1).max(12) }).strict();
  const selected = selection.safeParse(body);
  return rt.db.transaction(async (tx) => {
    let session: Session;
    let payload: unknown = null;
    if (selected.success) {
      const candidates = [];
      for (const ref of selected.data.offerRefs) {
        const row = (await tx.query(`SELECT o.sealed FROM licensegraph.offers o JOIN licensegraph.licensors l ON l.id=o.licensor_id WHERE o.id=$1 AND o.version=$2 AND o.status='approved' AND l.status='approved' AND l.version=o.licensor_version`, [ref.id, ref.version])).rows[0];
        if (!row) throw new ConflictError("A selected offer is unavailable or awaiting review.");
        candidates.push(rt.cipher.open<{ offer: z.infer<typeof offerSchema>; document: Session["input"]["documents"][number] }>(row.sealed, `offer:${ref.id}:${ref.version}`));
      }
      session = createSession({ project: selected.data.project, requiredAssetIds: selected.data.requiredAssetIds, documents: candidates.map((c) => c.document) });
      payload = { offers: candidates.map((c) => c.offer) };
    } else {
      if (!rt.model) throw new ConflictError("Custom licence analysis requires a configured free model. You can select reviewed marketplace offers without one.");
      const parsed = sessionInputSchema.parse(body);
      session = createSession({ project: parsed.project, requiredAssetIds: parsed.requiredAssetIds, documents: parsed.documents, meta: { brief: parsed.brief, runKind: "live", mandate: parsed.mandate } });
    }
    session.ownerId = principal.id;
    session.input.meta = { ...session.input.meta, runKind: rt.model ? "live" : "catalog" };
    const handoff = principal.agent || Boolean(body && typeof body === "object" && "handoff" in body && body.handoff === true) ? reserveForPerson(session) : undefined;
    await rt.runs.create(session, principal.id, tx);
    const job = await rt.queue.enqueue(tx, session.id, "pipeline", "initial", payload);
    await rt.runs.audit(tx, principal.id, "run_created", session.id, {});
    return json({ ...viewOf(session), privateMarketplace: true, operation: publicOperation(job), ...(handoff ? { handoff: { claimUrl: `${rt.appUrl}/claim/${session.id}?token=${handoff.token}`, expiresAt: handoff.expiresAt } } : {}) }, 202);
  });
}
async function queuePurchase(rt: PrivateRuntime, principal: Principal, runId: string, kind: OperationKind) {
  return rt.db.transaction(async (tx) => {
    const loaded = await rt.market.owned(runId, principal, tx);
    const s = loaded.session;
    const requiredPhase: Partial<Record<OperationKind, string>> = { order: "approved", capture: "order_created", payout: "captured", refund: "captured" };
    if (s.phase !== requiredPhase[kind]) throw new ConflictError(`Cannot start ${kind} from ${s.phase}.`);
    if (kind === "refund") {
      const purchase = (await tx.query("SELECT payout_state FROM licensegraph.purchases WHERE run_id=$1 FOR UPDATE", [runId])).rows[0];
      if (purchase?.payout_state !== "held") throw new ConflictError("Payouts may have been submitted; reconciliation is required.");
      await tx.query("UPDATE licensegraph.operations SET status='canceled' WHERE run_id=$1 AND kind='payout' AND status='queued'", [runId]);
    }
    const job = await rt.queue.enqueue(tx, runId, kind, kind === "payout" ? "release" : "initial");
    // A failed precondition may be retried by an explicit human request. Submitted or uncertain jobs never restart here.
    if (job.status === "failed" && job.stage !== "submitted") {
      await tx.query("UPDATE licensegraph.operations SET status='queued',error_code=NULL,available_at=now() WHERE id=$1 AND status='failed' AND stage<>'submitted'", [job.id]);
      job.status = "queued";
    }
    return json({ ...viewOf(s), privateMarketplace: true, pendingOperation: publicOperation(job), operation: publicOperation(job) }, 202);
  });
}
async function passport(rt: PrivateRuntime, session: Session) {
  const p = issuePassport(session);
  const purchase = (await rt.db.pool.query("SELECT sealed FROM licensegraph.purchases WHERE run_id=$1", [session.id])).rows[0];
  const details = purchase ? rt.cipher.open<PurchaseDetails>(purchase.sealed, `purchase:${session.id}`) : undefined;
  return signPassport({ ...p, ...(details ? { purchaseAuthorization: { ...details.authorization, digest: details.authorizationDigest } } : {}) }, rt.passportSecret);
}

export async function privateRequest(request: Request): Promise<Response | undefined> {
  if (!privateWorkspaceEnabled()) return undefined;
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    // Public replayed runs live in a separate simulator runtime and cannot contain private documents.
    const publicId = /^\/api\/(?:sessions|passports)\/([^/]+)/.exec(path)?.[1];
    if (publicId && getRuntime().store.get(publicId)?.input.meta?.scenarioId) return undefined;
    if (path === "/api/sessions" && request.method === "POST") {
      const body = await readJson(request.clone());
      if (body && typeof body === "object" && "scenarioId" in body) return undefined;
    }
    const rt = getPrivateRuntime();
    if (path.startsWith("/api/auth/")) {
      const action = path.split("/").at(-1);
      if (action === "login" && request.method === "GET") return await rt.identity.start(url.searchParams.get("returnTo")??"/workspace");
      if (action === "callback" && request.method === "GET") return await rt.identity.callback(request);
      if (action === "logout" && request.method === "POST") return await rt.identity.logout(request);
      if (action === "me" && request.method === "GET") return json({ enabled: true, user: await rt.identity.principal(request) });
      throw new AccessError("Unknown account action.", 404);
    }
    if (path === "/api/marketplace/ready") {
      const ready = await rt.db.pool.query("SELECT version FROM public.licensegraph_migrations WHERE version=2");
      if (!ready.rowCount) throw new AccessError("Database migrations are required.", 503);
      return json({ ready: true, payments: "sandbox-only" });
    }
    if (path.startsWith("/api/marketplace/shared/")) {
      const token = path.split("/").at(-1)!;
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AccessError("Share not found.", 404);
      const grant = (await rt.db.pool.query("SELECT run_id,kind FROM licensegraph.share_grants WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()", [hashSecret(token)])).rows[0];
      const loaded = grant && await rt.runs.read(grant.run_id);
      if (!loaded || !loaded.session.capture || loaded.session.refund) throw new AccessError("Share not found.", 404);
      if (grant.kind === "passport") return json(await passport(rt, loaded.session));
      const s = loaded.session;
      return json({ kind: "receipt", status: s.phase, currency: s.capture!.amount.currency, totalCents: s.loop!.verdict!.totalCents, environment: "sandbox", bundleCommitment: s.approval!.bundleDigest, ledgerCommitment: s.ledger.events().at(-1)?.hash, verification: "Receipt only; full source and passport checks require an explicit full-passport grant." });
    }
    if (path === "/api/webhooks/paypal") return await receiveWebhook(rt, request);
    const principal = await rt.identity.principal(request);
    if (!principal && path === "/api/mcp") return undefined;
    if (!principal && ["/api/sessions", "/api/portfolio", "/api/config"].includes(path) && request.method === "GET") return undefined;
    if (!principal) throw new AccessError("Sign in to access your private workspace.", 401);
    if (principal.agent) {
      const allowed = request.method === "GET" && (/^\/api\/(?:sessions|passports)\//.test(path) || path === "/api/sessions" || path.startsWith("/api/marketplace/operations/") || path === "/api/marketplace/catalog") || request.method === "POST" && ["/api/sessions", "/api/mcp"].includes(path);
      if (!allowed) throw new AccessError("Agent credentials can create and read permitted runs; human approval and money actions require browser sign-in.");
    } else requireSameOrigin(request, rt.appUrl);
    if (path === "/api/config") return json({ mode: rt.model ? "live" : "demo", paymentsEnabled: Boolean(rt.deps.payments), paymentsMode: rt.deps.payments ? "paypal-sandbox" : "none", assistant: Boolean(rt.proxy), intakeModel: Boolean(rt.model), passportSigned: Boolean(rt.passportSecret), appUrl: rt.appUrl, privateWorkspace: true });
    if (path === "/api/sessions" && request.method === "POST") return await createRun(rt, principal, await readJson(request));
    if ((path === "/api/sessions" || path === "/api/portfolio") && request.method === "GET") {
      const rows = await rt.db.pool.query("SELECT id FROM licensegraph.runs WHERE owner_id=$1 AND quarantine_reason IS NULL ORDER BY created_at DESC LIMIT 200", [principal.id]);
      const sessions = (await Promise.all(rows.rows.map((row) => rt.runs.read(row.id)))).flatMap((loaded) => loaded ? [loaded.session] : []);
      return path === "/api/portfolio" ? json({ views: sessions.map((s) => ({ ...viewOf(s), documents: viewOf(s).documents.map((d) => ({ ...d, text: "" })) })) }) : json({ runs: sessions.map(summary) });
    }
    const runMatch = /^\/api\/sessions\/([^/]+)(?:\/([^/]+))?$/.exec(path);
    if (runMatch) {
      const runId = uuid.parse(runMatch[1]);
      const action = runMatch[2];
      if (action === "claim" && request.method === "POST") {
        if (principal.agent) throw new AccessError("A person must claim this run.");
        const body = z.object({ token: z.string().min(1).max(200) }).strict().parse(await readJson(request));
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
        if (!claim || Date.parse(claim.expiresAt) <= Date.now() || hashSecret(claimToken) !== claim.tokenHash) throw new AccessError("This claim link is expired or unavailable.",404);
        return json({ ...viewOf(preview!.session), privateMarketplace:true });
      }
      const loaded = await rt.market.owned(runId, principal);
      if (!action && request.method === "GET") return json(await privateView(rt, loaded.session));
      if (action === "return" && request.method === "GET") {
        await queuePurchase(rt, principal, runId, "capture");
        return new Response(null, { status: 303, headers: { Location: `${rt.appUrl}/run/${runId}`, "Cache-Control": "no-store" } });
      }
      if (request.method !== "POST") throw new AccessError("Method not allowed.", 405);
      if (action === "approve") return json(await rt.market.approve(principal, runId));
      const kind = ({ pay: "order", capture: "capture", payouts: "payout", refund: "refund" } as const)[action as "pay" | "capture" | "payouts" | "refund"];
      if (kind) return await queuePurchase(rt, principal, runId, kind);
      if (action === "ask") {
        const { answerQuestion } = await import("../intake/explain");
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
      if (passportMatch[2] === "verify") return json({ ...await verifyPassport(p), signature: checkSignature(p, rt.passportSecret) });
      if (passportMatch[2] === "qr") {
        const {default: QRCode}=await import("qrcode");
        return new Response(await QRCode.toString(`${rt.appUrl}/passport/${loaded.session.id}`,{type:"svg",margin:1,errorCorrectionLevel:"M"}),{headers:{"Content-Type":"image/svg+xml","Cache-Control":"no-store"}});
      }
      if (passportMatch[2] === "badge") {
        const {badgeSvg}=await import("../passport/badge");
        const result=await verifyPassport(p);
        return new Response(badgeSvg({verified:result.ok,licences:p.bundle.offers.length,reversed:result.checks.some((c)=>c.id==="payment-standing"&&!c.ok)}),{headers:{"Content-Type":"image/svg+xml","Cache-Control":"no-store"}});
      }
      if (passportMatch[2]) throw new AccessError("Passport endpoint not found.",404);
      const response = json(p);
      if (url.searchParams.has("download")) response.headers.set("Content-Disposition", `attachment; filename="licence-passport-${loaded.session.id}.json"`);
      return response;
    }
    if (path === "/api/intake") {
      const { parseBrief } = await import("../intake/brief");
      const body = z.object({ text: z.string().min(5).max(2000) }).parse(await readJson(request));
      return json(await parseBrief(body.text, rt.model));
    }
    if (path === "/api/mcp") {
      const {createLicenseGraphServer}=await import("../mcp/server");
      const {WebStandardStreamableHTTPServerTransport}=await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
      const server=createLicenseGraphServer({baseUrl:rt.appUrl,fetch:async(input,init)=>{
        const target=new URL(String(input));
        if(target.origin!==new URL(rt.appUrl).origin) throw new AccessError("Agent tool target must be this application.");
        const headers=new Headers(init?.headers);
        for(const name of ["cookie","authorization"]) {const value=request.headers.get(name);if(value)headers.set(name,value);}
        headers.set("Origin",new URL(rt.appUrl).origin);
        const forwarded=new Request(target,{...init,headers});
        const response=await privateRequest(forwarded);
        if(response)return response;
        // Public replay handlers do not touch private storage or credentials.
        if(target.pathname==="/api/sessions"&&init?.method==="POST") return (await import("../../app/api/sessions/route")).POST(forwarded);
        const publicRun=/^\/api\/sessions\/([^/]+)$/.exec(target.pathname);
        if(publicRun)return (await import("../../app/api/sessions/[id]/route")).GET(forwarded,{params:Promise.resolve({id:publicRun[1]!})});
        return json({error:"Public tool target unavailable."},404);
      }});
      const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      await server.connect(transport);
      try{return await transport.handleRequest(request);}finally{void transport.close().catch(()=>undefined);}
    }
    if (path === "/api/llm") {
      if (!rt.proxy) throw new AccessError("The optional assistant is not configured.", 503);
      return json(await rt.proxy(await readJson(request)));
    }
    if (path.startsWith("/api/marketplace/")) return await marketplaceRequest(rt, principal, request, path);
    // An authenticated request to an unsupported legacy capability must never fall back to public data.
    throw new AccessError("This endpoint is unavailable in the private workspace.", 404);
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    if (error instanceof ConflictError) return json({ error: error.message }, 409);
    if (error instanceof ZodError) return json({ error: "Invalid request.", issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, 400);
    // Class and database code only: messages can carry record contents.
    const detail = error instanceof Error ? { error: error.name, code: (error as { code?: unknown }).code } : { error: "unknown" };
    console.error(JSON.stringify({ event: "private_request_failed", path: new URL(request.url).pathname, ...detail }));
    return json({ error: "The private workspace is temporarily unavailable. No operation was silently retried." }, 503);
  }
}

/** Decodes each row, leaving out any that cannot be read and reporting how many, so one bad record cannot hide the rest. */
function readable<Row, Out>(list: string, rows: Row[], decode: (row: Row) => Out): Out[] {
  const out: Out[] = [];
  let unreadable = 0;
  for (const row of rows) {
    try { out.push(decode(row)); } catch { unreadable += 1; }
  }
  if (unreadable) console.error(JSON.stringify({ event: "unreadable_records", list, count: unreadable }));
  return out;
}

async function linkedRun(rt: PrivateRuntime, principal: Principal, from: Session, action: string, body: unknown): Promise<Response> {
  if (!["failed", "verified"].includes(from.phase) || from.order || from.capture) throw new ConflictError("Wait for an unpaid run to finish before revising it.");
  const { rebriefInput, reviseInput, recordRebrief, recordRevision } = await import("../app-logic/revision");
  const { describeChange } = await import("../core/whatif");
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

async function marketplaceRequest(rt: PrivateRuntime, principal: Principal, request: Request, path: string): Promise<Response> {
  const parts = path.slice("/api/marketplace/".length).split("/");
  const [area, id, action] = parts;
  if (area === "agent-tokens") {
    if (request.method === "GET") return json({ tokens: (await rt.db.pool.query("SELECT id,name,expires_at,revoked_at FROM licensegraph.agent_tokens WHERE user_id=$1 ORDER BY created_at DESC", [principal.id])).rows });
    if (request.method === "POST" && !id) {
      const body = z.object({ name: z.string().trim().min(1).max(80) }).strict().parse(await readJson(request));
      const token = randomBytes(32).toString("base64url");
      const tokenId = randomUUID();
      await rt.db.pool.query("INSERT INTO licensegraph.agent_tokens(id,user_id,token_hash,name,expires_at) VALUES ($1,$2,$3,$4,now()+interval '7 days')", [tokenId,principal.id,hashSecret(token),body.name]);
      return json({ id:tokenId, token, scope:["runs:create","runs:read"], expiresInDays:7 },201);
    }
    if (request.method === "DELETE" && id) {
      await rt.db.pool.query("UPDATE licensegraph.agent_tokens SET revoked_at=now() WHERE id=$1 AND user_id=$2", [uuid.parse(id),principal.id]);
      return json({revoked:true});
    }
  }
  if (area === "licensor" && id === "purchases" && request.method === "GET") {
    const rows=await rt.db.pool.query("SELECT DISTINCT r.run_id,p.payout_state,p.captured_at FROM licensegraph.purchase_recipients r JOIN licensegraph.licensors l ON l.id=r.licensor_id JOIN licensegraph.purchases p ON p.run_id=r.run_id WHERE l.user_id=$1 ORDER BY p.captured_at DESC NULLS LAST LIMIT 200",[principal.id]);
    return json({ purchases:rows.rows });
  }
  if (area === "catalog" && request.method === "GET") {
    const rows = await rt.db.pool.query(`SELECT o.* FROM licensegraph.offers o JOIN licensegraph.licensors l ON l.id=o.licensor_id WHERE o.status='approved' AND l.status='approved' AND l.version=o.licensor_version ORDER BY o.id,o.version DESC LIMIT 200`);
    // One unreadable record (for example sealed with a key that is no longer configured) must not hide the
    // other reviewed offers. It is left out and reported, never shown half-decoded.
    return json({ offers: readable("catalog", rows.rows, (row) => ({ id: row.id, version: row.version, ...rt.cipher.open<object>(row.sealed, `offer:${row.id}:${row.version}`) })) });
  }
  if (area === "operations" && request.method === "GET") {
    const job = await rt.queue.get(uuid.parse(id));
    if (!job) throw new AccessError("Operation not found.", 404);
    await rt.market.owned(job.runId, principal);
    return json(publicOperation(job));
  }
  if (area === "licensor" && !id) {
    if (request.method === "POST") return json(await rt.market.submitLicensor(principal, await readJson(request)), 201);
    if (request.method === "GET") {
      const row = (await rt.db.pool.query("SELECT * FROM licensegraph.licensors WHERE user_id=$1", [principal.id])).rows[0];
      return json({ licensor: row ? { id: row.id, version: row.version, status: row.status, recipientConfirmed: Boolean(row.recipient_confirmed_at), reason: row.review_reason, details: rt.cipher.open(row.sealed, `licensor:${row.id}:${row.version}`) } : null });
    }
  }
  if (area === "licensor" && id === "confirm" && request.method === "POST") return json(await rt.market.confirmRecipient(principal));
  if (area === "offers" && request.method === "POST") {
    const body = z.object({ offer: marketplaceOfferSchema, document: sessionInputSchema.shape.documents.element, existingId: z.uuid().optional() }).strict().parse(await readJson(request));
    return json(await rt.market.publishOffer(principal, body.offer, body.document, body.existingId), 201);
  }
  if (area === "offers" && request.method === "GET") {
    const rows = await rt.db.pool.query("SELECT o.* FROM licensegraph.offers o JOIN licensegraph.licensors l ON l.id=o.licensor_id WHERE l.user_id=$1 ORDER BY o.id,o.version DESC", [principal.id]);
    return json({ offers: rows.rows.map((row) => ({ id: row.id, version: row.version, status: row.status, ...rt.cipher.open<object>(row.sealed, `offer:${row.id}:${row.version}`) })) });
  }
  if (area === "runs" && id) {
    const runId = uuid.parse(id);
    if (action === "accept" && request.method === "POST") return json(publicOperation(await rt.market.accept(principal, runId)), 202);
    if (action === "disputes" && request.method === "POST") return json(await rt.market.dispute(principal, runId, await readJson(request)), 201);
    if (action === "shares" && request.method === "POST") {
      const body = z.object({ kind: z.enum(["receipt", "passport"]), days: z.number().int().min(1).max(30) }).strict().parse(await readJson(request));
      const grant = await rt.market.share(principal, runId, body.kind, body.days);
      return json({ ...grant, url: `${rt.appUrl}/share/${grant.token}` }, 201);
    }
    if (action === "shares" && request.method === "GET") {
      await rt.market.owned(runId, principal);
      const result = await rt.db.pool.query("SELECT id,kind,expires_at,revoked_at FROM licensegraph.share_grants WHERE run_id=$1 ORDER BY created_at DESC", [runId]);
      return json({ shares: result.rows });
    }
  }
  if (area === "shares" && id && request.method === "DELETE") {
    await rt.db.transaction(async (tx) => {
      const grant = (await tx.query("SELECT run_id FROM licensegraph.share_grants WHERE id=$1", [uuid.parse(id)])).rows[0];
      if (!grant) throw new AccessError("Share not found.", 404);
      await rt.market.owned(grant.run_id, principal, tx);
      await tx.query("UPDATE licensegraph.share_grants SET revoked_at=now() WHERE id=$1", [id]);
      await rt.runs.audit(tx, principal.id, "share_revoked", grant.run_id, { id });
    });
    return json({ revoked: true });
  }
  if (area === "link-legacy" && request.method === "POST") {
    const body = z.object({ runId: z.uuid() }).strict().parse(await readJson(request));
    const owner = readOwner(request);
    if (!owner) throw new AccessError("The browser that originally owned this run is required.");
    await rt.db.transaction(async (tx) => {
      const row = (await tx.query("SELECT owner_id,legacy_owner_hash FROM licensegraph.runs WHERE id=$1 FOR UPDATE", [body.runId])).rows[0];
      if (!row || row.owner_id || row.legacy_owner_hash !== hashSecret(owner)) throw new AccessError("This run cannot be linked from this browser.");
      await tx.query("UPDATE licensegraph.runs SET owner_id=$1,legacy_owner_hash=NULL WHERE id=$2", [principal.id, body.runId]);
      await rt.runs.audit(tx, principal.id, "legacy_run_linked", body.runId, {});
    });
    return json({ linked: true });
  }
  if (area === "staff") {
    staffOnly(principal);
    if (id === "reviews" && request.method === "GET") {
      const licensors = await rt.db.pool.query("SELECT * FROM licensegraph.licensors ORDER BY reviewed_at NULLS FIRST LIMIT 200");
      const offers = await rt.db.pool.query("SELECT * FROM licensegraph.offers WHERE status='pending' LIMIT 200");
      const disputes = await rt.db.pool.query("SELECT * FROM licensegraph.disputes WHERE status IN ('open','escalated') LIMIT 200");
      const operations = await rt.db.pool.query("SELECT id,run_id,kind,status,stage,error_code FROM licensegraph.operations WHERE status='reconcile' LIMIT 200");
      return json({ licensors: readable("staff_licensors", licensors.rows, (row) => ({ id: row.id, userId: row.user_id, version: row.version, status: row.status, recipientConfirmed: Boolean(row.recipient_confirmed_at), details: rt.cipher.open(row.sealed, `licensor:${row.id}:${row.version}`) })),
        offers: readable("staff_offers", offers.rows, (row) => ({ id: row.id, version: row.version, ...rt.cipher.open<object>(row.sealed, `offer:${row.id}:${row.version}`) })),
        disputes: readable("staff_disputes", disputes.rows, (row) => ({ id: row.id, runId: row.run_id, status: row.status, details: rt.cipher.open(row.sealed, `dispute:${row.id}`) })), operations: operations.rows });
    }
    if (id === "licensors" && action && request.method === "POST") {
      const body = z.object({ decision: z.enum(["approved","rejected","suspended"]), reason: z.string().trim().min(1).max(4000) }).strict().parse(await readJson(request));
      return json(await rt.market.reviewLicensor(principal, uuid.parse(action), body.decision, body.reason));
    }
    if (id === "offers" && action && request.method === "POST") {
      const body = z.object({ version: z.number().int().positive(), decision: z.enum(["approved","rejected"]) }).strict().parse(await readJson(request));
      return json(await rt.market.reviewOffer(principal, uuid.parse(action), body.version, body.decision));
    }
    if (id === "disputes" && action && request.method === "POST") {
      const body = z.object({ decision: z.enum(["release","refund","escalate"]), reason: z.string().trim().min(10).max(4000) }).strict().parse(await readJson(request));
      return json(await resolveDispute(rt, principal, uuid.parse(action), body));
    }
    if (id === "reconcile" && action && request.method === "POST") {
      const body=z.object({providerId:z.string().regex(/^[A-Za-z0-9-]{1,120}$/),reason:z.string().trim().min(10).max(4000)}).strict().parse(await readJson(request));
      const {reconcileOperation}=await import("./reconcile");
      return json(await reconcileOperation(rt,principal,uuid.parse(action),body.providerId,body.reason));
    }
    if (id === "assign-legacy" && request.method === "POST") {
      const body = z.object({ runId: z.uuid(), ownerId: z.uuid(), reason: z.string().trim().min(10).max(4000) }).strict().parse(await readJson(request));
      await rt.db.transaction(async (tx) => {
        const updated = await tx.query("UPDATE licensegraph.runs SET owner_id=$1,legacy_owner_hash=NULL WHERE id=$2 AND owner_id IS NULL", [body.ownerId, body.runId]);
        if (!updated.rowCount) throw new ConflictError("Only unassigned imported runs can be assigned.");
        await rt.runs.audit(tx, principal.id, "legacy_owner_assigned", body.runId, { ownerId: body.ownerId, reason: body.reason });
      });
      return json({ assigned: true });
    }
  }
  throw new AccessError("Marketplace endpoint not found.", 404);
}

async function resolveDispute(rt: PrivateRuntime, principal: Principal, id: string, body: { decision: "release" | "refund" | "escalate"; reason: string }) {
  return rt.db.transaction(async (tx) => {
    const ref = (await tx.query("SELECT run_id FROM licensegraph.disputes WHERE id=$1", [id])).rows[0];
    if (!ref) throw new AccessError("Dispute not found.", 404);
    await rt.runs.lock(ref.run_id, tx);
    const dispute = (await tx.query("SELECT * FROM licensegraph.disputes WHERE id=$1 FOR UPDATE", [id])).rows[0];
    const purchase = (await tx.query("SELECT * FROM licensegraph.purchases WHERE run_id=$1 FOR UPDATE", [ref.run_id])).rows[0];
    if (!["open","escalated"].includes(dispute.status)) throw new ConflictError("This dispute is already resolved.");
    if (body.decision !== "escalate" && purchase.payout_state !== "held") throw new ConflictError("Funds may already have moved. Reconcile and escalate this case.");
    const previous = rt.cipher.open<object>(dispute.sealed, `dispute:${id}`);
    const status = body.decision === "release" ? "released" : body.decision === "refund" ? "open" : "escalated";
    await tx.query("UPDATE licensegraph.disputes SET status=$1,sealed=$2,resolved_by=$3,resolved_at=CASE WHEN $1='released' THEN now() ELSE NULL END WHERE id=$4", [status, rt.cipher.seal({ ...previous, resolution: body }, `dispute:${id}`), principal.id, id]);
    let operation: Operation | undefined;
    if (body.decision === "release") {
      await tx.query("UPDATE licensegraph.purchases SET accepted_at=now() WHERE run_id=$1", [ref.run_id]);
      operation = await rt.queue.enqueue(tx, ref.run_id, "payout", "release");
      await tx.query("UPDATE licensegraph.operations SET status='queued',error_code=NULL,available_at=now() WHERE id=$1 AND status='failed' AND stage='waiting'", [operation.id]);
    }
    if (body.decision === "refund") {
      await tx.query("UPDATE licensegraph.operations SET status='canceled' WHERE run_id=$1 AND kind='payout' AND status='queued'", [ref.run_id]);
      operation = await rt.queue.enqueue(tx, ref.run_id, "refund", "initial");
    }
    await rt.runs.audit(tx, principal.id, `dispute_${body.decision}`, ref.run_id, { disputeId: id, reason: body.reason });
    return { id, status, operation: operation && publicOperation(operation) };
  });
}

async function receiveWebhook(rt: PrivateRuntime, request: Request) {
  const headers = readWebhookHeaders(request.headers);
  if (!headers || !process.env.PAYPAL_WEBHOOK_ID || !rt.deps.payments?.verifyWebhookSignature) throw new AccessError("Sandbox webhook verification is unavailable.", 503);
  const event = z.object({ id: z.string().min(1).max(160), event_type: z.string().min(1).max(160), resource: z.record(z.string(), z.unknown()) }).passthrough().parse(await readJson(request));
  if (!(await rt.deps.payments.verifyWebhookSignature({ headers, webhookId: process.env.PAYPAL_WEBHOOK_ID, event }))) throw new AccessError("Invalid webhook signature.", 401);
  return rt.db.transaction(async (tx) => {
    const inserted = await tx.query("INSERT INTO licensegraph.webhook_deliveries(event_id,sealed) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id", [event.id, rt.cipher.seal(event, `webhook:${event.id}`)]);
    if (!inserted.rowCount) return json({ accepted: true, duplicate: true });
    if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
      const purchase = (await tx.query("SELECT run_id,sealed FROM licensegraph.purchases WHERE order_id=$1", [String(event.resource.id)])).rows[0];
      if (purchase) {
        const details = rt.cipher.open<PurchaseDetails>(purchase.sealed, `purchase:${purchase.run_id}`);
        const units = event.resource.purchase_units as { custom_id?: string }[] | undefined;
        if (units?.[0]?.custom_id !== details.authorizationDigest) throw new AccessError("Webhook purchase authorization mismatch.");
        await rt.runs.lock(purchase.run_id, tx);
        await rt.queue.enqueue(tx, purchase.run_id, "capture", "initial");
      }
    } else if (event.event_type === "PAYMENT.CAPTURE.REFUNDED" || event.event_type === "PAYMENT.CAPTURE.REVERSED") {
      const related = event.resource.supplementary_data as { related_ids?: { capture_id?: string } } | undefined;
      const links = Array.isArray(event.resource.links) ? event.resource.links as { rel?: string; href?: string }[] : [];
      const captureId = related?.related_ids?.capture_id ?? /\/captures\/([A-Za-z0-9-]+)/.exec(links.find((link) => link.rel === "up")?.href ?? "")?.[1];
      const purchase = captureId && (await tx.query("SELECT run_id FROM licensegraph.purchases WHERE capture_id=$1", [captureId])).rows[0];
      if (purchase) {
        const loaded = await rt.runs.lock(purchase.run_id, tx);
        if (!loaded.session.refund) {
          loaded.session.ledger.append("payment_reversed", { eventId: event.id, captureId, reason: event.event_type });
          await rt.runs.save(loaded, tx);
          await tx.query("UPDATE licensegraph.purchases SET payout_state='reconcile' WHERE run_id=$1", [purchase.run_id]);
          await tx.query("UPDATE licensegraph.operations SET status='canceled' WHERE run_id=$1 AND kind='payout' AND status='queued'", [purchase.run_id]);
        }
      }
    } else if (event.event_type.startsWith("PAYMENT.PAYOUT")) {
      const batch = event.resource.batch_header as { payout_batch_id?: string } | undefined;
      const batchId = batch?.payout_batch_id ?? event.resource.payout_batch_id;
      if (typeof batchId === "string") {
        const purchase = (await tx.query("SELECT run_id FROM licensegraph.purchases WHERE payout_batch_id=$1", [batchId])).rows[0];
        if (purchase) {
          await rt.runs.lock(purchase.run_id, tx);
          await rt.queue.enqueue(tx, purchase.run_id, "refresh", `webhook:${event.id}`, { attempt: 0 });
        }
      }
    }
    await tx.query("UPDATE licensegraph.webhook_deliveries SET status='processed' WHERE event_id=$1", [event.id]);
    return json({ accepted: true }, 202);
  });
}
