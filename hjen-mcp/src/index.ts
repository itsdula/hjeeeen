#!/usr/bin/env node
// hjen-mcp — HJEN Studio as an MCP server (zero-dependency; runs on Electron's
// bundled node with nothing installed, same as server/).
//
// ONE server, three surfaces (all consume this same process):
//   ① external agent  — Claude Code/Desktop over stdio (this entry)
//   ② in-app agent    — the Studio's Assistant panel (in-process)
//   ③ external MCP    — HJEN mounts other MCP servers into its pipeline
// The hosted HTTP + OAuth transport (Phase 4) lives in http/serve-http.ts and
// shares the SAME server via buildServer().

import { createNodeHost } from './host-node.js';
import { buildServer } from './server-factory.js';

async function main() {
  const host = createNodeHost();
  const server = buildServer(host);
  console.error(`[hjen-mcp] ready · projectsRoot=${host.projectsRoot()}`);
  await server.serveStdio();
}

main().catch((err) => {
  console.error('[hjen-mcp] fatal', err);
  process.exit(1);
});
