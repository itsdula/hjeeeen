// The field dependency graph — what a change DRAGS with it.
//
// WHY THIS IS CODE AND NOT A PROMPT. Which slots follow which is a fact about
// photography, not a judgement: the hour rewrites the light, the verb owns the
// body. Encoding it means the UI can go amber the instant a toggle flips, with
// no API call and no wait. What a followed slot BECOMES is a judgement, and that
// is the consequence pass (MAIN-side). Edges here, values there.
//
// The failure this prevents: swap `time → night` while preserving
// `light → hard 3/4 back, low sun through a doorway` and the frame reads false.
// A naive swap does not break the changed slot; it breaks the ones next to it.
//
// Pure module. No IPC, no prompt, no React. Unit-tested.

import type { SlotKey, SlotDecisions } from './types';
import { SLOT_KEYS } from './types';

/** swapped slot → the slots that may legitimately move as a consequence.
 *  Terminal entries are written out explicitly rather than omitted, because an
 *  absent key and a deliberately-empty key mean different things to the next
 *  person reading this. */
export const FOLLOWS: Record<SlotKey, SlotKey[]> = {
  // the hour rewrites the light, the grade follows the light, and what is
  // switched on / open / occupied changes with it
  time:     ['light', 'colour', 'objects'],
  // a grade follows its source
  light:    ['colour'],
  // the stock owns the grade
  medium:   ['colour'],
  // a new room brings its own practicals and its own dressing. NOT time —
  // walking indoors does not change the hour.
  place:    ['light', 'objects'],
  // the verb owns the body
  action:   ['posture', 'hands', 'gaze'],
  // the body's attitude drags the extremities
  posture:  ['hands', 'gaze'],
  // a different body does not wear the same garment the same way — fit, drape,
  // and the social register of who wears what
  identity: ['wardrobe'],

  // terminal by design: a garment change is local, a prop change is local, a
  // gaze change is local, and a grade is the end of the chain.
  wardrobe: [],
  hands:    [],
  gaze:     [],
  objects:  [],
  colour:   [],
  // camera is terminal HERE because a camera change is not a swap — it is
  // Camera Angles, which already owns that geometry prompt. The UI routes it.
  camera:   [],
};

/** Transitive closure of the graph over every swapped slot.
 *
 *  `place → light → colour` is a real chain and must be reached, so this walks
 *  rather than reading one level. Two laws are enforced here and nowhere else:
 *
 *  1. USER INTENT OUTRANKS THE GRAPH. A slot the user explicitly set to SWAP is
 *     never demoted to FOLLOW.
 *  2. AN EXPLICIT KEEP IS NEVER SILENTLY PROMOTED. A pinned slot the graph wants
 *     to move is FLAGGED (becauseOf is set so the UI can name the conflict) and
 *     left as KEEP. The prompt still honours the pin. The owner is never
 *     silently overruled. */
export function resolveFollows(decisions: SlotDecisions): SlotDecisions {
  const out: SlotDecisions = { ...decisions };
  const swapped = SLOT_KEYS.filter(k => decisions[k]?.state === 'swap');

  const queue: Array<{ key: SlotKey; because: SlotKey }> =
    swapped.flatMap(s => FOLLOWS[s].map(key => ({ key, because: s })));
  const seen = new Set<SlotKey>(swapped);

  while (queue.length) {
    const { key, because } = queue.shift()!;
    if (seen.has(key)) continue;
    seen.add(key);

    const cur = out[key] ?? { state: 'keep' as const };
    // law 1 — an explicit swap is never demoted
    if (cur.state === 'swap') continue;
    // law 2 — an explicit pin is flagged, not promoted
    if (cur.pinnedAgainstGraph) { out[key] = { ...cur, becauseOf: because }; continue; }

    out[key] = { ...cur, state: 'follow', becauseOf: because };
    for (const next of FOLLOWS[key]) queue.push({ key: next, because: key });
  }
  return out;
}

/** swapped slot → the slots that must be RESTATED because this change puts them
 *  at risk of drifting.
 *
 *  THIS IS A DIFFERENT RELATION FROM `FOLLOWS` AND COLLAPSING THE TWO IS A BUG.
 *  FOLLOWS means "this MAY change as a consequence". AT_RISK means the opposite:
 *  "this must NOT change, and it will unless you say so." Replacing the person
 *  does not license their gaze to move — but the model is redrawing the human, so
 *  the gaze moves anyway unless the frame states where the eyes go. That is
 *  exactly Anwar's ask: keep the angle, the action and the gaze while the
 *  character changes. Those three have to be NAMED, with their values, or the
 *  contract is carried only by a photograph and a generic clause.
 *
 *  Kept deliberately tight — this is what stops the preserve block growing back
 *  into the thirteen-bullet checklist it was designed to avoid. */
export const AT_RISK: Record<SlotKey, SlotKey[]> = {
  // the human is being redrawn — everything about the human drifts with them
  identity: ['posture', 'hands', 'gaze', 'wardrobe', 'action'],
  // re-dressing or re-posing a body redraws the person on the way through
  wardrobe: ['identity', 'posture'],
  posture:  ['identity', 'wardrobe'],
  action:   ['identity', 'wardrobe'],
  hands:    ['identity', 'gaze'],
  gaze:     ['identity', 'posture'],
  // a new world re-renders the person into it, and the framing slides with it
  place:    ['identity', 'wardrobe', 'posture', 'gaze'],
  time:     ['identity', 'place'],
  // a grade pass softens faces — the commonest silent loss in the whole tool
  light:    ['identity'],
  colour:   ['identity'],
  medium:   ['identity'],
  objects:  ['place'],
  camera:   [],
};

/** The slots whose PRESERVE line must actually be WRITTEN.
 *
 *  Not "every unswapped field" — that is a thirteen-bullet checklist, and
 *  masterPrompt.ts's MASTER_SYSTEM explicitly warns that the checklist shape
 *  flattens attention and makes the model average. It is also redundant: Image 1
 *  already carries every unswapped slot, so a bullet describing what the
 *  photograph already shows spends attention to say nothing.
 *
 *  So: the AT_RISK neighbourhood of everything that moved — the fields this
 *  particular change will drag whether or not it is allowed to — plus camera and
 *  identity, which drift on any edit at all. Four or five lines instead of
 *  thirteen, which is also what leaves room for the requirement ledger to carry
 *  weight.
 *
 *  This is a claim, not a certainty. It ships behind preserveMode and is the
 *  first thing the bench measures. */
export function preserveSet(decisions: SlotDecisions): Set<SlotKey> {
  const moved = SLOT_KEYS.filter(k => decisions[k]?.state !== 'keep');
  const atRisk = new Set<SlotKey>(['camera', 'identity']);
  for (const m of moved) for (const n of AT_RISK[m]) atRisk.add(n);
  // a slot that is itself moving gets a CHANGE or a CONSEQUENCE line, never a
  // PRESERVE line — telling the model to both change and keep one field is how
  // it decides to do neither
  for (const k of Array.from(atRisk)) if (decisions[k]?.state !== 'keep') atRisk.delete(k);
  return atRisk;
}

/** Every slot, for preserveMode: 'full' — the control arm of experiment 1. */
export function preserveSetFull(decisions: SlotDecisions): Set<SlotKey> {
  return new Set(SLOT_KEYS.filter(k => decisions[k]?.state === 'keep'));
}

// ── the two predicates the lock kit is derived from ─────────────────────────
// Six hand-written lock rows drift as the tool grows. Two booleans do not.

/** The full-frame 3D layout survives → a depth plate of the source is still
 *  true. Any of these moving means the map is a lie about where things ARE.
 *
 *  `hands` is here because a hand that lifts genuinely moves through space, and
 *  a depth map of the lowered hand would argue with the raised one.
 *  `gaze` is deliberately NOT here: eyes and a few degrees of head rotate inside
 *  the same volume, so the depth map stays true enough to be worth keeping. */
export function geometryHeld(d: SlotDecisions): boolean {
  return (['camera', 'action', 'posture', 'place', 'hands'] as SlotKey[])
    .every(k => d[k]?.state === 'keep');
}

/** The outline survives → a canny stencil of the source is still true.
 *
 *  Wardrobe and identity are here rather than in geometryHeld because a new
 *  garment or a new body changes the silhouette without moving anything in
 *  space. `gaze` is here for the same reason and it is easy to miss: changing
 *  where someone looks turns the head, and a stencil cut around the old head
 *  angle would hold the face where it was and defeat the change being asked for. */
export function silhouetteHeld(d: SlotDecisions): boolean {
  return geometryHeld(d)
    && d.wardrobe?.state === 'keep'
    && d.identity?.state === 'keep'
    && d.gaze?.state === 'keep';
}

/** How many slots are moving. Reported, never capped — multi-change is the
 *  designed path, and the re-drive ladder is what handles the cost. The UI uses
 *  this to state the honest expectation ("four requirements in one pass; expect
 *  the ladder to run"), not to refuse. */
export function blastRadius(d: SlotDecisions): number {
  return SLOT_KEYS.filter(k => d[k]?.state !== 'keep').length;
}
