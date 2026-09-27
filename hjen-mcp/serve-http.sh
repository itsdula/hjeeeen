#!/usr/bin/env bash
# Launch the HOSTED HJEN MCP (HTTP + OAuth) on Electron's bundled node.
# Front with a TLS reverse proxy for public HTTPS (see Caddyfile.example).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/../app"
ELECTRON="$APP/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
ENTRY="$HERE/dist/http/serve-http.js"

# Load mcp/.env if present (PORT, PUBLIC_BASE_URL, keys, HJEN_MCP_*).
if [ -f "$HERE/.env" ]; then set -a; . "$HERE/.env"; set +a; fi

[ -x "$ELECTRON" ] || { echo "Electron not found at $ELECTRON — run 'npm install' in ../app first." >&2; exit 1; }
[ -f "$ENTRY" ] || { echo "Not built. Run $HERE/build.sh first." >&2; exit 1; }

exec env -u ELECTRON_RUN_AS_NODE ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$ENTRY"
