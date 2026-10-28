import { describe, expect, it, vi } from "vitest";
import { parseBrief, parseBriefLocally } from "../src/intake/brief";

const p = (text: string) => parseBriefLocally(text).project;

describe("parseBriefLocally", () => {
  it("reads a typical brief", () => {
    const r = parseBriefLocally('A US ad campaign for my shoe brand called "Stride", 12 months, under $500, with a song, an image and a font, for web and social.');
    expect(r.project).toMatchObject({ name: "Stride", commercial: true, territories: ["US"], termMonths: 12, budgetCents: 50_000, mediums: ["web", "social"] });
    expect(r.requiredAssetIds).toEqual(["song", "image", "font"]);
    expect(r.assumed).toEqual([]);
    expect(r.source).toBe("local");
  });

  it("says what it assumed when the text is silent", () => {
    const r = parseBriefLocally("I need some music.");
    expect(r.project).toMatchObject({ name: "My project", commercial: true, territories: ["WORLD"], termMonths: 12 });
    expect(r.assumed).toEqual(["Commercial use (to be safe)", "Territory: worldwide", "Term: 12 months"]);
    expect(r.requiredAssetIds).toEqual(["song"]);
  });

  it("understands non-commercial use", () => {
    expect(p("A school project, personal use only").commercial).toBe(false);
    expect(p("non-commercial documentary").commercial).toBe(false);
  });

  it("reads territories, worldwide wins, and EU expands", () => {
    expect(p("for India and the UK").territories).toEqual(["GB", "IN"]);
    expect(p("worldwide release in the US").territories).toEqual(["WORLD"]);
    expect(p("launching across the EU").territories).toContain("DE");
    expect(p("launching across the EU").territories).toHaveLength(27);
  });

  it("reads terms in months, years, words and perpetual", () => {
    expect(p("for 18 months").termMonths).toBe(18);
    expect(p("a 2 year licence").termMonths).toBe(24);
    expect(p("three years").termMonths).toBe(36);
    expect(p("for a year").termMonths).toBe(12);
    expect(p("we want it forever").termMonths).toBe(1200);
  });

  it("reads budgets in several phrasings", () => {
    expect(p("budget of $1,200").budgetCents).toBe(120_000);
    expect(p("up to 750 dollars").budgetCents).toBe(75_000);
    expect(p("no more than $2k").budgetCents).toBe(200_000);
    expect(p("a $300 budget").budgetCents).toBe(30_000);
    expect(p("no budget mentioned").budgetCents).toBeUndefined();
  });

  it("reads credit, sublicensing and exclusivity constraints", () => {
    const r = p("We can't give credit, must sublicense to our clients, and need it to be exclusive");
    expect(r).toMatchObject({ canCredit: false, needsSublicensing: true, requiresExclusive: true });
    expect(p("plain brief")).toMatchObject({ canCredit: undefined, needsSublicensing: undefined, requiresExclusive: undefined });
  });

  it("does not mistake other numbers for a budget", () => {
    expect(p("Need it within 12 months").budgetCents).toBeUndefined();
    expect(p("up to 3 songs").budgetCents).toBeUndefined();
    expect(p("Under 30 seconds long, under $500").budgetCents).toBe(50_000);
    // The stated budget wins over a limit-like phrase that comes earlier in the text.
    expect(p("Ad campaign, up to 3 songs, budget $2,000").budgetCents).toBe(200_000);
    expect(p("within $800 for everything").budgetCents).toBe(80_000);
  });

  it("reads decimal terms whole", () => {
    expect(p("1.5 years").termMonths).toBe(18);
    expect(p("2.5 years of use").termMonths).toBe(30);
    expect(p("a 6 month licence").termMonths).toBe(6);
  });

  it("does not turn a negated exclusivity into a requirement", () => {
    expect(p("We are fine with a non-exclusive licence").requiresExclusive).toBeUndefined();
    expect(p("It does not need to be exclusive").requiresExclusive).toBeUndefined();
    expect(p("We don't need exclusivity").requiresExclusive).toBeUndefined();
    expect(p("no exclusivity required").requiresExclusive).toBeUndefined();
    expect(p("non-exclusive images but we need the song to be exclusive").requiresExclusive).toBe(true);
  });

  it("reads the United States only when it is named, not the pronoun \"us\"", () => {
    expect(p("A song for us to use in an ad").territories).toEqual(["WORLD"]);
    expect(p("Send the final cut back to us").territories).toEqual(["WORLD"]);
    for (const text of ["A US ad", "an ad in the U.S.", "launching in the USA", "across the United States", "American audiences"]) {
      expect(p(text).territories).toEqual(["US"]);
    }
  });

  it("does not read a commercial brief as non-commercial because of a stray word", () => {
    expect(p("A commercial ad for a school fundraiser").commercial).toBe(true);
    expect(p("Brand video made with a student").commercial).toBe(true);
    expect(p("A student film").commercial).toBe(false);
    expect(p("hobby project").commercial).toBe(false);
    expect(p("A not-for-profit campaign").commercial).toBe(false);
  });

  it("recognises assets and media vocabulary", () => {
    const r = parseBriefLocally("podcast with theme music, cover art, a voiceover and sound effects");
    expect(r.requiredAssetIds).toEqual(["song", "image", "voiceover", "sfx"]);
    expect(r.project.mediums).toEqual(["audio"]);
  });
});

describe("parseBrief with a model", () => {
  const text = "A US ad, 12 months, under $500, song and font";
  const reply = (obj: unknown) => ({ complete: vi.fn().mockResolvedValue(`Sure: ${JSON.stringify(obj)}`) });

  it("lets the model fill in and correct, validating what it returns", async () => {
    const m = reply({ name: "Summer Ad", termMonths: 24, budgetUsd: 750, mediums: ["web"], assets: ["song", "font", "image"] });
    const r = await parseBrief(text, m);
    expect(r.source).toBe("model");
    expect(r.project).toMatchObject({ name: "Summer Ad", termMonths: 24, budgetCents: 75_000, mediums: ["web"], territories: ["US"] });
    expect(r.requiredAssetIds).toEqual(["song", "font", "image"]);
  });

  it("only ever tightens credit, never invents a freedom the text did not state", async () => {
    expect((await parseBrief(text, reply({ canCredit: true }))).project.canCredit).toBeUndefined();
    expect((await parseBrief(text, reply({ canCredit: false }))).project.canCredit).toBe(false);
  });

  it("normalises the model's territory codes and rejects ones the run API would refuse", async () => {
    expect((await parseBrief(text, reply({ territories: ["usa", "uk", " ca "] }))).project.territories).toEqual(["US", "GB", "CA"]);
    expect((await parseBrief(text, reply({ territories: ["Worldwide"] }))).project.territories).toEqual(["WORLD"]);
    // A country name is not a code: the reply is discarded and the local reading is used.
    expect(await parseBrief(text, reply({ territories: ["Germany"] }))).toEqual(parseBriefLocally(text));
  });

  it("falls back to the local reading on bad, invalid or failing replies", async () => {
    const local = parseBriefLocally(text);
    for (const m of [{ complete: vi.fn().mockResolvedValue("no json here") }, reply({ termMonths: -5 }), reply({ territories: [] }), { complete: vi.fn().mockRejectedValue(new Error("rate limited")) }]) {
      expect(await parseBrief(text, m)).toEqual(local);
    }
  });

  it("does not call a model when there is none", async () => {
    expect((await parseBrief(text)).source).toBe("local");
  });
});
