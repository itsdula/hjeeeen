// PRECISE SHOT RESOLVER — drill INTO one coarse "shot" (really a scene) and
// resolve the several distinct camera shots it actually contains.
//
// The coarse cut detector (ffmpeg scene>0.3) is narrative-level: it can label a
// 15s span as one "shot" when that span holds many real cuts it missed (soft
// cuts, similar-frame cuts, quick inserts). This resolver is the fine pass:
//   1. densely sample the window (main: breakdown-dense-frames) + get low-threshold
//      cut CANDIDATES from the signal,
//   2. hand the model the dense frames + candidates and have it VERIFY + UNDERSTAND
//      the real shots — a CUT (new framing/angle/subject) vs a camera MOVE within
//      one take (not a cut). Signal alone can't tell these apart; the model can.
//
// Genericity: nothing ad-specific. Output is a precise per-shot list for the window.

import { llmForTask } from '../models/registry';

export interface ResolvedShot {
  tcIn: number; tcOut: number;
  size?: string; angle?: string; subject?: string; what: string;
  frameId: string;
}
export interface ResolveResult {
  ok: boolean; shots: ResolvedShot[]; frameCount: number; candidates: number[]; message?: string;
}

const clamp = (s: any): string => String(s ?? '').trim();
function parseJsonLoose(text: string): any {
  const t = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch { /* slice */ }
  const m = t.match(/[{[][\s\S]*[}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw new Error('model did not return valid JSON');
}
/** Evenly subsample to at most `cap` frames — a 15s window at 8fps is ~120 images;
 *  ~48 keeps sub-0.4s resolution (cuts still visible) without a huge call. */
function thin<T>(arr: T[], cap: number): T[] {
  if (arr.length <= cap) return arr;
  const step = arr.length / cap;
  return Array.from({ length: cap }, (_v, i) => arr[Math.min(arr.length - 1, Math.floor(i * step))]);
}

export async function resolveSceneShots(
  slug: string, tcIn: number, tcOut: number, opts?: { fps?: number; maxImages?: number },
): Promise<ResolveResult> {
  const span = Math.max(0.4, tcOut - tcIn);
  // long windows → fewer fps so the frame count stays sane before capping
  const fps = opts?.fps ?? (span > 10 ? 4 : span > 5 ? 6 : 8);
  const dense = await window.hjen.breakdownDenseFrames({ slug, tcIn, tcOut, fps });
  if (!dense.ok || !dense.frames?.length) {
    return { ok: false, shots: [], frameCount: 0, candidates: [], message: dense.message || 'no dense frames' };
  }
  const candidates = dense.candidates || [];
  const frames = thin(dense.frames, opts?.maxImages ?? 48);
  const list = frames.map(f => `${f.id}@${f.t.toFixed(2)}s`).join(', ');
  const prompt = `These are CONSECUTIVE frames from ONE scene of an ad — window ${tcIn.toFixed(1)}s–${tcOut.toFixed(1)}s, in order. They form a single narrative moment but likely contain SEVERAL distinct camera SHOTS (cuts).
Segment them into the REAL camera shots. A NEW shot = a hard CUT: a change of framing/size, angle, lens, subject, or location. A camera MOVE (push · pan · handheld) or the SUBJECT moving within one continuous take is NOT a new shot — keep those as one shot.${candidates.length ? `\nSignal analysis flagged possible cuts near: ${candidates.map(c => c.toFixed(2) + 's').join(', ')} — VERIFY each (some are real cuts, some are only motion), and add any real cut the signal missed.` : ''}
FRAMES (id@seconds, in order): ${list}
Return STRICT JSON only, no code fences: {"shots":[{"startFrame":"dNNN","size":"WS|MS|CU|ECU|OTS","angle":"eye|high|low|dutch|overhead","subject":"who/what is on screen","what":"one line — what this shot shows"}]}. startFrame = the FIRST frame of each shot, in timecode order. Do NOT over-split on motion; do NOT under-split across real cuts. Be precise and honest.`;
  const res = await llmForTask('ad-breakdown', {
    system: 'You are a precise shot-boundary analyst. You reliably distinguish a CUT (a new camera shot) from a camera move within one continuous take. You return strict JSON only.',
    prompt, maxTokens: 6000,
    imagePaths: frames.map(f => f.abs),
  });
  if (!res.ok || !res.text) return { ok: false, shots: [], frameCount: frames.length, candidates, message: res.message || res.reason || 'resolve call failed' };
  let j: any;
  try { j = parseJsonLoose(res.text); } catch { return { ok: false, shots: [], frameCount: frames.length, candidates, message: 'model did not return valid JSON' }; }
  const byId = new Map(frames.map(f => [f.id, f.t]));
  const starts = (Array.isArray(j?.shots) ? j.shots : [])
    .map((s: any) => ({
      frameId: clamp(s?.startFrame),
      t: byId.get(clamp(s?.startFrame)),
      size: clamp(s?.size), angle: clamp(s?.angle), subject: clamp(s?.subject), what: clamp(s?.what),
    }))
    .filter((s: any) => s.t != null)
    .sort((a: any, b: any) => a.t - b.t);
  const shots: ResolvedShot[] = starts.map((s: any, i: number) => ({
    tcIn: s.t, tcOut: i + 1 < starts.length ? starts[i + 1].t : tcOut,
    size: s.size || undefined, angle: s.angle || undefined, subject: s.subject || undefined,
    what: s.what || '', frameId: s.frameId,
  }));
  return { ok: true, shots, frameCount: frames.length, candidates };
}
