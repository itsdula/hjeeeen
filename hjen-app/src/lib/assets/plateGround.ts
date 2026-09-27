// THE PLATE GROUND — one constant, one prompt fragment, one place.
//
// Before this module the same idea existed three different ways in this repo:
//
//   #808080  app/src/store.ts (breakdown identity refs) + lib/breakdown/entityResolver.ts
//   #9A9A9A  ~/.claude/skills/saudi-art-translator/scripts/make_face_ref.py
//   #FFFFFF  app/src/lib/castSchema.ts (the cast-card "sheet" template) and make_flatlay.py
//
// ⚠ HONEST STATUS OF THE CLAIM. "Neutral grey outperforms white and black" is
// asserted in our own code comments, was originally a Higgsfield claim ("after
// tons of testing"), and is flagged as UNVERIFIED in our own
// STUDY/milestones/02_kit-studio.md honest-risks. No A/B exists in this repo.
// The stated rationale — a mid-grey stops white bleeding a halo into the
// subject, keeps both highlight and shadow contrast on the plate, and gives the
// vision encoder a true zero point — is plausible and consistent, not measured.
//
// So: this module makes the value SWAPPABLE and single-sourced, precisely so the
// A/B can be run once the factories exist. Do not spread the hex again.
//
// MIRROR: server/src/assets/compose.js carries a byte-identical copy of
// GROUND_HEX and groundClause(). The recipe lives on the server; this file is
// the offline path (owner's machine only). Any edit here must be mirrored there.

/** The neutral studio ground every reference plate is built on. */
export const GROUND_HEX = '#808080';

/** Candidates the A/B will compare. Not used at runtime — kept here so the
 *  test has one honest list and nobody re-invents a fourth value. */
export const GROUND_CANDIDATES = ['#808080', '#7f7f7f', '#9A9A9A', '#FFFFFF'] as const;

/** RGB triple of GROUND_HEX, spelled out for the prompt. Models follow a hex
 *  plus its decimal reading more reliably than a hex alone. */
export function groundRgb(hex: string = GROUND_HEX): string {
  const h = hex.replace('#', '');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return `RGB ${n(0)},${n(2)},${n(4)}`;
}

/** The background clause, identical in every asset recipe.
 *
 *  "Seamless" and "no gradient" are load-bearing: a visible corner, floor seam
 *  or horizon gives the model a spatial cue it will try to preserve into the
 *  next frame, which is the opposite of what a reference plate is for. */
export function groundClause(hex: string = GROUND_HEX): string {
  return `Background: a solid, flat, matte neutral grey (${hex}, ${groundRgb(hex)}) — `
    + `a seamless infinity sweep with no visible corner, floor seam, horizon or gradient. `
    + `No environment, no set dressing, no text.`;
}

/** The lighting clause that goes with it. Flat and even so true depth reads;
 *  dramatic key or rim light bakes a lighting decision into an asset that has
 *  to survive every lighting decision downstream. */
export function flatLightClause(): string {
  return `Lighting: flat, even, balanced studio light — broad soft key from the front-upper, `
    + `gentle wraparound fill, no dramatic shadow, no rim light, no blown speculars. `
    + `Neutral white balance around 5500K.`;
}

/** Objects need a contact shadow or they read as a cut-out pasted on grey —
 *  and a flat cut-out animates like 2D card in any video model. Characters do
 *  NOT get this on the face plate (there is no ground plane in a head-and-
 *  shoulders crop); they get it under the feet on a full-body sheet. */
export function contactShadowClause(): string {
  return `A soft contact shadow sits directly beneath the subject, anchoring it to the ground plane. `
    + `Matte surfaces read as matte; real material taper and thickness are visible.`;
}
