"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, Check, CircleAlert, FileUp, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import type { Project } from "@/src/core/types";
import type { BriefResult } from "@/src/intake/brief";
import { api, errorMessage } from "@/src/ui/lib/api";
import { assetLabel, mediumName } from "@/src/ui/lib/format";
import { useConfig } from "../Providers";
import { AssetIcon, Spinner } from "../bits";
import type { ScenarioInfo } from "./types";
import styles from "./BriefWizard.module.css";

const EXAMPLES = [
  'An Instagram and web ad campaign for "Copper Kettle" coffee in the UK, 6 months, under $800, with a song and photos. We can\'t credit creators.',
  'A non-commercial student film shown in Canada, 12 months, with a font and stock footage.',
  'Launch trailer for our game "Neon Drift", worldwide, 24 months, for web, social and broadcast TV, budget $3,000, with music, key art and sound effects.',
];
const MEDIA = ["web", "social", "print", "broadcast", "film", "audio", "app"];
const KNOWN_ASSETS = ["song", "image", "font", "footage", "voiceover", "sfx"];
const MAX_DOC = 20_000;
const MAX_PDF_BYTES = 5 * 1024 * 1024;

interface DocDraft {
  key: string;
  assetId: string;
  text: string;
  licensorName: string;
  licensorEmail: string;
  fileName?: string;
}

interface Draft {
  name: string;
  commercial: boolean;
  worldwide: boolean;
  territories: string;
  termMonths: string;
  budget: string;
  mediums: string[];
  cannotCredit: boolean;
  needsSublicensing: boolean;
  requiresExclusive: boolean;
}

function draftFrom(p: Project): Draft {
  const world = p.territories.includes("WORLD");
  return {
    name: p.name,
    commercial: p.commercial,
    worldwide: world,
    territories: world ? "" : p.territories.join(", "),
    termMonths: String(p.termMonths >= 1200 ? 1200 : p.termMonths),
    budget: p.budgetCents !== undefined ? String(p.budgetCents / 100) : "",
    mediums: p.mediums ?? [],
    cannotCredit: p.canCredit === false,
    needsSublicensing: Boolean(p.needsSublicensing),
    requiresExclusive: Boolean(p.requiresExclusive),
  };
}

let keySeq = 0;
const newKey = () => `d${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export function BriefWizard({ scenarios, onStartScenario, starting }: { scenarios: ScenarioInfo[]; onStartScenario: (id: string) => void; starting: string | null }) {
  const { config } = useConfig();
  const router = useRouter();
  const ids = useId();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [intake, setIntake] = useState<BriefResult | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [assets, setAssets] = useState<string[]>([]);
  const [customAsset, setCustomAsset] = useState("");
  const [docs, setDocs] = useState<DocDraft[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const read = async () => {
    setReading(true);
    setIntakeError(null);
    try {
      const r = await api<BriefResult>("/api/intake", { method: "POST", json: { text } });
      setIntake(r);
      setDraft(draftFrom(r.project));
      setAssets(r.requiredAssetIds);
      setDocs((d) => (d.length ? d : r.requiredAssetIds.map((a) => ({ key: newKey(), assetId: a, text: "", licensorName: "", licensorEmail: "" }))));
      setStep(2);
    } catch (e) {
      setIntakeError(errorMessage(e));
    } finally {
      setReading(false);
    }
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const toggleAsset = (a: string) => {
    setAssets((list) => (list.includes(a) ? list.filter((x) => x !== a) : [...list, a]));
  };
  const addCustomAsset = () => {
    const id = customAsset.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    if (id && !assets.includes(id)) setAssets([...assets, id]);
    setCustomAsset("");
  };

  const goLicences = () => {
    // Make sure every asset has at least one licence slot.
    setDocs((d) => {
      const kept = d.filter((x) => assets.includes(x.assetId));
      for (const a of assets) if (!kept.some((x) => x.assetId === a)) kept.push({ key: newKey(), assetId: a, text: "", licensorName: "", licensorEmail: "" });
      return kept;
    });
    setStep(3);
  };

  const loadScenarioDocs = (id: string) => {
    const s = scenarios.find((x) => x.id === id);
    if (!s) return;
    setAssets(s.requiredAssetIds);
    setDocs(s.documents.map((d) => ({ key: newKey(), assetId: d.assetId, text: d.text, licensorName: d.licensorName ?? "", licensorEmail: "" })));
  };

  const loadFile = async (key: string, file: File | undefined) => {
    if (!file) return;
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (file.size > (isPdf ? MAX_PDF_BYTES : MAX_DOC * 4)) {
      setProblems([`${file.name} is too large. Paste the licence text instead (up to ${MAX_DOC.toLocaleString()} characters).`]);
      return;
    }
    let full: string;
    const notes: string[] = [];
    if (isPdf) {
      try {
        // Read on this device: the PDF is never uploaded. The reader loads only when a PDF is chosen.
        const { extractPdfText } = await import("@/src/ui/lib/pdf-text");
        const read = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
        full = read.text;
        if (read.pagesSkipped) notes.push(`${file.name}: only the first ${read.pages} pages were read.`);
      } catch (e) {
        setProblems([`${file.name}: ${errorMessage(e)}`]);
        return;
      }
    } else {
      full = await file.text();
    }
    if (full.length > MAX_DOC) notes.push(`${file.name} is longer than ${MAX_DOC.toLocaleString()} characters; only the start was kept. Check that the terms you need are in it.`);
    setProblems(notes);
    setDocs((d) => d.map((x) => (x.key === key ? { ...x, text: full.slice(0, MAX_DOC), fileName: file.name } : x)));
  };

  /** A licensor is kept by name even with no payout email, so the run shows who the creator is; without an email they just cannot be paid. */
  const licensorOf = (d: { licensorName: string; licensorEmail: string }) => {
    const name = d.licensorName.trim();
    const email = d.licensorEmail.trim();
    return name || email ? { name: name || email, ...(email ? { email } : {}) } : undefined;
  };

  const submit = async () => {
    if (!draft) return;
    const issues: string[] = [];
    const term = Number(draft.termMonths);
    const territories = draft.worldwide ? ["WORLD"] : draft.territories.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (!draft.name.trim()) issues.push("Give the project a name.");
    if (!territories.length) issues.push("Choose worldwide or list at least one country code.");
    if (!Number.isInteger(term) || term <= 0) issues.push("The term must be a whole number of months.");
    if (!assets.length) issues.push("Choose at least one asset the project needs.");
    for (const a of assets) if (!docs.some((d) => d.assetId === a && d.text.trim())) issues.push(`Add licence text for the ${assetLabel(a).toLowerCase()}.`);
    if (draft.budget.trim() && !(Number(draft.budget) > 0)) issues.push("The budget must be a positive number, or left empty.");
    setProblems(issues);
    if (issues.length) return;

    setRunning(true);
    setRunError(null);
    try {
      const project: Project = {
        name: draft.name.trim(),
        commercial: draft.commercial,
        territories,
        termMonths: term,
        budgetCents: draft.budget.trim() ? Math.round(Number(draft.budget) * 100) : undefined,
        mediums: draft.mediums.length ? draft.mediums : undefined,
        canCredit: draft.cannotCredit ? false : undefined,
        needsSublicensing: draft.needsSublicensing || undefined,
        requiresExclusive: draft.requiresExclusive || undefined,
      };
      const documents = docs
        .filter((d) => assets.includes(d.assetId) && d.text.trim())
        .map((d, i) => ({ id: `doc-${i + 1}-${d.assetId}`, assetId: d.assetId, text: d.text, licensor: licensorOf(d) }));
      const view = await api<SessionView>("/api/sessions", { method: "POST", json: { project, requiredAssetIds: assets, documents, brief: text || undefined } });
      router.push(`/run/${view.id}`);
    } catch (e) {
      setRunError(errorMessage(e));
      setRunning(false);
    }
  };

  const noModel = config?.mode === "demo";

  return (
    <div className={`card ${styles.wizard}`}>
      <ol className={styles.progress} aria-label="Steps">
        {["Describe", "Requirements", "Licences"].map((label, i) => (
          <li key={label} data-state={step === i + 1 ? "current" : step > i + 1 ? "done" : "todo"} aria-current={step === i + 1 ? "step" : undefined}>
            <span className={styles.pNum}>{step > i + 1 ? <Check aria-hidden /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className={styles.body}>
          <label className="label" htmlFor={`${ids}-brief`}>
            What are you making, where will it be shown, for how long, and what does it use?
          </label>
          <textarea
            id={`${ids}-brief`}
            className={`textarea ${styles.brief}`}
            rows={4}
            maxLength={2000}
            placeholder='e.g. A US promo for our documentary "Harbour at Dawn", 12 months, under $1,000, with a song, an image and a font.'
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim().length >= 5) void read();
            }}
          />
          <div className={styles.exampleRow}>
            <span className={styles.exLabel}>Examples</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className={styles.example} onClick={() => setText(ex)} title={ex}>
                {ex.length > 64 ? `${ex.slice(0, 62)}…` : ex}
              </button>
            ))}
          </div>
          {intakeError && (
            <p className="callout tone-bad" role="alert">
              <CircleAlert aria-hidden /> {intakeError}
            </p>
          )}
          <div className={styles.actions}>
            <span className={styles.count}>{text.length} / 2,000</span>
            <button type="button" className="btn btn-primary" onClick={read} disabled={reading || text.trim().length < 5}>
              {reading ? <Spinner label="Reading" /> : <Wand2 aria-hidden />}
              Read my brief
            </button>
          </div>
        </div>
      )}

      {step === 2 && draft && intake && (
        <div className={styles.body}>
          <div className={styles.readout}>
            <div className={styles.found}>
              <h3 className={styles.h3}>
                <Check aria-hidden /> Found in your text
              </h3>
              {intake.found.length ? (
                <ul>
                  {intake.found.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">Nothing specific. Fill in the fields below.</p>
              )}
            </div>
            <div className={styles.assumed}>
              <h3 className={styles.h3}>
                <AlertTriangle aria-hidden /> Assumed (change if wrong)
              </h3>
              {intake.assumed.length ? (
                <ul>
                  {intake.assumed.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">Nothing was assumed.</p>
              )}
            </div>
          </div>
          <p className={styles.source}>
            <Sparkles aria-hidden /> {intake.source === "model" ? "Read by the model, checked against the offline reader." : "Read by the offline reader (rules of thumb, no model). Check every field."}
          </p>

          <div className={styles.grid}>
            <div className={styles.full}>
              <label className="label" htmlFor={`${ids}-name`}>
                Project name
              </label>
              <input id={`${ids}-name`} className="input" value={draft.name} maxLength={120} onChange={(e) => set("name", e.target.value)} />
            </div>
            <fieldset className={styles.fieldset}>
              <legend className="label">Use</legend>
              <div className={styles.segment} role="radiogroup">
                <button type="button" role="radio" aria-checked={draft.commercial} onClick={() => set("commercial", true)}>
                  Commercial
                </button>
                <button type="button" role="radio" aria-checked={!draft.commercial} onClick={() => set("commercial", false)}>
                  Non-commercial
                </button>
              </div>
            </fieldset>
            <div>
              <label className="label" htmlFor={`${ids}-term`}>
                Term (months)
              </label>
              <input id={`${ids}-term`} className="input" inputMode="numeric" value={draft.termMonths} onChange={(e) => set("termMonths", e.target.value.replace(/[^\d]/g, ""))} />
            </div>
            <div>
              <label className="label" htmlFor={`${ids}-budget`}>
                Budget (USD, optional)
              </label>
              <input id={`${ids}-budget`} className="input" inputMode="decimal" placeholder="No budget" value={draft.budget} onChange={(e) => set("budget", e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
            <div className={styles.full}>
              <span className="label" id={`${ids}-terr`}>
                Territory
              </span>
              <div className={styles.terrRow}>
                <label className="checkbox">
                  <input type="checkbox" checked={draft.worldwide} onChange={(e) => set("worldwide", e.target.checked)} /> Worldwide
                </label>
                {!draft.worldwide && <input aria-labelledby={`${ids}-terr`} className="input" placeholder="Country codes, e.g. US, CA, GB" value={draft.territories} onChange={(e) => set("territories", e.target.value)} />}
              </div>
            </div>
            <fieldset className={`${styles.fieldset} ${styles.full}`}>
              <legend className="label">Media (optional; a licence must cover each one you tick)</legend>
              <div className={styles.toggles}>
                {MEDIA.map((m) => (
                  <label key={m} className={styles.toggle} data-on={draft.mediums.includes(m) || undefined}>
                    <input type="checkbox" checked={draft.mediums.includes(m)} onChange={() => set("mediums", draft.mediums.includes(m) ? draft.mediums.filter((x) => x !== m) : [...draft.mediums, m])} />
                    {mediumName(m)}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className={`${styles.fieldset} ${styles.full}`}>
              <legend className="label">Constraints</legend>
              <div className={styles.checks}>
                <label className="checkbox">
                  <input type="checkbox" checked={draft.cannotCredit} onChange={(e) => set("cannotCredit", e.target.checked)} /> We cannot credit creators
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={draft.needsSublicensing} onChange={(e) => set("needsSublicensing", e.target.checked)} /> We must sublicense to partners
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={draft.requiresExclusive} onChange={(e) => set("requiresExclusive", e.target.checked)} /> We need exclusive licences
                </label>
              </div>
            </fieldset>
            <fieldset className={`${styles.fieldset} ${styles.full}`}>
              <legend className="label">Assets the project needs</legend>
              <div className={styles.toggles}>
                {[...new Set([...KNOWN_ASSETS, ...assets])].map((a) => (
                  <label key={a} className={styles.toggle} data-on={assets.includes(a) || undefined}>
                    <input type="checkbox" checked={assets.includes(a)} onChange={() => toggleAsset(a)} />
                    <AssetIcon assetId={a} size={14} /> {assetLabel(a)}
                  </label>
                ))}
                <span className={styles.addAsset}>
                  <input
                    aria-label="Add another asset"
                    className="input"
                    placeholder="Other asset"
                    value={customAsset}
                    maxLength={30}
                    onChange={(e) => setCustomAsset(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomAsset();
                      }
                    }}
                  />
                  <button type="button" className="btn btn-sm" onClick={addCustomAsset} disabled={!customAsset.trim()}>
                    <Plus aria-hidden /> Add
                  </button>
                </span>
              </div>
            </fieldset>
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
              <ArrowLeft aria-hidden /> Back
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-primary" onClick={goLicences} disabled={!assets.length}>
              Next: add licences <ArrowRight aria-hidden />
            </button>
          </div>
        </div>
      )}

      {step === 3 && draft && (
        <div className={styles.body}>
          <div className={styles.useScenario}>
            <label className="label" htmlFor={`${ids}-sc`}>
              No licences to hand? Load a scenario&rsquo;s licence documents
            </label>
            <select id={`${ids}-sc`} className="select" defaultValue="" onChange={(e) => e.target.value && loadScenarioDocs(e.target.value)}>
              <option value="" disabled>
                Choose a scenario…
              </option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.documents.length} licences)
                </option>
              ))}
            </select>
          </div>

          {assets.map((a) => (
            <div key={a} className={styles.assetBlock}>
              <h3 className={styles.assetHead}>
                <AssetIcon assetId={a} size={16} /> {assetLabel(a)}
                <span className="small muted">{docs.filter((d) => d.assetId === a).length} licence(s)</span>
              </h3>
              {docs
                .filter((d) => d.assetId === a)
                .map((d, i) => (
                  <div key={d.key} className={styles.doc}>
                    <div className={styles.docHead}>
                      <span className={styles.docNo}>Licence {i + 1}</span>
                      <label className={`btn btn-sm ${styles.fileBtn}`}>
                        <FileUp aria-hidden /> {d.fileName ? "Replace file" : "Load a PDF or text file"}
                        <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" className="visually-hidden" onChange={(e) => loadFile(d.key, e.target.files?.[0])} />
                      </label>
                      {d.fileName && <span className="small muted">{d.fileName}</span>}
                      <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Remove licence ${i + 1} for ${assetLabel(a).toLowerCase()}`} onClick={() => setDocs(docs.filter((x) => x.key !== d.key))}>
                        <Trash2 aria-hidden />
                      </button>
                    </div>
                    <textarea
                      className={`textarea ${styles.licence}`}
                      aria-label={`Licence ${i + 1} text for ${assetLabel(a).toLowerCase()}`}
                      rows={5}
                      maxLength={MAX_DOC}
                      placeholder="Paste the licence text here"
                      value={d.text}
                      onChange={(e) => setDocs(docs.map((x) => (x.key === d.key ? { ...x, text: e.target.value } : x)))}
                    />
                    <div className={styles.payee}>
                      <input className="input" aria-label="Licensor name" placeholder="Licensor name" value={d.licensorName} maxLength={80} onChange={(e) => setDocs(docs.map((x) => (x.key === d.key ? { ...x, licensorName: e.target.value } : x)))} />
                      <input className="input" aria-label="Licensor payout email (optional)" placeholder="Payout email (needed to pay this creator)" type="email" value={d.licensorEmail} onChange={(e) => setDocs(docs.map((x) => (x.key === d.key ? { ...x, licensorEmail: e.target.value } : x)))} />
                    </div>
                  </div>
                ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDocs([...docs, { key: newKey(), assetId: a, text: "", licensorName: "", licensorEmail: "" }])}>
                <Plus aria-hidden /> Add another licence for the {assetLabel(a).toLowerCase()}
              </button>
            </div>
          ))}

          {noModel && !runError && (
            <p className="callout tone-warn">
              <AlertTriangle aria-hidden />
              <span>This server has no model connected, so it cannot read your own licences yet; the server will say so when you run. The built-in scenarios work without one.</span>
            </p>
          )}
          {problems.length > 0 && (
            <div className="callout tone-bad" role="alert">
              <CircleAlert aria-hidden />
              <ul className={styles.problems}>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {runError && (
            <div className={`callout tone-warn ${styles.runError}`} role="alert">
              <AlertTriangle aria-hidden />
              <div>
                <p>
                  <b>The server did not start this run.</b> {runError}
                </p>
                {scenarios.length > 0 && (
                  <div className="row" style={{ marginTop: 10 }}>
                    {scenarios.map((s) => (
                      <button key={s.id} type="button" className="btn btn-sm" onClick={() => onStartScenario(s.id)} disabled={starting !== null}>
                        {starting === s.id ? <Spinner /> : <ArrowRight aria-hidden />} Run {s.title.toLowerCase()} instead
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className={styles.actions}>
            <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>
              <ArrowLeft aria-hidden /> Back
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-primary btn-lg" onClick={submit} disabled={running}>
              {running ? <Spinner label="Starting" /> : <Sparkles aria-hidden />}
              Find a compliant bundle
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
