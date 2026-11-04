import { AccessError } from "../../auth/identity";
import { Req } from "../contract";
import type { MarketplaceContext } from "./context";
import { json, publicOperation, readable, readJson, uuid } from "./common";

/** Catalogue, operation status, purchase actions and sharing for the buyer who owns a run. */
export async function handleBuyer({ rt, principal, request, area, id, action }: MarketplaceContext): Promise<Response | undefined> {
  if (area === "catalog" && request.method === "GET") {
    const rows = await rt.db.pool.query(
      `SELECT o.* FROM licensegraph.offers o JOIN licensegraph.licensors l ON l.id=o.licensor_id WHERE o.status='approved' AND l.status='approved' AND l.version=o.licensor_version ORDER BY o.id,o.version DESC LIMIT 200`,
    );
    // One unreadable record (for example sealed with a key that is no longer configured) must not hide the
    // other reviewed offers. It is left out and reported, never shown half-decoded.
    return json({
      offers: readable("catalog", rows.rows, (row) => ({
        id: row.id,
        version: row.version,
        ...rt.cipher.open<object>(row.sealed, `offer:${row.id}:${row.version}`),
      })),
    });
  }
  if (area === "operations" && request.method === "GET") {
    const job = await rt.queue.get(uuid.parse(id));
    if (!job) throw new AccessError("Operation not found.", 404);
    await rt.market.owned(job.runId, principal);
    return json(publicOperation(job));
  }
  if (area === "runs" && id) {
    const runId = uuid.parse(id);
    if (action === "accept" && request.method === "POST") return json(publicOperation(await rt.market.accept(principal, runId)), 202);
    if (action === "disputes" && request.method === "POST")
      return json(await rt.market.dispute(principal, runId, await readJson(request)), 201);
    if (action === "shares" && request.method === "POST") {
      const body = Req.ShareRequest.parse(await readJson(request));
      const grant = await rt.market.share(principal, runId, body.kind, body.days);
      return json({ ...grant, url: `${rt.appUrl}/share/${grant.token}` }, 201);
    }
    if (action === "shares" && request.method === "GET") {
      await rt.market.owned(runId, principal);
      const result = await rt.db.pool.query(
        "SELECT id,kind,expires_at,revoked_at FROM licensegraph.share_grants WHERE run_id=$1 ORDER BY created_at DESC",
        [runId],
      );
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
  return undefined;
}
