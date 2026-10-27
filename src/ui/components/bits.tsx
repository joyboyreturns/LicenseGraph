"use client";

import { AudioWaveform, Check, Copy, FileText, Film, ImageIcon, Loader2, Mic, Music, Package, Type, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Tone } from "@/src/ui/lib/format";
import { useToast } from "./Providers";

const ASSET_ICONS: Record<string, LucideIcon> = {
  song: Music,
  music: Music,
  track: Music,
  image: ImageIcon,
  photo: ImageIcon,
  archive: ImageIcon,
  art: ImageIcon,
  font: Type,
  typeface: Type,
  footage: Film,
  video: Film,
  voiceover: Mic,
  voice: Mic,
  sfx: AudioWaveform,
};

export function assetIcon(assetId: string): LucideIcon {
  return ASSET_ICONS[assetId.toLowerCase()] ?? Package;
}

export function AssetIcon({ assetId, size = 16, className }: { assetId: string; size?: number; className?: string }) {
  const Icon = assetIcon(assetId);
  return <Icon width={size} height={size} aria-hidden className={className} />;
}

export const DocIcon = FileText;

export function ToneChip({ tone, children, size = "md", mono = false, title }: { tone: Tone; children: ReactNode; size?: "sm" | "md"; mono?: boolean; title?: string }) {
  return (
    <span className={`chip ${size === "sm" ? "chip-sm" : ""} ${mono ? "chip-mono" : ""} tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <>
      <Loader2 width={size} height={size} className="spin" aria-hidden />
      {label && <span className="visually-hidden">{label}</span>}
    </>
  );
}

/** Copy text to the clipboard with a toast and an inline tick. */
export function CopyButton({ text, label = "Copy", children, className = "btn btn-ghost btn-sm", announce }: { text: string; label?: string; children?: ReactNode; className?: string; announce?: string }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      toast.push({ tone: "ok", title: announce ?? "Copied to clipboard" });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1600);
    } catch {
      toast.push({ tone: "bad", title: "Could not copy", body: "Your browser blocked clipboard access. Select the text and copy it manually." });
    }
  }, [text, toast, announce]);
  return (
    <button type="button" className={className} onClick={copy} aria-label={label} title={label}>
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
      {children}
    </button>
  );
}

/* ---------- Media preferences ---------- */

function subscribeMedia(query: string) {
  return (cb: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
    const m = window.matchMedia(query);
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  };
}

export function useMediaQuery(query: string, serverDefault = false): boolean {
  const subscribe = useMemo(() => subscribeMedia(query), [query]);
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : serverDefault),
    () => serverDefault,
  );
}

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");

/* ---------- Safe storage ---------- */

export function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function storageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Unavailable storage (private mode, blocked site data) only loses a convenience.
  }
}

/** Ticks every `ms` while `active`, for elapsed-time labels. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}
