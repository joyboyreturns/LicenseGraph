# LicenseGraph

> AI moves at machine speed. Creator rights and payments should too.

LicenseGraph is a rights-and-settlement tool for projects that use many licensed creative assets (music, images, fonts, footage). An AI agent extracts licence terms, each linked to its source text, and proposes the cheapest compliant bundle. A deterministic rules engine verifies every proposal and rejects any that break the project's constraints; the agent revises and retries. After a human approves, PayPal Sandbox processes the purchase.

Built for the PayPal AI Hackathon 2026.

## Status

Working end to end: licence term extraction with verified evidence, the propose-verify-revise loop, a hash-chained ledger, human approval, and PayPal Sandbox checkout in a Next.js app. Still to build: the AG Grid dashboard and deployment. See [`docs/PLAN.md`](docs/PLAN.md) for the schedule.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Step-by-step plan](docs/PLAN.md)

## Run it

```
npm install
cp .env.example .env     # add PayPal Sandbox credentials; gateway key and a free model for live mode
npm run dev              # http://localhost:3000
```

- **Demo mode** (no gateway key): reads the built-in sample licences with a stand-in model and shows the full reject, revise, verify loop. No credits are used.
- **Live mode** (`AI_GATEWAY_API_KEY` and `LICENSEGRAPH_MODEL` set): reads your own licence text through the AI Gateway. The client refuses any model the gateway does not list as free.
- **Payments** need `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from a PayPal Sandbox Business app. Use United States Sandbox accounts; India-region accounts cannot transact in USD.

The flow: add licences and a project, the agent proposes a bundle, the rules engine verifies it, you approve it, then PayPal Sandbox settles it. A step cannot be skipped: nothing is approved before it is verified, and no order is created before approval.

## Develop

```
npm test                 # unit tests (no network)
npm run typecheck
npm run build
npm run test:live        # PayPal Sandbox (needs credentials)
npm run test:gateway     # extraction on the free model (sends one request per fixture)
npm run test:proposer    # model proposer on the free model (one request)
npm run sandbox:order    # create a Sandbox order from the command line
```

## License

MIT
