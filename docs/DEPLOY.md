# Deploying on your own Ubuntu server with Tailscale Funnel

This puts LicenseGraph on the public internet from a machine at home, with HTTPS and no port forwarding. It uses PayPal **Sandbox** only: no real money moves.

> The Tailscale commands below follow Tailscale's documented usage but were not run on this project's build machine. Check `tailscale funnel --help` on yours if a flag differs.

## 1. Prerequisites

- Ubuntu 22.04 or 24.04, always on, with a stable internet connection.
- Node.js 22 (`node -v`). Install from NodeSource or with `nvm`.
- `git`, and Tailscale installed and logged in (`tailscale status`).
- Tailscale Funnel enabled for your tailnet: in the Tailscale admin console, enable **HTTPS certificates** (DNS page) and allow Funnel for this machine (the `funnel` node attribute in the access controls; the admin console offers to add it the first time you run `tailscale funnel`).

## 2. Install the app

```bash
# a service user whose home is the data folder (also where npm keeps its cache)
sudo useradd --system --home-dir /var/lib/licensegraph --create-home --shell /usr/sbin/nologin licensegraph
sudo mkdir -p /opt/licensegraph && sudo chown licensegraph:licensegraph /opt/licensegraph
sudo -u licensegraph git clone https://github.com/joyboyreturns/licensegraph /opt/licensegraph
cd /opt/licensegraph
sudo -u licensegraph npm ci
sudo -u licensegraph npm run build
```

Create the settings file from the example and lock it down:

```bash
sudo cp deploy/env.production.example /opt/licensegraph/.env
sudo chown licensegraph:licensegraph /opt/licensegraph/.env && sudo chmod 600 /opt/licensegraph/.env
sudo nano /opt/licensegraph/.env       # fill in APP_URL, PayPal Sandbox keys, gateway key, passport secret
openssl rand -hex 32                   # paste into LICENSEGRAPH_PASSPORT_SECRET
```

`APP_URL` must be the exact public address (step 4), because PayPal sends the buyer back to it and passport QR codes point at it.

## 3. Run it as a service

```bash
sudo cp deploy/licensegraph.service /etc/systemd/system/
# the unit assumes /opt/licensegraph; edit WorkingDirectory and EnvironmentFile if you used another folder
sudo systemctl daemon-reload
sudo systemctl enable --now licensegraph
systemctl status licensegraph
curl -s http://127.0.0.1:3000/api/health      # {"ok":true,"mode":...,"paymentsMode":"paypal-sandbox",...}
```

The service listens on `127.0.0.1:3000` only; Funnel reaches it from the same machine.

## 4. Publish with Tailscale Funnel

```bash
sudo tailscale funnel --bg 3000
tailscale funnel status                # shows https://<machine>.<tailnet>.ts.net
```

Put that address in `APP_URL`, then `sudo systemctl restart licensegraph`. Funnel serves HTTPS on port 443 (also 8443 and 10000) and forwards to `localhost:3000`. To stop publishing: `sudo tailscale funnel --https=443 off` (or `tailscale funnel reset`).

Try it in a private window from a phone on mobile data (not your home Wi-Fi) to prove it is public.

## 5. Check the whole flow

1. Open `APP_URL`, run a scenario, approve, create the PayPal order, approve as the Sandbox buyer, and confirm the payment is captured and creators are paid.
2. Open the passport, check that verification passes and the signature line says it was issued by this server.
3. Restart the service (`sudo systemctl restart licensegraph`) and confirm the run and its passport are still there (runs are saved in `LICENSEGRAPH_DATA_DIR`).

## 6. Operating it

- **Logs:** `journalctl -u licensegraph -f`
- **Update:** `git pull && npm ci && npm run build && sudo systemctl restart licensegraph`
- **Backups:** copy `/var/lib/licensegraph` (one JSON file per run).
- **Judging runs for weeks** (results after submission close). Keep the machine on, enable automatic restarts (the unit does), and consider an uptime check against `/api/health`. The repository also runs locally from the README, so a judge is never blocked if your server is off.

## 7. Safety on a public address

- Sandbox only. Never configure live PayPal credentials; the app refuses any host other than the Sandbox API.
- Visitors can start demo runs and, if a gateway key is set, live runs. Live runs are capped (3 at a time), and every model call goes through a server-side proxy that only uses the configured free model and spaces calls to its rate limit. Credits cannot be spent.
- Funnel exposes only this service. Keep the rest of the machine patched (`unattended-upgrades`), and keep `.env` readable by the service user only.
- Passport links are capability URLs: anyone who has a run's address can view its passport. They contain licence text you supplied, so do not run confidential licences through the public instance.

---

# Deploying on Render (hosted demo for judges)

The repository ships a [`render.yaml`](../render.yaml) blueprint.

1. In Render choose **New, Blueprint** and pick this repository.
2. Enter the values it asks for: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (Sandbox), and optionally `LICENSEGRAPH_CREATOR_EMAILS` and `PAYPAL_WEBHOOK_ID` (register `https://<your service>.onrender.com/api/webhooks/paypal` under the Sandbox app's Webhooks first; see the README). Leave the gateway values empty to serve the replayed scenarios only; add `AI_GATEWAY_API_KEY`, a free `LICENSEGRAPH_MODEL` and set `LICENSEGRAPH_MODE=live` to let visitors read their own licences (calls are paced to the free model's rate limit).
3. After the first deploy, open the URL. `APP_URL` is not needed: the app uses Render's `RENDER_EXTERNAL_URL` for PayPal's return link and the passport QR codes.
4. Put a PayPal Sandbox buyer login in the Devpost testing instructions, or leave PayPal credentials out and set `LICENSEGRAPH_SIMULATOR=1` so judges can complete a purchase with no account.

The free plan sleeps when idle and takes up to a minute to wake: open the URL once before judging starts. Keep the service available through the judging period (until 15 December 2026).
