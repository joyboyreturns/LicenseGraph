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

- [ ] `src/payments/paypal.ts`: OAuth token, create order, capture, `PayPal-Request-Id` idempotency
- [ ] Mocked-HTTP unit tests; flagged live Sandbox test
- Done when: `npm test` covers the client and the live test captures an order.

## Step 3: Data models and extraction (29 Oct-31 Oct)

- [ ] Fixture licence texts (music, image, font, footage) with known terms
- [ ] `src/extraction/`: schema for `LicenseOffer[]` with evidence spans; deterministic checks that each quote really appears in the source
- [ ] Mock-model tests, then gateway-backed run
- Done when: fixtures extract with correct terms and verified quotes.

## Step 4: Rules engine hardening (1-2 Nov)

- [ ] Add rules as needed: exclusivity, medium/format, attribution, sublicensing, expiry date
- [ ] Property-style tests for territory and term edge cases
- Done when: rules tests pass and every rule has a failing and passing case.

## Step 5: Propose-verify-revise loop (3-4 Nov)

- [ ] `src/agent/`: gateway client, propose and revise prompts, JSON schema outputs
- [ ] Loop with iteration cap; violations fed back verbatim
- [ ] `src/ledger/` event log for every step
- Done when: a mock run shows reject then revise then accept, with the ledger recording it.

## Step 6: Approval and checkout (5-6 Nov)

- [ ] Approval record type; payment module refuses without `ok` verdict and approval
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
