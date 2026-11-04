import { randomBytes, randomUUID } from "node:crypto";
import { readOwner } from "../../server/owner";
import { AccessError } from "../../auth/identity";
import { hashSecret } from "../../storage/crypto";
import { Req } from "../contract";
import type { MarketplaceContext } from "./context";
import { json, readJson, uuid } from "./common";

/** Agent credentials and linking imported runs to the signed-in account. */
export async function handleAccount({ rt, principal, request, area, id, action }: MarketplaceContext): Promise<Response | undefined> {
  if (area === "agent-tokens") {
    if (request.method === "GET")
      return json({
        tokens: (
          await rt.db.pool.query(
            "SELECT id,name,expires_at,revoked_at FROM licensegraph.agent_tokens WHERE user_id=$1 ORDER BY created_at DESC",
            [principal.id],
          )
        ).rows,
      });
    if (request.method === "POST" && !id) {
      const body = Req.AgentTokenRequest.parse(await readJson(request));
      const token = randomBytes(32).toString("base64url");
      const tokenId = randomUUID();
      await rt.db.pool.query(
        "INSERT INTO licensegraph.agent_tokens(id,user_id,token_hash,name,expires_at) VALUES ($1,$2,$3,$4,now()+interval '7 days')",
        [tokenId, principal.id, hashSecret(token), body.name],
      );
      return json({ id: tokenId, token, scope: ["runs:create", "runs:read"], expiresInDays: 7 }, 201);
    }
    if (request.method === "DELETE" && id) {
      await rt.db.pool.query("UPDATE licensegraph.agent_tokens SET revoked_at=now() WHERE id=$1 AND user_id=$2", [
        uuid.parse(id),
        principal.id,
      ]);
      return json({ revoked: true });
    }
  }
  if (area === "link-legacy" && request.method === "POST") {
    const body = Req.LinkLegacy.parse(await readJson(request));
    const owner = readOwner(request);
    if (!owner) throw new AccessError("The browser that originally owned this run is required.");
    await rt.db.transaction(async (tx) => {
      const row = (await tx.query("SELECT owner_id,legacy_owner_hash FROM licensegraph.runs WHERE id=$1 FOR UPDATE", [body.runId])).rows[0];
      if (!row || row.owner_id || row.legacy_owner_hash !== hashSecret(owner))
        throw new AccessError("This run cannot be linked from this browser.");
      await tx.query("UPDATE licensegraph.runs SET owner_id=$1,legacy_owner_hash=NULL WHERE id=$2", [principal.id, body.runId]);
      await rt.runs.audit(tx, principal.id, "legacy_run_linked", body.runId, {});
    });
    return json({ linked: true });
  }
  return undefined;
}
