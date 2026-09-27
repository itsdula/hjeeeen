// Adaptive provider scheduler — one self-tuning concurrency limiter per
// (provider,model). Prevents the 429 storm by discovering the account's REAL
// throughput empirically and pacing to it.
//
// WHY AIMD (not a fixed rate): providers don't reliably expose usable rate-limit
// headers for image endpoints (OpenAI's gpt-image returns x-ratelimit-*-images: 0
// on our tier — useless), so a hardcoded/seeded rate either throttles too hard
// (a big batch serializes into 10+ minutes) or too loose (429 storm). Instead we
// use Additive-Increase / Multiplicative-Decrease on the CONCURRENCY limit:
//   • climb by 1 after a streak of successes (probe for more headroom),
//   • halve on a 429 (back off to the safe zone).
// This finds the account's ceiling on its own, extracts maximum throughput
// without sustained failures, and — the key property — RISES AUTOMATICALLY when
// the tier is upgraded (fewer 429s → concurrency climbs), with zero code change.
// New models get their own limiter lazily and self-tune the same way.
//
// Guarantees:
//  • No slowdown — with free capacity, calls pass through immediately (no timer).
//  • Fail-open — any scheduler error runs the call directly; it can NEVER block.
//
// When a provider DOES return good headers (limit>0), we also honor its
// remaining/reset as a secondary hard cap. Single Node process → in-memory is
// correct today; multi-instance later needs shared state (Redis).

import { seedFor } from './ratelimits.js';

const buckets = new Map();
const UP_EVERY = 5;          // successes between additive-increase steps
const PAUSE_ON_429_MS = 800; // fallback when the provider gives no reset hint

function bucket(key) {
  let b = buckets.get(key);
  if (!b) {
    const seed = seedFor(key);
    b = {
      key,
      concurrency: seed.concurrency,          // dynamic (AIMD)
      minConcurrency: Math.max(1, seed.min || 2),
      maxConcurrency: seed.max || seed.concurrency * 3,
      active: 0,
      successStreak: 0,
      queue: [],                               // [{ resolve, onStart }]
      pausedUntil: 0,                          // epoch ms (post-429 cooldown)
      // Secondary hard cap, only when the provider gives usable headers.
      limit: null, remaining: null, resetAt: 0,
      wakeTimer: null,
    };
    buckets.set(key, b);
  }
  return b;
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// OpenAI-style reset: "1s", "6m0s", "500ms", or bare seconds → ms.
function parseResetMs(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000);
  let ms = 0, matched = false, m;
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  while ((m = re.exec(s))) { matched = true; const n = parseFloat(m[1]); ms += m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60000 : n * 3600000; }
  return matched ? Math.round(ms) : 0;
}

function canStart(b, now) {
  if (now < b.pausedUntil) return false;                    // post-429 cooldown
  if (b.active >= b.concurrency) return false;              // AIMD concurrency gate
  // Secondary hard cap: only trust remaining when the provider gave a REAL limit
  // (>0). A limit of 0 is a non-signal, not "you may make zero calls".
  if (b.limit != null && b.limit > 0 && b.remaining != null && b.remaining <= 0 && now < b.resetAt) return false;
  return true;
}

function startOne(b, waiter) {
  b.active++;
  if (b.limit != null && b.limit > 0 && b.remaining != null && b.remaining > 0) b.remaining--;
  try { waiter.onStart && waiter.onStart(); } catch { /* best-effort */ }
  waiter.resolve();
}

function scheduleWake(b) {
  if (b.wakeTimer) return;
  const now = Date.now();
  let wakeAt = 0;
  if (now < b.pausedUntil) wakeAt = b.pausedUntil;
  else if (b.limit != null && b.limit > 0 && b.remaining != null && b.remaining <= 0 && now < b.resetAt) wakeAt = b.resetAt;
  if (wakeAt <= now) return;                                // concurrency blocks are freed by releases, no timer needed
  const t = setTimeout(() => { b.wakeTimer = null; pump(b); }, (wakeAt - now) + 60);
  if (t.unref) t.unref();
  b.wakeTimer = t;
}

function pump(b) {
  while (b.queue.length) {
    if (!canStart(b, Date.now())) { scheduleWake(b); return; }
    startOne(b, b.queue.shift());
  }
}

function acquire(b, onStart) {
  return new Promise((resolve) => { b.queue.push({ resolve, onStart }); pump(b); });
}

function release(b) { if (b.active > 0) b.active--; pump(b); }

// Additive increase — a streak of clean successes earns +1 concurrency.
function noteSuccess(b) {
  if (++b.successStreak >= UP_EVERY && b.concurrency < b.maxConcurrency) {
    b.concurrency++;
    b.successStreak = 0;
  }
}

// Multiplicative decrease — a 429 halves concurrency and triggers a brief pause.
// Called by the caller's retry layer the instant a 429 is seen (even if that
// layer then retries and ultimately succeeds), so AIMD reacts to the real signal
// rather than only to give-up failures.
export function note429(key, retryAfterMs = 0) {
  const b = buckets.get(key); if (!b) return;
  b.concurrency = Math.max(b.minConcurrency, Math.floor(b.concurrency / 2));
  b.successStreak = 0;
  // Hold queued jobs until the same reset moment as the request that hit 429.
  // Otherwise other jobs keep hammering the shared organization bucket while
  // this one sleeps, extending the rate-limit window for everyone.
  b.pausedUntil = Math.max(b.pausedUntil, Date.now() + Math.max(PAUSE_ON_429_MS, retryAfterMs));
  scheduleWake(b);
}

// Read good rate-limit headers (limit>0 only) as a secondary hard cap. Bad/zero
// headers are ignored — AIMD is the primary governor.
function harvest(b, res, now) {
  const h = res && res.headers; if (!h || typeof h.get !== 'function') return;
  const limit = num(h.get('x-ratelimit-limit-images')) ?? num(h.get('x-ratelimit-limit-requests'));
  if (limit == null || limit <= 0) return;                  // no usable signal → leave AIMD in charge
  const rem = num(h.get('x-ratelimit-remaining-images')) ?? num(h.get('x-ratelimit-remaining-requests'));
  const reset = h.get('x-ratelimit-reset-images') || h.get('x-ratelimit-reset-requests');
  b.limit = limit;
  if (rem != null) b.remaining = rem;
  if (reset) b.resetAt = now + parseResetMs(reset);
}

/**
 * run(key, fn, opts) — schedule an outbound provider call through the limiter.
 *  fn should return the provider fetch Response (headers are harvested).
 *  opts.onStart fires when the slot is acquired (queued → rendering).
 * Fail-open on any scheduler error.
 */
export async function run(key, fn, opts = {}) {
  let b;
  try { b = bucket(key); } catch { try { opts.onStart && opts.onStart(); } catch {} return fn(); }
  try { await acquire(b, opts.onStart); }
  catch { try { opts.onStart && opts.onStart(); } catch {} return fn(); }
  try {
    const res = await fn();
    try {
      harvest(b, res, Date.now());
      // A 429 that reached here (the caller didn't pre-note it) still counts.
      if (res && res.status === 429) note429(key); else noteSuccess(b);
    } catch { /* accounting is best-effort */ }
    return res;
  } finally {
    release(b);
  }
}

export function stats() {
  const out = {};
  for (const [k, b] of buckets) {
    out[k] = {
      active: b.active, queued: b.queue.length,
      concurrency: b.concurrency, minConcurrency: b.minConcurrency, maxConcurrency: b.maxConcurrency,
      successStreak: b.successStreak,
      limit: b.limit, remaining: b.remaining,
      pausedInMs: b.pausedUntil > Date.now() ? b.pausedUntil - Date.now() : 0,
    };
  }
  return out;
}

export function totalQueued() { let n = 0; for (const b of buckets.values()) n += b.queue.length; return n; }
