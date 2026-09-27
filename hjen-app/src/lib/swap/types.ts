// The Swap — SHAPES ONLY.
//
// House law (recipe stays server-side): every prompt — the slot read, the
// consequence pass, the verifier, and the make template — lives MAIN-side in
// app/electron/swap.ts and never crosses the bridge. This file may name a type
// but must never carry a sentence the model will read.
// `grep -rE 'SWAP_(SLOTS_SYS|CONSEQUENCE_SYS|VERIFY_SYS|TEMPLATE)' app/src/`
// must return nothing.
//
// WHY THIS EXISTS. The Eye reads one frame into 18 fields and nothing anywhere
// turns those fields back into a make prompt — the reverse exists only at ad
// altitude (lib/breakdown/masterPrompt.ts). The Swap is that reverse at frame
// altitude, and its thesis is that THE EYE READ IS THE PRESERVATION CONTRACT:
// a change is one field replaced, and everything untouched is already correct
// in the source photograph.
//
// FrameSlots is a strict SUPERSET of EyeRead, never a replacement. EyeRead is
// FROZEN — 293 live reads in dna_corpus/index/eye_reads plus eye_golden.jsonl
// depend on it byte-for-byte, and eye_read.py lifts EYE_READ_SYS out of eye.ts
// at runtime. Adding a field there would silently invalidate all of it.

import type { EyeLight, EyeLens, EyeColour, EyeRead } from '../eye/types';
import type { LibCategory } from '../../types/hjen-bridge';

// ═══════════════════════════ the slots ═══════════════════════════

/** The thirteen slots, in the order the composer renders them — which is the
 *  prompt's WEIGHT order (camera + action first, per masterPrompt.ts's law),
 *  not alphabetical and not the Eye's layer order. */
export type SlotKey =
  | 'camera' | 'action'
  | 'identity' | 'wardrobe' | 'posture' | 'hands' | 'gaze'
  | 'light' | 'colour' | 'medium' | 'time'
  | 'place' | 'objects';

export const SWAP_SLOTS = [
  { key: 'camera',   en: 'Camera',    hint: 'size · tilt · height · focal feel · depth band' },
  { key: 'action',   en: 'Action',    hint: 'the verb of the frame' },
  { key: 'identity', en: 'Character', hint: 'who — face, age, build, hair. No clothes, no pose' },
  { key: 'wardrobe', en: 'Wardrobe',  hint: 'piece by piece — garment · fabric · colour · fit · wear' },
  { key: 'posture',  en: 'Posture',   hint: 'stance, weight, torso and head attitude, limbs' },
  { key: 'hands',    en: 'Hands',     hint: 'each hand — what it does, what it holds' },
  { key: 'gaze',     en: 'Gaze',      hint: 'where the eyes go in world space, and what the face carries' },
  { key: 'light',    en: 'Light',     hint: 'key · fill · accent · kelvin · state' },
  { key: 'colour',   en: 'Colour',    hint: 'dominant · second · accent · behaviour' },
  { key: 'medium',   en: 'Medium',    hint: 'film or digital · grain · halation · the era' },
  { key: 'time',     en: 'Time',      hint: 'hour · weather · operational state' },
  { key: 'place',    en: 'Place',     hint: 'named specifically · interior or exterior · register' },
  { key: 'objects',  en: 'Objects',   hint: 'the props actually in frame' },
] as const;

export const SLOT_KEYS: SlotKey[] = SWAP_SLOTS.map(s => s.key);
export const slotLabel = (k: SlotKey): string => SWAP_SLOTS.find(s => s.key === k)?.en ?? k;

/** One frame, decomposed to transform grade.
 *
 *  `camera`, `action`, `light`, `colour`, `medium`, `time`, `place` and
 *  `objects` are copied VERBATIM from the EyeRead — they are already atomic and
 *  re-reading a solved axis is how the two passes drift apart.
 *
 *  The five person slots are what pass 2 adds: EyeRead.subject is specified as
 *  "who/what · how many · age band · posture · hands · eye-line. One line." — a
 *  single string. You cannot recast the actor while holding his gaze when his
 *  identity and his gaze live in the same sentence. `wardrobe` is not a split at
 *  all: the Eye has never read wardrobe on any axis, so pass 2 reads it for the
 *  first time — which is also why it is the slot most likely to be invented. */
export interface FrameSlots {
  /** VERBATIM from EyeRead.lens. */
  camera: EyeLens;
  /** VERBATIM from EyeRead.action. */
  action: string;

  /** WHO. Apparent age bracket read off the face, build, hair, colouring, and
   *  any permanent feature. Holds only what stays true if the person changed
   *  clothes, changed pose and looked somewhere else. */
  identity: string;
  /** Piece by piece: garment · fabric · colour · fit · condition. NEW — on a
   *  tight close-up the honest answer is usually "only a collar is in frame". */
  wardrobe: string;
  /** The body: weight, spine, torso and head attitude, limbs. Not the hands. */
  posture: string;
  /** Each hand named separately, and precisely what it does or holds. */
  hands: string;
  /** Where the eyes go IN WORLD SPACE — the real point they are aimed at, not
   *  the direction on screen, because screen-space gaze does not survive a
   *  recast. Plus one clause of what the face carries. */
  gaze: string;

  /** VERBATIM from EyeRead. */
  light: EyeLight;
  colour: EyeColour;
  medium: string;
  time: string;
  place: string;
  objects: string[];

  /** EyeRead.culturalTruth — carried so the objects preserve line can name the
   *  detail that makes the frame real. NOT a swappable slot.
   *
   *  EyeRead.refusal is DELIBERATELY ABSENT and must never be added: it names
   *  what is WRONG with the frame, and emitting it into a render prompt asks the
   *  model to reproduce the flaw. */
  culturalTruth: string;
}

// ═══════════════════════════ the decision ═══════════════════════════

/** KEEP   — locked; stated in the prompt only if at risk, otherwise held by the pixels.
 *  SWAP   — the user is changing this one, with a value and optionally an image.
 *  FOLLOW — untouched by the user, but a slot it depends on moved, so it is
 *           allowed (and expected) to change as a consequence. */
export type SlotState = 'keep' | 'swap' | 'follow';

export interface SlotDecision {
  state: SlotState;
  /** state==='swap' — the new value in the user's own words. */
  value?: string;
  /** state==='swap' — an image that SHOWS the new value (a face, a garment, a
   *  location still). Optional: a swap can be words-only. */
  refPath?: string;
  /** All images that jointly show the requested value. `refPath` remains as a
   *  read-only compatibility lane for saved sessions made before multi-ref. */
  refPaths?: string[];
  /** state==='follow' — the IMMEDIATE cause, for the UI's "because you changed X". */
  becauseOf?: SlotKey;
  /** state==='follow' — the consequence pass's proposal. The user may accept it,
   *  edit it, or pin the slot back to KEEP and take the incoherence knowingly. */
  proposed?: string;
  /** True when the user pinned KEEP on a slot the graph wanted to FOLLOW. The UI
   *  shows a conflict warning; the prompt still honours the pin. House law: the
   *  owner is never silently overruled. */
  pinnedAgainstGraph?: boolean;
}

export type SlotDecisions = Record<SlotKey, SlotDecision>;

export const emptyDecisions = (): SlotDecisions =>
  SLOT_KEYS.reduce((acc, k) => { acc[k] = { state: 'keep' }; return acc; }, {} as SlotDecisions);

// ═══════════════════════════ the change ledger ═══════════════════════════

/** One change, compiled. A requirement is not a sentence — it is a sentence
 *  PLUS the test that proves it, and the test is what makes it enforceable
 *  rather than merely requested. */
export interface Requirement {
  /** C1, C2, C3 — stable across rounds; cited in the prompt AND in every verdict,
   *  so a user can follow one requirement through the whole ladder. */
  id: string;
  slot: SlotKey;
  /** The user's words, verbatim. Never reworded into the contract. */
  value: string;
  /** The image that shows the new value, when there is one. */
  refPath?: string;
  /** Ordered visual evidence for this requirement. */
  refPaths?: string[];
  /** THE ACCEPTANCE TEST. One question a vision model answers yes/no from the
   *  OUTPUT ALONE, having never seen the source. "Is the person in this frame a
   *  woman in her sixties?" — not "did the character change?", which cannot be
   *  answered without the source and therefore cannot be enforced.
   *  Written MAIN-side at compose time. When the writer cannot produce a clean
   *  test the requirement is vague, and the UI says so BEFORE the make fires. */
  test: string;
  /** Order in the CHANGE block. User-draggable; also the order the ladder
   *  escalates in when it can only carry one requirement. */
  priority: number;
}

/** A conflict between two requirements, or between a requirement and a pin.
 *  Shown, never blocking — the owner decides, and the ledger records that he did. */
export interface Conflict {
  /** The requirement ids and/or slot keys involved. */
  between: string[];
  /** One sentence naming the conflict in the frame's own terms. */
  message: string;
  /** 'pin'  — deterministic: a swapped slot's graph neighbour is pinned KEEP.
   *  'physical' — from the coherence pass: the two changes cannot co-exist. */
  kind: 'pin' | 'physical';
}

// ═══════════════════════════ the verdict ═══════════════════════════

export type VerdictState = 'landed' | 'partial' | 'missed';

export interface Verdict {
  /** The requirement id this judges. */
  id: string;
  state: VerdictState;
  /** One line of evidence read off the take's pixels — why the verifier says so.
   *  This is what the user reads when he disagrees with the machine. */
  evidence: string;
}

/** What the seven exact-enum axes said when the take was re-read. No judge and
 *  no prompt is needed for these — they are equality on a closed vocabulary,
 *  which is the only part of the preservation claim that is not an opinion. */
export interface PreserveScore {
  /** Axes that came back identical to the source read. */
  held: string[];
  /** Axes that moved without being asked to. */
  drifted: Array<{ axis: string; from: string; to: string }>;
}

/** One make in the ladder.
 *
 *  IMAGE 1 IS THE ORIGINAL FRAME IN EVERY ROUND — never a previous take.
 *  The ladder used to chain: round 2 re-photographed round 1's output, round 3
 *  re-photographed round 2's. It enforced changes well and quietly destroyed the
 *  frame: three generations away from the real photograph, the skin texture, the
 *  grain and the micro-detail are gone, and the "reference" attached is a
 *  machine's guess about a machine's guess. The only images this tool sends are
 *  the original and what the owner attached himself. */
export interface SwapRound {
  round: 1 | 2 | 3;
  /** Always the ORIGINAL frame. Carried on each round unchanged. */
  sourcePath: string;
  /** Every requirement, on every round — re-asking from the original means a
   *  change dropped from the list simply would not be in the result. Ordered
   *  with the previous round's failures first. */
  requirements: Requirement[];
  /** Requirement ids the previous round failed to land. They lead the change
   *  block and get an explicit line naming them as what must land this time. */
  escalate?: string[];
  /** Requirements that have landed in some round — carried for scoring only. */
  landed: Requirement[];
}

// ═══════════════════════════ the lock kit ═══════════════════════════

/** The display name of a kit. For the UI and the sidecar only — never branched
 *  on. What actually ships is the three booleans below, because a kit whose name
 *  says "depth" while no depth plate was buildable is exactly the lie that makes
 *  a prompt cite an Image N that is not there. */
export type LockKit = 'none' | 'depth' | 'canny' | 'canny+depth' | 'subject-canny+depth';

export interface LockPlan {
  kit: LockKit;
  /** Attach an edge stencil of the source. */
  canny: boolean;
  /** Stencil the SUBJECT ONLY — needs the person matte (hjen:emulsion-segment)
   *  as the --mask for make_canny.py. Used when the world goes free and the
   *  subject must hold. */
  cannySubjectOnly: boolean;
  /** Attach a depth map of the source. */
  depth: boolean;
  /** Attach a tight crop of the source subject's face as an identity anchor. */
  faceAnchor: boolean;
  /** One honest sentence, rendered in the UI. The tool explains its own choice —
   *  a lock the user cannot interrogate is a lock he will not trust. */
  reason: string;
}

// ═══════════════════════════ references ═══════════════════════════

export type SwapRefRole = 'source' | 'canny' | 'depth' | 'face' | 'slot';

export interface SwapRef {
  role: SwapRefRole;
  /** For role==='slot' — which requirement's new value this image shows. */
  slot?: SlotKey;
  /** Keeps references scoped to the precise CHANGE item when two requirements
   *  happen to target the same slot. */
  requirementId?: string;
  filePath: string;
  /** The category handed to runFrameGeneration. Drives BOTH the ordering bucket
   *  AND whether buildPrompt fires its COMPOSITION LOCK clause — which is
   *  exactly right for a character/wardrobe/place swap and exactly wrong for an
   *  action swap, so the category is a decision, not a label. */
  category: Extract<LibCategory, 'composition' | 'character' | 'general'>;
  /** Human label, for the UI chip and the sidecar. */
  label: string;
}

// ═══════════════════════════ results over the bridge ═══════════════════════════

export interface SwapSlotsResult {
  ok: boolean; reason?: string; message?: string;
  slots?: FrameSlots;
  /** Slots that came back empty or evasive — the same honesty gate as EyeRead's
   *  `thin`. A thin slot may NOT be offered as a SWAP target: you cannot swap a
   *  wardrobe the read could not see. */
  thin?: SlotKey[];
  model?: string; ms?: number;
}

export interface SwapConsequenceResult {
  ok: boolean; message?: string;
  /** One batched call fills EVERY followed slot at once — never N calls. */
  follows?: Partial<Record<SlotKey, string>>;
  model?: string;
}

export interface SwapComposeResult {
  ok: boolean; message?: string;
  /** The finished make prompt. OPAQUE to the renderer — it goes straight into
   *  Selections.prompt and is never parsed or reworded on this side. */
  prompt?: string;
  /** Echoed with their tests filled in, so the UI can show the ledger and the
   *  verifier can be handed the exact same strings the model was. */
  requirements?: Requirement[];
  /** Echoed so the store builds Layer[] in exactly the order the prompt's
   *  "Image N" citations assume. */
  refs?: SwapRef[];
  /** Requirements whose acceptance test could not be written cleanly — vague
   *  asks, surfaced before the make fires rather than after it fails. */
  untestable?: string[];
}

export interface SwapVerifyResult {
  ok: boolean; message?: string;
  verdicts?: Verdict[];
  model?: string;
}

export interface SwapCannyResult {
  ok: boolean; message?: string;
  cannyPath?: string;
  /** False when Python/PIL was unavailable — the take still fires prompt-only
   *  and the UI says why. Never a silent downgrade, never a hard block. */
  available?: boolean;
}

// ═══════════════════════════ the saved session ═══════════════════════════

/** One take, as it is remembered. Mirrors what the view holds live, minus the
 *  transient phase text — a spinner is not worth persisting. */
export interface SavedTake {
  key: string;
  status: 'making' | 'done' | 'error' | 'interrupted';
  path?: string; jsonPath?: string; message?: string;
  verdicts?: Verdict[]; unresolved?: string[]; rounds?: number;
}

/** One fired batch. */
export interface SavedRun {
  id: string; at: number;
  srcPath: string;
  model: string; quality: string; aspect: string;
  requirements: Requirement[];
  lockKit?: string; lockReason?: string;
  takes: SavedTake[];
}

/** ONE DECOMPOSITION AND EVERYTHING BUILT ON IT.
 *
 *  This is the unit the owner actually thinks in: "the frame I was working on".
 *  A project accumulates many of them, so they are a LIST rather than a single
 *  live document — reopening one must restore the read, the decisions, the tests
 *  and the takes exactly, and must NOT re-run the two vision passes. A read is
 *  paid for once. */
export interface SwapSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** The frame this session decomposes. Also the identity key: picking the same
   *  file again reopens this session instead of paying for a second read. */
  sourcePath: string;
  /** Short human label — the Eye's own search phrase when it has one, else the
   *  filename. What the owner scans the history strip by. */
  title: string;
  /** The Eye's read, kept so a re-split (or a later bench pass) never needs the
   *  frame read again. */
  read?: EyeRead;
  slots?: FrameSlots;
  thin: SlotKey[];
  decisions: SlotDecisions;
  /** Acceptance tests, keyed by requirement id, as the plan pass wrote them. */
  tests: Record<string, string>;
  untestable: string[];
  conflicts: Conflict[];
  settings: { model: string; quality: string; aspect: string; count: number };
  runs: SavedRun[];
}

/** The per-project document. Lives at <slug>/_swap/swap.json under the same
 *  safety model as the node graph: atomic write, throttled deduped backups,
 *  auto-heal, and a refusal to let an empty doc overwrite a populated one. */
export interface SwapDoc {
  version: 1;
  /** Guard against a doc from another project being applied after a fast switch. */
  projectId?: string;
  updatedAt: string;
  sessions: SwapSession[];
}

export const emptySwapDoc = (projectId?: string): SwapDoc => ({
  version: 1, projectId, updatedAt: new Date().toISOString(), sessions: [],
});

// ═══════════════════════════ the golden set ═══════════════════════════

/** One graded swap, appended to swap_golden.jsonl — the mirror of
 *  EyeGoldenEntry. Two things are graded, and the second matters more than it
 *  looks: whether each preserved slot actually held, AND whether the machine's
 *  own verdict agreed with Anwar's. A verifier that says "landed" on a 60% morph
 *  is worse than no verifier, and this file is where that gets caught. */
export interface SwapGoldenEntry {
  ts: string;
  sourcePath: string;
  takePath: string;
  sourceHash: string;
  /** The image model that made the take. */
  model: string;
  requirements: Requirement[];
  /** What the machine said. */
  machineVerdicts: Verdict[];
  /** What Anwar said, per requirement id. */
  humanVerdicts: Record<string, VerdictState>;
  /** Did each preserved slot survive. */
  slotGrades: Partial<Record<SlotKey, 'held' | 'drifted'>>;
  /** The Eye re-read of the TAKE, so the machine diff is reproducible offline. */
  takeRead?: EyeRead;
  /** How many rounds the ladder needed. 1 is the product working; 3 is the
   *  product surviving. */
  rounds: number;
  notes: Partial<Record<SlotKey, string>>;
  signedBy: string;
}
