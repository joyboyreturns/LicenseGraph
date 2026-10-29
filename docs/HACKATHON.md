# Hackathon readiness, checked 28 October 2026

Official sources: [rules](https://paypalaihackathon.devpost.com/rules), [overview](https://paypalaihackathon.devpost.com/), [resources](https://paypalaihackathon.devpost.com/resources), [FAQ](https://paypalaihackathon.devpost.com/details/faqs), [AG Grid brief](https://paypalaihackathon.devpost.com/details/aggrid).

The submission closes **13 November 2026 at 01:30 IST** (12 November, noon PST). Keep 11 November as the internal target. The five equally weighted criteria are implementation, design, impact, innovation and presentation. A public open-source repository and runnable instructions or working deployment are required. The public YouTube video must be under three minutes. Keep testing access available through 15 December. Existing projects need significant progress during the contest. Prize stacking allows a grand prize plus one sponsor prize, or an honorable mention plus one sponsor prize. Each participant must check eligibility and ownership requirements directly in the rules. [Official rules](https://paypalaihackathon.devpost.com/rules).

## Positioning grounded in the working product

Lead with the indie studio buying rights for a worldwide game launch. Show the actual eight offers and three required assets. There are 18 possible bundles; the cheapest price-only bundle costs $220 and breaks three sets of constraints. The minimum compliant purchase costs $2,170. These are fixture prices, not measured customer savings or a forecast of avoided legal losses.

The useful differentiator is independent verification throughout one purchase:

1. A term points to located source text that the buyer can inspect.
2. The proposal is rejected or accepted by deterministic rules.
3. The cost check independently establishes the minimum compliant cost and any budget gap.
4. Approval binds prices, terms and evidence.
5. A completed capture must match the order, currency and total before payouts.
6. Individual creator receipts determine settlement; batch acceptance alone does not.
7. The downloaded passport can be checked independently and tampering demonstrated.

The cost calculation proves optimality within the extracted offer catalogue and the implemented independent rules. It does not establish that the legal interpretation is correct, the creator owns the rights, or the catalogue covers the entire market. Keep the human source-review step visible.

## Demonstration priorities

Use `docs/DEMO_SCRIPT.md` for a recording under three minutes. Spend most of it on rejection, the source evidence, the independent cost minimum, buyer approval, capture, creator receipts and passport verification. Capture a real Sandbox journey before recording; simulator output must stay labelled. Pre-record slow assistant responses if needed, accurately showing the actual product.

AG Grid's brief emphasizes dashboard polish, custom widgets/theming/layout and agent integration. Demonstrate the existing portfolio's linked data and assistant tools. Avoid adding another sponsor integration merely to collect a logo. The brief offers a [45-day trial](https://paypalaihackathon.devpost.com/details/aggrid); the owner still needs a suitable licence for the public demo and judging period.

## Remaining owner work

- Run the updated payment flow against real PayPal Sandbox credentials and approve as the test buyer. Confirm each creator recipient shows SUCCESS. Automated mock/simulator tests do not substitute for this evidence.
- Configure the intended free model, confirm its current pricing through the existing guard, and record real extraction/proposal output. Identify the actual model in the submission disclosure. No paid calls are required.
- Choose local setup instructions or hosting for judging. Deployment was previously deferred by the owner; no infrastructure was published during this audit.
- Confirm participant eligibility and the team representative; resolve rights to submitted assets.
- Obtain the dashboard trial licence if needed, record and publish the video, fill submission placeholders, submit before the internal deadline, and preserve a release revision.

### In order, from 5 November

1. **One real Sandbox purchase** (before anything else). The PayPal order is now itemised, one line per licence, and carries the approved bundle's digest as its `custom_id`. Sandbox accepts creating it, but a buyer approving it on PayPal's own page has not been re-run since. If the page objects to the line items, set `LICENSEGRAPH_ITEMISED_ORDERS=0` and restart.
2. **Judging access.** Confirm the hosting choice with the owner; `docs/DEPLOY.md` covers the previously planned home Ubuntu server with Tailscale Funnel. Once the address is chosen, register `https://<service>/api/webhooks/paypal` on the Sandbox app, then set `PAYPAL_WEBHOOK_ID`. Set `APP_URL` to the public address, and `LICENSEGRAPH_PASSPORT_SECRET` to a long random value that you keep: passports are signed with a key derived from it, and the public half is published at `/.well-known/licensegraph-keys.json`. Changing the secret later changes the key, so earlier passports would no longer match it.
3. **AG Studio key.** Set `NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY` *before the build*: it is read at build time, so a restart alone is not enough.
4. **Live model for the demo.** Use only a model currently listed by the gateway with zero input and output prices. Keep the existing guard enabled; a paid or unlisted model must fail before a completion request is sent. Record the actual configured model in the submission disclosure after the owner confirms it.
5. **Fill the placeholders** in `docs/DEVPOST.md`: hosted URL, video link, model id, Sandbox buyer login (or note that the simulator needs none).
6. **After the contest:** remove the live demo and rotate the gateway key (it was pasted into a chat once).

No competitive outcome is guaranteed. The work targets demonstrable correctness and clear evidence against the published criteria.
