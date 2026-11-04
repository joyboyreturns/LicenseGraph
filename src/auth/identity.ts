import { randomBytes, randomUUID } from "node:crypto";
import * as oidc from "openid-client";
import { Database, type Transaction } from "../storage/database";
import { RecordCipher, hashSecret } from "../storage/crypto";

export class AccessError extends Error {
  constructor(message: string, readonly status = 403) { super(message); }
}
export interface Principal { id: string; email: string; name: string; roles: string[]; mfa: boolean; agent?: boolean; tokenId?: string; }
const COOKIE = "lg_account";
const LOGIN_COOKIE = "lg_login";
const SESSION_SECONDS = 8 * 60 * 60;
const STAFF_SESSION_SECONDS = 2 * 60 * 60;

export function cookieValue(request: Request, name: string): string | undefined {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
export function requireSameOrigin(request: Request, appUrl: string): void {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.get("origin") !== new URL(appUrl).origin) throw new AccessError("This action requires a same-origin request.");
}
export function staffOnly(principal: Principal): void {
  if (!principal.roles.includes("staff") || !principal.mfa) throw new AccessError("Staff access requires a verified account and multi-factor sign-in.");
}
interface LoginState { returnTo?:string; state: string; nonce: string; verifier: string; expires: number; }

export class Identity {
  private config?: Promise<oidc.Configuration>;
  constructor(readonly db: Database, readonly cipher: RecordCipher, readonly appUrl: string, readonly issuer: string, readonly clientId: string, readonly clientSecret?: string) {
    for (const value of [appUrl, issuer]) {
      const url = new URL(value);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Identity endpoints require HTTPS outside localhost.");
    }
  }
  private configuration() {
    return this.config ??= oidc.discovery(new URL(this.issuer), this.clientId, this.clientSecret, this.clientSecret ? oidc.ClientSecretPost(this.clientSecret) : oidc.None(),
      { execute: this.issuer.startsWith("http:") ? [oidc.allowInsecureRequests] : undefined }).catch((error) => { this.config = undefined; throw error; });
  }
  private cookie(name: string, value: string, seconds: number) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${this.appUrl.startsWith("https:") ? "; Secure" : ""}`;
  }
  async start(returnTo = "/workspace"): Promise<Response> {
    const config = await this.configuration();
    const safeReturn=returnTo.startsWith("/")&&!returnTo.startsWith("//")&&new URL(returnTo,this.appUrl).origin===new URL(this.appUrl).origin?returnTo:"/workspace";
    const state: LoginState = { returnTo:safeReturn, state: oidc.randomState(), nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier(), expires: Date.now() + 600_000 };
    await this.db.pool.query("INSERT INTO licensegraph.login_attempts(state_hash,expires_at) VALUES ($1,$2)", [hashSecret(state.state), new Date(state.expires)]);
    const url = oidc.buildAuthorizationUrl(config, { redirect_uri: `${this.appUrl}/api/auth/callback`, scope: "openid profile email", response_type: "code", state: state.state, nonce: state.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(state.verifier), code_challenge_method: "S256" });
    return new Response(null, { status: 303, headers: { Location: url.href, "Set-Cookie": this.cookie(LOGIN_COOKIE, this.cipher.seal(state, "oidc-login"), 600), "Cache-Control": "no-store" } });
  }
  async callback(request: Request): Promise<Response> {
    let state: LoginState;
    try { state = this.cipher.open<LoginState>(cookieValue(request, LOGIN_COOKIE) ?? "", "oidc-login"); }
    catch { throw new AccessError("Sign-in expired. Start again.", 401); }
    if (state.expires <= Date.now()) throw new AccessError("Sign-in expired. Start again.", 401);
    const used = await this.db.pool.query("DELETE FROM licensegraph.login_attempts WHERE state_hash=$1 AND expires_at>now() RETURNING state_hash", [hashSecret(state.state)]);
    if (!used.rowCount) throw new AccessError("This sign-in has already been used or expired.", 401);
    const url = new URL(`${this.appUrl}/api/auth/callback`);
    url.search = new URL(request.url).search;
    let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
    try {
      tokens = await oidc.authorizationCodeGrant(await this.configuration(), url, { pkceCodeVerifier: state.verifier, expectedState: state.state, expectedNonce: state.nonce, idTokenExpected: true });
    } catch (error) {
      // A refused consent, a forged state or a bad code is the caller's problem. An unreachable provider is not, and stays an outage.
      if (error instanceof oidc.ClientError || error instanceof oidc.AuthorizationResponseError || error instanceof oidc.ResponseBodyError) throw new AccessError("Sign-in could not be completed. Start again.", 401);
      throw error;
    }
    const claims = tokens.claims();
    if (!claims?.sub || claims.email_verified !== true || typeof claims.email !== "string") throw new AccessError("Verify your email before signing in.", 401);
    const realm = claims.realm_access as { roles?: unknown } | undefined;
    const roles = ["buyer", ...(Array.isArray(realm?.roles) ? realm.roles.filter((role): role is string => role === "licensor" || role === "staff") : [])];
    const mfa = Array.isArray(claims.amr) && claims.amr.some((method) => method === "otp" || method === "mfa" || method === "hwk");
    const token = randomBytes(32).toString("base64url");
    // Staff authority is short-lived so a revoked role cannot outlast a short window.
    const lifetime = roles.includes("staff") ? STAFF_SESSION_SECONDS : SESSION_SECONDS;
    await this.db.transaction(async (tx) => {
      const previous = (await tx.query("SELECT id,email,roles FROM licensegraph.users WHERE issuer=$1 AND subject=$2 FOR UPDATE", [this.issuer, claims.sub])).rows[0];
      const user = await tx.query(`INSERT INTO licensegraph.users(id,issuer,subject,email,display_name,roles) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (issuer,subject) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,roles=EXCLUDED.roles RETURNING id`,
      [randomUUID(), this.issuer, claims.sub, claims.email, typeof claims.name === "string" ? claims.name : claims.email, roles]);
      const userId: string = user.rows[0].id;
      if (previous) await this.revalidateSeller(tx, userId, previous, claims.email as string, roles);
      await tx.query("INSERT INTO licensegraph.auth_sessions(token_hash,user_id,expires_at,mfa) VALUES ($1,$2,$3,$4)", [hashSecret(token), userId, new Date(Date.now() + lifetime * 1000), mfa]);
    });
    const headers = new Headers({ Location: new URL(state.returnTo??"/workspace",this.appUrl).href, "Cache-Control": "no-store" });
    headers.append("Set-Cookie", this.cookie(COOKIE, token, lifetime));
    headers.append("Set-Cookie", this.cookie(LOGIN_COOKIE, "", 0));
    return new Response(null, { status: 303, headers });
  }
  /**
   * A changed email or a withdrawn licensor role means the person who was reviewed may no longer control the payout
   * recipient. Approval is withdrawn, earlier sessions and agent credentials end, and the change is audited.
   */
  private async revalidateSeller(tx: Transaction, userId: string, previous: { email: string; roles: string[] }, email: string, roles: string[]) {
    const emailChanged = previous.email.toLowerCase() !== email.toLowerCase();
    const licensorLost = previous.roles.includes("licensor") && !roles.includes("licensor");
    const staffLost = previous.roles.includes("staff") && !roles.includes("staff");
    if (!emailChanged && !licensorLost && !staffLost) return;
    await tx.query("DELETE FROM licensegraph.auth_sessions WHERE user_id=$1", [userId]);
    if (emailChanged || licensorLost) {
      await tx.query("UPDATE licensegraph.agent_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
      const reason = licensorLost ? "The licensor role was withdrawn." : "The account email changed; confirm the recipient again and await review.";
      const changed = await tx.query("UPDATE licensegraph.licensors SET status=$2, recipient_confirmed_at=NULL, review_reason=$3 WHERE user_id=$1 AND (status NOT IN ('pending','rejected','suspended') OR recipient_confirmed_at IS NOT NULL) RETURNING id", [userId, licensorLost ? "suspended" : "pending", reason]);
      if (changed.rowCount) {
        const id = randomUUID();
        await tx.query("INSERT INTO licensegraph.audit_events(id,actor_id,action,resource_id,sealed) VALUES ($1,$2,$3,$4,$5)", [id, userId, "licensor.revalidation_required", changed.rows[0].id, this.cipher.seal({ emailChanged, licensorLost }, `audit:${id}`)]);
      }
    }
  }
  async principal(request: Request): Promise<Principal | undefined> {
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (bearer) {
      const result = await this.db.pool.query("SELECT u.id,u.email,u.display_name,t.id AS token_id FROM licensegraph.agent_tokens t JOIN licensegraph.users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>now()", [hashSecret(bearer)]);
      const row = result.rows[0];
      return row ? { id: row.id, email: row.email, name: row.display_name, roles: ["buyer"], mfa: false, agent: true, tokenId: row.token_id } : undefined;
    }
    const token = cookieValue(request, COOKIE);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const result = await this.db.pool.query(`SELECT u.id,u.email,u.display_name,u.roles,s.mfa FROM licensegraph.auth_sessions s JOIN licensegraph.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [hashSecret(token)]);
    const row = result.rows[0];
    return row ? { id: row.id, email: row.email, name: row.display_name, roles: row.roles, mfa: row.mfa } : undefined;
  }
  async require(request: Request): Promise<Principal> {
    const principal = await this.principal(request);
    if (!principal) throw new AccessError("Sign in to access your private workspace.", 401);
    return principal;
  }
  async logout(request: Request): Promise<Response> {
    requireSameOrigin(request, this.appUrl);
    const token = cookieValue(request, COOKIE);
    if (token) await this.db.pool.query("DELETE FROM licensegraph.auth_sessions WHERE token_hash=$1", [hashSecret(token)]);
    return new Response(null, { status: 303, headers: { Location: `${this.appUrl}/workspace`, "Set-Cookie": this.cookie(COOKIE, "", 0), "Cache-Control": "no-store" } });
  }
}
