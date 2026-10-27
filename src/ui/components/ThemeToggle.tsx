"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "lg-theme";

/** Runs before first paint (inlined in the document head) so the chosen theme never flashes. */
export const themeBootScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

function readChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage can be unavailable (private mode); the choice still applies for this page.
  }
}

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<ThemeChoice, string> = { system: "System theme", light: "Light theme", dark: "Dark theme" };

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setChoice(readChoice());
    setReady(true);
  }, []);

  const Icon = choice === "light" ? Sun : choice === "dark" ? Moon : Monitor;
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-icon"
      onClick={() => {
        const next = NEXT[choice];
        setChoice(next);
        apply(next);
      }}
      aria-label={`${LABEL[choice]}. Switch to ${LABEL[NEXT[choice]].toLowerCase()}.`}
      title={`${LABEL[choice]} (click to change)`}
      style={{ visibility: ready ? "visible" : "hidden" }}
    >
      <Icon aria-hidden />
    </button>
  );
}
