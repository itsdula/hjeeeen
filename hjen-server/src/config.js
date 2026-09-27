// Central config + shared constants. Keys are read from env ONLY — never from a
// request, never echoed to the browser. Zero-dependency: parses .env by hand so
// the server runs on Electron's bundled node with nothing installed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// --- tiny .env loader (no dotenv dep) ---
function loadEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();

function envKey(name) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

// The Clerk publishable key encodes the instance's Frontend API host as
// base64("<host>$") — decode it to derive the JWKS URL + issuer (both public).
function clerkFrontendApi(pk) {
  if (!pk) return null;
  try {
    const b64 = pk.replace(/^pk_(test|live)_/, '');
    const host = Buffer.from(b64, 'base64').toString('utf-8').replace(/\$+$/, '');
    return /\.clerk\.accounts\.dev$|\.clerk\./.test(host) || host.includes('.') ? host : null;
  } catch { return null; }
}

const _clerkPk = envKey('CLERK_PUBLISHABLE_KEY');
const _clerkFapi = clerkFrontendApi(_clerkPk);

export const config = {
  port: Number(process.env.PORT || 8787),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8787}`).replace(/\/$/, ''),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || './data'),
  adminToken: envKey('ADMIN_TOKEN'),
  openaiKey: envKey('OPENAI_API_KEY'),
  anthropicKey: envKey('ANTHROPIC_API_KEY'),
  googleKey: envKey('GOOGLE_API_KEY'),
  arkKey: envKey('ARK_API_KEY'),
  klingKey: envKey('KLING_API_KEY'),
  // Paddle — merchant of record (global / USD). API key is server-only; the
  // client token is public by design (boots Paddle.js checkout). Env: 'sandbox' | 'live'.
  paddleEnv: (process.env.PADDLE_ENV || 'sandbox').trim(),
  paddleApiKey: envKey('PADDLE_API_KEY'),
  paddleClientToken: envKey('PADDLE_CLIENT_TOKEN'),
  paddleWebhookSecret: envKey('PADDLE_WEBHOOK_SECRET'),
  // Moyasar — the Saudi rail (SAR: mada / card / Apple Pay / STC Pay). The secret
  // key is server-only (HTTP Basic auth to api.moyasar.com); the publishable key
  // is public (for Moyasar.js, unused by the hosted-invoice flow but kept for
  // parity). The webhook secret is the shared token we set on the dashboard
  // webhook and compare against the payload's secret_token. Env: 'test' | 'live'.
  moyasarEnv: (process.env.MOYASAR_ENV || 'test').trim(),
  moyasarSecretKey: envKey('MOYASAR_SECRET_KEY'),
  moyasarPublishableKey: envKey('MOYASAR_PUBLISHABLE_KEY'),
  moyasarWebhookSecret: envKey('MOYASAR_WEBHOOK_SECRET'),
  // VAT — the canonical tax rate (%). Drives BOTH the Moyasar charge gross-up
  // (prices are ex-VAT → customer pays price × (1+VAT)) AND the Qoyod invoice
  // tax_percent, so the tax we collect always equals the tax we declare. Default
  // 0 (OFF) so deploying this code never silently changes live charges — the
  // owner sets VAT_PERCENT=15 once the checkout copy shows "+VAT".
  vatPercent: Number(process.env.VAT_PERCENT || 0),
  // Qoyod — the Saudi accounting/ZATCA rail. Creating an invoice here auto-signs
  // + submits it to FATOORA. Server-only. Dormant unless qoyodApiKey is set, and
  // even then DRY-RUN by default (logs the invoice JSON, creates nothing) until
  // the owner flips QOYOD_DRY_RUN=false. Optional *_ID overrides skip tenant
  // auto-discovery; qoyodPaddleEnabled turns on the (currently inert) Paddle→Qoyod
  // seam. Base host is fixed (www.qoyod.com/2.0) — there is no test host.
  qoyodApiKey: envKey('QOYOD_API_KEY'),
  qoyodDryRun: (process.env.QOYOD_DRY_RUN || 'true').trim() === 'true',
  qoyodPaddleEnabled: (process.env.QOYOD_PADDLE_ENABLED || 'false').trim() === 'true',
  qoyodInventoryId: envKey('QOYOD_INVENTORY_ID'),
  qoyodTaxId: envKey('QOYOD_TAX_ID'),
  qoyodSalesAccountId: envKey('QOYOD_SALES_ACCOUNT_ID'),
  qoyodCategoryId: envKey('QOYOD_CATEGORY_ID'),
  qoyodUnitTypeId: envKey('QOYOD_UNIT_TYPE_ID'),
  // Clerk — identity only (verified accounts + organizations), decoupled from billing.
  clerkSecretKey: envKey('CLERK_SECRET_KEY'),
  clerkPublishableKey: _clerkPk,
  clerkFrontendApi: _clerkFapi,
  clerkJwksUrl: _clerkFapi ? `https://${_clerkFapi}/.well-known/jwks.json` : null,
  clerkIssuer: _clerkFapi ? `https://${_clerkFapi}` : null,
};

// Shared with the desktop app (electron/main.ts) — keep in sync.
export const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const OPENAI_BASE = 'https://api.openai.com/v1';
export const ENHANCE_MODEL = 'claude-sonnet-4-6';
// Pricing moved to the single source of truth — src/pricing.js. Re-exported
// here so existing importers keep working; new code imports pricing.js directly.
export { CLAUDE_PRICING } from './pricing.js';

export const IMAGE_MODEL = 'gpt-image-2';
export const DEFAULT_SIZE = '1536x1024';
export const DEFAULT_QUALITY = 'high';

export const paths = {
  invitees: () => path.join(config.dataDir, 'invitees.json'),
  events: () => path.join(config.dataDir, 'events.jsonl'),
  refs: () => path.join(config.dataDir, 'refs'),
  outputs: () => path.join(config.dataDir, 'outputs'),
  skills: () => path.join(config.dataDir, 'skills'),
  publicDir: () => path.join(ROOT, 'public'),
  // The desktop renderer's built output (Vite dist). Served read-only on the web
  // with the cloud adapter injected — the desktop app is never modified. Locally
  // it sits at ../app/dist; on the deployed server, sync only index.html+assets+
  // catalog there and point HJEN_WEBAPP_DIST at it.
  webappDir: () => process.env.HJEN_WEBAPP_DIST || path.resolve(ROOT, '..', 'app', 'dist'),
};

// Zero-dep id generator (replaces nanoid).
import crypto from 'node:crypto';
export function genId(len = 16) {
  return crypto.randomBytes(Math.ceil(len * 0.75)).toString('base64url').slice(0, len);
}
