// Clerk session verification — zero-dependency. Verifies a Clerk-issued session
// JWT (RS256) against the instance JWKS using Node's built-in crypto, with no
// SDK. Also resolves a user's email/name from the Clerk Backend API so a
// first-time sign-in creates a proper HJEN account. Identity ONLY — no billing.

import crypto from 'node:crypto';
import { config } from './config.js';

let _jwks = null;
let _jwksAt = 0;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1h

async function getJwks(force = false) {
  const now = Date.now();
  if (!force && _jwks && now - _jwksAt < JWKS_TTL_MS) return _jwks;
  if (!config.clerkJwksUrl) return null;
  const res = await fetch(config.clerkJwksUrl, { headers: { accept: 'application/json' } });
  if (!res.ok) return _jwks; // keep the last good set on a transient failure
  _jwks = await res.json();
  _jwksAt = now;
  return _jwks;
}

function b64urlJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf-8'));
}

/**
 * Verify a Clerk session JWT. Returns the decoded claims ({ sub, iss, exp, … })
 * on success, or null on any failure (bad signature, expired, wrong issuer).
 */
export async function verifyClerkToken(token) {
  if (!config.clerkSecretKey) return null;
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header, payload;
  try { header = b64urlJson(h); payload = b64urlJson(p); } catch { return null; }
  if (header.alg !== 'RS256') return null;

  // Find the signing key by kid; refetch the JWKS once if the kid rotated.
  let jwks = await getJwks();
  let jwk = jwks?.keys?.find((k) => k.kid === header.kid);
  if (!jwk) { jwks = await getJwks(true); jwk = jwks?.keys?.find((k) => k.kid === header.kid); }
  if (!jwk) return null;

  let ok = false;
  try {
    const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), pub, Buffer.from(s, 'base64url'));
  } catch { return null; }
  if (!ok) return null;

  // Standard claim checks (small clock skew tolerated).
  const now = Math.floor(Date.now() / 1000);
  const skew = 30;
  if (typeof payload.exp === 'number' && payload.exp + skew < now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf - skew > now) return null;
  if (config.clerkIssuer && payload.iss && payload.iss !== config.clerkIssuer) return null;
  return payload;
}

/** List an organization's members + roles via the Backend API (secret key).
 *  Surfaces the org hierarchy (org → members → roles) inside HJEN's console. */
export async function fetchOrgMembers(orgId) {
  if (!config.clerkSecretKey || !orgId) return [];
  try {
    const res = await fetch(`https://api.clerk.com/v1/organizations/${encodeURIComponent(orgId)}/memberships?limit=100`, {
      headers: { authorization: `Bearer ${config.clerkSecretKey}` },
    });
    if (!res.ok) return [];
    const j = await res.json();
    const rows = Array.isArray(j) ? j : (j.data || []);
    return rows.map((m) => {
      const u = m.public_user_data || {};
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.identifier || 'Member';
      return { name, email: u.identifier || '', role: String(m.role || '').replace(/^org:/, '') };
    });
  } catch {
    return [];
  }
}

/** Resolve a Clerk user's primary email + name via the Backend API (secret key). */
export async function fetchClerkUser(userId) {
  if (!config.clerkSecretKey || !userId) return { email: '', name: '' };
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${config.clerkSecretKey}` },
    });
    if (!res.ok) return { email: '', name: '' };
    const u = await res.json();
    const primaryId = u.primary_email_address_id;
    const email = (u.email_addresses || []).find((e) => e.id === primaryId)?.email_address
      || (u.email_addresses || [])[0]?.email_address || '';
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    return { email, name };
  } catch {
    return { email: '', name: '' };
  }
}
