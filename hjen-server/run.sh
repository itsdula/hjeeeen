#!/usr/bin/env bash
# Run the gated demo with whatever node is available. If `node` isn't on PATH
# (common on this machine), fall back to Electron's bundled node via
# ELECTRON_RUN_AS_NODE. Usage:
#   ./run.sh                 # start the server
#   ./run.sh src/cli.js list # run the CLI (or any script)
set -euo pipefail
cd "$(dirname "$0")"

ENTRY="${1:-src/server.js}"
shift || true

if command -v node >/dev/null 2>&1; then
  exec node "$ENTRY" "$@"
fi

ELECTRON="../app/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ -x "$ELECTRON" ]; then
  exec env ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$ENTRY" "$@"
fi

echo "No node and no Electron bundled node found. Install Node 18+ or build the desktop app first." >&2
exit 1
