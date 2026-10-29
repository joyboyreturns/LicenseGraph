import { describe, expect, it } from "vitest";
import { issuePassport } from "../src/passport/issue";
import { passportCsv } from "../src/passport/csv";
import { paidSession } from "./passport-fixtures";

/** A small reader for the CSV the function writes: every cell is quoted, rows end with CRLF. */
const parse = (csv: string) => csv.trimEnd().split("\r\n").map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1]!.replace(/""/g, '"')));

describe("passportCsv", () => {
  it("writes one row per licence with the price, terms, end date and payout, and the amounts add up to the payment", async () => {
    const p = issuePassport(await paidSession());
    const [header, ...rows] = parse(passportCsv(p));
    expect(header).toEqual(["Passport", "Project", "Asset", "Licensor", "Terms", "Price", "Currency", "Bought on", "Ends on", "Payout status", "PayPal capture", "Environment"]);
    expect(rows).toHaveLength(p.bundle.offers.length);
    expect(rows.reduce((n, r) => n + Math.round(Number(r[5]) * 100), 0)).toBe(p.bundle.totalCents);
    for (const r of rows) {
      expect(r[0]).toBe(p.id);
      expect(r[7]).toBe(p.issuedAt.slice(0, 10));
      expect(r[10]).toBe(p.paypal.captureId);
    }
    const song = rows.find((r) => r[2] === "song")!;
    expect(song[3]).toBe("SoundHarbor Music");
    expect(song[4]).toMatch(/^commercial; /);
    expect(song[9]).not.toBe("");
  });

  it("cannot be turned into a formula by a licensor's name, and keeps commas and quotes intact", async () => {
    const p = issuePassport(await paidSession());
    p.project.name = 'Harbour, "at" Dawn';
    p.documents[0]!.licensorName = '=HYPERLINK("http://evil.example","x")';
    const csv = passportCsv(p);
    const rows = parse(csv);
    expect(rows[1]![1]).toBe('Harbour, "at" Dawn');
    const names = rows.slice(1).map((r) => r[3]!);
    expect(names.some((n) => n.startsWith("'="))).toBe(true);
    expect(names.some((n) => n.startsWith("="))).toBe(false);
    // Every row still has all twelve cells, however many commas and quotes the values hold.
    expect(rows.every((r) => r.length === 12)).toBe(true);
  });
});
