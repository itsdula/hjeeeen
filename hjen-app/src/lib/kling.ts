// Kling video (Kuaishou) — renderer-side orchestrator.
//
// Sister of seedance.ts: same submit → poll → download → save shape and the
// same `onStatus` progress stream, so VideoView drives both backends through
// one code path. The MAIN process (electron/main.ts hjen:kling-submit/poll)
// normalises Kling's `task_status` (submitted|processing|succeed|failed) to the
// Seedance vocabulary ('queued'|'running'|'succeeded'|'failed'), so the poll
// loop below is identical in spirit to runSeedance().
//
// The one Kling-specific wrinkle: the poll route mirrors the submit route
// (/v1/videos/text2video vs /image2video), so submit returns a `videoType`
// that we thread into every poll call.

export type KlingMode = 'std' | 'pro' | '4k';           // std=720P, pro=1080P, 4k=4K
export type KlingRatio = '16:9' | '9:16' | '1:1';
export type KlingCameraType =
  | 'simple' | 'down_back' | 'forward_up' | 'right_turn_forward' | 'left_turn_forward';

export interface KlingParams {
  /** User-authored prompt (Arabic or English). */
  prompt: string;
  negativePrompt?: string;
  /** Optional first-frame anchor → image-to-video. */
  imagePath?: string | null;
  /** Optional last-frame anchor (image_tail). Mutually exclusive with camera. */
  endImagePath?: string | null;
  /** Kling model_name, e.g. 'kling-v3', 'kling-v2-6'. */
  modelId: string;
  mode: KlingMode;
  /** Only used for text-to-video (image mode derives ratio from the image). */
  aspectRatio: KlingRatio;
  duration: number;              // 3..15 (model-dependent)
  cfgScale?: number | null;      // 0..1; ignored on kling-v2.x
  cameraType?: KlingCameraType | null;
  cameraConfig?: Record<string, number> | null;
  sound?: boolean;               // native audio
  watermark?: boolean;           // true = keep watermark
  /** References attached at submit time — sidecar-only (restores the right rail). */
  videoRefs?: Array<{
    id: string;
    assetId: string;
    category: string;
    filePath: string;
    thumbPath: string;
    name: string;
  }>;
  rawUserPrompt?: string;
  selectionsSnapshot?: Record<string, any>;
}

export interface KlingProgress {
  phase: 'submitting' | 'queued' | 'running' | 'downloading' | 'saving' | 'done' | 'failed';
  status?: string;
  elapsedMs: number;
  taskId?: string;
  message?: string;
}

export interface KlingSaveContext {
  promptSlug: string;
  projectSlug?: string;
  projectId?: string;
}

export interface KlingResult {
  videoPath: string;
  jsonPath: string;
  thumbPath: string;
  taskId: string;
  model: string;
  promptFull: string;
  videoUrl: string;
  usage: any;
  durationMs: number;
}

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 35 * 60 * 1000;   // 35 min hard cap (4K / long clips run slow)

export type KlingRecovery =
  | { kind: 'done'; result: KlingResult }
  | { kind: 'failed'; message: string }
  | { kind: 'gone'; message: string }
  | { kind: 'running'; status: string };

/** Submit → poll → download → save. Returns the on-disk path + sidecar. */
export async function runKling(
  params: KlingParams,
  save: KlingSaveContext,
  onStatus?: (p: KlingProgress) => void,
  onSubmitted?: (info: { taskId: string; model: string; promptFull: string; videoType: 'text2video' | 'image2video' }) => void,
): Promise<KlingResult> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  onStatus?.({ phase: 'submitting', elapsedMs: elapsed() });

  const sub = await window.hjen.klingSubmit({
    prompt: params.prompt,
    negativePrompt: params.negativePrompt,
    imagePath: params.imagePath ?? null,
    endImagePath: params.endImagePath ?? null,
    modelName: params.modelId,
    mode: params.mode,
    aspectRatio: params.aspectRatio,
    duration: params.duration,
    cfgScale: params.cfgScale ?? null,
    cameraType: params.cameraType ?? null,
    cameraConfig: params.cameraConfig ?? null,
    sound: params.sound ?? false,
    watermark: params.watermark ?? false,
  });
  if (!sub.ok) throw new Error(sub.message);

  const { taskId, model, promptFull, videoType } = sub;
  onSubmitted?.({ taskId, model, promptFull, videoType });

  const videoUrl = await pollUntilDone(taskId, videoType, elapsed, onStatus);
  return downloadAndSave({ videoUrl: videoUrl.url, taskId, model, promptFull, usage: videoUrl.usage, videoType }, params, save, elapsed, onStatus);
}

/** Shared poll loop → returns the finished clip url + usage, or throws. */
async function pollUntilDone(
  taskId: string,
  videoType: 'text2video' | 'image2video',
  elapsed: () => number,
  onStatus?: (p: KlingProgress) => void,
): Promise<{ url: string; usage: any }> {
  let lastStatus: string | null = null;
  const pollStart = Date.now();
  while (true) {
    if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
      throw new Error(`Kling task ${taskId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
    }
    await sleep(POLL_INTERVAL_MS);
    const poll = await window.hjen.klingPoll({ taskId, videoType });
    if (!poll.ok) throw new Error(poll.message);

    if (poll.status !== lastStatus) {
      lastStatus = poll.status;
      onStatus?.({
        phase: poll.status === 'queued' ? 'queued' : 'running',
        status: poll.status,
        elapsedMs: elapsed(),
        taskId,
      });
    }
    if (poll.status === 'succeeded' || poll.status === 'completed') {
      if (!poll.videoUrl) throw new Error('Kling succeeded but returned no video url.');
      return { url: poll.videoUrl, usage: poll.usage };
    }
    if (poll.status === 'failed' || poll.status === 'cancelled') {
      throw new Error(`Kling task ${poll.status}: ${poll.errorMessage || '(no error message)'}`);
    }
  }
}

async function downloadAndSave(
  done: { videoUrl: string; taskId: string; model: string; promptFull: string; usage: any; videoType: 'text2video' | 'image2video' },
  params: KlingParams,
  save: KlingSaveContext,
  elapsed: () => number,
  onStatus?: (p: KlingProgress) => void,
): Promise<KlingResult> {
  const { videoUrl, taskId, model, promptFull, usage } = done;
  onStatus?.({ phase: 'downloading', elapsedMs: elapsed(), taskId });

  const fetched = await window.hjen.fetchUrlBase64(videoUrl);
  if (!fetched.ok) throw new Error(`Video download failed: ${fetched.message}`);

  onStatus?.({ phase: 'saving', elapsedMs: elapsed(), taskId });

  const sidecar = {
    captured: new Date().toISOString(),
    tool: 'kling',
    kind: 'video',
    model,
    apiModelId: model,
    taskId,
    videoType: done.videoType,
    prompt: params.prompt,
    promptFull,
    negativePrompt: params.negativePrompt || null,
    imagePath: params.imagePath || null,
    endImagePath: params.endImagePath || null,
    mode: params.mode,
    aspectRatio: params.aspectRatio,
    duration: params.duration,
    cfgScale: params.cfgScale ?? null,
    cameraType: params.cameraType || null,
    cameraConfig: params.cameraConfig || null,
    sound: !!params.sound,
    watermark: !!params.watermark,
    videoUrl,
    usage,
    durationMs: elapsed(),
    project: null as null | { id: string; name: string; slug: string },
    videoRefs: params.videoRefs ?? [],
    rawUserPrompt: params.rawUserPrompt ?? params.prompt,
    selectionsSnapshot: params.selectionsSnapshot ?? null,
  };

  const saved = await window.hjen.saveVideo({
    base64: fetched.base64,
    sidecar,
    promptSlug: save.promptSlug,
    projectSlug: save.projectSlug,
    projectId: save.projectId,
    posterPath: params.imagePath || null,
  });

  const finalMs = elapsed();
  onStatus?.({ phase: 'done', elapsedMs: finalMs, taskId });

  return {
    videoPath: saved.videoPath,
    jsonPath: saved.jsonPath,
    thumbPath: saved.thumbPath,
    taskId,
    model,
    promptFull,
    videoUrl,
    usage,
    durationMs: finalMs,
  };
}

/** CRASH RECOVERY — re-attach to an already-accepted Kling task id. Never
 *  re-submits (the paid render exists upstream). Mirrors resumeSeedance(). */
export async function resumeKling(
  taskId: string,
  videoType: 'text2video' | 'image2video',
  model: string,
  promptFull: string,
  params: KlingParams,
  save: KlingSaveContext,
  onStatus?: (p: KlingProgress) => void,
): Promise<KlingRecovery> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  const pollStart = Date.now();
  let lastStatus: string | null = null;

  while (true) {
    if (Date.now() - pollStart > POLL_TIMEOUT_MS) return { kind: 'running', status: lastStatus || 'unknown' };
    const poll = await window.hjen.klingPoll({ taskId, videoType });
    if (!poll.ok) return { kind: 'gone', message: poll.message };
    if (poll.status !== lastStatus) {
      lastStatus = poll.status;
      onStatus?.({ phase: poll.status === 'queued' ? 'queued' : 'running', status: poll.status, elapsedMs: elapsed(), taskId });
    }
    if (poll.status === 'succeeded' || poll.status === 'completed') {
      if (!poll.videoUrl) return { kind: 'failed', message: 'Task completed but returned no video url.' };
      const result = await downloadAndSave(
        { videoUrl: poll.videoUrl, taskId, model, promptFull, usage: poll.usage, videoType },
        params, save, elapsed, onStatus,
      );
      return { kind: 'done', result };
    }
    if (poll.status === 'failed' || poll.status === 'cancelled') {
      return { kind: 'failed', message: poll.errorMessage || `Task ${poll.status}` };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
