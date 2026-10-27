"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LedgerEvent } from "@/src/ledger/chain";
import { eventDwell } from "@/src/ui/lib/replay";

export type Speed = 1 | 2 | 4;

export interface Replay {
  cursor: number;
  playing: boolean;
  speed: Speed;
  /** The cursor is pinned to the newest event and moves with a live run. */
  following: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  stepBack: () => void;
  stepForward: () => void;
  seek: (n: number) => void;
  skipToEnd: () => void;
  restart: () => void;
  setSpeed: (s: Speed) => void;
}

const LEAD_IN_MS = 600;

/**
 * Playhead over the ledger. Plays at a deliberate pace, follows a live run when pinned to the end,
 * and never moves past the newest event.
 */
export function useReplay(events: readonly LedgerEvent[], options: { autoplay: boolean; reducedMotion: boolean }): Replay {
  const total = events.length;
  const [cursor, setCursor] = useState(() => (options.autoplay && !options.reducedMotion ? 0 : total));
  const [playing, setPlaying] = useState(() => options.autoplay && !options.reducedMotion);
  const [speed, setSpeed] = useState<Speed>(1);
  const [following, setFollowing] = useState(() => !(options.autoplay && !options.reducedMotion));
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  // Start an autoplay that was decided after mount (e.g. once a run's first load arrives).
  const autoplayed = useRef(options.autoplay);
  useEffect(() => {
    if (options.autoplay && !autoplayed.current && !options.reducedMotion) {
      autoplayed.current = true;
      setCursor(0);
      setFollowing(false);
      setPlaying(true);
    }
  }, [options.autoplay, options.reducedMotion]);

  // Follow a live run.
  useEffect(() => {
    if (following) setCursor(total);
    else setCursor((c) => Math.min(c, total));
  }, [total, following]);

  // Reduced motion: never animate through events.
  useEffect(() => {
    if (options.reducedMotion && playing) {
      setPlaying(false);
      setCursor(total);
      setFollowing(true);
    }
  }, [options.reducedMotion, playing, total]);

  useEffect(() => {
    if (!playing) return;
    if (cursor >= total) {
      setPlaying(false);
      setFollowing(true);
      return;
    }
    const prev = eventsRef.current[cursor - 1];
    const dwell = cursor === 0 ? LEAD_IN_MS : eventDwell(prev?.kind ?? "");
    const t = setTimeout(() => setCursor((c) => Math.min(c + 1, eventsRef.current.length)), dwell / speed);
    return () => clearTimeout(t);
  }, [playing, cursor, total, speed]);

  const pause = useCallback(() => {
    setPlaying(false);
    setFollowing(false);
  }, []);
  const play = useCallback(() => {
    setFollowing(false);
    setCursor((c) => (c >= eventsRef.current.length ? 0 : c));
    setPlaying(true);
  }, []);
  const seek = useCallback((n: number) => {
    const max = eventsRef.current.length;
    const next = Math.max(0, Math.min(max, Math.round(n)));
    setCursor(next);
    setFollowing(next === max);
  }, []);
  const stepBack = useCallback(() => {
    setPlaying(false);
    setFollowing(false);
    setCursor((c) => Math.max(0, c - 1));
  }, []);
  const stepForward = useCallback(() => {
    const max = eventsRef.current.length;
    const next = Math.min(max, cursorRef.current + 1);
    setPlaying(false);
    setCursor(next);
    setFollowing(next === max);
  }, []);
  const skipToEnd = useCallback(() => {
    setPlaying(false);
    setFollowing(true);
    setCursor(eventsRef.current.length);
  }, []);
  const restart = useCallback(() => {
    setFollowing(false);
    setCursor(0);
    setPlaying(true);
  }, []);

  return {
    cursor: Math.min(cursor, total),
    playing,
    speed,
    following,
    play,
    pause,
    toggle: () => (playing ? pause() : play()),
    stepBack,
    stepForward,
    seek,
    skipToEnd,
    restart,
    setSpeed,
  };
}
