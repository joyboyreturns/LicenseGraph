"use client";

import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Spinner } from "../bits";
import { useStartScenario } from "../useStartScenario";

/** Starts a built-in scenario from a page that is not the home page. */
export function StartScenarioButton({ scenarioId, children }: { scenarioId: string; children: ReactNode }) {
  const { start, starting } = useStartScenario();
  return (
    <button type="button" className="btn btn-primary" onClick={() => start(scenarioId)} disabled={starting !== null}>
      {starting === scenarioId ? <Spinner label="Starting" /> : <ArrowRight aria-hidden />} {children}
    </button>
  );
}
