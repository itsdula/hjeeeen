// The change ledger and the re-drive ladder.
//
// WHY THIS EXISTS. A prompt is a request. Anwar's requirement is that the system
// hold its changes under a mechanism the model cannot ignore — which means each
// change has to be (a) numbered and stated twice, once as direction and once as
// an acceptance test in the model's own checking voice, and (b) read back off
// the result and re-driven when it did not land.
//
// Multi-change is the normal case here, not the edge case. Asking for four
// changes at once and getting two is the expected failure of a parallel ask; the
// ladder converts it into a sequential one — the take becomes the new source,
// the landed requirements become explicit KEEPs, and only the failures are asked
// for again, at higher force and at the head of the block.
//
// Pure module. The ladder is DATA, and it is tested before a single pixel is
// made — because a retry loop that is wrong is worse than no retry loop: it
// spends the owner's money to arrive somewhere further from the frame.

import type {
  SlotKey, SlotDecisions, Requirement, Conflict, Verdict, SwapRound, VerdictState,
} from './types';
import { SLOT_KEYS, slotLabel } from './types';
import { FOLLOWS } from './deps';

/** The ladder never runs past this. Three makes on one frame is the ceiling —
 *  past that the tool is not converging, it is gambling with the owner's money,
 *  and the honest move is to report what never landed. */
export const MAX_ROUNDS = 3;

/** Requirement ids are positional and stable: C1 is the first slot in weight
 *  order that is being swapped, and it stays C1 through every round so a user
 *  can follow one change down the whole trail. */
const reqId = (index: number): string => `C${index + 1}`;

/** Compile the SWAP decisions into numbered requirements, in weight order.
 *
 *  A swap with neither words nor an image is not a requirement — it is an empty
 *  row the UI should not have allowed. Dropped defensively rather than compiled
 *  into a change line that says nothing. */
export function toRequirements(decisions: SlotDecisions): Requirement[] {
  const out: Requirement[] = [];
  for (const key of SLOT_KEYS) {
    const d = decisions[key];
    if (!d || d.state !== 'swap') continue;
    const value = (d.value ?? '').trim();
    const refPaths = [...new Set([
      ...(Array.isArray(d.refPaths) ? d.refPaths : []),
      ...(d.refPath ? [d.refPath] : []),
    ].filter(Boolean))];
    if (!value && !refPaths.length) continue;
    out.push({
      id: reqId(out.length),
      slot: key,
      value,
      ...(refPaths.length ? { refPaths, refPath: refPaths[0] } : {}),
      // filled MAIN-side at compose time — the renderer never writes a test,
      // because a test is part of the recipe
      test: '',
      priority: out.length,
    });
  }
  return out;
}

/** Re-number and re-order after the user drags a requirement. Ids follow the
 *  NEW order, because a ledger where C3 sits above C1 reads as a bug. */
export function reprioritise(reqs: Requirement[], order: string[]): Requirement[] {
  const byId = new Map(reqs.map(r => [r.id, r]));
  const ranked = order.map(id => byId.get(id)).filter(Boolean) as Requirement[];
  for (const r of reqs) if (!order.includes(r.id)) ranked.push(r);
  return ranked.map((r, i) => ({ ...r, id: reqId(i), priority: i }));
}

/** Conflicts this side can prove without asking anything.
 *
 *  One shape only: a swapped slot whose graph neighbour the user has pinned
 *  KEEP. That is the "night hour with noon light" family, and it is worth
 *  catching deterministically because it is both the most common and the most
 *  damaging — the frame comes back internally false rather than merely wrong.
 *
 *  Physical conflicts between two changes (a gaze aimed into an engine bay while
 *  the place becomes a mosque interior) cannot be decided here; those come from
 *  the coherence pass MAIN-side and are merged in by the caller.
 *
 *  Conflicts are SHOWN, never blocking. The owner decides, and the ledger
 *  records that he decided. */
export function conflictCheck(decisions: SlotDecisions, reqs: Requirement[]): Conflict[] {
  const out: Conflict[] = [];
  const idBySlot = new Map(reqs.map(r => [r.slot, r.id]));
  for (const key of SLOT_KEYS) {
    if (decisions[key]?.state !== 'swap') continue;
    for (const n of FOLLOWS[key]) {
      const nd = decisions[n];
      if (!nd?.pinnedAgainstGraph) continue;
      out.push({
        kind: 'pin',
        between: [idBySlot.get(key) ?? key, n],
        message: `You are holding ${slotLabel(n).toLowerCase()} exactly as it is while changing ${slotLabel(key).toLowerCase()}. The two belong to each other, so the frame will read false — which is a real choice, but make it knowing.`,
      });
    }
  }
  return out;
}

// ═══════════════════════════ the ladder ═══════════════════════════

export interface LadderStep {
  /** The next make to fire, or null when the ladder is finished. */
  next: SwapRound | null;
  /** Everything that has landed so far, across every round. */
  landed: Requirement[];
  /** Requirements that have not landed and are no longer being asked for —
   *  either because the ladder is exhausted or because round 3 could only carry
   *  the highest-priority failure. Reported to the user, never hidden. */
  unresolved: Requirement[];
  /** One sentence for the UI when the ladder stops. */
  note?: string;
}

const isFail = (v: VerdictState): boolean => v === 'missed' || v === 'partial';

/** Read a round's verdicts and decide the next one.
 *
 *  EVERY ROUND RE-ASKS FROM THE ORIGINAL FRAME. The ladder used to chain — round
 *  2 re-photographed round 1's output — which enforced changes well and destroyed
 *  the picture: each round is a generation further from the real photograph, and
 *  the reference it hands the model is a machine's guess about a machine's guess.
 *  So it re-asks instead, from the same plate, with the failures moved to the head
 *  of the change block and named as what must land this time.
 *
 *  That trade is real and worth stating: re-asking cannot GUARANTEE that what
 *  landed in round 1 lands again, the way chaining could. It is why every round's
 *  take is kept and the run reports the best one, rather than the last one.
 *
 *  A requirement with no verdict is treated as failed — silence is not success,
 *  and a verifier that dropped a row must not be read as a pass. */
export function advanceLadder(
  prev: SwapRound,
  verdicts: Verdict[],
  _takePath: string,
): LadderStep {
  const byId = new Map(verdicts.map(v => [v.id, v.state]));
  const landedNow = prev.requirements.filter(r => byId.get(r.id) === 'landed');
  const failed = prev.requirements.filter(r => !byId.has(r.id) || isFail(byId.get(r.id)!));
  // Union by id — a requirement that landed in round 1 and slipped in round 2 has
  // still been shown to be achievable, and the best-take report needs to know.
  const seen = new Set(prev.landed.map(r => r.id));
  const landed = [...prev.landed, ...landedNow.filter(r => !seen.has(r.id))];

  if (!failed.length) {
    return { next: null, landed, unresolved: [], note: 'Every change landed.' };
  }
  if (prev.round >= MAX_ROUNDS) {
    return {
      next: null, landed, unresolved: failed,
      note: `${failed.map(r => r.id).join(' · ')} did not land after ${MAX_ROUNDS} rounds. The best take ships as it is.`,
    };
  }

  const round = (prev.round + 1) as 2 | 3;
  const failedIds = failed.map(r => r.id);
  // Failures first, then the rest — all of them, because a change left out of the
  // list simply would not be in a frame re-made from the original.
  const ordered = [...failed, ...prev.requirements.filter(r => !failedIds.includes(r.id))]
    .map((r, i) => ({ ...r, priority: i }));

  return {
    next: { round, sourcePath: prev.sourcePath, requirements: ordered, escalate: failedIds, landed },
    landed,
    unresolved: [],
    note: `${failedIds.join(' · ')} did not land — asking again from the original frame.`,
  };
}

/** The opening round. Separate from advanceLadder so the store never has to
 *  fabricate a fake round 0 to get started. */
export function firstRound(sourcePath: string, requirements: Requirement[]): SwapRound {
  return { round: 1, sourcePath, requirements, landed: [] };
}

/** The two honest numbers per take, for the UI and for the bench.
 *  `n/N landed` is the one Anwar asked for; `rounds` is the one that says
 *  whether we built a tool that works or a tool that survives. */
export function ledgerScore(step: LadderStep, requirements: Requirement[], rounds: number) {
  return {
    landed: step.landed.length,
    total: requirements.length,
    unresolved: step.unresolved.map(r => r.id),
    rounds,
  };
}

/** Slots currently carrying a requirement — used by the UI to badge the rows. */
export function requirementSlots(reqs: Requirement[]): Set<SlotKey> {
  return new Set(reqs.map(r => r.slot));
}
