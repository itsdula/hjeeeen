// The Swap — renderer-side client. A DUMB TERMINAL, by house law.
//
// There is NO prompt, NO change contract, NO acceptance test and NO verdict
// logic in this file. It posts shapes over IPC and renders whatever comes back.
// The recipe lives in app/electron/swap.ts and never crosses the bridge.
//
// The one thing worth knowing here: `prompt` comes back OPAQUE. It goes straight
// into Selections.prompt and is never parsed, reworded or displayed pre-make.

import type {
  FrameSlots, SlotDecisions, Requirement, SwapRef, Conflict,
  SwapSlotsResult, SwapConsequenceResult, SwapComposeResult, SwapVerifyResult,
  SwapGoldenEntry, SlotKey, VerdictState,
} from './types';
import type { EyeRead } from '../eye/types';

const fail = (e: any) => String(e?.message || e).slice(0, 200);

/** Split the person the Eye fused, and read the wardrobe it never looked at.
 *  Needs the EyeRead: the verbatim axes are copied from it rather than re-read. */
export async function swapSlots(args: { imagePath: string; read: EyeRead; model?: string }): Promise<SwapSlotsResult> {
  try {
    const r = await window.hjen.swapSlots(args);
    return {
      ok: !!r?.ok, reason: r?.reason, message: r?.message,
      slots: r?.slots as FrameSlots | undefined,
      thin: (r?.thin ?? []) as SlotKey[],
      model: r?.model, ms: r?.ms,
    };
  } catch (e: any) {
    return { ok: false, reason: 'bridge_failed', message: fail(e) };
  }
}

/** What the changes drag with them. One batched call for every followed slot. */
export async function swapConsequence(args: { slots: FrameSlots; decisions: SlotDecisions; model?: string }): Promise<SwapConsequenceResult> {
  try {
    const r = await window.hjen.swapConsequence(args);
    return { ok: !!r?.ok, message: r?.message, follows: r?.follows, model: r?.model };
  } catch (e: any) {
    return { ok: false, message: fail(e) };
  }
}

/** Write the acceptance tests and read the changes as a SET, so a contradiction
 *  reaches the owner before he spends a make rather than after. Also flags asks
 *  too vague to test — a vague requirement that quietly acquires a specific test
 *  is worse than one that gets flagged, because the machine then enforces
 *  something he never said. */
export async function swapPlan(args: { slots: FrameSlots; requirements: Requirement[]; model?: string }): Promise<{
  ok: boolean; message?: string;
  tests: Record<string, string>; untestable: string[]; conflicts: Conflict[];
}> {
  try {
    const r = await window.hjen.swapPlan(args);
    return {
      ok: !!r?.ok, message: r?.message,
      tests: r?.tests ?? {}, untestable: r?.untestable ?? [],
      conflicts: (r?.conflicts ?? []) as Conflict[],
    };
  } catch (e: any) {
    return { ok: false, message: fail(e), tests: {}, untestable: [], conflicts: [] };
  }
}

/** Write the acceptance tests (round 1 only) and build the make prompt.
 *  Requirements that arrive with tests already written keep them — a test that
 *  drifted between rounds would make the verdict trail meaningless. */
export async function swapCompose(args: {
  slots: FrameSlots;
  decisions: SlotDecisions;
  requirements: Requirement[];
  refs: SwapRef[];
  preserveKeys: SlotKey[];
  escalate?: string[];
  round?: number;
  subjectOnlyCanny?: boolean;
  model?: string;
}): Promise<SwapComposeResult & { conflicts?: Conflict[] }> {
  try {
    const r = await window.hjen.swapCompose(args);
    return {
      ok: !!r?.ok, message: r?.message, prompt: r?.prompt,
      requirements: r?.requirements as Requirement[] | undefined,
      refs: args.refs,
      untestable: r?.untestable ?? [],
      conflicts: (r?.conflicts ?? []) as Conflict[],
    };
  } catch (e: any) {
    return { ok: false, message: fail(e) };
  }
}

/** Did each requirement land. Judged on the take ALONE — the verifier never sees
 *  the source, which is what stops it from grading by comparison and going soft. */
export async function swapVerify(args: { takePath: string; requirements: Requirement[]; model?: string }): Promise<SwapVerifyResult> {
  try {
    const r = await window.hjen.swapVerify(args);
    // The bridge is untyped by design; narrow at the boundary. A state this side
    // does not recognise is counted as MISSED, never as landed — the same law
    // MAIN applies to a verdict the checker dropped. Silence is not success.
    const verdicts = (r?.verdicts ?? []).map(v => ({
      id: String(v?.id ?? ''),
      state: (v?.state === 'landed' || v?.state === 'partial' ? v.state : 'missed') as VerdictState,
      evidence: String(v?.evidence ?? ''),
    }));
    return { ok: !!r?.ok, message: r?.message, verdicts, model: r?.model };
  } catch (e: any) {
    return { ok: false, message: fail(e) };
  }
}

export async function swapGoldenWrite(entry: Omit<SwapGoldenEntry, 'ts'>): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await window.hjen.swapGoldenWrite({ entry });
    return { ok: !!r?.ok, message: r?.message };
  } catch (e: any) {
    return { ok: false, message: fail(e) };
  }
}

export async function swapStatus(): Promise<{ ok: boolean; root?: string; golden?: number; judged?: number; agreed?: number }> {
  try {
    const r = await window.hjen.swapStatus();
    return { ok: !!r?.ok, root: r?.root, golden: r?.golden, judged: r?.judged, agreed: r?.agreed };
  } catch {
    return { ok: false };
  }
}
