// The Eye — what a director actually reads in a frame.
//
// This is the SHAPE only. The prompt that produces it (EYE_READ_SYS) lives in
// app/electron/eye.ts, MAIN-side, and never crosses IPC — house law: the recipe
// stays server-side, the renderer is a dumb terminal.
//
// WHY THIS SCHEMA EXISTS. The corpus index carries six enum fields per frame
// (shotSize / shotAngle / lightState / palette / place / wardrobe) and search is
// token matching over a text blob. Measured across the 4,336 frames the old eye
// could use: shotAngle is 'eye' in 82% of them and lightState is
// 'interior-practical' in 57%. Two of the three ranking fields are near-
// constants, so selection over that index is close to random — which is how the
// eye lost 8 of 20 rounds to a fixed baseline. An index cannot be searched
// semantically until something has WRITTEN what each frame is. That is READ.
//
// Layers 1–2 are what any captioner gives you. LAYER 3 IS THE EYE — a frame's
// inside state, the craft decision behind it, its cultural truth, and what is
// wrong with it. A reader that cannot say what is wrong with a frame is a
// caption generator wearing a director's jacket.

/** The universal, DNA-agnostic emotional vocabulary (mirrors REGISTERS in
 *  app/electron/contextAgents.ts — kept in sync deliberately, not imported,
 *  because MAIN and renderer must not share a module). */
export type Register = 'longing' | 'resolve' | 'joy' | 'desolation' | 'turbulence' | 'groundedness';
export type Energy = 'quiet' | 'mid' | 'loud';

export const EYE_REGISTERS: Register[] = ['longing', 'resolve', 'joy', 'desolation', 'turbulence', 'groundedness'];
export const EYE_ENERGIES: Energy[] = ['quiet', 'mid', 'loud'];

/** Light architecture — every source named, per the house frame discipline.
 *  "well-lit / atmospheric / bright and airy" is a refusal, not a description. */
export interface EyeLight {
  key: string;      // direction + quality + apparent source ("hard 3/4 back, low sun through a doorway")
  fill: string;     // the ratio in words ("almost none — shadow side falls to black")
  accent?: string;  // rim / practical / event light, if any
  kelvin: string;   // named, and mixed when mixed ("2900K practicals against 6000K window")
  state: string;    // day | golden | blue-hour | night | interior-practical | mixed
}

/** Lens + frame. `height` is SEPARATE from `angle` — collapsing them is how
 *  'top' and 'high' ended up inside the corpus's shotSize field. */
export interface EyeLens {
  size: string;    // ecu | cu | mcu | medium | medium-wide | wide | extreme-wide | aerial
  angle: string;   // eye | low | high | dutch — where the camera TILTS
  height: string;  // where the camera STANDS: floor | child | hip | eye | overhead
  focal: string;   // the FEEL, not the mm: wide | normal | long | macro
  depth: string;   // where the depth band sits and what falls out of it
}

/** Colour as behaviour, not inventory. "orange, yellow, dark-brown" is a list;
 *  "one warm body held inside a cold grey field" is a read. */
export interface EyeColour {
  dominant: string;
  second: string;
  accent: string;
  behaviour: string;
}

/** One frame, read. */
export interface EyeRead {
  // ── Layer 1 · ما في الإطار — denotation (what search needs) ───────────────
  subject: string;    // who/what · count · age band · posture — one line
  place: string;      // named specifically · interior/exterior · the register of the place
  action: string;     // the verb of the frame
  objects: string[];  // 3–6 concrete nouns actually visible

  // ── Layer 2 · الحرفة — craft (what a gaffer / DOP / stylist reads) ────────
  light: EyeLight;
  lens: EyeLens;
  colour: EyeColour;
  medium: string;     // film/digital · grain · halation · the era OF THE IMAGE itself
  time: string;       // hour · weather · operational state (rush hour / quiet hour / first train)

  // ── Layer 3 · عين المخرج — the director's read (THE MISSING AXES) ─────────
  /** What is happening inside the subject IN THIS FRAME, not across the scene.
   *  One sentence. "She's waiting for her husband, five minutes late; not
   *  worried yet." */
  inside: string;
  /** What the photographer DID — the decision, not the description. "Shot from
   *  the child's height so the adults read as architecture." */
  craftMove: string;
  /** The object, gesture or detail that makes this real rather than staged —
   *  or, when it is staged, the tell. Never "n/a". */
  culturalTruth: string;
  /** What is WRONG with this frame. Every real eye can say this. Never "n/a". */
  refusal: string;

  // ── مفتاح البحث — the search key ──────────────────────────────────────────
  /** 5–10 English words: concrete scene nouns + one or two mood words.
   *  NO colour names, NO camera jargon — the hard-won lesson already encoded in
   *  EYE_QUERY_SYS. Colour lives in `colour`; it is not a search key. */
  searchPhrase: string;
  /** The same key in Arabic — 5–10 words, written the way a Saudi director
   *  would ask for the frame. Not a translation of the English. Without it an
   *  Arabic query reaches only the tag list: measured on the first 142 reads,
   *  every prose field came back English-only. */
  searchPhraseAr: string;
  /** 8–14 normalized tags, bilingual (Arabic + English in the same array). */
  tags: string[];
  /** Read from the pixels — not inferred from a 14-sample statistical prior. */
  register: Register;
  energy: Energy;
  /** 3 = usable as a direct generation reference · 2 = partial (palette /
   *  blocking) · 1 = documentation only. Same scale the corpus already uses. */
  quality: 1 | 2 | 3;
}

/** The ten axes, in the order the bench renders and grades them. The bench
 *  grades PER AXIS, because "the read was wrong" teaches nothing — "the read
 *  nails light and lens but invents an inside state" is a fixable note.
 *
 *  `hint` is the grading standard in one line — it tells the grader what a
 *  RIGHT answer on this axis looks like, so a ✓ means the same thing on every
 *  frame. The bench UI is English-only by house law; the Arabic that matters
 *  lives in the READ (searchPhraseAr, tags), not in the chrome. */
export const EYE_AXES = [
  { key: 'subject', en: 'Subject', hint: 'who or what · count · age band · posture', layer: 1 },
  { key: 'place', en: 'Place', hint: 'named specifically · interior or exterior · its register', layer: 1 },
  { key: 'action', en: 'Action', hint: 'the verb of the frame', layer: 1 },
  { key: 'objects', en: 'Objects', hint: '3–6 concrete nouns actually visible', layer: 1 },
  { key: 'light', en: 'Light architecture', hint: 'every source named — key, fill, accent, kelvin, state', layer: 2 },
  { key: 'lens', en: 'Lens & frame', hint: 'size · tilt · camera height · focal feel · depth band', layer: 2 },
  { key: 'colour', en: 'Colour behaviour', hint: 'colour as behaviour, never an inventory of names', layer: 2 },
  { key: 'medium', en: 'Medium', hint: 'film or digital · grain · halation · the era of the image', layer: 2 },
  { key: 'time', en: 'Time & state', hint: 'hour · weather · operational state', layer: 2 },
  { key: 'inside', en: 'Inside state', hint: 'what is happening inside the subject in THIS frame', layer: 3 },
  { key: 'craftMove', en: 'The craft move', hint: 'what the photographer decided, not what the frame shows', layer: 3 },
  { key: 'culturalTruth', en: 'Cultural truth', hint: 'the detail that makes it real rather than staged', layer: 3 },
  { key: 'refusal', en: 'The refusal', hint: 'what is wrong with this frame — never "n/a"', layer: 3 },
  { key: 'searchPhrase', en: 'Search key', hint: 'EN + AR key and tags — how this frame gets found again', layer: 4 },
] as const;

export type EyeAxisKey = typeof EYE_AXES[number]['key'];

/** How Anwar grades one axis on the bench. */
export type AxisGrade = 'ok' | 'wrong';

/** One graded read, appended to eye_golden.jsonl. This file is BOTH the
 *  few-shot corpus for EYE_READ_SYS and the regression suite — a correction is
 *  never just a correction, it is the next version's evidence. */
export interface EyeGoldenEntry {
  ts: string;
  imagePath: string;
  imageHash: string;             // sha256 — survives the file moving or being renamed
  model: string;                 // which model produced this read
  read: EyeRead;
  axisGrades: Partial<Record<EyeAxisKey, AxisGrade>>;
  /** Anwar's own words for any axis he corrected — the training signal. */
  corrections: Partial<Record<EyeAxisKey, string>>;
  signedBy: string;
}

export interface EyeReadResult {
  ok: boolean;
  reason?: string;
  message?: string;
  read?: EyeRead;
  model?: string;
  imageHash?: string;
  /** Milliseconds the read took — the bench shows it, because a read that costs
   *  40s cannot run over 8,745 frames and we should learn that early. */
  ms?: number;
}

export interface EyeStatusResult {
  ok: boolean;
  root?: string;
  golden?: number;      // entries in eye_golden.jsonl
  gradedAxes?: number;  // total axis grades recorded — the real depth of the set
}
