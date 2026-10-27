"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import { api, ApiError, errorMessage } from "@/src/ui/lib/api";
import { isPayoutFinal } from "@/src/ui/lib/format";
import { isActivePhase } from "@/src/ui/lib/replay";

export type SessionLoad = { status: "loading" } | { status: "not-found" } | { status: "error"; message: string } | { status: "ready"; view: SessionView };

/** How soon to ask again, or null to stop: fast while the agent works, slower while payouts settle. */
export function pollDelay(view: SessionView, now: number = Date.now()): number | null {
  if (isActivePhase(view.phase)) return 1000;
  if (view.phase === "captured" && !view.payouts) {
    // Payouts are created right after capture; give them a short window, then stop asking.
    const at = view.events.find((e) => e.kind === "captured")?.at;
    return at && now - Date.parse(at) < 20_000 ? 2000 : null;
  }
  if (view.payouts && view.payouts.status !== "FAILED" && !isPayoutFinal(view.payouts.status)) return 2000;
  return null;
}

/**
 * One poller per page: a single setTimeout chain (never overlapping requests), slowed down while the
 * tab is hidden, stopped when nothing is pending and cleaned up on unmount.
 */
export function useSession(id: string) {
  const [load, setLoad] = useState<SessionLoad>({ status: "loading" });
  const [transientError, setTransientError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const failures = useRef(0);

  const fetchOnce = useCallback(async (): Promise<SessionView | null> => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    try {
      const view = await api<SessionView>(`/api/sessions/${encodeURIComponent(id)}`, { signal: c.signal });
      if (!alive.current) return null;
      failures.current = 0;
      setTransientError(null);
      setLoad({ status: "ready", view });
      return view;
    } catch (e) {
      if (!alive.current || (e instanceof DOMException && e.name === "AbortError")) return null;
      if (e instanceof ApiError && e.status === 404) {
        setLoad({ status: "not-found" });
        return null;
      }
      failures.current++;
      setLoad((prev) => (prev.status === "ready" ? prev : { status: "error", message: errorMessage(e) }));
      setTransientError(errorMessage(e));
      throw e;
    }
  }, [id]);

  const schedule = useCallback(
    (view: SessionView | null, retry = false) => {
      clearTimeout(timer.current);
      const base = view ? pollDelay(view) : retry ? 3000 : null;
      if (base === null) return;
      const backoff = Math.min(15000, base * 2 ** Math.min(failures.current, 3));
      const delay = typeof document !== "undefined" && document.hidden ? Math.max(5000, backoff) : backoff;
      timer.current = setTimeout(async () => {
        try {
          const next = await fetchOnce();
          schedule(next);
        } catch {
          schedule(null, true);
        }
      }, delay);
    },
    [fetchOnce],
  );

  useEffect(() => {
    alive.current = true;
    setLoad({ status: "loading" });
    fetchOnce()
      .then((v) => schedule(v))
      .catch(() => schedule(null, true));
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      controller.current?.abort();
    };
  }, [fetchOnce, schedule]);

  /** Use the view an action returned, and resume polling if it now has something pending. */
  const accept = useCallback(
    (view: SessionView) => {
      setLoad({ status: "ready", view });
      schedule(view);
    },
    [schedule],
  );

  const refresh = useCallback(async () => {
    try {
      const v = await fetchOnce();
      schedule(v);
    } catch {
      schedule(null, true);
    }
  }, [fetchOnce, schedule]);

  return { load, accept, refresh, transientError };
}
