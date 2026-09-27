# HJEN Studio

**The Saudi-DNA creative studio for film and campaign production** — a macOS desktop app that takes a project from brief to finished frames and videos through an eight-stage pipeline: Brief → References → Recast → Treatment → Screenplay → Assets → Frames → Videos.

> Private repository. All rights reserved — HJEN.

## What it does

- **Frame & Video making** — direct integrations with image and video engines (no aggregators), driven by a DOP-style language of selections and layer references.
- **Breakdown** — deconstructs any commercial into its full anatomy (13 axes): real cut detection, timestamped dialogue (ASR, Arabic-first), on-screen text OCR, per-shot master prompts, and a client-ready pack.
- **Storyboard** — script in, panels out: cast cards, per-shot frames, and asset continuity.
- **Creative Mind** — an immersive visual brainstorming canvas that turns a brief into territories and a big idea.
- **Film Space** — a browser-native 3D stage with a placeable mannequin and focal-true lenses; locks an angle into a reusable Angle Pack (plate, camera data, depth, outline, pose).
- **Emulsion** — a local, offline camera-emulation post layer (body × lens × stock) with self-calibration against a corpus of real cinema frames.
- **Node canvas** — a wired node engine for chaining tools into repeatable graphs.
- **MCP surface** — the studio is agent-drivable via [hjen-mcp](https://github.com/hjen-studio/hjen-mcp).

## Stack

| Layer | Technology |
|---|---|
| Shell | Electron (macOS) |
| UI | React + TypeScript + Vite |
| Local ML sidecars | Python (worldkit: depth, pose, segmentation, cuts) |
| Engines | Direct vendor APIs — image, video, and text models per task via a central model registry |

## Getting started

```bash
npm install
npm run dev        # development (Vite + Electron)
npm run build      # production build of both layers
```

Packaged builds are produced with electron-builder; ML sidecar paths are resolved inside the .app bundle.

## Repository layout

```
electron/     main & preload processes
src/          React app (components, lib, styles, stores)
worldkit/     Python ML sidecars (depth, pose, segmentation, cuts)
public/       static assets (filmspace, world vendor libs)
build/        packaging scripts and app icons
```

## Versioning

Releases are tracked in [VERSIONS.md](VERSIONS.md); milestone archives are kept outside this repository.
