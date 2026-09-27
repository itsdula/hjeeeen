// Zero-dep Seedance 2.0 (BytePlus ModelArk REST via global fetch). Ported from
// electron/main.ts seedance-submit / seedance-poll. Two calls: submit → taskId,
// poll → status/video_url. Async — the job registry drives the poll loop.

import fs from 'node:fs';
import path from 'node:path';
import type { Host } from '../host.js';

const DEFAULT_MODEL = 'dreamina-seedance-2-0-260128';
const arkBase = () => (process.env.ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '');

function dataUri(absPath: string): string {
  if (/^(https?:|data:)/.test(absPath)) return absPath;
  if (!fs.existsSync(absPath)) throw new Error(`Image not found: ${absPath}`);
  const ext = path.extname(absPath).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(absPath).toString('base64')}`;
}

export interface SeedanceParams {
  prompt: string;
  imagePath?: string | null;
  endImagePath?: string | null;
  resolution: '480p' | '720p' | '1080p' | '4k';
  duration: number;
  ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  fps: number;
  seed?: number | null;
  cameraFixed?: boolean;
  watermark?: boolean;
  audio?: boolean;
  modelId?: string;
}

function buildPromptString(p: SeedanceParams): string {
  const parts = [p.prompt.trim(), `--resolution ${p.resolution}`, `--duration ${p.duration}`, `--ratio ${p.ratio}`, `--fps ${p.fps}`];
  if (p.seed != null) parts.push(`--seed ${p.seed}`);
  if (p.cameraFixed) parts.push('--camerafixed true');
  if (!p.watermark) parts.push('--watermark false');
  return parts.join(' ');
}

export async function submitSeedance(host: Host, params: SeedanceParams): Promise<{ taskId: string; model: string; promptFull: string }> {
  const key = host.getKey('ark');
  if (!key) throw new Error('ARK_API_KEY not configured (env or {userData}/ark_key.txt).');
  const promptFull = buildPromptString(params);
  const content: any[] = [{ type: 'text', text: promptFull }];
  if (params.imagePath) content.push({ type: 'image_url', image_url: { url: dataUri(params.imagePath) }, role: 'first_frame' });
  if (params.endImagePath) content.push({ type: 'image_url', image_url: { url: dataUri(params.endImagePath) }, role: 'last_frame' });
  const model = (params.modelId || process.env.SEEDANCE_MODEL || DEFAULT_MODEL).trim();

  const url = `${arkBase()}/contents/generations/tasks`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, content, generate_audio: !!params.audio }),
  });
  if (!res.ok) throw new Error(`Seedance submit ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  const taskId = data?.id ?? data?.task_id;
  if (!taskId) throw new Error(`Seedance submit returned no task id. Raw: ${JSON.stringify(data).slice(0, 300)}`);
  return { taskId, model, promptFull };
}

export async function pollSeedance(host: Host, taskId: string): Promise<{ status: string; videoUrl: string | null; usage: any; error: string | null }> {
  const key = host.getKey('ark');
  if (!key) throw new Error('ARK_API_KEY not configured.');
  const res = await fetch(`${arkBase()}/contents/generations/tasks/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Seedance poll ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  return {
    status: data?.status ?? 'unknown',
    videoUrl: data?.content?.video_url ?? data?.video_url ?? null,
    usage: data?.usage ?? null,
    error: data?.error?.message ?? data?.error ?? null,
  };
}

/** Rough pre-flight estimate (real cost comes back in the poll `usage`). */
export function estimateVideoUsd(resolution: string, duration: number): number {
  const perSec: Record<string, number> = { '480p': 0.1, '720p': 0.2, '1080p': 0.45, '4k': 1.1 };
  return Number(((perSec[resolution] ?? 0.3) * (duration || 5)).toFixed(2));
}
