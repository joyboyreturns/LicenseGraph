import { describe, expect, it, vi } from "vitest";
import { verifyBundle } from "../src/core/rules";
import type { Project } from "../src/core/types";
import { extractOffer, locateQuote } from "../src/extraction/extract";
import { createGatewayModel, gatewayConfigFromEnv, minIntervalFromEnv, type ModelClient } from "../src/extraction/model";
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
    // Only the quote is missing, so the follow-up asks for just that quote, not the whole extraction again.
    expect(model.complete.mock.calls[1]![0].system).toMatch(/find supporting quotes/);
    expect(model.complete.mock.calls[1]![0].user).toMatch(/Give one verbatim quote .* for each of: sublicensing\./);
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

describe("evidence given as a map", () => {
  const f = fixtures[0]!;

  it("is repaired into a list, and every quote is still located in the source", async () => {
    const reply = JSON.parse(cannedReply(f));
    const asMap: Record<string, string[]> = {};
    for (const e of reply.evidence as { field: string; quote: string }[]) (asMap[e.field] ??= []).push(e.quote);
    const result = await extractOffer(replying(JSON.stringify({ ...reply, evidence: asMap })), f.doc, { attempts: 1 });
    expect(result.problems).toEqual([]);
    expect(result.offer?.evidence.map((e) => e.field).sort()).toEqual(reply.evidence.map((e: { field: string }) => e.field).sort());
    for (const e of result.offer!.evidence) expect(f.doc.text.slice(e.start, e.end).replace(/\s+/g, " ")).toBe(e.quote.replace(/\s+/g, " "));
  });

  it("still rejects an invented quote given in map form", async () => {
    const reply = JSON.parse(cannedReply(f));
    const result = await extractOffer(replying(JSON.stringify({ ...reply, evidence: { price: "A price nobody wrote", commercialUse: "x", territories: "y", term: "z" } })), f.doc, { attempts: 1 });
    expect(result.offer).toBeUndefined();
    expect(result.problems.join(" ")).toMatch(/not found in the document/);
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
    const result = await extractOffer(replying(bad, bad, bad), f.doc);

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

  it("gives up on a request that never answers, with a message a retry can act on", async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => (url.endsWith("/v1/models") ? models(free) : hang(url, init)));
    const model = createGatewayModel({ apiKey: "k", model: "m/x", timeoutMs: 30, fetch: fetchMock as unknown as typeof fetch });
    await expect(model.complete({ system: "s", user: "u" })).rejects.toThrow(/The model request timed out after 30ms/);
  });

  it("says why a reply was empty", async () => {
    const empty = (message: object, finish = "length") => vi.fn(async (url: string) => (url.endsWith("/v1/models") ? models(free) : new Response(JSON.stringify({ choices: [{ message, finish_reason: finish }] }), { status: 200 })));
    const ask = (fetchMock: ReturnType<typeof empty>) => createGatewayModel({ apiKey: "k", model: "m/x", fetch: fetchMock as unknown as typeof fetch }).complete({ system: "s", user: "u" });
    await expect(ask(empty({ content: "" }))).rejects.toThrow(/returned no content \(finish reason: length\)/);
    await expect(ask(empty({ content: "", reasoning_content: "thinking..." }))).rejects.toThrow(/finish reason: length, it produced only reasoning/);
  });

  it("reads the timeout from the environment", () => {
    expect(gatewayConfigFromEnv({ AI_GATEWAY_API_KEY: "k", LICENSEGRAPH_MODEL: "m/x", LICENSEGRAPH_MODEL_TIMEOUT_MS: "45000" }).timeoutMs).toBe(45_000);
    expect(gatewayConfigFromEnv({ AI_GATEWAY_API_KEY: "k", LICENSEGRAPH_MODEL: "m/x" }).timeoutMs).toBeUndefined();
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


describe("small-model failure modes", () => {
  const f = fixtures[0]!;
  const reply = () => JSON.parse(cannedReply(f));
  const evidenceOf = () => reply().evidence as { field: string; quote: string }[];
  const noEvidence = () => JSON.stringify({ ...reply(), evidence: [] });
  const onlyEvidence = (evidence = evidenceOf()) => JSON.stringify({ evidence });

  describe("reading the reply", () => {
    it("ignores a thinking block that contains braces", async () => {
      const r = await extractOffer(replying(`<think>The format is {"priceCents": ...} so I should fill it in.</think>\n${cannedReply(f)}`), f.doc, { attempts: 1 });
      expect(r.problems).toEqual([]);
      expect(r.offer?.priceCents).toBe(f.expected.priceCents);
    });

    it("takes the answer, not an example object that came before it", async () => {
      const r = await extractOffer(replying(`For example: {"note": "not the answer"}\nAnswer:\n${cannedReply(f)}\nHope that helps {smile}`), f.doc, { attempts: 1 });
      expect(r.offer?.priceCents).toBe(f.expected.priceCents);
    });

    it("keeps braces inside quoted text from ending the object early", async () => {
      const tricky = { ...reply(), mediums: null, evidence: evidenceOf() };
      expect((await extractOffer(replying(`{"x": "}{"} ${JSON.stringify(tricky)}`), f.doc, { attempts: 1 })).problems).toEqual([]);
    });

    it("unwraps an answer nested under offer, result or terms", async () => {
      expect((await extractOffer(replying(JSON.stringify({ offer: reply() })), f.doc, { attempts: 1 })).problems).toEqual([]);
      const { commercialUse, territories, termMonths, ...top } = reply();
      expect((await extractOffer(replying(JSON.stringify({ ...top, terms: { commercialUse, territories, termMonths } })), f.doc, { attempts: 1 })).problems).toEqual([]);
    });

    it("repairs evidence given as a map of field to {field, quote} objects, as the free model has answered", async () => {
      const asObjects = Object.fromEntries(evidenceOf().map((e) => [e.field, { field: e.field, quote: e.quote }]));
      const r = await extractOffer(replying(JSON.stringify({ ...reply(), evidence: asObjects })), f.doc, { attempts: 1 });
      expect(r.problems).toEqual([]);
      expect(r.offer?.evidence.map((e) => e.field).sort()).toEqual(["commercialUse", "price", "term", "territories"].sort());
    });

    it("reads the reply nemotron-lightning-3.5 actually gave for the song licence (evidence as a map of objects)", async () => {
      const real = "{\n  \"priceCents\": 20000,\n  \"currency\": \"USD\",\n  \"commercialUse\": true,\n  \"territories\": [\"WORLD\"],\n  \"termMonths\": 24,\n  \"mediums\": null,\n  \"attributionRequired\": null,\n  \"sublicensing\": null,\n  \"exclusive\": null,\n  \"fixedEndDate\": null,\n  \"offerValidUntil\": null,\n  \"evidence\": {\n    \"price\": {\"field\": \"price\", \"quote\": \"USD 200.00\"},\n    \"commercialUse\": {\"field\": \"commercialUse\", \"quote\": \"The Licensee may use the Track in commercial productions, including advertising and paid distribution.\"},\n    \"territories\": {\"field\": \"territories\", \"quote\": \"Worldwide.\"},\n    \"term\": {\"field\": \"term\", \"quote\": \"This licence is valid for 24 months from the date of purchase.\"}\n  }\n}";
      const r = await extractOffer(replying(real), f.doc, { attempts: 1 });
      expect(r.problems).toEqual([]);
      expect(r.offer?.terms).toEqual(f.expected.terms);
      expect(r.offer?.evidence).toHaveLength(4);
    });

    it("repairs evidence given as a list with several quotes per field", async () => {
      const grouped = evidenceOf().map((e) => ({ field: e.field, quotes: [e.quote] }));
      const r = await extractOffer(replying(JSON.stringify({ ...reply(), evidence: grouped })), f.doc, { attempts: 1 });
      expect(r.problems).toEqual([]);
    });

    it("still locates every repaired quote in the text: an invented one is rejected", async () => {
      const asObjects = Object.fromEntries(evidenceOf().map((e) => [e.field, { field: e.field, quote: e.field === "price" ? "Only $1" : e.quote }]));
      const r = await extractOffer(replying(JSON.stringify({ ...reply(), evidence: asObjects })), f.doc, { attempts: 1 });
      expect(r.offer).toBeUndefined();
      expect(r.problems.join(" ")).toMatch(/price not found in the document/);
    });

    it("accepts near spellings of the evidence field names, and ignores entries it cannot use", async () => {
      const spelled = evidenceOf().map((e) => ({ field: ({ price: "Price", commercialUse: "commercial", territories: "territory", term: "duration" } as Record<string, string>)[e.field] ?? e.field, quote: e.quote }));
      const noise = [{ field: "mood", quote: "whatever" }, { field: "price" }, "stray text", null];
      const r = await extractOffer(replying(JSON.stringify({ ...reply(), evidence: [...noise, ...spelled] })), f.doc, { attempts: 1 });
      expect(r.problems).toEqual([]);
      expect(r.offer?.evidence.map((e) => e.field).sort()).toEqual(["commercialUse", "price", "term", "territories"].sort());
    });
  });

  describe("telling the model what was wrong", () => {
    it("names the missing field and its format instead of dumping validation JSON", async () => {
      const { priceCents, ...withoutPrice } = reply();
      const model = replying(JSON.stringify(withoutPrice), cannedReply(f));
      const r = await extractOffer(model, f.doc);
      expect(r.offer).toBeDefined();
      const hint = model.complete.mock.calls[1]![0].user as string;
      expect(hint).toMatch(/priceCents: .*\(must be an integer number of cents/);
      expect(hint).not.toMatch(/invalid_type|"code"/);
    });

    it("explains an unusable termMonths in words", async () => {
      const model = replying(JSON.stringify({ ...reply(), termMonths: "a while" }), cannedReply(f));
      await extractOffer(model, f.doc);
      expect(model.complete.mock.calls[1]![0].user).toMatch(/termMonths: .*\(must be an integer number of months, or "perpetual"\)/);
    });
  });

  describe("an empty or wrong evidence list", () => {
    it("asks only for the quotes, keeps the values already given, and finishes in two calls", async () => {
      const model = replying(noEvidence(), onlyEvidence());
      const r = await extractOffer(model, f.doc);
      expect(r.problems).toEqual([]);
      expect(r.offer?.priceCents).toBe(f.expected.priceCents);
      expect(r.offer?.terms).toEqual(f.expected.terms);
      expect(model.complete).toHaveBeenCalledTimes(2);
      const ask = model.complete.mock.calls[1]![0];
      expect(ask.system).toMatch(/find supporting quotes/);
      expect(ask.user).toContain(f.doc.text);
      expect(ask.user).toMatch(/- price: 200\.00 USD/);
      expect(ask.user).toMatch(/for each of: price, commercialUse, territories, term\./);
    });

    it("keeps the quotes that were real, names the invented ones, and asks only for what is still missing", async () => {
      const partial = evidenceOf().map((e) => (e.field === "term" ? { field: "term", quote: "This licence is valid forever." } : e));
      const model = replying(JSON.stringify({ ...reply(), evidence: partial }), onlyEvidence(evidenceOf().filter((e) => e.field === "term")));
      const r = await extractOffer(model, f.doc);
      expect(r.problems).toEqual([]);
      expect(r.offer?.evidence.map((e) => e.field).sort()).toEqual(["commercialUse", "price", "term", "territories"].sort());
      const ask = model.complete.mock.calls[1]![0].user as string;
      expect(ask).toMatch(/for each of: term\./);
      expect(ask).toMatch(/This licence is valid forever\..*not found in the document|not found in the document.*This licence is valid forever\./s);
      expect(ask).not.toMatch(/- price:/);
    });

    it("does not let a quote from the follow-up through unless it is really in the document", async () => {
      const made = onlyEvidence(evidenceOf().map((e) => ({ field: e.field, quote: `invented: ${e.field}` })));
      const r = await extractOffer(replying(noEvidence(), made, made), f.doc);
      expect(r.offer).toBeUndefined();
      expect(r.problems.join(" ")).toMatch(/not found in the document/);
    });

    it("keeps asking for just the quotes when a follow-up comes back unreadable", async () => {
      const model = replying(noEvidence(), "I am unable to find quotes.", onlyEvidence());
      const r = await extractOffer(model, f.doc);
      expect(r.offer).toBeDefined();
      expect(model.complete).toHaveBeenCalledTimes(3);
      expect(model.complete.mock.calls[2]![0].system).toMatch(/find supporting quotes/);
    });
  });

  describe("transport trouble", () => {
    it("retries after a failed or empty request", async () => {
      const complete = vi.fn().mockRejectedValueOnce(new Error("AI Gateway request timed out")).mockResolvedValueOnce(cannedReply(f));
      const r = await extractOffer({ complete }, f.doc);
      expect(r.offer).toBeDefined();
      expect(complete).toHaveBeenCalledTimes(2);
    });

    it("tries three times by default and reports the last problem", async () => {
      const complete = vi.fn().mockRejectedValue(new Error("AI Gateway returned no content"));
      const r = await extractOffer({ complete }, f.doc);
      expect(complete).toHaveBeenCalledTimes(3);
      expect(r.offer).toBeUndefined();
      expect(r.problems[0]).toMatch(/no content/);
    });
  });
});
