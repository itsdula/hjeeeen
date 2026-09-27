// The invitee-gate for the hosted endpoint — a headless mirror of
// server/src/store.js, reading the SAME invitees.json (point HJEN_MCP_DATA_DIR
// at the server's data dir). The magic token doubles as a static Bearer token,
// and the OAuth flow binds its issued tokens to an invitee id for metering.
// Zero-dep; atomic writes; serialized read-modify-write so the quota is race-free.

import fs from 'node:fs';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Invitee {
  id: string; email: string; name: string; magicToken: string;
  genLimit: number; genUsed: number; expiresAt: number; active: boolean;
  [k: string]: unknown;
}

export function dataDir(): string {
  return process.env.HJEN_MCP_DATA_DIR?.trim() || path.join(process.cwd(), 'data');
}
const inviteesPath = () => path.join(dataDir(), 'invitees.json');

function readInvitees(): Invitee[] {
  try { const f = inviteesPath(); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : []; }
  catch { return []; }
}
function writeInvitees(list: Invitee[]): void {
  const f = inviteesPath();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, f);
}

let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => T): Promise<T> {
  const run = chain.then(() => fn());
  chain = run.catch(() => undefined);
  return run;
}

export const getByToken = (token: string): Invitee | null => (token ? readInvitees().find(i => i.magicToken === token) ?? null : null);
export const getById = (id: string): Invitee | null => readInvitees().find(i => i.id === id) ?? null;

export interface GateStatus { ok: boolean; reason?: string; remaining: number; daysLeft: number }
export function gateStatus(inv: Invitee): GateStatus {
  const remaining = Math.max(0, inv.genLimit - inv.genUsed);
  const daysLeft = Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / DAY_MS));
  if (!inv.active) return { ok: false, reason: 'inactive', remaining, daysLeft };
  if (Date.now() >= inv.expiresAt) return { ok: false, reason: 'expired', remaining, daysLeft };
  if (inv.genUsed >= inv.genLimit) return { ok: false, reason: 'exhausted', remaining, daysLeft };
  return { ok: true, remaining, daysLeft };
}

export function consumeMake(token: string): Promise<{ ok: boolean; reason?: string; invitee?: Invitee }> {
  return withLock(() => {
    const list = readInvitees();
    const inv = list.find(i => i.magicToken === token);
    if (!inv) return { ok: false, reason: 'not_found' };
    const s = gateStatus(inv);
    if (!s.ok) return { ok: false, reason: s.reason };
    inv.genUsed += 1;
    writeInvitees(list);
    return { ok: true, invitee: inv };
  });
}
export function refund(token: string): Promise<void> {
  return withLock(() => {
    const list = readInvitees();
    const inv = list.find(i => i.magicToken === token);
    if (inv && inv.genUsed > 0) { inv.genUsed -= 1; writeInvitees(list); }
  });
}

/** A superuser token for local dev / the operator, when no invitees.json exists.
 *  Set HJEN_MCP_DEV_TOKEN to enable an unmetered bearer. */
export const devToken = (): string | null => process.env.HJEN_MCP_DEV_TOKEN?.trim() || null;
