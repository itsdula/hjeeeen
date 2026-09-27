// Rate-limit SEEDS + provider normalization for the adaptive scheduler.
//
// These are COLD-START hints only — a conservative starting point before the
// first live response teaches the scheduler the account's real limits. For
// providers that return rate-limit headers (OpenAI/Google/Anthropic) the live
// `x-ratelimit-*` values override these within one request, so a tier upgrade
// widens the queue automatically with no code change. For header-less providers
// (BytePlus/Kling video) the concurrency seed + 429/Retry-After learning govern.
//
// This honors the "all versions, never hardcode one" law: the seed is a
// fallback, not the truth. A brand-new model with no seed falls back to its
// provider default (or the global default) and then self-tunes.

// Canonical provider vocabulary (mirrors cost.ts ProviderId). Everything
// normalizes onto these so one backend spelled three ways shares ONE bucket.
export function normalizeProvider(p) {
  const s = String(p || '').toLowerCase().trim();
  if (s === 'seedance' || s === 'bytedance' || s === 'ark') return 'byteplus';
  if (s === 'kuaishou') return 'kling';
  if (s === 'anthropic' || s === 'claude') return 'anthropic';
  if (s === 'openai' || s === 'azure-openai') return 'openai';
  if (s === 'google' || s === 'gemini' || s === 'imagen') return 'google';
  return s || 'unknown';
}

// A stable bucket key: one rate bucket per (provider, model). New models get a
// bucket lazily on first use — no registration needed.
export function bucketKey(provider, model) {
  return `${normalizeProvider(provider)}:${String(model || 'default')}`;
}

// Seeds are the AIMD STARTING point: `concurrency` = initial simultaneous calls,
// `min` = the floor it backs off to on repeated 429s, `max` = the ceiling it may
// climb to on sustained success. The scheduler discovers the real limit between
// min and max — these are just sane starting brackets, not hard limits.
const GLOBAL_DEFAULT = { concurrency: 4, min: 2, max: 10 };

// Ordered rules — first match wins.
const RULES = [
  // OpenAI images (gpt-image) — the door that 429-stormed. Start moderate, allow
  // it to climb; the account's true image ceiling is found empirically.
  [/^openai:gpt-image/, { concurrency: 5, min: 2, max: 12 }],
  // OpenAI text (gpt-5*) — much higher tiers.
  [/^openai:gpt-/, { concurrency: 8, min: 3, max: 24 }],
  [/^openai:/, { concurrency: 5, min: 2, max: 12 }],
  // Google Imagen (Nano Banana Pro) vs Gemini text.
  [/^google:imagen/, { concurrency: 4, min: 2, max: 10 }],
  [/^google:gemini/, { concurrency: 6, min: 3, max: 18 }],
  [/^google:/, { concurrency: 5, min: 2, max: 12 }],
  // Anthropic text.
  [/^anthropic:/, { concurrency: 6, min: 3, max: 18 }],
  // Video providers are submit/poll + concurrency-bound.
  [/^byteplus:/, { concurrency: 3, min: 1, max: 6 }],
  [/^kling:/, { concurrency: 3, min: 1, max: 6 }],
];

export function seedFor(key) {
  for (const [re, seed] of RULES) if (re.test(key)) return { ...seed };
  return { ...GLOBAL_DEFAULT };
}
