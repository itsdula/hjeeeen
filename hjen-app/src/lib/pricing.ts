// Cost estimation — compatibility layer over the unified registry in cost.ts.
//
// All rates and formulas now live in cost.ts (the single source of truth).
// These wrappers keep the existing call sites (BottomDock, store, VideoView)
// working with their original signatures while delegating the actual math.
//
// Honest risk: image costs here are ESTIMATED — OpenAI/Google return no usage.
// Seedance is METERED from the polled usage.completion_tokens; only the $/M rate
// in cost.ts needs confirming against the BytePlus billing dashboard.

import type { ModelId, Quality } from '../types/catalog';
import { resolveCost, formatUSD } from './cost';

export { formatUSD };

export interface CostEstimate {
  usd: number;
  perImage: number;
  imageCount: number;
  estimated: true;
  asOf: string;
  source: 'openai' | 'google';
  breakdown: string;
}

export function estimateCost(args: {
  model: ModelId;
  quality: Quality;
  apiSize: string;
  imageCount?: number;
}): CostEstimate {
  const count = args.imageCount ?? 1;
  const [w, h] = args.apiSize.split('x').map(Number);

  if (args.model === 'GPT_IMAGE_2') {
    const quality = args.quality === 'LOW' ? 'low' : args.quality === 'MED' ? 'medium' : 'high';
    const r = resolveCost({
      key: 'openai:gpt-image-2',
      params: { width: w || 1024, height: h || 1024, quality, imageCount: count },
    })!;
    return {
      usd: r.actualCostUsd,
      perImage: r.actualCostUsd / count,
      imageCount: count,
      estimated: true,
      asOf: r.rateAsOf,
      source: 'openai',
      breakdown: r.breakdown,
    };
  }

  const tier = args.quality === 'LOW' ? 'draft' : args.quality === 'MED' ? 'standard' : 'ultra';
  const r = resolveCost({
    key: 'google:imagen-3.0',
    params: { tier, imageCount: count },
  })!;
  return {
    usd: r.actualCostUsd,
    perImage: r.actualCostUsd / count,
    imageCount: count,
    estimated: true,
    asOf: r.rateAsOf,
    source: 'google',
    breakdown: r.breakdown,
  };
}

export interface SeedanceCostEstimate {
  usd: number;
  tokens: number;
  ratePerMTokens: number;
  estimated: true;
  asOf: string;
  breakdown: string;
}

// ---------------------------------------------------------------------------
// Kling video — priced per output second. 1 unit = $0.14 (list price). The rate
// depends on model × mode (std=720P / pro=1080P / 4k=4K) × native audio, per
// kling.ai/dev/pricing. Values below are $/second. Entries flagged in cost.ts
// as unverified use the closest documented flagship rate as a working estimate.
// ---------------------------------------------------------------------------
type KlingMode = 'std' | 'pro' | '4k';
interface KlingRate { noAudio: number; audio: number; } // $/second

const KLING_RATES: Record<string, Partial<Record<KlingMode, KlingRate>>> = {
  // Flagship — from the published pricing table.
  'kling-3.0-turbo': { std: { noAudio: 0.112, audio: 0.112 }, pro: { noAudio: 0.14, audio: 0.14 } }, // turbo always ships audio
  'kling-v3':       { std: { noAudio: 0.084, audio: 0.126 }, pro: { noAudio: 0.112, audio: 0.168 }, '4k': { noAudio: 0.42, audio: 0.42 } },
  'kling-v3-omni':  { std: { noAudio: 0.084, audio: 0.112 }, pro: { noAudio: 0.112, audio: 0.14 },  '4k': { noAudio: 0.42, audio: 0.42 } },
  // Estimated (per-second behind "More Pricing" — confirm).
  'kling-video-o1': { std: { noAudio: 0.084, audio: 0.084 }, pro: { noAudio: 0.112, audio: 0.112 } },
  'kling-v2-6':     { std: { noAudio: 0.07,  audio: 0.098 }, pro: { noAudio: 0.098, audio: 0.14 } },
  'kling-v2-5-turbo': { std: { noAudio: 0.056, audio: 0.056 }, pro: { noAudio: 0.084, audio: 0.084 } },
  'kling-v1-6':     { std: { noAudio: 0.056, audio: 0.056 }, pro: { noAudio: 0.084, audio: 0.084 } },
  'kling-v2-1':     { std: { noAudio: 0.056, audio: 0.056 }, pro: { noAudio: 0.084, audio: 0.084 } },
};

export interface KlingCostEstimate {
  usd: number;
  perSecond: number;
  seconds: number;
  estimated: true;
  breakdown: string;
}

/** Pre-flight Kling cost: rate($/s for model+mode+audio) × duration. */
export function estimateKlingCost(
  modelId: string,
  mode: KlingMode,
  durationSec: number,
  audio: boolean,
): KlingCostEstimate | null {
  const byMode = KLING_RATES[modelId];
  const r = byMode?.[mode] ?? byMode?.pro ?? byMode?.std;
  if (!r) return null;
  const perSecond = audio ? r.audio : r.noAudio;
  const seconds = durationSec || 5;
  const usd = Number((perSecond * seconds).toFixed(3));
  return {
    usd,
    perSecond,
    seconds,
    estimated: true,
    breakdown: `${modelId} · ${mode}${audio ? ' +audio' : ''} · $${perSecond}/s × ${seconds}s = ${formatUSD(usd)}`,
  };
}

export function estimateSeedanceCost(
  completionTokens: number | null | undefined,
): SeedanceCostEstimate | null {
  if (!completionTokens || completionTokens <= 0) return null;
  const r = resolveCost({
    key: 'byteplus:dreamina-seedance-2-0',
    usage: { completionTokens },
  });
  if (!r) return null;
  // ratePerMTokens: derive from the resolved figures so it always matches cost.ts.
  const ratePerMTokens = r.actualCostUsd > 0 ? (r.actualCostUsd / completionTokens) * 1_000_000 : 0;
  return {
    usd: r.actualCostUsd,
    tokens: completionTokens,
    ratePerMTokens,
    estimated: true,
    asOf: r.rateAsOf,
    breakdown: r.breakdown,
  };
}
