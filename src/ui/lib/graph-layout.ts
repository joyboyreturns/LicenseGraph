/**
 * Deterministic layered layout for the rights graph: licence documents on the left, the offers read
 * from them in the middle, the project's required assets on the right. Offers are grouped by asset
 * (cheapest first) and each asset sits at the centre of its group, so the graph fans in.
 */

export type NodeKind = "doc" | "offer" | "asset";
export type Density = "regular" | "compact";

export interface LayoutInput {
  width: number;
  documents: readonly { id: string; assetId: string }[];
  offers: readonly { id: string; assetId: string; documentId?: string; priceCents: number }[];
  assets: readonly string[];
  /** Force a density; by default compact below 760px. */
  density?: Density;
}

export interface NodeBox {
  /** "doc:ID", "offer:ID" or "asset:ID". */
  key: string;
  id: string;
  kind: NodeKind;
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EdgePath {
  key: string;
  kind: "doc-offer" | "offer-asset";
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  d: string;
  mid: { x: number; y: number };
}

export interface GraphLayout {
  width: number;
  height: number;
  density: Density;
  columns: Record<NodeKind, { x: number; w: number }>;
  nodes: NodeBox[];
  edges: EdgePath[];
  groups: { assetId: string; top: number; bottom: number }[];
}

export const SIZES: Record<Density, { offerH: number; docH: number; assetH: number; rowGap: number; groupGap: number; pad: number }> = {
  regular: { offerH: 64, docH: 50, assetH: 78, rowGap: 12, groupGap: 28, pad: 6 },
  compact: { offerH: 60, docH: 52, assetH: 66, rowGap: 8, groupGap: 18, pad: 4 },
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export const nodeKey = (kind: NodeKind, id: string) => `${kind}:${id}`;

export function curve(x1: number, y1: number, x2: number, y2: number): string {
  const dx = (x2 - x1) * 0.5;
  return `M ${round1(x1)} ${round1(y1)} C ${round1(x1 + dx)} ${round1(y1)}, ${round1(x2 - dx)} ${round1(y2)}, ${round1(x2)} ${round1(y2)}`;
}

function columnsFor(width: number, density: Density): GraphLayout["columns"] {
  const W = Math.max(280, width);
  let doc: number;
  let offer: number;
  let asset: number;
  if (density === "regular") {
    doc = clamp(W * 0.24, 150, 250);
    offer = clamp(W * 0.32, 200, 320);
    asset = clamp(W * 0.19, 130, 200);
  } else {
    doc = Math.round(W * 0.27);
    offer = Math.round(W * 0.38);
    asset = Math.round(W * 0.23);
  }
  const gap = Math.max(8, (W - doc - offer - asset) / 2);
  return { doc: { x: 0, w: doc }, offer: { x: doc + gap, w: offer }, asset: { x: doc + gap + offer + gap, w: asset } };
}

export function layoutGraph(input: LayoutInput): GraphLayout {
  const density: Density = input.density ?? (input.width < 760 ? "compact" : "regular");
  const S = SIZES[density];
  const columns = columnsFor(input.width, density);
  const width = Math.max(280, input.width);

  // Group order: required assets first, then any other asset that appears in the data.
  const order: string[] = [];
  const push = (a: string) => {
    if (!order.includes(a)) order.push(a);
  };
  input.assets.forEach(push);
  input.offers.forEach((o) => push(o.assetId));
  input.documents.forEach((d) => push(d.assetId));

  const docIds = new Set(input.documents.map((d) => d.id));
  const docsWithOffer = new Set(input.offers.map((o) => o.documentId).filter((d): d is string => Boolean(d && docIds.has(d))));

  const nodes: NodeBox[] = [];
  const edges: EdgePath[] = [];
  const groups: GraphLayout["groups"] = [];
  let y = S.pad;

  for (const assetId of order) {
    const offers = input.offers.filter((o) => o.assetId === assetId).sort((a, b) => a.priceCents - b.priceCents || a.id.localeCompare(b.id));
    const loneDocs = input.documents.filter((d) => d.assetId === assetId && !docsWithOffer.has(d.id));
    const rows: { offerId?: string; docId?: string }[] = [
      ...offers.map((o) => ({ offerId: o.id, docId: o.documentId && docIds.has(o.documentId) ? o.documentId : undefined })),
      ...loneDocs.map((d) => ({ docId: d.id })),
    ];
    const isRequired = input.assets.includes(assetId);
    if (rows.length === 0 && !isRequired) continue;

    const rowsHeight = rows.length ? rows.length * S.offerH + (rows.length - 1) * S.rowGap : 0;
    const band = Math.max(rowsHeight, S.assetH);
    const top = y;
    let rowTop = top + (band - rowsHeight) / 2;
    const assetKey = nodeKey("asset", assetId);
    const assetBox: NodeBox = { key: assetKey, id: assetId, kind: "asset", assetId, x: columns.asset.x, y: top + (band - S.assetH) / 2, w: columns.asset.w, h: S.assetH };

    for (const row of rows) {
      const cy = rowTop + S.offerH / 2;
      if (row.docId) {
        nodes.push({ key: nodeKey("doc", row.docId), id: row.docId, kind: "doc", assetId, x: columns.doc.x, y: cy - S.docH / 2, w: columns.doc.w, h: S.docH });
      }
      if (row.offerId) {
        const offerBox: NodeBox = { key: nodeKey("offer", row.offerId), id: row.offerId, kind: "offer", assetId, x: columns.offer.x, y: rowTop, w: columns.offer.w, h: S.offerH };
        nodes.push(offerBox);
        if (row.docId) {
          const x1 = columns.doc.x + columns.doc.w;
          const x2 = offerBox.x;
          edges.push(edge("doc-offer", nodeKey("doc", row.docId), offerBox.key, x1, cy, x2, cy));
        }
        if (isRequired) {
          const x1 = offerBox.x + offerBox.w;
          const ay = assetBox.y + assetBox.h / 2;
          edges.push(edge("offer-asset", offerBox.key, assetKey, x1, cy, assetBox.x, ay));
        }
      }
      rowTop += S.offerH + S.rowGap;
    }
    if (isRequired) nodes.push(assetBox);
    groups.push({ assetId, top, bottom: top + band });
    y = top + band + S.groupGap;
  }

  const height = Math.max(120, groups.length ? y - S.groupGap + S.pad : 120);
  return { width, height, density, columns, nodes, edges, groups };
}

function edge(kind: EdgePath["kind"], from: string, to: string, x1: number, y1: number, x2: number, y2: number): EdgePath {
  return { key: `${from}->${to}`, kind, from, to, x1, y1, x2, y2, d: curve(x1, y1, x2, y2), mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
}
