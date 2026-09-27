// OAuth 2.1 route logic (self-issued, authorization_code + PKCE + DCR). Each
// handler returns an HttpResult the server renders. The consent screen proves
// the user's identity with their HJEN invitee magic token (or the dev token),
// binding every issued token to an invitee for quota metering.

import { oauthStore, verifyPkce } from './oauth-store.js';
import { getByToken, gateStatus, devToken } from './gate.js';

export type HttpResult = { status: number; json?: unknown; html?: string; redirect?: string; headers?: Record<string, string> };

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Resolve an invitee magic token → { inviteeId, inviteeToken } or null. Dev token = superuser. */
function resolveInvitee(token: string): { inviteeId: string; inviteeToken: string } | null {
  const t = (token || '').trim();
  if (!t) return null;
  if (devToken() && t === devToken()) return { inviteeId: 'dev', inviteeToken: t };
  const inv = getByToken(t);
  if (inv && gateStatus(inv).ok) return { inviteeId: inv.id, inviteeToken: inv.magicToken };
  return null;
}

/** POST /register — Dynamic Client Registration (RFC 7591). */
export async function handleRegister(body: any): Promise<HttpResult> {
  const client = await oauthStore.registerClient({
    client_name: typeof body?.client_name === 'string' ? body.client_name : undefined,
    redirect_uris: Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [],
  });
  return { status: 201, json: { client_id: client.client_id, client_name: client.client_name, redirect_uris: client.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] } };
}

/** GET /oauth/authorize — render the consent screen (asks for the invitee token). */
export function handleAuthorizeGet(q: URLSearchParams): HttpResult {
  const p = {
    client_id: q.get('client_id') || '', redirect_uri: q.get('redirect_uri') || '',
    code_challenge: q.get('code_challenge') || '', code_challenge_method: q.get('code_challenge_method') || '',
    scope: q.get('scope') || 'mcp mcp:write', state: q.get('state') || '',
  };
  if (!p.client_id || !p.redirect_uri) return { status: 400, json: { error: 'invalid_request', error_description: 'client_id + redirect_uri required' } };
  if (p.code_challenge_method !== 'S256' || !p.code_challenge) return { status: 400, json: { error: 'invalid_request', error_description: 'PKCE S256 required' } };
  const hidden = Object.entries(p).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('\n');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect HJEN Studio</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0c0e11;color:#e8e6e1;display:grid;place-items:center;height:100vh;margin:0}
.card{background:#16191e;border:1px solid #22262c;border-radius:16px;padding:28px 32px;max-width:420px;width:90%}
h1{font-size:20px;margin:0 0 6px}.sub{opacity:.6;font-size:13px;margin:0 0 20px}
input[type=text]{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a2f36;background:#0c0e11;color:inherit;font-size:14px}
label{display:block;font-size:12px;opacity:.7;margin:14px 0 6px}
button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:10px;background:#0563E9;color:#fff;font-size:15px;cursor:pointer}
.scope{font-size:12px;opacity:.6;margin-top:14px;line-height:1.5}</style>
<div class="card">
<h1>Connect HJEN Studio</h1>
<p class="sub">An AI assistant wants to drive your HJEN Studio over MCP.</p>
<form method="POST" action="/oauth/authorize">
${hidden}
<label>Your HJEN access token</label>
<input type="text" name="invitee_token" placeholder="paste your invite / access token" autofocus autocomplete="off">
<div class="scope">Grants: <b>read</b> (always) + <b>make</b> (spends your quota, needs your approval per action). Scope: ${esc(p.scope)}</div>
<button type="submit">Approve & connect</button>
</form></div>`;
  return { status: 200, html };
}

/** POST /oauth/authorize — validate the invitee token, mint an auth code, redirect back. */
export async function handleAuthorizePost(body: any): Promise<HttpResult> {
  const { client_id, redirect_uri, code_challenge, scope, state, invitee_token } = body || {};
  if (!client_id || !redirect_uri || !code_challenge) return { status: 400, json: { error: 'invalid_request' } };
  const who = resolveInvitee(String(invitee_token || ''));
  if (!who) {
    // re-render consent with an error hint
    const q = new URLSearchParams({ client_id, redirect_uri, code_challenge, code_challenge_method: 'S256', scope: scope || 'mcp mcp:write', state: state || '' });
    const page = handleAuthorizeGet(q);
    const html = (page.html || '').replace('An AI assistant wants', '⚠︎ Invalid or expired token. An AI assistant wants');
    return { status: 401, html };
  }
  const code = await oauthStore.createCode({ client_id, redirect_uri, code_challenge, scope: scope || 'mcp mcp:write', inviteeId: who.inviteeId, inviteeToken: who.inviteeToken });
  const u = new URL(redirect_uri);
  u.searchParams.set('code', code);
  if (state) u.searchParams.set('state', state);
  return { status: 302, redirect: u.toString() };
}

/** POST /oauth/token — exchange code (+PKCE) or refresh for tokens. */
export async function handleToken(body: any): Promise<HttpResult> {
  const grant = body?.grant_type;
  if (grant === 'authorization_code') {
    const { code, redirect_uri, client_id, code_verifier } = body;
    if (!code || !code_verifier) return { status: 400, json: { error: 'invalid_request' } };
    const rec = await oauthStore.consumeCode(String(code));
    if (!rec) return { status: 400, json: { error: 'invalid_grant', error_description: 'code invalid or expired' } };
    if (rec.client_id !== client_id || rec.redirect_uri !== redirect_uri) return { status: 400, json: { error: 'invalid_grant', error_description: 'client/redirect mismatch' } };
    if (!verifyPkce(String(code_verifier), rec.code_challenge)) return { status: 400, json: { error: 'invalid_grant', error_description: 'PKCE verification failed' } };
    const t = await oauthStore.issueTokens({ client_id: rec.client_id, scope: rec.scope, inviteeId: rec.inviteeId, inviteeToken: rec.inviteeToken });
    return { status: 200, json: { token_type: 'Bearer', ...t } };
  }
  if (grant === 'refresh_token') {
    const rotated = await oauthStore.rotateRefresh(String(body?.refresh_token || ''));
    if (!rotated) return { status: 400, json: { error: 'invalid_grant' } };
    return { status: 200, json: { token_type: 'Bearer', ...rotated } };
  }
  return { status: 400, json: { error: 'unsupported_grant_type' } };
}
