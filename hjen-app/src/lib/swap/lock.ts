// The lock kit — DERIVED, not tabulated.
//
// Six hand-written rows ("for a light swap use canny+depth, for a character swap
// use depth…") drift the moment a seventh case appears. Two predicates do not:
//
//   canny is admissible exactly when the SILHOUETTE survives.
//   depth is admissible exactly when the FULL-FRAME GEOMETRY survives.
//
// Every case falls out of those two booleans, including multi-change ones the
// table was never written for — identity + place at once yields "geometry does
// not hold, so no full depth", with no new rule.
//
// The plan carries BOOLEANS, and `kit` is only its name. Branching on the name
// is how a prompt ends up citing an "Image 3 depth map" that was never built,
// which is worse than no lock at all: the model obeys a reference that is not
// there by inventing what it must have said.
//
// HONEST CEILING, stated here because it belongs next to the word "lock":
// app/src/lib/openai.ts calls client.images.edit({ model, image, prompt, size,
// quality }) — no mask, no ControlNet, no structural conditioning anywhere in
// this codebase. A canny or depth plate is an extra reference image plus prose
// telling the model to obey it. It is PERSUASION, not conditioning.
// worldkit/finish.py proves it works; it does not make it a lock. Which is
// exactly why every kit below is measured on the bench before it is trusted.
//
// Pure module. Unit-tested.

import type { SlotDecisions, LockPlan, LockKit } from './types';
import { geometryHeld, silhouetteHeld } from './deps';

/** Name a plan from what it actually attaches. One place, so the name can never
 *  disagree with the booleans. */
function kitName(p: { canny: boolean; cannySubjectOnly: boolean; depth: boolean }): LockKit {
  if (p.canny && p.cannySubjectOnly) return 'subject-canny+depth';
  if (p.canny && p.depth) return 'canny+depth';
  if (p.canny) return 'canny';
  if (p.depth) return 'depth';
  return 'none';
}

const plan = (p: Omit<LockPlan, 'kit'>): LockPlan => ({ ...p, kit: kitName(p) });

export function lockPlanFor(d: SlotDecisions): LockPlan {
  // Camera is not swappable here — Camera Angles owns that geometry prompt, and
  // two tools owning it is how ANGLE_PROMPT_TEMPLATE's single-substitution
  // discipline dies. The UI routes before it ever reaches this function; the
  // guard exists so a programmatic caller cannot slip past the routing.
  if (d.camera?.state !== 'keep') {
    return plan({
      canny: false, cannySubjectOnly: false, depth: false, faceAnchor: false,
      reason: 'Moving the camera is not a swap — it is Camera Angles. That tool already owns the geometry.',
    });
  }

  if (silhouetteHeld(d)) {
    return plan({
      canny: true, cannySubjectOnly: false, depth: true, faceAnchor: false,
      reason: 'Nothing about the geometry or the outline moves, so the source’s edge stencil and depth map are both still true — the strongest lock available.',
    });
  }

  if (geometryHeld(d)) {
    // identity and/or wardrobe are moving: depth holds the pose volume, the
    // camera distance and the background layout, while canny would force the OLD
    // outline onto a new body or a new garment. Depth only.
    return plan({
      canny: false, cannySubjectOnly: false, depth: true,
      // when identity is being KEPT while something else moves, the face is the
      // thing most likely to drift — anchor it
      faceAnchor: d.identity?.state === 'keep',
      reason: 'The body and the room stay put but the outline changes, so depth holds the pose and the layout while the silhouette is left free.',
    });
  }

  // The subject holds and the world goes free. The one case that genuinely needs
  // a matte — and one already ships: segment_cli.py's `skin` group accumulates
  // every ADE20k label containing "person", and make_canny.py --mask takes that
  // PNG directly. Full-frame depth must NOT attach here: it would drag the old
  // room's layout into the new place.
  if (d.place?.state !== 'keep' && d.action?.state === 'keep' && d.posture?.state === 'keep') {
    return plan({
      canny: true, cannySubjectOnly: true, depth: false,
      // NEVER anchor a face that is itself being replaced. Attaching the source's
      // face while the change line says "the person is replaced" hands the model
      // two orders that cannot both be obeyed, and it obeys the picture.
      faceAnchor: d.identity?.state === 'keep',
      reason: 'The subject holds and the world goes free, so only the subject’s own outline is stencilled — the area around them is left blank for the new place.',
    });
  }

  // The body moves. Every structural map of the source is now a lie about where
  // things are, so attaching one would fight the change we asked for.
  return plan({
    canny: false, cannySubjectOnly: false, depth: false,
    faceAnchor: d.identity?.state === 'keep',
    reason: 'The body moves, so every structural map of the source is a lie. Identity references only.',
  });
}

/** What survives when the machine cannot build a plate.
 *
 *  A clean Mac has neither torch (depth, matte) nor PIL (canny) —
 *  resolveWorldPython() returns null and all three fail together. The take still
 *  fires, prompt-only, and the UI says why in one sentence. Never a silent
 *  downgrade, never a hard block: a swap the owner cannot run is worse than a
 *  swap that ran weaker and told him so. */
export function degrade(p: LockPlan, have: { canny: boolean; depth: boolean; matte: boolean }): LockPlan {
  const canny = p.canny && have.canny && (p.cannySubjectOnly ? have.matte : true);
  const depth = p.depth && have.depth;
  if (canny === p.canny && depth === p.depth) return p;

  const lost: string[] = [];
  if (p.canny && !canny) lost.push(p.cannySubjectOnly && !have.matte ? 'the subject matte' : 'the edge stencil');
  if (p.depth && !depth) lost.push('the depth map');

  return plan({
    canny, cannySubjectOnly: canny && p.cannySubjectOnly, depth, faceAnchor: p.faceAnchor,
    reason: canny || depth
      ? `${p.reason} ${lost.join(' and ')} could not be built on this machine, so what remains is carrying it alone.`
      : `${p.reason} ${lost.join(' and ')} could not be built on this machine, so this take is prompt-only and will hold the frame less tightly.`,
  });
}
