#!/bin/bash
# make-icns.sh — turn build/appicon.png (square ~1024px, the HJEN H mark) into a
# full macOS AppIcon.icns (all retina sizes via sips + iconutil).
# Output: build/appicon.icns  — referenced by package.json build.mac.icon and
# copied into the launcher .app as Resources/AppIcon.icns.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/appicon.png"
OUT="$HERE/appicon.icns"

if [ ! -f "$SRC" ]; then
  echo "ERROR: $SRC not found. Drop the 1024x1024 HJEN icon there first." >&2
  exit 1
fi

WORK="$(mktemp -d)"
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"

# name          size
gen() { sips -z "$2" "$2" "$SRC" --out "$ICONSET/$1" >/dev/null; }
gen "icon_16x16.png"        16
gen "icon_16x16@2x.png"     32
gen "icon_32x32.png"        32
gen "icon_32x32@2x.png"     64
gen "icon_128x128.png"      128
gen "icon_128x128@2x.png"   256
gen "icon_256x256.png"      256
gen "icon_256x256@2x.png"   512
gen "icon_512x512.png"      512
gen "icon_512x512@2x.png"   1024

iconutil -c icns "$ICONSET" -o "$OUT"
rm -rf "$WORK"
echo "OK: wrote $OUT"
