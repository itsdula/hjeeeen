// Building the structure plates — and degrading honestly when they cannot be.
//
// Three sidecars already ship and none of them was written for this tool:
//   hjen:world-depth       Depth-Anything-V2 → a depth map (torch)
//   hjen:emulsion-segment  Segformer ADE20k → a person matte (torch)
//   hjen:swap-canny        make_canny.py → an edge stencil (PIL only)
//
// The matte is the interesting one. segment_cli.py's `skin` group accumulates
// every ADE20k label containing "person", so what it returns is a person mask by
// accident rather than by design — feathered, b0-small, and a few pixels loose at
// the boundary. make_canny.py --mask takes exactly that PNG. So a subject-only
// stencil exists today with no SAM-2 and no Python edits, at maybe seventy per
// cent of the quality a real matte would give. Good enough to try; not good
// enough to promise, which is why the UI states which plates a take actually got.
//
// EVERY FAILURE HERE IS NON-FATAL. resolveWorldPython() returns null on a clean
// Mac and all three sidecars fail together. The take still fires, prompt-only,
// and the reason travels with it. A swap the owner cannot run is worse than a
// swap that ran weaker and said so.

import type { LockPlan } from './types';
import { degrade } from './lock';

export interface Plates {
  cannyPath?: string;
  depthPath?: string;
  /** The plan after degrading to what this machine could actually build. Its
   *  `reason` is what the UI shows, so it always explains the take it produced —
   *  never the take it intended. */
  plan: LockPlan;
}

/** Strip a hjen-file:// URL back to an absolute path. worldDepth answers in URLs
 *  because its caller paints them; a reference needs the path on disk. */
const fromUrl = (u: string): string => {
  try { return decodeURI(String(u).replace(/^hjen-file:\/\//, '')); } catch { return ''; }
};

export async function buildPlates(sourcePath: string, plan: LockPlan): Promise<Plates> {
  const have = { canny: false, depth: false, matte: false };
  let cannyPath: string | undefined;
  let depthPath: string | undefined;
  let maskPath: string | undefined;

  // The matte first — the subject stencil needs it, so a canny built before it
  // would have to be thrown away and built again.
  if (plan.canny && plan.cannySubjectOnly) {
    try {
      const seg = await window.hjen.emulsionSegment({ imagePath: sourcePath });
      if (seg?.ok && seg.skin) { maskPath = seg.skin; have.matte = true; }
    } catch { /* degrade */ }
  }

  if (plan.canny && (!plan.cannySubjectOnly || have.matte)) {
    try {
      const c = await window.hjen.swapCanny({ imagePath: sourcePath, maskPath });
      if (c?.ok && c.cannyPath) { cannyPath = c.cannyPath; have.canny = true; }
    } catch { /* degrade */ }
  }

  if (plan.depth) {
    try {
      const d = await window.hjen.worldDepth({ imagePath: sourcePath });
      if (d?.ok) {
        const p = fromUrl(d.depthUrl);
        if (p) { depthPath = p; have.depth = true; }
      }
    } catch { /* degrade */ }
  }

  const finalPlan = degrade(plan, have);
  return {
    // A plate the final plan dropped must not travel: orderSwapRefs would attach
    // it and the prompt would cite an Image whose block was never written.
    cannyPath: finalPlan.canny ? cannyPath : undefined,
    depthPath: finalPlan.depth ? depthPath : undefined,
    plan: finalPlan,
  };
}
