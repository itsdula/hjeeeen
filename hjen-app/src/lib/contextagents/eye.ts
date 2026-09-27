// Context Eye — renderer client (THIN only).
//
// House law (recipe stays server-side): every function here is one line over
// window.hjen.caEye* → the MAIN process. There is NO scoring, NO prefilter, NO
// VLM prompt in this file — scoreFrame / pickForState / the pixel-fit prompt
// live exclusively in electron/contextAgents.ts. This is a dumb IPC caller.

import type { CAEyePickResult, CAEyeQueryResult, CAEyeConfirmResult, CAVocab } from '../../types/hjen-bridge';

export interface EyePickArgs { register: string; beat: string; energy: string; goal: string }
export interface EyeStateArgs { register: string; beat: string; energy: string; goal?: string }
export interface EyeConfirmArgs extends EyePickArgs { frames: Array<{ id: string; filePath: string }> }

/** Ask the eye: run BOTH the two-stage eye AND the naive baseline for a state. */
export function eyePick(args: EyePickArgs): Promise<CAEyePickResult> {
  return window.hjen.caEyePick(args);
}

/** Frameset path (1/2): the smart search query MAIN builds from the distilled
 *  criteria. The renderer hands it to its own Frameset hunt (like Creative Mind). */
export function eyeQuery(args: EyeStateArgs): Promise<CAEyeQueryResult> {
  return window.hjen.caEyeQuery(args);
}

/** Frameset path (2/2): VLM pixel-fit ranking over frames the renderer harvested
 *  from Frameset. The scoring/prompt recipe stays in MAIN — this only ships pixels. */
export function eyeConfirmFrames(args: EyeConfirmArgs): Promise<CAEyeConfirmResult> {
  return window.hjen.caEyeConfirmFrames(args);
}

/** Log the owner's verdict for one case (accumulation for later reweighting). */
export function eyeJudge(args: {
  state: { register: string; beat: string; energy: string } | null;
  goal: string;
  verdict: 'eye' | 'naive' | 'tie';
  eyeIds: string[];
  naiveIds: string[];
}): Promise<{ ok: boolean; reason?: string; message?: string }> {
  return window.hjen.caEyeJudge(args);
}

/** Corpus + criteria readiness (frame count, which registers have criteria). */
export function eyeStatus(): Promise<{ ok: boolean; criteriaRegisters: string[]; corpusFrames: number }> {
  return window.hjen.caEyeStatus();
}

/** The closed state vocabulary — read from MAIN, never hardcoded in the view. */
export async function eyeVocab(): Promise<CAVocab> {
  const r = await window.hjen.caVocab();
  return { registers: r.registers, beats: r.beats, energies: r.energies };
}
