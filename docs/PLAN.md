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
- [ ] Teach extraction to read the new terms (media, attribution, sublicensing, exclusivity, dates) with evidence; needs new fixtures and a few free-model runs
- Done: 64 unit tests pass; every rule has a failing and passing case.

## Step 5: Propose-verify-revise loop (3-4 Nov)

- [ ] `src/agent/`: gateway client, propose and revise prompts, JSON schema outputs
- [ ] Loop with iteration cap; violations fed back verbatim
- [ ] `src/ledger/` event log for every step
- Done when: a mock run shows reject then revise then accept, with the ledger recording it.

## Step 6: Approval and checkout (5-6 Nov)

- [x] Approval record type; payment module refuses without `ok` verdict and approval (built in step 2)
- [ ] Approval screen that produces the `Approval` record
- [ ] Next.js UI: upload, loop view, approval screen, Sandbox checkout
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
