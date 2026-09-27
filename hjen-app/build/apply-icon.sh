#!/bin/bash
# apply-icon.sh — ONE command to (re)finish the HJEN icon after build/appicon.png
# (square ~1024x1024, the halftone H mark) has been dropped/updated in place.
#
# Steps: appicon.png -> appicon.icns -> rebuild the STANDALONE bundle with the
# icon baked (build-bundle.sh installs it to /Applications and refreshes caches).
# The runtime dock icon (app.dock.setIcon) also reads appicon.png directly, so it
# refreshes for `electron .` dev runs the moment the file changes.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"          # .../app/build

if [ ! -f "$HERE/appicon.png" ]; then
  echo "ERROR: $HERE/appicon.png not found. Drop the 1024x1024 HJEN icon there, then re-run." >&2
  exit 1
fi

echo "1/2  building appicon.icns ..."
bash "$HERE/make-icns.sh"

echo "2/2  rebuilding + installing the standalone bundle with the icon ..."
bash "$HERE/build-bundle.sh"

echo "DONE."
