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
  6. PAY       PayPal Sandbox: create order, approve, capture
        |
        v
  7. LEDGER    every step recorded; AG Grid dashboard reads it
```

The visible propose, verify, reject, revise cycle is the product. The model never makes the final legal call.

## Trust boundaries

| Component | May do | May not do |
|---|---|---|
| Agent (via Vercel AI Gateway) | Extract terms, propose bundles, revise after violations | Verify its own work, create orders, see payment credentials |
| Rules engine (`src/core`) | Decide `ok` or list violations; pure and deterministic | Call a model, touch the network or disk |
| Approval gate | Release a verified bundle for payment | Be skipped; the payment module requires a `Verdict.ok` plus an approval record |
| Payment module (`src/payments`) | Create and capture Sandbox orders for an approved bundle | Run on an unverified or unapproved bundle |

## Modules

| Path | Responsibility | Build step |
|---|---|---|
| `src/core/types.ts` | Domain types: `Project`, `LicenseOffer`, `Evidence`, `Bundle`, `Verdict` | done |
| `src/core/rules.ts` | `verifyBundle`: coverage, duplicates, commercial use, territory, term and fixed end date, medium, attribution, sublicensing, exclusivity, offer expiry, currency, evidence, budget | done (v2) |
| `src/extraction/` | `extract.ts`: licence text to `LicenseOffer` with verified evidence spans. `model.ts`: gateway client, free models only | done (v1) |
| `src/agent/` | `loop.ts`: propose-verify-revise loop with round cap and stall detection. `llm.ts`: model proposer. `greedy.ts`: deterministic stand-in | done |
| `src/payments/` | `paypal.ts`: Orders v2 client (Sandbox only). `checkout.ts`: `startCheckout` gate (re-verify + approval digest match) | done |
| `src/ledger/` | Hash-chained append-only event log: proposals, violations, approvals, payments | done |
| `src/app-logic/` | `session.ts`: the flow and its step order (extract, propose, verify, approve, pay, capture); the only thing the web layer calls | done |
| `src/server/` | Runtime wiring (demo or live, PayPal on or off) and HTTP helpers | done |
| `app/` | Next.js UI and API routes: project and documents, loop timeline, approval, payment, ledger | done |
| `src/dashboard/` | `data.ts`: a run as four linked tables. `widget-tools.ts`: validated chart, table and KPI builders. `llm-adapter.ts`: AG Studio assistant to chat completions. `schema-text.ts` | done |
| `src/server/llm-proxy.ts` | Server-side model access for the assistant: fixed free model, free check, pacing, limits | done |
| `app/dashboard/` | AG Studio dashboard (rights graph, ledger) with the AI assistant | done |

## Data model (v1)

- `Project`: commercial flag, territories, term in months, optional budget.
- `LicenseOffer`: asset, price in integer cents, currency, `LicenseTerms` (core terms plus optional media, attribution, sublicensing, exclusivity, fixed end date, offer validity), and `Evidence[]` (document id, field, quote, offsets).
- Verification policy: a project constraint is checked only if declared, and the offer must then affirmatively meet it; silence fails.
- `Bundle`: one offer per required asset.
- `Verdict`: `ok`, total, and `Violation[]` each tagged with a `RuleId`.
- Ledger event: `{ id, at, kind, payload }` where kind is one of `extracted`, `proposed`, `rejected`, `revised`, `verified`, `proposal_error`, `approved`, `order_created`, `captured`. Each event carries the hash of the previous one, so edits, removals and reordering are detectable.

## Key decisions

- **TypeScript end to end** so rules, API and AG Grid dashboard share types.
- **Vercel AI Gateway** for all model calls; model chosen by `LICENSEGRAPH_MODEL`, so there is no provider lock-in and tests use a mock.
- **Integer cents, one currency per bundle** to avoid float and FX bugs.
- **Evidence is mandatory**: an offer without a source quote fails verification.
- **Assistant never holds the key**: the browser calls `/api/llm`; the server picks the model, checks it is free, spaces calls to the provider's limit, and caps request size.
- **Sandbox only**: `PAYPAL_BASE_URL` defaults to the Sandbox host; there is no live path.
- **Agentic Commerce framing**: the agent initiates the purchase; a human approval record is required before capture.

## Testing strategy

- Rules engine: exhaustive unit tests, one per rule plus combinations (`tests/rules.test.ts`).
- Agent: run against a mock model returning canned proposals, including a bad one, to prove the revise loop terminates.
- Payments: Sandbox integration test behind an env flag; unit tests with a mocked HTTP layer.
- End to end: upload fixture licences, run the loop, approve, assert captured order and ledger.

## Out of scope (cut first)

Payouts, PDF ingestion, multi-currency, extra sponsor integrations.
