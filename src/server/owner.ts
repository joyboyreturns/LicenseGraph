import { randomUUID } from "node:crypto";

export const OWNER_COOKIE = "lg_owner";
const VALID = /^[a-zA-Z0-9-]{8,64}$/;

/** The anonymous browser id from the request's cookie, if there is a valid one. */
export function readOwner(req: Request): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === OWNER_COOKIE) {
      const value = rest.join("=");
      return VALID.test(value) ? value : undefined;
    }
  }
  return undefined;
}

/** Use the caller's id, or mint a new one that the response must hand back as a cookie. */
export function ownerFor(req: Request): { id: string; isNew: boolean } {
  const existing = readOwner(req);
  return existing ? { id: existing, isNew: false } : { id: randomUUID(), isNew: true };
}

/** Not readable by page scripts, sent only to this site, kept for a year. `secure` is for https deployments. */
export function ownerCookie(id: string, secure: boolean): string {
  return `${OWNER_COOKIE}=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/**
 * Runs belong to the browser that created them. A run with no recorded owner (made before owners
 * existed) stays open, so older runs keep working.
 */
export function ownsRun(session: { ownerId?: string }, req: Request): boolean {
  return !session.ownerId || session.ownerId === readOwner(req);
}
