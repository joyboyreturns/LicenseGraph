# Running LicenseGraph in about 650 MB (and sharing the machine)

This is for a single Ubuntu server or home PC that will also host other projects. It covers the signed-in (PostgreSQL) mode and the account-free demo. Nothing here deploys anything by itself; each step is run by the owner.

## What it costs (measured on 4 November 2026)

| Part | Before | After | How |
|---|---|---|---|
| Keycloak (identity) | 714 MB, `start-dev` | about 370 MB | capped JVM (`-Xmx256m`, metaspace 192 MB), quick JIT, single-node cache, health/metrics off |
| PostgreSQL | 2 servers, 167 MB | 1 server, about 30 to 60 MB | 32 MB shared buffers, 50 connections; Keycloak gets a database in the same server |
| Web server | about 113 MB (`next start`) | about 100 to 140 MB | standalone build, heap capped at 160 MB |
| Worker | 76 to 93 MB (TypeScript loader) | about 60 MB | one bundled file, `node ops/worker.mjs`, heap capped at 96 MB |
| Disk for the app | 691 MB `node_modules` + 862 MB `.next` | about 87 MB folder, 22 MB archive | standalone output plus bundled commands |

Realistic total for the signed-in stack: roughly 600 to 700 MB. The identity provider is the floor: a Java application needs about 350 MB however it is tuned. If a total near 500 MB matters more than self-hosted accounts, the choices are a smaller external identity provider or the account-free demo mode (about 140 MB, no Keycloak, no PostgreSQL).

The account-free demo alone (what a public demo needs) is one process of about 140 MB.

## Build the release (on your Mac or in CI)

```bash
npm ci
npm run package          # build, bundle the worker and database commands, write release/ and release.tar.gz
```

`release/` holds `app/` (the standalone web server), `ops/` (worker, migrate, backup, restore, rekey, import), `migrations/`, `deploy/` and `infra/`. The packaging step refuses to include `.env*`, `.data*` or key files, and fails if it finds one. It needs only Node 22 on the server, not npm or the source.

## Install on the server

```bash
sudo useradd --system --home-dir /var/lib/licensegraph --create-home --shell /usr/sbin/nologin licensegraph
sudo mkdir -p /opt/licensegraph && sudo tar -xzf release.tar.gz --strip-components=1 -C /opt/licensegraph
sudo chown -R licensegraph:licensegraph /opt/licensegraph
sudo cp deploy/licensegraph.service deploy/licensegraph-worker.service /etc/systemd/system/
```

Create `/opt/licensegraph/.env` (chmod 600) from `.env.example` in the repository: `APP_URL`, `LICENSEGRAPH_STORAGE=postgres`, `DATABASE_URL`, `LICENSEGRAPH_STORAGE_KEY_ID`, `LICENSEGRAPH_STORAGE_KEYS`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `LICENSEGRAPH_PASSPORT_SECRET`, the PayPal Sandbox pair and `PAYPAL_WEBHOOK_ID`. Never commit it. For the demo only, omit the storage and OIDC variables.

Database and identity provider, option A (own containers, one PostgreSQL server):

```bash
cd /opt/licensegraph
docker compose --env-file stack.env -f deploy/compose.production.yaml up -d
sudo -u licensegraph node --env-file=.env ops/migrate.mjs
```

Option B (the machine already runs PostgreSQL 16 or newer): create `licensegraph` and `keycloak` databases and roles there, run only the `keycloak` service from the compose file with `KC_DB_URL` pointing at the host (`host.docker.internal`, or the Docker bridge address), and set `DATABASE_URL` to the same server. This avoids a second PostgreSQL entirely.

Keycloak's realm file (`infra/keycloak/licensegraph-realm.json`) ships with `http://localhost:3000` redirect addresses. Change the client redirect URIs, web origins and post-logout URI to your `APP_URL` before the first start, and put TLS (Tailscale Funnel or a reverse proxy) in front of both the app and Keycloak. Keycloak in this setup is not exposed directly.

Start and check:

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now licensegraph licensegraph-worker
curl -s http://127.0.0.1:3000/api/marketplace/health      # status ok, live_workers 1
systemd-cgtop -m                                           # memory per service
```

## The home PC (surveyed read-only on 4 November 2026)

- 7 GB RAM with about 3.7 GB in use and about 1.9 GB of swap used while idle. It already runs Jellyfin, Sonarr, Lidarr, Nextcloud, Vaultwarden and a dozen other containers, so this project has to stay small. A 650 MB addition is fine; a second PostgreSQL server is not worth it.
- A native **PostgreSQL 18** is already running (`postgresql@18-main`, port 5432, about 15 MB). Use option B above: create the `licensegraph` and `keycloak` databases and roles there, run only Keycloak in Docker, and do not start the bundled `postgres` service (its port 5432 would clash anyway).
- Ports already taken include 3000, 3005, 3007, 3008, 5432, 8080, 8096 and 8100. Use for this project: web server `PORT=3110` (edit the unit) and Keycloak `8081`.
- System Node is 20.20 (`/usr/bin/node`); Node 22 exists only under one user's nvm. The release runs on Node 20.20 as well (`engines` allows 20.19 or newer); the CI and local tests ran on Node 22.
- Nothing has been installed or changed on that machine by this work.

## Keeping several projects on one machine

- **Hard ceilings.** Every service here has a limit: web `MemoryMax=256M`, worker `MemoryMax=128M`, containers `mem_limit` (PostgreSQL 192 MB, Keycloak 480 MB). One misbehaving project is killed and restarted by systemd or Docker instead of pushing the machine into swap. Give each new project the same treatment before it starts.
- **Budget.** Write down a budget per project and keep the sum below about 70 percent of RAM so the page cache and bursts have room. This stack's ceiling is about 1.1 GB if every limit were reached at once; it normally sits near 600 MB.
- **Ports.** Bind every service to `127.0.0.1` and publish only through the reverse proxy or Tailscale Funnel. This project uses 3000 (app), 5432 and 8081 (Keycloak). Pick a new range per project and keep a list.
- **One database server.** Reuse one PostgreSQL server with one database and one role per project (as above). Never share a role between projects.
- **Swap is a warning, not a plan.** If `free -m` shows swap in use while idle, a project is over budget; look at `systemd-cgtop -m` and `docker stats` first.
- **Backups and rotation.** `node ops/backup.mjs <empty-dir>` and `ops/restore.mjs`, `ops/rekey.mjs` work exactly as `docs/OPERATIONS.md` describes for the `npm run db:*` commands.

## Checking memory yourself

```bash
free -m
docker stats --no-stream
systemd-cgtop -m          # or: systemctl status licensegraph licensegraph-worker
```

On macOS with Colima, the virtual machine reserves its whole allocation (default 4 GiB) in the host's accounting even when the containers use far less. Size it to the containers plus headroom, for example `colima stop && colima start --memory 2`.
