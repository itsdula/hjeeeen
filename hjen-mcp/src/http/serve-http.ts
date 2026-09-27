#!/usr/bin/env node
// Hosted HJEN MCP — Streamable-HTTP transport + OAuth 2.1, zero-dependency
// (plain node:http + node:crypto). Same tools as stdio (via buildServer), so the
// hosted endpoint and the local one never diverge. Front this with a TLS reverse
// proxy (see Caddyfile.example) for a public https://<domain>/mcp.
//
//   POST /mcp                              → JSON-RPC (Bearer required)
//   GET  /.well-known/oauth-protected-resource      (RFC 9728)
//   GET  /.well-known/oauth-authorization-server    (RFC 8414)
//   POST /register · GET|POST /oauth/authorize · POST /oauth/token   (OAuth 2.1 + PKCE + DCR)

import http from 'node:http';
import { createNodeHost } from '../host-node.js';
import { buildServer } from '../server-factory.js';
import type { RpcMessage } from '../mcp/server.js';
import { protectedResourceMetadata, authServerMetadata } from './metadata.js';
import { handleRegister, handleAuthorizeGet, handleAuthorizePost, handleToken, type HttpResult } from './oauth.js';
import { getByToken, gateStatus, consumeMake, refund, devToken } from './gate.js';
import { oauthStore } from './oauth-store.js';

const PORT = Number(process.env.PORT || 8788);
const BIND = process.env.HOST || '127.0.0.1';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const ALLOWED_HOSTS = new Set(
  (process.env.ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean)
    .concat(['127.0.0.1', 'localhost', new URL(PUBLIC_BASE_URL).hostname]),
);
const PAID_TOOLS = new Set(['hjen_frame_make', 'hjen_portrait_refine', 'hjen_video_make', 'hjen_chain_run', 'hjen_storyboard_shot_make', 'hjen_graph_run']);

const host = createNodeHost();
const server = buildServer(host);

function send(res: http.ServerResponse, r: HttpResult): void {
  const headers: Record<string, string> = { 'cache-control': 'no-store', ...(r.headers || {}) };
  if (r.redirect) { res.writeHead(r.status, { ...headers, location: r.redirect }); res.end(); return; }
  if (r.html != null) { res.writeHead(r.status, { ...headers, 'content-type': 'text/html; charset=utf-8' }); res.end(r.html); return; }
  res.writeHead(r.status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(r.json ?? {}));
}
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let b = ''; req.on('data', c => { b += c; if (b.length > 26_214_400) req.destroy(); }); req.on('end', () => resolve(b)); req.on('error', () => resolve('')); });
}
function parseBody(req: http.IncomingMessage, raw: string): any {
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('json')) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
  const o: Record<string, string> = {}; for (const [k, v] of new URLSearchParams(raw)) o[k] = v; return o;
}
const bearer = (req: http.IncomingMessage): string | null => {
  const a = req.headers['authorization']; return a && a.startsWith('Bearer ') ? a.slice(7).trim() : null;
};
const hostOk = (req: http.IncomingMessage): boolean => ALLOWED_HOSTS.has(String(req.headers['host'] || '').split(':')[0]);

interface Principal { inviteeId: string; inviteeToken: string; scopes: string[]; unlimited: boolean }
function resolvePrincipal(token: string): Principal | null {
  if (devToken() && token === devToken()) return { inviteeId: 'dev', inviteeToken: token, scopes: ['mcp', 'mcp:write'], unlimited: true };
  const at = oauthStore.getAccess(token);
  if (at) return { inviteeId: at.inviteeId, inviteeToken: at.inviteeToken, scopes: String(at.scope).split(/\s+/), unlimited: at.inviteeId === 'dev' };
  const inv = getByToken(token);
  if (inv && gateStatus(inv).ok) return { inviteeId: inv.id, inviteeToken: inv.magicToken, scopes: ['mcp', 'mcp:write'], unlimited: false };
  return null;
}
function challenge(res: http.ServerResponse, code: 'invalid_token' | 'missing' = 'missing'): void {
  const metaUrl = `${PUBLIC_BASE_URL}/.well-known/oauth-protected-resource`;
  res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': `Bearer resource_metadata="${metaUrl}"${code === 'invalid_token' ? ', error="invalid_token"' : ''}` });
  res.end(JSON.stringify({ error: code === 'invalid_token' ? 'invalid_token' : 'unauthorized' }));
}

const rpcErr = (id: any, codeN: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code: codeN, message } });

async function handleMcpPost(req: http.IncomingMessage, res: http.ServerResponse, raw: string): Promise<void> {
  const token = bearer(req);
  if (!token) return challenge(res, 'missing');
  const who = resolvePrincipal(token);
  if (!who) return challenge(res, 'invalid_token');

  let msg: RpcMessage;
  try { msg = JSON.parse(raw); } catch { res.writeHead(400, { 'content-type': 'application/json' }); return void res.end(JSON.stringify(rpcErr(null, -32700, 'parse error'))); }

  // Meter paid tool calls: require mcp:write scope, then consume quota (refund on failure).
  const isPaid = msg?.method === 'tools/call' && PAID_TOOLS.has(msg?.params?.name) && msg?.params?.arguments?.confirm === true;
  let metered = false;
  if (isPaid) {
    if (!who.scopes.includes('mcp:write')) { res.writeHead(403, { 'content-type': 'application/json', 'www-authenticate': 'Bearer error="insufficient_scope"' }); return void res.end(JSON.stringify({ error: 'insufficient_scope' })); }
    if (!who.unlimited) {
      const c = await consumeMake(who.inviteeToken);
      if (!c.ok) { res.writeHead(200, { 'content-type': 'application/json' }); return void res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, result: { content: [{ type: 'text', text: `Quota gate: ${c.reason}. This account can't spend right now.` }], isError: true } })); }
      metered = true;
    }
  }

  let result: RpcMessage | null;
  try { result = await server.handleMessage(msg); }
  catch (e: any) { if (metered) await refund(who.inviteeToken); res.writeHead(500, { 'content-type': 'application/json' }); return void res.end(JSON.stringify(rpcErr(msg.id, -32603, String(e?.message || e)))); }

  // Refund if the paid tool itself reported an error.
  if (metered && (result as any)?.result?.isError) await refund(who.inviteeToken);

  if (result == null) { res.writeHead(202); return void res.end(); }   // notification
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(result));
}

const httpServer = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', PUBLIC_BASE_URL);
    const p = url.pathname; const m = req.method || 'GET';

    if (!hostOk(req)) { res.writeHead(403); return void res.end('forbidden host'); }
    if (m === 'GET' && p === '/health') return send(res, { status: 200, json: { ok: true } });
    if (m === 'GET' && p === '/.well-known/oauth-protected-resource') return send(res, { status: 200, json: protectedResourceMetadata(PUBLIC_BASE_URL) });
    if (m === 'GET' && (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/openid-configuration')) return send(res, { status: 200, json: authServerMetadata(PUBLIC_BASE_URL) });
    if (m === 'GET' && p === '/oauth/authorize') return send(res, handleAuthorizeGet(url.searchParams));

    if (m === 'POST' && p === '/mcp') return void handleMcpPost(req, res, await readBody(req));
    if (m === 'GET' && p === '/mcp') { res.writeHead(405, { allow: 'POST' }); return void res.end(); }   // no server-push notifications
    if (m === 'DELETE' && p === '/mcp') return send(res, { status: 200, json: { ok: true } });

    if (m === 'POST' && p === '/register') return send(res, await handleRegister(parseBody(req, await readBody(req))));
    if (m === 'POST' && p === '/oauth/authorize') return send(res, await handleAuthorizePost(parseBody(req, await readBody(req))));
    if (m === 'POST' && p === '/oauth/token') return send(res, await handleToken(parseBody(req, await readBody(req))));

    if (m === 'GET' && p === '/') return send(res, { status: 200, html: `<!doctype html><meta charset=utf-8><title>HJEN MCP</title><body style="font-family:system-ui;background:#0c0e11;color:#e8e6e1;padding:40px"><h1>HJEN Studio · MCP</h1><p>Add to your agent:</p><pre>claude mcp add --transport http hjen --url ${PUBLIC_BASE_URL}/mcp</pre></body>` });
    res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not_found' }));
  } catch (err: any) {
    res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
});

httpServer.listen(PORT, BIND, () => {
  console.error(`[hjen-mcp-http] ${PUBLIC_BASE_URL}/mcp  (bind ${BIND}:${PORT}) · projectsRoot=${host.projectsRoot()}`);
  if (!devToken()) console.error('[hjen-mcp-http] tip: set HJEN_MCP_DEV_TOKEN for a local superuser bearer, or point HJEN_MCP_DATA_DIR at the server\'s invitees.json');
});
