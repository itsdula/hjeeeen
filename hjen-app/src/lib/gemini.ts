// Google image client — runs in the renderer over REST.
//
// TWO SHAPES, and the difference is load-bearing:
//
//   :predict         Imagen. instances[{prompt}] + parameters{}. TEXT ONLY —
//                    there is no image field, so any reference you "attach" is
//                    silently discarded. This is what the model registry used
//                    to point at while calling itself Nano Banana Pro.
//   :generateContent Gemini image models. contents[{parts:[…]}] where a part is
//                    either {inlineData:{mimeType,data}} or {text}. THIS is the
//                    only Google path that accepts references.
//
// generateWithGeminiImage() below implements the second. Two rules that are
// easy to get wrong and expensive to debug:
//   1. IMAGES GO BEFORE THE TEXT PART. The text instruction references the
//      images by position ("Image 1 is the identity…"), so the model has to
//      have read them first.
//   2. image_size takes an UPPERCASE K ('1K' / '2K' / '4K'). Lowercase is
//      rejected outright.

import type { GenerateResult } from './openai';
import { readLayerB64 } from './frameGen';

export interface GenerateGeminiParams {
  prompt: string;
  width: number;
  height: number;
  quality: string;       // mapped 'draft' | 'standard' | 'ultra'
  apiModelId: string;    // e.g. 'imagen-3.0-generate-002'
}

/** Cloud-gateway config from the Electron bridge (single source of truth). */
async function gatewayConfig(): Promise<{ baseURL: string; token: string } | null> {
  try {
    const g = await window.hjen.getGateway?.();
    if (g?.url && g?.token) return { baseURL: g.url.replace(/\/$/, ''), token: g.token };
  } catch { /* bridge unavailable */ }
  return null;
}

export async function generateWithGemini(params: GenerateGeminiParams): Promise<GenerateResult> {
  // Cloud gateway: route Imagen through HJEN's server when configured (holds the
  // Google key + meters quota). Falls back to the direct local key otherwise.
  const gw = await gatewayConfig();
  const key = gw ? null : await window.hjen.getGoogleKey();
  if (!gw && !key) throw new Error('No Google API key configured. Open Settings to add one.');

  // Imagen 3 REST endpoint — predict pattern via Google AI Studio
  const directUrl = `https://generativelanguage.googleapis.com/v1beta/models/${params.apiModelId}:predict?key=${key ?? ''}`;

  const aspectRatio = aspectRatioLabel(params.width / params.height);

  const body = {
    instances: [{ prompt: params.prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio,
      personGeneration: 'allow_adult',
      // Imagen supports `outputOptions: { mimeType: 'image/png' }` in some versions
    },
  };

  let resp;
  try {
    resp = gw
      ? await fetch(`${gw.baseURL}/v1/llm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', authorization: `Bearer ${gw.token}` },
          body: JSON.stringify({ provider: 'google', upstreamUrl: directUrl, headers: { 'content-type': 'application/json' }, body }),
        })
      : await fetch(directUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
  } catch (err: any) {
    throw new Error(`Nano Banana Pro network error: ${err?.message || err}`);
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Nano Banana Pro error ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data: any = await resp.json();
  const b64: string | undefined = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('No image returned from Nano Banana Pro');

  return {
    url: `data:image/png;base64,${b64}`,
    b64,
    prompt: params.prompt,
    size: `${params.width}x${params.height}`,
    ts: Date.now(),
  };
}

// ─── :generateContent — the reference-capable Google door ────────────────────

export interface GeminiImageParams {
  prompt: string;
  width: number;
  height: number;
  apiModelId: string;              // 'gemini-3-pro-image'
  /** Absolute paths. Sent as inlineData parts, in order, BEFORE the text. */
  referenceFilePaths?: string[];
  /** '1K' | '2K' | '4K' — uppercase K is required by the API. */
  imageSize?: '1K' | '2K' | '4K';
}

/** Gemini's closed aspect enum — wider than Imagen's, so it gets its own list. */
const GEMINI_ASPECTS: Array<[string, number]> = [
  ['1:1', 1], ['3:2', 3 / 2], ['2:3', 2 / 3], ['3:4', 3 / 4], ['4:3', 4 / 3],
  ['4:5', 4 / 5], ['5:4', 5 / 4], ['9:16', 9 / 16], ['16:9', 16 / 9], ['21:9', 21 / 9],
];

function snapAspect(r: number, list: Array<[string, number]>): string {
  let best = list[0], bestDiff = Math.abs(r - best[1]);
  for (const c of list) {
    const d = Math.abs(r - c[1]);
    if (d < bestDiff) { best = c; bestDiff = d; }
  }
  return best[0];
}

/** Pick the size tier from the requested pixel count. The API takes a tier,
 *  not a W×H, so the caller's exact dimensions become a crop afterwards. */
function sizeTier(width: number, height: number): '1K' | '2K' | '4K' {
  const mp = (width * height) / 1_000_000;
  return mp > 5 ? '4K' : mp > 1.6 ? '2K' : '1K';
}

/** MAKE an image on a Gemini image model, with optional reference images.
 *
 *  Returns the same GenerateResult shape as the OpenAI path so callers
 *  (frameGen, the asset factory) can stay provider-agnostic. */
export async function generateWithGeminiImage(params: GeminiImageParams): Promise<GenerateResult> {
  const gw = await gatewayConfig();
  const key = gw ? null : await window.hjen.getGoogleKey();
  if (!gw && !key) throw new Error('No Google API key configured. Open Settings to add one.');

  const directUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/${params.apiModelId}:generateContent?key=${key ?? ''}`;

  // Images FIRST, then the instruction that refers to them by position.
  const parts: Array<Record<string, unknown>> = [];
  for (const p of (params.referenceFilePaths ?? [])) {
    const bytes = await readLayerB64(p);
    if (bytes) parts.push({ inlineData: { mimeType: bytes.mime || 'image/png', data: bytes.b64 } });
  }
  parts.push({ text: params.prompt });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: snapAspect(params.width / params.height, GEMINI_ASPECTS),
        imageSize: params.imageSize ?? sizeTier(params.width, params.height),
      },
    },
  };

  let resp: Response;
  try {
    resp = gw
      ? await fetch(`${gw.baseURL}/v1/llm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', authorization: `Bearer ${gw.token}` },
          body: JSON.stringify({ provider: 'google', upstreamUrl: directUrl, headers: { 'content-type': 'application/json' }, body }),
        })
      : await fetch(directUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
  } catch (err: any) {
    throw new Error(`Nano Banana Pro network error: ${err?.message || err}`);
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Nano Banana Pro error ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data: any = await resp.json();
  // The image comes back as an inlineData part alongside any text the model
  // chose to emit, so find the first part that actually carries bytes.
  const out: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const b64: string | undefined = out.find(p => p?.inlineData?.data)?.inlineData?.data;
  if (!b64) {
    // A refusal comes back as a finishReason with no image — surface it rather
    // than the generic "no image", or every safety block reads as a bug.
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
    throw new Error(reason ? `Nano Banana Pro returned no image (${reason})` : 'No image returned from Nano Banana Pro');
  }

  return {
    url: `data:image/png;base64,${b64}`,
    b64,
    prompt: params.prompt,
    size: `${params.width}x${params.height}`,
    ts: Date.now(),
  };
}

function aspectRatioLabel(r: number): '1:1' | '16:9' | '9:16' | '4:3' | '3:4' {
  // Imagen accepts a closed enum, so snap to nearest
  const candidates: Array<[string, number]> = [
    ['1:1', 1.0],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
  ];
  let best = candidates[0];
  let bestDiff = Math.abs(r - best[1]);
  for (const c of candidates) {
    const d = Math.abs(r - c[1]);
    if (d < bestDiff) { best = c; bestDiff = d; }
  }
  return best[0] as any;
}
