"use client";
import Link from "next/link";
import { cloneElement, useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { LicenseOffer } from "@/src/core/types";
import type { SourceDocument } from "@/src/extraction/extract";
import { api, errorMessage } from "@/src/ui/lib/api";
import { budgetFromText, projectFromDraft } from "@/src/ui/lib/project-draft";
import { formatMoney } from "@/src/ui/lib/format";
import styles from "./Workspace.module.css";

type User = { id: string; email: string; name: string; roles: string[]; mfa: boolean };
type Offer = { id: string; version: number; status?: string; offer: LicenseOffer; document: SourceDocument };
type Licensor = {
  id: string;
  version: number;
  status: string;
  recipientConfirmed: boolean;
  reason?: string;
  details: { name: string; recipientEmail: string; identityEvidence: string; rightsEvidence: string };
};
type Reviews = {
  licensors: (Licensor & { userId: string })[];
  offers: Offer[];
  disputes: { id: string; runId: string; status: string; details: { reason: string; evidence: string } }[];
  operations: { id: string; run_id: string; kind: string; status: string }[];
};
type Snapshot = {
  catalog: Offer[];
  offers: Offer[];
  licensor: Licensor | null;
  runs: { id: string; name: string; phase: string }[];
  tokens: { id: string; name: string; expires_at: string; revoked_at?: string }[];
  reviews?: Reviews;
};
const value = (form: FormData, name: string) => String(form.get(name) ?? "");
/** Names its control by the label text alone, so a pre-filled value never becomes part of the accessible name. */
function Field({ label, children }: { label: string; children: ReactElement<{ "aria-labelledby"?: string }> }) {
  const id = useId();
  return (
    <div className={styles.field}>
      <span id={id}>{label}</span>
      {cloneElement(children, { "aria-labelledby": id })}
    </div>
  );
}
function Evidence({ offer }: { offer: Offer }) {
  return (
    <details className={styles.evidence}>
      <summary>Read the licence and source quotations</summary>
      <pre>{offer.document.text}</pre>
      <dl>
        {offer.offer.evidence.map((e, i) => (
          <div key={i}>
            <dt>{e.field}</dt>
            <dd>
              <q>{e.quote}</q>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function Workspace() {
  const router = useRouter();
  const [identity, setIdentity] = useState<{ enabled: boolean; user?: User | null } | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState("buyer");
  const [revising, setRevising] = useState<string | undefined>();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async (user: User) => {
    const [catalog, offers, licensor, runs, tokens, reviews] = await Promise.all([
      api<{ offers: Offer[] }>("/api/marketplace/catalog"),
      api<{ offers: Offer[] }>("/api/marketplace/offers"),
      api<{ licensor: Licensor | null }>("/api/marketplace/licensor"),
      api<{ runs: Snapshot["runs"] }>("/api/sessions"),
      api<{ tokens: Snapshot["tokens"] }>("/api/marketplace/agent-tokens"),
      user.roles.includes("staff") && user.mfa ? api<Reviews>("/api/marketplace/staff/reviews") : Promise.resolve(undefined),
    ]);
    setData({
      catalog: catalog.offers,
      offers: offers.offers,
      licensor: licensor.licensor,
      runs: runs.runs,
      tokens: tokens.tokens,
      reviews,
    });
  }, []);
  useEffect(() => {
    let alive = true;
    api<{ enabled: boolean; user?: User | null }>("/api/auth/me")
      .then(async (me) => {
        if (!alive) return;
        setIdentity(me);
        if (me.user) await refresh(me.user);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function act(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const result = await work();
      if (identity?.user) await refresh(identity.user);
      setNotice(typeof result === "string" ? result : `${label} completed.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  if (!identity && !error)
    return (
      <div className={`container ${styles.page}`} aria-busy="true">
        <h1>Private workspace</h1>
        <p>Loading your account…</p>
      </div>
    );
  if (!identity?.user)
    return (
      <div className={`container ${styles.page}`}>
        <p className="eyebrow">LicenseGraph / Private workspace</p>
        <h1>Your releases, your source documents.</h1>
        <p className={styles.lead}>
          {identity?.enabled
            ? "Sign in to work with private licences, reviewed creators and purchase records. Payments use Sandbox test money only."
            : "The private workspace is not enabled on this server. You can still explore the recorded scenarios."}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="row">
          {identity?.enabled && (
            <a className="btn btn-primary" href="/api/auth/login">
              Sign in or create an account
            </a>
          )}
          <Link className="btn" href="/">
            Explore recorded demos
          </Link>
        </div>
      </div>
    );
  const user = identity.user;
  return (
    <div className={`container-wide ${styles.page}`}>
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">Private workspace · Sandbox only</p>
          <h1>Clear your next release.</h1>
          <p className={styles.lead}>Signed in as {user.email}. Documents stay private until you explicitly share them.</p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="btn" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <nav className={styles.tabs} aria-label="Workspace sections">
        {[
          ["buyer", "Your releases"],
          ["creator", "Creator desk"],
          ["agents", "Agent access"],
          ...(user.roles.includes("staff") ? [["staff", "Staff review"]] : []),
        ].map(([id, label]) => (
          <button key={id} className="btn" aria-pressed={tab === id} onClick={() => setTab(id!)}>
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <div className="callout tone-bad" role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </div>
      )}
      {notice && (
        <p className="callout" role="status">
          {notice}
        </p>
      )}
      {!data ? (
        <p aria-busy="true">Loading your workspace…</p>
      ) : (
        <fieldset disabled={Boolean(busy)} className={styles.all}>
          <legend className="visually-hidden">{busy || "Workspace actions"}</legend>
          {tab === "buyer" && (
            <div className={styles.layout}>
              <section className={`card ${styles.panel}`}>
                <h2>Start from reviewed offers</h2>
                <p>
                  Review the source text, describe the release, then let the rules engine check the proposed bundle. Approval is a separate
                  step.
                </p>
                {!data.catalog.length && (
                  <p className="callout">No reviewed offers are available yet. Creators can submit their work from the Creator desk.</p>
                )}
                <div className={styles.cards}>
                  {data.catalog.map((o) => {
                    const key = `${o.id}:${o.version}`;
                    return (
                      <article key={key} className={styles.offer}>
                        <label className={styles.pick}>
                          <input
                            type="checkbox"
                            checked={selected.includes(key)}
                            onChange={(e) => setSelected((old) => (e.target.checked ? [...old, key] : old.filter((k) => k !== key)))}
                          />
                          <strong>{o.offer.assetId}</strong>
                          <span>{formatMoney(o.offer.priceCents, o.offer.currency)}</span>
                        </label>
                        <p className="small muted">Version {o.version} · reviewed offer</p>
                        <Evidence offer={o} />
                      </article>
                    );
                  })}
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void act("Run started", async () => {
                      const converted = projectFromDraft({
                        name: value(form, "name"),
                        commercial: form.has("commercial"),
                        worldwide: form.has("worldwide"),
                        territories: value(form, "territories"),
                        termMonths: value(form, "months"),
                        budget: value(form, "budget"),
                        mediums: value(form, "media")
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                        cannotCredit: form.has("cannotCredit"),
                        needsSublicensing: form.has("sublicensing"),
                        requiresExclusive: form.has("exclusive"),
                      });
                      if (!converted.ok) throw new Error(converted.problems.join(" "));
                      const offers = data.catalog.filter((o) => selected.includes(`${o.id}:${o.version}`));
                      if (!offers.length) throw new Error("Choose at least one reviewed offer.");
                      const run = await api<{ id: string }>("/api/sessions", {
                        method: "POST",
                        json: {
                          project: converted.project,
                          requiredAssetIds: [...new Set(offers.map((o) => o.offer.assetId))],
                          offerRefs: offers.map((o) => ({ id: o.id, version: o.version })),
                        },
                      });
                      router.push(`/run/${run.id}`);
                    });
                  }}
                  className={styles.form}
                >
                  <Field label="Release name">
                    <input name="name" required maxLength={120} />
                  </Field>
                  <div className={styles.pair}>
                    <Field label="Territories (country codes)">
                      <input name="territories" defaultValue="US" />
                    </Field>
                    <Field label="Months of use">
                      <input name="months" inputMode="numeric" defaultValue="12" required />
                    </Field>
                  </div>
                  <div className={styles.pair}>
                    <Field label="Budget in USD (optional)">
                      <input name="budget" inputMode="decimal" />
                    </Field>
                    <Field label="Media (comma separated, optional)">
                      <input name="media" placeholder="web, social, broadcast" />
                    </Field>
                  </div>
                  <div className={styles.checks}>
                    <label>
                      <input type="checkbox" name="commercial" defaultChecked />
                      Commercial release
                    </label>
                    <label>
                      <input type="checkbox" name="worldwide" />
                      Worldwide
                    </label>
                    <label>
                      <input type="checkbox" name="cannotCredit" />
                      Cannot provide attribution
                    </label>
                    <label>
                      <input type="checkbox" name="sublicensing" />
                      Needs sublicensing
                    </label>
                    <label>
                      <input type="checkbox" name="exclusive" />
                      Requires exclusivity
                    </label>
                  </div>
                  <button className="btn btn-primary" type="submit">
                    Check the proposed bundle
                  </button>
                </form>
                <p className="small muted">
                  For your own licence documents, use <Link href="/#custom">custom analysis</Link>. Uploaded terms need marketplace review
                  before purchase.
                </p>
              </section>
              <aside className={`card ${styles.panel}`}>
                <h2>Your releases</h2>
                {data.runs.length ? (
                  <ul className={styles.list}>
                    {data.runs.map((run) => (
                      <li key={run.id}>
                        <Link href={`/run/${run.id}`}>{run.name}</Link>
                        <span>{run.phase.replaceAll("_", " ")}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No private runs yet.</p>
                )}
                <Link className="btn" href="/dashboard?portfolio=1">
                  Open portfolio dashboard
                </Link>
              </aside>
            </div>
          )}
          {tab === "creator" && (
            <div className={styles.layout}>
              <section className={`card ${styles.panel}`}>
                <h2>Your licensor profile</h2>
                <p>
                  Provide identity and rights evidence for staff review. Review records a decision; it does not certify copyright ownership.
                </p>
                {data.licensor && (
                  <p className="callout">
                    Profile version {data.licensor.version}: <strong>{data.licensor.status}</strong>.{" "}
                    {data.licensor.recipientConfirmed ? "Verified email confirmed." : "Recipient confirmation is required."}{" "}
                    {data.licensor.reason}
                  </p>
                )}
                <form
                  key={data.licensor?.version ?? 0}
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act("Profile submitted", () =>
                      api("/api/marketplace/licensor", {
                        method: "POST",
                        json: {
                          name: value(f, "name"),
                          recipientEmail: user.email,
                          identityEvidence: value(f, "identityEvidence"),
                          rightsEvidence: value(f, "rightsEvidence"),
                          declaration: f.has("declaration"),
                        },
                      }),
                    );
                  }}
                >
                  <Field label="Licensor name">
                    <input name="name" required maxLength={160} defaultValue={data.licensor?.details.name} />
                  </Field>
                  <Field label="Payout recipient">
                    <input value={user.email} readOnly />
                  </Field>
                  <p className="small muted">
                    The recipient uses your verified account email. Email control does not verify ownership of a PayPal Sandbox account.
                  </p>
                  <Field label="Identity evidence">
                    <textarea
                      name="identityEvidence"
                      required
                      minLength={20}
                      maxLength={50000}
                      rows={4}
                      defaultValue={data.licensor?.details.identityEvidence}
                    />
                  </Field>
                  <Field label="Rights and ownership evidence">
                    <textarea
                      name="rightsEvidence"
                      required
                      minLength={20}
                      maxLength={100000}
                      rows={5}
                      defaultValue={data.licensor?.details.rightsEvidence}
                    />
                  </Field>
                  <label className={styles.pick}>
                    <input name="declaration" type="checkbox" required />I am authorized to license this work and the evidence is accurate.
                  </label>
                  <button className="btn btn-primary">Submit for review</button>
                </form>
                {data.licensor && !data.licensor.recipientConfirmed && (
                  <button
                    className="btn"
                    onClick={() =>
                      void act("Recipient confirmed", () => api("/api/marketplace/licensor/confirm", { method: "POST", json: {} }))
                    }
                  >
                    Confirm my verified email as recipient
                  </button>
                )}
              </section>
              <section className={`card ${styles.panel}`}>
                <h2>Your licence offers</h2>
                {data.licensor?.status === "approved" ? (
                  <OfferForm
                    key={revising ?? "new"}
                    existingId={revising}
                    onCancel={() => setRevising(undefined)}
                    submit={(body) =>
                      act(revising ? "New offer version submitted" : "Offer submitted", async () => {
                        const result = await api("/api/marketplace/offers", {
                          method: "POST",
                          json: { ...(body as object), ...(revising ? { existingId: revising } : {}) },
                        });
                        setRevising(undefined);
                        return result;
                      })
                    }
                  />
                ) : (
                  <p>An approved profile is required before submitting offers.</p>
                )}
                <div className={styles.cards}>
                  {data.offers.map((o) => (
                    <article className={styles.offer} key={`${o.id}:${o.version}`}>
                      <h3>
                        {o.offer.assetId} · {formatMoney(o.offer.priceCents, o.offer.currency)}
                      </h3>
                      <p>
                        Version {o.version}: {o.status}
                      </p>
                      <Evidence offer={o} />
                      <div className={styles.actions}>
                        <button className="btn btn-sm" onClick={() => setRevising(o.id)}>
                          Create a new version of {o.offer.assetId}
                        </button>
                        {(o.status === "pending" || o.status === "approved") && (
                          <button
                            className="btn btn-sm"
                            onClick={() =>
                              void act("Offer withdrawn", () =>
                                api(`/api/marketplace/offers/${o.id}?version=${o.version}`, { method: "DELETE" }),
                              )
                            }
                          >
                            Withdraw version {o.version} of {o.offer.assetId}
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          )}
          {tab === "agents" && (
            <section className={`card ${styles.panel}`}>
              <h2>Limited agent access</h2>
              <p>
                Credentials can start and read your runs for seven days. A person must claim each agent-started run, approve its exact
                purchase and authorize payment.
              </p>
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act("Credential issued", async () => {
                    const created = await api<{ token: string }>("/api/marketplace/agent-tokens", {
                      method: "POST",
                      json: { name: value(f, "name") },
                    });
                    return `Copy this credential now; it is shown once: ${created.token}`;
                  });
                }}
              >
                <Field label="Credential name">
                  <input name="name" required maxLength={80} />
                </Field>
                <button className="btn btn-primary">Create limited credential</button>
              </form>
              <ul className={styles.list}>
                {data.tokens.map((t) => (
                  <li key={t.id}>
                    <span>
                      {t.name} · {t.revoked_at ? "revoked" : `expires ${new Date(t.expires_at).toLocaleDateString()}`}
                    </span>
                    {!t.revoked_at && (
                      <button
                        className="btn btn-sm"
                        onClick={() =>
                          void act("Credential revoked", () => api(`/api/marketplace/agent-tokens/${t.id}`, { method: "DELETE" }))
                        }
                      >
                        Revoke {t.name}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {tab === "staff" && (
            <section className={`card ${styles.panel}`}>
              <h2>Staff review</h2>
              {!user.mfa ? (
                <p className="callout">
                  Staff review requires multi-factor sign-in. Configure your second factor with the identity administrator, then sign in
                  again.
                </p>
              ) : (
                <>
                  {data.reviews?.licensors.map((l) => (
                    <article key={l.id} className={styles.review}>
                      <h3>
                        {l.details.name} · {l.status}
                      </h3>
                      <p>
                        Version {l.version} · recipient {l.recipientConfirmed ? "confirmed" : "unconfirmed"}
                      </p>
                      <details>
                        <summary>Review identity and rights evidence</summary>
                        <h4>Identity</h4>
                        <p className={styles.source}>{l.details.identityEvidence}</p>
                        <h4>Rights</h4>
                        <p className={styles.source}>{l.details.rightsEvidence}</p>
                        <p>{l.details.recipientEmail}</p>
                      </details>
                      <ReviewForm
                        decisions={["approved", "rejected", "suspended"]}
                        submit={(decision, reason) =>
                          act("Licensor reviewed", () =>
                            api(`/api/marketplace/staff/licensors/${l.id}`, { method: "POST", json: { decision, reason } }),
                          )
                        }
                      />
                    </article>
                  ))}
                  {data.reviews?.offers.map((o) => (
                    <article key={`${o.id}:${o.version}`} className={styles.review}>
                      <h3>
                        Offer: {o.offer.assetId} · {formatMoney(o.offer.priceCents, o.offer.currency)}
                      </h3>
                      <Evidence offer={o} />
                      <ReviewForm
                        decisions={["approved", "rejected"]}
                        submit={(decision, reason) =>
                          act("Offer reviewed", () =>
                            api(`/api/marketplace/staff/offers/${o.id}`, {
                              method: "POST",
                              json: { version: o.version, decision, reason },
                            }),
                          )
                        }
                      />
                    </article>
                  ))}
                  {data.reviews?.disputes.map((d) => (
                    <article key={d.id} className={styles.review}>
                      <h3>Dispute · {d.status}</h3>
                      <p>{d.details.reason}</p>
                      <details>
                        <summary>Private evidence</summary>
                        <p className={styles.source}>{d.details.evidence}</p>
                      </details>
                      <ReviewForm
                        decisions={["release", "refund", "escalate"]}
                        submit={(decision, reason) =>
                          act("Dispute decision recorded", () =>
                            api(`/api/marketplace/staff/disputes/${d.id}`, { method: "POST", json: { decision, reason } }),
                          )
                        }
                      />
                    </article>
                  ))}
                  {data.reviews?.operations.map((o) => (
                    <article key={o.id} className={styles.review}>
                      <h3>Reconciliation: {o.kind}</h3>
                      <p>The outcome is uncertain. This action only reads an existing Sandbox record; it never resends money.</p>
                      <form
                        className={styles.form}
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void act("Operation reconciled", () =>
                            api(`/api/marketplace/staff/reconcile/${o.id}`, {
                              method: "POST",
                              json: { providerId: value(f, "providerId"), reason: value(f, "reason") },
                            }),
                          );
                        }}
                      >
                        <Field label="Existing provider record ID">
                          <input name="providerId" required maxLength={120} />
                        </Field>
                        <Field label="Reconciliation reason">
                          <textarea name="reason" required minLength={10} maxLength={4000} />
                        </Field>
                        <button className="btn">Check existing Sandbox record</button>
                      </form>
                    </article>
                  ))}
                  {!data.reviews?.licensors.length &&
                    !data.reviews?.offers.length &&
                    !data.reviews?.disputes.length &&
                    !data.reviews?.operations.length && <p>No cases need review.</p>}
                </>
              )}
            </section>
          )}
        </fieldset>
      )}
    </div>
  );
}
function ReviewForm({ decisions, submit }: { decisions: string[]; submit: (decision: string, reason: string) => Promise<unknown> }) {
  return (
    <form
      className={styles.reviewForm}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit(value(f, "decision"), value(f, "reason"));
      }}
    >
      <Field label="Decision">
        <select name="decision">
          {decisions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reason">
        <textarea name="reason" required minLength={10} maxLength={4000} rows={2} />
      </Field>
      <button className="btn">Record decision</button>
    </form>
  );
}
const OPTIONAL_TERMS: { key: string; label: string; kind: "boolean" | "text"; hint?: string }[] = [
  { key: "mediums", label: "Media covered", kind: "text", hint: "Comma separated, or ALL" },
  { key: "attributionRequired", label: "Attribution required", kind: "boolean" },
  { key: "sublicensing", label: "Sublicensing allowed", kind: "boolean" },
  { key: "exclusive", label: "Exclusive to the licensee", kind: "boolean" },
  { key: "fixedEndDate", label: "Licence ends on", kind: "text", hint: "YYYY-MM-DD" },
  { key: "offerValidUntil", label: "Offer can be bought until", kind: "text", hint: "YYYY-MM-DD" },
];
function OfferForm({
  submit,
  existingId,
  onCancel,
}: {
  submit: (body: unknown) => Promise<unknown>;
  existingId?: string;
  onCancel: () => void;
}) {
  const [terms, setTerms] = useState(false);
  const [stated, setStated] = useState<Record<string, string>>({});
  const core = ["price", "commercialUse", "territories", "termMonths"];
  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitFromForm(new FormData(event.currentTarget));
  }
  async function submitFromForm(f: FormData) {
    const text = value(f, "source"),
      price = budgetFromText(value(f, "price"));
    const quoted = (field: string, quote: string) => {
      const start = text.indexOf(quote);
      return { documentId: "source", field, quote, start, end: start + quote.length };
    };
    const evidence = core.map((field) => quoted(field === "termMonths" ? "term" : field, value(f, `${field}Quote`)));
    const optional: Record<string, unknown> = {};
    for (const t of OPTIONAL_TERMS) {
      const choice = value(f, `${t.key}Value`);
      if (!choice || choice === "unstated") continue;
      optional[t.key] =
        t.kind === "boolean"
          ? choice === "yes"
          : t.key === "mediums"
            ? choice.toUpperCase() === "ALL"
              ? "ALL"
              : choice
                  .split(/[,\s]+/)
                  .filter(Boolean)
                  .map((m) => m.toLowerCase())
            : choice;
      evidence.push(quoted(t.key, value(f, `${t.key}Quote`)));
    }
    const term = value(f, "months");
    return submit({
      offer: {
        id: "draft",
        assetId: value(f, "asset"),
        priceCents: price.ok ? price.cents : -1,
        currency: "USD",
        terms: {
          commercialUse: f.has("commercial"),
          territories: value(f, "territories")
            .split(/[,\s]+/)
            .filter(Boolean)
            .map((s) => s.toUpperCase()),
          termMonths: term === "perpetual" ? "perpetual" : Number(term),
          ...optional,
        },
        evidence,
      },
      document: { id: "source", assetId: value(f, "asset"), text },
    });
  }
  return (
    <form className={styles.form} onSubmit={handle} aria-label={existingId ? "New offer version" : "New offer"}>
      {existingId && (
        <p className="callout">
          Creating a new version. The earlier version stays as reviewed; this one needs its own review.{" "}
          <button type="button" className="btn btn-sm" onClick={onCancel}>
            Cancel the new version
          </button>
        </p>
      )}
      <Field label="Asset ID">
        <input name="asset" required maxLength={55} />
      </Field>
      <div className={styles.pair}>
        <Field label="Price in USD">
          <input name="price" required inputMode="decimal" />
        </Field>
        <Field label="Months, or perpetual">
          <input name="months" required defaultValue="12" />
        </Field>
      </div>
      <Field label="Territories (country codes or WORLD)">
        <input name="territories" required defaultValue="WORLD" />
      </Field>
      <label>
        <input name="commercial" type="checkbox" defaultChecked />
        Commercial use permitted
      </label>
      <Field label="Complete licence source text">
        <textarea name="source" required maxLength={20000} rows={8} />
      </Field>
      <fieldset className={styles.all}>
        <legend>Optional terms</legend>
        <p className="small muted">
          Leave a term as not stated unless the licence says it. A stated term needs its own exact source quotation.
        </p>
        {OPTIONAL_TERMS.map((t) => (
          <div key={t.key} className={styles.optional}>
            {t.kind === "boolean" ? (
              <Field label={t.label}>
                <select
                  name={`${t.key}Value`}
                  value={stated[t.key] ?? "unstated"}
                  onChange={(e) => setStated({ ...stated, [t.key]: e.target.value })}
                >
                  <option value="unstated">Not stated</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Field>
            ) : (
              <Field label={`${t.label} (${t.hint}; blank if not stated)`}>
                <input
                  name={`${t.key}Value`}
                  value={stated[t.key] ?? ""}
                  onChange={(e) => setStated({ ...stated, [t.key]: e.target.value })}
                />
              </Field>
            )}
            {stated[t.key] && stated[t.key] !== "unstated" && (
              <Field label={`Exact source quotation: ${t.label}`}>
                <textarea name={`${t.key}Quote`} required maxLength={2000} rows={2} />
              </Field>
            )}
          </div>
        ))}
      </fieldset>
      <button type="button" className="btn btn-ghost" aria-expanded={terms} onClick={() => setTerms(!terms)}>
        {terms ? "Hide" : "Add"} the four supporting quotations
      </button>
      {terms &&
        core.map((field) => (
          <Field key={field} label={`Exact source quotation: ${field}`}>
            <textarea name={`${field}Quote`} required maxLength={2000} rows={2} />
          </Field>
        ))}
      <p className="small muted">
        Each stated term needs an exact source quotation. Staff review the interpretation before this offer becomes purchasable.
      </p>
      <button className="btn btn-primary" disabled={!terms}>
        {existingId ? "Submit new version for review" : "Submit offer for review"}
      </button>
    </form>
  );
}
