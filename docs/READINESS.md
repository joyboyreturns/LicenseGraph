# Feature verification and submission readiness

Checked on 29 October 2026 against the working tree based on revision `9343221`, including the custom-widget correction delivered with this report. This report separates repeatable offline verification from provider checks and release work. Passing tests demonstrate the cases below; they do not establish that licence interpretations are legally correct or guarantee a competition result.

## Current verification evidence

| Check | Result and scope |
| --- | --- |
| Public source repository | Repository metadata confirms `PUBLIC` visibility at `https://github.com/joyboyreturns/LicenseGraph`. |
| Dependency installation | `npm install --no-audit --no-fund` passed; lockfile unchanged. |
| Unit, property and API suite | `npm test`: 762 passed, 27 credential-dependent tests skipped. |
| Type checking | `npm run typecheck` passed. |
| Production build | `node scripts/demo.mjs --build --build-only` passed. |
| Complete browser suite | `npx playwright test`: 65 passed across the normal, payout-failure and refund test servers. The production build includes the custom-widget correction described below. |
| Published CI | [The workflow for the audited application revision](https://github.com/joyboyreturns/LicenseGraph/actions/runs/40808455304) passed, including a fresh production build and the full offline browser suite. |
| Dependency registry audit | Zero known vulnerabilities reported by `npm audit` on this date. This is a point-in-time registry result. |
| Real Sandbox order API | `npm run test:live`: 3 passed. Covers order creation, a repeated idempotency key, and an itemised order through the verified/approved checkout gate. No buyer approval or capture is performed by these tests. |
| Live model pricing | The configured model was listed with zero input and output prices before testing. The existing free-model guard remained enabled for each client. |
| Live proposal | `npm run test:proposer`: 1 passed, one completion request. Checks that the proposal names existing offer ids; the rules engine remains responsible for accepting or rejecting a proposal. |
| Live extraction sample | `LIVE_ATTEMPTS=1 npm run test:gateway -- -t "extracts 'song' with verified evidence"`: 1 passed, 22 unselected fixtures skipped. One attempt; price, stated terms and located evidence matched the fixture. |
| Broader live extraction check | `LIVE_ATTEMPTS=1 npm run test:gateway -- --bail 1`: 16 fixtures passed, then `pod-art-editorial` timed out at the configured 100-second deadline; 6 fixtures were not attempted because the run stopped on that failure. The run took about 15 minutes. No automatic retries were enabled. Full live-catalogue reliability is not established; retain this failure in the submission evidence. |

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
| Dashboards and assistant, `/dashboard` | Four custom widgets: rule matrix, licence timeline, money flow and deal ladder; linked data; validated assistant tools and model adapter; saved layout/reset; automatic snapshot refresh. The live assistant's rendered response still needs a recorded check for the final deployment. | `tests/dashboard.test.ts`, `tests/widget-tools.test.ts`, `tests/llm-adapter.test.ts`, `tests/llm-proxy.test.ts`, `tests/saved-state.test.ts`, `tests/dashboard-live.test.ts`, `tests/e2e/rule-matrix.spec.ts`, `tests/e2e/brief-and-pages.spec.ts` |
| Mobile, accessibility and error pages | No horizontal overflow in tested phone views; automated accessibility checks in light/dark mode and interactive states; unknown run/page handling; security headers; share previews and web manifest. Automated scans cover only part of accessibility. | `tests/e2e/accessibility.spec.ts`, `tests/e2e/brief-and-pages.spec.ts` |

## Release checks still requiring evidence

The implemented offline journeys pass. The following are not satisfied by those tests and remain open before the final submission:

- [ ] Choose the final judging address or verify the clean local setup on another machine. Deployment was previously deferred by the owner; this audit does not publish infrastructure.
- [ ] Record a buyer approving an order from the current application on PayPal Sandbox; verify capture and each creator's individual SUCCESS receipt. The earlier capture milestone is recorded in `docs/PLAN.md`, but is not a new end-to-end check of the updated payout flow.
- [ ] Register the deployed Sandbox webhook and verify a genuine provider delivery, including the return-page-independent capture path.
- [ ] Obtain/set the dashboard trial key before the production build, and verify its validity through judging. A key was not configured in this checkout during the audit.
- [ ] Record extraction, proposal and a rendered dashboard-assistant response with the actual free model configured for the submission. The current live checks are small samples; record slow calls accurately rather than presenting a replay as a live request.
- [ ] Fill the hosted address, required public video link, model disclosure and judging credentials/instructions in `docs/DEVPOST.md`; check eligibility and ownership of the submitted assets.
- [ ] Publish the complete video under three minutes, submit the form, and test its links from a signed-out browser. Keep judging access available through the published judging period.

## Focus for the submission

The [official criteria](https://paypalaihackathon.devpost.com/rules) weight implementation, design, impact, innovation and presentation equally. The [dashboard sponsor brief](https://paypalaihackathon.devpost.com/details/aggrid) calls for custom widgets, theming, layout tools and agent integration. Show the implemented evidence for these; adding another feature is not a substitute for a clear demonstration.

Lead with one audience and one job: an indie studio buying the rights for a game trailer. Show a cheap but unusable bundle, the source quote explaining why, the independently computed compliant minimum, human approval, buyer checkout, creator receipts and a passport that detects tampering. Use the dashboard to answer a concrete question about that purchase. Keep additional scenarios available for exploration after the main story.

User impact is still a hypothesis. Ask intended users whether the source review and payment record would fit their workflow; report feedback only when it exists. Do not describe fixture totals as proven customer savings or claim the system has validated legal ownership.

## Practical limits

This is a single-process Sandbox prototype, with filesystem persistence and anonymous browser ownership. Multi-process transaction coordination, durable financial reconciliation, verified licensor onboarding, licence authenticity, legal interpretation validation, scanned-PDF OCR, currency conversion and disputes need further work before production use. A mandate is advisory, signatures require the signing secret, and a quote's presence does not validate its interpretation. Anyone with a run or passport link can read its published documents.
