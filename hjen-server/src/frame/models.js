// Model registry + size/quality resolution — SERVER-SIDE port of
// app/src/lib/models.ts. Keep in lock-step with the client (offline path).

export const MODELS = {
  GPT_IMAGE_2: {
    id: 'GPT_IMAGE_2',
    label: 'ChatGPT Image 2.0',
    provider: 'openai',
    apiModelId: 'gpt-image-2',
    api: 'edits',
    nativeMaxMP: 8.3,
    // One flat high-fidelity array, no roles. 16 is the published ceiling;
    // `practical` is what we actually send — attention falls off after ~4.
    refs: { max: 16, practical: 4 },
  },
  NANO_BANANA_PRO: {
    id: 'NANO_BANANA_PRO',
    label: 'Nano Banana Pro',
    provider: 'google',
    // WAS 'imagen-3.0-generate-002' — an Imagen `:predict` endpoint that is
    // text-to-image only and silently discarded every reference image.
    apiModelId: 'gemini-3-pro-image',
    api: 'generateContent',
    nativeMaxMP: 8.3,
    // Typed budgets, NOT one flat array: 5 character refs, 6 high-fidelity
    // object refs. The "14" everyone quotes is total input allowance.
    refs: { max: 14, characters: 5, objects: 6, practical: 6 },
  },
};

export const RES_TO_MP = { '1MP': 1.0, '3.7MP': 3.7, '8.3MP': 8.3 };

export function mapQuality(model, q) {
  if (MODELS[model].provider === 'openai') {
    return q === 'LOW' ? 'low' : q === 'MED' ? 'medium' : 'high';
  }
  return q === 'LOW' ? 'draft' : q === 'MED' ? 'standard' : 'ultra';
}

const MAX_LONG_EDGE = 3840;
const MAX_PIXELS = 8_294_400;
const MIN_PIXELS = 655_360;
const EDGE_STEP = 16;
const MAX_ASPECT = 3;

// Independent 16px rounding can push an exact 3:1 target back outside the
// provider envelope (3328x1104 is 3.0145:1). Reduce only the offending long
// edge after quantization so every request remains legal.
function constrainQuantizedAspect(width, height) {
  let safeWidth = width;
  let safeHeight = height;
  if (safeWidth > safeHeight * MAX_ASPECT) {
    safeWidth = Math.max(EDGE_STEP, Math.floor((safeHeight * MAX_ASPECT) / EDGE_STEP) * EDGE_STEP);
  } else if (safeHeight > safeWidth * MAX_ASPECT) {
    safeHeight = Math.max(EDGE_STEP, Math.floor((safeWidth * MAX_ASPECT) / EDGE_STEP) * EDGE_STEP);
  }
  return [safeWidth, safeHeight];
}

export function resolveSize(model, aspect, resolution) {
  const [aw, ah] = aspect.split(':').map(Number);
  let targetAspect = aw / ah;
  let clampedAspect = false;
  if (targetAspect > MAX_ASPECT) {
    targetAspect = MAX_ASPECT;
    clampedAspect = true;
  } else if (targetAspect < 1 / MAX_ASPECT) {
    targetAspect = 1 / MAX_ASPECT;
    clampedAspect = true;
  }

  const targetMP = RES_TO_MP[resolution];
  const totalPx = Math.min(targetMP * 1_000_000, MAX_PIXELS);

  let height = Math.sqrt(totalPx / targetAspect);
  let width = height * targetAspect;

  if (width > MAX_LONG_EDGE) { width = MAX_LONG_EDGE; height = width / targetAspect; }
  if (height > MAX_LONG_EDGE) { height = MAX_LONG_EDGE; width = height * targetAspect; }

  const w16 = Math.max(EDGE_STEP, Math.round(width / EDGE_STEP) * EDGE_STEP);
  const h16 = Math.max(EDGE_STEP, Math.round(height / EDGE_STEP) * EDGE_STEP);

  let finalW = w16;
  let finalH = h16;
  if (finalW * finalH > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / (finalW * finalH));
    finalW = Math.max(EDGE_STEP, Math.floor((finalW * scale) / EDGE_STEP) * EDGE_STEP);
    finalH = Math.max(EDGE_STEP, Math.floor((finalH * scale) / EDGE_STEP) * EDGE_STEP);
  }
  if (finalW * finalH < MIN_PIXELS) {
    const scale = Math.sqrt(MIN_PIXELS / (finalW * finalH));
    finalW = Math.max(EDGE_STEP, Math.ceil((finalW * scale) / EDGE_STEP) * EDGE_STEP);
    finalH = Math.max(EDGE_STEP, Math.ceil((finalH * scale) / EDGE_STEP) * EDGE_STEP);
  }

  [finalW, finalH] = constrainQuantizedAspect(finalW, finalH);

  const finalMP = (finalW * finalH) / 1_000_000;
  const apiSize = `${finalW}x${finalH}`;
  const notes = clampedAspect
    ? `Aspect ${aspect} clamped to ${targetAspect.toFixed(2)}:1 (model limit is 1:3–3:1).`
    : undefined;

  return { apiSize, targetWidth: finalW, targetHeight: finalH, finalMP, clampedAspect, notes };
}
