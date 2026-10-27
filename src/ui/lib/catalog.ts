/**
 * Human names for the things a run talks about. The ledger speaks in ids ("offer-trailer-song-indie");
 * people read "Pixel Hymns, song, $150".
 */
import type { LicenseOffer } from "@/src/core/types";
import { assetNoun, docTitle, formatMoney } from "./format";

export interface DocInfo {
  id: string;
  assetId: string;
  text: string;
  licensorName?: string;
}

export interface OfferInfo {
  id: string;
  assetId: string;
  documentId?: string;
  licensor: string;
  /** Licence title without the licensor's name, e.g. "Indie starter licence". */
  title: string;
  price: string;
  /** "Pixel Hymns · song · $150" */
  name: string;
}

export interface Catalog {
  offers: Map<string, OfferInfo>;
  docs: Map<string, DocInfo & { title: string; licensor: string }>;
  offerName: (id: string) => string;
  offer: (id: string) => OfferInfo | undefined;
}

export function buildCatalog(documents: readonly DocInfo[], offers: readonly LicenseOffer[]): Catalog {
  const docs = new Map(documents.map((d) => [d.id, { ...d, title: docTitle(d.text, d.licensorName), licensor: d.licensorName ?? "Unnamed licensor" }]));
  const map = new Map<string, OfferInfo>();
  for (const o of offers) {
    const documentId = o.evidence[0]?.documentId;
    const doc = documentId ? docs.get(documentId) : undefined;
    const licensor = doc?.licensorName ?? doc?.title ?? documentId ?? o.id;
    const price = formatMoney(o.priceCents, o.currency, { trim: true });
    map.set(o.id, { id: o.id, assetId: o.assetId, documentId, licensor, title: doc?.title ?? o.id, price, name: `${licensor} · ${assetNoun(o.assetId)} · ${price}` });
  }
  return {
    offers: map,
    docs,
    offer: (id) => map.get(id),
    offerName: (id) => map.get(id)?.name ?? id,
  };
}

/**
 * Replace offer ids inside free text (the agent's rationale) with their human names. Longer ids are
 * replaced first so "offer-song-pro" is not broken by "offer-song".
 */
export function humaniseIds(text: string, catalog: Pick<Catalog, "offers">): string {
  const ids = [...catalog.offers.keys()].sort((a, b) => b.length - a.length);
  let out = text;
  for (const id of ids) {
    const name = catalog.offers.get(id)!.name;
    out = out.split(id).join(name);
  }
  return out;
}
