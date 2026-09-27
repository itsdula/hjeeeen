// Server-side gpt-image-2 via the OpenAI REST API (global fetch + FormData — no
// SDK, no install). Ported from the desktop renderer (src/lib/openai.ts), moved
// OFF the browser so the key never leaves the server. References arrive as
// uploaded file paths under DATA_DIR/refs (see /api/refs).

import fs from 'node:fs';
import { config, OPENAI_BASE, IMAGE_MODEL } from '../config.js';
import { run as schedule } from '../scheduler.js';
import { bucketKey } from '../ratelimits.js';

function mimeOf(file) {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}

function isSafety(text) {
  const hay = (text || '').toLowerCase();
  return hay.includes('safety system') || hay.includes('moderation') ||
    hay.includes('content_policy') || hay.includes('content policy') || hay.includes('rejected by');
}

// The web studio's /api/make path (100-user vehicle) hits the SAME per-org
// gpt-image rate limit (5 images/min at Tier 1) as the desktop gateway. Absorb
// 429 / transient 5xx / network blips here too — honor OpenAI's retry hint and
// retry a few times so a burst is a short wait, not a red error. Total wait is
// capped so the whole request stays under Cloudflare's ~100s origin ceiling.
async function fetchWithRetry(url, opts) {
  const MAX_RETRIES = 4;
  const TOTAL_WAIT_CAP_MS = 70_000;
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, opts);
    } catch (netErr) {
      const backoff = Math.min(1500 * (attempt + 1), 6000);
      if (attempt >= MAX_RETRIES || waited + backoff > TOTAL_WAIT_CAP_MS) throw netErr;
      waited += backoff;
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
    if (!retryable || attempt >= MAX_RETRIES) return res;
    const peek = await res.clone().text().catch(() => '');
    let waitMs = 0;
    const ra = res.headers.get('retry-after');
    if (ra && !Number.isNaN(Number(ra))) waitMs = Number(ra) * 1000;
    if (!waitMs) { const m = peek.match(/try again in ([0-9.]+)s/i); if (m) waitMs = Math.ceil(parseFloat(m[1]) * 1000); }
    if (!waitMs) waitMs = Math.min(2000 * (attempt + 1), 8000);
    waitMs += 300;
    if (waited + waitMs > TOTAL_WAIT_CAP_MS) return res;
    waited += waitMs;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export async function makeImage(params) {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY not configured on the server.');
  const model = params.modelId ?? IMAGE_MODEL;
  const quality = params.quality ?? 'high';
  const size = params.size;
  const refs = params.referencePaths ?? [];
  const headers = { Authorization: `Bearer ${config.openaiKey}` };

  // Route the actual OpenAI call through the adaptive scheduler so a burst of
  // makes is paced under the org's image rate limit (no 429 storm) and the
  // bucket self-tunes from the response's x-ratelimit-* headers. onStart flips
  // the caller's job from "queued" to "rendering" the instant a slot is free.
  const bkey = bucketKey('openai', model);
  let res;
  if (refs.length > 0) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', params.prompt);
    form.append('size', size);
    form.append('quality', quality);
    form.append('n', '1');
    for (const p of refs) {
      if (!fs.existsSync(p)) throw new Error(`Reference image could not be read: ${p}`);
      const buf = fs.readFileSync(p);
      form.append('image[]', new Blob([buf], { type: mimeOf(p) }), p.split('/').pop() || 'ref.png');
    }
    res = await schedule(bkey, () => fetchWithRetry(`${OPENAI_BASE}/images/edits`, { method: 'POST', headers, body: form }), { onStart: params.onStart });
  } else {
    res = await schedule(bkey, () => fetchWithRetry(`${OPENAI_BASE}/images/generations`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: params.prompt, size, quality, n: 1 }),
    }), { onStart: params.onStart });
  }

  if (!res.ok) {
    const errText = await res.text();
    if (isSafety(errText)) throw new Error('SAFETY: The safety system rejected this request. Simplify the prompt or run Refine first.');
    throw new Error(`OpenAI ${refs.length ? 'images.edits' : 'images.generations'} ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned an empty payload (no b64_json).');
  return { b64, prompt: params.prompt, size, model };
}

// Pricing moved to the single source of truth — ../pricing.js.
export { estimateImageUsd } from '../pricing.js';
