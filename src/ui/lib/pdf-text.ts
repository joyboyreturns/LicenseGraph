/**
 * Read the text of a licence PDF in the browser. Nothing is uploaded: the file is parsed on the
 * user's device. A scan (pages that are only pictures) has no text to read, and says so instead of
 * returning an empty licence.
 */

export interface PdfText {
  text: string;
  pages: number;
  /** Pages beyond the limit were not read. */
  pagesSkipped: number;
}

export class PdfTextError extends Error {}

const MAX_PAGES = 40;

type Item = { str: string; hasEOL?: boolean; width?: number; height?: number; transform?: number[] };

/** Join one page's text items into lines, adding a space where two items are apart on the same line. */
export function pageText(items: readonly Item[]): string {
  let out = "";
  let prev: Item | undefined;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const x = item.transform?.[4];
    const y = item.transform?.[5];
    if (prev && !out.endsWith("\n") && !out.endsWith(" ") && !item.str.startsWith(" ")) {
      const px = prev.transform?.[4];
      const py = prev.transform?.[5];
      const sameLine = y === undefined || py === undefined || Math.abs(y - py) < 2;
      const gap = x !== undefined && px !== undefined ? x - (px + (prev.width ?? 0)) : 0;
      const size = prev.height || 10;
      if (!sameLine) out += "\n";
      else if (gap > size * 0.15) out += " ";
    }
    out += item.str;
    if (item.hasEOL) out += "\n";
    prev = item;
  }
  return out;
}

export async function extractPdfText(data: Uint8Array, options: { maxPages?: number } = {}): Promise<PdfText> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  const task = pdfjs.getDocument({ data: data.slice(), useSystemFonts: true });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "PasswordException") throw new PdfTextError("This PDF is password protected. Remove the password, or paste the licence text instead.");
    throw new PdfTextError("This file could not be read as a PDF. Paste the licence text instead.");
  }
  try {
    const limit = Math.min(doc.numPages, options.maxPages ?? MAX_PAGES);
    const pages: string[] = [];
    for (let n = 1; n <= limit; n++) {
      const page = await doc.getPage(n);
      pages.push(pageText((await page.getTextContent()).items as Item[]));
    }
    const text = pages
      .join("\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text) throw new PdfTextError("This PDF has no selectable text, so it is probably a scan. Paste the licence text instead.");
    return { text, pages: limit, pagesSkipped: doc.numPages - limit };
  } finally {
    await task.destroy();
  }
}
