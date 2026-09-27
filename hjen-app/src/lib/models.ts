// Model registry — capabilities + label per supported image-gen backend.
//
// gpt-image-2 (verified 2026-05): supports arbitrary W×H where:
//   - both edges divisible by 16
//   - aspect ratio between 1:3 and 3:1
//   - total pixels: 655,360 (~0.65MP) to 8,294,400 (~8.3MP)
//   - max long edge: 3840px
//   docs: https://developers.openai.com/api/docs/models/gpt-image-2

import type { ModelId, Resolution, Quality } from '../types/catalog';

/** What a model will actually accept as a reference image.
 *
 *  The two doors disagree about what a reference IS, and that disagreement is
 *  the single biggest correctness risk in any asset system built on both:
 *
 *   - OpenAI takes ONE FLAT ARRAY on /images/edits. No roles, no per-kind
 *     budget; every input is processed at high fidelity automatically (which is
 *     why `input_fidelity` must be OMITTED for gpt-image-2 — the API rejects it).
 *   - Google takes TYPED BUDGETS in parts[]: separate ceilings for character
 *     references and high-fidelity object references. The widely-quoted "14
 *     reference images" is the TOTAL input allowance, not a consistency budget.
 *
 *  So the budget lives here as data, and the payload compilers
 *  (lib/assets/payload.ts) read it rather than assuming a shared shape. */
export interface RefBudget {
  /** Hard API ceiling on total reference images. */
  max: number;
  /** Google only — the per-kind ceilings. Absent means "one flat array". */
  characters?: number;
  objects?: number;
  /** What we actually send before quality falls off. Our own
   *  skills_and_guides/gpt-image-2-engineering-guide.md §3.1 measures the drop
   *  after 4; external practice agrees anything that must survive belongs in
   *  the first six slots. Never send `max` just because `max` is allowed. */
  practical: number;
}

export interface ModelSpec {
  id: ModelId;
  label: string;
  provider: 'openai' | 'google';
  apiModelId: string;
  /** Which REST shape this model speaks. Imagen is `:predict` (text-only, it
   *  silently ignores images); the Gemini image models are `:generateContent`
   *  with inlineData parts, which is the only Google path that takes refs. */
  api: 'edits' | 'predict' | 'generateContent';
  /** Largest native MP achievable on this model (no upscaling). */
  nativeMaxMP: number;
  /** null = this model cannot take a reference image at all. */
  refs: RefBudget | null;
}

export const MODELS: Record<ModelId, ModelSpec> = {
  GPT_IMAGE_2: {
    id: 'GPT_IMAGE_2',
    label: 'ChatGPT Image 2.0',
    provider: 'openai',
    apiModelId: 'gpt-image-2',
    api: 'edits',
    nativeMaxMP: 8.3, // 3840×2160 — verified per OpenAI docs 2026-05
    // 16 is the published schema ceiling. One captured third-party catalog
    // lists 8 for this model, so treat anything above 8 as untested.
    refs: { max: 16, practical: 4 },
  },
  NANO_BANANA_PRO: {
    id: 'NANO_BANANA_PRO',
    label: 'Nano Banana Pro',
    provider: 'google',
    // WAS 'imagen-3.0-generate-002' — an Imagen 3 `:predict` endpoint that is
    // text-to-image ONLY and silently discarded every reference image while the
    // UI called it "Nano Banana Pro". Every reference craft rule in this app
    // held on the gpt-image-2 path alone until this was repointed.
    apiModelId: 'gemini-3-pro-image',
    api: 'generateContent',
    nativeMaxMP: 8.3,
    // Per-kind budgets are the real limit: 5 character refs, 6 high-fidelity
    // object refs. Objects is why this is the default for the Prop factory.
    refs: { max: 14, characters: 5, objects: 6, practical: 6 },
  },
};

/** True when this model will honour attached reference images. */
export function acceptsRefs(model: ModelId): boolean {
  return MODELS[model].refs !== null;
}

export const RES_TO_MP: Record<Resolution, number> = {
  '1MP': 1.0,
  '3.7MP': 3.7,
  '8.3MP': 8.3,
};

export function mapQuality(model: ModelId, q: Quality): string {
  if (MODELS[model].provider === 'openai') {
    return q === 'LOW' ? 'low' : q === 'MED' ? 'medium' : 'high';
  }
  return q === 'LOW' ? 'draft' : q === 'MED' ? 'standard' : 'ultra';
}

const GPT_IMAGE_2_MAX_LONG_EDGE = 3840;
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400;
const GPT_IMAGE_2_MIN_PIXELS = 655_360;
const GPT_IMAGE_2_EDGE_STEP = 16;          // both edges must be multiples of 16
const GPT_IMAGE_2_MAX_ASPECT = 3;          // aspect ratio cap (1:3 to 3:1)

/** Keep a quantized size inside the provider's aspect-ratio envelope.
 *
 * Width and height have to be snapped to 16px independently. At the exact
 * 3:1 boundary that snap can widen the result again (for example the old
 * 3328x1104 request is 3.0145:1), so aspect clamping before rounding is not
 * sufficient. Reduce only the offending long edge after every other size
 * adjustment; the requested composition remains as wide/tall as the API can
 * legally make it. */
function constrainQuantizedAspect(width: number, height: number): [number, number] {
  let safeWidth = width;
  let safeHeight = height;
  if (safeWidth > safeHeight * GPT_IMAGE_2_MAX_ASPECT) {
    safeWidth = Math.max(
      GPT_IMAGE_2_EDGE_STEP,
      Math.floor((safeHeight * GPT_IMAGE_2_MAX_ASPECT) / GPT_IMAGE_2_EDGE_STEP) * GPT_IMAGE_2_EDGE_STEP,
    );
  } else if (safeHeight > safeWidth * GPT_IMAGE_2_MAX_ASPECT) {
    safeHeight = Math.max(
      GPT_IMAGE_2_EDGE_STEP,
      Math.floor((safeWidth * GPT_IMAGE_2_MAX_ASPECT) / GPT_IMAGE_2_EDGE_STEP) * GPT_IMAGE_2_EDGE_STEP,
    );
  }
  return [safeWidth, safeHeight];
}

/**
 * Compute the FINAL output dimensions (driven by aspect + MP for ALL models),
 * AND the size to actually request from the API.
 *
 * Both edges of the API request are rounded to the nearest multiple of 16
 * (gpt-image-2's constraint). For gpt-image-2 the API can generate at the
 * target size directly — no post-crop upscaling needed when within limits.
 */
export function resolveSize(
  model: ModelId,
  aspect: string,
  resolution: Resolution,
): {
  apiSize: string;
  targetWidth: number;
  targetHeight: number;
  finalMP: number;
  clampedAspect?: boolean;
  notes?: string;
} {
  const [aw, ah] = aspect.split(':').map(Number);
  let targetAspect = aw / ah;
  let clampedAspect = false;
  if (targetAspect > GPT_IMAGE_2_MAX_ASPECT) {
    targetAspect = GPT_IMAGE_2_MAX_ASPECT;
    clampedAspect = true;
  } else if (targetAspect < 1 / GPT_IMAGE_2_MAX_ASPECT) {
    targetAspect = 1 / GPT_IMAGE_2_MAX_ASPECT;
    clampedAspect = true;
  }

  const targetMP = RES_TO_MP[resolution];
  const totalPx = Math.min(targetMP * 1_000_000, GPT_IMAGE_2_MAX_PIXELS);

  // Ideal w/h from MP + aspect
  let height = Math.sqrt(totalPx / targetAspect);
  let width = height * targetAspect;

  // Cap long edge at 3840
  if (width > GPT_IMAGE_2_MAX_LONG_EDGE) {
    width = GPT_IMAGE_2_MAX_LONG_EDGE;
    height = width / targetAspect;
  }
  if (height > GPT_IMAGE_2_MAX_LONG_EDGE) {
    height = GPT_IMAGE_2_MAX_LONG_EDGE;
    width = height * targetAspect;
  }

  // Round to multiples of 16
  const w16 = Math.max(GPT_IMAGE_2_EDGE_STEP, Math.round(width / GPT_IMAGE_2_EDGE_STEP) * GPT_IMAGE_2_EDGE_STEP);
  const h16 = Math.max(GPT_IMAGE_2_EDGE_STEP, Math.round(height / GPT_IMAGE_2_EDGE_STEP) * GPT_IMAGE_2_EDGE_STEP);

  // Ensure total pixels stay within the per-model ceiling after rounding
  let finalW = w16;
  let finalH = h16;
  if (finalW * finalH > GPT_IMAGE_2_MAX_PIXELS) {
    const scale = Math.sqrt(GPT_IMAGE_2_MAX_PIXELS / (finalW * finalH));
    finalW = Math.max(GPT_IMAGE_2_EDGE_STEP, Math.floor((finalW * scale) / GPT_IMAGE_2_EDGE_STEP) * GPT_IMAGE_2_EDGE_STEP);
    finalH = Math.max(GPT_IMAGE_2_EDGE_STEP, Math.floor((finalH * scale) / GPT_IMAGE_2_EDGE_STEP) * GPT_IMAGE_2_EDGE_STEP);
  }
  if (finalW * finalH < GPT_IMAGE_2_MIN_PIXELS) {
    const scale = Math.sqrt(GPT_IMAGE_2_MIN_PIXELS / (finalW * finalH));
    finalW = Math.max(GPT_IMAGE_2_EDGE_STEP, Math.ceil((finalW * scale) / GPT_IMAGE_2_EDGE_STEP) * GPT_IMAGE_2_EDGE_STEP);
    finalH = Math.max(GPT_IMAGE_2_EDGE_STEP, Math.ceil((finalH * scale) / GPT_IMAGE_2_EDGE_STEP) * GPT_IMAGE_2_EDGE_STEP);
  }

  // Independent 16px rounding can cross the 3:1 / 1:3 API boundary even
  // when targetAspect was already clamped. Enforce the contract last.
  [finalW, finalH] = constrainQuantizedAspect(finalW, finalH);

  const finalMP = (finalW * finalH) / 1_000_000;
  const apiSize = `${finalW}x${finalH}`;

  const notes = clampedAspect
    ? `Aspect ${aspect} clamped to ${targetAspect.toFixed(2)}:1 (model limit is 1:3–3:1).`
    : undefined;

  return {
    apiSize,
    targetWidth: finalW,
    targetHeight: finalH,
    finalMP,
    clampedAspect,
    notes,
  };
}
