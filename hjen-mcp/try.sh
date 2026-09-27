#!/usr/bin/env bash
# Try the HJEN MCP end-to-end without a new Claude session.
#   ./try.sh          # read (real projects) + write (throwaway sandbox)
#   ./try.sh read     # only the read tools, on your real projects
#   ./try.sh write    # only the write tools, on a temp sandbox
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/../app"
ELECTRON="$APP/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

[ -f "$HERE/dist/index.js" ] || { echo "Not built — running build.sh first…" >&2; "$HERE/build.sh"; }

exec env -u ELECTRON_RUN_AS_NODE ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$HERE/scripts/selftest.mjs" "$HERE/run.sh" "${1:-all}"
