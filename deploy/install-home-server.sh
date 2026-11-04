#!/usr/bin/env bash
# Installs or updates the account-free LicenseGraph demo on an Ubuntu home server as a *user* service
# (no root needed, survives reboots when "linger" is on). Safe to run again: it replaces the app files and keeps
# the data folder and the settings file.
#
#   scp release.tar.gz you@server:/tmp/        # from the machine that ran `npm run package`
#   ssh you@server 'bash -s' < deploy/install-home-server.sh /tmp/release.tar.gz [port]
#
# It binds to 127.0.0.1 only, caps memory (soft 200 MB, hard 256 MB) and never touches other services.
set -euo pipefail

ARCHIVE="${1:?usage: install-home-server.sh /path/to/release.tar.gz [port]}"
PORT="${2:-3110}"
ROOT="$HOME/licensegraph"
DATA="$HOME/licensegraph-data"
ENVFILE="$HOME/.config/licensegraph.env"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="licensegraph-demo"

[ -f "$ARCHIVE" ] || { echo "Archive not found: $ARCHIVE" >&2; exit 1; }

# A Node 20.19+ is required (22 is what the project is tested on). Prefer the newest 22 under nvm, else system node.
NODE=""
for candidate in "$HOME"/.nvm/versions/node/v22.*/bin/node /usr/bin/node /usr/local/bin/node; do
  [ -x "$candidate" ] || continue
  if "$candidate" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22)||(a===20&&b>=19)?0:1)'; then NODE="$candidate"; break; fi
done
[ -n "$NODE" ] || { echo "No suitable Node found (need 20.19 or newer)." >&2; exit 1; }
echo "Using $NODE ($("$NODE" -v))"

if ss -ltn | awk '{print $4}' | grep -q ":$PORT\$" && ! systemctl --user is-active --quiet "$UNIT"; then
  echo "Port $PORT is already used by something else. Pass another port as the second argument." >&2; exit 1
fi

mkdir -p "$ROOT" "$DATA" "$UNIT_DIR"
systemctl --user stop "$UNIT" 2>/dev/null || true
# Replace the code, never the data or settings.
rm -rf "$ROOT/app" "$ROOT/ops" "$ROOT/migrations" "$ROOT/deploy" "$ROOT/infra"
tar -xzf "$ARCHIVE" --strip-components=1 -C "$ROOT" 2>/dev/null
if find "$ROOT" \( -name '.env*' -o -name '.data*' \) | grep -q .; then echo "The archive contains local secrets or data; refusing." >&2; exit 1; fi

# Settings the owner edits (PayPal Sandbox keys, APP_URL, passport secret). Created once, mode 600.
if [ ! -f "$ENVFILE" ]; then
  umask 077
  cat > "$ENVFILE" <<EOF
# LicenseGraph demo settings. Never commit this file.
LICENSEGRAPH_MODE=demo
APP_URL=http://127.0.0.1:$PORT
LICENSEGRAPH_DATA_DIR=$DATA
LICENSEGRAPH_PASSPORT_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
# PayPal SANDBOX only. Leave blank to run the demo without payments.
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_WEBHOOK_ID=
EOF
  echo "Created $ENVFILE (edit APP_URL and the PayPal Sandbox keys before the public demo)."
fi

cat > "$UNIT_DIR/$UNIT.service" <<EOF
[Unit]
Description=LicenseGraph account-free demo
After=network-online.target

[Service]
WorkingDirectory=$ROOT/app
EnvironmentFile=$ENVFILE
Environment=NODE_ENV=production HOSTNAME=127.0.0.1 PORT=$PORT NODE_OPTIONS=--max-old-space-size=160
ExecStart=$NODE server.js
Restart=on-failure
RestartSec=5
MemoryHigh=200M
MemoryMax=256M
TasksMax=128
CPUWeight=50
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT"
loginctl show-user "$(id -un)" -p Linger 2>/dev/null | grep -q yes || echo "Note: run 'sudo loginctl enable-linger $(id -un)' so the service starts at boot without a login."

for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 1; done
curl -s "http://127.0.0.1:$PORT/api/health"; echo
for _ in 1 2 3 4 5; do curl -s -o /dev/null "http://127.0.0.1:$PORT/"; done
systemctl --user show "$UNIT" -p MemoryCurrent | sed 's/MemoryCurrent=/memory bytes: /'
echo "Installed. Logs: journalctl --user -u $UNIT -f    Stop: systemctl --user stop $UNIT"
echo "To publish: see docs/DEPLOY.md step 4 (Tailscale Funnel to 127.0.0.1:$PORT). Nothing is public until you do that."
