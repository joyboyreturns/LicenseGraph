# Feature verification and submission readiness

Latest local workbench verification: 2 November 2026. Earlier audit and provider evidence from 29 October 2026, based on revision `c26b30d`, is retained below. This report separates repeatable offline verification from provider checks and release work. Passing tests demonstrate the cases below; they do not establish that licence interpretations are legally correct or guarantee a competition result.

## Private marketplace, 4 November 2026

Scope: signed-in accounts, PostgreSQL storage, reviewed licensors and offers, held creator payouts, disputes, explicit sharing, operations tooling. Everything ran locally against throwaway PostgreSQL, Keycloak and Mailpit containers, the payment simulator and the offline replay. Nothing was deployed or published, and no model or PayPal request was sent.

**Final gate on the working tree (run in sequence):**

| Check | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npx vitest run` | 832 passed, 70 skipped (77 files passed, 6 skipped) |
| `npm run test:database` (isolated, recreated database) | 43 passed |
| `npm run build` | passed |
| `npm run test:marketplace-browser` | 12 passed |
| `npm run test:e2e` (existing offline journeys) | 75 of 76 on the first run; **76 of 76 on the rerun** |
| `npm audit` | 0 vulnerabilities |

The one failure was `tests/e2e/scenarios.spec.ts:107` ("gap panel offers a paste box"), "Response has been disposed": its mocked route awaits a request after the test has ended. That spec was not changed by this work, passed in every other full run, and passed on rerun. It is a race in the test's route handler, not yet fixed. Do not treat it as proof the product is free of intermittent failures.

The 70 skips are 27 live-provider tests that need credentials (not run) and the 43 PostgreSQL tests, which are skipped under plain `npx vitest run` and run by `npm run test:database` (counted separately above).

**Tested, with evidence in the suites:**

- Sign-in: authorization request carries state, nonce and an S256 PKCE challenge; `returnTo` cannot leave the application; forged, missing and replayed callbacks create no session; sign-out revokes the server session; cross-origin sign-out is refused.
- Accounts: registration proves control of the email before a password is set; an unverified account never gets an application session; password recovery replaces and retires the old password; real one-time-code enrolment produces the second-factor claim that staff routes require.
- Access: agent credentials can create catalogue runs and read, and are refused on approval, payment, claim, review, sharing and staff routes; expired, revoked and malformed credentials fail instead of falling back to public data; another account or an anonymous caller gets nothing from any run, passport, badge, QR, operation or listing route, and cannot write to someone else's run; claim works only for a different signed-in person with an unexpired, single-use link.
- Sellers: a changed account email or lost licensor role withdraws approval and ends sessions and agent credentials; offers need a located quotation for every stated term over the real HTTP path; reviews need a reason, which is audited; versions can be created and withdrawn; seller and staff cannot review their own records.
- Money: capture does not pay creators; payouts are held until acceptance or seven days; disputes block unsent payouts; `ORDER_NOT_APPROVED` is a retryable wait, not an unknown capture; a worker whose lease expired mid-call writes nothing and the job goes to reconciliation, and staff reconciliation reads the named existing record without sending again; an unmatched webhook is retained and applied once its purchase exists; a reversal blocks release and sharing and revokes share links.
- Data: legacy import is idempotent and quarantines bad files without touching originals; a backup restores into an empty database with documents, authorizations and ledger chains verified, and detects a changed file, a non-empty target and a tampered authorization; key rotation re-seals mutable records and leaves immutable ones readable with the retained old key; a retired passport key keeps verifying older passports.
- Interface: desktop and phone, light and dark, with automated accessibility scans on the workspace, creator and staff screens.

**Simulated, not provider-verified:** order, capture, payout, refund and webhook behaviour used the payment simulator or fixtures. No genuine PayPal Sandbox delivery, order or payout was exercised in this work. A reconciliation against a real Sandbox record has not been run.

**Not verified:**

- The two new CI jobs (PostgreSQL, and the private browser flows against Keycloak and Mailpit) have not run on GitHub.
- A restore onto a different machine.
- Real email delivery, a managed identity provider, TLS, hosting. Keycloak ran in development mode.
- Multi-instance behaviour under real load; the multi-worker and crash cases are covered by lease and fault-injection tests in one process.
- Legal sufficiency of the identity and rights review. It records a staff decision with evidence and does not certify ownership.
- The staff screen lists operations awaiting reconciliation but not unmatched webhooks; the health endpoint reports their count.
- The new screens have had automated accessibility scans only. No screen-reader pass was done, and keyboard operation and error recovery of the new forms were not separately tested.

## Reliability follow-up, 2 November 2026

Three additional regressions were reproduced against the earlier production build, then fixed:

- A delayed run refresh could replace the UI's newly approved state with an older verified snapshot. Accepting an approval or payment response now aborts superseded reads; aborted reads cannot publish an old state or cancel the new state's polling schedule. The server approval/payment gates are unchanged.
- The offline brief reader treated a trailer **for** a game or app as requiring rights **inside** that product. It now separates explicit promotion phrases from distribution media while retaining separately stated in-game or app use. The custom Neon Drift example selects web, social and broadcast without adding app distribution.
- Custom intake stripped characters from budget and term input and delayed validation until file intake. It now preserves the entered text, validates requirements before the licence step and again on submission, and converts decimal budgets to exact integer cents without rounding. Invalid syntax, fractional/oversized terms and unsafe cent values are refused. Country aliases are normalized consistently, and zero-dollar budget limits remain representable. The use selector supports arrow keys and Home/End; requirements errors receive focus and scroll into view on phones.

Validation: `npm install` passed; `npm test` passed **807 tests** with **27 credential-dependent skips**; `npm run typecheck` and the production build passed. The complete offline browser suite passed **76 tests**. A final production rebuild and focused browser run passed all **3 reliability tests**, including the subsequent phone error-summary focus change and automated accessibility scan. Tests are in `tests/brief.test.ts`, `tests/ui/project-draft.test.ts` and `tests/e2e/reliability.spec.ts`; the browser test confirms that a USD 0.29 budget is submitted as exactly 29 cents and that invalid input stays editable. Intake validation was also inspected at 1440px/390px in light/dark themes without horizontal overflow.

No API contracts, core verifier rules, evidence requirements, model pricing guards or payment boundaries changed. No live model or payment requests were made. The previous workbench commit also passed [GitHub CI](https://github.com/joyboyreturns/LicenseGraph/actions/runs/41450689170); that remote result predates this follow-up.

## Clearance workbench refresh, 2 November 2026

This refresh makes the recorded game trailer the primary judge journey. Home, the run, portfolio/dashboard, custom intake, settlement, checkout and passport now share a teal-and-paper visual system. The run leads with the current decision and project brief, source quotation cards precede approval, and optional exploration follows the purchase decision. Buyer capture and individual creator outcomes remain separate. The passport leads with the purchase, environment and independent content checks.

| Local check | Result and scope |
| --- | --- |
| Dependency installation | `npm install` passed; no dependency changes were needed. |
| Unit, property and API suite | `npm test`: **771 passed**, **27 credential-dependent tests skipped**. Includes the new phone layout regression, proving stacking order and that desktop state is not mutated. |
| Type checking | `npm run typecheck` passed. |
| Production build | `npm run build` passed; subsequent full browser runs rebuilt the production app with `node scripts/demo.mjs --build --build-only`. |
| Browser suite | `npm run test:e2e`: **73 passed** across the normal, payout-failure and refund servers, including the fresh production build and all four new visual journeys. |
| Rendered review | Home, run, custom intake requirements/files, dashboard, checkout, awaiting-buyer settlement, completed settlement and passport reviewed at **1440px and 390px**, in **light and dark** themes. Portfolio was reviewed separately at the same four combinations. Failed settlement also has four screenshot/axe combinations. |
| Keyboard review | Enter opens the source-evidence drawer; Escape closes it and restores focus to the triggering quotation. The approval navigation anchor works by keyboard. Custom widgets expose named, focusable scroll regions. |
| API and trust boundaries | API contracts unchanged. No changes to `src/core`, extraction pricing guards, approval digests or payment gates. Contract, tamper, ownership, failure/retry and refund tests remain in the suite. |
| Account-free judge path | A separate browser walkthrough used the featured home entry, reviewed evidence, explicitly approved the exact $2,170 bundle, approved simulated checkout, observed creator settlement and passed all nine passport checks. No account or credentials were used. |

The screenshot journeys in `tests/e2e/workbench.spec.ts` cover unsupported-file recovery without losing readable text, source quotations from the chosen licences, evidence drawer use, deterministic dashboard widgets, buyer approval, capture, settlement and passport checks. Screenshot files and region coordinates are written to `test-results/workbench-*/`; `tests/e2e/payout-retry.spec.ts` adds failed-settlement views. Representative current screenshots are retained in `docs/images/`.

Visual review found and fixed dark-theme matrix-heading contrast, the default Filters panel obscuring phone charts, the embedded canvas enforcing a 720px desktop minimum, and keyboard access to newly scrollable phone widgets. The phone canvas now fits within the viewport; phone and desktop layouts use separate browser-storage keys. Automated accessibility checks are evidence for the tested states, not a full accessibility certification.

No live model requests, Sandbox transactions, deployment, publication or live payments were made during this refresh. Custom licence extraction and the optional live assistant still require a configured model that passes the existing zero-price guard; scanned-PDF OCR remains unavailable. The local dashboard may retain a vendor trial watermark without an owner-supplied licence. Hosting is deferred; the public URL, final video, submission fields and any desired trial licence remain owner-supplied. Follow `docs/JUDGE.md` for the local demo and recovery paths. Earlier provider evidence below is historical and was not repeated by this refresh.

## Sandbox follow-up, 2 November 2026

A human approved the documentary bundle and the buyer approved its itemised PayPal Sandbox order. PayPal reported a completed USD 329.00 capture; all three creator payout items reported SUCCESS. The issued passport passed all nine server verification checks and its signature was valid. This was a test-money transaction on a local instance; it does not verify a deployed webhook or the future judging environment. A bounded live proposer request and a single-attempt photo extraction also passed after the gateway's free-price check.

## Earlier verification evidence (retained)

| Check | Result and scope |
| --- | --- |
| Public source repository | Repository metadata confirms `PUBLIC` visibility at `https://github.com/joyboyreturns/LicenseGraph`. |
| Dependency installation | `npm install --no-audit --no-fund` passed; lockfile unchanged. |
| Unit, property and API suite | `npm test`: 765 passed, 27 credential-dependent tests skipped. |
| Type checking | `npm run typecheck` passed. |
| Production build | `node scripts/demo.mjs --build --build-only` passed. |
| Complete browser suite | `npx playwright test`: 66 passed across the normal, payout-failure and refund test servers. The production build includes the custom-widget correction described below. |
| Baseline published CI | [The workflow for revision c26b30d](https://github.com/joyboyreturns/LicenseGraph/actions/runs/40853602202) passed, including a fresh production build and the full offline browser suite. |
| Dependency registry audit | Zero known vulnerabilities reported by `npm audit` on this date. This is a point-in-time registry result. |
| Real Sandbox order API | `npm run test:live`: 3 passed. Covers order creation, a repeated idempotency key, and an itemised order through the verified/approved checkout gate. No buyer approval or capture is performed by these tests. |
| Live model pricing | The configured model was listed with zero input and output prices before testing. The existing free-model guard remained enabled for each client. |
| Live proposal | `npm run test:proposer`: 1 passed, one completion request. Checks that the proposal names existing offer ids; the rules engine remains responsible for accepting or rejecting a proposal. |
| Live extraction sample | `LIVE_ATTEMPTS=1 npm run test:gateway -- -t "extracts 'song' with verified evidence"`: 1 passed, 22 unselected fixtures skipped. One attempt; price, stated terms and located evidence matched the fixture. |
| Broader live extraction check | `LIVE_ATTEMPTS=1 npm run test:gateway -- --bail 1`: 16 fixtures passed, then `pod-art-editorial` timed out at the configured 100-second deadline; 6 fixtures were not attempted because the run stopped on that failure. The run took about 15 minutes. No automatic retries were enabled. Full live-catalogue reliability is not established; retain this failure in the submission evidence. |

## Assistant follow-up verification

A local browser check, explicitly approved by the owner, sent only the public dashboard schema/tool definitions and a synthetic KPI prompt to the configured free model. It used two model calls: `create_kpi`, followed by a text confirmation. The KPI rendered and its layout was saved. Payments were disabled, run storage was isolated, and the request was capped at two calls. Payload inspection found no configured credentials or creator emails. This verifies the local integration, not the future deployed assistant or arbitrary user requests.

Two further corrections came from that inspection:

- The dashboard proxy now applies `LICENSEGRAPH_MODEL_TIMEOUT_MS` (100 seconds by default) to both the request and response-body read. A stalled call returns HTTP 504 with an explanation, and later requests can recover. The published OpenAPI document describes this response and the proxy's other guarded failures. Unit tests cover both stalls and recovery.
- Assistant instructions use canonical field IDs such as `assets.chosenPrice` from schema metadata. Decorated Studio references could repeat the table name and disagree with the tool's accepted IDs. Unit and browser assertions cover the actual instruction payload.

The new offline browser regression exercises the real assistant, adapter and widget tool with intercepted model responses. It verifies the tool-result round trip, canonical IDs, widget rendering and persistence after reload without a gateway key.

## Correction found during this audit

A dashboard could refresh its built-in tables while its custom money flow, licence timeline or deal ladder stayed empty. Returning no DOM node prevented the widget mount from completing, so it could miss later data changes. All four custom widgets now retain a node while empty and query again for refreshed component parameters, including filter changes. A new browser regression test opens the dashboard before payment, settles a purchase and creates a changed brief, then checks that its money flow, licence timeline and deal ladder update without a reload.

## Feature-to-evidence map

All paths below are relative to the repository root. Browser tests use recorded extraction output and the labelled offline payment simulator unless explicitly identified as a provider check above.

| Feature and where to try it | What is verified | Evidence |
| --- | --- | --- |
| Plain-English brief and custom licence intake, home page | The brief exposes assumptions; typed constraints and uploaded PDF text reach the form; scanned PDFs are rejected; live-model requirements are explained in offline mode. | `tests/brief.test.ts`, `tests/pdf-text.test.ts`, `tests/e2e/brief-and-pages.spec.ts`, `tests/e2e/pdf-licence.spec.ts` |
| Extraction with source evidence | Schema validation, quote location, absent terms, malformed replies, targeted follow-up requests, timeout/error handling and the free-price guard. Sixteen fixtures passed in the bounded live catalogue check before a provider timeout stopped it. | `tests/extraction.test.ts`, `tests/json-reply.test.ts`, `tests/extraction.live.test.ts` |
| Propose, reject, revise, terminate, run page | Unknown offers are not trusted; the verifier decides; repeated proposals stall; the loop has a round cap; scenario replays visibly distinguish recorded output from live work. | `tests/loop.test.ts`, `tests/llm-proposer.test.ts`, `tests/e2e/scenarios.spec.ts` |
| Rules and per-offer matrix, `/rules` and run page | Commercial use, territory, dates, duration, media, credit, sublicensing, exclusivity, evidence, currency, amount, coverage and budget. Silence fails declared requirements. | `tests/rules.test.ts`, `tests/rules.extended.test.ts`, `tests/rules.properties.test.ts`, `tests/e2e/scenarios.spec.ts` |
| Independent minimum and requirement costs | Exact minimum under the implemented independent rules; separate currency frontiers; budget gaps; requirement costs compared with exhaustive enumeration. | `tests/optimizer.test.ts`, `tests/insights.test.ts`, `tests/e2e/insights-and-handoff.spec.ts` |
| What-if, saving levers, negotiation and changed briefs | Instant re-pricing; validated shareable URL state; requests to licensors; revised terms and changed briefs become new linked runs; before/after comparisons and deal history. | `tests/whatif.test.ts`, `tests/negotiation.test.ts`, `tests/revision.test.ts`, `tests/compare.test.ts`, `tests/deal-history.test.ts`, `tests/e2e/what-if.spec.ts`, `tests/e2e/scenarios.spec.ts` |
| Human source review and spending mandates | Fine-print quotes, recipient preview, total/per-licence caps and excluded licensors are surfaced before approval. A mandate never substitutes for approval. | `tests/fine-print.test.ts`, `tests/mandate.test.ts`, `tests/e2e/insights-and-handoff.spec.ts` |
| Approval and Orders checkout | Approval binds the exact terms, evidence and prices; checkout re-verifies; owner checks apply; captured amount, currency and order must match. Concurrent operations coalesce. | `tests/checkout.test.ts`, `tests/capture-and-eviction.test.ts`, `tests/integrity.test.ts`, `tests/e2e/journey.spec.ts`; real order API checks above |
| Creator payouts and retry | Payment stays captured on payout failure; immutable recipients and batch identity; uncertain results are reconciled; each recipient must succeed before settlement. | `tests/payouts.test.ts`, `tests/session.test.ts`, `tests/paypal.test.ts`, `tests/e2e/payout-retry.spec.ts` |
| Owner-requested refund after failed settlement | Full refund only when nobody could have been paid; ambiguous submissions and settled payouts block it; refund is recorded and a refunded run has no passport. | `tests/refund.test.ts`, `tests/e2e/refund.spec.ts` |
| PayPal webhooks | Provider signature verification, idempotent capture, digest matching, payout refresh and external reversal handling. Live webhook delivery has not been tested in this audit. | `tests/webhook.test.ts` |
| Passport, `/verify`, creator receipts and exports | Nine content checks, tamper detection, optional issuer signature, published public key, CSV formula escaping, calendar end dates/reminders, QR code, status badge and printable creator receipts. | `tests/passport.test.ts`, `tests/signature.test.ts`, `tests/passport-csv.test.ts`, `tests/renewals.test.ts`, `tests/badge.test.ts`, `tests/e2e/journey.spec.ts`, `tests/e2e/brief-and-pages.spec.ts` |
| Terminal passport verification | Downloaded passports verify without a running server; changed content fails; optional pinned issuer public key. | `tests/verify-passport-cli.test.ts`, `tests/e2e/mcp-http.spec.ts` |
| Persistent runs and ownership | Hash-chain validation on reload; interrupted runs fail honestly; only the creating/claiming browser can mutate or list its runs; shared links remain readable. | `tests/persistence.test.ts`, `tests/owner.test.ts`, `tests/handoff.test.ts`, `tests/e2e/ownership.spec.ts`, `tests/e2e/insights-and-handoff.spec.ts` |
| Run questions and local fallback | Replies are grounded in the recorded run, referenced offers are checked, deterministic fallback remains available. | `tests/explain.test.ts`, `tests/e2e/accessibility.spec.ts` |
| Agent tools, prompts, resources and discovery, `/agents` | Ten MCP tools; purchase and negotiation prompts; rules and paid-passport resources; stdio/HTTP transport; generated discovery lists; one-time claim handoff without agent approval/payment. | `tests/mcp.test.ts`, `tests/mcp-http.test.ts`, `tests/discovery.test.ts`, `tests/e2e/agents.spec.ts`, `tests/e2e/mcp-http.spec.ts` |
| OpenAPI and bounded request validation | The checked-in API document matches the generated schemas; malformed/oversized input is refused; the published document points to its own server. | `tests/openapi.test.ts`, `tests/api.test.ts`, `tests/e2e/openapi.spec.ts` |
| Dashboards and assistant, `/dashboard` | Four custom widgets: rule matrix, licence timeline, money flow and deal ladder; linked data; validated assistant tools and model adapter; saved layout/reset; automatic snapshot refresh. The local live assistant rendered and saved a KPI in two approved free-model calls; the final deployment still needs its recorded check. | `tests/dashboard.test.ts`, `tests/widget-tools.test.ts`, `tests/llm-adapter.test.ts`, `tests/llm-proxy.test.ts`, `tests/schema-text.test.ts`, `tests/e2e/dashboard-assistant.spec.ts`, `tests/saved-state.test.ts`, `tests/dashboard-live.test.ts`, `tests/e2e/rule-matrix.spec.ts`, `tests/e2e/brief-and-pages.spec.ts` |
| Mobile, accessibility and error pages | No horizontal overflow in tested phone views; automated accessibility checks in light/dark mode and interactive states; unknown run/page handling; security headers; share previews and web manifest. Automated scans cover only part of accessibility. | `tests/e2e/accessibility.spec.ts`, `tests/e2e/brief-and-pages.spec.ts` |

## Release checks still requiring evidence

The implemented offline journeys pass. The following are not satisfied by those tests and remain open before the final submission:

- [x] Hosting choice confirmed by the owner: home Ubuntu server with Tailscale Funnel.
- [ ] Deploy and verify the final judging address after 5 November 2026, as requested by the owner. This audit does not publish infrastructure.
- [x] Complete a local buyer-approved PayPal Sandbox purchase and verify capture and each creator payout status (2 November; see follow-up above). Record a separate video if needed for the submission.
- [ ] Register the deployed Sandbox webhook and verify a genuine provider delivery, including the return-page-independent capture path.
- [ ] Obtain/set the dashboard trial key before the production build, and verify its validity through judging. A key was not configured in this checkout during the audit.
- [x] Verify a locally rendered dashboard-assistant response using the approved fixture-only payload and configured free model (two calls).
- [ ] Record extraction, proposal and a rendered dashboard-assistant response on the final judging deployment with the actual free model configured for the submission. The current live checks are small samples; record slow calls accurately rather than presenting a replay as a live request.
- [ ] Fill the hosted address, required public video link, model disclosure and judging credentials/instructions in `docs/DEVPOST.md`; check eligibility and ownership of the submitted assets.
- [ ] Publish the complete video under three minutes, submit the form, and test its links from a signed-out browser. Keep judging access available through the published judging period.

## Focus for the submission

The [official criteria](https://paypalaihackathon.devpost.com/rules) weight implementation, design, impact, innovation and presentation equally. The [dashboard sponsor brief](https://paypalaihackathon.devpost.com/details/aggrid) calls for custom widgets, theming, layout tools and agent integration. Show the implemented evidence for these; adding another feature is not a substitute for a clear demonstration.

Lead with one audience and one job: an indie studio buying the rights for a game trailer. Show a cheap but unusable bundle, the source quote explaining why, the independently computed compliant minimum, human approval, buyer checkout, creator receipts and a passport that detects tampering. Use the dashboard to answer a concrete question about that purchase. Keep additional scenarios available for exploration after the main story.

User impact is still a hypothesis. Ask intended users whether the source review and payment record would fit their workflow; report feedback only when it exists. Do not describe fixture totals as proven customer savings or claim the system has validated legal ownership.

## Practical limits

The default offline mode is a single-process Sandbox prototype with filesystem persistence and anonymous browser ownership. The optional private workspace adds PostgreSQL transactions, leased jobs and accounts, as described above and in `docs/OPERATIONS.md`. Multi-process transaction coordination, durable financial reconciliation, verified licensor onboarding, licence authenticity, legal interpretation validation, scanned-PDF OCR, currency conversion and disputes need further work before production use. A mandate is advisory, signatures require the signing secret, and a quote's presence does not validate its interpretation. Anyone with a run or passport link can read its published documents.
