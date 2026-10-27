# LicenseGraph step-by-step plan

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

- [x] Fixture licence texts (music, image, font, footage) with known terms and verbatim quotes (`tests/fixtures/licenses.ts`)
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
- [ ] Buyer approval and capture of a Sandbox order created by the app (needs the buyer to approve in PayPal)
- Done when: an end-to-end purchase works in Sandbox.

## Step 7: Light work (7-8 Nov)

- PIVOT submission days. Only fix bugs here.

## Step 8: AG Grid dashboard (9-10 Nov)

- [ ] Rights graph and ledger in AG Grid; AG Studio agent that builds views on request
- Done when: the dashboard shows the live ledger.

## Step 9: Ship (11 Nov)

- [ ] README with demo steps, repo public, Render deploy, demo video, submit
- 12 Nov: buffer only.

## Open questions

- Resolved: Sandbox accounts can be created from India, but they must use country United States.
- Exact requirements for Agentic Commerce and AG Grid prizes.
- Whether Best Overall needs a specific submission format or hosted link.
