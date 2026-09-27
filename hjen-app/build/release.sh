#!/bin/bash
# release.sh — build a HJEN Studio the user can actually open.
#
# WHY THIS EXISTS. `npx electron-builder` on its own produces a SIGNED but
# UNNOTARIZED app. macOS then refuses to open it — "Apple cannot check it for
# malicious software" — and the user has to walk to System Settings → Privacy
# & Security and press "Open Anyway". Every download did this.
#
# The cause was one line lost in forty of build output:
#
#     • skipped macOS notarization  reason=`notarize` options were unable to be generated
#
# electron-builder reads APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
# from the PROCESS ENVIRONMENT. They live in app/.env, which electron-builder
# never reads — so they were never in the environment, and notarization was
# skipped silently on every single build.
#
# So this script does three things the bare command does not:
#   1. loads .env into the environment before building,
#   2. refuses to start if any Apple credential is missing — rather than
#      building for ten minutes and shipping something Gatekeeper blocks,
#   3. VERIFIES the finished app with spctl and exits non-zero if it is not
#      notarized. A green log line is not proof; `spctl` is.
#
#   ./build/release.sh              → dmg + zip, notarized, verified
#   ./build/release.sh --no-publish → same, without touching GitHub releases
#   ./build/release.sh --prerelease → published, but as a pre-release: link-only,
#                                     no auto-update for anyone already installed
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# ── 1. credentials ─────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "✗ app/.env is missing. It holds the Apple notarization credentials." >&2
  exit 1
fi
set -a; . ./.env; set +a          # -a exports everything the file defines

missing=()
for v in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  [ -z "${!v:-}" ] && missing+=("$v")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "✗ Missing in app/.env: ${missing[*]}" >&2
  echo "  APPLE_APP_SPECIFIC_PASSWORD comes from appleid.apple.com (xxxx-xxxx-xxxx-xxxx)." >&2
  exit 1
fi
echo "✓ Apple credentials present — team $APPLE_TEAM_ID, id $APPLE_ID"

# A Developer ID certificate has to be in the keychain, or the build signs
# ad-hoc and notarization has nothing to attach to.
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "✗ No 'Developer ID Application' certificate in the keychain." >&2
  echo "  Import it from developer.apple.com, plus the Apple intermediates." >&2
  exit 1
fi
echo "✓ Developer ID certificate found"

# ── 1b. the binaries we SHIP ───────────────────────────────────────────────
# ffmpeg and yt-dlp ride inside the bundle so a fresh Mac works with nothing
# installed. They are not in git; without them the build silently reverts to
# "the user must install these themselves", which is the bug that started this.
for b in ffmpeg yt-dlp; do
  if [ ! -x "bin/$b" ]; then
    echo "✗ app/bin/$b is missing — the build would ship without it." >&2
    echo "  Run: ./build/fetch-tools.sh" >&2
    exit 1
  fi
done
echo "✓ bundled binaries present (ffmpeg, yt-dlp)"

# ── 2. build ───────────────────────────────────────────────────────────────
echo "→ building main process…"; npm run electron:build
echo "→ building renderer…";     npm run build:web

# PUBLISH IS THE POINT. A notarized build sitting in release/ reaches nobody:
# every installed copy asks GitHub for latest-mac.yml, and if the new version was
# never uploaded it correctly answers "up to date" forever. That is exactly what
# happened between 0.8.3 and 0.9.2 — four versions built, none published, every
# user still on 0.8.3 while their app dutifully checked in.
#
# (This script previously set PUBLISH="never" on BOTH branches, so `npm run
# release` could not publish even when asked. Default is now always.)
#
# A PRE-RELEASE reaches one named person, not the fleet. `--prerelease` marks the
# GitHub release as a prerelease AND relies on the tag carrying a semver
# prerelease suffix (v0.11.0-rc.1): electron-updater with allowPrerelease off —
# which is every shipped copy — skips both, so installed apps stay where they are
# and the build is downloadable by link only. Use it for hand-offs and RCs; a
# version everyone should get is a plain release.
PUBLISH="always"
PRERELEASE="no"
for arg in "$@"; do
  case "$arg" in
    --no-publish) PUBLISH="never" ;;
    --prerelease) PRERELEASE="yes" ;;
    *) echo "✗ unknown argument: $arg (expected --no-publish or --prerelease)" >&2; exit 1 ;;
  esac
done
if [ "$PUBLISH" = "always" ] && [ -z "${GH_TOKEN:-}" ]; then
  echo "✗ GH_TOKEN is missing from app/.env — the release cannot be uploaded." >&2
  echo "  Use --no-publish to build without publishing." >&2
  exit 1
fi

echo "→ packaging + notarizing (Apple's queue usually takes 2–15 minutes)…"
EB_ARGS=(--mac --publish "$PUBLISH")
if [ "$PRERELEASE" = "yes" ]; then
  # package.json pins releaseType:"release" and electron-builder ignores
  # EP_PRE_RELEASE once that is set, so the whole publish block is restated on
  # the command line — provider/owner/repo included, or the override would
  # replace the array with a releaseType and no destination.
  EB_ARGS+=(-c.publish.provider=github -c.publish.owner=hjen-studio
            -c.publish.repo=hjen-releases -c.publish.releaseType=prerelease)
  echo "  (publishing as a PRE-RELEASE — installed copies will not auto-update to it)"
fi
npx electron-builder "${EB_ARGS[@]}"

# ── 3. verify — the part that was missing ──────────────────────────────────
APP="release/mac-arm64/HJEN Studio.app"
[ -d "$APP" ] || APP="release/mac/HJEN Studio.app"
if [ ! -d "$APP" ]; then
  echo "✗ Could not find the built .app under release/." >&2
  exit 1
fi

echo
echo "── verifying $APP ──"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -2

# spctl is Gatekeeper's own answer, which is the only one that matters:
# "accepted / source=Notarized Developer ID" is a build a user can open.
verdict="$(spctl -a -vvv -t install "$APP" 2>&1 || true)"
echo "$verdict"

if echo "$verdict" | grep -q "source=Notarized Developer ID"; then
  for b in ffmpeg yt-dlp; do
    codesign --verify --strict "$APP/Contents/Resources/bin/$b" 2>/dev/null \
      && echo "  ✓ bundled $b is signed" \
      || echo "  ⚠ bundled $b is NOT signed — it will be blocked on a user's Mac" >&2
  done
  xcrun stapler validate "$APP" >/dev/null 2>&1 \
    && echo "✓ NOTARIZED and stapled — opens with no Gatekeeper warning, online or off." \
    || echo "⚠ Notarized but no stapled ticket — it will still warn on a machine that is offline."
else
  echo "✗ NOT notarized. This build will show users the 'unidentified developer' warning." >&2
  echo "  Read the electron-builder output above for the notarization error." >&2
  exit 1
fi

ls -lh release/*.dmg release/*.zip 2>/dev/null || true

# ── 4. did it actually LAND? ───────────────────────────────────────────────
# electron-builder has dropped a large asset on a network blip before, leaving a
# release with only the tiny blockmaps — which looks like success in the log and
# serves a broken update to every user. Ask GitHub what it really has.
if [ "$PUBLISH" = "always" ]; then
  echo
  echo "── checking the published release ──"
  VER="$(node -p "require('./package.json').version")"
  API="https://api.github.com/repos/hjen-studio/hjen-releases/releases/tags/v$VER"
  ASSETS="$(curl -sf -H "Authorization: Bearer $GH_TOKEN" "$API" | node -e "
    let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
      try { const r = JSON.parse(s);
        for (const a of (r.assets||[])) console.log(a.name + '\t' + a.size);
      } catch { /* release not found yet */ }
    });" || true)"
  if [ -z "$ASSETS" ]; then
    echo "⚠ No release found for tag v$VER — it may still be a draft. Check GitHub." >&2
  else
    echo "$ASSETS" | awk -F'\t' '{printf "  %-46s %6.0f MB\n", $1, $2/1000000}'
    for need in "-mac.zip" ".dmg" "latest-mac.yml"; do
      echo "$ASSETS" | grep -q -- "$need" \
        || echo "  ✗ MISSING from the release: *$need — updates will fail for users" >&2
    done
    # An asset under a megabyte that should be hundreds is a dropped upload.
    echo "$ASSETS" | awk -F'\t' '$1 ~ /\.(zip|dmg)$/ && $2 < 1000000 {
      printf "  ✗ %s uploaded as only %d bytes — re-upload it\n", $1, $2 }' >&2
  fi
fi
