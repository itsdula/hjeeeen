// HJEN Enhancer — Replicate-based two-pass face restoration + skin texture.
//
// Pass 1: sczhou/codeformer — face-specific restoration. The fidelity slider
// is the actual quality lever: 0.0 = max restoration / texture, 1.0 = max
// identity preservation. We default to 0.7 (recommended by the model author
// for AI-generated portraits) — restores eyes/skin without changing identity.
//
// Pass 2 (optional): philz1337x/clarity-upscaler — Magnific-style detailed
// upscale that adds real skin pore texture, fabric weave, environment detail.
// `creativity` controls how much new detail to hallucinate (0.2–0.4 keeps
// it conservative). `resemblance` controls how close to the input (higher =
// closer). Default to skip — the user can enable per run.
//
// Both models are open-source, hosted on Replicate. Output URLs are
// short-lived signed S3 links; we fetch + base64 them inside the same flow
// so they reach disk before expiry.

export interface EnhanceParams {
  sourcePath: string;
  /** CodeFormer fidelity. 0 = max texture, 1 = max identity. Default 0.7. */
  fidelity?: number;
  /** Run Clarity Upscaler as a second pass for fuller skin/fabric detail. */
  clarityPass?: boolean;
  /** Clarity Upscaler creativity (0..1). Higher = more detail invention. */
  clarityCreativity?: number;
  /** Clarity Upscaler resemblance (0..3). Higher = closer to input. */
  clarityResemblance?: number;
}

import { resolveCost } from './cost';

export interface EnhanceResult {
  /** in-memory data URL for immediate preview */
  url: string;
  b64: string;
  size: string;
  ts: number;
  /** stages we actually ran, in order */
  stages: Array<{ name: string; predictionId: string; ms: number; costUsd?: number }>;
  /** Total vendor cost (USD) across all Replicate stages, before margin. */
  costUsd: number;
}

/** Replicate bills per compute-second; metrics.predict_time is ground truth. */
function replicateCost(key: string, metrics: any): number {
  const secs = typeof metrics?.predict_time === 'number' ? metrics.predict_time : null;
  if (!secs) return 0;
  const r = resolveCost({ key, usage: { computeSeconds: secs } });
  return r?.actualCostUsd ?? 0;
}

async function pathToDataUrl(absPath: string): Promise<string> {
  const url = `hjen-file://${encodeURI(absPath)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not read source file: ${absPath} (HTTP ${res.status})`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error(`Could not encode source: ${absPath}`));
    fr.readAsDataURL(blob);
  });
}

async function readDimensions(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not read enhanced image dimensions'));
    img.src = dataUrl;
  });
}

function pickFirstOutputUrl(output: any): string | null {
  if (!output) return null;
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && output.length > 0) return typeof output[0] === 'string' ? output[0] : null;
  return null;
}

export async function enhanceFace(params: EnhanceParams): Promise<EnhanceResult> {
  const fidelity = params.fidelity ?? 0.7;
  const dataUrl = await pathToDataUrl(params.sourcePath);
  const stages: EnhanceResult['stages'] = [];

  // ---------- Pass 1: CodeFormer ----------
  const codeStart = performance.now();
  const codeRes = await window.hjen.replicateRun({
    model: 'sczhou/codeformer',
    input: {
      image: dataUrl,
      codeformer_fidelity: fidelity,
      background_enhance: true,
      face_upsample: true,
      upscale: 2,
    },
    pollIntervalMs: 1500,
    maxWaitMs: 5 * 60 * 1000,
  });
  if (!codeRes.ok) {
    throw new Error(`CodeFormer failed (${codeRes.reason}): ${codeRes.message}`);
  }
  const codeUrl = pickFirstOutputUrl(codeRes.output);
  if (!codeUrl) throw new Error('CodeFormer returned no output URL');
  stages.push({
    name: 'CodeFormer',
    predictionId: codeRes.predictionId,
    ms: Math.round(performance.now() - codeStart),
    costUsd: replicateCost('replicate:sczhou/codeformer', codeRes.metrics),
  });

  // Always pull the bytes back through main — Replicate signed URLs expire fast.
  const codeFetch = await window.hjen.fetchUrlBase64(codeUrl);
  if (!codeFetch.ok) throw new Error(`Could not download CodeFormer result: ${codeFetch.message}`);
  let currentDataUrl = `data:image/png;base64,${codeFetch.base64}`;
  let currentB64 = codeFetch.base64;

  // ---------- Pass 2 (optional): Clarity Upscaler ----------
  if (params.clarityPass) {
    const clarityStart = performance.now();
    const clarityRes = await window.hjen.replicateRun({
      model: 'philz1337x/clarity-upscaler',
      input: {
        image: currentDataUrl,
        prompt:
          'masterpiece, best quality, highres, realistic skin texture, visible pores, ' +
          'natural micro-imperfections, fine facial hair, real photograph, ' +
          'cinematic realism, sharp detailed eyes, natural color, no plastic skin',
        creativity: params.clarityCreativity ?? 0.3,
        resemblance: params.clarityResemblance ?? 1.5,
        scale_factor: 1,
        dynamic: 6,
        handfix: 'disabled',
        sharpen: 0,
        output_format: 'png',
        num_inference_steps: 18,
      },
      pollIntervalMs: 2500,
      maxWaitMs: 8 * 60 * 1000,
    });
    if (!clarityRes.ok) {
      throw new Error(`Clarity Upscaler failed (${clarityRes.reason}): ${clarityRes.message}`);
    }
    const clarityUrl = pickFirstOutputUrl(clarityRes.output);
    if (!clarityUrl) throw new Error('Clarity Upscaler returned no output URL');
    stages.push({
      name: 'Clarity Upscaler',
      predictionId: clarityRes.predictionId,
      ms: Math.round(performance.now() - clarityStart),
      costUsd: replicateCost('replicate:philz1337x/clarity-upscaler', clarityRes.metrics),
    });
    const clarityFetch = await window.hjen.fetchUrlBase64(clarityUrl);
    if (!clarityFetch.ok) throw new Error(`Could not download Clarity result: ${clarityFetch.message}`);
    currentDataUrl = `data:image/png;base64,${clarityFetch.base64}`;
    currentB64 = clarityFetch.base64;
  }

  const { w, h } = await readDimensions(currentDataUrl);
  return {
    url: currentDataUrl,
    b64: currentB64,
    size: `${w}x${h}`,
    ts: Date.now(),
    stages,
    costUsd: stages.reduce((sum, s) => sum + (s.costUsd ?? 0), 0),
  };
}
