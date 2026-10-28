# Devpost submission text (draft)

Copy each section into the Devpost form. Items in `<<double angle brackets>>` need a decision or a value from you.

## Project name
LicenseGraph

## Tagline
AI moves at machine speed. Creator rights and payments should too.

## Links
- Hosted demo: `<<public URL, once deployed>>`
- Source code (MIT): https://github.com/joyboyreturns/LicenseGraph
- Demo video (YouTube, public, under 3 minutes): `<<link, if you record one>>`

## Inspiration
Anyone who ships creative work (a game trailer, a podcast, a promo film) ends up with a pile of licences: a song that is "worldwide" but only for web, an image that is "editorial only", a sound pack whose sale ended last month. Reading them all is slow, mistakes are expensive, and the creators who made the work are paid late. AI can read licences at machine speed, but nobody should let a model make an unchecked legal call or spend money on its own. We wanted a system where the AI does the reading and the proposing, code does the deciding, a human does the approving, and PayPal moves the money to the people who made the work.

## What it does
You describe a project in plain English (or pick a scenario) and give it your licences, pasted or loaded from a PDF (read in your browser, never uploaded). LicenseGraph then:

1. **Reads** every licence. An AI model extracts the terms (price, commercial use, territory, term, media, credit, sublicensing, exclusivity, dates), and every term is linked to the exact sentence it came from. Quotes the model invents are rejected by code.
2. **Proposes** the cheapest bundle that it believes is compliant.
3. **Verifies** the proposal with a deterministic rules engine (plain code, no AI). Every offer is checked against every rule; a licence that is silent on something the project requires fails. Rejections go back to the agent, which revises and tries again. You watch this loop happen: propose, verify, reject, revise.
4. **Independently checks cost:** code computes the exact minimum compliant cost per currency, tells you whether the agent found it, and reports any budget shortfall without relaxing a rights requirement.
5. **Approves**: a human signs off on exactly the verified bundle. Nothing can be paid for anything else. Beside the Approve button, who will be paid what (each creator's address masked) and any clause the rules engine does not check (a licence that can be ended early, a ban on training AI, limits on resale) is quoted word for word, so "verified" is never mistaken for "nothing else to read".
6. **Settles with PayPal**: the order is created and captured through the PayPal Orders API, then the **creators are paid automatically** through PayPal Payouts, one line per licensor. If no creator could be paid, the buyer is refunded in full.
7. **Issues a Licence Passport**: a shareable, printable, QR-coded record that anyone can re-verify in their own browser. The browser recomputes the hash-chained ledger, re-runs the rules engine on the exact terms, checks that every quote appears where it claims in the licence text, matches the PayPal capture and payout records, and confirms the payment was not later reversed. The same checks run from a terminal with `npm run verify:passport`, which exits non-zero if anything was changed.

And it goes past "pick a bundle":
- **What each requirement costs.** Each requirement of your brief is dropped one at a time and the exact cost re-computed, so you see that "commercial use" adds $35, or that the territory costs you nothing.
- **What to ask for, and what a yes would cost.** When no licence for an asset fits, it names the closest one, the exact terms to change, and drafts the message to the licensor (copy it, or open it in your email). It also prices the best case, "if every licensor said yes at the prices they quoted", and how far each asset could rise before the budget breaks. When a licensor replies, their revised licence is checked as a new run linked to the first; the failed run is never edited, and the passport shows what each ask did to the price.
- **Where you could pay less.** For a verified bundle, the cheaper offers that fail only on terms their licensor could change (a non-commercial image, a credit requirement) are listed with the exact saving if they agreed at the price they quoted, what to ask, and a drafted message. Each lever is checked by the rules engine on the changed terms; it is a best case, never an offer.
- **A receipt for each creator.** Every licence in a passport links to a printable receipt: what that creator was paid, the terms it was bought on, when it ends, and the sentences those terms come from, with a link back to verify the whole passport.
- **When each licence ends.** The Licence Passport lists the day each licence stops covering the project, counted from the day of purchase, and downloads a calendar file with a reminder 30 days before each one.
- **What if the project changed?** Flip the territory, term, media or a requirement (or just type "only Canada for 6 months, no exclusivity") and the exact cheapest compliant bundle updates instantly in the browser, with which asset's licence would change. The choices live in the page address, so a scenario can be shared as a link. No model is involved and nothing is estimated. One button then makes it real: the same licences, nothing read again, are checked against the changed brief as a new run that can be approved and paid, linked to the first, with the change recorded in the passport.
- **Agents can shop, only people can spend.** The whole thing is an MCP server (over stdio, and over HTTP at `/api/mcp`), so any AI agent can check bundles, price a change of scope, read the fine print, start a purchase and re-check a Licence Passport afterwards. The Agents page shows how to connect and plays an agent session against the live endpoint. The agent gets a claim link for the person it works for; it cannot approve or pay, and the handover to the person is recorded in the ledger. It can also state the spending cap its person gave it (an intent mandate): code checks the verified total against that cap, writes the result to the ledger, and the approval screen and the passport show it.
- **A portfolio dashboard built with AG Studio** shows every run (rights graph, rule violations, requirement costs, ledger), with three custom Studio widgets (a rule matrix showing which rule keeps rejecting which asset, a licence timeline of when every bought licence ends, and a money flow showing what was paid to each creator) and an AI assistant that builds new charts and tables from plain English.

## Who it is for and why it matters
Indie game studios, podcast networks, small agencies, filmmakers and freelancers: teams that license a handful of assets per project and have no legal department. For them one wrong licence can mean a takedown or a dispute, and for creators the problem is late or missing payment. The product's claims are checkable: the demo scenarios show a price-only buyer would have bought licences they could not legally use (for example a non-commercial image for a commercial promo), and the app shows exactly which rule blocked each one and what staying compliant cost.

## How PayPal is used (central, not decorative)
- **Orders API (Sandbox):** create order, buyer approval, capture; idempotent request ids with stable, bounded keys and concurrent-request protection. The order is itemised, one line per licence, so the PayPal checkout page shows what is being bought, and it carries the approved bundle's digest as its custom id so a transaction found in PayPal can be matched to the exact bundle a person approved. Orders are created only through a gate that re-verifies the bundle and requires a human approval for exactly that bundle. The captured amount is checked against the approved bundle before anyone is paid.
- **Payouts API (Sandbox):** after capture, each licensor is paid the price of their licence in one batch; payout status is tracked to completion, and a payout problem never undoes the captured payment. Submission retries retain the original batch identity; partial recipient failures require reconciliation.
- **Refunds API (Sandbox):** if no creator could be paid, the buyer is refunded in full. Offered only when it is certain nobody was paid, so a refund can never double-spend; recorded in the ledger, and no passport is issued for a refunded purchase.
- **Webhooks:** the server accepts PayPal's notifications only after PayPal itself confirms the signature. An approved order is captured even if the buyer closes the tab, and a refund or reversal made outside the app is written to the ledger so the passport stops claiming the licences are covered.
- **Agentic commerce:** an AI agent, ours or any MCP client, initiates the purchase. Deterministic verification and a human who has explicitly taken control stand between that proposal and any money moving. The whole flow is also an OpenAPI 3.1 API (`/api/openapi.json`, generated from the server's own schemas and checked by tests).
- Everything runs against the PayPal **Sandbox**; no real payments are made, and the app refuses any other host. A clearly labelled offline payment simulator lets anyone run the whole flow without a PayPal account.

## How AI is used
- A language model reads each licence and extracts structured terms with evidence quotes (schema and quote locations validated by code; interpretation reviewed by a person).
- A language model proposes the licence bundle and revises after the verifier's rejections.
- A language model (with an offline fallback) turns a plain-English brief into project requirements; every assumption is shown.
- A language model answers questions about a run, grounded in the run's recorded facts; any offer it cites must exist in the run, or the deterministic answer is used instead.
- The AG Studio dashboard assistant builds views from plain English through validated tools.
- The model never verifies its own output, never creates orders, and never sees payment credentials. Everything that decides or costs is plain code: the rules engine, the minimum-cost check, the requirement costs and the what-if panel.

## How we built it
TypeScript end to end: Next.js and React; a pure rules engine and ledger shared between server and browser; PayPal REST (Orders v2, Payouts, Refunds, Webhooks); the Model Context Protocol for agents (over stdio, and over HTTP at `/api/mcp` so an agent can connect to a running instance); AG Studio and AG Grid for the dashboard; pdf.js for reading PDFs on the device; AI through the Vercel AI Gateway using a free model, with a guard that refuses any model the gateway does not list as free. About 700 unit and property tests and 45 browser tests (including automated WCAG 2.1 A and AA scans of the main pages in light and dark mode) cover the rules, the payments gate, payouts and refunds, the ledger, passport tamper detection, the API (including a contract test against the OpenAPI document), the agent handoff and the dashboard. Property tests compare the optimizer and the what-if engine with an exhaustive search of every bundle.

## Challenges
Small free models are unreliable and slow, so we made every AI step safe to be wrong, then made the failures rarer. Terms must be backed by quotes that really exist in the licence, the proposer can only choose real offers, and the verifier is code. We then measured the free model on 20 licences and fixed what it actually did wrong: wrapping answers in thinking text, putting evidence in the wrong shape, returning empty replies, and hanging. Reading replies more tolerantly, naming the exact field in retry hints, and asking only for the missing quotes took single-document extraction from 17 of 20 to 20 of 20, while every quote is still checked against the licence text. The AG Studio assistant could not configure its own widgets with a small model, so we gave it a few simple validated tools instead.

## Accomplishments
An independently checked minimum compliant cost, a "what would this cost if…" you can ask in the browser or as an agent, and a purchase you can audit end to end: from the sentence in a licence to the PayPal capture and the creator payouts, in one tamper-evident passport that verifies in any browser. A real Sandbox journey, including an agent-started purchase handed to a person, a refund and idempotent retries, was run end to end.

## What's next
Licensor onboarding and verified payee accounts, scanned-PDF text recognition, currency conversion, a public licence marketplace, and dispute handling.

## Built with
TypeScript, Next.js, React, PayPal Orders, Payouts, Refunds and Webhooks (Sandbox), Model Context Protocol, OpenAPI, AG Studio, AG Grid, pdf.js, Vercel AI Gateway, Zod, Vitest, Playwright.

## AI tools disclosure
**Tools and models operating inside the product:**
- Vercel AI Gateway, routing to the model `<<model id used for the submission>>`, used for licence term extraction, bundle proposals, brief reading, run questions and the dashboard assistant, as described above.

**Tools used while building the project:**
- AI-assisted development: AI coding tools were used to help write and test the code, under the author's direction. The author reviewed the work and takes responsibility for it.

## Testing instructions for judges
Hosted: open the link, press **Run the 60-second demo**, then follow the steps. Payment runs on a labelled simulator unless the PayPal Sandbox is configured; `<<add a Sandbox buyer login you are comfortable sharing, or note that the simulator needs none>>`.
Try these: run **Exclusive theme tune** (no licence can be bought) and press **Simulate the licensors agreeing**; open a finished run and use **What if the project changed?** and **Where you could pay less**; on the approval step, read the fine print quoted beside the Approve button; run `npm run verify:passport -- <passport address>` in a terminal; open **Agents** and press **Run as an agent**; open **Portfolio** for the AG Studio dashboard; verify a Licence Passport on the **Verify a passport** page.
Local: see the README ("Run it locally"); with no PayPal credentials set `LICENSEGRAPH_SIMULATOR=1` and the payment simulator replaces PayPal so the whole flow runs offline.
