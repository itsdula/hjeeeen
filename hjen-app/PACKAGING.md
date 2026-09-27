# HJEN Studio — Distributable Packaging Runbook

How to build a **signed + notarized** `HJEN Studio.dmg` that opens cleanly on any Mac.
Run these when the Apple Developer account is approved. Claude guides each step; you execute.

## Two build paths — do not confuse them
- **`build/build-bundle.sh` = DEV ONLY.** It symlinks the app to this repo and ad-hoc signs it.
  It works only on this machine and breaks if copied. **Never distribute it.**
- **`npm run build` (electron-builder) = THE DISTRIBUTABLE.** Bundles a self-contained
  `.app`/`.dmg`, signs with your Developer ID, and notarizes. This is the one to ship.

## Prerequisites (one-time)
1. **Node.js LTS** installed (this machine has none yet) — download the LTS `.pkg` from
   nodejs.org and install. Verify: `node -v` and `npm -v` print versions.
2. **Apple Developer Program approved** (the "Welcome" email arrived).
3. **Developer ID Application certificate** in your login keychain.
   - developer.apple.com → Certificates → **+** → **Developer ID Application** → follow the CSR
     steps (Claude will walk this when you're here), download, double-click to install.
   - Verify: `security find-identity -v -p codesigning` lists
     `Developer ID Application: <Your Name> (<TEAMID>)`.
4. **App-specific password** for notarization:
   - appleid.apple.com → Sign-In & Security → App-Specific Passwords → **+** → name it "hjen-notarize".
   - Note your **Team ID** (developer.apple.com → Membership).

## Already configured in this repo (done)
- `package.json` → `build.mac`: `hardenedRuntime`, `entitlements`, `entitlementsInherit`,
  `gatekeeperAssess:false`.
- `build/entitlements.mac.plist`: JIT / network / user-files entitlements Electron needs.
- electron-builder auto-detects the Developer ID cert from the keychain — no identity to hardcode.

## Build steps (at package time)
```bash
cd "/Users/befilmz/Downloads/HJEN BRAND/02_PRODUCT/desktop_app/app"

# 1. deps (already installed; re-run only if node_modules was cleared)
npm install

# 2. notarization credentials for this shell
export APPLE_ID="admin@hjen.ai"                       # the Apple ID on the developer account
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # the app-specific password from step 4
export APPLE_TEAM_ID="XXXXXXXXXX"                     # your Team ID

# 3. enable notarize for this build, then build
#    (either add  "notarize": true  under build.mac in package.json,
#     or pass it once on the CLI:)
npx electron-builder --mac --config.mac.notarize=true
```
Output: `release/HJEN Studio-<version>-arm64.dmg` — signed + notarized.

## Verify before sending to anyone
```bash
APP="release/mac-arm64/HJEN Studio.app"
codesign -dv --verbose=4 "$APP"      # Authority should read "Developer ID Application: …"
spctl -a -vvv "$APP"                 # should say: accepted, source=Notarized Developer ID
```

## Notes
- **Architecture:** default build is `arm64` (Apple Silicon). For Intel Macs too, build
  `--arm64 --x64` (two DMGs) or set `arch: ["universal"]` — decide when we size the audience.
- **Windows:** a separate `--win` build + its own code-signing cert (or accept SmartScreen
  "More info → Run anyway" initially). Not covered here.
- The app routes AI through the HJEN gateway; testers connect it via Settings → the gateway
  link (server-side funded keys). No provider keys ship in the binary.
