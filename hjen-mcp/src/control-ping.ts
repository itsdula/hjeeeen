// Best-effort nudge to a running HJEN Studio: when the MCP writes a project doc,
// ping the app's control port (published at {userData}/mcp-control.json) so the
// open app hot-reloads the exact doc. Silent no-op if the app isn't running.

import fs from 'node:fs';
import path from 'node:path';
import type { Host } from './host.js';

export function pingControl(host: Host, body: { projectId?: string | null; kind: string }): void {
  try {
    const f = path.join(host.userDataDir(), 'mcp-control.json');
    if (!fs.existsSync(f)) return;
    const { port } = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (!port) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 600);
    void fetch(`http://127.0.0.1:${port}/reload`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    }).catch(() => {}).finally(() => clearTimeout(t));
  } catch { /* best-effort */ }
}
