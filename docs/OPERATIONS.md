# Operating the private workspace

This covers the signed-in, PostgreSQL-backed mode only. The offline demo needs none of it. Everything here uses PayPal Sandbox or the simulator; nothing is deployed, and no live-money operation is supported.

## Pieces

| Piece | Purpose | Local default |
| --- | --- | --- |
| Web app | Next.js, serves pages and the API | `localhost:3000` |
| Worker | Runs queued operations (`npm run worker`) | one or more processes |
| PostgreSQL | Runs, ledger, documents, offers, purchases | `localhost:55432` |
| OIDC provider | Accounts, verified email, second factor | Keycloak, `localhost:8081` |
| Mail sink | Receives verification and recovery mail locally | Mailpit, `localhost:8025` |

Configuration variables are listed in `.env.example`. Secrets for the local stack are generated into an ignored file by `npm run infra:init` and are never committed. This machine has the standalone `docker-compose` executable, not the `docker compose` subcommand.

## Start, migrate, check

```sh
npm run infra:init                  # once; refuses to overwrite existing secrets
docker-compose --env-file .env.local-infra up -d
npm run db:migrate                  # idempotent; records a checksum per migration and refuses a changed one
npm run identity:setup && npm run identity:fixtures   # local realm tweaks and test accounts
npm run build && npm start &
npm run worker
```

Health, no authentication, counts only:

- `GET /api/marketplace/ready`: the database answers and migrations are current (503 otherwise).
- `GET /api/marketplace/health`: `ok`, or `degraded` (503) when work is queued and no worker reported in the last minute, or the oldest queued job is older than two minutes. It also reports running jobs, jobs awaiting reconciliation and unmatched webhooks.

Several app instances and several workers can run against one database. A job is claimed with a lease; only one worker owns a run at a time; every write re-checks the lease.

## What the worker does when things go wrong

- **Lease expires while a provider call is in flight** (crash, pause): the job moves to `reconcile`. It is never replayed. The stale worker's write is rejected.
- **PayPal says `ORDER_NOT_APPROVED`** on capture: nothing was captured. The job is `failed` with code `ORDER_NOT_APPROVED` and the buyer is told to approve and try again. It does not become `reconcile`.
- **A webhook arrives before its purchase exists**: it stays `queued` and the worker retries it; after a day it is marked `reconcile` for staff. It is never discarded.
- **A refund or reversal webhook** blocks payout release and sharing for that purchase and revokes existing share links.
- **An unreadable queued record** is failed visibly (`UNREADABLE_RECORD`) so it cannot block other work.

## Staff reconciliation

Staff (role plus second-factor sign-in) see jobs in `reconcile` in the Staff review tab. Reconciling means naming an **existing** provider record (order, refund or payout batch id). The server reads that record, checks the amount, currency, custom id and recipients against the signed purchase authorization, and only then records the outcome. It never sends a payment and never creates a new transfer identity. If the record does not match, nothing changes.

## Backup and restore

```sh
npm run db:backup -- /path/to/empty-dir
# restore into an EMPTY, migrated database:
DATABASE_URL=<empty database> npm run db:migrate
DATABASE_URL=<empty database> npm run db:restore -- /path/to/backup
```

A backup holds ciphertext only (records stay sealed), one snapshot-consistent file per table and a checksummed manifest. Session cookies and sign-in attempts are deliberately excluded. Restore refuses a changed file, a non-empty target or a different schema, then verifies with the storage keys: every run opens, its ledger chain verifies and matches the ledger table, each document matches its hash, and each purchase authorization matches the digest bound into the approved ledger event. Exit code 1 means a problem was found. Store the backup and the storage keys in different places. The restore exercise is automated in `tests/operations.integration.test.ts`; a restore into a separate machine has not been performed.

## Importing earlier anonymous runs

```sh
npm run db:import-legacy -- --dir .data --dry-run
npm run db:import-legacy -- --dir .data
```

Idempotent (files are identified by content hash). Files that are unreadable, have a broken ledger chain, a non-UUID id or a duplicate id are recorded as quarantined and copied to `<dir>/quarantine`; originals are never changed. Imported runs have no owner. The browser that created a run can link it to an account, or staff can assign it with a recorded reason.

## Key rotation

Storage keys: add the new key to `LICENSEGRAPH_STORAGE_KEYS`, make it `LICENSEGRAPH_STORAGE_KEY_ID`, restart, then `npm run db:rekey -- --apply`. Mutable records are re-sealed with a compare-and-swap, so a concurrent write is never overwritten. Immutable records (ledger events, documents, authorizations, audit events, offer versions) are protected by database triggers and keep the key they were written with, so **old keys must stay configured for as long as those rows exist**. `npm run db:rekey` without `--apply` lists which key seals how many records per table.

Passport signing: put the old secret in `LICENSEGRAPH_PASSPORT_RETIRED_SECRETS` (a JSON array) and set the new one as `LICENSEGRAPH_PASSPORT_SECRET`. `/.well-known/licensegraph-keys.json` then lists the new key as `current` and the old as `retired`, so passports signed earlier still verify offline.

## Not covered

Public deployment, TLS termination, a managed identity provider, real email delivery, and any production PayPal account are outside this work and unverified. The local Keycloak runs in development mode.
