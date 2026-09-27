#!/bin/bash
# HJEN Studio — Container-Optimized OS boot script. Runs on EVERY boot, so every
# step must be idempotent.
#
# TEMPLATE ESCAPING: this file is rendered by Terraform's templatefile().
# A dollar-brace sequence is a Terraform substitution, and only five names
# exist in the template map: project_id, container_image, domain, secret_names,
# public_base_url. Referencing any other name is a hard render error -- which is
# why this paragraph carries no dollar-brace of its own.
# To emit a literal dollar-brace for the SHELL to expand, double the dollar sign
# (the only place that is needed is the registry prefix, below).
# Plain $NAME shell variables need no escaping at all. Writing $$NAME "to be
# safe" is a silent no-op bug: it renders as two literal dollars.
set -euo pipefail

PROJECT_ID="${project_id}"
IMAGE="${container_image}"
DOMAIN="${domain}"
SECRET_NAMES="${secret_names}"
PUBLIC_BASE_URL="${public_base_url}"

DATA_MNT=/mnt/disks/data
DEV=/dev/disk/by-id/google-hjen-data
ENV_FILE=/var/run/hjen.env

log() { echo "[hjen-startup] $*"; }

# ── 1. data disk ────────────────────────────────────────────────────────────
# Format ONLY when the disk carries no filesystem. `blkid` returning non-zero is
# the test. Getting this backwards reformats customer data on every reboot, so
# it is written to fail closed: if blkid says anything at all, we never format.
if ! blkid "$DEV" >/dev/null 2>&1; then
  log "no filesystem on $DEV — formatting (first boot only)"
  mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard "$DEV"
fi

mkdir -p "$DATA_MNT"
mountpoint -q "$DATA_MNT" || mount -o discard,defaults "$DEV" "$DATA_MNT"
# The container runs as uid 1000 (the `node` user in the image).
chown -R 1000:1000 "$DATA_MNT"

# ── 2. secrets ──────────────────────────────────────────────────────────────
# Fetched at boot with the instance's own service-account token. Nothing is
# baked into the image, and nothing lands on the persistent disk: the env file
# lives in /var/run (tmpfs) and dies with the instance.
TOKEN="$(curl -s -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"

if [ -z "$TOKEN" ]; then
  log "FATAL: no metadata token — cannot read secrets"
  exit 1
fi

umask 077
: > "$ENV_FILE"

for NAME in $SECRET_NAMES; do
  BODY="$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/$PROJECT_ID/secrets/$NAME/versions/latest:access" || true)"
  DATA="$(printf '%s' "$BODY" | tr -d '\n' | sed -n 's/.*"data": *"\([^"]*\)".*/\1/p')"

  if [ -z "$DATA" ]; then
    # Not fatal, deliberately. Several of these are legitimately unset — Qoyod
    # and Moyasar stay dormant until their keys exist, and config.js treats a
    # missing key as "feature off". An absent secret must not block boot.
    log "secret $NAME has no version — skipping"
    continue
  fi

  printf '%s=%s\n' "$NAME" "$(printf '%s' "$DATA" | base64 -d)" >> "$ENV_FILE"
done

cat >> "$ENV_FILE" <<ENVEOF
NODE_ENV=production
PORT=8787
DATA_DIR=/data
PUBLIC_BASE_URL=$PUBLIC_BASE_URL
ENVEOF

log "wrote $(wc -l < "$ENV_FILE") env lines"

# ── 3. containers ───────────────────────────────────────────────────────────
docker-credential-gcr configure-docker --registries="$${IMAGE%%/*}" || true
docker network inspect hjen >/dev/null 2>&1 || docker network create hjen

docker pull "$IMAGE"

docker rm -f hjen-server >/dev/null 2>&1 || true
docker run -d \
  --name hjen-server \
  --network hjen \
  --restart always \
  --log-driver gcplogs \
  --env-file "$ENV_FILE" \
  -v "$DATA_MNT:/data" \
  "$IMAGE"

# Caddy terminates TLS and obtains its own certificate. This is parity with the
# existing demo box, not a new pattern — and it keeps the deployment free of a
# GLOBAL load balancer, which would front a sovereign service from Google POPs
# outside the Kingdom.
mkdir -p /var/lib/caddy /etc/caddy
cat > /etc/caddy/Caddyfile <<CADDYEOF
$DOMAIN {
	encode zstd gzip
	reverse_proxy hjen-server:8787 {
		transport http {
			read_timeout 300s
			write_timeout 300s
		}
	}
}
CADDYEOF

docker rm -f caddy >/dev/null 2>&1 || true
docker run -d \
  --name caddy \
  --network hjen \
  --restart always \
  --log-driver gcplogs \
  -p 80:80 -p 443:443 \
  -v /var/lib/caddy:/data \
  -v /etc/caddy:/etc/caddy \
  caddy:2-alpine

log "up — https://$DOMAIN"
