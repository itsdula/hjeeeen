#!/usr/bin/env bash
# HJEN one-command deploy — turns the manual rsync into a single reproducible
# step. Builds the web renderer, syncs it plus the server code to a target box,
# and restarts the service.
#
#   ./deploy.sh staging     # → demo.hjen.ai (review environment)
#   ./deploy.sh prod        # → app.hjen.ai (customers) — asks for confirmation
#
# SSH/host details live in deploy.env (gitignored — copy deploy.env.example and
# fill it; secrets never go through chat). Never syncs .env, node_modules, .git,
# or data/ — the box keeps its own keys and customer data untouched.
set -euo pipefail
cd "$(dirname "$0")"

# ── target ───────────────────────────────────────────────────────────────────
TARGET="${1:-}"
if [[ "$TARGET" != "staging" && "$TARGET" != "prod" ]]; then
  echo "usage: ./deploy.sh <staging|prod>" >&2
  exit 2
fi

if [[ ! -f deploy.env ]]; then
  echo "error: deploy.env not found. Copy deploy.env.example → deploy.env and fill it." >&2
  exit 1
fi
# shellcheck disable=SC1091
source ./deploy.env

# Pick the target's vars (STAGING_* or PROD_*).
up() { echo "$1" | tr '[:lower:]' '[:upper:]'; }
P="$(up "$TARGET")"
SSH_DEST="$(eval echo "\${${P}_SSH:-}")"
SSH_KEY="$(eval echo "\${${P}_KEY:-}")"
REMOTE_DIR="$(eval echo "\${${P}_REMOTE:-/opt/hjen-server}")"
WEBAPP_DIST="$(eval echo "\${${P}_WEBAPP_DIST:-/opt/hjen-server/webapp-dist}")"
SERVICE="$(eval echo "\${${P}_SERVICE:-hjen-server}")"
HEALTH_URL="$(eval echo "\${${P}_HEALTH:-}")"

if [[ -z "$SSH_DEST" ]]; then
  echo "error: ${P}_SSH is not set in deploy.env" >&2
  exit 1
fi

# ── prod guard ───────────────────────────────────────────────────────────────
if [[ "$TARGET" == "prod" ]]; then
  echo "⚠  You are deploying to PRODUCTION ($SSH_DEST) — customers will see this."
  read -r -p "Type PROD to confirm: " CONFIRM
  [[ "$CONFIRM" == "PROD" ]] || { echo "aborted."; exit 1; }
fi

SSH_OPTS=()
RSYNC_SSH="ssh"
if [[ -n "$SSH_KEY" ]]; then
  SSH_OPTS=(-i "$SSH_KEY")
  RSYNC_SSH="ssh -i $SSH_KEY"
fi

echo "▸ [$TARGET] building web renderer…"
( cd ../app && npm run build:web )

APP_DIST="../app/dist/"
[[ -d "$APP_DIST" ]] || { echo "error: $APP_DIST missing after build" >&2; exit 1; }

# Optional control-plane build artifact (served at /console).
CONSOLE_DIST="console/dist/"

EXCLUDES=(--exclude ".env" --exclude ".env.*" --exclude "node_modules/" --exclude ".git/" --exclude "data/" --exclude "*.log" --exclude ".DS_Store")

echo "▸ [$TARGET] syncing renderer → $WEBAPP_DIST"
rsync -az --delete -e "$RSYNC_SSH" "$APP_DIST" "$SSH_DEST:$WEBAPP_DIST/"

echo "▸ [$TARGET] syncing server code → $REMOTE_DIR"
rsync -az --delete "${EXCLUDES[@]}" -e "$RSYNC_SSH" src/ "$SSH_DEST:$REMOTE_DIR/src/"
rsync -az --delete "${EXCLUDES[@]}" -e "$RSYNC_SSH" public/ "$SSH_DEST:$REMOTE_DIR/public/"

# The Context Agents seed library — READ-ONLY data the ported engine loads and
# overlays each account's own cards onto. Small, and it must travel with the
# code: without it Context Studio shows zero profiles and MAKE never enables.
echo "▸ [$TARGET] syncing Context Agents library → $REMOTE_DIR/context_agents"
rsync -az --delete "${EXCLUDES[@]}" -e "$RSYNC_SSH" context_agents/ "$SSH_DEST:$REMOTE_DIR/context_agents/"
rsync -az -e "$RSYNC_SSH" package.json "$SSH_DEST:$REMOTE_DIR/package.json"
rsync -az -e "$RSYNC_SSH" package-lock.json "$SSH_DEST:$REMOTE_DIR/package-lock.json" 2>/dev/null || true

# ── the eye: model weights + concept vectors ─────────────────────────────────
# These are DATA, not code, and they are large (a 168 MB fp16 ONNX graph), so they
# get their own sync: rsync only moves them the first time and after a retrain.
# Without them the /v1/eye routes answer ok:false and every caller falls back to
# its old behaviour — the deploy degrades, it does not break.
# SKIP_EYE=1 leaves the weights alone. A routine web deploy (renderer + server
# code) is seconds; the eye is half a gigabyte and turning it on is its own
# decision, so shipping it must be asked for, not ridden in on an unrelated push.
if [[ -d eye && "${SKIP_EYE:-0}" == "1" ]]; then
  echo "▸ [$TARGET] SKIP_EYE=1 — leaving the eye untouched"
elif [[ -d eye ]]; then
  echo "▸ [$TARGET] syncing the eye (model + cavs) → $REMOTE_DIR/eye"
  rsync -az --info=progress2 --exclude ".DS_Store" -e "$RSYNC_SSH" eye/ "$SSH_DEST:$REMOTE_DIR/eye/"
fi

# ── native deps ──────────────────────────────────────────────────────────────
# The server was dependency-free until the eye; onnxruntime-node and sharp are
# NATIVE and platform-specific, so they must be installed ON the box (the box is
# arm64 Linux, this laptop is arm64 macOS) — never rsynced. --omit=dev keeps it
# lean, and a failure here is survivable: the eye stays off, the server serves.
echo "▸ [$TARGET] installing server deps on the box"
ssh "${SSH_OPTS[@]}" "$SSH_DEST" "cd $REMOTE_DIR && npm install --omit=dev --no-audit --no-fund" \
  || echo "⚠ npm install failed — the eye will report unavailable; everything else still runs."

if [[ -d "$CONSOLE_DIST" ]]; then
  echo "▸ [$TARGET] syncing control plane → $REMOTE_DIR/console/dist"
  rsync -az --delete -e "$RSYNC_SSH" "$CONSOLE_DIST" "$SSH_DEST:$REMOTE_DIR/console/dist/"
fi

echo "▸ [$TARGET] restarting service: $SERVICE"
ssh "${SSH_OPTS[@]}" "$SSH_DEST" "sudo systemctl restart $SERVICE"

# ── health check ─────────────────────────────────────────────────────────────
if [[ -n "$HEALTH_URL" ]]; then
  echo "▸ [$TARGET] health check: $HEALTH_URL"
  sleep 2
  for i in 1 2 3 4 5; do
    if curl -fs -m 10 "$HEALTH_URL" >/dev/null; then
      echo "✓ [$TARGET] deploy complete — $HEALTH_URL is healthy"
      exit 0
    fi
    echo "  …waiting for service ($i/5)"
    sleep 3
  done
  echo "⚠ [$TARGET] deployed but health check did not pass — check the box." >&2
  exit 1
fi

echo "✓ [$TARGET] deploy complete (no health url configured)"
