// Shared make core — the ONE place a frame/refine/video is produced + saved, so
// the make tools AND the orchestration tools (chain/storyboard/graph) call the
// exact same logic instead of drifting. Pure of the MCP layer; callers own the
// cost-guard (confirm) decision.

import type { Host } from './host.js';
import type { ProjectMeta } from './types.js';
import { makeImage, estimateImageUsd } from './providers/openai.js';
import { resolveSize, mapQuality, type Quality, type Resolution } from './providers/imagesize.js';
import { submitSeedance, estimateVideoUsd, pollSeedance, type SeedanceParams } from './providers/seedance.js';
import { submitKling, pollKling, estimateKlingUsd, type KlingVideoParams } from './providers/kling.js';
import { saveImage, saveVideo, saveStoryboardImage } from './save.js';
import { createJob, updateJob } from './jobs.js';
import { projectLink } from './deeplinks.js';
import { pingControl } from './control-ping.js';

export const asQuality = (v: unknown): Quality => (v === 'LOW' || v === 'HIGH' ? v : 'MED');
export const asRes = (v: unknown): Resolution => (v === '1MP' || v === '8.3MP' ? v : '3.7MP');
export const frameEstimate = (q: Quality): number => estimateImageUsd(mapQuality(q));
export { estimateVideoUsd };

export interface FrameOpts { prompt: string; project?: ProjectMeta | null; aspect?: string; resolution?: Resolution; quality?: Quality; references?: string[]; }
export interface FrameResult { imgPath: string; jsonPath: string; size: string; quality: Quality; costUsd: number; durationMs: number; deepLink?: string; }

export async function makeFrameAndSave(host: Host, o: FrameOpts): Promise<FrameResult> {
  const q = o.quality ?? 'MED'; const apiQ = mapQuality(q);
  const size = resolveSize(o.aspect || '16:9', o.resolution ?? '3.7MP');
  const usd = estimateImageUsd(apiQ);
  const refs = o.references ?? [];
  const t0 = Date.now();
  const img = await makeImage(host, { prompt: o.prompt, size: size.apiSize, quality: apiQ, referencePaths: refs });
  const durationMs = Date.now() - t0;
  const sidecar = { captured: new Date().toISOString(), tool: 'mcp-frame', kind: 'image', prompt: o.prompt, promptFull: o.prompt, size: size.apiSize, model: 'gpt-image-2', selections: { prompt: o.prompt, quality: q, resolution: o.resolution ?? '3.7MP', aspect: o.aspect || '16:9' }, references: refs.map(path => ({ path })), estimatedCost: { usd }, durationMs, project: o.project ? { id: o.project.id, name: o.project.name, slug: o.project.slug } : null };
  const saved = saveImage(host, { base64: img.b64, sidecar, promptSlug: o.prompt, project: o.project ?? null });
  // Nudge a running app so the Frame history refreshes live (no restart).
  pingControl(host, { projectId: o.project?.id ?? null, kind: 'generation' });
  return { imgPath: saved.imgPath, jsonPath: saved.jsonPath, size: size.apiSize, quality: q, costUsd: usd, durationMs, deepLink: o.project ? projectLink(o.project.id, 'frame') : undefined };
}

/** Make a STORYBOARD PANEL and save it into the board's folder (not the Frame
 *  history). Same maker, different destination — so panels stay out of Frames. */
export async function makePanelAndSave(host: Host, o: FrameOpts & { panelId?: string }): Promise<FrameResult> {
  const q = o.quality ?? 'MED'; const apiQ = mapQuality(q);
  const size = resolveSize(o.aspect || '16:9', o.resolution ?? '3.7MP');
  const usd = estimateImageUsd(apiQ);
  const refs = o.references ?? [];
  const t0 = Date.now();
  const img = await makeImage(host, { prompt: o.prompt, size: size.apiSize, quality: apiQ, referencePaths: refs });
  const durationMs = Date.now() - t0;
  const sidecar = { captured: new Date().toISOString(), tool: 'mcp-storyboard-panel', kind: 'storyboard-panel', panel: o.panelId, prompt: o.prompt, promptFull: o.prompt, size: size.apiSize, model: 'gpt-image-2', selections: { prompt: o.prompt, quality: q, aspect: o.aspect || '16:9' }, references: refs.map(path => ({ path })), estimatedCost: { usd }, durationMs, project: o.project ? { id: o.project.id, name: o.project.name, slug: o.project.slug } : null };
  const saved = saveStoryboardImage(host, { base64: img.b64, sidecar, promptSlug: `panel-${o.panelId || o.prompt}`, project: o.project ?? null });
  return { imgPath: saved.imgPath, jsonPath: saved.jsonPath, size: size.apiSize, quality: q, costUsd: usd, durationMs, deepLink: o.project ? projectLink(o.project.id, 'storyboard') : undefined };
}

export interface RefineOpts { image: string; instruction: string; project?: ProjectMeta | null; aspect?: string; quality?: Quality; }
export async function refineAndSave(host: Host, o: RefineOpts): Promise<FrameResult & { refinedFrom: string }> {
  const q = o.quality ?? 'HIGH'; const apiQ = mapQuality(q);
  const size = resolveSize(o.aspect || '1:1', '1MP');
  const usd = estimateImageUsd(apiQ);
  const t0 = Date.now();
  const out = await makeImage(host, { prompt: o.instruction, size: size.apiSize, quality: apiQ, referencePaths: [o.image] });
  const durationMs = Date.now() - t0;
  const sidecar = { captured: new Date().toISOString(), tool: 'mcp-refine', kind: 'image', prompt: o.instruction, promptFull: o.instruction, size: size.apiSize, model: 'gpt-image-2', selections: { prompt: o.instruction, quality: q, aspect: o.aspect || '1:1' }, references: [{ path: o.image }], estimatedCost: { usd }, durationMs, refinedFrom: o.image, project: o.project ? { id: o.project.id, name: o.project.name, slug: o.project.slug } : null };
  const saved = saveImage(host, { base64: out.b64, sidecar, promptSlug: o.instruction, project: o.project ?? null });
  return { imgPath: saved.imgPath, jsonPath: saved.jsonPath, size: size.apiSize, quality: q, costUsd: usd, durationMs, refinedFrom: o.image, deepLink: o.project ? projectLink(o.project.id, 'frame') : undefined };
}

export interface VideoStartOpts { params: SeedanceParams; project?: ProjectMeta | null; promptSlug: string; }
export async function startVideoJob(host: Host, o: VideoStartOpts): Promise<{ jobId: string; taskId: string; estimateUsd: number }> {
  const usd = estimateVideoUsd(o.params.resolution, o.params.duration);
  const sub = await submitSeedance(host, o.params);
  const proj = o.project ?? null;
  const job = createJob('video', { project: proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null, prompt: o.params.prompt, taskId: sub.taskId, model: sub.model, resolution: o.params.resolution, duration: o.params.duration, ratio: o.params.ratio, estimatedUsd: usd, promptFull: sub.promptFull });
  void videoPollLoop(host, job.id, (id) => pollSeedance(host, id), { promptSlug: o.promptSlug, project: proj, model: sub.model, ratio: o.params.ratio, duration: o.params.duration, promptFull: sub.promptFull, estimatedUsd: usd }, sub.taskId);
  return { jobId: job.id, taskId: sub.taskId, estimateUsd: usd };
}

export interface KlingVideoStartOpts { params: KlingVideoParams; project?: ProjectMeta | null; promptSlug: string; }
export async function startKlingVideoJob(host: Host, o: KlingVideoStartOpts): Promise<{ jobId: string; taskId: string; estimateUsd: number }> {
  const mode = o.params.mode ?? 'std';
  const usd = estimateKlingUsd(o.params.modelName, mode, o.params.duration ?? 5, !!o.params.sound);
  const sub = await submitKling(host, o.params);
  const proj = o.project ?? null;
  const ratio = o.params.aspectRatio ?? '16:9';
  const job = createJob('video', { project: proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null, prompt: o.params.prompt, taskId: sub.taskId, model: sub.model, resolution: mode, duration: o.params.duration ?? 5, ratio, estimatedUsd: usd, promptFull: sub.promptFull });
  void videoPollLoop(host, job.id, (id) => pollKling(host, id, sub.videoType), { promptSlug: o.promptSlug, project: proj, model: sub.model, ratio, duration: o.params.duration ?? 5, promptFull: sub.promptFull, estimatedUsd: usd }, sub.taskId);
  return { jobId: job.id, taskId: sub.taskId, estimateUsd: usd };
}

// Provider-agnostic poll loop. `pollFn` returns the normalised
// { status, videoUrl, usage, error } shape both Seedance and Kling adapters emit.
type VideoPoll = { status: string; videoUrl: string | null; usage: any; error: string | null };
async function videoPollLoop(host: Host, jobId: string, pollFn: (taskId: string) => Promise<VideoPoll>, ctx: { promptSlug: string; project: ProjectMeta | null; model: string; ratio: string; duration: number; promptFull: string; estimatedUsd: number }, taskId: string): Promise<void> {
  const started = Date.now(); const MAX = 40 * 60_000;
  updateJob(jobId, { status: 'running', progress: 'submitted' });
  for (;;) {
    if (Date.now() - started > MAX) { updateJob(jobId, { status: 'failed', error: 'timeout after 40m' }); return; }
    await new Promise(r => setTimeout(r, 5000));
    let poll; try { poll = await pollFn(taskId); } catch (e: any) { updateJob(jobId, { progress: `poll error: ${e?.message || e}` }); continue; }
    updateJob(jobId, { progress: poll.status });
    if (poll.status === 'succeeded' && poll.videoUrl) {
      try {
        const r = await fetch(poll.videoUrl);
        const b64 = Buffer.from(await r.arrayBuffer()).toString('base64');
        const durationMs = Date.now() - started;
        const sidecar = { captured: new Date().toISOString(), tool: 'mcp-video', kind: 'video', prompt: ctx.promptSlug, promptFull: ctx.promptFull, model: ctx.model, ratio: ctx.ratio, seconds: ctx.duration, videoUrl: poll.videoUrl, usage: poll.usage, estimatedCost: { usd: ctx.estimatedUsd }, durationMs, project: ctx.project ? { id: ctx.project.id, name: ctx.project.name, slug: ctx.project.slug } : null };
        const saved = saveVideo(host, { base64: b64, sidecar, promptSlug: ctx.promptSlug, project: ctx.project });
        updateJob(jobId, { status: 'succeeded', progress: 'saved', result: { videoPath: saved.videoPath, jsonPath: saved.jsonPath, usage: poll.usage, durationMs, deepLink: ctx.project ? projectLink(ctx.project.id, 'video') : undefined } });
      } catch (e: any) { updateJob(jobId, { status: 'failed', error: `download/save failed: ${e?.message || e}` }); }
      return;
    }
    if (poll.status === 'failed') { updateJob(jobId, { status: 'failed', error: poll.error || 'seedance failed' }); return; }
  }
}
