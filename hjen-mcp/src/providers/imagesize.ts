// gpt-image-2 size resolver — ported verbatim from app/src/lib/models.ts (pure,
// no deps). Keeps MCP-made frames sized exactly like the desktop app's.

export type Quality = 'LOW' | 'MED' | 'HIGH';
export type Resolution = '1MP' | '3.7MP' | '8.3MP';
const RES_TO_MP: Record<Resolution, number> = { '1MP': 1.0, '3.7MP': 3.7, '8.3MP': 8.3 };

const MAX_LONG_EDGE = 3840, MAX_PIXELS = 8_294_400, MIN_PIXELS = 655_360, STEP = 16, MAX_ASPECT = 3;

// Snapping both edges independently can turn a legal 3:1 target into an
// illegal request (3328x1104 is 3.0145:1). Re-clamp the quantized result.
function constrainQuantizedAspect(width: number, height: number): [number, number] {
  let safeWidth = width;
  let safeHeight = height;
  if (safeWidth > safeHeight * MAX_ASPECT) safeWidth = Math.max(STEP, Math.floor((safeHeight * MAX_ASPECT) / STEP) * STEP);
  else if (safeHeight > safeWidth * MAX_ASPECT) safeHeight = Math.max(STEP, Math.floor((safeWidth * MAX_ASPECT) / STEP) * STEP);
  return [safeWidth, safeHeight];
}

export function mapQuality(q: Quality): 'low' | 'medium' | 'high' {
  return q === 'LOW' ? 'low' : q === 'MED' ? 'medium' : 'high';
}

export function resolveSize(aspect: string, resolution: Resolution): { apiSize: string; width: number; height: number; finalMP: number; notes?: string } {
  const [aw, ah] = aspect.split(':').map(Number);
  let targetAspect = (aw || 16) / (ah || 9);
  let clamped = false;
  if (targetAspect > MAX_ASPECT) { targetAspect = MAX_ASPECT; clamped = true; }
  else if (targetAspect < 1 / MAX_ASPECT) { targetAspect = 1 / MAX_ASPECT; clamped = true; }

  const totalPx = Math.min((RES_TO_MP[resolution] ?? 3.7) * 1_000_000, MAX_PIXELS);
  let height = Math.sqrt(totalPx / targetAspect);
  let width = height * targetAspect;
  if (width > MAX_LONG_EDGE) { width = MAX_LONG_EDGE; height = width / targetAspect; }
  if (height > MAX_LONG_EDGE) { height = MAX_LONG_EDGE; width = height * targetAspect; }

  let w = Math.max(STEP, Math.round(width / STEP) * STEP);
  let h = Math.max(STEP, Math.round(height / STEP) * STEP);
  if (w * h > MAX_PIXELS) { const s = Math.sqrt(MAX_PIXELS / (w * h)); w = Math.max(STEP, Math.floor((w * s) / STEP) * STEP); h = Math.max(STEP, Math.floor((h * s) / STEP) * STEP); }
  if (w * h < MIN_PIXELS) { const s = Math.sqrt(MIN_PIXELS / (w * h)); w = Math.max(STEP, Math.ceil((w * s) / STEP) * STEP); h = Math.max(STEP, Math.ceil((h * s) / STEP) * STEP); }
  [w, h] = constrainQuantizedAspect(w, h);

  return { apiSize: `${w}x${h}`, width: w, height: h, finalMP: (w * h) / 1_000_000, notes: clamped ? `Aspect ${aspect} clamped to model limit 1:3–3:1.` : undefined };
}
