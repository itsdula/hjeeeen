// Make tools (Phase 2) — the paid layer. COST GUARD: every generation tool is a
// no-op unless `confirm: true`; without it, the tool returns an estimate so the
// agent can surface the spend to the user first. Thin wrappers over make-core.

import { McpServer, type ToolResult } from '../mcp/server.js';
import type { Host } from '../host.js';
import { resolveProject } from '../projects.js';
import type { ProjectMeta } from '../types.js';
import { getJob, waitJob, view } from '../jobs.js';
import {
  asQuality, asRes, frameEstimate, estimateVideoUsd,
  makeFrameAndSave, refineAndSave, startVideoJob, startKlingVideoJob,
} from '../make-core.js';
import { estimateKlingUsd } from '../providers/kling.js';
import { mapQuality, type Quality } from '../providers/imagesize.js';
import { estimateImageUsd } from '../providers/openai.js';
import type { SeedanceParams } from '../providers/seedance.js';
import type { KlingVideoParams } from '../providers/kling.js';
import { driveApp, appIsRunning } from '../drive.js';

const ok = (d: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(d, null, 2) }] });
const fail = (d: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(d, null, 2) }], isError: true });
const resolveOpt = (host: Host, q?: string): ProjectMeta | null => (q ? resolveProject(host, String(q)).project : null);

export function registerMakeTools(server: McpServer, host: Host): void {
  server.tool({
    name: 'hjen_frame_make',
    title: 'Make a frame (still)',
    description: 'Make a still image with gpt-image-2 and save it into the project (appears in the app\'s Usage/Library). COST GUARD: returns an estimate unless confirm:true. Load hjen://dna first and write the prompt in-DNA.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The full image prompt (write it in-DNA).' },
        project: { type: 'string', description: 'Optional project id/slug/name to save into (else _unassigned).' },
        model: { type: 'string', enum: ['GPT_IMAGE_2'], description: 'Frame model (only GPT_IMAGE_2 headless for now).' },
        aspect: { type: 'string', description: 'Aspect ratio, e.g. "16:9", "4:5" (default 16:9).' },
        resolution: { type: 'string', enum: ['1MP', '3.7MP', '8.3MP'], description: 'Target MP (default 3.7MP).' },
        quality: { type: 'string', enum: ['LOW', 'MED', 'HIGH'], description: 'LOW≈$0.03, MED≈$0.07, HIGH≈$0.13 (default MED).' },
        references: { type: 'array', description: 'Optional absolute paths of reference images (→ edit mode).' },
        confirm: { type: 'boolean', description: 'Must be true to actually spend. Omit for a dry-run estimate.' },
      },
      required: ['prompt'],
    },
    handler: async ({ prompt, project, model, aspect, resolution, quality, references, confirm }) => {
      const p = String(prompt ?? '').trim();
      if (!p) return fail({ error: 'prompt_required' });
      if (model && model !== 'GPT_IMAGE_2') return fail({ error: 'unsupported_model', note: 'Only GPT_IMAGE_2 is available headless; NANO_BANANA_PRO (Google) comes later.' });
      const q = asQuality(quality);
      const refs = Array.isArray(references) ? references.map(String) : [];
      if (confirm !== true) return ok({ requiresConfirm: true, estimateUsd: frameEstimate(q), quality: q, references: refs.length, note: 'Dry-run. Set confirm:true to spend.' });
      const proj = resolveOpt(host, project ? String(project) : undefined);
      // DRIVE-FIRST: if the Studio is open, run its REAL Frame generate so the
      // user watches it in the Frame view (with the references shown as layers);
      // fall back to headless only when the app is closed.
      const driven = appIsRunning(host) ? await driveApp(host, 'frame.generate', { projectId: proj?.id, prompt: p, aspect: aspect ? String(aspect) : undefined, quality: q, references: refs }) : null;
      if (driven) return driven.ok ? ok({ ...driven, drivenLive: true }) : fail(driven);
      try {
        return ok({ ok: true, ...(await makeFrameAndSave(host, { prompt: p, project: proj, aspect: aspect ? String(aspect) : undefined, resolution: asRes(resolution), quality: q, references: refs })) });
      } catch (err: any) { return fail({ error: 'make_failed', message: err?.message || String(err) }); }
    },
  });

  server.tool({
    name: 'hjen_frames_make',
    title: 'Make SEVERAL frames (parallel)',
    description: 'Make MANY still frames AT ONCE, in parallel — ALWAYS use this instead of calling hjen_frame_make in a loop when the user wants more than one frame. Each frame has its own prompt (in-DNA) + optional references. Drives the live Studio when open. COST GUARD: estimate unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        frames: { type: 'array', description: 'Array of { prompt, aspect?, quality?, references? }.', items: { type: 'object' } },
        project: { type: 'string', description: 'Optional project id/slug/name to save into.' },
        confirm: { type: 'boolean', description: 'Must be true to spend.' },
      },
      required: ['frames'],
    },
    handler: async ({ frames, project, confirm }) => {
      const list = Array.isArray(frames) ? frames.filter((f: any) => f && String(f.prompt ?? '').trim()) : [];
      if (!list.length) return fail({ error: 'no_frames', hint: 'Pass frames:[{prompt},…].' });
      const est = list.reduce((sum: number, f: any) => sum + frameEstimate(asQuality(f.quality)), 0);
      if (confirm !== true) return ok({ requiresConfirm: true, count: list.length, estimateUsd: +est.toFixed(2), note: 'Dry-run. Set confirm:true to make ALL of them in parallel.' });
      const proj = resolveOpt(host, project ? String(project) : undefined);
      const shaped = list.map((f: any) => ({ prompt: String(f.prompt), aspect: f.aspect ? String(f.aspect) : undefined, quality: asQuality(f.quality), references: Array.isArray(f.references) ? f.references.map(String) : [] }));
      // DRIVE-FIRST: one parallel burst in the live Frame view; headless fallback.
      const driven = appIsRunning(host) ? await driveApp(host, 'frame.generateBatch', { projectId: proj?.id, frames: shaped }) : null;
      if (driven) return driven.ok ? ok({ ...driven, drivenLive: true }) : fail(driven);
      try {
        const results = await Promise.all(shaped.map(f => makeFrameAndSave(host, { prompt: f.prompt, project: proj, aspect: f.aspect, resolution: '3.7MP', quality: f.quality, references: f.references }).then(r => ({ ok: true, ...r })).catch((e: any) => ({ ok: false, error: String(e?.message || e) }))));
        return ok({ ok: true, made: results.filter((r: any) => r.ok).length, of: results.length, results });
      } catch (err: any) { return fail({ error: 'batch_failed', message: err?.message || String(err) }); }
    },
  });

  server.tool({
    name: 'hjen_portrait_refine',
    title: 'Refine a portrait / image',
    description: 'Refine an existing image via gpt-image-2 edit: pass the source image + a refine instruction. Preserves identity, applies the change. COST GUARD: estimate unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Absolute path to the source image.' },
        instruction: { type: 'string', description: 'What to refine (skin texture, wardrobe, cleanup…). Minimum intervention.' },
        project: { type: 'string', description: 'Optional project to save into.' },
        aspect: { type: 'string', description: 'Output aspect (default 1:1).' },
        quality: { type: 'string', enum: ['LOW', 'MED', 'HIGH'], description: 'Default HIGH.' },
        confirm: { type: 'boolean', description: 'Must be true to spend.' },
      },
      required: ['image', 'instruction'],
    },
    handler: async ({ image, instruction, project, aspect, quality, confirm }) => {
      const img = String(image ?? ''); const ins = String(instruction ?? '').trim();
      if (!img || !ins) return fail({ error: 'image_and_instruction_required' });
      const q: Quality = quality === 'LOW' || quality === 'MED' ? quality : 'HIGH';
      if (confirm !== true) return ok({ requiresConfirm: true, estimateUsd: estimateImageUsd(mapQuality(q)), quality: q, note: 'Dry-run. Set confirm:true to spend.' });
      try {
        return ok({ ok: true, ...(await refineAndSave(host, { image: img, instruction: ins, project: resolveOpt(host, project ? String(project) : undefined), aspect: aspect ? String(aspect) : undefined, quality: q })) });
      } catch (err: any) { return fail({ error: 'refine_failed', message: err?.message || String(err) }); }
    },
  });

  server.tool({
    name: 'hjen_video_make',
    title: 'Make a video (Seedance 2.0 / Kling)',
    description: 'Animate a still or a prompt into motion. Default backend Seedance 2.0 (BytePlus); pass model="kling-v3" (or kling-3.0-turbo / kling-v3-omni / kling-v2-6 / kling-v2-5-turbo) to use Kling instead. ASYNC: returns a jobId — poll with hjen_job_wait. COST GUARD: estimate unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Motion/scene prompt.' },
        model: { type: 'string', description: 'Video model. Default seedance. Kling: kling-v3 | kling-3.0-turbo | kling-v3-omni | kling-video-o1 | kling-v2-6 | kling-v2-5-turbo.' },
        imagePath: { type: 'string', description: 'Optional first-frame anchor (absolute path) → image-to-video.' },
        endImagePath: { type: 'string', description: 'Optional last-frame anchor.' },
        project: { type: 'string', description: 'Optional project to save into.' },
        // Seedance
        resolution: { type: 'string', enum: ['480p', '720p', '1080p', '4k'], description: 'Seedance resolution. Default 720p.' },
        ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], description: 'Default 16:9.' },
        fps: { type: 'number', description: 'Seedance fps. Default 24.' },
        seed: { type: 'number' }, cameraFixed: { type: 'boolean' },
        // Kling
        mode: { type: 'string', enum: ['std', 'pro', '4k'], description: 'Kling mode: std=720P, pro=1080P, 4k=4K. Default std.' },
        negativePrompt: { type: 'string', description: 'Kling negative prompt.' },
        cfgScale: { type: 'number', description: 'Kling cfg_scale 0..1 (ignored on kling-v2.x).' },
        // Shared
        duration: { type: 'number', description: 'Seconds. Seedance 5/10; Kling 3–15 (model-dependent). Default 5.' },
        watermark: { type: 'boolean' }, audio: { type: 'boolean' },
        confirm: { type: 'boolean', description: 'Must be true to spend.' },
      },
      required: ['prompt'],
    },
    handler: async ({ prompt, model, imagePath, endImagePath, project, resolution, duration, ratio, fps, seed, cameraFixed, watermark, audio, mode, negativePrompt, cfgScale, confirm }) => {
      const p = String(prompt ?? '').trim();
      if (!p) return fail({ error: 'prompt_required' });
      const dur = Number(duration) || 5;
      const modelStr = String(model ?? '').trim();
      const isKling = /^kling/i.test(modelStr);
      const proj = resolveOpt(host, project ? String(project) : undefined);

      if (isKling) {
        const klMode = (['std', 'pro', '4k'].includes(String(mode)) ? mode : 'std') as 'std' | 'pro' | '4k';
        if (confirm !== true) return ok({ requiresConfirm: true, estimateUsd: estimateKlingUsd(modelStr, klMode, dur, !!audio), note: 'Dry-run (approx). Real cost returns from the poll. Set confirm:true to spend.' });
        const params: KlingVideoParams = {
          prompt: p, negativePrompt: negativePrompt ? String(negativePrompt) : undefined,
          imagePath: imagePath ? String(imagePath) : null, endImagePath: endImagePath ? String(endImagePath) : null,
          modelName: modelStr, mode: klMode,
          aspectRatio: (['16:9', '9:16', '1:1'].includes(String(ratio)) ? ratio : '16:9') as '16:9' | '9:16' | '1:1',
          duration: dur, cfgScale: cfgScale == null ? null : Number(cfgScale), sound: !!audio, watermark: !!watermark,
        };
        try {
          const started = await startKlingVideoJob(host, { params, project: proj, promptSlug: p });
          return ok({ ok: true, jobId: started.jobId, status: 'queued', taskId: started.taskId, estimateUsd: started.estimateUsd, model: modelStr, note: 'Async — poll with hjen_job_wait { jobId }.' });
        } catch (err: any) { return fail({ error: 'submit_failed', message: err?.message || String(err) }); }
      }

      const res = (['480p', '720p', '1080p', '4k'].includes(String(resolution)) ? resolution : '720p') as SeedanceParams['resolution'];
      if (confirm !== true) return ok({ requiresConfirm: true, estimateUsd: estimateVideoUsd(res, dur), note: 'Dry-run (approx). Real cost returns from the poll. Set confirm:true to spend.' });
      const params: SeedanceParams = {
        prompt: p, imagePath: imagePath ? String(imagePath) : null, endImagePath: endImagePath ? String(endImagePath) : null,
        resolution: res, duration: dur, ratio: (['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].includes(String(ratio)) ? ratio : '16:9') as SeedanceParams['ratio'],
        fps: Number(fps) || 24, seed: seed == null ? null : Number(seed), cameraFixed: !!cameraFixed, watermark: !!watermark, audio: !!audio,
      };
      try {
        const started = await startVideoJob(host, { params, project: proj, promptSlug: p });
        return ok({ ok: true, jobId: started.jobId, status: 'queued', taskId: started.taskId, estimateUsd: started.estimateUsd, note: 'Async — poll with hjen_job_wait { jobId }.' });
      } catch (err: any) { return fail({ error: 'submit_failed', message: err?.message || String(err) }); }
    },
  });

  server.tool({
    name: 'hjen_job_get',
    title: 'Get a job',
    description: 'Get the current state of an async job (e.g. a video render) by id.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
    handler: ({ jobId }) => { const j = getJob(String(jobId)); return j ? ok(view(j)) : fail({ error: 'job_not_found', jobId }); },
  });

  server.tool({
    name: 'hjen_job_wait',
    title: 'Wait for a job',
    description: 'Block until an async job reaches a terminal state (succeeded/failed) or the timeout elapses, then return it. Poll again if still running.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' }, timeoutMs: { type: 'number', description: 'Max wait per call (default 120000, max 600000).' } }, required: ['jobId'] },
    handler: async ({ jobId, timeoutMs }) => {
      const t = Math.min(600_000, Math.max(5_000, Number(timeoutMs) || 120_000));
      const j = await waitJob(String(jobId), t);
      return j ? ok(view(j)) : fail({ error: 'job_not_found', jobId });
    },
  });
}
