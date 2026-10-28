"use client";

import { RotateCcw } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
import type { LicenseOffer, Project } from "@/src/core/types";
import { whatIf, type ProjectChange } from "@/src/core/whatif";
import { EU_COUNTRIES } from "@/src/intake/brief";
import { readChange } from "@/src/intake/change";
import type { Catalog } from "@/src/ui/lib/catalog";
import { assetLabel, formatMoney, mediumName, termText } from "@/src/ui/lib/format";
import styles from "./WhatIf.module.css";

const MEDIA = ["web", "social", "broadcast", "print", "audio", "film", "app"];
const PLACES: { code: string; label: string; codes: string[] }[] = [
  { code: "WORLD", label: "Worldwide", codes: ["WORLD"] },
  { code: "US", label: "United States", codes: ["US"] },
  { code: "CA", label: "Canada", codes: ["CA"] },
  { code: "GB", label: "United Kingdom", codes: ["GB"] },
  { code: "EU", label: "European Union", codes: EU_COUNTRIES },
  { code: "AU", label: "Australia", codes: ["AU"] },
];

interface State {
  commercial: boolean;
  territories: string[];
  termMonths: number;
  mediums: string[];
  cannotCredit: boolean;
  sublicensing: boolean;
  exclusive: boolean;
}

const stateOf = (p: Project): State => ({
  commercial: p.commercial,
  territories: [...p.territories],
  termMonths: p.termMonths,
  mediums: [...(p.mediums ?? [])],
  cannotCredit: p.canCredit === false,
  sublicensing: Boolean(p.needsSublicensing),
  exclusive: Boolean(p.requiresExclusive),
});

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const toChange = (s: State): ProjectChange => ({ commercial: s.commercial, territories: s.territories, termMonths: s.termMonths, mediums: s.mediums, canCredit: !s.cannotCredit, needsSublicensing: s.sublicensing, requiresExclusive: s.exclusive });

/**
 * Change the brief and see what it would cost. Each figure is the same exact cost check the run used,
 * re-run in this browser on the offers already read from the licences: nothing is estimated, no model
 * is asked, and nothing is bought or changed on the run.
 */
export function WhatIf({ project, requiredAssetIds, candidates, currency, runDate, catalog }: { project: Project; requiredAssetIds: string[]; candidates: LicenseOffer[]; currency: string; runDate?: string; catalog: Catalog }) {
  const id = useId();
  const brief = useMemo(() => stateOf(project), [project]);
  const [state, setState] = useState<State>(brief);
  const [typed, setTyped] = useState("");
  const [heard, setHeard] = useState<string[] | null>(null);
  const result = useMemo(() => whatIf(project, toChange(state), requiredAssetIds, candidates, currency, { today: runDate }), [project, state, requiredAssetIds, candidates, currency, runDate]);

  const places = [...PLACES, ...project.territories.filter((t) => !PLACES.some((p) => p.codes.includes(t))).map((t) => ({ code: t, label: t, codes: [t] }))];
  const placeOn = (p: (typeof places)[number]) => p.codes.every((c) => state.territories.includes(c));
  const placeChanged = !sameSet(state.territories, brief.territories);
  const togglePlace = (p: (typeof places)[number]) =>
    setState((s) => {
      if (p.code === "WORLD") return { ...s, territories: ["WORLD"] };
      const without = s.territories.filter((t) => t !== "WORLD");
      const on = p.codes.every((c) => without.includes(c));
      const next = on ? without.filter((t) => !p.codes.includes(t)) : [...new Set([...without, ...p.codes])];
      return next.length ? { ...s, territories: next } : s; // a project needs somewhere to be shown
    });
  const toggleMedium = (m: string) => setState((s) => ({ ...s, mediums: s.mediums.includes(m) ? s.mediums.filter((x) => x !== m) : [...s.mediums, m] }));
  const changed = state.commercial !== brief.commercial || placeChanged || state.termMonths !== brief.termMonths || !sameSet(state.mediums, brief.mediums) || state.cannotCredit !== brief.cannotCredit || state.sublicensing !== brief.sublicensing || state.exclusive !== brief.exclusive;

  // A sentence is read on this device by the same rules as the brief box, and applied on top of what is chosen now.
  const apply = (e: FormEvent) => {
    e.preventDefault();
    const { change, described } = readChange(typed, { territories: state.territories, mediums: state.mediums });
    setHeard(described);
    if (!described.length) return;
    setState((s) => ({
      commercial: change.commercial ?? s.commercial,
      territories: change.territories?.length ? change.territories : s.territories,
      termMonths: change.termMonths ?? s.termMonths,
      mediums: change.mediums ?? s.mediums,
      cannotCredit: change.canCredit === undefined ? s.cannotCredit : !change.canCredit,
      sublicensing: change.needsSublicensing ?? s.sublicensing,
      exclusive: change.requiresExclusive ?? s.exclusive,
    }));
    setTyped("");
  };

  const money = (c: number) => formatMoney(c, currency);
  // An offer's name already carries its price, so the licensor is the clearer label next to one.
  const who = (offerId: string) => catalog.offer(offerId)?.licensor ?? catalog.offerName(offerId);
  const delta = result.deltaCents;
  const kind = result.totalCents === undefined ? "blocked" : delta === 0 ? "same" : (delta ?? 0) < 0 ? "cheaper" : "dearer";
  const sliderMax = Math.max(60, project.termMonths, state.termMonths);

  const flag = (key: "commercial" | "cannotCredit" | "sublicensing" | "exclusive", label: string) => (
    <label className={styles.switch} data-changed={state[key] !== brief[key]}>
      <input type="checkbox" checked={state[key]} onChange={(e) => setState((s) => ({ ...s, [key]: e.target.checked }))} />
      <span aria-hidden />
      {label}
    </label>
  );

  return (
    <div className={styles.wrap}>
      <form className={styles.group} onSubmit={apply}>
        <label className={styles.legend} htmlFor={`${id}-say`}>
          Or say it in a sentence
        </label>
        <div className={styles.sayRow}>
          <input id={`${id}-say`} className="input" value={typed} maxLength={300} placeholder="e.g. only in Canada for 6 months, no exclusivity" onChange={(e) => setTyped(e.target.value)} />
          <button type="submit" className="btn btn-sm" disabled={!typed.trim()}>
            Apply
          </button>
        </div>
        {heard && <p className={`small ${styles.heard}`} aria-live="polite" data-testid="what-if-heard">{heard.length ? `Applied: ${heard.join(" · ")}.` : "Nothing to change was recognised. Name a place, a length of time, a medium, or say whether you need exclusivity, sublicensing, credit or commercial use."}</p>}
      </form>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Where it is shown</legend>
        <div className={styles.chips}>
          {places.map((p) => (
            <button key={p.code} type="button" className={styles.chip} aria-pressed={placeOn(p)} data-changed={placeOn(p) !== p.codes.every((c) => brief.territories.includes(c))} onClick={() => togglePlace(p)}>
              {p.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className={styles.group}>
        <label className={styles.legend} htmlFor={`${id}-term`}>
          How long you need it
        </label>
        <div className={styles.sliderRow}>
          <input id={`${id}-term`} className={styles.slider} type="range" min={1} max={sliderMax} step={1} value={state.termMonths} onChange={(e) => setState((s) => ({ ...s, termMonths: Number(e.target.value) }))} />
          <span className={`${styles.sliderValue} num`}>{termText(state.termMonths)}</span>
        </div>
      </div>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Where people will see it (none selected: any)</legend>
        <div className={styles.chips}>
          {MEDIA.map((m) => (
            <button key={m} type="button" className={styles.chip} aria-pressed={state.mediums.includes(m)} data-changed={state.mediums.includes(m) !== brief.mediums.includes(m)} onClick={() => toggleMedium(m)}>
              {mediumName(m)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className={styles.switches}>
        {flag("commercial", "Commercial use")}
        {flag("cannotCredit", "We cannot credit creators")}
        {flag("sublicensing", "We must sublicense")}
        {flag("exclusive", "We need exclusivity")}
      </div>

      <div className={styles.result} data-kind={kind} role="status" aria-live="polite">
        {result.totalCents !== undefined ? (
          <>
            <span className="eyebrow">Cheapest compliant bundle for this brief</span>
            <span className={`${styles.total} num`}>{money(result.totalCents)}</span>
            <span className={styles.delta}>{delta === 0 ? (changed ? "The same as your brief: these changes cost nothing." : "This is your brief as written.") : (delta ?? 0) > 0 ? `${money(delta!)} more than your brief (${money(result.baselineCents!)}).` : `${money(-delta!)} less than your brief (${money(result.baselineCents!)}).`}</span>
            {result.budgetShortfallCents > 0 && <span className={styles.delta}>Over your budget by {money(result.budgetShortfallCents)}.</span>}
            {result.shifts.length > 0 && (
              <ul className={styles.shifts}>
                {result.shifts.map((s) => (
                  <li key={s.assetId}>
                    <b>{assetLabel(s.assetId)}:</b> {s.fromOfferId ? `${who(s.fromOfferId)} (${money(s.fromCents!)})` : "none"} → {s.toOfferId ? `${who(s.toOfferId)} (${money(s.toCents!)})` : "none"}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : result.uncoveredAssets.length ? (
          <>
            <span className="eyebrow">No licence covers this brief</span>
            <span className={styles.delta}>Nothing read from your licences fits for: {result.uncoveredAssets.map(assetLabel).join(", ")}.</span>
            {result.gaps.map((g) => (
              <div key={g.assetId}>
                <p className="small" style={{ margin: "4px 0" }}>
                  <b>{assetLabel(g.assetId)}</b>: closest is {who(g.offerId)} ({money(g.priceCents)}). Ask the licensor to:
                </p>
                <ul className={styles.asks}>
                  {g.asks.map((a) => (
                    <li key={a.rule}>{a.ask}</li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        ) : (
          <>
            <span className="eyebrow">No complete bundle</span>
            <span className={styles.delta}>The offers for this brief are not all in {currency}. Obtain offers in a common currency.</span>
          </>
        )}
      </div>

      {changed && (
        <button type="button" className={`btn btn-sm btn-ghost ${styles.reset}`} onClick={() => { setState(brief); setHeard(null); }}>
          <RotateCcw aria-hidden /> Back to my brief
        </button>
      )}
    </div>
  );
}
