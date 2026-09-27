// Pre-production suite — stage data shapes for the five standalone tools
// (Brief Mind → Treatment → References → Story → Pitch). These are the
// renderer-side types for what each tool persists via writeStageData();
// the bridge itself stays `unknown` (same contract BriefData uses).
//
// Design source: STUDY/creative_pipeline/01_PIPELINE_MAP.md §3 (the proposed
// schemas) + 00_THE_COUNCIL.md (the six personas the tools embody).

// ─── Stage 1 extension — Brief Mind (يكتب فوق BriefData الموجودة) ───────────

export interface BriefTerritory {
  /** Stable id — lets the mind canvas reference this territory across
   *  re-materializations. Assigned on creation; absent on legacy data. */
  id?: string;
  name: string;
  hook: string;          // one line that lands in any majlis
  insight: string;
  firstFrameHint: string;
  culturalTruth: string; // named noun — never "تراثنا"
}

export interface BriefCollision {
  /** Stable id (canvas entity ref) — see BriefTerritory.id. */
  id?: string;
  seed: string;          // card id or user seed
  machine: 'funnel' | 'collision' | 'invert' | 'transform';
  idea: string;
  kept: boolean;         // survived the kill-gate
}

/** One picked answer from the Creative Mind's visual questioning — the user
 *  chose a board of corpus frames instead of typing. Tags feed the collider;
 *  refIds keep provenance (which frames stood for the answer). */
export interface VisualAnswer {
  questionId: string;   // crafted-question slug (questions are brief-tailored)
  optionId: string;
  tags: string[];       // English tokens — collider + downstream tools
  refIds: string[];     // frame ids shown on the chosen board
  /** On-disk paths of the board's frames (_mind/boards/…) — the pictures the
   *  answer stood on, so the thinking canvas can SHOW them. Legacy answers
   *  without this field get resolved from refIds on first materialization. */
  refPaths?: string[];
  q?: string;           // the question text as asked (English base)
  a?: string;           // the picked option's label (English base)
}

/** Brief Mind writes the existing BriefData PLUS this thinking block
 *  (merged into the same stage-1 data object under these keys). */
export interface BriefMindExtras {
  species?: 'strategy' | 'project-management' | 'production-task';
  rawBrief?: string;
  proposition?: string;      // ONE sentence
  persona?: string;          // one named human, seen
  gaps?: string[];           // missing schema fields, as client-ready questions
  questionsLog?: string[];
  drawnCardIds?: string[];   // Saudi-DNA cards drawn as seeds
  collisions?: BriefCollision[];
  territories?: BriefTerritory[];
  bigIdea?: { territory: string; why: string };
  /** Creative Mind only — the visual world picked through the question scenes. */
  visualWorld?: VisualAnswer[];
}

// ─── Stage 4 — Treatment ────────────────────────────────────────────────────

export interface ChoicePairs {
  aspect: string;         // e.g. "4:3 — بيتي، ضد سينماسكوب المستورد"
  lens: string;
  lightDirection: string;
  cameraMove: string;
  hour: string;
  placeRegister: string;
}

export interface PagePlanRow {
  section: string;        // COVER / APPROACH / IDEA / VISUALS / WARDROBE / GRADE / CLOSE …
  text: string;           // ≤ 2 short paragraphs
  imageSpec: string;      // what the page's single image must be
}

export interface TreatmentData {
  readerProfile?: { ego?: string; busyness?: string; energy?: string; preset?: 8 | 25 | 50 };
  approach?: string;
  ideaStance?: { love?: string; expand?: string; keep?: string };
  visuals?: {
    choicePairs?: Partial<ChoicePairs>;
    threeReaderNotes?: { agency?: string; production?: string; dp?: string };
  };
  wardrobe?: { pieces?: string; negatives?: string[] };
  post?: { edit?: string; grade?: string; cgiRestraint?: boolean };
  firstFrame?: string;    // full 8-element house diagnostic
  lastFrame?: string;
  pagePlan?: PagePlanRow[];
  honestRisk?: string;
  updatedAt?: string;
}

// ─── Stage 2 — References (tag-driven browser hunt) ─────────────────────────
//
// Anwar's redesign (2026-07-08): references are NOT model-invented citations.
// TAGS are extracted from the previous stages (brief → idea → treatment →
// story), each tag is hunted on real reference sites (Frameset & friends)
// inside a visible browser window, the vision pass judges fit-to-story, and
// the chosen frames are DOWNLOADED into {project}/_references/ and shown here.

export type RefPalette = 'warm' | 'cool' | 'colorful' | 'mid';

/** A search site the hunt runs against. `urlTemplate` carries `{query}`. */
export interface RefSource {
  id: string;
  name: string;          // "Frameset", "Film Grab", …
  urlTemplate: string;   // e.g. https://frameset.app/search?q={query}
  enabled: boolean;
}

/** One hunted, captured, POV-judged reference. */
export interface HuntedRef {
  id: string;
  tag: string;           // the search query that found it
  intent?: string;       // the Creative 360 intent behind that query
  imagePath: string;     // local file inside {project}/_references/
  imageUrl?: string;     // original remote src
  sourceUrl?: string;    // the page it was found on
  sourceName?: string;
  why: string;           // fit-to-story reasoning (English base)
  take?: string;         // what we borrow — checkable in the frame
  leave?: string;        // what we refuse
  palette?: RefPalette;
  /** Per-axis rubric scores from the Creative 360 judge (0–5 each; total 0–25). */
  scores?: { literal: number; pov: number; craft: number; fit: number; antiCliche: number; total: number };
}

export interface ReferencesData {
  tags?: string[];       // searchable queries — the mind crafts, the user edits
  /** parallel to tags: the creative intent behind each query (same index). */
  intents?: string[];
  /** The feeling each tag chases, parallel to tags[] — written by craftQueries.
   *  Lets the eye reorder a deep harvest before the judge spends a call. */
  registers?: Array<string | null>;
  perTag?: number;       // how many refs to KEEP per query (user-controlled)
  lanes?: number;        // how many queries hunt CONCURRENTLY (parallel Chrome tabs)
  strictness?: 'strict' | 'lenient'; // judge bar (default strict)
  imageType?: 'frames' | 'motion';   // what to hunt — stills or motion clips
  sources?: RefSource[]; // user-controlled site list
  refs?: HuntedRef[];
  honestRisk?: string;
  updatedAt?: string;
}

// ─── Stage 5 — Story (screenplay) ──────────────────────────────────────────

export type BeatName = 'SETUP' | 'DESIRE' | 'CONFLICT' | 'CHANGE' | 'RESULT';

export interface StoryBeat {
  beat: BeatName;
  line: string;
  visualMetaphor: string; // externalize the internal — no event-listing
}

export interface AvBlock {
  scene: number;
  tcIn: number;           // seconds
  tcOut: number;
  visual: string;         // camera-able sentences, no mood words
  vo: string;             // dialect decided; novelist rhythm
  superSfx: string;
  transition: string;     // written, never implied
}

export interface ScreenplayData {
  /** Frozen handoff from Brief Mind + Treatment. Story never has to guess which
   * upstream idea it is writing from, and can detect stale downstream drafts. */
  source?: StorySourceContract;
  sourceFingerprint?: string;
  sourceSyncedAt?: string;
  beatsSourceFingerprint?: string;
  blocksSourceFingerprint?: string;
  gate?: { want?: string; tension?: string; change?: string; passed?: boolean };
  compass?: string;       // want–but–until — INTERNAL, never surfaces in Arabic copy
  emotionalQuestion?: string;
  beats?: StoryBeat[];
  blocks?: AvBlock[];
  budget?: { durationSec: 15 | 30 | 60; voWords: number; maxWords: number };
  dialect?: string;       // نجدية بيتية / حجازية / فصحى بيضاء — declared
  scriptText?: string;    // the exact text handed to the storyboard
  honestRisk?: string;
  updatedAt?: string;
}

export interface StorySourceContract {
  projectId: string;
  brief: {
    proposition: string;
    persona: string;
    intent: string;
    bigIdea: string;
    why: string;
    insight: string;
    culturalTruth: string;
    firstFrameHint: string;
    refusals: string[];
    visualWorld: string[];
  };
  treatment: {
    approach: string;
    love: string;
    expand: string;
    keep: string;
    choicePairs: Partial<ChoicePairs>;
    firstFrame: string;
    lastFrame: string;
    wardrobe: string;
    wardrobeNegatives: string[];
    edit: string;
    grade: string;
  };
  upstream: {
    briefUpdatedAt: string;
    treatmentUpdatedAt: string;
  };
  missing: string[];
}

// ─── Pitch (external deliverable — sidecar on stage 4 pagePlan) ────────────

export type PitchTheme = 'layl' | 'sahifa';

export type PitchAlign = 'start' | 'center' | 'end';
export type PitchDir = 'auto' | 'rtl' | 'ltr';

// Formatting for ONE text element (title or body) — each is its own layer, so
// the user resizes / re-aligns each independently. All fields optional.
// A movable/resizable text box, as fractions of the page (0..1).
export interface PitchBox { x: number; y: number; w: number; h: number; }

export interface PitchElemStyle {
  hidden?: boolean;       // layer visibility (eye toggle)
  locked?: boolean;       // lock toggle — can't be moved or selected on the canvas
  color?: string;         // text fill colour (#rrggbb)
  strokeColor?: string;   // text outline / border colour (#rrggbb)
  align?: PitchAlign;     // 'center' or undefined (edge, follows dir)
  dir?: PitchDir;         // text direction
  fontScale?: number;     // 0.6 .. 1.8, default 1 — scales THIS element only
  lineScale?: number;     // 0.8 .. 2.0, default 1 — multiplies THIS element's line-height
  fontKey?: string;       // id into the PITCH_FONTS table; absent = theme default
  weight?: number;        // 100..900 font weight; absent = theme default
  italic?: boolean;       // slant
  underline?: boolean;    // underline decoration
  bg?: string;            // solid fill behind the text box (#rrggbb) — also makes bars/cards
  box?: PitchBox;         // independent box position + size; absent = theme default
  styleRef?: string;      // linked paragraph style id — Update propagates to every linked layer
  noSig?: boolean;        // TITLE only: suppress the house accent dot (themes whose reference has none)
  rotate?: number;        // degrees clockwise around the box centre (vertical tabs etc.)
  flipH?: boolean;        // mirror horizontally
  flipV?: boolean;        // mirror vertically
  strokeWidth?: number;   // outline thickness in px (default 0.6)
  strokePos?: 'center' | 'outside' | 'inside'; // outline seat (inside ≈ centre in the web engine — approximation)
}

// Named paragraph style (Keynote-like). Text layers link via styleRef; editing
// the style + Update re-copies its props into every linked layer deck-wide.
// Propagation is by COPY, so render paths (DOM / PDF / harness) stay unchanged.
export interface PitchParaStyle {
  id: string;
  name: string;             // "Title", "Caption", ...
  style: PitchElemStyle;    // shared look — box/styleRef are never part of it
}

// Image-layer transforms — opacity, zoom, and pan (fractional offset of the
// container; 0,0 = centered cover). Absent = plain cover at full opacity.
export interface PitchImageStyle {
  hidden?: boolean;   // layer visibility (eye toggle)
  locked?: boolean;   // lock toggle — can't be moved or selected on the canvas
  opacity?: number;   // 0 .. 1, default 1
  fit?: 'cover' | 'contain';  // contain = whole image visible (PNG logos); default cover
  scrim?: boolean;    // Layl pages: false = suppress the house bottom gradient (light-paper themes)
  scale?: number;     // 1 = cover, up to ~3 = zoom in
  x?: number;         // pan -0.5 .. 0.5 of width
  y?: number;         // pan -0.5 .. 0.5 of height
}

// Per-page layout overrides — the layers editor writes here. All optional;
// absent = the theme's default composition. `panel` is a fractional anchor
// (0..1 of page width/height) for the whole text block so a move survives resize.
export interface PitchLayout {
  kicker?: PitchElemStyle;           // the SECTION label (Layl kicker / Sahifa deck)
  title?: PitchElemStyle;            // the headline element
  body?: PitchElemStyle;             // the paragraph element
  image?: PitchImageStyle;           // the background / media image transforms
  panel?: { x: number; y: number };  // deprecated — superseded by per-element box
}

// A user-added layer — free-floating text or image with its own box.
export interface PitchExtraLayer {
  id: string;
  kind: 'text' | 'image';
  name?: string;                 // user-editable layer name (shown in the list)
  box: PitchBox;                 // position + size (fractions of the page)
  hidden?: boolean;              // eye toggle
  locked?: boolean;              // lock toggle — can't be moved or selected on the canvas
  text?: string;                 // kind 'text' — the copy
  style?: PitchElemStyle;        // kind 'text' — font / weight / dir / align / size / line
  imagePath?: string;            // kind 'image' — the placed image
  image?: PitchImageStyle;       // kind 'image' — opacity / zoom / pan
  imageSource?: 'reference' | 'storyboard' | 'library' | 'file';
}

export interface PitchPage {
  section: string;
  titleText?: string;     // the headline copy (its own input); absent → section-derived
  text: string;           // the body copy
  bgColor?: string;       // page background colour (#rrggbb); absent = theme default
  imagePath?: string;     // resolved MADE frame / signed reference — required to ship
  imageSpec?: string;     // what to make if not yet resolved
  imageSource?: 'reference' | 'storyboard' | 'library' | 'file'; // where the image came from
  imageWhy?: string;      // Creative 360's one-line reason for an auto-fitted image
  layout?: PitchLayout;   // layers-editor overrides (position / align / dir / size)
  extras?: PitchExtraLayer[]; // user-added text / image layers
  layoutPreset?: string;  // id of the applied theme layout (theme system)
  order?: string[];       // layer stacking, bottom→top (keys: image/kicker/title/body/<extra id>)
  /** Creative Graph provenance — pages turn stale when their source nodes change. */
  sourceNodeIds?: string[];
  sourceVersions?: Record<string, number>;
  sourceFingerprint?: string;
  claim?: string;
}

export interface PitchData {
  theme?: PitchTheme;
  themeId?: string;       // selected theme-system theme (e.g. 'equip'); drives per-page layouts
  aspect?: number;        // slide aspect ratio (w/h); absent = A4 print (297/210)
  preset?: 8 | 25 | 50;
  clientDirect?: boolean; // adds product/talent/equipment/budget pages
  slug?: string;          // running header: CLIENT / CAMPAIGN / HJEN
  slugStyle?: PitchElemStyle; // running header/footer look — box (draggable), colour, size; SAME on every page, always above every layer
  palette?: string[];     // project colour palette — saved swatches (ColorDot)
  paraStyles?: PitchParaStyle[]; // named paragraph styles — layers link via styleRef
  pages?: PitchPage[];
  manifestFingerprint?: string;
  graphRevision?: number;
  lastExportPath?: string;
  updatedAt?: string;
}
