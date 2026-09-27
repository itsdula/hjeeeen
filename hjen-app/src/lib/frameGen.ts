// Shared image-generation core for a single Frame.
//
// This is the ONE place the provider branch + reference ordering + crop live,
// so store.generate() (the Studio) and the NODE engine's Frame node call the
// exact same logic instead of drifting. It does NOT save to disk and does NOT
// touch any store state — callers own persistence + bookkeeping.

import type { Selections } from '../types/catalog';
import type { Layer } from '../store';
import { buildPrompt } from './promptBuilder';
import { generateImage, generateWithReferences, type GenerateResult } from './openai';
import { generateWithGemini, generateWithGeminiImage } from './gemini';
import { MODELS, mapQuality, resolveSize } from './models';
import { cropImageToTarget } from './cropImage';

export interface FrameGenResult {
  /** The generated image — already cropped to the target aspect, modelLabel set. */
  result: GenerateResult;
  /** The size the API actually returned, BEFORE crop (e.g. "1536x1024"). */
  apiSize: string;
  apiDurationMs: number;
  /** Resolved target size (final dimensions, MP, notes). */
  size: ReturnType<typeof resolveSize>;
  assembledPrompt: string;
  /** Mapped api quality (e.g. 'high' for openai, 'ultra' for google). */
  quality: string;
}

// ── cloud gateway ────────────────────────────────────────────────────────────
// When a gateway is configured (all web + distributed desktop), the Frame recipe
// is composed and run ON THE SERVER — the client sends only raw selections +
// reference bytes and never touches the composed prompt (LAW: recipe on server).
// Offline/direct mode (owner's own machine, no gateway) keeps composing locally.
export async function gatewayConf(): Promise<{ url: string; token: string } | null> {
  try {
    const g = await window.hjen.getGateway?.();
    if (g?.url && g?.token) return { url: g.url.replace(/\/$/, ''), token: g.token };
  } catch { /* bridge unavailable */ }
  return null;
}

/** True when generation should route through HJEN's server (recipe stays hidden). */
export async function isGatewayActive(): Promise<boolean> {
  return (await gatewayConf()) != null;
}

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]+,/, ''));
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// Read a reference image as base64, host-agnostically. Desktop's readImageDataUrl
// returns a real data: URL; the web adapter returns a fetchable /api/file URL.
export async function readLayerB64(filePath: string): Promise<{ b64: string; mime: string } | null> {
  try {
    const optimized = await window.hjen.readImageUploadDataUrl?.(filePath);
    const d = optimized ?? await window.hjen.readImageDataUrl?.(filePath);
    if (!d) return null;
    if (d.startsWith('data:')) {
      const comma = d.indexOf(',');
      const mime = d.slice(5, d.indexOf(';')) || 'image/png';
      return { b64: d.slice(comma + 1), mime };
    }
    const r = await fetch(d);
    if (!r.ok) return null;
    const blob = await r.blob();
    return { b64: await blobToB64(blob), mime: blob.type || 'image/png' };
  } catch { return null; }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll the async frame job until the server has rendered it. Fully async: the
 *  server renders in the background (no Cloudflare ceiling in play), so there is no
 *  abort or timing guesswork — we just poll until done/error. The timeout is only a
 *  safety backstop, set well above any real render. */
async function pollFrameAsync(gw: { url: string; token: string }, jobId: string, onPhase?: (phase: string, queued?: number) => void): Promise<any> {
  const started = Date.now();
  // The server may legitimately spend up to four minutes waiting out a shared
  // provider rate window before the render itself begins. Stay just inside the
  // server's 20-minute recovery lifetime so that successful paid work is never
  // abandoned by the client during that safe, unbilled wait.
  const TIMEOUT_MS = 19 * 60 * 1000;
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${gw.token}` };
  for (;;) {
    await sleep(3000);
    if (Date.now() - started > TIMEOUT_MS) throw new Error('Frame timed out after 19 minutes — please try again.');
    let r: Response;
    // Bound each poll fetch so a hung connection can't wedge this loop and hog one
    // of the browser's ~6 per-host sockets (which, under many concurrent makes,
    // starves the other poll loops). A timeout just retries next tick.
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 30000);
    try { r = await fetch(`${gw.url}/api/frame/poll`, { method: 'POST', headers, body: JSON.stringify({ jobId }), signal: ac.signal }); }
    catch { continue; } // transient network / timeout — keep polling
    finally { clearTimeout(to); }
    const pj: any = await r.json().catch(() => ({}));
    // Done arrives either as a server-saved token (imgPath — tiny, preferred) or,
    // when there was no project to save into, the base64 image inline.
    if (pj?.status === 'done' && (pj?.imgPath || pj?.b64)) return pj;
    if (pj?.status === 'error') throw new Error(pj?.message || 'Frame failed.');
    // 'pending' → keep polling; report queue vs render phase so the UI can show it.
    if (pj?.status === 'pending') { try { onPhase?.(String(pj.phase || 'rendering'), typeof pj.queued === 'number' ? pj.queued : undefined); } catch { /* best-effort */ } }
  }
}

async function runFrameViaGateway(gw: { url: string; token: string }, selections: Selections, layers: Layer[], jobId?: string, onPhase?: (phase: string, queued?: number) => void): Promise<FrameGenResult> {
  // Send layer METADATA (for the reference-naming grammar) + bytes for any layer
  // backed by a file. The server orders + composes; nothing here reveals the recipe.
  const layerPayload: any[] = [];
  for (const l of layers) {
    const meta: any = { id: l.id, name: l.name, customName: l.customName, category: l.category, parentLayerId: l.parentLayerId, groupName: l.groupName };
    if (l.filePath) {
      const bytes = await readLayerB64(l.filePath);
      if (bytes) { meta.b64 = bytes.b64; meta.mime = bytes.mime; meta.filename = l.filePath.split('/').pop() || 'ref.png'; }
    }
    layerPayload.push(meta);
  }

  const tStart = performance.now();
  // The client job id doubles as the server's idempotency + recovery key. Some
  // callers (refine / remake / camera-angle / world) don't pass one, so mint it.
  const recoverJob = jobId || `frame-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${gw.token}`, 'x-hjen-job': recoverJob };

  // FULLY ASYNC: submit returns a jobId in milliseconds; the server renders in the
  // BACKGROUND (no Cloudflare ~100s ceiling in play) and we poll until done. No
  // abort, no timing guesswork — a HIGH render can take as long as it needs.
  const submitBody = JSON.stringify({ selections, layers: layerPayload });
  let sub: Response | undefined;
  let submitError: unknown;
  // A dropped submit response is safe to retry with the same recovery key: the
  // server's idempotency check returns the existing job and never charges twice.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      sub = await fetch(`${gw.url}/api/frame/submit`, { method: 'POST', headers, body: submitBody });
      break;
    } catch (cause) {
      submitError = cause;
      if (attempt === 0) await sleep(750);
    }
  }
  if (!sub) {
    const detail = submitError instanceof Error ? submitError.message : String(submitError || 'network error');
    throw new Error(`The take could not reach the render server (${detail}). No generation was started.`);
  }
  const sj: any = await sub.json().catch(() => ({}));
  if (!sub.ok || !sj?.jobId) throw new Error(sj?.message || `Frame failed (HTTP ${sub.status})`);
  const j = await pollFrameAsync(gw, String(sj.jobId), onPhase);

  // Preferred path: the server saved the blob and returned a token (imgPath). We
  // reference it by URL (loaded via /i/ — resized WebP, streamed) instead of
  // carrying a 12MB base64 data URL through the app. serverSaved tells the store
  // it's already persisted, so it must NOT re-upload it.
  const serverSaved = !!j.imgPath;
  const result: GenerateResult = serverSaved
    ? {
        url: `hjen-file://${j.imgPath}`,
        b64: '',
        savedPath: j.imgPath as string,
        serverSaved: true,
        prompt: '',
        size: j.apiSize,
        ts: Date.now(),
        modelLabel: j.modelLabel,
      } as GenerateResult
    : {
        url: `data:image/png;base64,${j.b64}`,
        b64: j.b64,
        prompt: '',          // the composed recipe stays on the server — never returned
        size: j.apiSize,
        ts: Date.now(),
        modelLabel: j.modelLabel,
      };
  const size = {
    apiSize: j.apiSize as string,
    targetWidth: j.targetWidth as number,
    targetHeight: j.targetHeight as number,
    finalMP: j.finalMP as number,
    clampedAspect: undefined as boolean | undefined,
    notes: (j.notes || undefined) as string | undefined,
  };
  return {
    result,
    apiSize: j.apiSize,
    apiDurationMs: Math.round(typeof j.durationMs === 'number' ? j.durationMs : (performance.now() - tStart)),
    size,
    assembledPrompt: '',   // hidden: composed server-side
    quality: j.quality,
  };
}

/** Run one frame generation end-to-end (API call + aspect crop). Pure w.r.t. app state.
 *  `opts.jobId` (the store's frame-job id) is forwarded to the gateway as the
 *  idempotency + recovery key so a paid frame is never lost to an interrupted run. */
export async function runFrameGeneration(selections: Selections, layers: Layer[] = [], opts?: { jobId?: string; onPhase?: (phase: string, queued?: number) => void }): Promise<FrameGenResult> {
  const modelSpec = MODELS[selections.model];

  // Gateway mode (web + distributed desktop): compose + generate on the server.
  // Only the OpenAI provider is migrated so far; Google/offline fall through.
  if (modelSpec?.provider === 'openai') {
    const gw = await gatewayConf();
    if (gw) return runFrameViaGateway(gw, selections, layers, opts?.jobId, opts?.onPhase);
  }

  const size = resolveSize(selections.model, selections.aspect, selections.resolution);
  const assembledPrompt = buildPrompt(selections, layers);
  const quality = mapQuality(selections.model, selections.quality);

  const tApiStart = performance.now();
  let result: GenerateResult;
  if (modelSpec.provider === 'openai') {
    if (layers.length > 0) {
      // Order must mirror buildPrompt's reference-mention order so the model
      // maps "Image N" → the right asset: compositions → characters (+nested
      // children inline) → everything else.
      const ordered = [
        ...layers.filter(l => l.category === 'composition' && !l.parentLayerId),
        ...layers.filter(l => l.category === 'character' && !l.parentLayerId),
        ...layers.filter(l => l.parentLayerId),
        ...layers.filter(l =>
          l.category !== 'composition' &&
          l.category !== 'character' &&
          !l.parentLayerId,
        ),
      ];
      result = await generateWithReferences({
        prompt: assembledPrompt,
        size: size.apiSize,
        quality: quality as 'low' | 'medium' | 'high',
        modelId: modelSpec.apiModelId,
        referenceFilePaths: ordered.map(l => l.filePath),
      });
    } else {
      result = await generateImage({
        prompt: assembledPrompt,
        size: size.apiSize,
        quality: quality as 'low' | 'medium' | 'high',
        modelId: modelSpec.apiModelId,
      });
    }
  } else if (modelSpec.api === 'generateContent') {
    // The reference-capable Google door. Same layer order as the OpenAI path so
    // "Image N" maps to the same asset whichever model is driving.
    const ordered = [
      ...layers.filter(l => l.category === 'composition' && !l.parentLayerId),
      ...layers.filter(l => l.category === 'character' && !l.parentLayerId),
      ...layers.filter(l => l.parentLayerId),
      ...layers.filter(l =>
        l.category !== 'composition' && l.category !== 'character' && !l.parentLayerId),
    ];
    result = await generateWithGeminiImage({
      prompt: assembledPrompt,
      width: size.targetWidth,
      height: size.targetHeight,
      apiModelId: modelSpec.apiModelId,
      referenceFilePaths: ordered.map(l => l.filePath),
    });
  } else {
    // Imagen `:predict` — text-to-image only; any layer here is discarded.
    result = await generateWithGemini({
      prompt: assembledPrompt,
      width: size.targetWidth,
      height: size.targetHeight,
      quality,
      apiModelId: modelSpec.apiModelId,
    });
  }
  const apiDurationMs = Math.round(performance.now() - tApiStart);
  result.modelLabel = modelSpec.label;

  // Capture the pre-crop size, then crop to the exact target aspect ratio
  // whenever the model output doesn't already match.
  const apiSize = result.size;
  const [aw, ah] = apiSize.split('x').map(Number);
  const apiAspect = aw / ah;
  const targetAspect = size.targetWidth / size.targetHeight;
  if (Math.abs(apiAspect - targetAspect) > 0.01 || aw !== size.targetWidth || ah !== size.targetHeight) {
    try {
      const cropped = await cropImageToTarget(result.b64, size.targetWidth, size.targetHeight);
      result.b64 = cropped;
      result.url = `data:image/png;base64,${cropped}`;
      result.size = `${size.targetWidth}x${size.targetHeight}`;
    } catch (cropErr) {
      console.warn('Crop failed, keeping raw output', cropErr);
    }
  }

  return { result, apiSize, apiDurationMs, size, assembledPrompt, quality };
}
