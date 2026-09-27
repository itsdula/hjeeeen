// BREAKDOWN — the runnable pipeline (renderer orchestration).
//
// Anwar's product definition: a URL (or local video) goes in; TWO outputs come
// out, answers to two questions:
//   1. "What if this ad had been AI-MADE?" — per craft axis, ONE master
//      description (reproduction_prompt) that makes an AI model reproduce THIS
//      ad's result on that axis alone. → OUTPUT 1, stored on each axis.
//   2. "What if we went back to before production, to win the client?" — the
//      pre-production package as client-facing DOCUMENTS: brief · story ·
//      treatment · references (the hunt) · shotlist · pitch. → OUTPUT 2, stored
//      on the reversed pipeline.
//
// The whole run is orchestrated HERE (not in main) so every text-LLM call goes
// through the registry + hjen:llm-json gate (house LLM law: name a TASK, never a
// model; direct vendor APIs; no middlemen). Only the native heavy lifting
// (yt-dlp / ffmpeg) lives in main behind hjen:breakdownIngest.
//
// Genericity: nothing here is Nike-specific. The 13 axes come from the registry;
// the per-axis analysis brief is the SEALED job_<slug>.md fed verbatim; frame
// ids are validated against whatever the ingest produced.

import { llmForTask } from '../models/registry';
import { BREAKDOWN_AXES, AXIS_SLUGS, axisDef } from './axes';
import { JOB_RAW } from './content';
import { runDnaStage, type DnaStageInput, type DnaAxisInput } from './dna';
import { runMasterPromptStage, masterPromptInputFromBreakdown, mergeMasterPrompts } from './masterPrompt';
import type { ShotMasterPrompt, AdBreakdown } from '../creativemind/breakdown';
import { captureBreakdownToBrain } from '../creativemind/brainCards';

// ─── ingest meta (shape returned by hjen:breakdownIngest) ────────────────────
export interface IngestFrame { id: string; rel: string; abs: string; t: number }
/** One timed line of what is SAID — from ASR (Phase 1) or platform subtitles.
 *  `lang` is per-segment for bilingual ads (Arabic VO + English super). */
export interface TranscriptSegment { start: number; end: number; text: string; lang?: string }
/** The film's spoken content, timed. `source` records where it came from:
 *  'asr' (transcribed) is preferred over 'subs' (platform captions). */
export interface Transcript { lang: string; source: 'asr' | 'subs' | 'none'; segments: TranscriptSegment[] }
/** A REAL shot — measured from cut detection, not invented by a model. Interval
 *  [tcIn,tcOut] in seconds + the ingested frames that fall inside it. */
export interface ShotInterval { no: number; tcIn: number; tcOut: number; frameIds: string[] }
export interface IngestMeta {
  slug: string; dir: string; durationS: number | null; captions: string;
  /** Timed transcript of the dialogue/VO; null when nothing was heard/captioned. */
  transcript: Transcript | null;
  /** Real cut-detected shots — the shotlist source. Empty if detection failed. */
  shots: ShotInterval[];
  /** On-screen text (supers · end-card · brand · burned-in), read by the OCR
   *  vision pass. Populated in the renderer (not ingest); absent until then. */
  onScreenText?: Array<{ t: number; text: string; role?: string }>;
  audioAbs: string | null;
  sourceInfo: { title?: string; uploader?: string | null; webpageUrl?: string | null; uploadDate?: string };
  frames: IngestFrame[];
  thumbs: Array<{ id: string; abs: string; t: number }>;
}

// ─── run state (mutable — enables per-stage retry without redoing prior work) ─
export interface RunState {
  meta?: IngestMeta;
  vision: Record<string, any>;    // passId → parsed vision result
  dnaMade?: string[];             // axis slugs whose dna/<slug>.gem.md is written (resume)
  docsA?: any;
  docsB?: any;
  master?: Record<number, ShotMasterPrompt>;   // shot no → fused master prompt (resume)
}
export function newRunState(): RunState { return { vision: {} }; }

export type RunEvent =
  | { type: 'phase'; phase: 'fetch' | 'frames' | 'vision' | 'dna' | 'docs' | 'master' | 'write'; label: string }
  // Fired once the film is ingested and its slug is known — BEFORE the run
  // finishes. Lets the operations subsystem capture the checkpoint reference so
  // an interruption mid-run is still resumable from what's already on disk.
  | { type: 'slug'; slug: string }
  | { type: 'axis-done'; slug: string }
  | { type: 'pass-done'; pass: string }
  | { type: 'pass-error'; pass: string; message: string }
  // done/total let every surface show granular movement inside the long stages
  // (so a 34-shot fuse reads "shot 12/34", never a frozen static line).
  | { type: 'dna-done'; slug: string; done: number; total: number }
  | { type: 'master-shot'; no: number; done: number; total: number }
  | { type: 'done'; slug: string }
  | { type: 'error'; message: string };

export interface RunOpts {
  input: { url?: string; filePath?: string; brand?: string; title?: string; slug?: string };
  runId: string;
  state: RunState;
  emit: (ev: RunEvent) => void;
  cancelled: () => boolean;
}

// ─── the six vision passes (group 13 axes into ~5-6 multi-image calls) ───────
interface VisionPass {
  id: string;
  label: string;
  axes: string[];            // registry slugs owned by this call
  frameCap: number;          // how many analysis thumbs to send
  withTimes?: boolean;       // append per-frame timestamps (editing/pacing math)
  withAudio?: boolean;       // attach audio.m4a (sound pass, Google only)
}
export const VISION_PASSES: VisionPass[] = [
  { id: 'story_message', label: 'STORY · BRIEF · MESSAGE', axes: ['story', 'brief', 'message'], frameCap: 40 },
  { id: 'image_look',    label: 'VISUALS · THEME & LOOK · GRADING', axes: ['visuals', 'theme_look', 'grading_color'], frameCap: 52 },
  { id: 'camera_edit',   label: 'CINEMATOGRAPHY · EDIT', axes: ['cinematography', 'edit'], frameCap: 52, withTimes: true },
  { id: 'people',        label: 'WARDROBE · CHARACTERS · ACTION', axes: ['wardrobe', 'characters', 'action'], frameCap: 52 },
  { id: 'sound',         label: 'MUSIC · SOUND DESIGN · VO', axes: ['sound'], frameCap: 14, withAudio: true },
  { id: 'art',           label: 'ART DIRECTION · LOCATION', axes: ['art_location'], frameCap: 44 },
];
// safety: every registry axis must be owned by exactly one pass
if (import.meta.env?.DEV) {
  const owned = new Set(VISION_PASSES.flatMap(p => p.axes));
  const miss = AXIS_SLUGS.filter(s => !owned.has(s));
  if (miss.length) console.warn('[breakdown] axes not owned by any vision pass:', miss);
}

const PREMISE = `GOVERNING PREMISE — non-negotiable: treat this ad as a finished AI-MADE film produced through HJEN Studio (a Saudi cinematic AI studio — image models MAKE first-frame plates, video models MAKE the moving shots, all controlled by written frame descriptions, look-locks and reference frames). You are reverse-engineering the craft AS IF it were a set of HJEN controls. There is no physical shoot in this fiction; never write "filmed on location with a crew".`;

const FINDING_SCHEMA = `Each finding is ONE atomic craft fact (one fact per card, never a paragraph):
{"claim_en": "specific, concrete, defensible from the frames",
 "claim_ar": "نفس الحقيقة بعربية طبيعية حيّة (لا ترجمة آلية)",
 "how_hjen_makes_it": "the concrete HJEN control that produces this exact fact — a prompt clause, a look-lock phrase, a choice-pair value, a reference-frame move, an edit decision",
 "frames": ["f012", ...]  (1-4 evidence frames, EXACT filenames from the list),
 "tags": ["2-4 short search tags"],
 "weight": 3 = a law of this ad / 2 = strong pattern / 1 = flavour}`;

// ─── helpers ─────────────────────────────────────────────────────────────────
function parseJsonLoose(text: string): any {
  const t = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch { /* try to slice */ }
  const m = t.match(/[{[][\s\S]*[}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw new Error('model did not return valid JSON');
}
const fid = (s: any): string => String(s ?? '').trim().replace(/\.jpe?g$/i, '');
const clamp = (s: any): string => String(s ?? '').trim();

// how many vision passes run at once — a cap so 6 multimodal calls (~50 images
// each) don't all fire simultaneously, while still cutting the stage's wall-time.
const VISION_CONCURRENCY = 3;
/** Bounded-concurrency map — runs `worker` over `items`, at most `cap` in flight. */
async function mapPool<T>(items: T[], cap: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, Math.min(cap, queue.length)) }, async () => {
    while (queue.length) { const it = queue.shift()!; await worker(it); }
  });
  await Promise.all(runners);
}

/** evenly pick up to `cap` frames across the timeline (preserves order). */
function pickFrames(frames: IngestFrame[], cap: number): IngestFrame[] {
  if (frames.length <= cap) return frames;
  const step = frames.length / cap;
  return Array.from({ length: cap }, (_v, i) => frames[Math.min(frames.length - 1, Math.floor(i * step))]);
}

// The spoken track rendered as TIMED lines — "[3.4s] لا تفكر كثيراً" — from the
// ASR transcript when present (preserving Arabic RTL verbatim), else the flat
// caption fallback. A timed transcript is worth far more to every axis than the
// old untimed blob: story/message/edit can finally pin a line to a moment. Windows
// to [from,to] seconds when given (per-shot / per-pass slices in later stages).
export function renderTranscript(meta: IngestMeta, from?: number, to?: number, maxChars = 6000): string {
  const tr = meta.transcript;
  if (tr && tr.segments && tr.segments.length) {
    const segs = (from != null || to != null)
      ? tr.segments.filter(s => (from == null || s.end >= from) && (to == null || s.start <= to))
      : tr.segments;
    const body = segs.map(s => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n');
    return body.length > maxChars ? body.slice(0, maxChars) + ' …' : (body || 'none');
  }
  return meta.captions || 'none';
}
/** Label for the dialogue block so the model knows provenance + language. */
function dialogueLabel(meta: IngestMeta): string {
  const tr = meta.transcript;
  const src = tr?.source === 'asr' ? 'transcribed from audio, timed' : tr?.source === 'subs' ? 'subtitles, timed' : 'none';
  return `DIALOGUE / VO (${src}${tr?.lang ? `, ${tr.lang}` : ''})`;
}
/** On-screen text (OCR) rendered as timed lines — "[3.4s|endcard] JUST DO IT" —
 *  Arabic verbatim RTL. Empty string when none was read. */
function renderOnScreen(meta: IngestMeta, maxChars = 2000): string {
  const items = meta.onScreenText;
  if (!items || !items.length) return '';
  const body = items.map(i => `[${i.t.toFixed(1)}s${i.role ? `|${i.role}` : ''}] ${i.text}`).join('\n');
  return body.length > maxChars ? body.slice(0, maxChars) + ' …' : body;
}

function adHeader(meta: IngestMeta, sent: IngestFrame[], withTimes: boolean): string {
  const info = meta.sourceInfo || {};
  const list = withTimes
    ? sent.map(f => `${f.id}@${f.t}s`).join(', ')
    : sent.map(f => f.id).join(', ');
  const onScreen = renderOnScreen(meta);
  return [
    `AD: ${info.title || meta.slug}${info.uploader ? ` — ${info.uploader}` : ''}, duration ${meta.durationS ?? '?'}s, ${sent.length} frames sampled of ${meta.frames.length}.`,
    `${dialogueLabel(meta)}:\n${renderTranscript(meta)}`,
    onScreen ? `ON-SCREEN TEXT (OCR, timed):\n${onScreen}` : '',
    `FRAMES (${withTimes ? 'filename@seconds, ' : ''}in timecode order): ${list}`,
  ].filter(Boolean).join('\n');
}

// ─── vision pass ─────────────────────────────────────────────────────────────
function visionPrompt(pass: VisionPass, meta: IngestMeta, sent: IngestFrame[]): string {
  const jobs = pass.axes.map(slug => {
    const raw = JOB_RAW[slug] || '';
    return `\n══════════════════ AXIS: ${slug} (${axisDef(slug)?.en || slug}) ══════════════════\n${raw}`;
  }).join('\n');

  const contract = pass.axes.map(slug =>
    `  "${slug}": {"title_en": "${axisDef(slug)?.en || slug}", "summary": "one-line thesis of THIS axis in THIS ad", "hero_frames": ["3-4 most representative frame filenames"], "reproduction_prompt": "…", "findings": [4-8 findings]}`
  ).join(',\n');

  return `You are the forensic craft analyst of HJEN's BREAKDOWN. ${PREMISE}

This pass owns these axes ONLY: ${pass.axes.join(', ')}. Below is the SEALED job brief for each — obey it. Produce for each axis its findings[] AND one reproduction_prompt. IGNORE any instruction in a job to author a "dna/*.gem.md" file — that is not part of this run.
${jobs}

${FINDING_SCHEMA}

OUTPUT 1 — reproduction_prompt (REQUIRED per axis): the single master description we would hand an AI model to reproduce THIS ad's RESULT on THIS axis ALONE (this axis only — visuals alone, or music alone, or wardrobe alone, …), separated from every other axis. It must be self-contained, concrete, execution-ready — a paragraph a machine that never saw this film could run. Write it in the house imperative, and never use the words generate/generating/generation (use make / made).

${adHeader(meta, sent, !!pass.withTimes)}

Return STRICT JSON only, no code fences:
{
${contract}
}
Rules: cite ONLY the exact frame filenames listed. Be specific and honest — "unknown" beats invention. claim_ar in natural, living Arabic (never translationese, never machine-Arabic). Findings atomic: one fact each.`;
}

async function runVisionPass(pass: VisionPass, meta: IngestMeta): Promise<any> {
  const sent = pickFrames(meta.frames, pass.frameCap);
  const imagePaths = sent.map(f => meta.thumbs.find(t => t.id === f.id)?.abs || f.abs);
  const audioPaths = pass.withAudio && meta.audioAbs ? [meta.audioAbs] : undefined;
  const res = await llmForTask('ad-breakdown', {
    system: 'You are HJEN BREAKDOWN — a world-class ad-deconstruction analyst. You return strict JSON only.',
    prompt: visionPrompt(pass, meta, sent),
    maxTokens: 32000,
    imagePaths,
    audioPaths,
  });
  if (!res.ok || !res.text) throw new Error(res.message || res.reason || 'vision call failed');
  const parsed = parseJsonLoose(res.text);
  // keep only this pass's axes
  const out: Record<string, any> = {};
  for (const slug of pass.axes) if (parsed[slug]) out[slug] = parsed[slug];
  if (!Object.keys(out).length) throw new Error(`model returned none of: ${pass.axes.join(', ')}`);
  return out;
}

// ─── OCR — on-screen text (supers · end-card · brand · burned-in) ────────────
// A dedicated vision read, Arabic-first: the vision model reads burned-in text
// far better than tesseract on stylized Arabic supers. Feeds message / brand-entry
// and every pass via adHeader. Best-effort — returns [] on any failure.
async function runScreenText(meta: IngestMeta): Promise<Array<{ t: number; text: string; role?: string }>> {
  const sent = pickFrames(meta.frames, 24);
  const imagePaths = sent.map(f => meta.thumbs.find(t => t.id === f.id)?.abs || f.abs);
  const list = sent.map(f => `${f.id}@${f.t}s`).join(', ');
  const prompt = `Read ALL text BURNED INTO these ad frames — supers/titles, the end-card, brand name, logo lockup, product/pack text, on-screen captions. Arabic AND English, EXACTLY as written. Transcribe Arabic verbatim in Arabic script (RTL) — never transliterate; English verbatim. Ignore incidental background signage that isn't part of the ad's message.
FRAMES (filename@seconds): ${list}
Return STRICT JSON only, no code fences: {"items":[{"frame":"fNNN","text":"the exact on-screen text","role":"super|endcard|brand|logo|product|caption|other"}]}. One item per distinct on-screen text block, in timecode order. Skip frames with no burned-in text. NEVER invent text that isn't visibly on screen.`;
  const res = await llmForTask('ad-breakdown', {
    system: 'You are a precise on-screen-text reader (OCR) for ad frames, fluent in Arabic and English. You return strict JSON only.',
    prompt, maxTokens: 8000, imagePaths,
  });
  if (!res.ok || !res.text) return [];
  let j: any; try { j = parseJsonLoose(res.text); } catch { return []; }
  const byId = new Map(meta.frames.map(f => [f.id, f.t]));
  const items = (Array.isArray(j?.items) ? j.items : []).map((it: any) => ({
    t: byId.get(fid(it?.frame)) ?? 0, text: clamp(it?.text), role: clamp(it?.role) || undefined,
  })).filter((x: any) => x.text);
  items.sort((a: any, b: any) => a.t - b.t);
  return items;
}

// ─── DNA stage input (OUTPUT 1½ — the reusable per-axis Gems) ────────────────
// Normalize this run's vision findings into the shape the DNA distiller reads,
// then let dna.ts cluster + author + write the 13 dna/<slug>.gem.md files.
function dnaInputFromRun(state: RunState, meta: IngestMeta, brand: string, title: string): DnaStageInput {
  const frameAbsById = new Map<string, string>();
  for (const t of meta.thumbs) frameAbsById.set(t.id, t.abs);
  for (const f of meta.frames) if (!frameAbsById.has(f.id)) frameAbsById.set(f.id, f.abs);

  const axes: DnaAxisInput[] = [];
  for (const slug of AXIS_SLUGS) {
    const src = findAxisResult(state, slug);
    const findings = (src?.findings || []).map((f: any) => ({
      claim_en: clamp(f.claim_en),
      how: clamp(f.how_hjen_makes_it) || undefined,
      weight: [1, 2, 3].includes(f.weight) ? f.weight : undefined,
      frames: Array.isArray(f.frames) ? f.frames.map(fid) : [],
      tags: Array.isArray(f.tags) ? f.tags : undefined,
    })).filter((f: any) => f.claim_en);
    if (!findings.length) continue;
    axes.push({
      slug, findings,
      reproductionPrompt: clamp(src?.reproduction_prompt) || undefined,
      summary: clamp(src?.summary) || undefined,
      heroFrameIds: Array.isArray(src?.hero_frames) ? src.hero_frames.map(fid) : [],
    });
  }
  return {
    slug: meta.slug,
    ad: { title, brand, year: (meta.sourceInfo?.uploadDate || '').slice(0, 4) || undefined, durationS: meta.durationS ?? undefined },
    captions: renderTranscript(meta),   // timed transcript (ASR/subs), not the flat blob
    axes,
    frameAbs: (id: string) => frameAbsById.get(id),
  };
}

// ─── docs passes (OUTPUT 2 — the pre-production package) ─────────────────────
function findingsDigest(state: RunState): string {
  const parts: string[] = [];
  for (const slug of AXIS_SLUGS) {
    const ax = findAxisResult(state, slug);
    if (!ax) continue;
    const lines: string[] = [];
    lines.push(`### ${axisDef(slug)?.en || slug}`);
    if (ax.summary) lines.push(ax.summary);
    if (ax.reproduction_prompt) lines.push(`MAKE-PROMPT: ${clamp(ax.reproduction_prompt)}`);
    for (const f of (ax.findings || []).slice(0, 8)) {
      lines.push(`- [w${f.weight ?? 1}] ${clamp(f.claim_en)}${f.how_hjen_makes_it ? `  ⟶ ${clamp(f.how_hjen_makes_it)}` : ''}`);
    }
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}
function findAxisResult(state: RunState, slug: string): any {
  for (const p of VISION_PASSES) if (p.axes.includes(slug) && state.vision[p.id]) return state.vision[p.id][slug];
  return null;
}
function frameLine(meta: IngestMeta): string {
  return meta.frames.map(f => `${f.id}@${f.t}s`).join(', ');
}
/** seconds → "M:SS" (or "M:SS.s" under 10s of precision-need). */
function fmtTc(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${(Math.round(r * 10) / 10).toString().replace(/\.0$/, '')}`;
}
/** The REAL cut-detected shots, numbered, each with its window + evidence frames
 *  + the VO spoken across it. This is what the model DESCRIBES — it never invents
 *  the count, order, or timecode. Empty string when detection produced nothing. */
function realShotsBlock(meta: IngestMeta): string {
  if (!meta.shots || !meta.shots.length) return '';
  return meta.shots.map(s => {
    const vo = renderTranscript(meta, s.tcIn, s.tcOut, 300).replace(/\n/g, ' ');
    const voPart = vo && vo !== 'none' ? ` · VO: ${vo}` : '';
    return `SHOT ${s.no} [${fmtTc(s.tcIn)}–${fmtTc(s.tcOut)}] frames ${s.frameIds.join(', ') || '(none)'}${voPart}`;
  }).join('\n');
}

const DOCS_SYSTEM = `You are HJEN's creative director + strategist, authoring a pre-production package for a real client pitch. Voice: precise, confident, cinematic — the register of the house treatment. House vocabulary law: never use the words generate / generating / generation. Use make / made / frame / take / refine. Any Arabic must be living Saudi-register prose, never machine-Arabic, never letter-spaced. Return strict JSON only, no code fences.`;

async function runDocsA(state: RunState, meta: IngestMeta, brand: string, title: string): Promise<any> {
  const prompt = `Reverse-engineer the pre-production of this finished ad AS IF HJEN were about to make it — the package we would have put in front of the client BEFORE production, to win approval. Work from the craft findings + the MAKE-PROMPTS + the VO/captions below.

AD: ${brand ? brand + ' — ' : ''}${title} · duration ${meta.durationS ?? '?'}s
${dialogueLabel(meta)}:
${renderTranscript(meta)}${renderOnScreen(meta) ? `\nON-SCREEN TEXT (OCR, timed):\n${renderOnScreen(meta)}` : ''}
FRAMES (filename@seconds): ${frameLine(meta)}

CRAFT FINDINGS (evidence, per axis):
${findingsDigest(state)}

Author these four documents. Cite frames by their EXACT filenames (e.g. "f012") only where asked.
Return STRICT JSON:
{
 "brief": {
   "rawBrief": "the client brief that MUST have produced this ad — audience, business problem, what success looks like (2-4 sentences)",
   "proposition": "the single-minded proposition in one line",
   "persona": "one named human the ad speaks to — a life, not a demographic",
   "bigIdea": {"name": "the idea's name", "hook": "the hook line", "insight": "the human insight under it", "culturalTruth": "the cultural truth it stands on (or empty)"}
 },
 "wantButUntil": "the want-but-until tension in one sentence",
 "story": {
   "wantButUntil": "same tension, phrased for the writers' room",
   "emotionalQuestion": "the single emotional question the film asks",
   "narrative": "how we would WRITE this — 1-2 tight paragraphs of narrative prose, the spine on the page",
   "beats": [ {"beat": "SETUP|DESIRE|CONFLICT|CHANGE|RESULT", "line": "this beat written as narrative", "metaphor": "the externalizing visual metaphor"} ]  // exactly 5, in order
 },
 "beats": [ {"beat": "SETUP|DESIRE|CONFLICT|CHANGE|RESULT", "visual": "what we SEE in this beat", "vo": "VO/super for this beat or empty", "frames": ["f003"]} ],  // exactly 5, in order, each with 1-3 real evidence frames
 "treatment": {
   "choicePairs": {"aspect": "e.g. 2.39:1", "lens": "e.g. 32mm anamorphic", "lightDirection": "e.g. hard 3/4 back", "cameraMove": "e.g. slow push", "hour": "e.g. blue hour", "placeRegister": "e.g. working rail concourse"},
   "lookPhrase": "the ONE named look philosophy a DP would say (e.g. 'wet-asphalt heroism')",
   "prose": "the detailed treatment prose — 2-3 paragraphs a client reads and sees the film",
   "firstFrame": "fNNN — the frame that opens it",
   "lastFrame": "fNNN — the frame you carry out"
 }
}`;
  const res = await llmForTask('breakdown-docs', {
    system: DOCS_SYSTEM, prompt, maxTokens: 20000,
    imagePaths: pickFrames(meta.frames, 8).map(f => meta.thumbs.find(t => t.id === f.id)?.abs || f.abs),
  });
  if (!res.ok || !res.text) throw new Error(res.message || res.reason || 'docs (A) call failed');
  return parseJsonLoose(res.text);
}

async function runDocsB(state: RunState, meta: IngestMeta, brand: string, title: string): Promise<any> {
  const shotsBlock = realShotsBlock(meta);
  // When real cut detection produced shots, the model DESCRIBES each measured shot
  // (no inventing count/order/timecode). Otherwise it falls back to inferring rows.
  const shotlistSpec = shotsBlock
    ? ` "shotlist": {
   "rows": [ {"no": 1, "beat": "SETUP|DESIRE|CONFLICT|CHANGE|RESULT", "size": "WS|MS|CU|ECU|OTS", "lens": "e.g. 32mm", "move": "e.g. slow push", "description": "the shot in one line"} ]  // EXACTLY ONE row per REAL SHOT listed below, SAME numbers, SAME order. Do NOT add, merge, drop, or renumber shots, and do NOT output "tc" (the measured timecode is set for you). Read each shot's evidence frames + VO to describe its size/lens/move/beat.
 },`
    : ` "shotlist": {
   "rows": [ {"no": 1, "tc": "0:03", "beat": "SETUP", "size": "WS|MS|CU|ECU|OTS", "lens": "e.g. 32mm", "move": "e.g. slow push", "description": "the shot in one line"} ]  // number every A-shot of the film in timecode order; tc from the frame seconds
 },`;
  const prompt = `Continue the pre-production package for this finished ad (read AS IF HJEN made it). Author the reference hunt, the shotlist, and the pitch-deck page plan — client-facing.

AD: ${brand ? brand + ' — ' : ''}${title} · duration ${meta.durationS ?? '?'}s
${dialogueLabel(meta)}:
${renderTranscript(meta)}${renderOnScreen(meta) ? `\nON-SCREEN TEXT (OCR, timed):\n${renderOnScreen(meta)}` : ''}
FRAMES (filename@seconds): ${frameLine(meta)}
${shotsBlock ? `\nREAL SHOTS — measured from cut detection (describe EACH by its number, one row per shot, never invent/merge/renumber):\n${shotsBlock}\n` : ''}
CRAFT FINDINGS (evidence, per axis):
${findingsDigest(state)}

Return STRICT JSON:
{
 "referencesHunt": {
   "axes": ["the named search axes we would hunt along — e.g. 'wet night-street sports photography', 'Gulf youth street-cast portraiture' — 4-7 of them"],
   "items": [ {"title": "a named reference (photographer/campaign/year, or a precise search string)", "take": "what to TAKE from it", "leave": "what to LEAVE behind", "frames": ["f012"]} ]  // 6-10 items, cite an evidence frame where one matches
 },
${shotlistSpec}
 "pitchPages": [ {"title": "the page title", "content": "the page's copy / argument (1-3 sentences)", "visualSlot": "what image fills this page's frame slot"} ]  // the deck page-by-page: humility opener → what-we-love → the idea → visuals → close (8-12 pages)
}`;
  const res = await llmForTask('breakdown-docs', {
    system: DOCS_SYSTEM, prompt, maxTokens: 20000,
    imagePaths: pickFrames(meta.frames, 8).map(f => meta.thumbs.find(t => t.id === f.id)?.abs || f.abs),
  });
  if (!res.ok || !res.text) throw new Error(res.message || res.reason || 'docs (B) call failed');
  return parseJsonLoose(res.text);
}

// ─── assembler → AdBreakdown JSON ────────────────────────────────────────────
const BEATS = ['SETUP', 'DESIRE', 'CONFLICT', 'CHANGE', 'RESULT'];
const beatOf = (b: any): string => { const u = String(b || '').toUpperCase(); return BEATS.includes(u) ? u : 'SETUP'; };

function assemble(state: RunState, meta: IngestMeta, brand: string, title: string): any {
  const slug = meta.slug;
  const known = new Set(meta.frames.map(f => f.id));
  const keep = (names: any): string[] => (Array.isArray(names) ? names : []).map(fid).filter(i => known.has(i));

  // axes (OUTPUT 1 lives on each)
  const axes = BREAKDOWN_AXES.map(def => {
    const src = findAxisResult(state, def.slug);
    const findings = (src?.findings || []).map((f: any, n: number) => ({
      id: `bd-${slug}/${def.slug}/${String(n + 1).padStart(2, '0')}`,
      claim_en: clamp(f.claim_en),
      claim_ar: clamp(f.claim_ar) || undefined,
      howHjenMakesIt: clamp(f.how_hjen_makes_it) || undefined,
      frameIds: keep(f.frames),
      dimension: f.dimension || undefined,
      tags: Array.isArray(f.tags) ? f.tags : [],
      weight: [1, 2, 3].includes(f.weight) ? f.weight : undefined,
    })).filter((f: any) => f.claim_en);
    return {
      key: def.slug,                     // matched tolerantly by the disc
      title_en: def.en,
      title_ar: def.ar,
      summary: clamp(src?.summary) || undefined,
      heroFrameIds: keep(src?.hero_frames),
      findings,
      reproductionPrompt: clamp(src?.reproduction_prompt) || undefined,
    };
  });

  // OUTPUT 2 — pipeline documents
  const A = state.docsA || {};
  const B = state.docsB || {};

  const beats = (Array.isArray(A.beats) ? A.beats : []).slice(0, 6).map((b: any, i: number) => ({
    id: `bd-${slug}/pipeline/beat/${String(i + 1).padStart(2, '0')}`,
    beat: beatOf(b.beat),
    visual: clamp(b.visual),
    vo: clamp(b.vo) || undefined,
    frameIds: keep(b.frames),
  })).filter((b: any) => b.visual);

  const beatByFrame: Record<string, string> = {};
  for (const b of beats) for (const i of b.frameIds) if (!beatByFrame[i]) beatByFrame[i] = b.beat;

  const story = A.story ? {
    id: `bd-${slug}/pipeline/story`,
    wantButUntil: clamp(A.story.wantButUntil) || clamp(A.wantButUntil),
    emotionalQuestion: clamp(A.story.emotionalQuestion) || undefined,
    narrative: clamp(A.story.narrative),
    beats: (Array.isArray(A.story.beats) ? A.story.beats : []).map((b: any) => ({
      beat: beatOf(b.beat), line: clamp(b.line), metaphor: clamp(b.metaphor) || undefined,
    })).filter((b: any) => b.line),
  } : undefined;

  const t = A.treatment || {};
  const firstFrameId = keep([t.firstFrame])[0];
  const lastFrameId = keep([t.lastFrame])[0];
  const treatment = {
    id: `bd-${slug}/pipeline/treatment`,
    choicePairs: {
      aspect: clamp(t.choicePairs?.aspect), lens: clamp(t.choicePairs?.lens),
      lightDirection: clamp(t.choicePairs?.lightDirection), cameraMove: clamp(t.choicePairs?.cameraMove),
      hour: clamp(t.choicePairs?.hour), placeRegister: clamp(t.choicePairs?.placeRegister),
    },
    lookPhrase: clamp(t.lookPhrase),
    prose: clamp(t.prose) || undefined,
    firstFrameId, lastFrameId,
  };

  const referencesHunt = B.referencesHunt ? {
    id: `bd-${slug}/pipeline/refhunt`,
    axes: (Array.isArray(B.referencesHunt.axes) ? B.referencesHunt.axes : []).map(clamp).filter(Boolean),
    items: (Array.isArray(B.referencesHunt.items) ? B.referencesHunt.items : []).map((r: any) => ({
      title: clamp(r.title), take: clamp(r.take), leave: clamp(r.leave), frameIds: keep(r.frames),
    })).filter((r: any) => r.title),
  } : undefined;

  // derive the simple references list (back-compat with the drag currency + old renderer)
  const references = (referencesHunt?.items || []).map((r: any, i: number) => ({
    id: `bd-${slug}/pipeline/ref/${String(i + 1).padStart(2, '0')}`,
    note: [r.title, r.take && `TAKE: ${r.take}`, r.leave && `LEAVE: ${r.leave}`].filter(Boolean).join(' · '),
    frameIds: r.frameIds || [],
  }));

  // SHOTLIST — when real cuts were detected, the rows ARE the measured shots
  // (no/tc from meta.shots), and the model only supplies size/lens/move/beat/desc
  // matched by shot number. Otherwise fall back to the model-inferred rows. Row
  // SHAPE is identical either way (no · tc · beat · size · lens · move · description),
  // so master-prompt fusion / resume / checkpoint are untouched.
  const modelRows: any[] = Array.isArray(B.shotlist?.rows) ? B.shotlist.rows : [];
  let shotlist: any;
  if (meta.shots && meta.shots.length) {
    const byNo = new Map<number, any>();
    for (const r of modelRows) if (Number.isFinite(r?.no)) byNo.set(Number(r.no), r);
    shotlist = {
      id: `bd-${slug}/pipeline/shotlist`,
      rows: meta.shots.map(s => {
        const r = byNo.get(s.no) || {};
        return {
          no: s.no, tc: fmtTc(s.tcIn),
          beat: clamp(r.beat) || undefined, size: clamp(r.size) || undefined,
          lens: clamp(r.lens) || undefined, move: clamp(r.move) || undefined,
          description: clamp(r.description) || `Shot ${s.no}`,
        };
      }),
    };
  } else if (B.shotlist) {
    shotlist = {
      id: `bd-${slug}/pipeline/shotlist`,
      rows: modelRows.map((r: any, i: number) => ({
        no: Number.isFinite(r.no) ? r.no : i + 1,
        tc: clamp(r.tc) || undefined, beat: clamp(r.beat) || undefined,
        size: clamp(r.size) || undefined, lens: clamp(r.lens) || undefined, move: clamp(r.move) || undefined,
        description: clamp(r.description),
      })).filter((r: any) => r.description),
    };
  } else shotlist = undefined;

  const pitchPages = (Array.isArray(B.pitchPages) ? B.pitchPages : []).map((p: any, i: number) => ({
    id: `bd-${slug}/pipeline/pitchpage/${String(i + 1).padStart(2, '0')}`,
    title: clamp(p.title), content: clamp(p.content), visualSlot: clamp(p.visualSlot),
  })).filter((p: any) => p.title || p.content);

  const brief = A.brief ? {
    id: `bd-${slug}/pipeline/brief`,
    rawBrief: clamp(A.brief.rawBrief),
    proposition: clamp(A.brief.proposition),
    persona: clamp(A.brief.persona),
    bigIdea: {
      name: clamp(A.brief.bigIdea?.name),
      hook: clamp(A.brief.bigIdea?.hook),
      insight: clamp(A.brief.bigIdea?.insight),
      culturalTruth: clamp(A.brief.bigIdea?.culturalTruth) || undefined,
    },
  } : { id: `bd-${slug}/pipeline/brief`, rawBrief: '', proposition: '', persona: '', bigIdea: { name: '', hook: '', insight: '' } };

  // frames — keep ALL ingested frames (the hub crossfade + thumbs draw on them),
  // tagging any that a beat references.
  const frames = meta.frames.map(f => ({
    id: f.id, file: f.rel, t: f.t, ...(beatByFrame[f.id] ? { beat: beatByFrame[f.id] } : {}),
  }));

  return {
    version: 1,
    id: `bd-${slug}`,
    slug,
    ad: {
      title: title || meta.sourceInfo?.title || slug,
      brand: brand || '',
      year: (meta.sourceInfo?.uploadDate || '').slice(0, 4) || undefined,
      durationS: meta.durationS ?? undefined,
      sourceUrl: meta.sourceInfo?.webpageUrl || undefined,
      logline_en: clamp(A.brief?.proposition) || undefined,
      premise: 'made-by-hjen',
    },
    frames,
    axes,
    pipeline: {
      brief, beats, wantButUntil: clamp(A.wantButUntil) || undefined,
      references, referencesHunt, treatment, pitch: [], pitchPages,
      story, shotlist,
    },
    approved: false,
    createdAt: new Date().toISOString(),
    model: 'hjen-breakdown-run',
    generatedByRun: true,
  };
}

// ─── checkpoint — the mid-run save that makes RESUME real ────────────────────
// breakdown.json lands only at the very end; this mirrors the in-memory RunState
// to run-state.json after every expensive phase, so a quit mid-run resumes from
// exactly where it stopped (runBreakdown skips whatever the reloaded state holds).
// Best-effort: a failed checkpoint never breaks the run.
async function saveCheckpoint(slug: string, brand: string, title: string, state: RunState): Promise<void> {
  try {
    await window.hjen.breakdownRunstateWrite({
      slug,
      state: {
        version: 1, slug, brand, title,
        meta: state.meta, vision: state.vision,
        dnaMade: state.dnaMade || [], docsA: state.docsA, docsB: state.docsB,
        master: state.master || {},
        updatedAt: new Date().toISOString(),
      },
    });
  } catch { /* checkpoint is best-effort; the run continues either way */ }
}

/** Rebuild a RunState from a persisted checkpoint (see saveCheckpoint). Returns
 *  null when there is no usable checkpoint (no ingested meta to resume from). */
export function runStateFromCheckpoint(cp: any): { state: RunState; brand: string; title: string } | null {
  if (!cp || typeof cp !== 'object' || !cp.meta) return null;
  return {
    state: {
      meta: cp.meta as IngestMeta,
      vision: (cp.vision && typeof cp.vision === 'object') ? cp.vision : {},
      dnaMade: Array.isArray(cp.dnaMade) ? cp.dnaMade : [],
      docsA: cp.docsA, docsB: cp.docsB,
      master: (cp.master && typeof cp.master === 'object') ? cp.master : {},
    },
    brand: String(cp.brand || ''),
    title: String(cp.title || ''),
  };
}

// ─── the run ─────────────────────────────────────────────────────────────────
// WEB: the ENTIRE breakdown runs on the SERVER (ffmpeg ingest → vision → docs).
// Upload the picked video, start the run, and translate the poll-status into the
// same RunEvents the progress UI already renders. Desktop keeps its local pipeline.
async function runBreakdownViaGateway(
  input: RunOpts['input'],
  emit: (e: RunEvent) => void,
  cancelled: () => boolean,
): Promise<{ ok: boolean; slug?: string; message?: string }> {
  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  const H = window.hjen as any;
  try {
    emit({ type: 'phase', phase: 'fetch', label: 'Uploading the film…' });
    const ing: any = await H.breakdownIngest?.({ filePath: input.filePath, slug: input.slug });
    if (!ing?.ok) { emit({ type: 'error', message: ing?.message || 'Upload failed' }); return { ok: false, message: ing?.message }; }
    const slug: string = ing.slug;
    emit({ type: 'slug', slug });
    emit({ type: 'phase', phase: 'frames', label: `Ingested ${(ing.frames || []).length} frames` });
    const run: any = await H.breakdownRun?.({ slug });
    if (!run?.ok && run?.started === false && run?.status !== 'running') { emit({ type: 'error', message: run?.message || 'Run failed to start' }); return { ok: false }; }
    for (;;) {
      if (cancelled()) return { ok: false, message: 'cancelled' };
      await sleep(4000);
      const st: any = await H.breakdownRunStatus?.({ slug });
      if (!st?.ok) continue;
      if (st.stage === 'docs') emit({ type: 'phase', phase: 'docs', label: 'Authoring — brief · story · treatment' });
      else emit({ type: 'phase', phase: 'vision', label: `Reading the film — ${st.done || 0}/${st.total || 6} passes` });
      if (st.status === 'done') { emit({ type: 'phase', phase: 'write', label: 'Done' }); return { ok: true, slug }; }
      if (st.status === 'error') { emit({ type: 'error', message: st.error || 'The run failed.' }); return { ok: false, message: st.error }; }
    }
  } catch (e: any) { emit({ type: 'error', message: String(e?.message || e) }); return { ok: false, message: String(e?.message || e) }; }
}

export async function runBreakdown(opts: RunOpts): Promise<{ ok: boolean; slug?: string; message?: string }> {
  const { input, runId, state, emit, cancelled } = opts;
  // On the WEB the whole pipeline is server-side; the desktop path below is local.
  if ((window.hjen as any).__web) return runBreakdownViaGateway(input, emit, cancelled);
  try {
    // ── INGEST (native) ──
    if (!state.meta) {
      emit({ type: 'phase', phase: 'fetch', label: 'Fetching the film…' });
      const res = await window.hjen.breakdownIngest({
        runId, url: input.url, filePath: input.filePath, slug: input.slug,
      });
      if (cancelled() || res.cancelled) return { ok: false, message: 'cancelled' };
      if (!res.ok || !res.meta) { emit({ type: 'error', message: res.message || 'ingest failed' }); return { ok: false, message: res.message }; }
      state.meta = res.meta as IngestMeta;
    }
    const meta = state.meta!;
    const brand = clamp(input.brand);
    const title = clamp(input.title) || meta.sourceInfo?.title || meta.slug;
    // Surface the slug now — frames + (soon) dna/*.gem.md are written under it,
    // so an interruption from here on is resumable from the on-disk checkpoint.
    emit({ type: 'slug', slug: meta.slug });
    await saveCheckpoint(meta.slug, brand, title, state);   // ingest done → first save

    // ── OCR — read on-screen text ONCE, before the passes, so every axis + the
    // docs see it (brand-entry, end-card, supers). Arabic-first. Best-effort. ──
    if (meta.onScreenText === undefined) {
      if (cancelled()) return { ok: false, message: 'cancelled' };
      emit({ type: 'phase', phase: 'vision', label: 'Reading on-screen text…' });
      try { meta.onScreenText = await runScreenText(meta); } catch { meta.onScreenText = []; }
      await saveCheckpoint(meta.slug, brand, title, state);
    }

    // ── VISION PASSES (OUTPUT 1) — run IN PARALLEL (bounded), each independent ──
    // Sequential, these six multimodal reads were most of the run's wall-time.
    // A concurrency cap keeps the payload sane (each sends ~50 images) while cutting
    // the stage to roughly two waves. Each pass checkpoints as it lands; a failure
    // stops the stage (resumable — finished passes are skipped on retry).
    for (const pass of VISION_PASSES) {
      if (state.vision[pass.id]) { for (const s of pass.axes) emit({ type: 'axis-done', slug: s }); emit({ type: 'pass-done', pass: pass.id }); }
    }
    {
      const todo = VISION_PASSES.filter(p => !state.vision[p.id]);
      if (todo.length) {
        if (cancelled()) return { ok: false, message: 'cancelled' };
        emit({ type: 'phase', phase: 'vision', label: `Reading the film — ${todo.length} passes` });
        const box: { failed: { pass: string; msg: string } | null } = { failed: null };
        await mapPool(todo, VISION_CONCURRENCY, async pass => {
          if (cancelled() || box.failed) return;
          try {
            const r = await runVisionPass(pass, meta);
            state.vision[pass.id] = r;
            for (const s of pass.axes) emit({ type: 'axis-done', slug: s });
            emit({ type: 'pass-done', pass: pass.id });
            await saveCheckpoint(meta.slug, brand, title, state);
          } catch (e: any) { if (!box.failed) box.failed = { pass: pass.id, msg: String(e?.message || e) }; }
        });
        if (cancelled()) return { ok: false, message: 'cancelled' };
        if (box.failed) { emit({ type: 'pass-error', pass: box.failed.pass, message: box.failed.msg }); return { ok: false, message: `vision:${box.failed.pass}: ${box.failed.msg}` }; }
      }
    }

    // ── DNA STAGE (OUTPUT 1½ — distil one Gem per axis, write LIVE) ──
    // Runs after the vision passes (it needs their findings + make-prompts) and
    // before docs, so a docs failure never costs the DNA. Resumable: axes already
    // written are skipped on retry.
    {
      if (cancelled()) return { ok: false, message: 'cancelled' };
      emit({ type: 'phase', phase: 'dna', label: 'Distilling — the 13 axis DNAs' });
      const dnaInput = dnaInputFromRun(state, meta, brand, title);
      dnaInput.skip = new Set(state.dnaMade || []);
      const dnaTotal = dnaInput.axes.filter(a => !dnaInput.skip!.has(a.slug)).length;
      let dnaDone = 0;
      const dnaRes = await runDnaStage(
        dnaInput,
        ev => {
          if (ev.type === 'dna-axis') {
            (state.dnaMade ||= []).push(ev.slug);
            emit({ type: 'dna-done', slug: ev.slug, done: ++dnaDone, total: dnaTotal });
            // Checkpoint each axis so a later failure never re-distils it on resume.
            void saveCheckpoint(meta.slug, brand, title, state);
          }
        },
        cancelled,
      );
      if (cancelled()) return { ok: false, message: 'cancelled' };
      // DNA is ENRICHMENT (the master fusion degrades gracefully to raw findings
      // for any missing axis, and the DNA library offers "MAKE THE DNAS" to fill
      // the rest). So a partial DNA stage must NOT stop the whole run — only a
      // TOTAL wipe (zero made, e.g. the connection is down) is a real failure.
      if (!dnaRes.ok && (state.dnaMade?.length ?? 0) === 0) {
        emit({ type: 'pass-error', pass: 'dna', message: dnaRes.message || 'dna failed' });
        return { ok: false, message: dnaRes.message };
      }
      await saveCheckpoint(meta.slug, brand, title, state);   // DNAs written → save
    }

    // ── DOCS PASSES (OUTPUT 2) ──
    if (!state.docsA) {
      if (cancelled()) return { ok: false, message: 'cancelled' };
      emit({ type: 'phase', phase: 'docs', label: 'Authoring — brief · story · treatment' });
      try { state.docsA = await runDocsA(state, meta, brand, title); }
      catch (e: any) { emit({ type: 'pass-error', pass: 'docsA', message: String(e?.message || e) }); return { ok: false, message: `docsA: ${String(e?.message || e)}` }; }
      await saveCheckpoint(meta.slug, brand, title, state);
    }
    if (!state.docsB) {
      if (cancelled()) return { ok: false, message: 'cancelled' };
      emit({ type: 'phase', phase: 'docs', label: 'Authoring — references · shotlist · pitch' });
      try { state.docsB = await runDocsB(state, meta, brand, title); }
      catch (e: any) { emit({ type: 'pass-error', pass: 'docsB', message: String(e?.message || e) }); return { ok: false, message: `docsB: ${String(e?.message || e)}` }; }
      await saveCheckpoint(meta.slug, brand, title, state);
    }

    // ── ASSEMBLE ──
    let breakdown = assemble(state, meta, brand, title);

    // ── MASTER PROMPT STAGE (OUTPUT 3 — the convergence) ──
    // Runs AFTER the DNAs (it fuses them) and after the shotlist exists in the
    // assembled breakdown. Resumable: shots already fused (state.master) are
    // skipped on retry. A failure here stops honestly and keeps every prior stage.
    {
      if (cancelled()) return { ok: false, message: 'cancelled' };
      emit({ type: 'phase', phase: 'master', label: 'Fusing — one master prompt per shot' });
      const mpInput = masterPromptInputFromBreakdown(breakdown);
      const already = new Set(Object.keys(state.master || {}).map(Number));
      const mpTotal = mpInput.shots.filter(s => !already.has(s.no)).length;
      let mpDone = 0;
      const mpRes = await runMasterPromptStage(
        mpInput,
        ev => {
          if (ev.type === 'mp-shot') {
            (state.master ||= {})[ev.no] = ev.mp;
            emit({ type: 'master-shot', no: ev.no, done: ++mpDone, total: mpTotal });
            // Checkpoint each fused shot so a batch failure never loses the shots
            // already made — resume picks up from the last fused shot, not zero.
            void saveCheckpoint(meta.slug, brand, title, state);
          }
        },
        cancelled,
        already,
      );
      if (!mpRes.ok) { emit({ type: 'pass-error', pass: 'master', message: mpRes.message || 'master failed' }); return { ok: false, message: mpRes.message }; }
      await saveCheckpoint(meta.slug, brand, title, state);
    }
    if (state.master && Object.keys(state.master).length) breakdown = mergeMasterPrompts(breakdown, state.master);

    // ── WRITE ──
    emit({ type: 'phase', phase: 'write', label: 'Writing the breakdown…' });
    const w = await window.hjen.mindBreakdownWrite({ slug: meta.slug, breakdown });
    if (!w.ok) { emit({ type: 'error', message: w.message || 'write failed' }); return { ok: false, message: w.message }; }

    // The finished breakdown.json IS the record now — drop the mid-run checkpoint.
    try { await window.hjen.breakdownRunstateClear({ slug: meta.slug }); } catch { /* best-effort */ }

    // الدماغ الثاني — الالتقاط التلقائي: أودِع دروس هذا الإعلان في الذاكرة العابرة
    // للمشاريع. best-effort — لا يُفشِل التشغيل أبداً.
    try {
      const cap = await captureBreakdownToBrain(breakdown as unknown as AdBreakdown);
      if (cap.added || cap.merged) emit({ type: 'phase', phase: 'write', label: `الذاكرة: +${cap.added} درس · ${cap.merged} مُعزَّز (${cap.total})` });
    } catch { /* capture never blocks a finished breakdown */ }

    emit({ type: 'done', slug: meta.slug });
    return { ok: true, slug: meta.slug };
  } catch (e: any) {
    emit({ type: 'error', message: String(e?.message || e) });
    return { ok: false, message: String(e?.message || e) };
  }
}
