# Demo video script (under 3:00)

Rules from the hackathon: under 3 minutes, shows the app working on its intended device, public on YouTube, no copyrighted music or third-party trademarks you do not have the right to use. Judges need not watch past 3:00, so the payoff must come before then.

Record at 1920x1080 in a clean browser window (hide bookmarks, use the app's dark or light theme consistently). Use the hosted URL. Talk calmly; the on-screen loop is the star. Do not use background music (or use something you made or that is explicitly royalty-free with a licence you can show).

| Time | On screen | Say |
|---|---|---|
| 0:00 to 0:15 | Home page, hero | "Every project that uses music, images and fonts ends up with licences nobody has time to read, and the people who made the work get paid late. LicenseGraph fixes both." |
| 0:15 to 0:35 | Click the Game launch trailer scenario | "Here's a game trailer: worldwide, two years, web, social and broadcast, three thousand dollars. Eight licences, three assets." |
| 0:35 to 1:25 | Run theatre: replay. Pause on the first rejection, show the matrix, click an evidence quote | "An AI agent reads every licence and links each term to the exact sentence. It proposes the cheapest bundle. A rules engine, plain code, not AI, checks it and rejects it: wrong territory, term too short, wrong media, expired offer. The agent revises. Three rounds later: verified. Click any term and see the sentence in the licence it came from." |
| 1:25 to 1:45 | Compliance summary | "A price-only buyer would have bought three licences they couldn't use. The cost check independently proves the $2,170 minimum across the 18 possible bundles, with all rights requirements intact." |
| 1:45 to 2:10 | Approve, create PayPal order, PayPal Sandbox checkout, return | "A human approves exactly this bundle. Only then is the PayPal order created. This is the PayPal Sandbox. Approve as the buyer, and the payment is captured." |
| 2:10 to 2:30 | Payouts settling, then the passport | "And the creators are paid automatically through PayPal Payouts, one line per licensor. Then a Licence Passport is issued." |
| 2:30 to 2:45 | Passport verification animating | "Anyone can verify it in their own browser: the hash chain, the rules re-run on the exact terms, the quotes in the licence text, the PayPal capture." |
| 2:45 to 3:00 | Dashboard with the AG Studio assistant: ask for a chart | "A portfolio dashboard in AG Studio, with an assistant that builds views from plain English. AI proposes. Code verifies. People approve. PayPal pays the creators." |

## Two beats worth swapping in for a live walk-through (no time for them in three minutes)
- **What if the project changed?** On a verified run, type "only Canada for 6 months, no exclusivity" into the panel. The exact cheapest bundle re-prices in the browser, with which licence would change. No model is involved.
- **When the answer is no.** Run "Exclusive theme tune": nobody sells exclusivity, so the rules engine buys nothing. The run names the closest licence for each asset and what to ask for, prices the best case ("if every licensor said yes": $690) and how far each asset could rise before the budget breaks, and drafts the email. Press "Simulate the licensors agreeing": their exclusive replies are checked as a new run, which verifies at $1,160, and its passport carries the negotiation.
- **An agent's spending cap and the fine print.** Start a purchase as an agent with a cap (`POST /api/sessions` with `handoff: true` and `mandate: { maxTotalCents: 30000, currency: "USD" }` on the documentary scenario, or `mandate` on `start_licence_purchase`). Open the claim link, take control, and look beside the Approve button: "Over the agent's mandate by $29.00", and, above it, the clauses the rules engine does not check, quoted from the licences (a licence that can be ended early, a ban on training AI). The passport records both.
- **Checking a passport without the app.** In a terminal: `npm run verify:passport -- http://localhost:3000/api/passports/<run id>`. Nine PASS lines and exit code 0; change one byte in a saved passport file and it fails.
- **Where the money went.** On the portfolio dashboard, the money flow widget draws what buyers paid flowing to each creator, and the assistant adds one from "Add a money flow diagram of what was paid to each creator."

## Checklist before you record
- Run the scenario once beforehand so the first view is warm (the replay plays once on first open; use a fresh run for the video).
- Have the Sandbox buyer login ready; log in with a private window.
- Confirm the creators' payout line items show SUCCESS (use real Sandbox creator accounts via `LICENSEGRAPH_CREATOR_EMAILS`).
- Pre-record a real dashboard assistant response or show the existing dashboard. A live assistant call can exceed the final 15 seconds; keep the complete video under three minutes.
- Export at 1080p, upload to YouTube as Public, paste the link into Devpost.
