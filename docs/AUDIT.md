# Correctness and readiness audit

This records the earlier correctness audit. See [the current readiness report](READINESS.md) for the 29 October 2026 full-suite results, limited live provider checks and outstanding release evidence.

Baseline: repository revision `141ad0d`, 364 passing unit/API tests, 24 credential-dependent tests skipped. No real-money operations or model requests were made during the audit.

## Corrected behaviour

| Area | Finding and change |
| --- | --- |
| Concurrent payments | Overlapping order, capture and payout requests could duplicate ledger transitions or submissions. Requests now share one pending operation per session and operation type. |
| Idempotency | Order and capture keys exceeded PayPal's recommended 38-character bound. Keys are now short hashes scoped to operation and purchase. |
| Payout retry | A fresh retry id could duplicate a batch after a lost response. Retries preserve the original identity and recipients, survive restart, and recover a duplicate batch through a validated Sandbox link. An attempt is saved before network I/O. Automatic retry is refused after 29 days; reconcile with PayPal before any later transfer. |
| Capture | Pending or mismatched captures could be treated as paid. The client requires completed capture status; the session also checks order id, currency, amount and capture id before paying creators. |
| Settlement | Batch SUCCESS was treated as proof every creator was paid. Per-item results now govern completion; unclaimed payments remain pending, partial failures require reconciliation. Missing recipients block the entire payout plan. |
| Approval | The digest omitted terms and evidence. New approvals bind the full canonical offer. Unpaid legacy approvals require reapproval; historical downloaded passports retain read-only digest compatibility. |
| Passport | Signatures covered only a few identifiers. New signatures cover the whole passport. Verification also binds payment currency/order and individual payout allocations to ledger records. Old partial-field server signatures require reissue; they are not accepted as full-content signatures. |
| Dates | Impossible calendar dates were accepted, and fixed-end licences could bypass duration checks when the project supplied months alone. Dates are validated; duration checks derive the end date from the purchase date with calendar-month clamping. |
| Money and coverage | Negative, fractional, unsafe or overflowing cents, malformed budgets, duplicate ids and unrequested assets now fail verification. Unsupported minor-unit currencies are refused; a USD budget cannot silently be compared with EUR prices. Explicit end dates and month durations must both be satisfied. |
| API | Coercions such as a string `"false"` becoming commercial use were accepted; malformed arrays could produce server errors. A strict bounded schema validates run input. Session creation snapshots caller input. |
| Ownership | The return redirect could bypass capture ownership. It now checks the creating browser, like the other payment routes. |
| Agent failure | A stalled proposal was incorrectly presented as proof that no valid bundle existed. The independent cost check now distinguishes these cases. |
| Extraction | The prompt said not to guess but requested a best reading for absent core terms. Missing core terms now require rejection; the UI explicitly asks the approver to check the model's interpretation. Quote presence is not semantic validation. |
| Browser test reliability | A label locator could match Next.js's hidden streaming copy. The test now locates the visible accessible textbox and checks browser errors. |
| Build freshness | Browser tests could reuse a stale production build. The standard browser command now rebuilds first. |

PayPal semantics were checked against the official [idempotency reference](https://developer.paypal.com/api/rest/reference/idempotency/) and [payout creation reference](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-post). Provider idempotency retention is finite; no unlimited exactly-once guarantee is claimed. Provider errors expose only status/error codes so echoed recipient details do not leak into public ledger messages.

The supported minor-unit policy follows PayPal's [currency reference](https://developer.paypal.com/api/codes/currency): JPY, HUF and TWD do not support decimal amounts and are refused by this cents-based prototype.

## Added capability

`src/core/optimizer.ts` computes the exact minimum compliant cost per currency for the current independent-per-offer rule system. It never mixes currencies or relaxes rights requirements. The run page exposes the minimum, budget shortfall and whether the agent found the optimum. Property tests compare it with exhaustive enumeration across 250 generated catalogues.

## Security dependencies

The initial registry audit reported nine affected package entries, including development tooling and validation/CSS dependencies. The test runner, its build dependency and the validation library were upgraded; the CSS processor is overridden to a patched release. Node 20.19+ is now required. A normal clean lockfile installation was verified.

## Validation and limits

Final command results are recorded in `docs/HANDOFF.md`: 436 unit/property/API tests and 12 browser journeys passed; typecheck and production build passed; the final dependency audit reported zero known vulnerabilities. Run `npm ci`, `npm test`, `npm run test:e2e`, then `npm run typecheck` sequentially. The build regenerates `.next/types`, so a concurrent standalone typecheck can race with it.

This remains a single-process Sandbox prototype. Session locks do not coordinate multiple workers; use one server process. The filesystem is trusted and persistence remains best-effort, so durable transaction reconciliation needs a database before production use. Uploaded licences and public passports are readable by anyone with their links. Verified licensor onboarding, legal interpretation validation and disputes remain outside the implemented scope. Text-based PDF ingestion and captured-payment refunds have since been implemented; scanned-PDF OCR remains outside scope. Live Sandbox and live-model tests require owner credentials and remain unverified in this checkout.

## Private marketplace review, 4 November 2026

Defects found by running the private browser suite and the new integration tests for the first time, then fixed with a test each:

- The database test script wrote its throwaway-key fixtures into the live application database. It now recreates an isolated database on every run.
- One record sealed with an unavailable key made the whole catalogue and the staff queue return 503; one unreadable queued job could block every worker. Both now leave the bad record out or fail it visibly and report a count.
- A presented bearer credential that did not resolve fell through to the public handlers. It now fails with 401.
- Agent read scope matched any path under `/api/sessions/` and `/api/passports/`. It now matches only the run and passport read routes.
- Claim errors returned 503; they now return 409. Provider and client errors during sign-in returned 503; they now return 401, while an unreachable provider stays 503.
- A changed email or withdrawn licensor role left seller approval, sessions and agent credentials in place.
- A capture refused with `ORDER_NOT_APPROVED` was recorded as an unknown capture needing staff reconciliation.
- A webhook that arrived before its purchase was marked processed and lost.
- Form fields took their accessible name from their pre-filled value, so a filled evidence box could not be found by label.
- The private header said "Replayed demo" and "Payments off" on a signed-in workspace.

Remaining limits: see "Not verified" in `docs/READINESS.md`. Dependency audit: 0 known vulnerabilities on 4 November 2026.
