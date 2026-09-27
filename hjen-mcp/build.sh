#!/usr/bin/env bash
# Compile src/ -> dist/ with the desktop app's bundled TypeScript, running on
# Electron's bundled node. Zero global installs required.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/../app"
ELECTRON="$APP/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
TSC="$APP/node_modules/typescript/bin/tsc"

[ -x "$ELECTRON" ] || { echo "Electron not found at $ELECTRON — run 'npm install' in ../app first." >&2; exit 1; }
[ -f "$TSC" ] || { echo "tsc not found at $TSC." >&2; exit 1; }

echo "[hjen-mcp] compiling…" >&2
env -u ELECTRON_RUN_AS_NODE ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$TSC" -p "$HERE/tsconfig.json"
echo "[hjen-mcp] built -> $HERE/dist" >&2
