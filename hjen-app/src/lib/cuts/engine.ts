// Cuts Engine 1.0 — internal, standalone (NOT wired into breakdown).
//
// Three stages:
//   0. analyzeVideo()  — native ffmpeg: probe + HARD-CUT detection + one thumb
//      per shot + a full-length filmstrip. Deterministic signal, no model.
//   1. groupScenes()   — وكيل الكت: a vision pass that groups consecutive shots
//      that share ONE physical location into named scenes.
//   2. pickKeyframes() — وكيل اختيار الصورة: per shot, a vision pass that picks
//      the single most representative frame (the one where the subject reads),
//      even when the subject only enters mid-shot.
//
// Cut detection is signal processing (ffmpeg scene-score), NOT an LLM — a model
// there would be slower and less exact. The model earns its place in the two
// SEMANTIC jobs above.

import { llmForTask } from '../models/registry';

export interface CutCandidate { id: string; abs: string; t: number }

// Perception layer — what a shot IS (place + people + wardrobe), distilled to
// text so grouping reasons over identity, not raw pixels of one blurry frame.
export interface ShotSubject {
  sex?: string; build?: string; skinTone?: string; hair?: string;
  wardrobe?: string;   // durable: colours + garments + pattern + number/emblem
  activity?: string;   // what the person is doing
}
export interface ShotPerception {
  place: { kind: string; inOut?: string; backdrop?: string };
  subjects: ShotSubject[];
  action?: string;
  shotSize?: string;
}

// Local visual-identity vectors (L2-normalised) from the embedding sidecar.
export interface CutEmbed {
  face?: number[] | null;    // FaceNet — strongest identity, present only when a face is visible
  person?: number[] | null;  // DINOv2 on the person crop — appearance fallback
  scene?: number[] | null;   // DINOv2 on the full frame — location signal
  hasFace?: boolean;
}

export interface CutShot {
  i: number;                 // 1-based shot number
  start: number;             // seconds
  end: number;               // seconds
  dur: number;               // seconds
  thumb: string;             // absolute path — mid-shot representative thumb
  perception?: ShotPerception; // filled by describeShots() (Agent 1, phase A)
  emb?: CutEmbed;            // local visual-identity vectors (Agent 1, phase B)
  sceneId?: string;          // assigned by groupScenes()
  keyframe?: string;         // absolute path — chosen by pickKeyframes()
  keyframeT?: number;        // timecode of the chosen keyframe
  candidates?: CutCandidate[]; // frames the picker chose among
  pickReason?: string;       // why the picker chose it
  context?: string;          // this shot's role in the whole ad (from comprehension)
  brief?: ShotBrief;         // deep description + master prompt (Phase 2/3)
}

export interface CutScene {
  id: string;
  label: string;             // e.g. "محطة القطار — الرصيف"
  color: string;             // timeline color
  shots: number[];           // shot numbers (1-based) in this scene
}

// A recurring MAIN character, grouped across the whole ad (independent of place).
export interface CutPerson {
  id: string;                // p1, p2…
  name: string;              // short label / name if identifiable ("The runner")
  description: string;       // who they are + their role in the ad
  appearance: string;        // general build — age range, build, hair, features
  expression: string;        // general expression / emotional register across shots
  wardrobe: string;          // clothing, piece by piece
  color: string;             // list + lane color
  shots: number[];           // shot numbers this person appears in
  keyShot?: number;          // representative shot for the thumbnail
}

// The ad's shared visual DNA — read once, injected into every master prompt so
// all frames share one look. Faithful reverse-read, no recast.
export interface CutDna {
  intent: string;    // one-line: what the ad is doing
  look: string;      // prose look block
  palette: string;
  film: string;      // stock / grade / texture
  lighting: string;  // light logic
  lens: string;      // lens & optics language
  era: string;
  mood: string;
  grain: string;
  aspect: string;
}

// Whole-ad comprehension — a wide eye on the world BEFORE any shot is described.
// Narrative, events, the full environment (revealed across all shots), and the
// continuity facts (a subject's orientation/direction/state set up by adjacent
// shots) that a single shot's frames cannot show on their own.
export interface CutStory {
  synopsis: string;    // what the ad is about, beat by beat
  world: string;       // the full place/environment assembled from every shot
  continuity: string;  // cross-shot facts: who/where, directions, state carried between shots
}

// Top-tier per-shot description — the eight elements + explicit camera control.
export interface ShotCamera {
  shotSize: string;  // ECU / CU / MCU / MS / MLS / WS / EWS
  lens: string;      // focal length + character, e.g. "35mm, mild wide"
  angle: string;     // eye-level / low / high / overhead / dutch
  height: string;    // camera height relative to subject
  movement: string;  // static / pan / tilt / dolly / track / handheld / crane / whip
  dof: string;       // depth of field + focus plane
}
export interface ShotBrief {
  subject: string;        // subject state, posture, action, eye-line, hands
  wardrobe: string;       // piece-by-piece (from the entity canon — consistent)
  blocking: string;       // position in frame, distance, angle to lens
  light: string;          // every source: key / fill / rim / ambient, temp, direction
  camera: ShotCamera;
  colour: string;         // the actual palette: skin/wardrobe/environment/grade bias
  frameFurniture: string; // foreground / mid / background plates
  time: string;           // time of day, light state, operational state
  mood: string;
  inside: string;         // one sentence — what's happening inside the subject
  prompt: string;         // the compiled MASTER PROMPT (top-tier, text-only, faithful)
}

export interface CutStripFrame { t: number; path: string }

// A timecoded speech segment — voice-over or on-screen dialogue.
export interface SpeechSegment {
  type: 'vo' | 'dialogue';
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface CutSessionMeta {
  sessionId: string; title?: string; videoPath?: string;
  duration?: number; shots?: number; scenes?: number; savedAt?: number;
  projectSlug?: string; project?: string;   // which project bucket this session lives in
}

// ── Edit timeline — editable tracks the user assembles from Takes ───────────
// Additive to the read-only transcription lanes. A clip is a Take (a made frame
// or video, or a dropped shot keyframe) placed on a track at a timeline time.
export interface CutClip {
  id: string;
  srcKind: 'frame' | 'video';  // what was dropped
  src: string;                 // absolute path (image or .mp4)
  thumb?: string;              // poster/thumb path
  label?: string;
  start: number;               // timeline position (seconds)
  dur: number;                 // timeline length (seconds)
  /** In-point into the SOURCE media where this clip begins. Source time at a
   *  timeline position t = srcIn + (t - start). Default 0. */
  srcIn?: number;
  /** Total source-media length (seconds) if known (video clips). Used to clamp
   *  the out-point when trimming. Undefined for images (any length allowed). */
  srcDur?: number;
  /** Links a video clip to the audio clip that came down with it (A/V pair) —
   *  move/trim/delete act on both. */
  linkId?: string;
  /** Per-clip transform applied to the composited monitor overlay. Defaults:
   *  x=0, y=0 (px offset from centre), scale=1, rotate=0 (deg), opacity=1. */
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  opacity?: number;
}
export interface CutTrack {
  id: string;
  kind: 'video' | 'audio';
  label: string;
  hidden?: boolean;
  clips: CutClip[];
}

export interface CutsAnalysis {
  sessionId: string;
  title?: string;
  videoPath: string;
  projectSlug?: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  dir: string;
  shots: CutShot[];
  strip: CutStripFrame[];
  scenes: CutScene[];
  speech?: SpeechSegment[];
  people?: CutPerson[];
  dna?: CutDna;         // shared look, injected into every master prompt
  story?: CutStory;     // whole-ad comprehension, injected into every master prompt
  sourceUrl?: string;   // the YouTube link if fetched; empty for a local pick
  tracks?: CutTrack[];              // editable edit-timeline tracks (video/audio)
  laneHidden?: Record<string, boolean>;  // per-lane hide state for the read-only lanes
}

// A fresh empty track of the given kind, numbered against existing tracks.
export function makeTrack(kind: 'video' | 'audio', existing: CutTrack[]): CutTrack {
  const n = existing.filter(t => t.kind === kind).length + 1;
  return {
    id: `${kind[0]}trk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    kind, label: `${kind === 'video' ? 'Video' : 'Audio'} ${n}`, hidden: false, clips: [],
  };
}

// The two default tracks a session opens with.
export function defaultTracks(): CutTrack[] {
  return [
    { id: 'vtrk-1', kind: 'video', label: 'Video 1', hidden: false, clips: [] },
    { id: 'atrk-1', kind: 'audio', label: 'Audio 1', hidden: false, clips: [] },
  ];
}

// Distinct, legible scene hues (dark-UI safe).
export const SCENE_COLORS = [
  '#E8833A', '#4C9AE8', '#6FBF73', '#C86FD9', '#E8C84C',
  '#E85C6F', '#4CC6C0', '#B8926A', '#8A7FE8', '#9FBF3F',
];

// Distinct from SCENE_COLORS so People and Scenes never read as the same coding.
export const PERSON_COLORS = [
  '#3FB6C4', '#E86FA6', '#7E86F0', '#D9A441', '#5FBF8A',
  '#C8574C', '#9B6FD9', '#4C86E8', '#B8A24C', '#E8845C',
];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'video';
}

// Stable short hash so the same video path always maps to the same session.
function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Robust JSON extraction from a model reply (strips fences, slices to the object).
function parseJsonLoose(text: string): any {
  let t = (text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

async function mapPool<T, R>(items: T[], cap: number, worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(cap, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

// ── Stage 0 · analyze (native) ──────────────────────────────────────
export async function analyzeVideo(opts: {
  videoPath: string; projectSlug?: string; threshold?: number; title?: string;
}): Promise<CutsAnalysis> {
  const base = opts.videoPath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'video';
  // Stable per video path — re-analyzing the same file reopens the same session.
  const sessionId = `${slugify(base)}-${hashStr(opts.videoPath)}`;
  const res = await window.hjen.cutsAnalyze({
    sessionId, videoPath: opts.videoPath, projectSlug: opts.projectSlug, threshold: opts.threshold,
  });
  if (!res.ok) throw new Error(res.message || res.reason || 'analyze failed');
  return {
    sessionId, title: opts.title || base, videoPath: opts.videoPath, projectSlug: opts.projectSlug,
    duration: res.duration || 0, fps: res.fps || 25, width: res.width || 0, height: res.height || 0,
    dir: res.dir || '', shots: (res.shots || []).map(s => ({ ...s })), strip: res.strip || [], scenes: [],
  };
}

// ── Persistence — Cuts Engine projects ──────────────────────────────
export async function saveSession(analysis: CutsAnalysis): Promise<void> {
  try {
    await window.hjen.cutsSave({ projectSlug: analysis.projectSlug, sessionId: analysis.sessionId, data: analysis });
  } catch { /* save is best-effort */ }
}

export async function listSessions(projectSlug?: string): Promise<CutSessionMeta[]> {
  const r = await window.hjen.cutsList({ projectSlug });
  return r.ok ? (r.sessions || []) : [];
}

export async function loadSession(projectSlug: string | undefined, sessionId: string): Promise<CutsAnalysis | null> {
  const r = await window.hjen.cutsLoad({ projectSlug, sessionId });
  if (!r.ok || !r.data) return null;
  const a = r.data as CutsAnalysis;
  return { ...a, projectSlug, scenes: a.scenes || [], shots: a.shots || [], strip: a.strip || [] };
}

export async function deleteSession(projectSlug: string | undefined, sessionId: string): Promise<boolean> {
  const r = await window.hjen.cutsDelete({ projectSlug, sessionId });
  return !!r.ok;
}

// ── Stage 1 · Agent 1 = PERCEPTION → GROUP ──────────────────────────
// Phase A: describe each shot (place + people + wardrobe) to reliable text.
// Phase B: group from those descriptions by location + primary-subject
// continuity — so a montage of different athletes/places is NOT over-merged.

const DESCRIBE_SYSTEM = `You are the perception stage of a shot-analysis mind. You are given a few frames from ONE continuous camera shot. Describe only what is objectively visible, and prioritise DURABLE identity cues — the things that let a later stage recognise the SAME place or the SAME person again in other shots, even when the framing changes.
- Setting: the kind of place, indoor or outdoor, and its persistent spatial features (architecture, surfaces, structures, horizon, signage, backdrop) — the parts that stay constant regardless of camera position.
- People: for each prominent person, the durable cues that survive a change of shot size or angle — build, skin tone, hair, and above all WARDROBE described precisely by colour, garment type, pattern, and any number or emblem. Avoid fleeting details.
Return STRICT JSON only, no prose:
{"place":{"kind":"<specific kind of place>","inOut":"indoor|outdoor","backdrop":"<distinctive persistent features>"},"subjects":[{"sex":"m|f|unknown","build":"","skinTone":"","hair":"","wardrobe":"<colours + garments + pattern + number/emblem>","activity":"<what they are doing>"}],"action":"<one phrase>","shotSize":"WS|MS|CU|ECU"}`;

// Describe a single shot from a few sampled frames.
export async function describeShot(analysis: CutsAnalysis, shot: CutShot, count = 3): Promise<ShotPerception | null> {
  const res = await window.hjen.cutsShotFrames({
    sessionId: analysis.sessionId, videoPath: analysis.videoPath, projectSlug: analysis.projectSlug,
    shotIndex: shot.i, start: shot.start, end: shot.end, count,
  });
  const frames = res.ok ? (res.frames || []) : [];
  if (!frames.length) return null;
  if (!shot.candidates?.length) shot.candidates = frames; // reused by the embedder for face search
  const r = await llmForTask('ad-breakdown', {
    system: DESCRIBE_SYSTEM,
    prompt: `Shot ${shot.i} (${shot.start.toFixed(1)}–${shot.end.toFixed(1)}s). Describe this single shot.`,
    maxTokens: 700,
    imagePaths: frames.map(f => f.abs),
  });
  if (!r.ok || !r.text) return null;
  try {
    const p = parseJsonLoose(r.text) as ShotPerception;
    if (!p.place) p.place = { kind: 'unknown' };
    if (!Array.isArray(p.subjects)) p.subjects = [];
    return p;
  } catch { return null; }
}

// Phase A — describe every shot (cached: skips shots already described).
export async function describeShots(
  analysis: CutsAnalysis, onProgress?: (done: number, total: number) => void, force = false,
): Promise<void> {
  const todo = analysis.shots.filter(s => force || !s.perception);
  let done = 0;
  await mapPool(todo, 4, async (shot) => {
    const p = await describeShot(analysis, shot);
    if (p) shot.perception = p;
    done += 1; onProgress?.(done, todo.length);
  });
}

// Phase B — VISUAL RE-IDENTIFICATION. Identity is a similarity problem: local
// embeddings (face + person-appearance + scene) place each shot in a feature
// space, and shots FUSE into one person when their vectors are close — the face
// when a face is visible (strongest), appearance otherwise. This catches the
// same individual across a close-up and a wide, and across NON-ADJACENT shots,
// which no text/gestalt pass could. It is precise by design (it under-merges
// rather than mis-merges); the manual link fills what it leaves apart.

// Embed every shot locally (face/person/scene vectors) via the Python sidecar.
export async function embedShots(
  analysis: CutsAnalysis, onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const shots = analysis.shots;
  const off = window.hjen.onCutsEmbedProgress?.((_e: unknown, d: { line?: string }) => {
    const m = /EMBED (\d+)\/(\d+)/.exec(d?.line || '');
    if (m) onProgress?.(parseInt(m[1], 10), parseInt(m[2], 10));
  });
  try {
    const r = await window.hjen.cutsEmbed({
      sessionId: analysis.sessionId, projectSlug: analysis.projectSlug,
      shots: shots.map(s => ({
        i: s.i,
        frames: [s.keyframe || s.thumb, ...(s.candidates?.map(c => c.abs) || [])].filter(Boolean).slice(0, 4),
      })),
    });
    if (!r.ok) throw new Error(r.message || 'embedding failed');
    const by = new Map((r.data?.shots || []).map(x => [x.i, x] as const));
    for (const s of shots) {
      const e = by.get(s.i);
      if (e) s.emb = { face: e.face ?? null, person: e.person ?? null, scene: e.scene ?? null, hasFace: !!e.hasFace };
    }
  } finally { off?.(); }
}

// Cosine of two L2-normalised vectors (the sidecar normalises them).
function cosV(a?: number[] | null, b?: number[] | null): number | null {
  if (!a || !b || a.length !== b.length) return null;
  let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

// Compact group label derived locally from a shot's perception (no extra call).
function labelFor(s: CutShot): string {
  const p = s.perception;
  if (!p) return `Shot ${s.i}`;
  const subj = p.subjects?.[0];
  const who = subj ? `${subj.activity || ''}${subj.wardrobe ? ` · ${subj.wardrobe}` : ''}`.trim() : '';
  return `${p.place?.kind || 'scene'}${who ? ` — ${who}` : ''}`.replace(/\s+/g, ' ').trim().slice(0, 90);
}

// Fuse shots into person threads by embedding similarity. The face dominates
// when both shots show a face; appearance decides otherwise. Union-find, so a
// character's scattered shots collapse into ONE non-contiguous group. Pure and
// synchronous over cached vectors — re-callable instantly when thresholds move.
export function fuseGroups(analysis: CutsAnalysis, faceThr = 0.45, personThr = 0.62): CutScene[] {
  const shots = analysis.shots;
  const n = shots.length;
  if (!n) { analysis.scenes = []; return []; }
  const par = Array.from({ length: n }, (_v, i) => i);
  const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = shots[i].emb, b = shots[j].emb;
    const fs = cosV(a?.face, b?.face), ps = cosV(a?.person, b?.person);
    const adjacent = shots[j].i === shots[i].i + 1;   // adjacency is a strong "same beat" prior
    let same = false;
    if (fs !== null) same = fs >= faceThr;                        // a face match holds at any distance
    else if (ps !== null) same = ps >= (adjacent ? personThr - 0.12 : personThr);  // lower the bar for neighbours
    if (same) par[find(i)] = find(j);
  }
  const order: number[] = [];
  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const r = find(i); if (!members.has(r)) { members.set(r, []); order.push(r); } members.get(r)!.push(shots[i].i); }
  const scenes: CutScene[] = order.map((r, idx) => {
    const nums = members.get(r)!.slice().sort((a, b) => a - b);
    const first = shots.find(s => s.i === nums[0])!;
    return { id: `sc${idx + 1}`, label: labelFor(first), color: SCENE_COLORS[idx % SCENE_COLORS.length], shots: nums };
  });
  for (const sc of scenes) for (const nn of sc.shots) { const sh = shots.find(x => x.i === nn); if (sh) sh.sceneId = sc.id; }
  analysis.scenes = scenes;
  return scenes;
}

// Agent 1 grouping = embed locally (once) → fuse by visual similarity.
export async function groupScenes(
  analysis: CutsAnalysis, onProgress?: (done: number, total: number) => void,
  faceThr = 0.45, personThr = 0.62,
): Promise<CutScene[]> {
  if (!analysis.shots.length) return [];
  await embedShots(analysis, onProgress);
  return fuseGroups(analysis, faceThr, personThr);
}

// Assisted linking — rank the most-similar shot PAIRS that are not yet in the
// same group, so the user confirms real matches with one click. Weak embeddings
// are unreliable as a decision but excellent as a RANKING; this turns them into
// an accelerator for the manual link (especially far-apart callbacks the eye
// would miss). Face-based suggestions are surfaced above appearance ones.
export interface LinkSuggestion { a: number; b: number; sim: number; kind: 'face' | 'appearance'; adjacent: boolean }

export function suggestLinks(analysis: CutsAnalysis, floor = 0.4, limit = 24): LinkSuggestion[] {
  const shots = analysis.shots;
  const out: LinkSuggestion[] = [];
  for (let i = 0; i < shots.length; i++) for (let j = i + 1; j < shots.length; j++) {
    const si = shots[i], sj = shots[j];
    if (si.sceneId && si.sceneId === sj.sceneId) continue;   // already together
    const fs = cosV(si.emb?.face, sj.emb?.face);
    const ps = cosV(si.emb?.person, sj.emb?.person);
    let sim = -1, kind: 'face' | 'appearance' = 'appearance';
    if (fs !== null) { sim = fs; kind = 'face'; }
    else if (ps !== null) { sim = ps; kind = 'appearance'; }
    if (sim >= floor) out.push({ a: si.i, b: sj.i, sim: Math.round(sim * 100) / 100, kind, adjacent: sj.i === si.i + 1 });
  }
  // rank: face matches first, then by similarity; a small bump for non-adjacent
  // (far-apart callbacks are the ones a human can't easily spot).
  out.sort((x, y) => {
    const sx = (x.kind === 'face' ? 0.12 : 0) + (x.adjacent ? 0 : 0.03) + x.sim;
    const sy = (y.kind === 'face' ? 0.12 : 0) + (y.adjacent ? 0 : 0.03) + y.sim;
    return sy - sx;
  });
  return out.slice(0, limit);
}

// COMPREHENSION grouping — the mind watches the whole ad. A video-capable model
// receives a compact copy of the video + the shot boundaries and groups shots
// by understanding (tracking each person/story across the moving footage), not
// by frame similarity. This is the top-down model: understand the ad, then
// partition it.
export async function watchAndGroup(analysis: CutsAnalysis): Promise<CutScene[]> {
  const shots = analysis.shots;
  if (!shots.length) return [];
  const r = await window.hjen.cutsWatch({
    sessionId: analysis.sessionId, projectSlug: analysis.projectSlug, videoPath: analysis.videoPath,
    shots: shots.map(s => ({ i: s.i, start: s.start, end: s.end, frame: s.keyframe || s.thumb })),
  });
  if (!r.ok) throw new Error(r.message || 'watch failed');
  const valid = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= shots.length;
  const seen = new Set<number>();
  const scenes: CutScene[] = [];
  for (const g of (r.groups || [])) {
    const nums = (g.shots || []).filter(n => valid(n) && !seen.has(n));
    nums.forEach(n => seen.add(n));
    if (!nums.length) continue;
    scenes.push({ id: `sc${scenes.length + 1}`, label: (g.label || `Group ${scenes.length + 1}`).trim(), color: SCENE_COLORS[scenes.length % SCENE_COLORS.length], shots: nums.sort((a, b) => a - b) });
  }
  // Any shot the model dropped → its own group, so nothing is lost.
  for (const s of shots) if (!seen.has(s.i)) scenes.push({ id: `sc${scenes.length + 1}`, label: labelFor(s), color: SCENE_COLORS[scenes.length % SCENE_COLORS.length], shots: [s.i] });
  for (const sc of scenes) for (const n of sc.shots) { const sh = shots.find(x => x.i === n); if (sh) sh.sceneId = sc.id; }
  analysis.scenes = scenes;
  return scenes;
}

// PEOPLE layer — the mind watches the ad and identifies the MAIN characters,
// grouping each one across every shot they appear in (independent of place),
// with a description, general build, expression, and wardrobe per character.
export async function identifyPeople(analysis: CutsAnalysis): Promise<CutPerson[]> {
  const shots = analysis.shots;
  if (!shots.length) return [];
  const r = await window.hjen.cutsPeople({
    sessionId: analysis.sessionId, projectSlug: analysis.projectSlug, videoPath: analysis.videoPath,
    shots: shots.map(s => ({ i: s.i, start: s.start, end: s.end, frame: s.keyframe || s.thumb })),
  });
  if (!r.ok) throw new Error(r.message || 'people failed');
  const valid = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= shots.length;
  const people: CutPerson[] = [];
  for (const c of (r.people || [])) {
    const nums = Array.from(new Set((c.shots || []).filter(valid))).sort((a, b) => a - b);
    if (!nums.length) continue;   // include every character — even a single-shot appearance
    people.push({
      id: `p${people.length + 1}`,
      name: (c.name || `Person ${people.length + 1}`).trim(),
      description: (c.description || '').trim(),
      appearance: (c.appearance || '').trim(),
      expression: (c.expression || '').trim(),
      wardrobe: (c.wardrobe || '').trim(),
      color: PERSON_COLORS[people.length % PERSON_COLORS.length],
      shots: nums,
      keyShot: nums[0],
    });
  }
  analysis.people = people;
  return people;
}

// ── Phase 0 · read the ad's shared LOOK (DNA) ──────────────────────────────
export async function readDna(analysis: CutsAnalysis): Promise<CutDna> {
  const r = await window.hjen.cutsDna({
    sessionId: analysis.sessionId, projectSlug: analysis.projectSlug, videoPath: analysis.videoPath,
  });
  if (!r.ok) throw new Error(r.message || 'look read failed');
  const d = r.dna || {};
  const str = (v: unknown) => String(v || '').trim();
  const dna: CutDna = {
    intent: str(d.intent), look: str(d.look), palette: str(d.palette), film: str(d.film),
    lighting: str(d.lighting), lens: str(d.lens), era: str(d.era), mood: str(d.mood),
    grain: str(d.grain), aspect: str(d.aspect),
  };
  analysis.dna = dna;
  return dna;
}

// ── Comprehend the WHOLE ad first (the wide eye on the world) ───────────────
// Gemini watches the full ad and returns the narrative, the assembled world, the
// cross-shot continuity, AND a per-shot context note (its role + facts set up by
// neighbouring shots). This knowledge is then injected into every master prompt,
// so a shot is described with what the whole ad knows — not from its frames alone.
export async function readStory(analysis: CutsAnalysis): Promise<CutStory> {
  const shots = analysis.shots;
  const r = await window.hjen.cutsStory({
    sessionId: analysis.sessionId, projectSlug: analysis.projectSlug, videoPath: analysis.videoPath,
    shots: shots.map(s => ({ i: s.i, start: s.start, end: s.end })),
  });
  if (!r.ok) throw new Error(r.message || 'comprehension failed');
  const str = (v: unknown) => String(v || '').trim();
  const story: CutStory = { synopsis: str(r.synopsis), world: str(r.world), continuity: str(r.continuity) };
  analysis.story = story;
  const byShot = new Map<number, string>();
  for (const c of (r.shots || [])) { const i = Number(c.i); if (Number.isInteger(i)) byShot.set(i, str(c.context)); }
  for (const sh of shots) { const c = byShot.get(sh.i); if (c) sh.context = c; }
  return story;
}

// The canonical TEXT for the entities present in a shot — so every master prompt
// describes the same character/place with the same words (consistency via text,
// since we use NO image references).
function canonForShot(analysis: CutsAnalysis, shotNum: number): string {
  const lines: string[] = [];
  for (const p of (analysis.people || [])) {
    if (!p.shots.includes(shotNum)) continue;
    const bits = [p.appearance, p.wardrobe].map(s => (s || '').trim()).filter(Boolean).join(' — ');
    lines.push(`PERSON «${p.name}»: ${p.description}${bits ? ` | ${bits}` : ''}`);
  }
  const sh = analysis.shots.find(s => s.i === shotNum);
  if (sh?.sceneId) {
    const sc = (analysis.scenes || []).find(x => x.id === sh.sceneId);
    if (sc) lines.push(`PLACE «${sc.label}»`);
  }
  return lines.join('\n');
}

// ── Phase 2/3 · deep per-shot description + master prompt ──────────────────
export async function writeBriefs(
  analysis: CutsAnalysis,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const shots = analysis.shots;
  if (!shots.length) return 0;
  let done = 0;
  await mapPool(shots, 3, async (sh) => {
    try {
      // neighbours' context so continuity (a subject's orientation/direction set
      // up before/after) informs a shot whose own frames are ambiguous.
      const prev = shots.find(x => x.i === sh.i - 1);
      const next = shots.find(x => x.i === sh.i + 1);
      const r = await window.hjen.cutsBrief({
        sessionId: analysis.sessionId, projectSlug: analysis.projectSlug, videoPath: analysis.videoPath,
        shot: { i: sh.i, start: sh.start, end: sh.end },
        keyframe: sh.keyframe || '',   // the chosen representative frame — the prompt targets THIS still
        dna: analysis.dna || null,
        story: analysis.story || null,
        context: sh.context || '',
        neighbours: [prev && prev.context ? `Previous shot ${prev.i}: ${prev.context}` : '', next && next.context ? `Next shot ${next.i}: ${next.context}` : ''].filter(Boolean).join('\n'),
        canon: canonForShot(analysis, sh.i),
      });
      if (r.ok && r.brief) {
        const b = r.brief as any;
        const str = (v: unknown) => String(v || '').trim();
        const cam = b.camera || {};
        sh.brief = {
          subject: str(b.subject), wardrobe: str(b.wardrobe), blocking: str(b.blocking), light: str(b.light),
          camera: { shotSize: str(cam.shotSize), lens: str(cam.lens), angle: str(cam.angle), height: str(cam.height), movement: str(cam.movement), dof: str(cam.dof) },
          colour: str(b.colour), frameFurniture: str(b.frameFurniture), time: str(b.time), mood: str(b.mood), inside: str(b.inside),
          prompt: str(b.prompt),
        };
      }
    } catch { /* one shot failing shouldn't stop the batch */ }
    done++; onProgress?.(done, shots.length);
  });
  return done;
}

// ── Manual edits to the People groups (the mind's grouping is a draft) ──────
// All mutate analysis.people in place; the caller persists + re-renders.
function normPersonShots(p: CutPerson) {
  p.shots = Array.from(new Set(p.shots)).sort((a, b) => a - b);
  p.keyShot = p.shots[0];
}
export function renamePerson(a: CutsAnalysis, id: string, name: string): void {
  const p = a.people?.find(x => x.id === id); if (p) p.name = name;
}
export function deletePerson(a: CutsAnalysis, id: string): void {
  if (a.people) a.people = a.people.filter(p => p.id !== id);
}
export function addShotToPerson(a: CutsAnalysis, id: string, n: number): void {
  const p = a.people?.find(x => x.id === id);
  if (p && !p.shots.includes(n)) { p.shots.push(n); normPersonShots(p); }
}
export function removeShotFromPerson(a: CutsAnalysis, id: string, n: number): void {
  const p = a.people?.find(x => x.id === id);
  if (!p) return;
  p.shots = p.shots.filter(s => s !== n); normPersonShots(p);
  if (!p.shots.length) deletePerson(a, id);   // an empty person is no person
}
// Merge several people into one — union of shots, kept person = earliest in the list.
export function mergePeople(a: CutsAnalysis, ids: string[]): string | null {
  if (!a.people || ids.length < 2) return null;
  const idset = new Set(ids);
  const chosen = a.people.filter(p => idset.has(p.id));
  if (chosen.length < 2) return null;
  const keep = chosen[0];   // people array is already in centrality order
  const shots = new Set(keep.shots);
  for (const o of chosen) if (o.id !== keep.id) o.shots.forEach(s => shots.add(s));
  keep.shots = [...shots]; normPersonShots(keep);
  a.people = a.people.filter(p => p.id === keep.id || !idset.has(p.id));
  return keep.id;
}

// ── QA · verify a finished grouping against its own images ─────────────────
export interface GroupVerdict {
  id: string;
  coherent: boolean;
  outliers: { shot: number; confidence: number; reason: string }[];
}
export interface VerifyResult {
  verdicts: GroupVerdict[];
  frames: Record<number, string>;   // shot number → fresh accurate frame path
}
// Re-examine each group (scenes or people) by looking at its member frames
// together; flag shots that don't belong. Uses fresh accurate frames (not the
// stored thumb), and folds those frames back onto the shots so the whole UI
// shows what the mind judged.
export async function verifyGroups(analysis: CutsAnalysis, kind: 'scene' | 'person'): Promise<VerifyResult> {
  const src = kind === 'scene'
    ? (analysis.scenes || []).map(s => ({ id: s.id, label: s.label, shots: s.shots }))
    : (analysis.people || []).map(p => ({ id: p.id, label: p.name, shots: p.shots }));
  const groups = src
    .filter(g => (g.shots || []).length >= 2)
    .map(g => ({ id: g.id, label: g.label, shots: g.shots
      .map(i => { const s = analysis.shots.find(x => x.i === i); return s ? { i, start: s.start, end: s.end } : null; })
      .filter(Boolean) as { i: number; start: number; end: number }[] }));
  if (!groups.length) return { verdicts: [], frames: {} };
  const r = await window.hjen.cutsVerifyGroups({
    sessionId: analysis.sessionId, projectSlug: analysis.projectSlug, videoPath: analysis.videoPath, kind, groups,
  });
  if (!r.ok) throw new Error(r.message || 'verify failed');
  const valid = new Set(analysis.shots.map(s => s.i));
  const verdicts: GroupVerdict[] = (r.groups || []).map(g => ({
    id: String(g.id),
    coherent: g.coherent !== false,
    outliers: (g.outliers || [])
      .filter(o => typeof o.shot === 'number' && valid.has(o.shot))
      .map(o => ({ shot: o.shot as number, confidence: Number(o.confidence) || 0, reason: String(o.reason || '').trim() })),
  }));
  const frames: Record<number, string> = {};
  for (const f of (r.frames || [])) if (f.path) { frames[f.shot] = f.path; const sh = analysis.shots.find(x => x.i === f.shot); if (sh) sh.thumb = f.path; }
  return { verdicts, frames };
}

// SPEECH layers — the mind listens (audio) + watches (who's on screen) and
// splits speech into VOICE-OVER vs on-screen DIALOGUE, timecoded + transcribed.
export async function analyzeSpeech(analysis: CutsAnalysis): Promise<SpeechSegment[]> {
  const r = await window.hjen.cutsSpeech({
    sessionId: analysis.sessionId, projectSlug: analysis.projectSlug, videoPath: analysis.videoPath,
    duration: analysis.duration,   // lets the sidecar window long ads (no timecode drift)
  });
  if (!r.ok) throw new Error(r.message || 'speech analysis failed');
  const segs: SpeechSegment[] = (r.segments || [])
    .map(s => ({
      type: (s.type === 'dialogue' ? 'dialogue' : 'vo') as 'vo' | 'dialogue',
      start: Math.max(0, Number(s.start) || 0),
      end: Number(s.end) || 0,
      text: String(s.text || '').trim(),
      speaker: s.speaker ? String(s.speaker).trim() : undefined,
    }))
    .filter(s => s.text)
    .sort((a, b) => a.start - b.start);
  // Starts are reliable; ENDS are not — and a card must never end BEFORE the
  // speech does. So take the LONGER of the model's heard end and a generous
  // word-count estimate, then (only) cap it so it doesn't run into the next
  // segment. Better slightly long than cut off mid-word.
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const wc = s.text.split(/\s+/).filter(Boolean).length;
    const wordEnd = s.start + Math.min(14, Math.max(0.7, wc * 0.42)); // ~0.42s/word, slow-delivery safe
    let end = Math.max(s.end, wordEnd);            // s.end here is the model's heard end
    const next = segs[i + 1];
    if (next && next.start > s.start) end = Math.min(end, next.start - 0.04);
    s.end = Math.max(s.start + 0.4, end);
  }
  analysis.speech = segs;
  return segs;
}

// VERIFY cuts by comprehension — the mind watches the ad and fixes BOTH kinds of
// detector error: FALSE cuts (object across lens / whip-pan / flash: one take
// split in two → MERGE) and MISSED cuts (one "shot" that actually hides a real
// edit → SPLIT at the reported time). Returns how many were removed/added;
// grouping is reset (re-run Agent 1 after). Splits win when both look plausible.
export async function verifyCuts(analysis: CutsAnalysis): Promise<{ removed: number; added: number }> {
  const shots = analysis.shots;
  if (shots.length < 1) return { removed: 0, added: 0 };
  const r = await window.hjen.cutsVerify({
    sessionId: analysis.sessionId, projectSlug: analysis.projectSlug, videoPath: analysis.videoPath,
    shots: shots.map(s => ({ i: s.i, start: s.start, end: s.end, frame: s.keyframe || s.thumb })),
  });
  if (!r.ok) throw new Error(r.message || 'verify failed');

  // ── Pass A · MERGE false cuts ──
  const falseAfter = new Set<number>();  // boundary after shot number k is false
  for (const pair of (r.merge || [])) {
    const a = Math.min(pair[0], pair[1]), b = Math.max(pair[0], pair[1]);
    if (b === a + 1) falseAfter.add(a);
  }
  let removed = 0;
  if (falseAfter.size) {
    const sorted = shots.slice().sort((x, y) => x.start - y.start);
    const runs: CutShot[][] = [];
    let cur: CutShot[] = [];
    for (let i = 0; i < sorted.length; i++) {
      cur.push(sorted[i]);
      if (!(i < sorted.length - 1 && falseAfter.has(sorted[i].i))) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    const merged: CutShot[] = runs.map((run, idx) => {
      const first = run[0], last = run[run.length - 1];
      return {
        i: idx + 1, start: first.start, end: last.end,
        dur: Math.round((last.end - first.start) * 100) / 100,
        thumb: first.thumb, keyframe: first.keyframe, keyframeT: first.keyframeT, candidates: first.candidates,
      };
    });
    removed = shots.length - merged.length;
    analysis.shots = merged;
  }

  // ── Pass B · SPLIT missed cuts ── (locate by absolute time, not stale number)
  const splitTimes = (r.split || [])
    .map(s => Number(s.at))
    .filter(t => Number.isFinite(t) && t > 0.2 && t < analysis.duration - 0.2)
    .sort((a, b) => a - b);
  let added = 0;
  for (const t of splitTimes) {
    const host = analysis.shots.find(s => t > s.start + 0.15 && t < s.end - 0.15);
    if (!host) continue;   // time falls on an existing boundary or too close to one
    const ok = await splitShotAt(analysis, host.i, t);
    if (ok) added++;
  }

  if (removed || added) analysis.scenes = [];   // grouping is now stale — re-run Agent 1
  return { removed, added };
}

// Manual link: force a set of shots into ONE group (the reliable path for what
// the auto pass leaves apart). Also splits shots OUT to their own singletons.
export function linkShots(analysis: CutsAnalysis, shotNums: number[]): void {
  const ids = new Set(shotNums);
  const members = analysis.shots.filter(s => ids.has(s.i)).map(s => s.i).sort((a, b) => a - b);
  if (members.length < 2) return;
  const target = analysis.shots.find(s => s.i === members[0]);
  // Inherit the first shot's existing scene name (the mind's label) if it has one.
  const priorLabel = target?.sceneId ? analysis.scenes?.find(sc => sc.id === target.sceneId)?.label : undefined;
  const label = priorLabel || (target ? labelFor(target) : `Group`);
  const id = `man-${members[0]}-${members[members.length - 1]}`;
  // remove these shots from any existing scene, then form the new group
  for (const s of analysis.shots) if (ids.has(s.i)) s.sceneId = id;
  rebuildScenesFromShots(analysis, { [id]: label });
}

export function unlinkShots(analysis: CutsAnalysis, shotNums: number[]): void {
  for (const s of analysis.shots) if (shotNums.includes(s.i)) s.sceneId = `solo-${s.i}`;
  rebuildScenesFromShots(analysis, {});
}

// Rebuild the scene list from each shot's current sceneId, ordered by first
// appearance. Label precedence: explicit override (labels arg) → the scene's
// EXISTING label (so the mind's names survive a manual edit) → derived fallback.
function rebuildScenesFromShots(analysis: CutsAnalysis, labels: Record<string, string>): void {
  const prior: Record<string, string> = {};
  for (const sc of analysis.scenes || []) prior[sc.id] = sc.label;
  const order: string[] = [];
  const members = new Map<string, number[]>();
  for (const s of analysis.shots) {
    const key = s.sceneId || `solo-${s.i}`;
    if (!members.has(key)) { members.set(key, []); order.push(key); }
    members.get(key)!.push(s.i);
  }
  const scenes: CutScene[] = order.map((key, idx) => {
    const nums = members.get(key)!.slice().sort((a, b) => a - b);
    const first = analysis.shots.find(s => s.i === nums[0])!;
    const label = labels[key] || prior[key] || labelFor(first);
    return { id: key, label, color: SCENE_COLORS[idx % SCENE_COLORS.length], shots: nums };
  });
  analysis.scenes = scenes;
}

// ── Stage 2 · وكيل اختيار الصورة — pick the representative frame ─────
const PICK_SYSTEM = `You are a still-frame selector for downstream image work. You are given several candidate frames sampled across ONE shot, labelled by timecode. Pick the SINGLE frame that best represents the shot for later re-generation: the human subject (if any) must read clearly — face/pose visible, well-composed, in focus, not mid-blink, not a motion-blur smear, not an empty/transitional frame. If the subject only enters partway through the shot, choose a frame where they are present and clearest. If there is no person, choose the cleanest, most legible composition of the shot's subject. Return STRICT JSON only.`;

export async function pickKeyframeForShot(analysis: CutsAnalysis, shot: CutShot, count = 6): Promise<CutShot> {
  const res = await window.hjen.cutsShotFrames({
    sessionId: analysis.sessionId, videoPath: analysis.videoPath, projectSlug: analysis.projectSlug,
    shotIndex: shot.i, start: shot.start, end: shot.end, count,
  });
  if (!res.ok || !res.frames?.length) {
    // Fallback: keep the mid-shot thumb as the keyframe.
    shot.keyframe = shot.thumb; shot.keyframeT = (shot.start + shot.end) / 2; shot.candidates = [];
    return shot;
  }
  const frames = res.frames;
  shot.candidates = frames;
  const manifest = frames.map(f => `${f.id} @ ${f.t.toFixed(2)}s`).join(', ');
  const prompt = `Shot ${shot.i} (${shot.start.toFixed(1)}–${shot.end.toFixed(1)}s). Candidate frames in order: ${manifest}.\n\nReturn JSON:\n{"pick":"<frame id>","reason":"<one short sentence>"}`;
  try {
    const r = await llmForTask('ad-breakdown', { system: PICK_SYSTEM, prompt, maxTokens: 800, imagePaths: frames.map(f => f.abs) });
    if (r.ok && r.text) {
      const parsed = parseJsonLoose(r.text);
      const hit = frames.find(f => f.id === parsed?.pick) || frames[Math.floor(frames.length / 2)];
      shot.keyframe = hit.abs; shot.keyframeT = hit.t; shot.pickReason = String(parsed?.reason || '').trim();
      return shot;
    }
  } catch { /* fall through to mid-frame */ }
  const mid = frames[Math.floor(frames.length / 2)];
  shot.keyframe = mid.abs; shot.keyframeT = mid.t;
  return shot;
}

export async function pickKeyframes(
  analysis: CutsAnalysis, onProgress?: (done: number, total: number, shot: CutShot) => void, count = 6,
): Promise<CutShot[]> {
  let done = 0;
  await mapPool(analysis.shots, 3, async (shot) => {
    await pickKeyframeForShot(analysis, shot, count);
    done += 1; onProgress?.(done, analysis.shots.length, shot);
    return shot;
  });
  return analysis.shots;
}

// ── Manual editing — hard cases the auto pass missed ────────────────
// Shot numbers (.i) are always 1..N in time order; renumber after any edit.
function renumber(shots: CutShot[]) { shots.sort((a, b) => a.start - b.start).forEach((s, k) => { s.i = k + 1; }); }

// Keep each scene's shot-number list + counts in sync with shot.sceneId after edits.
function resyncScenes(analysis: CutsAnalysis) {
  for (const sc of analysis.scenes) sc.shots = analysis.shots.filter(s => s.sceneId === sc.id).map(s => s.i);
  analysis.scenes = analysis.scenes.filter(sc => sc.shots.length > 0);
}

let MANUAL_SEQ = 900000;   // unique frame-file indices for manual extracts (no collision with shot indices)

// Pull a single frame at time t (native extract, small window centred on t).
export async function grabFrameAt(analysis: CutsAnalysis, t: number, span = 0.4): Promise<CutCandidate | null> {
  const idx = ++MANUAL_SEQ;
  const res = await window.hjen.cutsShotFrames({
    sessionId: analysis.sessionId, videoPath: analysis.videoPath, projectSlug: analysis.projectSlug,
    shotIndex: idx, start: Math.max(0, t - span / 2), end: t + span / 2, count: 1,
  });
  return res.ok && res.frames?.length ? res.frames[0] : null;
}

// Split a shot at time t → two shots. The user's manual cut for a missed boundary.
export async function splitShotAt(analysis: CutsAnalysis, shotI: number, t: number): Promise<boolean> {
  const shots = analysis.shots;
  const pos = shots.findIndex(s => s.i === shotI);
  if (pos < 0) return false;
  const s = shots[pos];
  if (t <= s.start + 0.08 || t >= s.end - 0.08) return false; // too close to an edge
  const cut = Math.round(t * 100) / 100;
  const a: CutShot = { ...s, end: cut, dur: Math.round((cut - s.start) * 100) / 100 };
  const b: CutShot = { ...s, start: cut, dur: Math.round((s.end - cut) * 100) / 100,
    keyframe: undefined, keyframeT: undefined, candidates: undefined, pickReason: undefined };
  const [ta, tb] = await Promise.all([
    grabFrameAt(analysis, (a.start + a.end) / 2), grabFrameAt(analysis, (b.start + b.end) / 2),
  ]);
  if (ta) a.thumb = ta.abs;
  if (tb) b.thumb = tb.abs;
  // a keeps the original keyframe only if it still falls inside a's range.
  if (a.keyframeT != null && (a.keyframeT < a.start || a.keyframeT > a.end)) { a.keyframe = undefined; a.keyframeT = undefined; a.pickReason = undefined; }
  shots.splice(pos, 1, a, b);
  renumber(shots);
  resyncScenes(analysis);
  return true;
}

// Merge a shot into the previous one — removes a false cut the detector added.
// Only the time range extends; the PREVIOUS shot keeps its own representative
// frame (keyframe + thumb) untouched — a merge must never overwrite it.
export async function mergeWithPrev(analysis: CutsAnalysis, shotI: number): Promise<boolean> {
  const shots = analysis.shots;
  const pos = shots.findIndex(s => s.i === shotI);
  if (pos <= 0) return false;
  const prev = shots[pos - 1], cur = shots[pos];
  prev.end = cur.end;
  prev.dur = Math.round((prev.end - prev.start) * 100) / 100;
  // prev.thumb / prev.keyframe / prev.candidates are intentionally left as-is.
  shots.splice(pos, 1);
  renumber(shots);
  resyncScenes(analysis);
  return true;
}

// Manually set a shot's representative frame to the frame at time t (e.g. the
// playhead) — for when the auto candidates don't contain the right moment.
export async function setKeyframeAt(analysis: CutsAnalysis, shotI: number, t: number): Promise<boolean> {
  const s = analysis.shots.find(x => x.i === shotI);
  if (!s) return false;
  const f = await grabFrameAt(analysis, t, 0.2);
  if (!f) return false;
  s.keyframe = f.abs; s.keyframeT = f.t; s.pickReason = 'manual';
  s.candidates = [...(s.candidates || []), f];
  return true;
}
