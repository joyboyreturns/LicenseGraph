# Devpost submission text (draft)

Copy each section into the Devpost form. Items in `<<double angle brackets>>` need a decision or a value from you.

## Project name
LicenseGraph

## Tagline
AI moves at machine speed. Creator rights and payments should too.

## Links
- Hosted demo: `<<your Tailscale Funnel URL>>`
- Source code (MIT): https://github.com/joyboyreturns/licensegraph
- Demo video (YouTube, public, under 3 minutes): `<<link>>`

## Inspiration
Anyone who ships creative work (a game trailer, a podcast, a promo film) ends up with a pile of licences: a song that is "worldwide" but only for web, an image that is "editorial only", a sound pack whose sale ended last month. Reading them all is slow, mistakes are expensive, and the creators who made the work are paid late. AI can read licences at machine speed, but nobody should let a model make an unchecked legal call or spend money on its own. We wanted a system where the AI does the reading and the proposing, code does the deciding, a human does the approving, and PayPal moves the money to the people who made the work.

## What it does
You describe a project in plain English (or pick a scenario) and give it your licence documents. LicenseGraph then:

1. **Reads** every licence. An AI model extracts the terms (price, commercial use, territory, term, media, credit, sublicensing, exclusivity, dates), and every term is linked to the exact sentence it came from. Quotes the model invents are rejected by code.
2. **Proposes** the cheapest bundle that it believes is compliant.
3. **Verifies** the proposal with a deterministic rules engine (plain code, no AI). Every offer is checked against every rule; a licence that is silent on something the project requires fails. Rejections go back to the agent, which revises and tries again. You watch this loop happen: propose, verify, reject, revise.
4. **Approves**: a human signs off on exactly the verified bundle. Nothing can be paid for anything else.
5. **Settles with PayPal**: the order is created and captured through the PayPal Orders API, then the **creators are paid automatically** through PayPal Payouts, one line per licensor.
6. **Issues a Licence Passport**: a shareable, printable, QR-coded record that anyone can re-verify in their own browser. The browser recomputes the hash-chained ledger, re-runs the rules engine on the exact terms, checks that every quote appears where it claims in the licence text, and matches the PayPal capture and payout records.

A portfolio dashboard built with **AG Studio** shows every run (rights graph, rule violations, ledger), and its AI assistant builds new charts and tables from plain English.

## Who it is for and why it matters
Indie game studios, podcast networks, small agencies, filmmakers and freelancers: teams that license a handful of assets per project and have no legal department. For them one wrong licence can mean a takedown or a dispute, and for creators the problem is late or missing payment. The product's claims are checkable: the demo scenarios show a price-only buyer would have bought licences they could not legally use (for example a non-commercial image for a commercial promo), and the app shows exactly which rule blocked each one.

## How PayPal is used (central, not decorative)
- **Orders API (Sandbox):** create order, buyer approval, capture; idempotent request ids so a retry can never double-charge. Orders are created only through a gate that re-verifies the bundle and requires a human approval for exactly that bundle.
- **Payouts API (Sandbox):** after capture, each licensor is paid the price of their licence in one batch; payout status is tracked to completion, and a payout problem never undoes the captured payment (it can be retried).
- **Agentic commerce:** an AI agent initiates the purchase by proposing the bundle; deterministic verification and a human approval stand between the proposal and the money.
- Everything runs against the PayPal **Sandbox**; no real payments are made. A clearly labelled offline payment simulator lets anyone run the whole flow without a PayPal account.

## How AI is used
- A language model reads each licence and extracts structured terms with evidence quotes (validated by code).
- A language model proposes the licence bundle and revises after the verifier's rejections.
- A language model (with an offline fallback) turns a plain-English brief into project requirements; every assumption is shown.
- The AG Studio dashboard assistant builds views from plain English through validated tools.
- The model never verifies its own output, never creates orders, and never sees payment credentials.

## How we built it
TypeScript end to end: Next.js and React; a pure rules engine and ledger shared between server and browser; PayPal REST (Orders v2, Payouts); AG Studio and AG Grid for the dashboard; AI through the Vercel AI Gateway using a free model, with a guard that refuses any model the gateway does not list as free. ~290 automated tests cover the rules, payments gate, payouts, ledger, passport tamper detection, API routes and a browser-safety check.

## Challenges
Small free models are unreliable and slow, so we made every AI step safe to be wrong: terms must be backed by quotes that really exist in the licence, the proposer can only choose real offers, the verifier is code, and unusable replies are retried or fall back. The AG Studio assistant could not configure its own widgets with a small model, so we gave it a few simple validated tools instead.

## Accomplishments
A purchase you can audit end to end: from the sentence in a licence to the PayPal capture and the creator payouts, in one tamper-evident passport that verifies in any browser.

## What's next
Licensor onboarding and verified payee accounts, PDF ingestion, multi-currency, a public licence marketplace, and refund/dispute handling.

## Built with
TypeScript, Next.js, React, PayPal Orders and Payouts (Sandbox), AG Studio, AG Grid, Vercel AI Gateway, Zod, Vitest, Playwright, Tailscale Funnel.

## AI tools disclosure
**Tools and models operating inside the product:**
- Vercel AI Gateway, routing to the free model `<<model id from your .env>>`, used for licence term extraction, bundle proposals, brief reading and the dashboard assistant, as described above.

**Tools used while building the project:**
- AI-assisted development: AI coding tools were used to help write and test the code, under the author's direction. The author reviewed the work and takes responsibility for it.

## Testing instructions for judges
Hosted: open the link, press **Run the 60-second demo**, then follow the steps; use the PayPal Sandbox buyer shown on the checkout page if asked (`<<add a Sandbox buyer login you are comfortable sharing, or note that the payment simulator needs none>>`).
Local: see the README ("Run it locally"); with no PayPal credentials set `LICENSEGRAPH_SIMULATOR=1` and the payment simulator replaces PayPal so the whole flow runs offline.
