import { describe, expect, it, vi } from "vitest";
import { verifyBundle } from "../src/core/rules";
import type { Project } from "../src/core/types";
import { extractOffer, locateQuote } from "../src/extraction/extract";
import { createGatewayModel, minIntervalFromEnv, type ModelClient } from "../src/extraction/model";
import { cannedReply, fixtures, OPTIONAL_TERM_KEYS } from "../src/demo/fixtures";

const replying = (...replies: string[]): ModelClient & { complete: ReturnType<typeof vi.fn> } => {
  const complete = vi.fn();
  replies.forEach((r) => complete.mockResolvedValueOnce(r));
  return { complete };
};

describe("locateQuote", () => {
  const text = "Line one.\nThe Licensee may use the clip\n   in commercial works.\nEnd.";
  it("finds a quote across line wraps and returns original offsets", () => {
    const where = locateQuote(text, "The Licensee may use the clip in commercial works.")!;
    expect(text.slice(where.start, where.end)).toBe("The Licensee may use the clip\n   in commercial works.");
  });
  it("returns null for text that is not there", () => {
    expect(locateQuote(text, "Perpetual worldwide licence")).toBeNull();
  });
});

describe("extractOffer with a well-behaved model", () => {
  it.each([{ priceCents: Number.MAX_SAFE_INTEGER + 1 }, { currency: "123" }, { fixedEndDate: "2026-02-29" }, { termMonths: null }])("rejects invalid or unstated source terms %j", async (changes) => {
    const f = fixtures[0]!;
    const reply = { ...JSON.parse(cannedReply(f)), ...changes };
    const result = await extractOffer(replying(JSON.stringify(reply)), f.doc, { attempts: 1 });
    expect(result.offer).toBeUndefined();
    expect(result.problems.length).toBeGreaterThan(0);
  });
  it.each(fixtures)("extracts $doc.id with the expected terms and located evidence", async (f) => {
    const result = await extractOffer(replying(cannedReply(f)), f.doc);

    expect(result.problems).toEqual([]);
    const offer = result.offer!;
    expect(offer.priceCents).toBe(f.expected.priceCents);
    expect(offer.terms).toEqual(f.expected.terms);
    expect(offer.evidence.map((e) => e.field).sort()).toEqual(Object.keys(f.quotes).sort());
    for (const e of offer.evidence) expect(f.doc.text.slice(e.start, e.end).replace(/\s+/g, " ")).toBe(e.quote);
  });

  it("tolerates JSON wrapped in prose or code fences", async () => {
    const f = fixtures[0]!;
    const result = await extractOffer(replying("Here you go:\n```json\n" + cannedReply(f) + "\n```"), f.doc);
    expect(result.offer?.priceCents).toBe(20_000);
  });
});

describe("optional terms", () => {
  const voiceover = fixtures.find((f) => f.doc.id === "voiceover")!;
  const song = fixtures[0]!;

  it("leaves terms the text does not state blank", async () => {
    const { offer } = await extractOffer(replying(cannedReply(song)), song.doc);
    expect(offer!.terms).toEqual(song.expected.terms);
    for (const key of OPTIONAL_TERM_KEYS) expect(offer!.terms[key]).toBeUndefined();
  });

  it("captures every stated term with located evidence", async () => {
    const { offer } = await extractOffer(replying(cannedReply(voiceover)), voiceover.doc);
    expect(offer!.terms).toEqual(voiceover.expected.terms);
    expect(offer!.evidence.map((e) => e.field)).toEqual(expect.arrayContaining(["mediums", "attribution", "sublicensing", "exclusivity", "offerValidUntil"]));
  });

  it("rejects a stated optional term that has no evidence, and retries", async () => {
    const reply = JSON.parse(cannedReply(voiceover));
    reply.evidence = reply.evidence.filter((e: { field: string }) => e.field !== "sublicensing");
    const model = replying(JSON.stringify(reply), cannedReply(voiceover));
    const { offer } = await extractOffer(model, voiceover.doc);
    expect(offer).toBeDefined();
    expect(model.complete.mock.calls[1]![0].user).toMatch(/missing evidence for sublicensing/);
  });

  it("rejects an invented quote for an optional term", async () => {
    const reply = JSON.parse(cannedReply(voiceover));
    reply.evidence = reply.evidence.map((e: { field: string }) => (e.field === "sublicensing" ? { field: "sublicensing", quote: "Sublicensing is allowed." } : e));
    const result = await extractOffer(replying(JSON.stringify(reply)), voiceover.doc, { attempts: 1 });
    expect(result.offer).toBeUndefined();
    expect(result.problems[0]).toMatch(/sublicensing/);
  });

  it("accepts evidence labelled with the JSON key name", async () => {
    const reply = JSON.parse(cannedReply(voiceover));
    reply.evidence = reply.evidence.map((e: { field: string; quote: string }) => ({ ...e, field: { term: "termMonths", price: "priceCents", attribution: "attributionRequired", exclusivity: "exclusive" }[e.field] ?? e.field }));
    const { offer, problems } = await extractOffer(replying(JSON.stringify(reply)), voiceover.doc, { attempts: 1 });
    expect(problems).toEqual([]);
    expect(offer!.evidence.map((e) => e.field)).toEqual(expect.arrayContaining(["term", "price", "attribution", "exclusivity"]));
  });

  it("normalises media: [\"ALL\"] and \"all\" mean any medium, names are lowercased", async () => {
    const archive = fixtures.find((f) => f.doc.id === "archive")!;
    for (const mediums of [["ALL"], "all", "ALL"]) {
      const reply = { ...JSON.parse(cannedReply(archive)), mediums };
      expect((await extractOffer(replying(JSON.stringify(reply)), archive.doc, { attempts: 1 })).offer!.terms.mediums).toBe("ALL");
    }
    const reply = { ...JSON.parse(cannedReply(archive)), mediums: ["Web", " Broadcast "] };
    expect((await extractOffer(replying(JSON.stringify(reply)), archive.doc, { attempts: 1 })).offer!.terms.mediums).toEqual(["web", "broadcast"]);
  });

  it("rejects malformed dates", async () => {
    const reply = JSON.parse(cannedReply(voiceover));
    reply.offerValidUntil = "30 November 2026";
    expect((await extractOffer(replying(JSON.stringify(reply)), voiceover.doc, { attempts: 1 })).offer).toBeUndefined();
  });

  it("feeds the rules engine: a project that needs sublicensing rejects the voiceover, the archive passes", async () => {
    const project: Project = { name: "Ad", commercial: true, territories: ["US"], termMonths: 12, needsSublicensing: true, mediums: ["web"] };
    const archive = fixtures.find((f) => f.doc.id === "archive")!;
    const offers = [(await extractOffer(replying(cannedReply(voiceover)), voiceover.doc)).offer!, (await extractOffer(replying(cannedReply(archive)), archive.doc)).offer!];
    const v = verifyBundle(project, ["voiceover", "archive"], { offers }, { today: "2026-11-01" });
    expect(v.violations.map((x) => `${x.rule}:${x.assetId}`)).toEqual(["sublicensing:voiceover"]);
  });
});

describe("territory codes", () => {
  const f = fixtures[0]!;
  const withTerritories = (territories: unknown) => JSON.stringify({ ...JSON.parse(cannedReply(f)), territories });

  it("normalises case and spacing so an equivalent code still matches the project", async () => {
    const result = await extractOffer(replying(withTerritories([" us ", "ca", "Worldwide"])), f.doc, { attempts: 1 });
    expect(result.offer?.terms.territories).toEqual(["US", "CA", "WORLD"]);
  });

  it("sends a country name back for a retry instead of storing something the rules cannot match", async () => {
    const model = replying(withTerritories(["United States"]), cannedReply(f));
    const result = await extractOffer(model, f.doc);
    expect(result.offer).toBeDefined();
    expect(model.complete).toHaveBeenCalledTimes(2);
    expect(model.complete.mock.calls[1]![0].user).toMatch(/alpha-2/);
  });
});

describe("extractOffer rejects what it cannot verify", () => {
  const f = fixtures[0]!;
  const withQuote = (field: string, quote: string) => {
    const reply = JSON.parse(cannedReply(f));
    reply.evidence = reply.evidence.map((e: { field: string }) => (e.field === field ? { field, quote } : e));
    return JSON.stringify(reply);
  };

  it("drops an invented quote and retries with the reason", async () => {
    const model = replying(withQuote("term", "This licence is valid forever."), cannedReply(f));
    const result = await extractOffer(model, f.doc);

    expect(result.offer).toBeDefined();
    expect(model.complete).toHaveBeenCalledTimes(2);
    expect(model.complete.mock.calls[1]![0].user).toMatch(/not found in the document/);
  });

  it("gives up after the attempt limit and returns the problems", async () => {
    const bad = withQuote("term", "This licence is valid forever.");
    const result = await extractOffer(replying(bad, bad), f.doc);

    expect(result.offer).toBeUndefined();
    expect(result.problems[0]).toMatch(/term/);
  });

  it("rejects replies with missing evidence or invalid JSON", async () => {
    const reply = JSON.parse(cannedReply(f));
    reply.evidence = reply.evidence.filter((e: { field: string }) => e.field !== "price");
    const missing = await extractOffer(replying(JSON.stringify(reply)), f.doc, { attempts: 1 });
    expect(missing.problems).toEqual(["missing evidence for price"]);

    const junk = await extractOffer(replying("sorry, I cannot help"), f.doc, { attempts: 1 });
    expect(junk.offer).toBeUndefined();
  });
});

describe("extracted offers feed the rules engine", () => {
  it("a non-commercial photo is rejected for a commercial project, the rest pass", async () => {
    const project: Project = { name: "Promo film", commercial: true, territories: ["US"], termMonths: 12 };
    const offers = [];
    for (const f of fixtures.slice(0, 4)) offers.push((await extractOffer(replying(cannedReply(f)), f.doc)).offer!);

    const verdict = verifyBundle(project, ["song", "photo", "font", "footage"], { offers });
    expect(verdict.violations.map((v) => `${v.rule}:${v.assetId}`)).toEqual(["commercial-use:photo"]);
  });
});

describe("createGatewayModel", () => {
  const models = (pricing: unknown) => new Response(JSON.stringify({ data: [{ id: "m/x", pricing }] }));
  const chat = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  const router = (pricing: unknown, reply: () => Response) =>
    vi.fn(async (url: string) => (url.endsWith("/v1/models") ? models(pricing) : reply()));
  const free = { input: "0", output: "0" };

  it("checks the model is free, then posts to the gateway", async () => {
    const fetchMock = router(free, () => chat("hi"));
    const model = createGatewayModel({ apiKey: "k", model: "m/x", fetch: fetchMock as unknown as typeof fetch });

    expect(await model.complete({ system: "s", user: "u" })).toBe("hi");
    expect(await model.complete({ system: "s", user: "u" })).toBe("hi");
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe("https://ai-gateway.vercel.sh/v1/models");
    expect(urls.filter((u) => u.endsWith("/v1/models"))).toHaveLength(1); // price checked once
    const [, init] = fetchMock.mock.calls[1]! as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body).model).toBe("m/x");
  });

  it.each([
    ["a paid model", { input: "0.000003", output: "0.000015" }],
    ["a model with no pricing", undefined],
    ["a model with only a zero input price", { input: "0" }],
  ])("never sends a completion for %s", async (_name, pricing) => {
    const fetchMock = router(pricing, () => chat("should not happen"));
    const model = createGatewayModel({ apiKey: "k", model: "m/x", fetch: fetchMock as unknown as typeof fetch });

    await expect(model.complete({ system: "s", user: "u" })).rejects.toThrow(/not free/);
    expect(fetchMock.mock.calls.some((c) => c[0].endsWith("/chat/completions"))).toBe(false);
  });

  it("refuses an unknown model and a failed price check", async () => {
    const unknown = router(free, () => chat("x"));
    await expect(createGatewayModel({ apiKey: "k", model: "other/model", fetch: unknown as unknown as typeof fetch }).complete({ system: "s", user: "u" })).rejects.toThrow(/not in the gateway list/);

    const down = vi.fn(async () => new Response("{}", { status: 500 }));
    await expect(createGatewayModel({ apiKey: "k", model: "m/x", fetch: down as unknown as typeof fetch }).complete({ system: "s", user: "u" })).rejects.toThrow(/not sending any request/);
    expect(down).toHaveBeenCalledTimes(1);
  });

  it("recovers after a transient price-check failure instead of caching it, and still checks before sending", async () => {
    let checks = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.endsWith("/v1/models")) return chat("hi");
      return ++checks === 1 ? new Response("{}", { status: 503 }) : models(free);
    });
    const model = createGatewayModel({ apiKey: "k", model: "m/x", fetch: fetchMock as unknown as typeof fetch });

    await expect(model.complete({ system: "s", user: "u" })).rejects.toThrow(/not sending any request/);
    expect(fetchMock.mock.calls.some((c) => c[0].endsWith("/chat/completions"))).toBe(false);

    expect(await model.complete({ system: "s", user: "u" })).toBe("hi");
    expect(await model.complete({ system: "s", user: "u" })).toBe("hi");
    expect(fetchMock.mock.calls.filter((c) => c[0].endsWith("/v1/models"))).toHaveLength(2); // the pass is cached, the failure was not
  });

  it("keeps refusing a paid model on every call", async () => {
    const fetchMock = router({ input: "0.000003", output: "0.000015" }, () => chat("should not happen"));
    const model = createGatewayModel({ apiKey: "k", model: "m/x", fetch: fetchMock as unknown as typeof fetch });
    await expect(model.complete({ system: "s", user: "u" })).rejects.toThrow(/not free/);
    await expect(model.complete({ system: "s", user: "u" })).rejects.toThrow(/not free/);
    expect(fetchMock.mock.calls.some((c) => c[0].endsWith("/chat/completions"))).toBe(false);
  });

  it("explains empty content and gateway errors", async () => {
    const empty = createGatewayModel({ apiKey: "k", model: "m/x", fetch: router(free, () => chat("")) as unknown as typeof fetch });
    await expect(empty.complete({ system: "s", user: "u" })).rejects.toThrow(/no content/);

    const denied = createGatewayModel({ apiKey: "k", model: "m/x", fetch: router(free, () => new Response(JSON.stringify({ error: { message: "needs plan" } }), { status: 403 })) as unknown as typeof fetch });
    await expect(denied.complete({ system: "s", user: "u" })).rejects.toThrow(/403 needs plan/);
  });
});

describe("gateway pacing", () => {
  const free = { input: "0", output: "0" };
  const route = (calls: number[], t: () => number) =>
    vi.fn(async (url: string) => {
      if (url.endsWith("/v1/models")) return new Response(JSON.stringify({ data: [{ id: "m/x", pricing: free }] }));
      calls.push(t());
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    });

  it("spaces requests by the minimum interval so a burst stays inside the rate limit", async () => {
    let t = 1_000;
    const calls: number[] = [];
    const sleeps: number[] = [];
    const model = createGatewayModel({ apiKey: "k", model: "m/x", minIntervalMs: 12_500, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, fetch: route(calls, () => t) as unknown as typeof fetch });

    for (let i = 0; i < 3; i++) await model.complete({ system: "s", user: "u" });
    expect(sleeps).toEqual([12_500, 12_500]); // the first call goes straight out
    expect(calls).toEqual([1_000, 13_500, 26_000]);
  });

  it("does not wait when calls are naturally further apart", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const model = createGatewayModel({ apiKey: "k", model: "m/x", minIntervalMs: 12_500, now: () => t, sleep: async (ms) => void sleeps.push(ms), fetch: route([], () => t) as unknown as typeof fetch });
    await model.complete({ system: "s", user: "u" });
    t = 60_000;
    await model.complete({ system: "s", user: "u" });
    expect(sleeps).toEqual([]);
  });

  it("derives the interval from requests per minute", () => {
    expect(minIntervalFromEnv({})).toBe(12_500);
    expect(minIntervalFromEnv({ LICENSEGRAPH_MODEL_RPM: "20" })).toBe(3_500);
    expect(minIntervalFromEnv({ LICENSEGRAPH_MODEL_RPM: "0" })).toBe(12_500);
  });
});
