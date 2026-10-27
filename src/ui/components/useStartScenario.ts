"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import { api, errorMessage } from "@/src/ui/lib/api";
import { useToast } from "./Providers";

/** Start a built-in scenario (a replay of recorded model output) and open its run theatre. */
export function useStartScenario() {
  const router = useRouter();
  const toast = useToast();
  const [starting, setStarting] = useState<string | null>(null);
  const start = useCallback(
    async (scenarioId: string) => {
      setStarting(scenarioId);
      try {
        const view = await api<SessionView>("/api/sessions", { method: "POST", json: { scenarioId } });
        router.push(`/run/${view.id}`);
      } catch (e) {
        toast.push({ tone: "bad", title: "Could not start the scenario", body: errorMessage(e) });
        setStarting(null);
      }
    },
    [router, toast],
  );
  return { start, starting };
}
