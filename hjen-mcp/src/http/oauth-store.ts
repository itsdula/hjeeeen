// OAuth 2.1 state — clients (DCR), authorization codes, access + refresh tokens.
// Opaque tokens (random strings) verified by store lookup — no JWT, no crypto
// keys to manage. Zero-dep; atomic writes; serialized read-modify-write. Every
// token carries the invitee id + magic token so the /mcp handler can meter spend.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from './gate.js';

const ACCESS_TTL_MS = 60 * 60 * 1000;        // 1 hour
const CODE_TTL_MS = 10 * 60 * 1000;          // 10 minutes
const storePath = () => path.join(dataDir(), 'mcp-oauth.json');

export interface OAuthClient { client_id: string; client_name?: string; redirect_uris: string[]; created: number }
export interface AuthCode { code: string; client_id: string; redirect_uri: string; code_challenge: string; scope: string; inviteeId: string; inviteeToken: string; expiresAt: number }
export interface AccessToken { token: string; client_id: string; scope: string; inviteeId: string; inviteeToken: string; expiresAt: number }
export interface RefreshToken { token: string; client_id: string; scope: string; inviteeId: string; inviteeToken: string }
interface Store { clients: Record<string, OAuthClient>; codes: Record<string, AuthCode>; tokens: Record<string, AccessToken>; refresh: Record<string, RefreshToken> }

function read(): Store {
  try { const f = storePath(); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { /* fresh */ }
  return { clients: {}, codes: {}, tokens: {}, refresh: {} };
}
function write(s: Store): void {
  const f = storePath();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, f);
}
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: (s: Store) => T): Promise<T> {
  const run = chain.then(() => { const s = read(); const r = fn(s); write(s); return r; });
  chain = run.catch(() => undefined);
  return run;
}
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
function gc(s: Store): void {
  const now = Date.now();
  for (const k of Object.keys(s.codes)) if (s.codes[k].expiresAt < now) delete s.codes[k];
  for (const k of Object.keys(s.tokens)) if (s.tokens[k].expiresAt < now) delete s.tokens[k];
}

export const oauthStore = {
  registerClient(input: { client_name?: string; redirect_uris?: string[] }): Promise<OAuthClient> {
    return withLock((s) => {
      const client: OAuthClient = { client_id: `hjen_${rand(12)}`, client_name: input.client_name, redirect_uris: input.redirect_uris || [], created: Date.now() };
      s.clients[client.client_id] = client;
      return client;
    });
  },
  getClient(id: string): OAuthClient | null { return read().clients[id] ?? null; },

  createCode(input: Omit<AuthCode, 'code' | 'expiresAt'>): Promise<string> {
    return withLock((s) => {
      gc(s);
      const code = rand(24);
      s.codes[code] = { ...input, code, expiresAt: Date.now() + CODE_TTL_MS };
      return code;
    });
  },
  /** One-time: returns + deletes the code. */
  consumeCode(code: string): Promise<AuthCode | null> {
    return withLock((s) => {
      const c = s.codes[code];
      if (!c) return null;
      delete s.codes[code];
      if (c.expiresAt < Date.now()) return null;
      return c;
    });
  },

  issueTokens(input: { client_id: string; scope: string; inviteeId: string; inviteeToken: string }): Promise<{ access_token: string; refresh_token: string; expires_in: number; scope: string }> {
    return withLock((s) => {
      gc(s);
      const access = rand(32); const refresh = rand(32);
      s.tokens[access] = { token: access, ...input, expiresAt: Date.now() + ACCESS_TTL_MS };
      s.refresh[refresh] = { token: refresh, ...input };
      return { access_token: access, refresh_token: refresh, expires_in: Math.floor(ACCESS_TTL_MS / 1000), scope: input.scope };
    });
  },
  getAccess(token: string): AccessToken | null {
    const t = read().tokens[token];
    if (!t || t.expiresAt < Date.now()) return null;
    return t;
  },
  rotateRefresh(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number; scope: string } | null> {
    return withLock((s) => {
      const r = s.refresh[refreshToken];
      if (!r) return null;
      delete s.refresh[refreshToken];
      const access = rand(32); const nrefresh = rand(32);
      s.tokens[access] = { token: access, client_id: r.client_id, scope: r.scope, inviteeId: r.inviteeId, inviteeToken: r.inviteeToken, expiresAt: Date.now() + ACCESS_TTL_MS };
      s.refresh[nrefresh] = { token: nrefresh, client_id: r.client_id, scope: r.scope, inviteeId: r.inviteeId, inviteeToken: r.inviteeToken };
      return { access_token: access, refresh_token: nrefresh, expires_in: Math.floor(ACCESS_TTL_MS / 1000), scope: r.scope };
    });
  },
};

/** PKCE S256 check: base64url(sha256(verifier)) === challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  try {
    const hash = crypto.createHash('sha256').update(verifier).digest('base64url');
    return hash === challenge;
  } catch { return false; }
}
