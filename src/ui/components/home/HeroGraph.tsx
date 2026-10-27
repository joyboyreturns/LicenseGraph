"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "../bits";
import styles from "./HeroGraph.module.css";

/**
 * The product in eight seconds, using the documentary scenario's real prices: four licences are read,
 * the agent proposes the cheapest bundle, the rules engine rejects the editorial-only photo, the agent
 * revises, and the bundle is verified. Static (final frame) when motion is reduced.
 */
const DOCS = [
  { id: "song", name: "SoundHarbor Music", y: 46 },
  { id: "photo", name: "PixelLeaf Images", y: 128 },
  { id: "archive", name: "HistoryVault Archive", y: 210 },
  { id: "font", name: "TypeForge Studio", y: 292 },
];
const OFFERS = [
  { id: "song", price: "$200", tag: "Worldwide · 24 mo", y: 46, asset: "song" },
  { id: "photo", price: "$45", tag: "Editorial only", y: 128, asset: "image" },
  { id: "archive", price: "$80", tag: "Any medium", y: 210, asset: "image" },
  { id: "font", price: "$49", tag: "Perpetual", y: 292, asset: "font" },
];
const ASSETS = [
  { id: "song", label: "Song", y: 46 },
  { id: "image", label: "Image", y: 169 },
  { id: "font", label: "Font", y: 292 },
];

const STAGES = [
  { ms: 1300, text: "Reading four licences…", tone: "agent" },
  { ms: 1500, text: "Every term linked to the sentence it came from", tone: "agent" },
  { ms: 1700, text: "Agent proposes the cheapest bundle", tone: "agent" },
  { ms: 2100, text: "Rules engine: the $45 photo is editorial only. Rejected.", tone: "bad" },
  { ms: 1600, text: "Agent revises: archive image, $80", tone: "agent" },
  { ms: 3600, text: "Verified: $329. You approve, PayPal pays three creators.", tone: "ok" },
] as const;
const FINAL = STAGES.length - 1;

const DOC_X = 8;
const DOC_W = 168;
const OFF_X = 226;
const OFF_W = 132;
const AS_X = 432;
const AS_W = 116;
const H = 40;

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
};

export function HeroGraph() {
  const reduced = useReducedMotion();
  const [stage, setStage] = useState<number>(FINAL);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (reduced) {
      setStage(FINAL);
      setRunning(false);
      return;
    }
    setRunning(true);
    setStage(0);
  }, [reduced]);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setStage((s) => (s + 1) % STAGES.length), STAGES[stage]!.ms);
    return () => clearTimeout(t);
  }, [stage, running]);

  const offerState = (id: string): string => {
    if (stage === 0) return "hidden";
    if (stage === 1) return "read";
    if (id === "photo") return stage >= 3 ? "rejected" : "proposed";
    if (id === "archive") return stage === 4 ? "proposed" : stage === 5 ? "chosen" : "read";
    return stage === 5 ? "chosen" : "proposed";
  };
  const edgeState = (id: string) => {
    const s = offerState(id);
    return s === "read" ? "idle" : s;
  };
  const assetState = (id: string) => (stage === 5 ? "covered" : stage >= 2 && !(id === "image" && stage === 3) ? "proposed" : stage === 3 && id === "image" ? "rejected" : "open");
  const caption = STAGES[stage]!;

  return (
    <figure className={styles.figure} aria-labelledby="hero-graph-caption">
      <div className={styles.frame}>
        <div className={styles.frameHead} aria-hidden>
          <span className={styles.dots}>
            <i />
            <i />
            <i />
          </span>
          <span className={styles.frameTitle}>Documentary promo · replayed scenario</span>
          <span className={styles.round}>{stage <= 1 ? "Reading" : stage <= 3 ? "Round 1" : "Round 2"}</span>
        </div>
        <svg viewBox="0 0 556 340" className={styles.svg} role="img" aria-label="Animated rights graph: four licences, four offers and three assets. The agent proposes the cheapest bundle, the rules engine rejects a $45 editorial-only photo, the agent picks the $80 archive image instead, and the $329 bundle is verified.">
          <defs>
            <filter id="hg-glow" x="-20%" y="-60%" width="140%" height="220%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          {/* doc -> offer */}
          {OFFERS.map((o) => (
            <line key={`r-${o.id}`} x1={DOC_X + DOC_W} y1={o.y} x2={OFF_X} y2={o.y} className={styles.readEdge} data-state={offerState(o.id)} />
          ))}
          {/* offer -> asset */}
          {OFFERS.map((o) => {
            const a = ASSETS.find((x) => x.id === o.asset)!;
            const d = curve(OFF_X + OFF_W, o.y, AS_X, a.y);
            const s = edgeState(o.id);
            return (
              <g key={`u-${o.id}`} data-state={s} className={styles.useEdge}>
                {s === "chosen" && <path d={d} className={styles.glow} filter="url(#hg-glow)" />}
                <path d={d} className={styles.useLine} />
                {s === "rejected" && (
                  <g transform={`translate(${(OFF_X + OFF_W + AS_X) / 2} ${(o.y + a.y) / 2})`}>
                    <g className={styles.strike}>
                      <circle r="8" />
                      <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" />
                    </g>
                  </g>
                )}
              </g>
            );
          })}
          {DOCS.map((d, i) => (
            <g key={d.id} className={styles.doc} data-reading={stage === 0 || undefined} style={{ animationDelay: `${i * 0.25}s` }}>
              <rect x={DOC_X} y={d.y - 17} width={DOC_W} height={34} rx={9} />
              <rect x={DOC_X + 8} y={d.y - 9} width={18} height={18} rx={5} className={styles.docIcon} />
              <path d={`M ${DOC_X + 13} ${d.y - 3} h 8 M ${DOC_X + 13} ${d.y + 1} h 8 M ${DOC_X + 13} ${d.y + 5} h 5`} className={styles.docLines} />
              <text x={DOC_X + 34} y={d.y + 4.5} className={styles.docText}>
                {d.name}
              </text>
            </g>
          ))}
          {OFFERS.map((o) => (
            <g key={o.id} className={styles.offer} data-state={offerState(o.id)}>
              <rect x={OFF_X} y={o.y - H / 2} width={OFF_W} height={H} rx={10} />
              <text x={OFF_X + 12} y={o.y - 1} className={styles.price}>
                {o.price}
              </text>
              <text x={OFF_X + 12} y={o.y + 13} className={styles.tag}>
                {o.tag}
              </text>
              {offerState(o.id) === "rejected" && <line x1={OFF_X + 11} x2={OFF_X + 41} y1={o.y - 5} y2={o.y - 5} className={styles.strikePrice} />}
            </g>
          ))}
          {ASSETS.map((a) => (
            <g key={a.id} className={styles.asset} data-state={assetState(a.id)}>
              <rect x={AS_X} y={a.y - 24} width={AS_W} height={48} rx={14} />
              <circle cx={AS_X + 22} cy={a.y} r={11} className={styles.assetDot} />
              {assetState(a.id) === "covered" && <path d={`M ${AS_X + 17} ${a.y} l 3.5 3.5 l 6.5 -7`} className={styles.check} />}
              <text x={AS_X + 41} y={a.y + 5} className={styles.assetText}>
                {a.label}
              </text>
            </g>
          ))}
          {stage === FINAL && (
            <g className={styles.stamp} transform="translate(330 170)">
              <g className={styles.stampInner}>
                <rect x={-62} y={-19} width={124} height={38} rx={9} />
                <text x={0} y={5.5} textAnchor="middle">
                  VERIFIED $329
                </text>
              </g>
            </g>
          )}
        </svg>
        <figcaption id="hero-graph-caption" className={styles.caption} data-tone={caption.tone} aria-live="off">
          <span key={stage}>{caption.text}</span>
        </figcaption>
      </div>
    </figure>
  );
}
