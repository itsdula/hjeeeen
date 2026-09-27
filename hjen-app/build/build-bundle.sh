#!/bin/bash
# build-bundle.sh — build the STANDALONE "HJEN Studio.app": a real renamed copy
# of the bundled Electron.app whose app code is a LIVE symlink into the repo, so
# the menu-bar/dock name reads "HJEN Studio" AND every `build` is live on the
# next open with no re-packaging.
#
# Live-dist mechanism: Contents/Resources/app -> <repo>/app. Electron loads that
# dir's package.json (main = dist-electron/main.js), so the repo's real main
# process runs (single-instance lock + dock.setIcon intact) and it loadFile()s
# the repo's live dist/index.html.
set -e
APP_DIR="/Users/befilmz/Downloads/HJEN BRAND/02_PRODUCT/desktop_app/app"
ELECTRON_APP="$APP_DIR/node_modules/electron/dist/Electron.app"
OUT_DIR="/Users/befilmz/Downloads/HJEN BRAND/02_PRODUCT/desktop_app/dist_app"
STAGE="/tmp/hjen-bundle-build"
NAME="HJEN Studio"

rm -rf "$STAGE"; mkdir -p "$STAGE"
echo "1/6  copying Electron.app -> $NAME.app ..."
ditto "$ELECTRON_APP" "$STAGE/$NAME.app"
APP="$STAGE/$NAME.app"
xattr -cr "$APP" 2>/dev/null || true

echo "2/6  renaming main binary + patching Info.plist ..."
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$NAME"
PL="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $NAME" "$PL"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $NAME" "$PL" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string $NAME" "$PL"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $NAME" "$PL"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ai.hjen.studio" "$PL"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile appicon" "$PL" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string appicon" "$PL"

echo "3/6  baking the H icon ..."
if [ -f "$APP_DIR/build/appicon.icns" ]; then
  cp "$APP_DIR/build/appicon.icns" "$APP/Contents/Resources/appicon.icns"
else
  echo "  ! build/appicon.icns missing — run build/apply-icon.sh first" >&2; exit 1
fi
rm -f "$APP/Contents/Resources/electron.icns"

echo "4/6  wiring live dist (Resources/app -> repo) ..."
rm -rf "$APP/Contents/Resources/app" "$APP/Contents/Resources/app.asar"
ln -s "$APP_DIR" "$APP/Contents/Resources/app"

echo "5/6  ad-hoc signing ..."
codesign --force --deep -s - "$APP" >/dev/null 2>&1 || codesign --force -s - "$APP"

echo "6/6  installing ..."
mkdir -p "$OUT_DIR"
rm -rf "$OUT_DIR/$NAME.app"; ditto "$APP" "$OUT_DIR/$NAME.app"
rm -rf "/Applications/$NAME.app" "$HOME/Applications/$NAME.app"
if ditto "$APP" "/Applications/$NAME.app" 2>/dev/null; then DEST="/Applications/$NAME.app"; else
  mkdir -p "$HOME/Applications"; ditto "$APP" "$HOME/Applications/$NAME.app"; DEST="$HOME/Applications/$NAME.app"; fi
codesign --force --deep -s - "$DEST" >/dev/null 2>&1 || true
touch "$DEST"; killall Dock >/dev/null 2>&1 || true

echo "DONE. Standalone bundle installed: $DEST"
