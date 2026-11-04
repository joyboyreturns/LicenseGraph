import { describe, expect, it } from "vitest";
import { RecordCipher } from "../src/storage/crypto";
const keys = { first: "01".repeat(32), next: "02".repeat(32) };
describe("encrypted records", () => {
  it("authenticates content and record identity with unique nonces", () => {
    const cipher = new RecordCipher("first", keys);
    const sealed = cipher.seal({ text: "private licence" }, "run:one");
    expect(sealed).not.toContain("private licence");
    expect(cipher.seal({ text: "private licence" }, "run:one")).not.toBe(sealed);
    expect(cipher.open(sealed, "run:one")).toEqual({ text: "private licence" });
    expect(() => cipher.open(sealed, "run:other")).toThrow();
    const parts = sealed.split("."); parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => cipher.open(parts.join("."), "run:one")).toThrow();
  });
  it("supports rotation without abandoning earlier records", () => {
    const old = new RecordCipher("first", keys).seal({ n: 1 }, "id");
    const cipher = new RecordCipher("next", keys);
    expect(cipher.open(old, "id")).toEqual({ n: 1 });
    expect(cipher.seal({}, "id")).toMatch(/^v1.next\./);
    expect(() => new RecordCipher("next", { next: keys.next }).open(old, "id")).toThrow();
  });
  it("refuses missing or malformed key material", () => {
    expect(() => new RecordCipher("first", { first: "short" })).toThrow();
    expect(() => new RecordCipher("missing", keys)).toThrow();
  });
});
