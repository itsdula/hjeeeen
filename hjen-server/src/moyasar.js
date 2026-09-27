// Moyasar billing — the Saudi rail (SAR: mada / card / Apple Pay / STC Pay).
// Zero-dependency. Unlike Paddle, Moyasar is NOT a merchant of record and has NO
// native subscriptions — it is a charge gateway. So this module runs the simplest
// safe flow: create a HOSTED INVOICE server-side (Moyasar hosts the card page),
// redirect the payer there, and on return / webhook GRANT one paid month.
//
// SECURITY MODEL — never trust the browser or the webhook body. Both the return
// redirect and the webhook only hand us an id; we RE-FETCH the payment/invoice
// from api.moyasar.com with our secret key and grant only when Moyasar itself
// says status === 'paid'. A forged request therefore cannot grant a plan. The
// webhook secret_token is a first gate; the server-side re-fetch is the truth.
//
// The acc↔purchase link is metadata.acc, set when we create the invoice.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { store } from './store.js';
import { getPricing } from './plans.js';
import { usdToSarHalalas, grossWithVat, vatPercent } from './money.js';
import { recordSaleSafe } from './qoyod.js';

const API_BASE = 'https://api.moyasar.com/v1'; // one host; test vs live is by key prefix.

export function moyasarConfigured() {
  return !!config.moyasarSecretKey;
}

// HTTP Basic auth — secret key as the username, blank password.
function authHeader() {
  return 'Basic ' + Buffer.from(`${config.moyasarSecretKey}:`).toString('base64');
}

async function api(method, endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      authorization: authHeader(),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, json };
}

// ── plan pricing lookup ──────────────────────────────────────────────────────
// USD is the source of truth (plans.js). Resolve the USD amount for a plan+cycle,
// converted to SAR halalas only at charge time.
function usdForPlan(planId, cycle) {
  const pl = (getPricing().plans || []).find((p) => p.id === planId);
  if (!pl) return null;
  const usd = cycle === 'annual' ? pl.priceAnnual : pl.priceMonthly;
  return usd > 0 ? { plan: pl, usd, name: pl.name } : null;
}

// ── invoice creation ─────────────────────────────────────────────────────────
/** Create a hosted invoice for a plan purchase. Returns { ok, id, url } — `url`
 *  is Moyasar's hosted checkout page to redirect the payer to. Amount is fixed
 *  server-side (never from the client). */
export async function createPlanInvoice({ acc, email, planId, cycle, returnTo }) {
  if (!moyasarConfigured()) return { ok: false, reason: 'not_configured' };
  const found = usdForPlan(planId, cycle === 'annual' ? 'annual' : 'monthly');
  if (!found) return { ok: false, reason: 'unknown_plan' };
  const c = cycle === 'annual' ? 'annual' : 'monthly';
  // Prices are VAT-exclusive → charge price × (1+VAT). VAT off (0%) = no change.
  const amount = usdToSarHalalas(grossWithVat(found.usd)); // ceil to whole riyal → halalas
  const base = config.publicBaseUrl;
  // Where to send the payer back after paying — same-origin relative path only
  // (an absolute/protocol-relative value would be an open redirect). Empty →
  // the callback falls back to the standalone /upgrade confirmation page.
  const rt = (typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//'))
    ? returnTo.slice(0, 200) : '';
  const { ok, status, json } = await api('POST', '/invoices', {
    amount,
    currency: 'SAR',
    description: `HJEN Studio — ${found.name} (${c})`,
    success_url: `${base}/api/moyasar/callback`,
    // "Back" / cancel returns to the app with a cancelled flag (no charge).
    back_url: rt ? `${base}${rt}${rt.includes('?') ? '&' : '?'}checkout=cancelled` : `${base}/upgrade`,
    metadata: {
      acc: String(acc || ''),
      plan: String(planId),
      cycle: c,
      usd: String(found.usd),
      email: String(email || ''),
      kind: 'plan',
      returnTo: rt,
    },
  });
  if (!ok || !json?.id || !json?.url) {
    // Surface the provider's actual reason (auth error, bad amount, …) instead
    // of an opaque 'create_failed' — logged server-side and returned to the caller.
    const detail = json?.message || (json?.errors ? JSON.stringify(json.errors) : null);
    console.error(`[moyasar] invoice create failed (${status}): ${detail || 'unknown'}`);
    return { ok: false, reason: 'create_failed', detail };
  }
  return { ok: true, id: json.id, url: json.url, amount };
}

// ── embedded-form intent ─────────────────────────────────────────────────────
/** Server-authoritative values for an in-app Moyasar.js form (card entry inside
 *  the studio, no redirect to the hosted page). The amount is fixed here from the
 *  plan's USD price; the browser passes it to Moyasar.init, and the grant path
 *  re-verifies it (the client could tamper the init amount). */
export function moyasarPlanIntent({ acc, planId, cycle, returnTo }) {
  if (!moyasarConfigured()) return { ok: false, reason: 'not_configured' };
  if (!config.moyasarPublishableKey) return { ok: false, reason: 'no_publishable_key' };
  const c = cycle === 'annual' ? 'annual' : 'monthly';
  const found = usdForPlan(planId, c);
  if (!found) return { ok: false, reason: 'unknown_plan' };
  const rt = (typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//'))
    ? returnTo.slice(0, 200) : '';
  return {
    ok: true,
    amount: usdToSarHalalas(grossWithVat(found.usd)), // net × (1+VAT), ceil to riyal → halalas
    currency: 'SAR',
    description: `HJEN Studio — ${found.name} (${c})`,
    publishableKey: config.moyasarPublishableKey,
    callbackUrl: `${config.publicBaseUrl}/api/moyasar/callback`,
    metadata: {
      acc: String(acc || ''), plan: String(planId), cycle: c,
      usd: String(found.usd), returnTo: rt, kind: 'plan',
    },
  };
}

/** Expected SAR-halalas amount for a plan+cycle at the server price (for the
 *  anti-tamper check on grant — the embedded form's amount is client-set). */
function expectedAmountFor(planId, cycle) {
  const f = usdForPlan(planId, cycle === 'annual' ? 'annual' : 'monthly');
  return f ? usdToSarHalalas(grossWithVat(f.usd)) : 0; // grossed to match the charge
}

// ── webhook signature (shared secret_token) ──────────────────────────────────
/** Moyasar dashboard webhooks embed the secret_token we configured in the JSON
 *  body. Compare it constant-time. Returns false when no secret is set — we do
 *  NOT accept unauthenticated webhooks. */
export function verifyMoyasarWebhook(parsedBody) {
  const expected = config.moyasarWebhookSecret;
  if (!expected) return false;
  const got = parsedBody && parsedBody.secret_token;
  if (!got) return false;
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── idempotency ──────────────────────────────────────────────────────────────
// Applying the same paid payment twice must be a no-op (webhook + browser return
// both fire; Moyasar also retries). Processed payment ids persist in a capped ring.
const seenFile = () => path.join(config.dataDir, 'moyasar_seen.json');
const SEEN_CAP = 5000;

function alreadySeen(id) {
  try { return JSON.parse(fs.readFileSync(seenFile(), 'utf-8')).includes(id); }
  catch { return false; }
}
function markSeen(id) {
  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(seenFile(), 'utf-8')); } catch { /* fresh */ }
  seen.push(id);
  if (seen.length > SEEN_CAP) seen = seen.slice(-SEEN_CAP);
  fs.mkdirSync(path.dirname(seenFile()), { recursive: true });
  fs.writeFileSync(seenFile(), JSON.stringify(seen));
}

// ── grant from a Moyasar-confirmed payment ───────────────────────────────────
// The single funnel for both the webhook and the browser return. We ALWAYS
// re-fetch from Moyasar and only grant on a real 'paid' status.

async function readMetadataFor(payment) {
  // A payment made against an invoice carries the invoice metadata, but fall back
  // to fetching the invoice explicitly if it isn't inlined.
  let md = payment?.metadata || {};
  if ((!md || !md.acc) && payment?.invoice_id) {
    const inv = await api('GET', `/invoices/${encodeURIComponent(payment.invoice_id)}`);
    md = inv?.json?.metadata || md;
  }
  return md || {};
}

/** Grant one paid month from a payment id. Returns { ok, applied, note }. */
export async function applyMoyasarPaymentId(paymentId) {
  if (!moyasarConfigured() || !paymentId) return { ok: false, applied: false, note: 'no_id' };
  if (alreadySeen(paymentId)) return { ok: true, applied: false, note: 'duplicate' };

  const { ok, json: payment } = await api('GET', `/payments/${encodeURIComponent(paymentId)}`);
  if (!ok || !payment) return { ok: false, applied: false, note: 'fetch_failed' };
  if (payment.status !== 'paid') {
    // Don't mark unpaid/failed ids as seen — a later successful retry must apply.
    return { ok: true, applied: false, note: `status:${payment.status}` };
  }

  const md = await readMetadataFor(payment);
  const acc = md.acc || null;
  const plan = md.plan || null;
  if (!acc || !plan) { markSeen(paymentId); return { ok: true, applied: false, note: 'no_metadata' }; }

  // Anti-tamper: the embedded form sets the amount client-side, so a real 'paid'
  // could still be for a wrong amount. Require it to match the plan's server price
  // (10% margin absorbs any rate drift between intent and payment).
  const expected = expectedAmountFor(plan, md.cycle);
  if (expected && Number(payment.amount) < Math.floor(expected * 0.9)) {
    markSeen(paymentId);
    console.error(`[moyasar] amount mismatch: paid ${payment.amount} < expected ~${expected} for ${plan}`);
    return { ok: true, applied: false, note: 'amount-mismatch', acc };
  }

  const inv = await store.applyMoyasarPurchase(acc, plan, {
    cycle: md.cycle || 'monthly',
    paymentId,
    invoiceId: payment.invoice_id || null,
    amount: payment.amount,
    currency: payment.currency,
  });
  if (inv) {
    // Mirror the sale into Qoyod as an Approved (ZATCA) invoice. Fire-and-forget:
    // the money is already captured, so a Qoyod hiccup must never surface here —
    // recordSaleSafe swallows errors and queues a retry. netSar is the VAT-
    // exclusive amount (the charge grossed the net up by VAT, so divide it back).
    const vat = vatPercent();
    const grossSar = Number(payment.amount) / 100; // halalas → riyals (what was charged)
    const netSar = vat > 0 ? grossSar / (1 + vat / 100) : grossSar;
    recordSaleSafe({
      source: 'moyasar',
      srcRef: `MOY-${paymentId}`,
      buyer: { email: inv.email, name: inv.name, country: inv.country },
      netSar,
      plan,
      cycle: md.cycle || 'monthly',
    });
  }
  markSeen(paymentId);
  return inv
    ? { ok: true, applied: true, note: `paid:${plan}`, acc }
    : { ok: true, applied: false, note: 'unknown-acc-or-plan', acc };
}

/** Resolve where to send the payer back (from the payment metadata), independent
 *  of the grant's idempotency — so the browser return always lands correctly even
 *  when the webhook granted first. Returns { returnTo, plan, status } or null. */
export async function moyasarReturnInfo(paymentId) {
  if (!moyasarConfigured() || !paymentId) return null;
  const { ok, json: payment } = await api('GET', `/payments/${encodeURIComponent(paymentId)}`);
  if (!ok || !payment) return null;
  const md = await readMetadataFor(payment);
  return {
    returnTo: md.returnTo || '',
    plan: md.plan || '',
    status: payment.status,
    message: payment?.source?.message || payment?.message || '',
  };
}

/** Apply a verified webhook event. `evt` is the parsed body (secret already checked). */
export async function applyMoyasarEvent(evt) {
  const type = evt?.type || '';
  const data = evt?.data || {};
  // We only act on successful payments; failures/refunds are logged upstream.
  if (type === 'payment_paid' || (!type && data?.status === 'paid')) {
    return applyMoyasarPaymentId(data?.id);
  }
  return { ok: true, applied: false, note: `ignored:${type || data?.status || 'unknown'}` };
}
