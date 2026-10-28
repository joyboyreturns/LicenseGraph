import { describe, expect, it } from "vitest";
import { extractPdfText, pageText, PdfTextError } from "../src/ui/lib/pdf-text";
import { fixtures } from "../src/demo/fixtures";
import { locateQuote } from "../src/extraction/extract";
import { makePdf } from "./support/make-pdf";

describe("extractPdfText", () => {
  it("reads the text of a real PDF, line by line", async () => {
    const pdf = makePdf([["SOUNDHARBOR TRACK LICENCE", "Price: USD 200.", "Commercial use is permitted."]]);
    const r = await extractPdfText(pdf);
    expect(r).toMatchObject({ pages: 1, pagesSkipped: 0 });
    expect(r.text).toBe("SOUNDHARBOR TRACK LICENCE\nPrice: USD 200.\nCommercial use is permitted.");
  });

  it("keeps the licence text findable, so a model's quote still locates in what was read", async () => {
    const lines = fixtures[0]!.doc.text.split("\n").map((l) => l.trim()).filter(Boolean);
    const { text } = await extractPdfText(makePdf([lines]));
    // Every paragraph is found even though the PDF wrapped it across several lines.
    for (const line of lines) expect(locateQuote(text, line), line).not.toBeNull();
  });

  it("reads several pages in order and reports pages it skipped", async () => {
    const pdf = makePdf([["Page one."], ["Page two."], ["Page three."]]);
    expect((await extractPdfText(pdf)).text).toBe("Page one.\n\nPage two.\n\nPage three.");
    expect(await extractPdfText(pdf, { maxPages: 2 })).toMatchObject({ pages: 2, pagesSkipped: 1 });
  });

  it("says so when a PDF has no selectable text, and when a file is not a PDF", async () => {
    await expect(extractPdfText(makePdf([[]]))).rejects.toThrow(/no selectable text/);
    await expect(extractPdfText(new TextEncoder().encode("just some text"))).rejects.toThrow(PdfTextError);
  });
});

describe("pageText", () => {
  const item = (str: string, x: number, y: number, width: number) => ({ str, transform: [12, 0, 0, 12, x, y], width, height: 12 });

  it("puts a space between words that sit apart on a line, and a break between lines", () => {
    expect(pageText([item("Worldwide", 50, 700, 55), item("licence", 120, 700, 40), item("Term", 50, 686, 25)])).toBe("Worldwide licence\nTerm");
  });

  it("does not split a word that was drawn in pieces", () => {
    expect(pageText([item("Com", 50, 700, 20), item("mercial", 70, 700, 38)])).toBe("Commercial");
  });
});
