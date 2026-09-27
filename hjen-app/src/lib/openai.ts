// gpt-image-2 client — two modes:
//  · Direct: key from the main process via `window.hjen.getApiKey()` (local/offline).
//  · Cloud gateway: no key in the browser at all — routes through HJEN's own
//    server (demo.hjen.ai), which holds the key server-side and meters quota.
// The gateway is opt-in via localStorage so the existing direct mode is untouched.

import OpenAI from 'openai';

let cachedClient: OpenAI | null = null;

/** Cloud-gateway config, read straight from the Electron bridge (single source
 *  of truth) — not localStorage, which can be stale/uninjected on first load. */
async function gatewayConfig(): Promise<{ baseURL: string; token: string } | null> {
  try {
    const g = await window.hjen.getGateway?.();
    if (g?.url && g?.token) return { baseURL: g.url.replace(/\/$/, '') + '/v1/openai', token: g.token };
  } catch { /* bridge unavailable */ }
  return null;
}

// No client caching: the gateway/direct choice must be re-read each call so a
// mid-session Connect/Disconnect (or first-load timing) is always honored.
async function getClient(): Promise<OpenAI> {
  const gw = await gatewayConfig();
  if (gw) {
    // Cloud mode: the "apiKey" is the invitee's magic token; the server swaps in
    // the real provider key. dangerouslyAllowBrowser is safe here — no real key ships.
    return new OpenAI({ apiKey: gw.token, baseURL: gw.baseURL, dangerouslyAllowBrowser: true });
  }
  const key = await window.hjen.getApiKey();
  if (!key) throw new Error('No OpenAI API key configured. Set OPENAI_API_KEY env var or use Settings.');
  return new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });
}

/** Raw gateway base + token (no /v1/openai suffix — the async doors live at
 *  /v1/image/*). Null in direct-key mode. */
async function rawGateway(): Promise<{ base: string; token: string } | null> {
  try {
    const g = await window.hjen.getGateway?.();
    if (g?.url && g?.token) return { base: g.url.replace(/\/$/, ''), token: g.token };
  } catch { /* bridge unavailable */ }
  return null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Read a local image path to base64 (no data: prefix) for the async submit body. */
async function fileToB64(absPath: string): Promise<string> {
  const url = `hjen-file://${encodeURI(absPath)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to read ${absPath} (HTTP ${resp.status})`);
  const blob = await resp.blob();
  const dataUrl: string = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
  return dataUrl.split(',')[1] || '';
}

/** Safety rejections + generic wraps — shared by the gateway (async) branches so
 *  they surface the same friendly guidance as the direct SDK path. */
function translateImageError(err: any, ctx: string): Error {
  const hay = [err?.message, String(err)].filter(Boolean).join(' ').toLowerCase();
  if (hay.includes('safety') || hay.includes('moderation') || hay.includes('content_policy') || hay.includes('content policy') || hay.includes('rejected')) {
    return new Error(
      `Rejected by OpenAI's safety filter (often a false positive on child/family characters). Try:\n` +
      `  • Refine again (the prompt now states non-photographic, modest, respectful intent)\n` +
      `  • Soften the character note (avoid words that could read as suggestive)\n` +
      `  • Or switch the model to Nano Banana Pro for this one`
    );
  }
  return new Error(`OpenAI image make failed (${ctx}): ${err?.message || err}`);
}

/**
 * Gateway image make via the async submit → poll doors. The synchronous
 * /v1/openai path dies with Cloudflare 524 on slow HIGH-quality renders; here the
 * server renders in the background and we poll, so no single request nears the
 * ~100s edge ceiling. Returns raw base64. Used only in cloud-gateway mode.
 */
async function gatewayImageAsync(
  gw: { base: string; token: string },
  payload: { modelId?: string; prompt: string; size: string; quality?: string; images?: string[] },
): Promise<string> {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${gw.token}` };
  const sub = await fetch(`${gw.base}/v1/image/submit`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const subJson: any = await sub.json().catch(() => ({}));
  if (!sub.ok || !subJson?.jobId) throw new Error(subJson?.message || `Submit failed (HTTP ${sub.status}).`);
  const jobId = String(subJson.jobId);

  const started = Date.now();
  const TIMEOUT_MS = 8 * 60 * 1000; // generous ceiling; a HIGH render is minutes, not hours
  for (;;) {
    await sleep(3000);
    if (Date.now() - started > TIMEOUT_MS) throw new Error('Render timed out after 8 minutes.');
    let pr: Response;
    try {
      pr = await fetch(`${gw.base}/v1/image/poll`, { method: 'POST', headers, body: JSON.stringify({ jobId }) });
    } catch { continue; } // transient network blip — keep polling
    const j: any = await pr.json().catch(() => ({}));
    if (j?.status === 'done' && j?.b64) return String(j.b64);
    if (j?.status === 'error') throw new Error(j?.message || 'Render failed.');
    // 'pending' → keep polling
  }
}

export interface GenerateParams {
  /** Any "WxH" string where both edges are multiples of 16 and aspect is 1:3–3:1. */
  prompt: string;
  size: string;
  quality?: 'low' | 'medium' | 'high';
  modelId?: string;
}

/**
 * Convert a local absolute file path into a File object the OpenAI SDK can upload.
 * Uses the custom `hjen-file://` protocol registered in electron/main.ts so we
 * stream straight from disk instead of base64-IPC.
 */
export async function pathToFile(absPath: string): Promise<File> {
  const url = `hjen-file://${encodeURI(absPath)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to read ${absPath} (HTTP ${response.status})`);
  const blob = await response.blob();
  const filename = absPath.split('/').pop() || 'image.png';
  const mime = blob.type || guessMime(filename);
  return new File([blob], filename, { type: mime });
}

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}

export interface GenerateWithRefsParams extends GenerateParams {
  /** Up to 14 reference file paths. Sent to images.edit; the model uses them as visual context. */
  referenceFilePaths: string[];
}

export interface GenerateResult {
  url: string;            // data URL (in-memory preview)
  b64: string;            // raw base64 (for saving)
  prompt: string;
  size: string;
  ts: number;
  modelLabel?: string;
  savedPath?: string;     // where it was written to disk
  sidecarPath?: string;
  dir?: string;
  serverSaved?: boolean;  // gateway already persisted it (token in savedPath) — don't re-upload
}

export async function generateImage(params: GenerateParams): Promise<GenerateResult> {
  // Cloud-gateway mode → async submit/poll (dodges Cloudflare 524 on HIGH).
  const gw = await rawGateway();
  if (gw) {
    try {
      const b64 = await gatewayImageAsync(gw, {
        modelId: params.modelId ?? 'gpt-image-2',
        prompt: params.prompt,
        size: params.size,
        quality: params.quality ?? 'high',
      });
      return { url: `data:image/png;base64,${b64}`, b64, prompt: params.prompt, size: params.size, ts: Date.now() };
    } catch (err: any) {
      throw translateImageError(err, `generate ${params.size}, ${params.quality}`);
    }
  }
  // Direct-key mode → OpenAI SDK (no gateway, no Cloudflare, no 524 ceiling).
  const client = await getClient();
  let response;
  try {
    response = await client.images.generate({
      model: params.modelId ?? 'gpt-image-2',
      prompt: params.prompt,
      // gpt-image-2 accepts arbitrary WxH (multiples of 16, aspect 1:3–3:1).
      // The SDK type may still narrow to gpt-image-1's enum; cast loosely.
      size: params.size as any,
      quality: params.quality ?? 'high',
      n: 1,
    });
  } catch (err: any) {
    // Surface safety rejections in plain language (same as images.edit path).
    const hay = [err?.message, err?.error?.message, err?.code, err?.error?.code, String(err)].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes('safety') || hay.includes('moderation') || hay.includes('content_policy') || hay.includes('content policy') || hay.includes('rejected')) {
      throw new Error(
        `Rejected by OpenAI's safety filter (often a false positive on child/family characters). Try:\n` +
        `  • Refine again (the prompt now states non-photographic, modest, respectful intent)\n` +
        `  • Soften the character note (avoid words that could read as suggestive)\n` +
        `  • Or switch the model to Nano Banana Pro for this one`
      );
    }
    // Wrap so the top-of-window error bar shows WHICH api died.
    throw new Error(`OpenAI images.generate failed (${params.size}, ${params.quality}): ${err?.message || err}`);
  }
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI images.generate returned an empty payload (no b64_json in response).');
  return {
    url: `data:image/png;base64,${b64}`,
    b64,
    prompt: params.prompt,
    size: params.size,
    ts: Date.now(),
  };
}

/**
 * Generate using reference images. Routes through OpenAI's images.edit
 * endpoint with an array of input images — gpt-image-2 supports up to ~16
 * references and uses them as visual context for the prompt.
 */
export async function generateWithReferences(params: GenerateWithRefsParams): Promise<GenerateResult> {
  // Cloud-gateway mode → async submit/poll. Reference images ride along as base64
  // in the submit body (the render itself happens server-side in the background).
  const gw = await rawGateway();
  if (gw) {
    const images: string[] = [];
    for (const p of params.referenceFilePaths) {
      try { images.push(await fileToB64(p)); }
      catch (err: any) { throw new Error(`Reference image could not be read: ${p}\n${err?.message || err}`); }
    }
    try {
      const b64 = await gatewayImageAsync(gw, {
        modelId: params.modelId ?? 'gpt-image-2',
        prompt: params.prompt,
        size: params.size,
        quality: params.quality ?? 'high',
        images,
      });
      return { url: `data:image/png;base64,${b64}`, b64, prompt: params.prompt, size: params.size, ts: Date.now() };
    } catch (err: any) {
      throw translateImageError(err, `edit ${images.length} refs, ${params.size}, ${params.quality}`);
    }
  }
  // Direct-key mode → OpenAI SDK (multipart images.edit, no gateway/CF ceiling).
  const client = await getClient();

  // Load each reference image. If one path is missing or unreadable, fail
  // loudly with which path so the user knows which library asset to fix.
  const files: File[] = [];
  for (const p of params.referenceFilePaths) {
    try {
      files.push(await pathToFile(p));
    } catch (err: any) {
      throw new Error(`Reference image could not be read: ${p}\n${err?.message || err}`);
    }
  }

  let response;
  try {
    response = await client.images.edit({
      model: params.modelId ?? 'gpt-image-2',
      image: files as any,
      prompt: params.prompt,
      size: params.size as any,
      quality: (params.quality ?? 'high') as any,
      n: 1,
    } as any);
  } catch (err: any) {
    // OpenAI's SDK puts the error string in different places depending on
    // status / SDK version — sweep them all so the safety-system detector
    // can't miss the signal.
    const candidates: string[] = [
      err?.message,
      err?.error?.message,
      typeof err?.error === 'string' ? err.error : '',
      err?.body?.error?.message,
      err?.response?.error?.message,
      err?.code,
      err?.error?.code,
      String(err),
    ].filter(Boolean);
    const haystack = candidates.join(' ').toLowerCase();
    const isSafety =
      haystack.includes('safety system') ||
      haystack.includes('moderation') ||
      haystack.includes('content_policy') ||
      haystack.includes('content policy') ||
      haystack.includes('rejected by') ||
      err?.status === 400 && haystack.includes('rejected');

    if (isSafety) {
      throw new Error(
        `OpenAI safety system rejected this request. Try:\n` +
        `  • Rename refs to remove suggestive words ("uncovered", "nude", "private")\n` +
        `  • Simplify the prompt — drop heavy descriptors\n` +
        `  • Run Enhance first so Claude reframes the scene\n` +
        `  • Or make a frame without face refs (text-only) as a baseline`
      );
    }
    const raw = err?.message || String(err);
    throw new Error(`OpenAI images.edit failed (${files.length} refs, ${params.size}, ${params.quality}): ${raw}`);
  }

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI images.edit returned an empty payload (no b64_json in response).');
  return {
    url: `data:image/png;base64,${b64}`,
    b64,
    prompt: params.prompt,
    size: params.size,
    ts: Date.now(),
  };
}

export function resetClient() {
  cachedClient = null; // no-op now (client is built per-call); kept for call-site compatibility
}
