# LicenseGraph step-by-step plan

> **Status:** steps 1 to 8 are built. After them the product was extended and redesigned for the hackathon: creator payouts, per-offer rule matrix and price-only comparison, the Licence Passport with in-browser verification, persistence, run ownership, an offline payment simulator, plain-English briefs and run Q&A, four scenarios, a full front-end redesign, a cross-run AG Studio portfolio, and end-to-end browser tests. Deployment is deferred by the owner; `docs/DEPLOY.md` is ready for when it is wanted. What remains is in the last section; current verification evidence is in `docs/READINESS.md`.

Target: submit to the PayPal AI Hackathon on **11 Nov 2026** (official close 12 Nov, 12:00 PM PT; confirmed from PayPal's developer blog). Budget about 45-50 hours, 2-3 hours a day alongside PIVOT until 8 Nov.

Prize targets: Best Overall, Best Use of Agentic Commerce, Best Use of AG Grid. Optional: APIMatic, Render hosting. Read each prize's exact requirements before counting on it.

## Step 1: Foundation (27-28 Oct)

- [x] Repo, MIT licence, TypeScript, Vitest, `.env.example`
- [x] Domain types and rules engine v1 with tests
- [x] Architecture and plan docs, `AGENTS.md`
- [x] PayPal Sandbox accounts (use United States accounts; India-region accounts cannot transact in USD)
- [x] Sandbox test order and capture from a script (`npm run sandbox:order`)
- Done: a test payment was captured on 27 Oct.

## Step 2: Payments client (28 Oct)

- [x] `src/payments/paypal.ts`: OAuth token, create order, capture, `PayPal-Request-Id` idempotency, Sandbox-only host guard
- [x] Mocked-HTTP unit tests; flagged live Sandbox test (`npm run test:live`)
- [x] `src/payments/checkout.ts`: `startCheckout` re-verifies the bundle and requires an approval for that exact bundle (digest match) before creating an order
- Done: `npm test` covers the client and the gate (20 tests); the live test creates orders against the Sandbox and checks idempotent retries. Capture needs a human buyer, so it stays in `npm run sandbox:order`, which captured a real Sandbox payment on 27 Oct.

## Step 3: Data models and extraction (29 Oct-31 Oct)

- [x] Fixture licence texts (music, image, font, footage) with known terms and verbatim quotes (`src/demo/fixtures.ts`)
- [x] `src/extraction/extract.ts`: schema for `LicenseOffer` with per-field evidence; every quote is located in the source text and given offsets, and an invented quote is rejected and retried with the reason
- [x] `src/extraction/model.ts`: gateway client behind a `ModelClient` interface; mock-model tests, one live run (`npm run test:gateway`)
- [x] Free-models-only guard: `assertModelIsFree` checks the gateway price list before any request is sent
- [x] Live run of all four fixtures on a free model: 4 of 4 correct on the first attempt, with every quote verified in the source (one request each, no retries)
- Done: fixtures extract with correct terms and verified quotes, both with the mock and live.

## Step 4: Rules engine hardening (1-2 Nov)

- [x] New rules: medium, attribution, sublicensing, exclusivity, fixed end date (under `term`), offer expiry
- [x] Policy: a constraint is checked only when the project declares it, and the offer must then state that it meets it; an offer that is silent fails
- [x] Rules are small functions in an `OFFER_RULES` list; expiry takes `today` as an input so verification stays deterministic, and `startCheckout` supplies the real date
- [x] Failing and passing cases for every rule, plus property tests (fast-check) for territory, term and bundle-order edge cases
- [x] Extraction reads the new terms (media, attribution, sublicensing, exclusivity, fixed end date, offer validity): a term is captured only when the text states it, each stated term needs located evidence, and terms the text is silent on stay blank
- [x] Two new fixtures (voiceover, archive) and live runs on the free model; all six fixtures pass. Free reasoning models are variable run to run (empty replies when the token budget runs out, label slips), so the code normalises labels and media values and the budget is 16,000 tokens
- Done: 74 unit tests pass; every rule has a failing and passing case; extraction covers the new terms.

## Step 5: Propose-verify-revise loop (3-4 Nov)

- [x] `src/agent/loop.ts`: `runProposeVerifyLoop`. The proposer picks offers by id from real candidates only; violations go back verbatim; only a bundle the rules engine accepts is returned as verified; it stops on a repeated bundle ("stalled") and at `maxRounds` ("exhausted"); an unknown id or a throwing proposer is recorded and fed back, not trusted
- [x] `src/agent/greedy.ts`: deterministic stand-in proposer for tests and offline demos. `src/agent/llm.ts`: model-backed proposer on the same `ModelClient` (free-models-only gateway guard applies)
- [x] `src/ledger/ledger.ts`: append-only, hash-chained event log (`proposed`, `rejected`, `revised`, `verified`, `proposal_error`, plus `approved`, `order_created`, `captured` for step 6); tampering, removal and reordering are detected; callers only get copies
- [x] Mock run shows reject, revise, accept with the ledger recording it
- [x] One live proposer run on the free model (a single request, `npm run test:proposer`): it chose valid ids, skipped the cheap non-commercial trap offer, and the rules engine confirmed the bundle
- Done: 90 unit tests pass.

## Step 6: Approval and checkout (5-6 Nov)

- [x] Approval record type; payment module refuses without `ok` verdict and approval (built in step 2)
- [x] `src/app-logic/session.ts`: one module owns the flow and its order (created, extracting, proposing, verified or failed, approved, order created, captured). Approval needs a verified bundle and a named approver; the order is created only through `startCheckout`; capture only for the session's own order; a failed capture leaves the order waiting
- [x] Next.js app: project form, licence documents (paste or load a text file), live loop timeline with evidence quotes, bundle table, approval, PayPal Sandbox order, capture, ledger with chain check
- [x] Demo mode (no keys, no credits) and live mode (free model only); PayPal return URL captures the payment, with a manual "complete payment" fallback
- [x] Payment idempotency key scoped to the session
- [x] Verified in a browser (demo) and through the API (live, free model): sample project reads four licences, verifies a bundle of $329.00, approves it and creates a Sandbox order
- [x] Buyer approved and the app captured a Sandbox order: $329.00 for the sample bundle on 27 Oct, with the ledger chain verified (read, proposed, rejected, revised, verified, approved, order created, captured)
- Done: an end-to-end purchase works in Sandbox.

## Step 7: Light work (7-8 Nov)

- PIVOT submission days. Only fix bugs here.
- [x] Done early, as a review pass: the in-memory session store is capped (200, never evicting a run in progress) and at most 3 runs can be active at once (HTTP 429 beyond that), so a public deployment cannot grow without bound or exhaust the gateway.
- Superseded by persistence and browser ownership: runs survive restarts; only the creating browser can approve or pay. Interrupted extraction/proposal runs must be restarted.

## Step 8: AG Grid dashboard (9-10 Nov)

- [x] AG Studio (`ag-studio`, `ag-studio-react`, commercial; runs locally with a trial watermark until a licence key is set) embedded at `/dashboard?session=ID`
- [x] Rights graph: four linked tables built from the run (`src/dashboard/data.ts`): assets, licence offers (every term, "Not stated" where the licence is silent), rule violations, and the ledger; relationships link assets to offers and offers to violations
- [x] Starting dashboard: verified bundle total, offer prices by asset, rules that rejected a proposal, the rights grid and the ledger; View and Edit modes (drag and drop, filters, cross-filtering come from AG Studio)
- [x] AI assistant that builds views on request: Studio's assistant panel wired to the model through `/api/llm`, a server-side proxy that holds the gateway key, fixes the model, checks it is free before use, paces calls to the provider's rate limit (5 a minute on the free model), and caps size and concurrency
- [x] Three plain-parameter tools (`create_chart`, `create_table`, `create_kpi`) with closed field lists and validated arguments (`src/dashboard/widget-tools.ts`); a small free model could not configure Studio's own add-widget tool, so it only chose from these
- [x] Verified in a browser: one plain-English request produced a rendered chart in about 17 seconds (2 model calls)
- [ ] Request the AG Studio trial licence key (email info@ag-grid.com) before the public deploy, to remove the watermark
- [x] Confirm the exact AG Grid prize requirements on the official page; see `docs/HACKATHON.md`
- [x] Dashboard layouts and added widgets persist in this browser, with a reset control.
- [x] Run dashboards, portfolio dashboards and the run list refresh automatically; changed ledger data appears without reloading. Failed refreshes retain the last successful snapshot and retry with backoff.
- Done: the dashboard follows the ledger while open.

## Step 9: Ship (11 Nov)

- [x] README with demo steps and submission drafts
- [x] Public repository access confirmed on 29 October 2026
- [ ] Complete the owner-approved hosting setup, record the demo video and submit
- 12 Nov: buffer only.

## After step 8: product and polish

- [x] Creator payouts (PayPal Payouts) after capture; failure never undoes the capture; retry
- [x] Every offer checked against every rule (verification matrix); price-only comparison
- [x] Licence Passport, browser verification, optional server signature, `/verify`, QR code
- [x] Offline payment simulator, labelled everywhere; `npm run demo` for a zero-setup run
- [x] Persistence of runs; run ownership (anonymous cookie); portfolio across runs in AG Studio
- [x] Plain-English brief reader and grounded run Q&A with offline fallbacks
- [x] Four scenarios (documentary, game trailer, podcast network, and an exclusive theme tune that has no compliant bundle) replayed from recorded model output
- [x] Front-end redesign: home, run theatre (rights graph, replay, matrix, evidence viewer), settlement, passport, verify, simulator checkout
- [x] End-to-end browser tests (30, including axe accessibility scans) and API-level tests; model calls paced to the free model's rate limit
- [x] README with local-run steps, `.env.example`, demo script and submission text drafts
- [x] Requirement costs, gap requests and an "if every licensor said yes" outlook; what-if panel (controls or a typed sentence); negotiation loop (a licensor's revised licence is checked as a new run, linked in the ledger and shown on the passport)
- [x] Licence end dates with a calendar download; accessibility scans in light and dark; OpenAPI document, PayPal webhooks, custom AG Studio widget, MCP tools
- [ ] Deployment (deferred by the owner): home Ubuntu server with Tailscale Funnel, see `docs/DEPLOY.md`
- [ ] Request the AG Studio trial licence key (info@ag-grid.com) to remove the dashboard watermark
- [ ] Create US Sandbox personal accounts for the demo creators (`LICENSEGRAPH_CREATOR_EMAILS`) so payouts show SUCCESS on camera
- [ ] One run on the real PayPal Sandbox with the new payout flow (needs the buyer's approval in a browser)
- [ ] Record the demo video (see `docs/DEMO_SCRIPT.md`), publish it on YouTube, fill in the Devpost form
- [ ] Make a final check of the official Rules page (eligibility, team size, IP terms, AI disclosure wording)

## Open questions

- Official rules and sponsor brief were reviewed on 28 October 2026; see `docs/HACKATHON.md`. Each participant must verify their own eligibility. The FAQ states no maximum team size; the rules limit prize stacking.
