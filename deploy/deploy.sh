#!/usr/bin/env bash
# Build the console off the server and ship the service. Usage: deploy/deploy.sh [ssh-host]
# The server needs uv, a filled .env in ~/$APP_DIR and the systemd unit (deploy/callenvoy.service); it runs no Node.
set -euo pipefail
HOST="${1:-hetzner-agent}"
APP_DIR="apps/callenvoy"
UNIT="callenvoy"
PORT=3021  # as in deploy/callenvoy.service and deploy/nginx.conf
cd "$(dirname "$0")/.."

# A restart cuts off calls that are running (their state is in memory): stop here if one is live.
if [ "${FORCE:-}" != "1" ]; then
  ssh "$HOST" "python3 - ~/$APP_DIR/data/callenvoy.db" <<'PY'
import os, sqlite3, sys
path = os.path.expanduser(sys.argv[1])
if os.path.exists(path):
    live = sqlite3.connect(f"file:{path}?mode=ro", uri=True).execute(
        "select count(*) from calls where status in ('queued', 'dialing', 'in_progress')").fetchone()[0]
    if live:
        sys.exit(f"{live} call(s) are live: a restart would cut them off. Deploy when they have ended, or run with FORCE=1.")
PY
fi

pnpm --dir client install --frozen-lockfile
pnpm --dir client exec tsc --noEmit
pnpm --dir client exec expo export --platform web

# Tracked files plus the built console. data/ and .env on the server are never touched.
{ git ls-files; find client/dist -type f; } | tar -czf - -T - | ssh "$HOST" "mkdir -p ~/$APP_DIR && rm -rf ~/$APP_DIR/client/dist && tar -xzf - -C ~/$APP_DIR"
ssh "$HOST" "cd ~/$APP_DIR && ~/.local/bin/uv sync --frozen --no-dev && sudo systemctl restart $UNIT && for i in \$(seq 30); do curl -sf http://127.0.0.1:$PORT/healthz && exit 0; sleep 1; done; echo 'health check failed'; exit 1"
