# LicenseGraph

> **AI moves at machine speed. Creator rights and payments should too.**

LicenseGraph turns a pile of licence documents into a **verified, approved, paid-for licence bundle**, and pays the creators. An AI agent reads the licences and proposes the cheapest bundle; a **deterministic rules engine** (plain code, not AI) checks every proposal against your project and rejects what breaks it; a **human approves** exactly what was verified; **PayPal** settles the order and pays each licensor through **PayPal Payouts**. At the end you get a **Licence Passport**: a shareable, QR-coded record that anyone can re-verify in their own browser.

Built for the PayPal AI Hackathon 2026. Everything runs against the PayPal **Sandbox** (or an offline simulator). No real money moves.

![The run theatre: the agent proposes, the rules engine rejects, the agent revises](docs/images/run-replay.jpg)

## Try it in two commands

```bash
git clone https://github.com/joyboyreturns/licensegraph && cd licensegraph
npm install && npm run demo          # then open http://localhost:3000
```

That needs **no accounts and no API keys**: the three built-in scenarios replay recorded model output, and a clearly labelled payment simulator stands in for PayPal. Press **Run the 60-second demo**, then follow the steps (approve, create the order, approve as the buyer in the simulator, watch the creators get paid, open the passport).

Requires Node.js 20.19 or newer (22 recommended). The first run builds the app (about a minute).

## What you will see

| | |
|---|---|
| ![](docs/images/run-verified.jpg) | **The loop is visible.** A hand-built rights graph shows licences, the offers the agent read, and the assets you need. The agent proposes (amber); the rules engine (blue, "code, not AI") rejects offers that break a rule and sends the reasons back; the agent revises. Replay it, scrub it, or skip to the result. |
| ![](docs/images/matrix.jpg) | **Every offer is checked against every rule**, not only the proposed bundle. A licence that is *silent* on something the project requires fails: gaps are never assumed away. |
| ![](docs/images/evidence.jpg) | **Every term links to the sentence it came from.** Quotes the model invents are rejected by code; the evidence viewer highlights the exact text. |
| ![](docs/images/settled.jpg) | **Settlement.** The order can only be created for the verified bundle a human approved. After the buyer approves, the payment is captured and each creator is paid. A submission failure never undoes the captured payment. Retries preserve the original batch id, recipients and amounts; individual failures require reconciliation rather than resending successful payments. |
| ![](docs/images/passport.jpg) | **The Licence Passport** re-checks itself in your browser: the hash-chained ledger, the rules engine re-run on the exact terms, every quote found at its recorded position, and the PayPal capture and payout records. Print it, share it, or verify a downloaded file at `/verify`. |
| ![](docs/images/portfolio.jpg) | **Portfolio dashboard** built with [AG Studio](https://www.ag-grid.com/studio/): spend, licences the rules blocked, creators paid, and every offer, violation and ledger event as linked tables. Its AI assistant builds new views from plain English (needs a model). |

On a phone it stays usable:

<img src="docs/images/mobile-run.jpg" alt="Mobile layout of the run page" width="300">

## Why it matters

Anyone who ships creative work (a game trailer, a podcast, a promo film) ends up with licences nobody has time to read: a song that is "worldwide" but only for web, an image that is "editorial only", a sound pack whose sale ended last month. A wrong licence can mean a takedown or a dispute, and the creators who made the work are paid late. In the demo scenarios a price-only buyer would have bought licences they could not legally use (for example a non-commercial image for a commercial promo); LicenseGraph shows exactly which rule blocked each one, and what staying compliant costs. Every number it shows is a price from an uploaded licence.

## Independent cost verification

The run page computes the exact cheapest compliant bundle from the uploaded offers, separately in each currency. It independently checks whether the agent found that minimum and shows the precise budget shortfall when no affordable bundle exists. All rights requirements stay in force. The method uses the current rules' independence between assets; every result is rechecked by the same rules engine, and property tests compare it with exhaustive enumeration.

## How PayPal is used

- **Orders API (Sandbox):** create order, buyer approval, capture, with stable, bounded idempotency keys and coalesced concurrent requests. Orders are created only through a gate that re-verifies the bundle and requires a human approval for exactly that bundle.
- **Payouts API (Sandbox):** after capture, each licensor is paid the price of their licence in one batch. Payout status is tracked per recipient. A batch is settled only when every creator payment succeeds; uncertain submissions reuse the same batch key when retried.
- **Agentic commerce:** the AI agent initiates the purchase by proposing the bundle. Deterministic verification and a human approval stand between that proposal and any money moving.

## How AI is used

- A language model reads each licence and extracts structured terms **with evidence quotes** (validated by code).
- A language model **proposes** the bundle and **revises** after the verifier's rejections.
- A language model (with an offline fallback) turns a plain-English **brief** into project requirements; every assumption is shown separately from what the text said.
- **Ask about this run** answers questions only from the run's recorded facts; cited offers are checked by code.
- The AG Studio **dashboard assistant** builds charts and tables through a few validated tools.
- The model **never** verifies its own output, never creates orders, and never sees payment credentials. It is also never trusted: it can only choose real offers by id, and its structured output and quote locations are checked. Quote matching does not prove the interpretation is correct; the approver must review the source terms.

Models run through the Vercel AI Gateway, and the client **refuses any model the gateway does not list as free**, so credits cannot be spent.

## Using real PayPal Sandbox and a live model

```bash
cp .env.example .env        # then fill in what you have
npm run build && npm start  # or: npm run dev
```

- **PayPal Sandbox:** create a *Merchant* app on [developer.paypal.com](https://developer.paypal.com) under Sandbox, use **United States** Sandbox accounts (India-region accounts cannot transact in USD), and set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. The app only talks to the Sandbox host and refuses anything else. Add a few Sandbox personal accounts to `LICENSEGRAPH_CREATOR_EMAILS` to see the creator payouts land as SUCCESS.
- **No PayPal account?** Set `LICENSEGRAPH_SIMULATOR=1` instead: the same order, approval, capture and payout flow runs locally against a labelled simulator.
- **Your own licences:** set `AI_GATEWAY_API_KEY` and a **free** `LICENSEGRAPH_MODEL`, then use *Describe your project* on the home page. Live runs are slower (free models are rate limited, so calls are spaced about 12 seconds apart).
- **Dashboard licence:** AG Studio is commercial; without `NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY` it runs with a trial watermark.

All settings are documented in [`.env.example`](.env.example). Running it on a home server behind Tailscale Funnel is covered in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## How it is built

```
licence text ──► extract (model + code checks) ──► propose (model) ──► verify (rules engine) ─┐
                      ▲ quotes must exist            only real offers        pure, no AI       │ rejected: reasons
                      │ in the licence                                                         │ go back verbatim
                      └───────────────────────────── revise ◄──────────────────────────────────┘
verified ──► human approval (locks the bundle digest) ──► PayPal order ──► buyer approves ──► capture ──► creator payouts ──► Licence Passport
                              every step is appended to a hash-chained ledger
```

| Path | What it holds |
|---|---|
| `src/core` | The rules engine (`verifyBundle`, `evaluateOffer`), the price-only comparison, canonical hashing. Pure TypeScript shared by server and browser. |
| `src/extraction`, `src/agent` | Term extraction with evidence checking; the propose-verify-revise loop; model clients (free-models-only guard, rate pacing). |
| `src/ledger` | Hash-chained, append-only event log; browser-safe verification. |
| `src/payments` | PayPal Orders and Payouts client (Sandbox only), the approval-gated checkout, creator payout planning, the offline simulator. |
| `src/passport` | Passport builder and the in-browser verifier. |
| `src/app-logic` | The session flow that enforces the order of steps, and persistence. |
| `src/server`, `app/api` | Runtime wiring, owner cookies, the model proxy, rate limits, HTTP routes. |
| `src/ui`, `app` | The Next.js front end: home, run theatre, passport, verify, simulator checkout. |
| `src/dashboard`, `app/dashboard` | AG Studio dashboards and the validated assistant tools. |
| `src/demo`, `src/intake` | Built-in scenarios and recorded outputs; the plain-English brief reader and run Q&A. |

More detail, including the trust boundaries and decisions, is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Trust boundaries in one line each:** the agent may extract, propose and revise, but may not verify, create orders, or see credentials. The rules engine decides and never calls a model. Payment code requires a passing verdict **and** an approval for exactly that bundle. Money is integer cents in one supported two-decimal currency per bundle. Budgets in the brief editor are USD; the API can declare a different project currency, and never assumes an exchange rate. PayPal calls go only to the Sandbox.

## Tests

```bash
npm test               # unit, property and API tests, no network
npm run typecheck
npm run test:e2e       # real browser journeys against the offline demo (needs: npx playwright install chromium)
npm run test:live      # PayPal Sandbox (needs credentials)
npm run test:gateway   # free-model extraction (one request per fixture)
```

The suite covers the rules, the payment gate, payouts and their failure and retry, ledger and passport tamper detection (forged prices, terms, quotes, capture ids, edited ledger events), persistence, API routes and run ownership, the offline simulator, a check that browser-bound modules never import Node code, and full browser journeys including the mobile layout.

## Security and privacy notes

- Sandbox only. The app refuses any PayPal host other than the Sandbox API.
- A run belongs to the browser that created it (an anonymous, HttpOnly cookie): only that browser can approve, pay or list it. Anyone holding a run or passport link can *read* it, so a passport can be shared; do not run confidential licences through a public instance.
- Creator email addresses are masked in the UI and never stored in the ledger or passport.
- Passports are tamper-evident and, when `LICENSEGRAPH_PASSPORT_SECRET` is set, signed so the issuing server can confirm them. "Verified" proves the record is consistent and unchanged. It does **not** prove the licence documents are genuine or that the licensor owns the rights, and it is not legal advice.

## AI tools disclosure

- **In the product:** a free language model through the Vercel AI Gateway (licence term extraction, bundle proposals, brief reading, run Q&A and the dashboard assistant), as described above.
- **In development:** AI coding tools were used to help write and test the code, under the author's direction. The author reviewed the work and takes responsibility for it.

Audit results and the remaining submission work are in [`docs/AUDIT.md`](docs/AUDIT.md) and [`docs/HACKATHON.md`](docs/HACKATHON.md).

## Documents

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/PLAN.md`](docs/PLAN.md) · [`docs/DEPLOY.md`](docs/DEPLOY.md) · [`docs/DEVPOST.md`](docs/DEVPOST.md) · [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md)

## Licence

MIT. See [`LICENSE`](LICENSE). AG Studio is a separate commercial product with its own licence.
