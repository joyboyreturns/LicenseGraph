"use client";

import { FastForward, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import type { LedgerEvent } from "@/src/ledger/chain";
import { replayMarkers } from "@/src/ui/lib/replay";
import type { Catalog } from "@/src/ui/lib/catalog";
import { eventTitle } from "@/src/ui/lib/event-text";
import type { Replay, Speed } from "./useReplay";
import styles from "./ReplayController.module.css";

const SPEEDS: Speed[] = [1, 2, 4];

export function ReplayController({ replay, events, live, catalog }: { replay: Replay; events: readonly LedgerEvent[]; live: boolean; catalog?: Catalog }) {
  const total = events.length;
  const { cursor, playing } = replay;
  const current = events[cursor - 1];
  const markers = replayMarkers(events);
  const atEnd = cursor >= total;
  const pct = total ? (cursor / total) * 100 : 0;

  return (
    <div className={styles.bar} role="group" aria-label="Replay controls">
      <div className={styles.buttons}>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={replay.stepBack} disabled={cursor === 0} aria-label="Step back one event" title="Step back">
          <SkipBack aria-hidden />
        </button>
        {atEnd && !playing ? (
          <button type="button" className={`btn btn-sm ${styles.play}`} onClick={replay.restart} disabled={total === 0} aria-label="Replay the run from the start">
            <RotateCcw aria-hidden />
            <span className={styles.playLabel}>Replay</span>
          </button>
        ) : (
          <button type="button" className={`btn btn-sm ${styles.play}`} onClick={replay.toggle} aria-label={playing ? "Pause replay" : "Play replay"} aria-pressed={playing}>
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
            <span className={styles.playLabel}>{playing ? "Pause" : "Play"}</span>
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={replay.stepForward} disabled={atEnd} aria-label="Step forward one event" title="Step forward">
          <SkipForward aria-hidden />
        </button>
      </div>

      <div className={styles.scrub}>
        <div className={styles.track} aria-hidden>
          <div className={styles.fill} style={{ width: `${pct}%` }} />
          {markers.map((m) => (
            <span key={m.index} className={styles.marker} data-kind={m.kind} style={{ left: `${(m.index / Math.max(1, total)) * 100}%` }} title={m.label} />
          ))}
        </div>
        <input
          type="range"
          className={styles.range}
          min={0}
          max={total}
          step={1}
          value={cursor}
          onChange={(e) => {
            replay.pause();
            replay.seek(Number(e.target.value));
          }}
          aria-label="Replay position"
          aria-valuetext={total ? `Event ${cursor} of ${total}${current ? `: ${eventTitle(current, catalog)}` : ""}` : "No events yet"}
          disabled={total === 0}
        />
        <div className={styles.meta}>
          <span className="num">
            {live && atEnd ? (
              <span className={styles.live}>
                <span className="dot dot-live" aria-hidden /> Live
              </span>
            ) : (
              <>
                Event {cursor}/{total}
              </>
            )}
          </span>
          <span className={styles.now}>{current ? eventTitle(current, catalog) : "Start of the run"}</span>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.speeds} role="radiogroup" aria-label="Replay speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={replay.speed === s} className={styles.speed} onClick={() => replay.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm" onClick={replay.skipToEnd} disabled={atEnd && !playing}>
          <FastForward aria-hidden />
          <span>Skip to result</span>
        </button>
      </div>
    </div>
  );
}
