/** What the dashboard keeps in this browser between visits: the layout and any widgets the person or the assistant added. */
export const savedStateKey = (portfolio: boolean) => `licensegraph.studio.${portfolio ? "portfolio" : "run"}.v1`;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const isState = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && "pages" in v;

/** The saved layout, or undefined when there is none or it is not a layout. Never throws: storage can be blocked or hold anything. */
export function loadSavedState(store: Store | undefined, key: string): Record<string, unknown> | undefined {
  try {
    const raw = store?.getItem(key);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function saveState(store: Store | undefined, key: string, state: unknown): void {
  try {
    if (isState(state)) store?.setItem(key, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the dashboard still works, it just forgets next time.
  }
}

export function clearSavedState(store: Store | undefined, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    // Nothing to clear if storage is blocked.
  }
}
