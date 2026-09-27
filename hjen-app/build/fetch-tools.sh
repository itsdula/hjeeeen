#!/bin/bash
# fetch-tools.sh — populate app/bin with the binaries the app SHIPS.
#
# ffmpeg and yt-dlp used to be the user's problem: a tester's Mac had neither, so
# Cuts answered `spawn yt-dlp ENOENT` and Ad Breakdown died the same way. They now
# ride inside the bundle at Resources/bin, which tools.ts searches FIRST — so the
# app works out of the box and only falls back to a user's own copy if ours is
# somehow gone.
#
# They are NOT in git (79MB), so a fresh checkout runs this once. release.sh
# refuses to build without them rather than quietly shipping the old failure.
#
# Requirements for a copy to be shippable:
#   · arm64 (the build target),
#   · linked ONLY against /usr/lib and /System/Library — a Homebrew ffmpeg that
#     links /opt/homebrew/lib/*.dylib runs here and nowhere else,
#   · no quarantine attributes, or codesign fails.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$APP_DIR/bin"
mkdir -p "$BIN"

# Where to look for an existing good copy on this machine.
SOURCES=("$HOME/.local/bin" "/opt/homebrew/bin" "/usr/local/bin")

portable() {                       # $1 = binary path
  # Only the INDENTED lines are dependencies. A universal binary prints one
  # "path (architecture arm64):" header per slice, and treating those as
  # dependencies flagged a perfectly portable yt-dlp as unshippable.
  ! otool -L "$1" 2>/dev/null | grep '^\s' | grep -qvE '/usr/lib|/System/Library'
}

take() {                           # $1 = name
  local name="$1" src=""
  for d in "${SOURCES[@]}"; do
    if [ -x "$d/$name" ]; then src="$d/$name"; break; fi
  done
  if [ -z "$src" ]; then
    echo "✗ $name not found on this Mac. Install it first (brew install $name), then re-run." >&2
    return 1
  fi
  if ! portable "$src"; then
    echo "✗ $src links non-system libraries — it would fail on any other Mac." >&2
    echo "  Use a static build (evermeet.cx for ffmpeg, the official yt-dlp release)." >&2
    return 1
  fi
  cp "$src" "$BIN/$name"
  chmod +x "$BIN/$name"
  xattr -cr "$BIN/$name" 2>/dev/null || true
  echo "✓ $name  ← $src  ($(du -h "$BIN/$name" | cut -f1), $(lipo -info "$BIN/$name" 2>/dev/null | sed 's/.*: //'))"
}

take ffmpeg
take yt-dlp
echo
echo "app/bin is ready. These are signed and notarized as part of the app by build/release.sh."
