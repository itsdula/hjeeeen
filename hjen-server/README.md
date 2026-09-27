# HJEN Studio — Gated Web Demo (Soft Launch backend)

The soft-launch vehicle. It ports the **generation core** of the desktop app behind an **invitee gate** so you can:

- invite specific people by **magic link** (no install, no password, no Gatekeeper),
- cap **how many makes each account gets** (the per-account quantity lever),
- give a **15-day default window** per invite — **extend or stop anytime**,
- **measure** activation / depth / spend per invitee from `/admin`.

Keys live **server-side only** (env). They are never sent to the browser — this fixes the desktop app's `dangerouslyAllowBrowser` key exposure.

## What it ports (and what it doesn't)
Ported from `electron/main.ts` + `src/lib/openai.ts`:
- `POST /api/make` — gpt-image-2 (`images.generate` / `images.edit`) — the metered core
- `POST /api/enhance` — Claude Refine (`claude-sonnet-4-6`)
- `POST /api/skill/run` + `GET /api/skills` — non-interactive skills (drop `.md` files in `data/skills/`)
- `POST /api/refs` — reference upload

**Superseded — read this before quoting the line above.** The list above describes
`public/studio.html`, the standalone demo surface. It is **no longer the whole
story.** Since the Full-HJEN-on-Web work (`serveStudio`, `src/server.js`), this
server also mounts the **complete desktop React renderer** at `/studio/` — the
same built bundle the .app ships, with a cloud `window.hjen` adapter
(`public/webapp/adapter.js`) swapped in for Electron's local disk. On that
surface the **8-stage project pipeline, the storyboard, the node graph, the
asset factories and per-account persistent projects all run in the browser.**

So: `studio.html` is the minimal metered demo. `/studio/` is the product. Do not
cite this section as evidence that the cloud vehicle has no pipeline — it has
one.

What genuinely remains desktop-only: local filesystem tools that have no
browser equivalent (ffmpeg/yt-dlp-backed surfaces) and crash recovery from
local sidecars.

## Run — zero install
No dependencies. Runs on Node 18+. If `node` isn't on your PATH, `run.sh` falls
back to the Electron node already bundled in `../app`.

```bash
cd server
cp .env.example .env          # fill OPENAI_API_KEY, ANTHROPIC_API_KEY, ADMIN_TOKEN
./run.sh                      # http://localhost:8787  (admin at /admin)
# or, if you have node:  node src/server.js
```

## Create an invitee
Two ways — CLI or the `/admin` page.

```bash
./run.sh src/cli.js create --email peer@example.com --name "Anwar" --limit 40 --days 15 --wave 1
# prints the MAGIC LINK → send it in the authoring email
./run.sh src/cli.js list
./run.sh src/cli.js extend --id <id> --days 7
./run.sh src/cli.js stop --id <id>
./run.sh src/cli.js bump --id <id> --makes 10
# (with node on PATH:  node src/cli.js list)
```

## The gate, exactly
- **Quantity:** `genLimit` is a hard cap. The make is reserved up-front and **refunded if the provider fails**, so failed makes never burn quota.
- **Duration:** `durationDays` (default 15) → `expiresAt`. Auto-expires; extend/stop from `/admin` or CLI.
- **Revoke:** stop = `active:false` cuts access instantly.
- **Cost backstop:** also set a hard monthly spend limit on the OpenAI + BytePlus dashboards behind the counter.

## 8-step smoke test (run before any invite)
1. `./run.sh src/cli.js create --email test@hjen.ai --limit 3 --days 15` → open the magic link.
2. Studio loads with no password; meter shows `3 remaining`.
3. Make 3 frames → they appear in the gallery with a download link.
4. Make the 4th → **blocked** ("وصلت سقف اللقطات").
5. `./run.sh src/cli.js stop --id <id>` → reopen the link → **blocked**.
6. Open `/admin` → counter reads `3/3`, activated ✓, spend shown.
7. Check the OpenAI dashboard → spend within the backstop cap.
8. Browser Network tab on `/api/make` → **no API key** anywhere in requests/responses.

## Next slice (not in this build)
Swap the desktop React UI (`../app/src`) onto this API via a new `src/lib/api.ts` HTTP client replacing `window.hjen`, then host (Render/Fly + R2). For the smoke test and a curated soft launch, the bundled `public/studio.html` is a working, on-brand make surface.
