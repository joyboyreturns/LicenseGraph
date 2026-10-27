import { describe, expect, it, vi } from "vitest";
import { verifyBundle } from "../src/core/rules";
import type { Project } from "../src/core/types";
import { extractOffer, locateQuote } from "../src/extraction/extract";
import { createGatewayModel, type ModelClient } from "../src/extraction/model";
import { cannedReply, fixtures } from "./fixtures/licenses";

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
  it.each(fixtures)("extracts $doc.id with the expected terms and located evidence", async (f) => {
    const result = await extractOffer(replying(cannedReply(f)), f.doc);

    expect(result.problems).toEqual([]);
    const offer = result.offer!;
    expect(offer.priceCents).toBe(f.expected.priceCents);
    expect(offer.terms).toEqual(f.expected.terms);
    expect(offer.evidence.map((e) => e.field).sort()).toEqual(["commercialUse", "price", "term", "territories"]);
    for (const e of offer.evidence) expect(f.doc.text.slice(e.start, e.end).replace(/\s+/g, " ")).toBe(e.quote);
  });

  it("tolerates JSON wrapped in prose or code fences", async () => {
    const f = fixtures[0]!;
    const result = await extractOffer(replying("Here you go:\n```json\n" + cannedReply(f) + "\n```"), f.doc);
    expect(result.offer?.priceCents).toBe(20_000);
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
    for (const f of fixtures) offers.push((await extractOffer(replying(cannedReply(f)), f.doc)).offer!);

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

  it("explains empty content and gateway errors", async () => {
    const empty = createGatewayModel({ apiKey: "k", model: "m/x", fetch: router(free, () => chat("")) as unknown as typeof fetch });
    await expect(empty.complete({ system: "s", user: "u" })).rejects.toThrow(/no content/);

    const denied = createGatewayModel({ apiKey: "k", model: "m/x", fetch: router(free, () => new Response(JSON.stringify({ error: { message: "needs plan" } }), { status: 403 })) as unknown as typeof fetch });
    await expect(denied.complete({ system: "s", user: "u" })).rejects.toThrow(/403 needs plan/);
  });
});
