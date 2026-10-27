# AGENTS.md

Instructions for any coding agent working in this repo.

## Authorship

All commits and PRs must appear as the repo owner only (`joyboyreturns`). Add no co-author trailers, session links, or "generated with" lines, and mention no tool or model names in code, docs, or commit messages. Use the repo-local git identity. See `CLAUDE.md`.

## What this project is

LicenseGraph proposes licence bundles with an AI agent, verifies them with a deterministic rules engine, and pays through PayPal Sandbox only after human approval. Read `docs/ARCHITECTURE.md` and `docs/PLAN.md` first.

## Hard rules

1. `src/core` stays pure: no network, no disk, no model calls.
2. The agent never verifies its own output; `verifyBundle` decides.
3. Payment code requires `Verdict.ok === true` and an approval record. Never add a bypass.
4. Money is integer cents; one currency per bundle.
5. Sandbox only. Never add live PayPal credentials or hosts.
6. Never commit secrets. `.env` is ignored; document new variables in `.env.example`.
7. Every offer must carry evidence quoting the source text.

## Workflow

- `npm install`, `npm test`, `npm run typecheck` must pass before committing.
- Add a test with every rule or behaviour change.
- Keep changes small and follow the step order in `docs/PLAN.md`.
- If a decision is the owner's (credentials, prize choices, scope cuts), stop and ask.
