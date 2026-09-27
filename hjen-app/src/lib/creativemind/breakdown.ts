// Ad Breakdown 360 — تشريح الإعلان. A world-class ad, reverse-engineered under
// the governing premise "this ad was MADE by HJEN as an AI film": eleven craft
// axes (each a set of atomic findings with frame evidence) plus the HJEN
// pipeline reconstructed BACKWARDS (brief → beats → references → treatment →
// pitch). Breakdowns are authored offline (STUDY/ad_breakdowns/pipeline),
// installed under {projectsRoot}/_mind/breakdowns/<slug>/, and the app only
// LOADS and RENDERS them — the JSON is the source of truth; canvas nodes are
// references (importNotesOnCanvas discipline).
//
// Every draggable thing carries a stable id — 'bd-<slug>/<axis-or-stage>/<nn>'.
// Ids use '/' internally (never ':') because mindcanvas entity refs are
// '{kind}:{id}' and parseEntity splits on the FIRST colon only.

export type BreakdownBeat = 'SETUP' | 'DESIRE' | 'CONFLICT' | 'CHANGE' | 'RESULT';

export type AxisKey =
  | 'visuals' | 'wardrobe' | 'characters' | 'action' | 'theme-look'
  | 'cinematography' | 'grading-color' | 'edit' | 'story' | 'brief' | 'message';

export const AXIS_KEYS: AxisKey[] = [
  'visuals', 'wardrobe', 'characters', 'action', 'theme-look',
  'cinematography', 'grading-color', 'edit', 'story', 'brief', 'message',
];

export interface BreakdownFrame {
  id: string;                    // 'f012'
  file: string;                  // absolute path once read via IPC (installed: relative 'frames/f012.jpg')
  t?: number;                    // seconds into the ad
  beat?: BreakdownBeat;
}

/** ONE craft fact — the same one-fact-per-card discipline as the DNA cards. */
export interface BreakdownElement {
  id: string;
  claim_en: string;
  claim_ar?: string;
  howHjenMakesIt?: string;       // the HJEN control that MAKES this fact (the premise line)
  frameIds: string[];
  dimension?: string;            // one of the 18 corpus dimensions when it maps
  tags?: string[];
  weight?: 1 | 2 | 3;            // 3 = a law of this ad · 1 = flavor
}

export interface BreakdownAxis {
  key: AxisKey;
  title_en: string;
  title_ar: string;
  summary?: string;              // the axis's one-line thesis
  heroFrameIds: string[];        // 3–4 representative frames for the strip
  findings: BreakdownElement[];
  /** OUTPUT 1 — "THE MAKE PROMPT". The single master description that, given to
   *  an AI model, would reproduce THIS ad's RESULT on THIS axis alone (visuals
   *  alone, music alone, wardrobe alone…). Absent on old installed breakdowns
   *  (they show the existing evidence-only view). */
  reproductionPrompt?: string;
}

export interface BreakdownBeatRow {
  id: string;
  beat: BreakdownBeat;
  visual: string;
  vo?: string;
  frameIds: string[];
}

export interface BreakdownReference { id: string; note: string; frameIds: string[] }
export interface BreakdownPitchPage { id: string; title: string; body: string; frameId?: string }

// ─── OUTPUT 2 — the pre-production package, authored as client-facing documents
// ("what if we went back in time, before production, to win the client's
// approval"). Every one of these is ADDITIVE: absent → the stage page shows its
// existing pending state, so old installed breakdowns render unchanged.

export interface BreakdownStoryBeat {
  beat: BreakdownBeat;
  line: string;                  // this beat written as narrative
  metaphor?: string;             // the externalizing visual metaphor
}
/** STORY — how we would WRITE it (want-but-until + written narrative + beats). */
export interface BreakdownStory {
  id: string;
  wantButUntil: string;
  emotionalQuestion?: string;
  narrative: string;             // the written narrative prose
  beats: BreakdownStoryBeat[];
}

/** ONE reference to attach to reach a result identical to the deconstructed ad.
 *  · 'ad-frame' — an evidence frame from THIS ad (ref = a frame id, e.g. "f014");
 *  · 'external' — a described reference to source (from the reference hunt).
 *  `purpose` = the single thing it locks (palette / skin / wardrobe / location /
 *  motion / composition…). This is the concrete attachment list. */
export interface RefAttach { kind: 'ad-frame' | 'external'; ref: string; purpose: string }

/** THE MASTER PROMPT — the convergence. The 13 separated craft axes recombined
 *  into ONE executable per-shot prompt, in two forms (frame / video), plus the
 *  references to attach to reach an identical result. Additive: shots on
 *  breakdowns made before this stage carry no masterPrompt → the shotlist shows a
 *  pending / MAKE state, and nothing regresses. */
export interface ShotMasterPrompt {
  /** A plain, GENERAL one/two-sentence description of what happens in the shot —
   *  ordinary language, NONE of the 13 craft details (no lens/light/grade/etc.).
   *  Sits above the image prompt. Additive; older master prompts lack it. */
  description?: string;
  frame: string;                 // the fused single cinematic image-gen paragraph
  video: string;                 // the same, evolved for motion (video model)
  references: RefAttach[];       // the concrete attachment list
}

/** A reference the user attaches LIVE to a shot to steer its makes — an image
 *  (fed to MAKE FRAME as a reference, and to MAKE VIDEO as an optional end-frame
 *  anchor) or a video/clip (motion reference, described in the video appendix).
 *  `role` decides which make(s) it feeds; `note` is the editable one-liner that
 *  travels with the prompt as the appendix. Additive — rows without it are
 *  unchanged. */
export interface ShotAttachment {
  id: string;
  path: string;                          // absolute local path
  kind: 'image' | 'video';
  note?: string;                         // editable — what it contains / its role
  role?: 'both' | 'frame' | 'video';     // which make it feeds (default 'both')
  /** When this live reference was DROPPED from a generated entity reference (a
   *  person's FACE or character SHEET, a place, an asset), this links back to it
   *  so UPDATE re-pulls the entity's LATEST built version automatically — no file
   *  picker. A person raises TWO refs (face + sheet), so they carry distinct
   *  kinds. Absent on manually-attached files. Legacy 'person' == the sheet. */
  source?: { kind: 'person-face' | 'person-sheet' | 'person' | 'place' | 'asset'; id: string };
}

export interface BreakdownShotRow {
  no: number;
  tc?: string;                   // timecode into the film, e.g. "0:03"
  beat?: string;
  size?: string;                 // WS / MS / CU…
  lens?: string;
  move?: string;
  description: string;
  masterPrompt?: ShotMasterPrompt;   // OUTPUT 3 — the fused per-shot master prompt
  /** OUTPUT 4 — the frame HJEN's image model MADE from this shot's fused FRAME
   *  prompt, for side-by-side comparison against the original ad frame. ABSOLUTE
   *  path to the saved image in the project library. Additive: rows without it
   *  simply show an empty MADE cell, so older breakdowns render unchanged. */
  madeFrame?: { path: string; at: string };
  /** OUTPUT 5 — the motion clip HJEN's video model MADE from this shot's fused
   *  VIDEO prompt, using `madeFrame` as its first frame. ABSOLUTE path to the
   *  saved video in the project library. Additive: rows without it show no video,
   *  so older breakdowns render unchanged. Requires `madeFrame` to exist first. */
  madeVideo?: { path: string; at: string };
  /** OUTPUT 6 — references the user attached LIVE to steer this shot's makes.
   *  Additive; absent on older breakdowns. */
  attachments?: ShotAttachment[];
}
/** SHOTLIST — the numbered shot table (no · tc · beat · size · lens · move · desc). */
export interface BreakdownShotlist { id: string; rows: BreakdownShotRow[] }

// ─── ENTITIES — the ad's people + places, understood and LINKED across shots ──
// One person = ONE locked reference frame, reused across their shots (not a fresh
// ref per shot). The Connect member of the Second Brain: entities are nodes
// linked across the ad's shots. Additive — absent on older breakdowns.
/** A MADE clean reference image for an entity — generated once, then linked to
 *  every shot the entity appears in so each shot's makes reuse it. `at` is the
 *  stable identity of one build (the append-only history keys + active pointer
 *  reference it). */
export interface BuiltRef { path: string; at: string }
export interface BreakdownPerson {
  id: string;                 // 'P1'…
  descriptor: string;         // apparent age, build, distinctive features (short, for display)
  wardrobe?: string;          // the ad's kit (kept as its own ASSET — NOT baked into the identity refs)
  /** A SELF-CONTAINED PHYSICAL-IDENTITY prompt — age, build, skin, FACE, hair,
   *  distinctive features — with NO clothing (so the person can later be dressed
   *  freely). Text only, needs NO video/frame. Survives into the forward pipeline. */
  prompt?: string;
  refFrameId: string;         // provenance — the ad frame we saw them in (NOT a build input)
  shotNos: number[];          // shots they appear in
  /** Persons get TWO built references: a shoulders-up FACE (bare, white-grey bg)
   *  and a 3-angle character SHEET in neutral logo-free clothing. Each is an
   *  APPEND-ONLY history — BUILD AGAIN appends, never overwrites — with an active
   *  pointer (`at`). The ACTIVE sheet is what links to shots. Legacy single
   *  `builtFace`/`builtSheet` are read as a one-element history. */
  builtFaces?: BuiltRef[];
  activeFaceAt?: string;
  builtSheets?: BuiltRef[];
  activeSheetAt?: string;
}
export interface BreakdownPlace {
  id: string;                 // 'L1'…
  descriptor: string;
  prompt?: string;
  refFrameId: string;
  shotNos: number[];
  /** Append-only build history + active pointer (`at`). The ACTIVE ref is the
   *  card thumb and what links to shots. Legacy single `builtRef` = one-element. */
  builtRefs?: BuiltRef[];
  activeRefAt?: string;
}
/** A buildable ASSET of the ad other than person/place — a prop (ball, racket,
 *  equipment) or a signature wardrobe look — that recurs and can be MADE once as
 *  a clean reference and reused across its shots. */
export interface BreakdownAsset {
  id: string;                 // 'A1'…
  kind: 'prop' | 'wardrobe';
  descriptor: string;
  prompt?: string;            // self-contained build prompt (text only, no video)
  refFrameId: string;
  shotNos: number[];
  /** Append-only build history + active pointer (`at`). Legacy single `builtRef`
   *  = one-element history. */
  builtRefs?: BuiltRef[];
  activeRefAt?: string;
}
export interface BreakdownEntities {
  persons: BreakdownPerson[];
  places: BreakdownPlace[];
  assets?: BreakdownAsset[];  // props + wardrobe (additive — older rosters lack it)
}

/** PITCH — the page-by-page deck plan (title + content + visual slot). */
export interface BreakdownPitchPagePlan {
  id: string;
  title: string;
  content: string;               // the page's copy / argument
  visualSlot: string;            // what image fills the page's frame slot
}

export interface BreakdownReferenceHuntItem {
  title: string;                 // named reference — search axis or citation
  take: string;                  // what to take from it
  leave: string;                 // what to leave behind
  frameIds?: string[];
}
/** REFERENCES — the hunt: named search axes + reference descriptions w/ take/leave. */
export interface BreakdownReferenceHunt {
  id: string;
  axes: string[];                // the named search axes we would hunt along
  items: BreakdownReferenceHuntItem[];
}

export interface ReversePipeline {
  brief: {
    id: string;
    rawBrief: string;            // the brief that MUST have produced this ad
    proposition: string;
    persona: string;
    bigIdea: { name: string; hook: string; insight: string; culturalTruth?: string };
  };
  beats: BreakdownBeatRow[];
  wantButUntil?: string;
  references: BreakdownReference[];
  treatment: {
    id: string;
    choicePairs: {
      aspect: string; lens: string; lightDirection: string;
      cameraMove: string; hour: string; placeRegister: string;
    };
    lookPhrase: string;          // the one named look philosophy
    prose?: string;              // OUTPUT 2 — the detailed treatment prose
    firstFrameId?: string;
    lastFrameId?: string;
  };
  pitch: BreakdownPitchPage[];
  // ─── OUTPUT 2 additive documents ───
  story?: BreakdownStory;
  shotlist?: BreakdownShotlist;
  pitchPages?: BreakdownPitchPagePlan[];
  referencesHunt?: BreakdownReferenceHunt;
  /** OUTPUT 7 — the ad's people + places, linked across shots (entity understanding). */
  entities?: BreakdownEntities;
}

export interface AdBreakdown {
  version: 1;
  id: string;                    // 'bd-<slug>'
  slug: string;
  ad: {
    title: string; brand: string; year?: string; director?: string;
    durationS?: number; sourceUrl?: string;
    logline_ar?: string; logline_en?: string;
    premise: 'made-by-hjen';
  };
  frames: BreakdownFrame[];
  axes: BreakdownAxis[];
  pipeline: ReversePipeline;
  approved?: boolean;            // Anwar's seal on the SHAPE of the breakdown
  createdAt: string;
  model?: string;
  /** ABSOLUTE path to the ingested source film (source.<ext> beside the
   *  breakdown), resolved by the main process on read. Absent on breakdowns
   *  whose source video was never kept → the WATCH link falls back to
   *  ad.sourceUrl, or hides entirely. */
  sourcePath?: string;
}

export interface BreakdownSummary {
  slug: string; title: string; brand: string; approved: boolean; frames: number;
}

// ─── My Mind — the personal template (Phase B; schema frozen now) ───────────

export interface MyMindItem {
  id: string;                    // 'mm-<ts>-<rand>'
  source: {
    breakdownId: string; breakdownSlug: string; elementId: string;
    adTitle: string; brand: string;
    axis?: AxisKey | 'pipeline'; stage?: string;
  };
  claim_en: string;              // DENORMALIZED — survives breakdown deletion
  claim_ar?: string;
  howHjenMakesIt?: string;
  framePaths: string[];          // absolute paths into the breakdown's frames/
  dimension?: string;
  tags?: string[];
  addedAt: string;
}

// ─── loaders ─────────────────────────────────────────────────────────────────

export async function listBreakdowns(): Promise<BreakdownSummary[]> {
  try {
    const res = await window.hjen.mindBreakdownsList();
    return res?.ok ? res.breakdowns : [];
  } catch { return []; }
}

/** Read one breakdown; frame `file` paths come back ABSOLUTE from the main
 *  process, so bodies can render `hjen-file://` URLs directly. */
export async function readBreakdown(slug: string): Promise<AdBreakdown | null> {
  try {
    const res = await window.hjen.mindBreakdownRead({ slug });
    return res?.ok ? (res.breakdown as AdBreakdown) : null;
  } catch { return null; }
}

export async function approveBreakdown(slug: string, approved: boolean): Promise<boolean> {
  try {
    const res = await window.hjen.mindBreakdownApprove({ slug, approved });
    return !!res?.ok;
  } catch { return false; }
}

/** Rename a breakdown's DISPLAY TITLE (ad.title). The folder slug — the identity
 *  key referenced by dna/, sourcePath, job nav, and My-Mind provenance — never
 *  changes. Returns the saved title on success. */
export async function renameBreakdown(slug: string, title: string): Promise<{ ok: boolean; title?: string; message?: string }> {
  try {
    return await window.hjen.mindBreakdownRename({ slug, title });
  } catch (e: any) { return { ok: false, message: String(e?.message || e) }; }
}

/** Delete a breakdown — removes its whole install folder. Irreversible. */
export async function deleteBreakdown(slug: string): Promise<{ ok: boolean; message?: string }> {
  try {
    return await window.hjen.mindBreakdownDelete({ slug });
  } catch (e: any) { return { ok: false, message: String(e?.message || e) }; }
}

// ─── element resolution (the drag-to-My-Mind currency) ──────────────────────

export interface ResolvedElement {
  element: BreakdownElement;
  axis?: AxisKey | 'pipeline';
  stage?: string;                // 'brief' | 'beat' | 'reference' | 'treatment' | 'pitch'
  framePaths: string[];
}

function framePaths(bd: AdBreakdown, frameIds: string[]): string[] {
  const byId = new Map(bd.frames.map(f => [f.id, f.file]));
  return frameIds.map(id => byId.get(id) ?? '').filter(Boolean);
}

/** Resolve ANY stable id inside a breakdown (axis finding, beat, reference,
 *  brief, treatment, pitch page) to one normalized shape. */
export function findBreakdownElement(bd: AdBreakdown, id: string): ResolvedElement | null {
  for (const axis of bd.axes) {
    const hit = axis.findings.find(f => f.id === id);
    if (hit) return { element: hit, axis: axis.key, framePaths: framePaths(bd, hit.frameIds) };
  }
  const p = bd.pipeline;
  if (p.brief.id === id) {
    return {
      element: {
        id, claim_en: p.brief.proposition,
        claim_ar: undefined,
        howHjenMakesIt: `Big Idea "${p.brief.bigIdea.name}" — ${p.brief.bigIdea.hook}`,
        frameIds: [], tags: ['brief'],
      },
      axis: 'pipeline', stage: 'brief', framePaths: [],
    };
  }
  const beat = p.beats.find(b => b.id === id);
  if (beat) {
    return {
      element: {
        id, claim_en: `${beat.beat}: ${beat.visual}`, claim_ar: undefined,
        howHjenMakesIt: beat.vo ? `VO: ${beat.vo}` : undefined,
        frameIds: beat.frameIds, tags: ['beat', beat.beat.toLowerCase()],
      },
      axis: 'pipeline', stage: 'beat', framePaths: framePaths(bd, beat.frameIds),
    };
  }
  const ref = p.references.find(r => r.id === id);
  if (ref) {
    return {
      element: { id, claim_en: ref.note, frameIds: ref.frameIds, tags: ['reference'] },
      axis: 'pipeline', stage: 'reference', framePaths: framePaths(bd, ref.frameIds),
    };
  }
  if (p.treatment.id === id) {
    const c = p.treatment.choicePairs;
    return {
      element: {
        id,
        claim_en: p.treatment.lookPhrase,
        howHjenMakesIt: `aspect ${c.aspect} · lens ${c.lens} · light ${c.lightDirection} · move ${c.cameraMove} · hour ${c.hour} · place ${c.placeRegister}`,
        frameIds: [p.treatment.firstFrameId, p.treatment.lastFrameId].filter((x): x is string => !!x),
        tags: ['treatment', 'look'],
      },
      axis: 'pipeline', stage: 'treatment',
      framePaths: framePaths(bd, [p.treatment.firstFrameId, p.treatment.lastFrameId].filter((x): x is string => !!x)),
    };
  }
  const page = p.pitch.find(pg => pg.id === id);
  if (page) {
    return {
      element: {
        id, claim_en: `${page.title} — ${page.body}`,
        frameIds: page.frameId ? [page.frameId] : [], tags: ['pitch'],
      },
      axis: 'pipeline', stage: 'pitch',
      framePaths: framePaths(bd, page.frameId ? [page.frameId] : []),
    };
  }
  return null;
}

export function newMyMindItem(bd: AdBreakdown, resolved: ResolvedElement): MyMindItem {
  const e = resolved.element;
  return {
    id: `mm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    source: {
      breakdownId: bd.id, breakdownSlug: bd.slug, elementId: e.id,
      adTitle: bd.ad.title, brand: bd.ad.brand,
      axis: resolved.axis, stage: resolved.stage,
    },
    claim_en: e.claim_en,
    claim_ar: e.claim_ar,
    howHjenMakesIt: e.howHjenMakesIt,
    framePaths: resolved.framePaths,
    dimension: e.dimension,
    tags: e.tags,
    addedAt: new Date().toISOString(),
  };
}

export async function loadMyMind(): Promise<MyMindItem[]> {
  try {
    const res = await window.hjen.myMindRead();
    return res?.ok ? (res.items as MyMindItem[]) : [];
  } catch { return []; }
}

export async function saveMyMind(items: MyMindItem[]): Promise<void> {
  try { await window.hjen.myMindWrite({ items }); } catch { /* next edit retries */ }
}
