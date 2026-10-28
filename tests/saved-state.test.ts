import { describe, expect, it } from "vitest";
import { clearSavedState, loadSavedState, saveState, savedStateKey } from "../src/dashboard/saved-state";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const layout = { pages: [{ id: "p1", widgets: {} }], extra: 1 };

describe("the dashboard's saved layout", () => {
  it("is kept apart for the portfolio and for one run, and comes back as it was saved", () => {
    const store = memory();
    expect(savedStateKey(true)).not.toBe(savedStateKey(false));
    saveState(store, savedStateKey(true), layout);
    expect(loadSavedState(store, savedStateKey(true))).toEqual(layout);
    expect(loadSavedState(store, savedStateKey(false))).toBeUndefined();
    clearSavedState(store, savedStateKey(true));
    expect(loadSavedState(store, savedStateKey(true))).toBeUndefined();
  });

  it("ignores anything that is not a layout instead of handing it to the dashboard", () => {
    const store = memory();
    for (const bad of ["not json", "null", "[]", '"pages"', "{}", '{"nopages":1}']) {
      store.setItem("k", bad);
      expect(loadSavedState(store, "k"), bad).toBeUndefined();
    }
    saveState(store, "j", "a string");
    saveState(store, "j", null);
    expect(store.getItem("j")).toBeNull();
  });

  it("never throws when storage is missing or blocked", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(loadSavedState(undefined, "k")).toBeUndefined();
    expect(loadSavedState(blocked, "k")).toBeUndefined();
    expect(() => saveState(blocked, "k", layout)).not.toThrow();
    expect(() => clearSavedState(blocked, "k")).not.toThrow();
    expect(() => saveState(undefined, "k", layout)).not.toThrow();
  });
});
