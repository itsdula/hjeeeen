// The Eye — renderer-side client. A DUMB TERMINAL, by house law.
//
// There is NO prompt, NO axis discipline, NO validation and NO scoring in this
// file. It sends an image path over IPC and renders whatever comes back. The
// recipe (EYE_READ_SYS) lives in app/electron/eye.ts and never crosses the
// bridge — `grep -r EYE_READ_SYS app/src/` must return nothing.

import type { EyeRead, EyeGoldenEntry, EyeReadResult, EyeStatusResult, EyeAxisKey } from './types';

/** Read one frame. `model` overrides the eye-read task default for this call —
 *  the bench uses it to run two models on the same image side by side. */
export async function eyeRead(args: { imagePath: string; note?: string; model?: string }): Promise<EyeReadResult & { thin?: EyeAxisKey[] }> {
  try {
    const r = await window.hjen.eyeRead(args);
    return {
      ok: !!r?.ok,
      reason: r?.reason,
      message: r?.message,
      read: r?.read as EyeRead | undefined,
      thin: (r?.thin ?? []) as EyeAxisKey[],
      model: r?.model,
      imageHash: r?.imageHash,
      ms: r?.ms,
    };
  } catch (e: any) {
    return { ok: false, reason: 'bridge_failed', message: String(e?.message || e).slice(0, 200) };
  }
}

/** Sign one graded read into the golden set. */
export async function eyeGoldenWrite(entry: Omit<EyeGoldenEntry, 'ts'>): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await window.hjen.eyeGoldenWrite({ entry });
    return { ok: !!r?.ok, message: r?.message };
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e).slice(0, 200) };
  }
}

export async function eyeStatus(): Promise<EyeStatusResult> {
  try {
    const r = await window.hjen.eyeStatus();
    return { ok: !!r?.ok, root: r?.root, golden: r?.golden, gradedAxes: r?.gradedAxes };
  } catch {
    return { ok: false };
  }
}
