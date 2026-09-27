// Zero-dep gpt-image-2 (OpenAI Images REST via global fetch + FormData — no SDK,
// no install). Ported from server/src/providers/openai.js. Key stays in the Host
// (env or the app's openai_key.txt); it never crosses the wire to the agent.

import fs from 'node:fs';
import path from 'node:path';
import type { Host } from '../host.js';

const OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-image-2';

function mimeOf(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}
function isSafety(text: string): boolean {
  const h = (text || '').toLowerCase();
  return h.includes('safety system') || h.includes('moderation') || h.includes('content_policy') || h.includes('content policy') || h.includes('rejected by');
}

export interface MakeImageParams {
  prompt: string;
  size: string;                 // "WxH"
  quality?: 'low' | 'medium' | 'high';
  modelId?: string;
  referencePaths?: string[];    // → images/edits mode
}

export async function makeImage(host: Host, params: MakeImageParams): Promise<{ b64: string; size: string; model: string }> {
  const key = host.getKey('openai');
  if (!key) throw new Error('OPENAI_API_KEY not configured (env or {userData}/openai_key.txt).');
  const model = params.modelId ?? DEFAULT_MODEL;
  const quality = params.quality ?? 'high';
  const refs = params.referencePaths ?? [];
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };

  let res: Response;
  if (refs.length > 0) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', params.prompt);
    form.append('size', params.size);
    form.append('quality', quality);
    form.append('n', '1');
    for (const p of refs) {
      if (!fs.existsSync(p)) throw new Error(`Reference image could not be read: ${p}`);
      const buf = fs.readFileSync(p);
      form.append('image[]', new Blob([new Uint8Array(buf)], { type: mimeOf(p) }), path.basename(p) || 'ref.png');
    }
    res = await fetch(`${OPENAI_BASE}/images/edits`, { method: 'POST', headers, body: form });
  } else {
    res = await fetch(`${OPENAI_BASE}/images/generations`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: params.prompt, size: params.size, quality, n: 1 }),
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    if (isSafety(errText)) throw new Error('SAFETY: the safety system refused this request. Simplify the description or refine first.');
    throw new Error(`OpenAI ${refs.length ? 'images.edits' : 'images.generations'} ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned an empty payload (no b64_json).');
  return { b64, size: params.size, model };
}

export function estimateImageUsd(quality: 'low' | 'medium' | 'high'): number {
  return quality === 'high' ? 0.13 : quality === 'medium' ? 0.07 : 0.03;
}
