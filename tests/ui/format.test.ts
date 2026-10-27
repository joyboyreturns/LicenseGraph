import { describe, expect, it } from "vitest";
import {
  assetLabel,
  dateText,
  docTitle,
  formatElapsed,
  formatMoney,
  isPayoutFinal,
  isSimulatedId,
  mediumsText,
  phaseInfo,
  projectRequirements,
  relativeTime,
  shortHash,
  termLines,
  termsSummary,
  termTags,
  termText,
  territoriesText,
} from "@/src/ui/lib/format";

describe("formatMoney", () => {
  it("formats integer cents in the bundle currency", () => {
    expect(formatMoney(20000, "USD")).toBe("$200.00");
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(5, "USD")).toBe("$0.05");
    expect(formatMoney(0, "USD")).toBe("$0.00");
    expect(formatMoney(20000, "EUR")).toBe("€200.00");
  });
  it("trims whole amounts only when asked, and never drops real cents", () => {
    expect(formatMoney(20000, "USD", { trim: true })).toBe("$200");
    expect(formatMoney(20050, "USD", { trim: true })).toBe("$200.50");
  });
  it("is safe with bad input", () => {
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(1000, "NOTACODE")).toBe("10.00 NOTACODE");
    expect(formatMoney(1000, "")).toBe("$10.00");
    expect(formatMoney(-2500, "USD")).toBe("-$25.00");
  });
});

describe("terms in plain language", () => {
  it("describes terms", () => {
    expect(termText("perpetual")).toBe("Perpetual");
    expect(termText(24)).toBe("24 months");
    expect(termText(1)).toBe("1 month");
    expect(termText(12, true)).toBe("12 mo");
    expect(termText(undefined)).toBe("Not stated");
  });
  it("describes territories", () => {
    expect(territoriesText(["WORLD"])).toBe("Worldwide");
    expect(territoriesText(["US", "CA"])).toBe("United States, Canada");
    expect(territoriesText(["US", "CA"], true)).toBe("US, CA");
    expect(territoriesText([])).toBe("Not stated");
    expect(territoriesText(["AT", "BE", "BG", "HR", "CY", "CZ", "DK"])).toBe("7 territories");
    expect(territoriesText(["XX"])).toMatch(/XX/);
  });
  it("describes media, and calls out silence", () => {
    expect(mediumsText(undefined)).toBe("Not stated");
    expect(mediumsText("ALL")).toBe("Any medium");
    expect(mediumsText(["web", "broadcast", "holograms"])).toBe("Web, Broadcast TV, Holograms");
  });
  it("lists every term with gaps marked as not stated", () => {
    const lines = termLines({ commercialUse: true, territories: ["WORLD"], termMonths: 24 }, 20000, "USD");
    expect(lines.map((l) => l.key)).toEqual(["price", "commercialUse", "territories", "term", "mediums", "attribution", "sublicensing", "exclusivity", "offerValidUntil"]);
    expect(lines.find((l) => l.key === "mediums")).toMatchObject({ value: "Not stated", stated: false });
    expect(lines.find((l) => l.key === "price")).toMatchObject({ value: "$200.00", stated: true });
    const full = termLines({ commercialUse: false, territories: ["US"], termMonths: "perpetual", mediums: "ALL", attributionRequired: false, sublicensing: true, exclusive: false, fixedEndDate: "2027-12-31", offerValidUntil: "2026-11-30" });
    expect(full.every((l) => l.stated)).toBe(true);
    expect(full.find((l) => l.key === "fixedEndDate")?.value).toBe("31 Dec 2027");
    expect(full.find((l) => l.key === "commercialUse")?.value).toBe("Not allowed");
  });
  it("summarises terms on one line and as tags", () => {
    expect(termsSummary({ commercialUse: true, territories: ["WORLD"], termMonths: 24, mediums: ["web", "social"] })).toBe("Commercial · Worldwide · 24 months · Web, Social");
    expect(termTags({ commercialUse: false, territories: ["US", "CA"], termMonths: 12, mediums: ["web", "broadcast"] })).toEqual(["Non-comm.", "US, CA", "12 mo", "Web/Broadcast"]);
  });
  it("lists only declared project requirements", () => {
    const req = projectRequirements({ name: "x", commercial: true, territories: ["WORLD"], termMonths: 24, budgetCents: 300000, mediums: ["web", "social"] });
    expect(req.map((r) => r.key)).toEqual(["commercial", "territory", "term", "media", "budget"]);
    expect(req.find((r) => r.key === "budget")?.value).toBe("$3,000");
    const pod = projectRequirements({ name: "x", commercial: true, territories: ["US"], termMonths: 36, canCredit: false, needsSublicensing: true, requiresExclusive: true, endDate: "2027-01-31" });
    expect(pod.map((r) => r.key)).toEqual(["commercial", "territory", "term", "credit", "sublicensing", "exclusive", "endDate"]);
  });
});

describe("labels", () => {
  it("names assets", () => {
    expect(assetLabel("sfx")).toBe("Sound effects");
    expect(assetLabel("song")).toBe("Song");
    expect(assetLabel("key-art")).toBe("Key art");
    expect(assetLabel("")).toBe("");
  });
  it("derives document titles without repeating the licensor", () => {
    expect(docTitle("PIXEL HYMNS INDIE STARTER LICENCE\nPrice: USD 150.00.", "Pixel Hymns")).toBe("Indie starter licence");
    expect(docTitle("SOUNDHARBOR TRACK LICENCE\nTrack", "SoundHarbor Music")).toBe("SoundHarbor track licence");
    expect(docTitle("STUDIOREED VOICEOVER LICENCE", "Studio Reed")).toBe("Voiceover licence");
    expect(docTitle("\n\n  My Licence  \n", undefined)).toBe("My Licence");
    expect(docTitle("", "X")).toBe("Licence");
    expect(docTitle("A".repeat(200)).length).toBeLessThanOrEqual(90);
  });
  it("formats dates, times and hashes", () => {
    expect(dateText("2026-10-01")).toBe("1 Oct 2026");
    expect(dateText("soon")).toBe("soon");
    expect(dateText(undefined)).toBe("Not stated");
    expect(shortHash("abcdef0123456789", 6)).toBe("abcdef…");
    expect(shortHash("abc", 6)).toBe("abc");
    expect(shortHash(undefined)).toBe("—");
    expect(formatElapsed(420)).toBe("0.4 s");
    expect(formatElapsed(42_000)).toBe("42 s");
    expect(formatElapsed(185_000)).toBe("3 min 05 s");
    expect(formatElapsed(-1)).toBe("—");
    const now = Date.parse("2026-10-27T12:00:00Z");
    expect(relativeTime("2026-10-27T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-27T11:00:00Z", now)).toBe("1 h ago");
    expect(relativeTime("2026-10-26T12:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("nope", now)).toBe("");
  });
  it("labels phases and payment ids honestly", () => {
    for (const p of ["created", "extracting", "proposing", "verified", "failed", "approved", "order_created", "captured", "settled"]) expect(phaseInfo(p).label).toBeTruthy();
    expect(phaseInfo("something_new").label).toBe("Something new");
    expect(isSimulatedId("SIM-ABC")).toBe(true);
    expect(isSimulatedId("SIMCAP-1")).toBe(true);
    expect(isSimulatedId("5O190127TN364715T")).toBe(false);
    expect(isPayoutFinal("SUCCESS")).toBe(true);
    expect(isPayoutFinal("PENDING")).toBe(false);
    expect(isPayoutFinal(undefined)).toBe(false);
  });
});
