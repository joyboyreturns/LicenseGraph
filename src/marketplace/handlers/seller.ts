import { z } from "zod";
import { Req } from "../contract";
import type { MarketplaceContext } from "./context";
import { json, readJson, uuid } from "./common";

/** The licensor profile and offer versions of the signed-in seller. */
export async function handleSeller({ rt, principal, request, area, id, action }: MarketplaceContext): Promise<Response | undefined> {
  if (area === "licensor" && id === "purchases" && request.method === "GET") {
    const rows = await rt.db.pool.query(
      "SELECT DISTINCT r.run_id,p.payout_state,p.captured_at FROM licensegraph.purchase_recipients r JOIN licensegraph.licensors l ON l.id=r.licensor_id JOIN licensegraph.purchases p ON p.run_id=r.run_id WHERE l.user_id=$1 ORDER BY p.captured_at DESC NULLS LAST LIMIT 200",
      [principal.id],
    );
    return json({ purchases: rows.rows });
  }
  if (area === "licensor" && !id) {
    if (request.method === "POST") return json(await rt.market.submitLicensor(principal, await readJson(request)), 201);
    if (request.method === "GET") {
      const row = (await rt.db.pool.query("SELECT * FROM licensegraph.licensors WHERE user_id=$1", [principal.id])).rows[0];
      return json({
        licensor: row
          ? {
              id: row.id,
              version: row.version,
              status: row.status,
              recipientConfirmed: Boolean(row.recipient_confirmed_at),
              reason: row.review_reason,
              details: rt.cipher.open(row.sealed, `licensor:${row.id}:${row.version}`),
            }
          : null,
      });
    }
  }
  if (area === "licensor" && id === "confirm" && request.method === "POST") return json(await rt.market.confirmRecipient(principal));
  if (area === "offers" && request.method === "POST") {
    const body = Req.OfferSubmission.parse(await readJson(request));
    return json(await rt.market.publishOffer(principal, body.offer, body.document, body.existingId), 201);
  }
  if (area === "offers" && id && request.method === "DELETE") {
    const version = z.coerce.number().int().positive().parse(new URL(request.url).searchParams.get("version"));
    return json(await rt.market.withdrawOffer(principal, uuid.parse(id), version));
  }
  if (area === "offers" && request.method === "GET") {
    const rows = await rt.db.pool.query(
      "SELECT o.* FROM licensegraph.offers o JOIN licensegraph.licensors l ON l.id=o.licensor_id WHERE l.user_id=$1 ORDER BY o.id,o.version DESC",
      [principal.id],
    );
    return json({
      offers: rows.rows.map((row) => ({
        id: row.id,
        version: row.version,
        status: row.status,
        ...rt.cipher.open<object>(row.sealed, `offer:${row.id}:${row.version}`),
      })),
    });
  }
  return undefined;
}
