// driveApp — the MCP → running-app command bridge. POSTs a REAL action to the
// app's control port (/command), which runs the app's OWN store action LIVE (the
// user watches) and answers back with the result. This is how the MCP stops
// re-implementing tools and instead "drives the real Studio," per the director
// model. Returns null when the app is NOT running (caller falls back to headless).

import fs from 'node:fs';
import path from 'node:path';
import type { Host } from './host.js';

export interface DriveResult { ok: boolean; reason?: string; [k: string]: unknown }

function controlPort(host: Host): number | null {
  try {
    const f = path.join(host.userDataDir(), 'mcp-control.json');
    if (!fs.existsSync(f)) return null;
    const { port } = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return typeof port === 'number' ? port : null;
  } catch { return null; }
}

/** True if a Studio app is currently reachable on the control port. */
export function appIsRunning(host: Host): boolean {
  return controlPort(host) !== null;
}

/**
 * Drive one real app action. Resolves to the renderer's JSON result, or null if
 * the app isn't running / unreachable (so the caller can headless-fallback).
 * timeoutMs must be generous — a real make can take tens of seconds.
 */
export async function driveApp(host: Host, action: string, args: Record<string, unknown> = {}, timeoutMs = 600_000): Promise<DriveResult | null> {
  const port = controlPort(host);
  if (!port) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, args }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    return (await res.json()) as DriveResult;
  } catch (err: any) {
    // ECONNREFUSED etc. → the port file is stale (app closed): treat as not running.
    if (err?.name === 'AbortError') return { ok: false, reason: 'timeout' };
    return null;
  } finally { clearTimeout(t); }
}
