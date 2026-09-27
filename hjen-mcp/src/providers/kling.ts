// Zero-dep Kling video (Kuaishou REST via global fetch). Sister of seedance.ts.
// Ported from electron/main.ts hjen:kling-submit / hjen:kling-poll. Two calls:
// submit → { taskId, videoType }, poll → normalised { status, videoUrl, ... }.
// Auth is a static API Key (Bearer). Images are RAW base64 (no data: prefix).

import fs from 'node:fs';
import type { Host } from '../host.js';

const klingBase = () => (process.env.KLING_BASE_URL || 'https://api-singapore.klingai.com').replace(/\/$/, '');

// Kling wants RAW base64 (no data-uri prefix) or a plain URL.
function toRawBase64(absPath: string): string {
  if (/^https?:/.test(absPath)) return absPath;
  if (/^data:/.test(absPath)) return absPath.replace(/^data:[^,]+,/, '');
  if (!fs.existsSync(absPath)) throw new Error(`Image not found: ${absPath}`);
  return fs.readFileSync(absPath).toString('base64');
}
function buildCamera(type: string, config?: Record<string, number> | null): any {
  if (type !== 'simple') return { type };
  const c = config || {};
  return { type: 'simple', config: { horizontal: c.horizontal ?? 0, vertical: c.vertical ?? 0, pan: c.pan ?? 0, tilt: c.tilt ?? 0, roll: c.roll ?? 0, zoom: c.zoom ?? 0 } };
}

export interface KlingVideoParams {
  prompt: string;
  negativePrompt?: string;
  imagePath?: string | null;
  endImagePath?: string | null;
  modelName: string;                       // 'kling-v3', 'kling-v2-6', ...
  mode?: 'std' | 'pro' | '4k';
  aspectRatio?: '16:9' | '9:16' | '1:1';
  duration?: number;
  cfgScale?: number | null;
  cameraType?: string | null;
  cameraConfig?: Record<string, number> | null;
  sound?: boolean;
  watermark?: boolean;
  externalTaskId?: string;
}

export async function submitKling(host: Host, params: KlingVideoParams): Promise<{ taskId: string; model: string; promptFull: string; videoType: 'text2video' | 'image2video' }> {
  const key = host.getKey('kling');
  if (!key) throw new Error('KLING_API_KEY not configured (env or {userData}/kling_key.txt).');
  const isImage = !!params.imagePath;
  const videoType: 'text2video' | 'image2video' = isImage ? 'image2video' : 'text2video';
  const modelName = (params.modelName || 'kling-v3').trim();

  const body: any = { model_name: modelName, prompt: (params.prompt || '').trim() };
  if (params.negativePrompt?.trim()) body.negative_prompt = params.negativePrompt.trim();
  if (params.mode) body.mode = params.mode;
  if (params.duration != null) body.duration = String(params.duration);
  if (params.cfgScale != null && !/^kling-v2/.test(modelName)) body.cfg_scale = params.cfgScale;
  if (params.sound != null) body.sound = params.sound ? 'on' : 'off';
  if (params.watermark != null) body.watermark_info = { enabled: !!params.watermark };
  if (params.externalTaskId) body.external_task_id = params.externalTaskId;
  if (isImage) {
    body.image = toRawBase64(params.imagePath!);
    if (params.endImagePath) body.image_tail = toRawBase64(params.endImagePath);
    if (!params.endImagePath && params.cameraType) body.camera_control = buildCamera(params.cameraType, params.cameraConfig);
  } else {
    if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
    if (params.cameraType) body.camera_control = buildCamera(params.cameraType, params.cameraConfig);
  }

  const url = `${klingBase()}/v1/videos/${videoType}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Kling submit ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  if (data?.code !== 0 && data?.code !== '0') throw new Error(`Kling submit error ${data?.code}: ${data?.message || '(no message)'}`);
  const taskId = data?.data?.task_id;
  if (!taskId) throw new Error(`Kling submit returned no task id. Raw: ${JSON.stringify(data).slice(0, 300)}`);
  return { taskId, model: modelName, promptFull: body.prompt, videoType };
}

export async function pollKling(host: Host, taskId: string, videoType: 'text2video' | 'image2video'): Promise<{ status: string; videoUrl: string | null; usage: any; error: string | null }> {
  const key = host.getKey('kling');
  if (!key) throw new Error('KLING_API_KEY not configured.');
  const res = await fetch(`${klingBase()}/v1/videos/${videoType}/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Kling poll ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  const d = data?.data ?? {};
  const raw: string = d?.task_status ?? 'unknown';
  const status = raw === 'succeed' ? 'succeeded' : raw === 'failed' ? 'failed' : raw === 'submitted' ? 'queued' : 'running';
  return {
    status,
    videoUrl: d?.task_result?.videos?.[0]?.url ?? null,
    usage: { unit_deduction: d?.final_unit_deduction ?? null, balance: d?.final_balance_deduction ?? null },
    error: raw === 'failed' ? (d?.task_status_msg ?? 'Kling task failed') : null,
  };
}

/** Rough pre-flight estimate ($/second × duration). Confirm against console. */
export function estimateKlingUsd(modelName: string, mode: string, duration: number, audio: boolean): number {
  // Representative $/second (1080P/pro). Full matrix lives in the app's pricing.ts.
  const base: Record<string, number> = {
    'kling-3.0-turbo': 0.14, 'kling-v3': 0.112, 'kling-v3-omni': 0.112,
    'kling-video-o1': 0.112, 'kling-v2-6': 0.098, 'kling-v2-5-turbo': 0.084,
  };
  const perSec = (base[modelName] ?? 0.112) * (mode === '4k' ? 3.75 : mode === 'std' ? 0.75 : 1) * (audio ? 1.25 : 1);
  return Number((perSec * (duration || 5)).toFixed(2));
}
