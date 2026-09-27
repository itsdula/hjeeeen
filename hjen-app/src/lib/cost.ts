// ============================================================================
// HJEN Studio — unified generation-cost system
// ----------------------------------------------------------------------------
// ONE source of truth for what a single generation actually costs us (vendor
// cost, before any HJEN margin). Every model the app calls is registered here.
//
// Two ways a cost is known:
//   • METERED  — the vendor's response hands back the real billable unit
//                (Seedance: usage.completion_tokens; Claude: usage tokens;
//                 Replicate: metrics.predict_time). This is ground truth.
//   • ESTIMATED — the vendor returns no usage (OpenAI images, Google Imagen),
//                so we derive cost from the request params (size × quality).
//
// resolveCost() is metered-first: if real usage is passed it uses it and marks
// `metered: true`; otherwise it estimates from params and marks `metered: false`.
//
// Margin is intentionally NOT applied here. This module reports vendor cost
// only. A separate margin/client-price layer can sit on top later without
// touching any rate or formula below.
//
// RATES: every entry carries `asOf` + `source`. When a vendor changes prices,
// edit the constant and bump `asOf`. Rates flagged `unverified` are working
// estimates — confirm against the real billing dashboard before quoting.
// ============================================================================

export type ProviderId = 'openai' | 'google' | 'byteplus' | 'replicate' | 'anthropic' | 'kling';

export type CostUnit =
  | 'token'        // single token stream (video completion tokens)
  | 'token-io'     // separate input/output token rates (LLM)
  | 'image-mp'     // priced by megapixels × quality
  | 'image-tier'   // flat price per quality tier
  | 'compute-sec'; // priced by seconds of GPU compute

export interface RateEntry {
  provider: ProviderId;
  /** Vendor-facing model id this rate applies to (or a family prefix). */
  model: string;
  unit: CostUnit;
  asOf: string;
  source: string;
  /** Working estimate not yet confirmed against a real invoice. */
  unverified?: boolean;
  /** Rate shape depends on `unit` — see usage in resolveCost. */
  rate: {
    usdPerMTok?: number;                       // token / video
    inPerMTok?: number;                        // token-io input
    outPerMTok?: number;                       // token-io output
    perMP?: Record<'low' | 'medium' | 'high', number>; // image-mp
    perTier?: Record<string, number>;          // image-tier
    usdPerSec?: number;                        // compute-sec
  };
}

// ----------------------------------------------------------------------------
// THE REGISTRY — edit rates here, nowhere else.
// ----------------------------------------------------------------------------
export const PRICING: Record<string, RateEntry> = {
  // ---- OpenAI images (no usage returned → always estimated) ----
  'openai:gpt-image-2': {
    provider: 'openai',
    model: 'gpt-image-2',
    unit: 'image-mp',
    asOf: '2026-05',
    source: 'OpenAI official token rate ($30/1M output tokens), per-MP baselines',
    rate: {
      // $ per 1 megapixel at each quality (4K high ≈ $0.41 / 8.3MP).
      perMP: { low: 0.006, medium: 0.053, high: 0.211 },
    },
  },

  // ---- Google Imagen / "Nano Banana Pro" (no usage returned → estimated) ----
  'google:imagen-3.0': {
    provider: 'google',
    model: 'imagen-3.0-generate-002',
    unit: 'image-tier',
    asOf: '2026-05',
    source: 'Google Imagen published per-image tier pricing',
    rate: {
      perTier: { draft: 0.02, standard: 0.04, ultra: 0.06 },
    },
  },

  // ---- BytePlus ModelArk · Seedance 2.0 video (METERED via completion_tokens) ----
  // BytePlus bills video per token; token consumption ≈ (W×H×fps×duration)/1024.
  // We never estimate this — the polled task returns usage.completion_tokens,
  // which IS the billable count. Only the $/M-token rate needs confirming.
  'byteplus:dreamina-seedance-2-0': {
    provider: 'byteplus',
    model: 'dreamina-seedance-2-0-260128',
    unit: 'token',
    asOf: '2026-06',
    source: 'docs.byteplus.com/en/docs/ModelArk/1544106 (per-token video billing)',
    unverified: true, // confirm $/M against BytePlus billing dashboard
    rate: { usdPerMTok: 1.5 },
  },

  // ---- Kling video (Kuaishou) — priced PER SECOND (1 unit = $0.14) ----
  // Kling bills per output second; the rate depends on model × mode (720P/1080P/
  // 4K) × native-audio. The dashboard rows below carry a representative rate
  // (1080P, no audio); the live per-clip number in the Video UI comes from
  // estimateKlingCost() in pricing.ts, which knows the full mode/audio matrix.
  // Rates verified from kling.ai/dev/pricing (2026-07); estimated ones flagged.
  'kling:kling-3.0-turbo': {
    provider: 'kling', model: 'kling-3.0-turbo', unit: 'compute-sec', asOf: '2026-07',
    source: 'kling.ai/dev/pricing — 1080P w/ audio 1.0u ($0.14)/s', rate: { usdPerSec: 0.14 },
  },
  'kling:kling-v3': {
    provider: 'kling', model: 'kling-v3', unit: 'compute-sec', asOf: '2026-07',
    source: 'kling.ai/dev/pricing — 1080P no-audio 0.8u ($0.112)/s', rate: { usdPerSec: 0.112 },
  },
  'kling:kling-v3-omni': {
    provider: 'kling', model: 'kling-v3-omni', unit: 'compute-sec', asOf: '2026-07',
    source: 'kling.ai/dev/pricing — 1080P no-video/no-audio 0.8u ($0.112)/s', rate: { usdPerSec: 0.112 },
  },
  'kling:kling-video-o1': {
    provider: 'kling', model: 'kling-video-o1', unit: 'compute-sec', asOf: '2026-07',
    source: 'kling.ai/dev/pricing (O1 per-second — confirm)', unverified: true, rate: { usdPerSec: 0.112 },
  },
  'kling:kling-v2-6': {
    provider: 'kling', model: 'kling-v2-6', unit: 'compute-sec', asOf: '2026-07',
    source: 'kling.ai/dev/pricing (2.6 per-second — confirm)', unverified: true, rate: { usdPerSec: 0.098 },
  },
  'kling:kling-v2-5-turbo': {
    provider: 'kling', model: 'kling-v2-5-turbo', unit: 'compute-sec', asOf: '2026-07',
    source: 'kling.ai/dev/pricing (2.5 Turbo per-second — confirm)', unverified: true, rate: { usdPerSec: 0.084 },
  },

  // ---- Replicate face/upscale enhancers (METERED via metrics.predict_time) ----
  // Replicate bills per second of GPU compute. The prediction response returns
  // metrics.predict_time (seconds). usdPerSec depends on the hardware tier.
  'replicate:sczhou/codeformer': {
    provider: 'replicate',
    model: 'sczhou/codeformer',
    unit: 'compute-sec',
    asOf: '2026-06',
    source: 'Replicate per-second GPU billing (metrics.predict_time)',
    unverified: true,
    rate: { usdPerSec: 0.0014 }, // confirm hardware tier on the model page
  },
  'replicate:philz1337x/clarity-upscaler': {
    provider: 'replicate',
    model: 'philz1337x/clarity-upscaler',
    unit: 'compute-sec',
    asOf: '2026-06',
    source: 'Replicate per-second GPU billing (metrics.predict_time)',
    unverified: true,
    rate: { usdPerSec: 0.0014 },
  },

  // ---- Anthropic Claude · prompt enhancement (METERED via usage tokens) ----
  // NOTE: the live cost for this path is computed in electron/main.ts (main
  // process). This entry mirrors that rate so the registry stays the single
  // documented source. Keep both in sync when the rate changes.
  'anthropic:claude-sonnet-4-6': {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    unit: 'token-io',
    asOf: '2026-05',
    source: 'Anthropic published Claude Sonnet pricing',
    rate: { inPerMTok: 3, outPerMTok: 15 },
  },
};

// ============================================================================
// PRICING CONFIG — the dashboard-controlled margin/discount/rate layer.
// ----------------------------------------------------------------------------
// Cost is immutable ground truth (logged at generation time). Client PRICE is
// derived live from this config, so changing markup/discount instantly reprices
// every report. Persisted to {projectsRoot}/_pricing.json via IPC.
//
// Formula (markup % on cost, discount cuts the client's final price):
//   clientPrice = vendorCost × (1 + markup/100) × (1 − discount/100)
//   marginUsd   = clientPrice − vendorCost
// ============================================================================

export interface ModelOverride {
  /** Optional vendor-rate override, merged over the registry default ("price"). */
  rate?: RateEntry['rate'];
  /** Markup % on cost. null/undefined = inherit the global markup. */
  markupPct?: number | null;
  /** Discount % off the client price. null/undefined = inherit the global discount. */
  discountPct?: number | null;
}

export interface PricingConfig {
  /** Applied to every model unless overridden per-model. */
  global: { markupPct: number; discountPct: number };
  /** Per-registry-key overrides (rate and/or markup/discount). */
  models: Record<string, ModelOverride>;
  updatedAt?: string;
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  global: { markupPct: 100, discountPct: 0 },
  models: {},
};

/** The registry rate for a key, with any dashboard rate-override merged in. */
export function effectiveRate(key: string, config?: PricingConfig): RateEntry | null {
  const base = PRICING[key];
  if (!base) return null;
  const ov = config?.models?.[key]?.rate;
  if (!ov) return base;
  return { ...base, rate: { ...base.rate, ...ov } };
}

/** Resolve the markup/discount in effect for a model (per-model → global). */
export function effectiveMarkup(
  key: string,
  config: PricingConfig,
): { markupPct: number; discountPct: number } {
  const m = config.models?.[key];
  return {
    markupPct: m?.markupPct ?? config.global.markupPct,
    discountPct: m?.discountPct ?? config.global.discountPct,
  };
}

/** Turn a vendor cost into a client price + margin. Pure; safe for reporting. */
export function applyMargin(
  vendorCostUsd: number,
  markupPct: number,
  discountPct: number,
): { clientPriceUsd: number; marginUsd: number } {
  const clientPriceUsd = vendorCostUsd * (1 + markupPct / 100) * (1 - discountPct / 100);
  return { clientPriceUsd, marginUsd: clientPriceUsd - vendorCostUsd };
}

// ----------------------------------------------------------------------------
// Resolver result
// ----------------------------------------------------------------------------
export interface CostResult {
  provider: ProviderId;
  model: string;
  unit: CostUnit;
  /** Billable quantity used for the calc (tokens, MP, seconds, or image count). */
  billableUnits: number;
  /** true = derived from real usage the vendor returned; false = estimated. */
  metered: boolean;
  /** Vendor cost in USD, before any HJEN margin. */
  actualCostUsd: number;
  rateAsOf: string;
  source: string;
  unverified: boolean;
  breakdown: string;
  // ---- Pricing fields, populated only when a PricingConfig is passed ----
  markupPct?: number;
  discountPct?: number;
  /** What we charge the client = cost × (1+markup) × (1−discount). */
  clientPriceUsd?: number;
  /** clientPrice − cost. */
  marginUsd?: number;
}

export interface ResolveCostInput {
  /** Registry key, e.g. 'byteplus:dreamina-seedance-2-0'. */
  key: string;
  /** Real usage returned by the vendor (metered path). */
  usage?: {
    completionTokens?: number | null; // video / single-stream token models
    inputTokens?: number | null;      // LLM
    outputTokens?: number | null;     // LLM
    computeSeconds?: number | null;   // Replicate predict_time
  };
  /** Request params for the estimated path (when no usage is available). */
  params?: {
    width?: number;
    height?: number;
    quality?: 'low' | 'medium' | 'high'; // image-mp
    tier?: string;                       // image-tier
    imageCount?: number;
  };
}

/**
 * Metered-first cost resolution. Returns null only if the key is unknown.
 * Falls back to a $0 / unmetered result when neither usage nor params are
 * sufficient (e.g. a video poll that never returned tokens).
 */
export function resolveCost(input: ResolveCostInput, config?: PricingConfig): CostResult | null {
  const entry = effectiveRate(input.key, config);
  if (!entry) return null;

  const base = {
    provider: entry.provider,
    model: entry.model,
    unit: entry.unit,
    rateAsOf: entry.asOf,
    source: entry.source,
    unverified: !!entry.unverified,
  };
  const u = input.usage ?? {};
  const p = input.params ?? {};
  const count = p.imageCount ?? 1;

  const vendor: CostResult | null = (() => {
  switch (entry.unit) {
    case 'token': {
      const tokens = u.completionTokens ?? 0;
      const rate = entry.rate.usdPerMTok ?? 0;
      const usd = (tokens / 1_000_000) * rate;
      return {
        ...base,
        billableUnits: tokens,
        metered: tokens > 0,
        actualCostUsd: usd,
        breakdown: tokens > 0
          ? `${entry.model} · ${tokens.toLocaleString()} tokens × $${rate}/M = ${formatUSD(usd)}`
          : `${entry.model} · no usage returned`,
      };
    }

    case 'token-io': {
      const inTok = u.inputTokens ?? 0;
      const outTok = u.outputTokens ?? 0;
      const inRate = entry.rate.inPerMTok ?? 0;
      const outRate = entry.rate.outPerMTok ?? 0;
      const usd = (inTok / 1_000_000) * inRate + (outTok / 1_000_000) * outRate;
      return {
        ...base,
        billableUnits: inTok + outTok,
        metered: inTok + outTok > 0,
        actualCostUsd: usd,
        breakdown: `${entry.model} · ${inTok.toLocaleString()} in + ${outTok.toLocaleString()} out = ${formatUSD(usd)}`,
      };
    }

    case 'compute-sec': {
      const secs = u.computeSeconds ?? 0;
      const rate = entry.rate.usdPerSec ?? 0;
      const usd = secs * rate;
      return {
        ...base,
        billableUnits: secs,
        metered: secs > 0,
        actualCostUsd: usd,
        breakdown: secs > 0
          ? `${entry.model} · ${secs.toFixed(2)}s × $${rate}/s = ${formatUSD(usd)}`
          : `${entry.model} · no compute time returned`,
      };
    }

    case 'image-mp': {
      const w = p.width ?? 1024;
      const h = p.height ?? 1024;
      const q = p.quality ?? 'high';
      const mp = (w * h) / 1_000_000;
      const perImage = Math.max(0.001, (entry.rate.perMP?.[q] ?? 0) * mp);
      const usd = perImage * count;
      return {
        ...base,
        billableUnits: count,
        metered: false, // vendor returns no usage for images
        actualCostUsd: usd,
        breakdown: `${entry.model} · ${q} · ${w}x${h} ≈ $${perImage.toFixed(3)}/image × ${count} = ${formatUSD(usd)}`,
      };
    }

    case 'image-tier': {
      const tier = p.tier ?? 'standard';
      const perImage = entry.rate.perTier?.[tier] ?? 0.04;
      const usd = perImage * count;
      return {
        ...base,
        billableUnits: count,
        metered: false,
        actualCostUsd: usd,
        breakdown: `${entry.model} · ${tier} · $${perImage.toFixed(3)}/image × ${count} = ${formatUSD(usd)}`,
      };
    }

    default:
      return null;
  }
  })();

  if (!vendor) return null;
  if (!config) return vendor;

  const { markupPct, discountPct } = effectiveMarkup(input.key, config);
  const { clientPriceUsd, marginUsd } = applyMargin(vendor.actualCostUsd, markupPct, discountPct);
  return { ...vendor, markupPct, discountPct, clientPriceUsd, marginUsd };
}

export function formatUSD(amount: number): string {
  if (amount <= 0) return '$0.00';
  if (amount < 0.01) return '<$0.01';
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}
