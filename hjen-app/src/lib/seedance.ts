// Seedance 2.0 (BytePlus ModelArk) — renderer-side orchestrator.
//
// Wraps the submit → poll → download → save pipeline behind a single
// `runSeedance()` call. The UI passes an `onStatus` callback so the view
// can stream live status text to the user during the long poll loop.

export type SeedanceResolution = '480p' | '720p' | '1080p' | '4k';
export type SeedanceRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';

export interface SeedanceParams {
  /** User-authored prompt text (Arabic or English). Flags are appended in main. */
  prompt: string;
  /** Optional. Local absolute path to first-frame anchor. */
  imagePath?: string | null;
  /** Optional. Last-frame anchor for end-state control. */
  endImagePath?: string | null;
  resolution: SeedanceResolution;
  duration: number;            // 5 / 10 (Seedance 2 supports 5s and 10s)
  ratio: SeedanceRatio;
  fps: number;                 // 24 / 30 typical
  seed?: number | null;
  cameraFixed?: boolean;
  watermark?: boolean;         // default false; passing true keeps watermark
  audio?: boolean;             // model audio safety filter is aggressive — default off
  modelId?: string;            // override SEEDANCE_MODEL env / default
  /** References attached at submit time. Not consumed by Seedance directly,
   *  but persisted into the sidecar so clicking the past video later
   *  restores the same refs into the right rail. */
  videoRefs?: Array<{
    id: string;
    assetId: string;
    category: string;
    filePath: string;
    thumbPath: string;
    name: string;
  }>;
  /** Raw user prompt (before DOP suffix). Sidecar-only; the model still
   *  receives the enriched `prompt` field. */
  rawUserPrompt?: string;
  /** Snapshot of DOP selections at submit time. Sidecar-only. */
  selectionsSnapshot?: Record<string, any>;
}

export interface SeedanceProgress {
  phase: 'submitting' | 'queued' | 'running' | 'downloading' | 'saving' | 'done' | 'failed';
  status?: string;
  elapsedMs: number;
  taskId?: string;
  message?: string;
}

export interface SeedanceSaveContext {
  promptSlug: string;
  projectSlug?: string;
  projectId?: string;
}

export interface SeedanceResult {
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
const POLL_TIMEOUT_MS = 35 * 60 * 1000;    // 35 min hard cap; 1080p 10s ≈ 4-8 min, 4K 10s ≈ 15-25 min

/** Distinct outcome of a re-poll on an EXISTING task id (crash recovery). Lets
 *  the caller tell "the server still has no verdict / no record" apart from a
 *  hard failure, so the operations LOG can be honest about what happened. */
export type SeedanceRecovery =
  | { kind: 'done'; result: SeedanceResult }
  | { kind: 'failed'; message: string }
  | { kind: 'gone'; message: string }         // server has no record / expired
  | { kind: 'running'; status: string };      // still rendering server-side

/** Submit → poll → download → save. Returns the on-disk path + sidecar. */
export async function runSeedance(
  params: SeedanceParams,
  save: SeedanceSaveContext,
  onStatus?: (p: SeedanceProgress) => void,
  /** Fired the instant the server ACCEPTS the task (taskId in hand), BEFORE the
   *  long poll begins — the moment a durable pending record must be written so
   *  a crash mid-render can still be recovered on reopen. */
  onSubmitted?: (info: { taskId: string; model: string; promptFull: string }) => void,
): Promise<SeedanceResult> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  onStatus?.({ phase: 'submitting', elapsedMs: elapsed() });

  const sub = await window.hjen.seedanceSubmit({
    prompt: params.prompt,
    imagePath: params.imagePath ?? null,
    endImagePath: params.endImagePath ?? null,
    resolution: params.resolution,
    duration: params.duration,
    ratio: params.ratio,
    fps: params.fps,
    seed: params.seed ?? null,
    cameraFixed: params.cameraFixed ?? false,
    watermark: params.watermark ?? false,
    audio: params.audio ?? false,
    modelId: params.modelId,
  });
  if (!sub.ok) throw new Error(sub.message);

  const { taskId, model, promptFull } = sub;
  onSubmitted?.({ taskId, model, promptFull });

  let videoUrl: string | null = null;
  let usage: any = null;
  let lastStatus: string | null = null;
  const pollStart = Date.now();

  while (true) {
    if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
      throw new Error(`Seedance task ${taskId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
    }
    await sleep(POLL_INTERVAL_MS);
    const poll = await window.hjen.seedancePoll({ taskId });
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
      videoUrl = poll.videoUrl;
      usage = poll.usage;
      break;
    }
    if (poll.status === 'failed' || poll.status === 'cancelled') {
      throw new Error(`Seedance task ${poll.status}: ${poll.errorMessage || '(no error message)'}`);
    }
  }

  if (!videoUrl) throw new Error('Seedance succeeded but returned no video_url. Check raw task in console.');

  return downloadAndSave(
    { videoUrl, taskId, model, promptFull, usage },
    params, save, elapsed, onStatus,
  );
}

/** Shared tail — fetch the finished clip + write it and its sidecar to disk.
 *  Used by both the live run and the crash-recovery re-poll so a recovered
 *  clip is byte-identical to a normally-made one (same sidecar schema). */
async function downloadAndSave(
  done: { videoUrl: string; taskId: string; model: string; promptFull: string; usage: any },
  params: SeedanceParams,
  save: SeedanceSaveContext,
  elapsed: () => number,
  onStatus?: (p: SeedanceProgress) => void,
): Promise<SeedanceResult> {
  const { videoUrl, taskId, model, promptFull, usage } = done;
  onStatus?.({ phase: 'downloading', elapsedMs: elapsed(), taskId });

  const fetched = await window.hjen.fetchUrlBase64(videoUrl);
  if (!fetched.ok) throw new Error(`Video download failed: ${fetched.message}`);

  onStatus?.({ phase: 'saving', elapsedMs: elapsed(), taskId });

  const sidecar = {
    captured: new Date().toISOString(),
    tool: 'seedance',
    kind: 'video',
    model,
    apiModelId: model,
    taskId,
    prompt: params.prompt,
    promptFull,
    imagePath: params.imagePath || null,
    endImagePath: params.endImagePath || null,
    resolution: params.resolution,
    duration: params.duration,
    ratio: params.ratio,
    fps: params.fps,
    seed: params.seed ?? null,
    cameraFixed: !!params.cameraFixed,
    watermark: !!params.watermark,
    audio: !!params.audio,
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

/** CRASH RECOVERY — re-attach to a task id that was already accepted server-side
 *  before the app was cut off. Polls the task the same way a live run does; if it
 *  has finished it downloads + saves the clip (→ 'done'), otherwise it reports the
 *  honest server state so the LOG can show why nothing was retrieved. Never
 *  submits a new task — the paid render already exists upstream. */
export async function resumeSeedance(
  taskId: string,
  model: string,
  promptFull: string,
  params: SeedanceParams,
  save: SeedanceSaveContext,
  onStatus?: (p: SeedanceProgress) => void,
): Promise<SeedanceRecovery> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  const pollStart = Date.now();
  let lastStatus: string | null = null;

  while (true) {
    if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
      return { kind: 'running', status: lastStatus || 'unknown' };
    }
    const poll = await window.hjen.seedancePoll({ taskId });
    if (!poll.ok) {
      // No key / transient poll error — treat as "can't reach a verdict now".
      return { kind: 'gone', message: poll.message };
    }
    if (poll.status !== lastStatus) {
      lastStatus = poll.status;
      onStatus?.({
        phase: poll.status === 'queued' ? 'queued' : 'running',
        status: poll.status, elapsedMs: elapsed(), taskId,
      });
    }
    if (poll.status === 'succeeded' || poll.status === 'completed') {
      if (!poll.videoUrl) return { kind: 'failed', message: 'Task completed but returned no video_url.' };
      const result = await downloadAndSave(
        { videoUrl: poll.videoUrl, taskId, model, promptFull, usage: poll.usage },
        params, save, elapsed, onStatus,
      );
      return { kind: 'done', result };
    }
    if (poll.status === 'failed' || poll.status === 'cancelled') {
      return { kind: 'failed', message: poll.errorMessage || `Task ${poll.status}` };
    }
    // still queued / running — wait and poll again
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Slugify for filenames — mirrors the Python script's slugify(). */
export function slugifyPrompt(text: string, maxLen = 40): string {
  const s = text
    .replace(/[^\w\s-]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');
  return s.slice(0, maxLen).replace(/^-+|-+$/g, '') || 'untitled';
}
