import { describe, expect, it } from "vitest";
import { ownerCookie, ownerFor, ownsRun, readOwner } from "../src/server/owner";

const req = (cookie?: string) => new Request("http://app", { headers: cookie ? { cookie } : {} });

describe("owner cookie", () => {
  it("reads the owner among other cookies", () => {
    expect(readOwner(req("theme=dark; lg_owner=abcd-1234-efgh; other=1"))).toBe("abcd-1234-efgh");
  });

  it("ignores missing, malformed or hostile values", () => {
    expect(readOwner(req())).toBeUndefined();
    expect(readOwner(req("lg_owner="))).toBeUndefined();
    expect(readOwner(req("lg_owner=short"))).toBeUndefined();
    expect(readOwner(req("lg_owner=../../etc/passwd"))).toBeUndefined();
    expect(readOwner(req('lg_owner="quoted-value-123"'))).toBeUndefined();
  });

  it("keeps an existing id and mints a new one otherwise", () => {
    expect(ownerFor(req("lg_owner=abcd-1234-efgh"))).toEqual({ id: "abcd-1234-efgh", isNew: false });
    const fresh = ownerFor(req());
    expect(fresh.isNew).toBe(true);
    expect(fresh.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("builds a cookie that scripts cannot read and that is Secure on https", () => {
    expect(ownerCookie("abcd-1234-efgh", false)).toBe("lg_owner=abcd-1234-efgh; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax");
    expect(ownerCookie("abcd-1234-efgh", true)).toMatch(/; Secure$/);
  });

  it("owns a run only with the matching id, unless the run has no owner", () => {
    expect(ownsRun({ ownerId: "abcd-1234-efgh" }, req("lg_owner=abcd-1234-efgh"))).toBe(true);
    expect(ownsRun({ ownerId: "abcd-1234-efgh" }, req("lg_owner=zzzz-9999-yyyy"))).toBe(false);
    expect(ownsRun({ ownerId: "abcd-1234-efgh" }, req())).toBe(false);
    expect(ownsRun({}, req())).toBe(true);
  });
});
