// Reference ordering — derived from the engine's own law, never a second copy.
//
// runFrameGeneration (lib/frameGen.ts) and its byte-for-byte server twin sort
// layers into buckets: composition-parentless → character-parentless → nested
// children → everything else, preserving array order INSIDE each bucket. That is
// the only ordering law in the house and it stays that way. This module does not
// re-sort; it chooses categories so the existing sort produces the order the
// prompt cites.
//
// The order it produces is worldkit/generate.py's proven contract, which the
// finishing pass has been shipping for months:
//   IMAGE 1 = the source · IMAGE 2 = canny · IMAGE 3 = depth · IMAGE 4..N = refs
//
// ONE PREDICATE DRIVES TWO THINGS. buildPrompt fires its COMPOSITION LOCK clause
// for ANY composition layer — "same camera angle, same lens perspective, same
// horizon line height, same subject position within the frame, same scale… only
// the subject's identity, wardrobe, and the location/period dressing may differ."
// For a character / wardrobe / place / light / colour / medium / time swap that
// is exactly right, and free. For an ACTION or POSTURE swap it is exactly wrong:
// the body must be allowed to move inside the frame. So the source ships as
// `general` in that case, the clause never fires, and the template's own CAMERA
// preserve line carries the framing — it says "the same framing rectangle", not
// "the same subject position", which a moving body can honour.
//
// Which means: plates attach exactly when the source is a composition layer.
// Both facts, one predicate, no way for them to disagree.
//
// Pure module. Unit-tested.

import type { Layer } from '../../store';
import type { LibCategory } from '../../types/hjen-bridge';
import type { SlotDecisions, LockPlan, Requirement, SwapRef } from './types';
import { slotLabel } from './types';

/** gpt-image-2 takes ~14–16 reference images. Source + 2 plates + the face
 *  anchor leaves comfortable room for ten requirement references, which is far
 *  more than a coherent swap ever needs. */
export const MAX_SLOT_REFS = 10;

function requirementRefPaths(requirement: Requirement): string[] {
  return [...new Set([
    ...(Array.isArray(requirement.refPaths) ? requirement.refPaths : []),
    ...(requirement.refPath ? [requirement.refPath] : []),
  ].filter(Boolean))];
}

export interface SwapRefPaths {
  /** Image 1. The source on round 1; the previous take on every later round. */
  sourcePath: string;
  cannyPath?: string;
  depthPath?: string;
  /** A tight crop of the source subject's face, made renderer-side. */
  facePath?: string;
}

/** True when the body itself is moving — the one case where the source must NOT
 *  be a composition layer, because COMPOSITION LOCK would pin the body in place
 *  and fight the very change being asked for. */
export function bodyMoves(d: SlotDecisions): boolean {
  return d.action?.state === 'swap' || d.posture?.state === 'swap';
}

export function orderSwapRefs(
  decisions: SlotDecisions,
  plan: LockPlan,
  requirements: Requirement[],
  paths: SwapRefPaths,
): SwapRef[] {
  const refs: SwapRef[] = [];
  const sourceIsComposition = !bodyMoves(decisions);

  refs.push({
    role: 'source',
    filePath: paths.sourcePath,
    category: sourceIsComposition ? 'composition' : 'general',
    label: 'the source frame',
  });

  // Plates ride in the composition bucket, in array order, so they land as
  // Image 2 and Image 3. When the source is not a composition layer there is
  // nothing true for them to lock — lockPlanFor already returns no plates in
  // that case, and this is the belt to its braces.
  if (sourceIsComposition) {
    if (plan.canny && paths.cannyPath) {
      refs.push({
        role: 'canny', filePath: paths.cannyPath, category: 'composition',
        label: plan.cannySubjectOnly ? 'subject edge stencil' : 'edge stencil',
      });
    }
    if (plan.depth && paths.depthPath) {
      refs.push({ role: 'depth', filePath: paths.depthPath, category: 'composition', label: 'depth map' });
    }
  }

  const ordered = [...requirements].sort((a, b) => a.priority - b.priority);
  let slotRefs = 0;

  // Every identity image goes in the `character` bucket so the engine's own
  // sort puts the complete identity set immediately after the structure block.
  for (const r of ordered.filter(requirement => requirement.slot === 'identity')) {
    const pathsForRequirement = requirementRefPaths(r);
    for (const [index, filePath] of pathsForRequirement.entries()) {
      if (slotRefs >= MAX_SLOT_REFS) break;
      slotRefs++;
      refs.push({
        role: 'slot', slot: 'identity', requirementId: r.id, filePath,
        category: 'character',
        label: `${r.id} · identity reference ${index + 1}/${pathsForRequirement.length}`,
      });
    }
  }

  // The face anchor is the source's OWN face, attached when identity is being
  // kept while something else moves — the face is what drifts first on any edit.
  if (plan.faceAnchor && paths.facePath) {
    refs.push({ role: 'face', filePath: paths.facePath, category: 'general', label: 'the face to keep' });
  }

  // Every other requirement image, in the ledger's priority order, so the
  // prompt's "Image N" citations follow the same numbering the user sees.
  for (const r of ordered) {
    if (r.slot === 'identity') continue;
    const pathsForRequirement = requirementRefPaths(r);
    for (const [index, filePath] of pathsForRequirement.entries()) {
      if (slotRefs >= MAX_SLOT_REFS) break;
      slotRefs++;
      refs.push({
        role: 'slot', slot: r.slot, requirementId: r.id, filePath, category: 'general',
        label: `${r.id} · ${slotLabel(r.slot).toLowerCase()} reference ${index + 1}/${pathsForRequirement.length}`,
      });
    }
    if (slotRefs >= MAX_SLOT_REFS) break;
  }

  return refs;
}

/** The 1-based Image number each ref will carry in the prompt. Computed from the
 *  ordered array at build time and passed to the MAIN-side composer, so no
 *  builder ever hardcodes "Image 2" and no caller can reorder behind its back. */
export function imageIndex(refs: SwapRef[], role: SwapRef['role'], slot?: string): number | undefined {
  const i = refs.findIndex(r => r.role === role && (slot === undefined || r.slot === slot));
  return i < 0 ? undefined : i + 1;
}

/** Hand the ordered refs to the frames engine as Layers. Categories are already
 *  decided above; this only puts them in the shape runFrameGeneration reads. */
export function refsToLayers(refs: SwapRef[], runId: string): Layer[] {
  return refs.map((r, i) => ({
    id: `swap-${runId}-${i}`,
    assetId: `swap-${runId}-${i}`,
    category: r.category as LibCategory,
    name: r.label,
    thumbPath: r.filePath,
    filePath: r.filePath,
  }));
}
