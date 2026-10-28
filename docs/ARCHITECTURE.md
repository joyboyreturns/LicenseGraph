# LicenseGraph architecture

> AI moves at machine speed. Creator rights and payments should too.

LicenseGraph helps a project that uses many licensed creative assets (music, images, fonts, footage) buy a compliant licence bundle. An AI agent proposes; a deterministic rules engine verifies; only a verified, human-approved bundle can reach PayPal.

## The core loop

```
upload licence terms + describe project
        |
        v
  1. EXTRACT   agent reads terms, every term links to a quote in the source
        |
        v
  2. PROPOSE   agent picks the cheapest bundle it believes is compliant
        |
        v
  3. VERIFY    rules engine (pure code) checks the bundle against the project
        |  violations?  --yes-->  4. REVISE  (violations fed back to the agent, back to 2, capped)
        | no
        v
  5. APPROVE   human reviews bundle, evidence and total
        |
        v
  6. PAY       PayPal Sandbox (or the offline simulator): create order, buyer approves, capture
        |
        v
  7. SETTLE    PayPal Payouts pays each creator the price of their licence
        |
        v
  8. PASSPORT  a shareable record anyone can re-verify in a browser
                every step above is appended to a hash-chained ledger;
                the AG Studio dashboards read the ledger and the run
```

The visible propose, verify, reject, revise cycle is the product. The model never makes the final legal call.

## Trust boundaries

| Component | May do | May not do |
|---|---|---|
| Agent (via Vercel AI Gateway) | Extract terms, propose bundles, revise after violations | Verify its own work, create orders, see payment credentials |
| Rules engine (`src/core`) | Decide `ok` or list violations; pure and deterministic | Call a model, touch the network or disk |
| Approval gate | Release a verified bundle for payment | Be skipped; the payment module requires a `Verdict.ok` plus an approval record |
| Payment module (`src/payments`) | Create and capture Sandbox orders for an approved bundle; pay creators after capture | Run on an unverified or unapproved bundle; undo a capture because a payout failed |
| Run owner (anonymous cookie) | Approve, pay, retry payouts, list their own runs | (Everyone else can read a run or passport by its link, never change it) |

## Modules

| Path | Responsibility |
|---|---|
| `src/core/types.ts`, `rules.ts` | Domain types and the rules engine: `verifyBundle` (bundle verdict) and `evaluateOffer` (one offer against every rule: pass, fail or skip). Coverage, duplicates, commercial use, territory, term and fixed end date, media, attribution, sublicensing, exclusivity, offer expiry, currency, evidence, budget. |
| `src/core/insights.ts`, `whatif.ts`, `negotiation.ts`, `renewals.ts`, `mandate.ts`, `fine-print.ts` | What each requirement costs; gap requests (the closest offer and what to ask for); the exact what-if on a changed brief; the "if every licensor agreed" outlook with per-asset price ceilings and, for a verified bundle, the saving levers (a cheaper offer a licensor would only have to change terms on) (`concede` edits an offer's terms and the verifier judges the result); licence end dates and the iCalendar file; an agent's stated spending cap checked against the verified total (`mandate_checked` ledger event); the clauses in a licence that the rules engine does not check, found by keyword and quoted beside the Approve button. All pure, browser-safe, and checked against exhaustive search or the verifier in property tests. |
| `src/core/analysis.ts`, `digest.ts` | The price-only comparison (what was blocked, what compliance costs) and the canonical bundle text hashed identically by server and browser. |
| `src/extraction/` | `extract.ts`: licence text to `LicenseOffer` with located evidence. `model.ts`: gateway client with the free-models-only guard and rate-limit pacing. |
| `src/agent/` | `loop.ts`: propose-verify-revise with round cap and stall detection. `llm.ts`: model proposer. `greedy.ts`: deterministic stand-in used for replayed scenarios. |
| `src/ledger/` | `chain.ts`: browser-safe event shape and chain verification. `ledger.ts`: the Node hashing, append-only log, rebuild from stored events. |
| `src/payments/` | `paypal.ts`: Orders v2 and Payouts client (Sandbox host only). `checkout.ts`: `startCheckout` gate (re-verify and approval digest match). `payouts.ts`: who is paid what. `simulator.ts`: an offline stand-in with PayPal's ordering rules. |
| `src/passport/` | Passport builder and `verifyPassport`: nine checks that run in a browser (including that the payment was not reversed). |
| `src/app-logic/` | `session.ts`: the flow and its order of steps (extract, propose, verify, approve, pay, capture, settle). Licences are read three at a time and recorded in order; a run ends at once when the exact cost check proves no bundle can exist. `revision.ts`: a licensor's revised licence becomes a new run linked to the one it answers (the first ledger event, `answers_run`). `persistence.ts`: one JSON file per run, ledger chain re-checked on load. |
| `src/server/` | Runtime wiring (demo or live; PayPal, simulator or none), owner cookies, the assistant's model proxy, rate limiters, passport signing. |
| `src/intake/` | The plain-English brief reader and grounded run Q&A, each with an offline fallback. |
| `src/demo/` | Built-in scenarios and the recorded model output they replay. |
| `src/ui/`, `app/` | The Next.js front end: home, run theatre (rights graph, replay, matrix, evidence, settlement), passport, verify, simulator checkout. Pure UI logic is unit-tested in `tests/ui`. |
| `src/dashboard/`, `app/dashboard/` | AG Studio dashboards: a single run, and the cross-run portfolio, with three custom widgets (rule matrix, licence timeline, money flow) whose layout code is pure and tested. Validated chart, table, KPI, timeline and money-flow tools for the assistant. |
| `src/mcp/`, `scripts/mcp-server.ts` | The MCP server: tools (`check_licence_bundle`, `cheapest_compliant_bundle`, `what_if_brief`, `licence_end_dates`, `start_licence_purchase`, `get_purchase_status`) and the `buy_licences` prompt, built once in `server.ts` and served over stdio and, statelessly, over HTTP at `/api/mcp`. |
| `app/api/` | HTTP routes: sessions (including `revise`), payments, passports (and their badge), scenarios, intake, portfolio, assistant proxy, simulator, PayPal webhooks, MCP, health, and the generated OpenAPI document. |

## Data model

- `Project`: commercial flag, territories, term in months, optional budget.
- `LicenseOffer`: asset, price in integer cents, currency, `LicenseTerms` (core terms plus optional media, attribution, sublicensing, exclusivity, fixed end date, offer validity), and `Evidence[]` (document id, field, quote, offsets).
- Verification policy: a project constraint is checked only if declared, and the offer must then affirmatively meet it; silence fails.
- `Bundle`: one offer per required asset.
- `Verdict`: `ok`, total, and `Violation[]` each tagged with a `RuleId`.
- Ledger event: `{ seq, at, kind, payload, prevHash, hash }` where kind is one of `extracted`, `extraction_failed`, `proposed`, `rejected`, `revised`, `verified`, `proposal_error`, `approved`, `order_created`, `captured`, `payout_created`, `payout_failed`, `payout_settled`. Each event carries the hash of the previous one, so edits, removals and reordering are detectable. Payee emails are never written to the ledger.
- Licence Passport: project, the licences behind the chosen offers, the bundle with its digest, the approval, the PayPal order and capture ids (labelled `sandbox` or `simulator`), the creator payouts, the price-only comparison, and the ledger. `verifyPassport` re-checks it with no server: ledger chain, bundle digest, approval recorded, terms and evidence match the ledger, every quote found at its offsets, the rules engine re-run on the exact terms, payment matches the total, payouts add up.

## Key decisions

- **TypeScript end to end** so rules, API and AG Grid dashboard share types.
- **Vercel AI Gateway** for all model calls; model chosen by `LICENSEGRAPH_MODEL`, so there is no provider lock-in and tests use a mock.
- **Integer cents, one currency per bundle** to avoid float and FX bugs.
- **Evidence is mandatory**: an offer without a source quote fails verification.
- **Assistant never holds the key**: the browser calls `/api/llm`; the server picks the model, checks it is free, spaces calls to the provider's limit, and caps request size.
- **Sandbox only**: `PAYPAL_BASE_URL` defaults to the Sandbox host and the client refuses any other; there is no live path.
- **Payouts never undo a capture**: a failed payout is recorded, shown, and retryable; the captured payment stands.
- **Replayed scenarios are labelled**: built-in scenarios replay recorded model output through the deterministic baseline proposer so the rejections are visible and repeatable; custom runs use the live model. The UI says which is which.
- **Browser-verifiable by construction**: the rules engine, digest and ledger chain code are pure and Node-free (guarded by a test), so the same code runs on the server and in the passport page.
- **Runs belong to a browser**: an anonymous HttpOnly cookie gates approving, paying and listing. Links stay readable so passports can be shared.
- **Offline payments for reviewers**: the simulator follows PayPal's rules where they matter (no capture before buyer approval, idempotent orders) and is always labelled.
- **Agentic Commerce framing**: the agent initiates the purchase; a human approval record is required before capture.

## Testing strategy

- **Rules engine:** one failing and one passing case per rule, silent-offer behaviour, property tests (fast-check) for territory, term and order independence.
- **Agent:** mock models, including bad ones (invented quotes, unknown offer ids, throwing proposers), prove the loop terminates and the proposer cannot self-certify.
- **Payments:** the approval gate refuses unverified, unapproved and mismatched bundles; payouts, their failure and retry; the Sandbox client with a mocked HTTP layer; flagged live tests against the real Sandbox (`npm run test:live`).
- **Ledger and passport:** tamper tests for a changed price, terms, quote, capture id, payout total and edited ledger events; the browser-bound modules are checked never to import Node code.
- **API:** the real route handlers run end to end (scenario, approval, payment, capture, payouts, passport, ownership, portfolio, Q&A, intake) with PayPal mocked or simulated.
- **Browser:** Playwright journeys against the offline demo: the full purchase through to a verified passport and a tampered copy that fails, all four scenarios (including the one with no bundle), run ownership, the payout failure and retry, the brief wizard, error pages, no horizontal scroll on a phone, and axe-core WCAG 2.1 A/AA scans of the home, verify, verified-run and no-bundle pages in light and dark (`npm run test:e2e`).
- **Free-model checks:** flagged live tests send one request each, only after the free check (`npm run test:gateway`, `npm run test:proposer`).

## Out of scope

PDF ingestion, multi-currency, licensor onboarding and verified payee accounts, refunds and disputes, authentication beyond the anonymous run owner.

## Audit additions

The independent cost frontier (`src/core/optimizer.ts`) computes minimum compliant cost per currency and rechecks each result with the verifier. It assumes the present rules remain independent between assets; coupled discounts or obligations would require a different optimizer.

Payment operations coalesce concurrent requests within one server process. Payout submissions preserve the original identity and recipient plan across retries and restarts; batch status is reconciled per item before settlement. New approval digests include terms and evidence. Historical downloaded passports retain read-only support for the original digest; legacy unpaid approvals require reapproval, and old partial-field signatures must be reissued for full-content authentication. See `docs/AUDIT.md`.
