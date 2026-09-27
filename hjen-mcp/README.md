# hjen-mcp — HJEN Studio as an MCP server

One MCP server that makes the whole studio agent-drivable — like Martini's and Higgsfield's MCPs, but **zero-dependency**: it runs on Electron's bundled node with **nothing installed** (no `@modelcontextprotocol/sdk`, no `zod`, no npm), the same ethos as `../server/`.

Same server, **three surfaces**:
1. **External agent → HJEN** — drive HJEN from Claude Code / Desktop over stdio (this phase).
2. **In-app agent** — the Studio's "Assistant" panel calls the same tools (Phase 3).
3. **HJEN → external MCP** — HJEN mounts other MCP servers into its pipeline (Phase 3).

It reads the **project contract** (8-stage state + ledger), storyboard, node graph, generations, library, and cast straight from the same JSON files the desktop app owns — so it understands each project, then (later phases) orchestrates the tools.

## What ships now (Phase 0 — orient layer)

**Resources**
- `hjen://projects` — the project index
- `hjen://project/{id|slug|name}` — the full contract for one project
- `hjen://models` — the frame/video model registry
- `hjen://dna`, `hjen://register` — the imagery + copy bibles (point env vars at the files)

**Tools — read / orient (Phase 0)**
- `hjen_projects_list` — list projects (start here)
- `hjen_project_overview` — the whole contract in one read (orient before acting)
- `hjen_storyboard_read`, `hjen_graph_read`, `hjen_generations_list`, `hjen_models_list`

**Tools — author the contract (Phase 1)**
- `hjen_project_create` — new project (folder + seeded 8-stage state)
- `hjen_stage_write` — write a stage's data JSON (+ Brief/Treatment `.md` companion)
- `hjen_stage_sign` — sign / unsign a stage (the PPM lock); `hjen_stage_set_current`
- `hjen_ledger_add` — append a note / risk / open-item
- `hjen_storyboard_shot_upsert` — create/update a panel (atomic write + backup)
- `hjen_graph_upsert` — merge node-graph nodes + edges (atomic write + backup)
- `hjen_asset_get` — resolve a path → exists/size/mime + deep-link

All writes are atomic (tmp+rename), storyboard/graph writes keep throttled/deduped backups, and a populated board/graph is never clobbered by an empty one.

**Tools — make (Phase 2, paid — cost-guarded)**
- `hjen_frame_make` — make a still (gpt-image-2), saved into the project + logged to Usage
- `hjen_portrait_refine` — refine an image (gpt-image-2 edit; minimum intervention)
- `hjen_video_make` — animate a still (Seedance 2.0); **async → returns a jobId**
- `hjen_job_get`, `hjen_job_wait` — track async jobs

**COST GUARD:** every make tool is a dry-run that returns an `estimateUsd` unless you pass `confirm: true`. Nothing is spent (and nothing saved) without explicit confirmation. Frame/refine are zero-dep OpenAI REST; video is zero-dep BytePlus ARK REST with server-side polling. (NANO_BANANA_PRO / Google is not yet available headless.)

**Tools — orchestrate (Phase 3a — the "speed between tools" layer)**
- `hjen_chain_run` — Frame → Refine → Video in one call (outputs thread automatically)
- `hjen_storyboard_shot_make` — make a panel from its shot's §6.1 fields, write the image + a take back into the board
- `hjen_graph_run` — run a project's node graph (frame nodes, then video nodes anchored on upstream frames)

Same cost guard. Built on the shared `make-core` so they never drift from the make tools.

**Prompts (PPM canon)**
- `hjen_ppm_pipeline` · `hjen_frame_brief` (the 8-element template) · `hjen_casting_brief` · `hjen_dna_lock`

## Build & run (no global node/npm required)

```bash
cd "02_PRODUCT/desktop_app/mcp"
./build.sh          # compiles src -> dist using the app's tsc on Electron's node
./run.sh            # launches the server on Electron's node (stdio)
```

`build.sh`/`run.sh` locate Electron at `../app/node_modules/electron/…` — so `npm install` must have been run once in `../app` (it has, for the desktop app). Nothing else is installed.

It auto-discovers the desktop app's data:
- **projects root** — `settings.json.projectsRoot` or `~/Pictures/HJEN Studio`
- **keys** — env (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `ARK_API_KEY`) or the app's `{userData}/*_key.txt`

Overrides: `HJEN_PROJECTS_ROOT`, `HJEN_USERDATA`, `HJEN_DNA_FILE`, `HJEN_REGISTER_FILE`.

## Add to Claude Code

```bash
claude mcp add hjen --scope user -- "/absolute/path/to/02_PRODUCT/desktop_app/mcp/run.sh"
```

Then, in a session: `hjen_projects_list` → `hjen_project_overview <project>`.
(Remove with `claude mcp remove hjen -s user`.)

## Layout

```
src/
  mcp/server.ts  # zero-dep MCP core (JSON-RPC 2.0 over stdio)
  host.ts        # the Host seam (shared with the desktop app engine)
  host-node.ts   # Node host — resolves userData/projectsRoot/keys headlessly
  paths.ts       # on-disk path builders (1:1 mirror of electron/main.ts)
  types.ts       # read-shapes mirrored from the app
  projects.ts    # readers + buildOverview() (the contract assembler)
  models.ts      # model registry (abstraction layer)
  deeplinks.ts   # hjen-studio:// links
  resources.ts   # MCP resources
  tools/read.ts  # read / orient tools
  index.ts       # entry (stdio)
```

## Roadmap

- **Phase 1 ✅** — author the contract (project/stage/ledger/storyboard/graph writes) + `hjen_asset_get`.
- **Phase 2 ✅** — make (`hjen_frame_make`, `hjen_portrait_refine`, `hjen_video_make` + job registry), cost-guarded, zero-dep REST providers.
- **Phase 3a ✅** — orchestrate (`hjen_chain_run`, `hjen_storyboard_shot_make`, `hjen_graph_run`) + PPM prompts.
- **Phase 3b ✅** — in-app Assistant panel (surface ②, `AssistantPanel.tsx` + `mcp/src/agent/`), Electron control port + `hjen-studio://` protocol + live hot-reload, external-MCP mount (surface ③, `mcp/src/agent/mount.ts`, config `{userData}/mcp-servers.json`).
- **Phase 4 ✅** — hosted **Streamable-HTTP + full OAuth 2.1** (`mcp/src/http/`, reuses the invitee-gate) + the 3-tab **MCP Hub** UI. Public TLS cutover (domain/VPS/cert) is the operator's ops step; built deploy-ready + proven on localhost.

## The three surfaces (all live)
1. **External agent → HJEN** — `claude mcp add hjen` (stdio) OR the **hosted** endpoint (`./serve-http.sh` → `http://127.0.0.1:8788/mcp`, OAuth 2.1 or static Bearer). 22 tools + prompts.
2. **In-app Assistant** — open the **MCP** tile in HJEN Studio (the 3-tab Hub); the **Assistant** tab is a Claude agent driving the same tools on your canvas.
3. **HJEN → external MCP** — the Hub's **External servers** tab (or `{userData}/mcp-servers.json`, `[{name, command, args?}]`); the in-app agent mounts those tools too (prefixed `ext__<name>__`).

## Hosted endpoint (Phase 4)
```bash
cp .env.example .env         # set PUBLIC_BASE_URL, HJEN_MCP_DEV_TOKEN (dev), keys
./build.sh && ./serve-http.sh   # → http://127.0.0.1:8788/mcp
```
- **OAuth 2.1** (self-issued): `/register` (DCR) · `/oauth/authorize` (PKCE-S256 + consent screen that takes your HJEN token) · `/oauth/token`; `.well-known/oauth-protected-resource` + `oauth-authorization-server`; unauth → `401` + `WWW-Authenticate`.
- **Static Bearer** fallback: the invitee magic token (or `HJEN_MCP_DEV_TOKEN`) as `Authorization: Bearer`.
- **Metering:** paid `*_make` (confirm) tools need the `mcp:write` scope and decrement the invitee's quota.
- **Public:** front with TLS via `Caddyfile.example` (auto-TLS) at `https://<domain>/mcp`.
