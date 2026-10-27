# LicenseGraph

> AI moves at machine speed. Creator rights and payments should too.

LicenseGraph is a rights-and-settlement tool for projects that use many licensed creative assets (music, images, fonts, footage). An AI agent extracts licence terms, each linked to its source text, and proposes the cheapest compliant bundle. A deterministic rules engine verifies every proposal and rejects any that break the project's constraints; the agent revises and retries. After a human approves, PayPal Sandbox processes the purchase.

Built for the PayPal AI Hackathon 2026.

## Status

Foundation only: domain types, rules engine v1 with tests, architecture and plan. See [`docs/PLAN.md`](docs/PLAN.md) for the schedule.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Step-by-step plan](docs/PLAN.md)

## Develop

```
npm install
npm test
npm run typecheck
```

Copy `.env.example` to `.env` and fill in the AI Gateway and PayPal Sandbox credentials when those steps are built.

## License

MIT
