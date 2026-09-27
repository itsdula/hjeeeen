// Paddle billing — zero-dependency. Paddle is the merchant of record: it owns
// checkout, cards, tax and invoices; this module only (1) verifies + applies
// webhook events to the invitee store and (2) mints customer-portal links.
// Identity stays with Clerk / magic tokens — Paddle is an event source, not an
// account system. The link between both worlds is customData.acc (invitee id)
// passed into every checkout.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, paths } from './config.js';
import { store } from './store.js';
import { getPricing } from './plans.js';
import { recordSaleSafe } from './qoyod.js';
import { usdToSarRiyals } from './money.js';

const API_BASE = config.paddleEnv === 'live'
  ? 'https://api.paddle.com'
  : 'https://sandbox-api.paddle.com';

// ── webhook signature ────────────────────────────────────────────────────────
// Header: `Paddle-Signature: ts=1671552777;h1=eb4d0dc8...`
// Valid when h1 === HMAC-SHA256(secret, `${ts}:${rawBody}`) and ts is fresh.
const MAX_SKEW_S = 5 * 60;

export function verifyPaddleSignature(rawBody, header) {
  if (!config.paddleWebhookSecret || !header) return false;
  const parts = Object.fromEntries(
    String(header).split(';').map((kv) => kv.split('=').map((s) => s.trim())),
  );
  const ts = Number(parts.ts);
  if (!ts || !parts.h1) return false;
  if (Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_S) return false;
  const digest = crypto.createHmac('sha256', config.paddleWebhookSecret)
    .update(`${parts.ts}:`)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(digest);
  const b = Buffer.from(parts.h1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── idempotency ──────────────────────────────────────────────────────────────
// Paddle retries undelivered webhooks; applying the same event twice must be a
// no-op. Processed event ids persist in a capped JSON ring next to the store.
const seenFile = () => path.join(config.dataDir, 'paddle_seen.json');
const SEEN_CAP = 5000;

function alreadySeen(eventId) {
  try {
    const seen = JSON.parse(fs.readFileSync(seenFile(), 'utf-8'));
    return seen.includes(eventId);
  } catch { return false; }
}

function markSeen(eventId) {
  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(seenFile(), 'utf-8')); } catch { /* fresh */ }
  seen.push(eventId);
  if (seen.length > SEEN_CAP) seen = seen.slice(-SEEN_CAP);
  fs.mkdirSync(path.dirname(seenFile()), { recursive: true });
  fs.writeFileSync(seenFile(), JSON.stringify(seen));
}

// ── event application ────────────────────────────────────────────────────────
// The plan comes from the price's custom_data ({plan:'pro'|'team'}); the
// account comes from checkout customData ({acc:<invitee id>}). Quantity scales
// Team seats. paidUntil follows the subscription's billing period so annual
// subscribers outlive the plan's 30-day admin default.

// Resolve which plan a purchase is for. Prefer the price's custom_data
// ({plan:'pro'}), but FALL BACK to matching the Paddle price id against our own
// plans.js catalog — so the owner never has to hand-set custom_data in Paddle.
function planFromPriceId(priceId) {
  if (!priceId) return null;
  for (const pl of getPricing().plans || []) {
    if (pl.paddle && (pl.paddle.monthly === priceId || pl.paddle.annual === priceId)) return pl.id;
  }
  return null;
}
function planFromItems(items) {
  for (const it of items || []) {
    const plan = it?.price?.custom_data?.plan || it?.price?.customData?.plan
      || planFromPriceId(it?.price?.id || it?.price_id);
    if (plan) return { plan, quantity: it.quantity ?? 1 };
  }
  return null;
}

function paidUntilOf(sub) {
  const iso = sub?.current_billing_period?.ends_at || sub?.next_billed_at || null;
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
}

// ── Paddle → Qoyod seam (INERT by default) ───────────────────────────────────
// Paddle is deferred; this stays off unless config.qoyodPaddleEnabled is set.
// Paddle is a merchant-of-record — it collects + remits tax and issues its OWN
// tax invoice — so a Paddle sale is mirrored into Qoyod purely as revenue, with
// taxPercentOverride:0 (no Saudi VAT line). The amount comes from the
// transaction's own totals; if we can't read a USD amount we log and skip rather
// than guess (never fire a wrong-amount invoice when the flag is flipped).
function mirrorPaddleSaleToQoyod(data, inv, found) {
  if (!config.qoyodPaddleEnabled) return;
  const currency = data.currency_code || data.details?.totals?.currency_code || 'USD';
  const minor = Number(data.details?.totals?.grand_total ?? data.details?.totals?.total);
  if (currency !== 'USD' || !Number.isFinite(minor) || minor <= 0) {
    console.warn(`[qoyod] Paddle mirror skipped (unsupported currency/amount: ${currency} ${minor})`);
    return;
  }
  const grossUsd = minor / 100;            // Paddle totals are in minor units
  recordSaleSafe({
    source: 'paddle',
    srcRef: `PADL-${data.id}`,
    buyer: { email: inv.email, name: inv.name, country: inv.country },
    netSar: usdToSarRiyals(grossUsd),       // MoR: full amount as revenue, no VAT line
    plan: found.plan,
    cycle: 'monthly',
    taxPercentOverride: 0,
  });
}

/** Apply one verified Paddle event. Returns {ok, applied, note} — never throws. */
export async function applyPaddleEvent(evt) {
  const type = evt?.event_type || '';
  const data = evt?.data || {};
  const eventId = evt?.event_id || '';
  if (eventId && alreadySeen(eventId)) return { ok: true, applied: false, note: 'duplicate' };

  const acc = data?.custom_data?.acc || data?.customData?.acc || null;
  let result = { ok: true, applied: false, note: `ignored:${type}` };

  if (type === 'subscription.activated' || type === 'subscription.updated' || type === 'subscription.resumed') {
    const found = planFromItems(data.items);
    const active = ['active', 'trialing', 'past_due'].includes(data.status);
    if (acc && found && active) {
      const inv = await store.applyPaddleSubscription(acc, found.plan, {
        quantity: found.quantity,
        paidUntil: paidUntilOf(data),
        customerId: data.customer_id,
        subscriptionId: data.id,
        resetUsed: type === 'subscription.activated',
      });
      result = inv
        ? { ok: true, applied: true, note: `${type}:${found.plan}` }
        : { ok: true, applied: false, note: 'unknown-acc' };
    } else if (acc && data.status === 'canceled') {
      await store.endPaddleSubscription(acc);
      result = { ok: true, applied: true, note: 'canceled-via-update' };
    }
  } else if (type === 'subscription.canceled') {
    if (acc) {
      const inv = await store.endPaddleSubscription(acc);
      result = inv
        ? { ok: true, applied: true, note: 'canceled' }
        : { ok: true, applied: false, note: 'unknown-acc' };
    }
  } else if (type === 'transaction.completed') {
    // A renewal payment: re-fund the period (reset the usage counter) using the
    // already-known plan. First-purchase completions are covered by
    // subscription.activated; duplicates are harmless (idempotent by event id).
    const found = planFromItems(data.items);
    if (acc && found && data.subscription_id) {
      const inv = await store.applyPaddleSubscription(acc, found.plan, {
        quantity: found.quantity,
        paidUntil: data.billing_period?.ends_at ? Date.parse(data.billing_period.ends_at) : null,
        customerId: data.customer_id,
        subscriptionId: data.subscription_id,
        resetUsed: true,
      });
      if (inv) mirrorPaddleSaleToQoyod(data, inv, found);
      result = inv
        ? { ok: true, applied: true, note: `renewal:${found.plan}` }
        : { ok: true, applied: false, note: 'unknown-acc' };
    }
  }

  if (eventId) markSeen(eventId);
  return result;
}

// ── customer portal ──────────────────────────────────────────────────────────
/** Mint a customer-portal link (change card, cancel, invoices) for an invitee
 *  that has a Paddle customer id. Returns the overview URL or null. */
export async function portalUrlFor(inv) {
  if (!config.paddleApiKey || !inv?.paddleCustomerId) return null;
  try {
    const body = inv.paddleSubscriptionId ? { subscription_ids: [inv.paddleSubscriptionId] } : {};
    const res = await fetch(`${API_BASE}/customers/${encodeURIComponent(inv.paddleCustomerId)}/portal-sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.paddleApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.data?.urls?.general?.overview || null;
  } catch { return null; }
}
