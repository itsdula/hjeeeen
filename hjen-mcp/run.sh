#!/usr/bin/env bash
# Launch the HJEN MCP server on Electron's bundled node (no global node needed).
# This is the command to hand to `claude mcp add`:
#   claude mcp add hjen -- "/abs/path/to/mcp/run.sh"
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/../app"
ELECTRON="$APP/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
ENTRY="$HERE/dist/index.js"

[ -x "$ELECTRON" ] || { echo "Electron not found at $ELECTRON — run 'npm install' in ../app first." >&2; exit 1; }
[ -f "$ENTRY" ] || { echo "Not built. Run $HERE/build.sh first." >&2; exit 1; }

# The imagery + copy bibles behind hjen://dna and hjen://register. Respect an
# already-exported override; else point at the canonical repo files.
BRAND_ROOT="$(cd "$HERE/../../.." && pwd)"
: "${HJEN_DNA_FILE:=$BRAND_ROOT/01_IDENTITY/style_bibles/Saudi_DNA_Clay_Basil_Style_Bible.md}"
: "${HJEN_REGISTER_FILE:=$BRAND_ROOT/00_COMPANY/cloud_mind/04_COPY_DNA_Saudi_Novelist.md}"
export HJEN_DNA_FILE HJEN_REGISTER_FILE

# ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain node. `env -u`
# first clears any inherited value so a leaked var can't break the launch.
exec env -u ELECTRON_RUN_AS_NODE ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$ENTRY"
