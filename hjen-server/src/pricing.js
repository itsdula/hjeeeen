// ============================================================================
// HJEN PRICING — the single source of truth for every provider price and
// every HJEN action cost. LAW: no price constant lives anywhere else in this
// codebase. Every module imports from here. (This is the `pricing.ts` promised
// in HJEN_90Day_Launch_Plan §6, born as .js to match the zero-dep server.)
//
// CFO rhythm (see 00_COMPANY/strategy/platform_operations/HJEN_CFO_Playbook.md):
//   - Review provider prices every Monday + on every provider announcement.
//   - A >15% move in any provider price → update here SAME DAY, re-derive
//     internal credit cost. Customer subscription price changes only at the
//     quarterly review (strategy §6).
//   - Every entry carries verifiedAt (ISO date) + source. An entry older than
//     45 days is stale — re-verify before quoting margins from it.
// ============================================================================

/** Margin floor from the signed strategy (HJEN_90Day_Launch_Plan §6). */
export const MARGIN_FLOOR = 0.60;

/** SAR per USD (pegged). */
export const SAR_PER_USD = 3.75;

// ---------------------------------------------------------------------------
// PROVIDER PRICES (USD). verifiedAt = date a human/agent confirmed the number
// against the provider's own published pricing. estimate:true = derived, not
// a list price — treat as ±30% until metered against real invoices.
// ---------------------------------------------------------------------------

export const LLM_PRICES = {
  // Anthropic — verified 2026-07-22 against the official model table (cache 2026-06-24).
  'claude-fable-5':    { inPerMTok: 10.0, outPerMTok: 50.0, verifiedAt: '2026-07-22', source: 'anthropic official' },
  'claude-opus-4-8':   { inPerMTok: 5.0,  outPerMTok: 25.0, verifiedAt: '2026-07-22', source: 'anthropic official' },
  'claude-sonnet-5':   { inPerMTok: 3.0,  outPerMTok: 15.0, verifiedAt: '2026-07-22', source: 'anthropic official (intro $2/$10 through 2026-08-31)' },
  'claude-sonnet-4-6': { inPerMTok: 3.0,  outPerMTok: 15.0, verifiedAt: '2026-07-22', source: 'anthropic official' },
  'claude-haiku-4-5':  { inPerMTok: 1.0,  outPerMTok: 5.0,  verifiedAt: '2026-07-22', source: 'anthropic official' },
};

export const IMAGE_PRICES = {
  // OpenAI gpt-image-2 — token-based billing (2026 model: resolution replaces
  // the old quality knob). Per-image figures are calculator estimates, kept
  // deliberately CONSERVATIVE (rounded up) so margin math never flatters us.
  'gpt-image-2': {
    tokenRates: { textInPerMTok: 5.0, imageInPerMTok: 8.0, imageOutPerMTok: 30.0 },
    perImageEstimate: { low: 0.03, medium: 0.07, high: 0.22 },
    estimate: true,
    verifiedAt: '2026-07-22',
    source: 'openai token rates (web-verified); per-image = conservative estimate, re-baseline from first real invoice',
  },
};

export const VIDEO_PRICES = {
  // Kling — per-second billing, proven live E2E 2026-07-14. 1 unit = $0.14.
  kling: { usdPerUnit: 0.14, billing: 'per-second (units vary by model/mode)', verifiedAt: '2026-07-14', source: 'live E2E run' },
  // Seedance 2 (BytePlus/Volcengine) — NOT yet verified against an invoice.
  seedance2: { usdPerVideoEstimate: null, estimate: true, verifiedAt: null, source: 'TO-VERIFY: read first BytePlus invoice, then fill' },
};

// ---------------------------------------------------------------------------
// HJEN ACTION COSTS — what one user-facing action costs us, derived from the
// provider tables above. This is the layer the credits engine prices against:
// creditPrice(action) must satisfy cost(action) / creditPrice(action) <= 1 - MARGIN_FLOOR.
// ---------------------------------------------------------------------------

/** USD cost of one image make at a given quality tier. */
export function imageMakeUsd(quality = 'high') {
  const p = IMAGE_PRICES['gpt-image-2'].perImageEstimate;
  return p[quality] ?? p.high;
}

/** USD cost of an LLM call given token usage. Throws on unknown model — no silent zero-cost events. */
// Normalize a wire model id to a price-table key: strip date suffixes
// (claude-haiku-4-5-20251001 → claude-haiku-4-5) and try progressively shorter
// prefixes so new dated snapshots still price correctly.
export function priceKeyFor(modelId) {
  const id = String(modelId || '');
  if (LLM_PRICES[id]) return id;
  const noDate = id.replace(/-\d{6,8}$/, '');
  if (LLM_PRICES[noDate]) return noDate;
  const keys = Object.keys(LLM_PRICES).sort((a, b) => b.length - a.length);
  for (const k of keys) if (id.startsWith(k)) return k;
  return null;
}

export function llmUsd(modelId, inputTokens, outputTokens) {
  const mapped = priceKeyFor(modelId);
  if (mapped && mapped !== modelId) modelId = mapped;
  const p = LLM_PRICES[modelId];
  if (!p) throw new Error(`pricing.js: unknown model "${modelId}" — add it to LLM_PRICES before use.`);
  return (inputTokens / 1e6) * p.inPerMTok + (outputTokens / 1e6) * p.outPerMTok;
}

// Real gpt-image spend from the token usage the API returns, using the same
// conservative token rates. Falls back to null when usage is missing.
export function imageUsdFromUsage(usage, modelId = 'gpt-image-2') {
  const p = IMAGE_PRICES[modelId];
  if (!p || !usage) return null;
  const r = p.tokenRates;
  const textIn = usage.input_tokens_details?.text_tokens ?? usage.input_tokens ?? 0;
  const imgIn = usage.input_tokens_details?.image_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  if (!textIn && !imgIn && !out) return null;
  return (textIn / 1e6) * r.textInPerMTok + (imgIn / 1e6) * r.imageInPerMTok + (out / 1e6) * r.imageOutPerMTok;
}

/** Minimum credit price (USD) an action must be sold at to hold the margin floor. */
export function minCreditPriceUsd(actionCostUsd) {
  return actionCostUsd / (1 - MARGIN_FLOOR);
}

/** Realized margin for one action. The daily dashboard aggregates this. */
export function marginOf(revenueUsd, costUsd) {
  if (revenueUsd <= 0) return -1;
  return (revenueUsd - costUsd) / revenueUsd;
}

// ---------------------------------------------------------------------------
// Back-compat exports (old call sites re-routed here — do not re-inline).
// ---------------------------------------------------------------------------

/** @deprecated shape kept for providers/anthropic.js via config.js re-export. */
export const CLAUDE_PRICING = {
  inputPerMTok: LLM_PRICES['claude-sonnet-4-6'].inPerMTok,
  outputPerMTok: LLM_PRICES['claude-sonnet-4-6'].outPerMTok,
};

/** @deprecated old name kept for server.js; delegates to imageMakeUsd. */
export function estimateImageUsd(quality) {
  return imageMakeUsd(quality);
}
