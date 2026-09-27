// BREAKDOWN — the MASTER PROMPT synthesis (renderer orchestration).
//
// The convergence. The 13 axes were separated into 13 DNAs (dna.ts); each one
// answers "how do I MAKE new work in this ad's language on THIS axis, alone."
// This module runs them back together: for EACH shot in the shotlist it fuses
// ALL 13 axes into ONE coherent, executable per-shot master prompt — in two
// forms (frame / video) — plus the concrete list of references to attach to
// reach a result identical to the deconstructed ad.
//
// It is grounded ENTIRELY in this ad's own distilled material (zero invention):
//   · the ad's 13 axis DNAs — their weight-3 laws, paste-ready outputs, and the
//     MACHINE PARAMETERS block (read from dna/<slug>.gem.md when present, else the
//     breakdown.json axis findings + reproductionPrompt),
//   · the treatment's lookPhrase + six choice-pairs,
//   · the measured palette hexes (sampled from the grading axis),
//   · each shot's row (beat/tc/size/lens/move/description) + its evidence frames.
//
// One LLM call per BATCH of shots (BATCH = 7), so a 65-shot ad is ~10 calls, not
// 65 — through the registry `breakdown-master` task (house LLM law: name a TASK,
// never a model). Two callers feed it the SAME input: the live run (run.ts, after
// the DNA + docs stages) and the retro "MAKE THE MASTER PROMPTS" action (from a
// stored breakdown.json). Nothing here is ad-specific — the fusion ORDER is
// universal; the CONTENT is 100% this ad's measured evidence.

import { llmForTask } from '../models/registry';
import { axisDef, matchAxisSlug, BREAKDOWN_AXES } from './axes';
import { parseGem } from './gem';
import type { AdBreakdown, ShotMasterPrompt, RefAttach, BreakdownEntities } from '../creativemind/breakdown';
import { entitiesForShot } from './entityResolver';

// ─── how many shots share one LLM call ───────────────────────────────────────
// Small on purpose: the fusion is GROUNDED in each shot's own frames (vision),
// so a call carries ≤2 images/shot and the model must bind each image to its
// shot. A big batch pools images across shots and the model loses the per-shot
// binding → it writes the ad's GENERIC pattern instead of THIS shot's real
// moment. 3 shots × 2 frames = ~6 images per call — reliable visual grounding.
export const MASTER_BATCH = 3;

// ─── normalized input (both callers build this) ──────────────────────────────
export interface MpShotInput {
  no: number;
  tc?: string; beat?: string; size?: string; lens?: string; move?: string;
  durationS?: number;                // this shot's window length (for motion read)
  tcInSec?: number; tcOutSec?: number;  // window bounds (sec) — for dense-frame motion sampling
  description: string;
  evidenceFrameIds: string[];        // frames from THIS ad nearest this shot
  /** Axis findings MEASURED on THIS shot's exact frames — the shot-specific
   *  wardrobe/light/subject/location facts, so the fusion grounds per-shot
   *  instead of leaning on the aggregate kit. */
  axisEvidence: { axis: string; claim: string }[];
}
export interface MpAxisKit {
  slug: string;
  en: string;
  summary?: string;
  makePrompt?: string;               // reproductionPrompt — the paste-ready OUTPUT 1
  laws: string[];                    // weight-3 findings, each "claim (fNNN…)"
  machineParams?: string;            // MACHINE PARAMETERS block from the DNA
  pasteReady?: string;               // the ► PASTE-READY OUTPUT clause from the DNA
}
export interface MpRefHuntItem { title: string; take: string; leave: string; frameIds: string[] }
export interface MasterPromptInput {
  slug: string;
  ad: { title: string; brand: string; year?: string; durationS?: number };
  lookPhrase?: string;
  lookLockClause?: string;           // the theme_look paste-ready clause (verbatim into every frame)
  choicePairs?: Record<string, string>;
  paletteHexes: string[];
  paletteNote?: string;
  refHuntAxes: string[];
  refHuntItems: MpRefHuntItem[];
  axes: MpAxisKit[];
  shots: MpShotInput[];
  entities?: BreakdownEntities;       // people + places linked across shots (identity + ref unification)
  frameAbs: (id: string) => string | undefined;
  knownFrameIds: Set<string>;
}

export type MpEvent =
  | { type: 'mp-batch'; index: number; total: number; shots: number }
  | { type: 'mp-shot'; no: number; mp: ShotMasterPrompt }
  | { type: 'mp-error'; message: string };

export interface MpStageResult { ok: boolean; byNo: Record<number, ShotMasterPrompt>; message?: string }

// ─── helpers ─────────────────────────────────────────────────────────────────
const clamp = (s: any): string => String(s ?? '').trim();
const fid = (s: any): string => String(s ?? '').trim().replace(/\.jpe?g$/i, '');

function parseJsonLoose(text: string): any {
  const t = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch { /* slice */ }
  const m = t.match(/[{[][\s\S]*[}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw new Error('model did not return valid JSON');
}

/** "0:03" | "3" | "3.2s" → seconds. */
function tcToSec(tc?: string): number | undefined {
  const s = clamp(tc); if (!s) return undefined;
  const m = /(\d+):(\d+)(?:\.(\d+))?/.exec(s);
  if (m) return (+m[1]) * 60 + (+m[2]) + (m[3] ? +`0.${m[3]}` : 0);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/** All #RRGGBB / #RGB in a blob, deduped, order preserved. */
function pullHexes(blob: string): string[] {
  const out: string[] = [];
  for (const m of (blob || '').matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
    const h = m[0].toLowerCase();
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

// ─── build the per-axis kit from breakdown.json (no disk read) ───────────────
function buildAxisKits(bd: AdBreakdown): MpAxisKit[] {
  const kits: MpAxisKit[] = [];
  for (const def of BREAKDOWN_AXES) {
    const ax = (bd.axes || []).find(a =>
      matchAxisSlug((a as any).key) === def.slug || matchAxisSlug((a as any).title_en) === def.slug);
    if (!ax) continue;
    const findings = Array.isArray(ax.findings) ? ax.findings : [];
    const laws = findings
      .filter(f => (f.weight ?? 0) >= 3 && clamp(f.claim_en))
      .map(f => `${clamp(f.claim_en)}${f.frameIds?.length ? ` (${f.frameIds.join(', ')})` : ''}`);
    // if no w3 laws, promote the two strongest w2 patterns so every present axis contributes
    if (!laws.length) {
      for (const f of findings.filter(f => (f.weight ?? 0) >= 2 && clamp(f.claim_en)).slice(0, 2)) {
        laws.push(`${clamp(f.claim_en)}${f.frameIds?.length ? ` (${f.frameIds.join(', ')})` : ''}`);
      }
    }
    kits.push({
      slug: def.slug, en: def.en,
      summary: clamp(ax.summary) || undefined,
      makePrompt: clamp((ax as any).reproductionPrompt) || undefined,
      laws,
    });
  }
  return kits;
}

// ─── enrich kits with the distilled DNA (dna/<slug>.gem.md) when it exists ────
// Pulls the two load-bearing sections: the MACHINE PARAMETERS block (measured
// params) and the ► PASTE-READY OUTPUT clause. Missing file → the kit keeps its
// breakdown.json material (graceful degrade). Returns count enriched.
async function enrichKitsFromDna(slug: string, kits: MpAxisKit[]): Promise<number> {
  let n = 0;
  await Promise.all(kits.map(async kit => {
    try {
      const res = await window.hjen.mindBreakdownDnaRead({ slug, axis: kit.slug });
      if (!res?.ok || typeof res.text !== 'string' || !res.text.trim()) return;
      const gem = parseGem(res.text);
      const ctx = gem.segments.context || '';
      const mp = /MACHINE PARAMETERS\s*```([\s\S]*?)```/i.exec(ctx);
      if (mp) kit.machineParams = clamp(mp[1]);
      const ins = gem.segments.instructions || '';
      const pr = /►\s*PASTE-READY OUTPUT[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/i.exec(ins);
      if (pr) kit.pasteReady = clamp(pr[1]);
      // constraints as extra laws where breakdown.json was thin
      if (!kit.laws.length) {
        const con = (gem.segments.constraints || '').split(/\n(?=LAW|PROMOTED|REFUSE|MUST)/).map(clamp).filter(Boolean).slice(0, 3);
        kit.laws = con;
      }
      n++;
    } catch { /* keep breakdown.json material */ }
  }));
  return n;
}

// ─── deterministic input from a stored breakdown.json ────────────────────────
export function masterPromptInputFromBreakdown(bd: AdBreakdown): MasterPromptInput {
  const frameFile = new Map<string, string>();
  const knownFrameIds = new Set<string>();
  const framesByT: { id: string; t: number }[] = [];
  for (const f of Array.isArray(bd.frames) ? bd.frames : []) {
    if (!f?.id) continue;
    knownFrameIds.add(f.id);
    if (f.file) frameFile.set(f.id, f.file);
    if (typeof f.t === 'number') framesByT.push({ id: f.id, t: f.t });
  }
  const framesByBeat = new Map<string, string[]>();
  for (const f of Array.isArray(bd.frames) ? bd.frames : []) {
    if (f?.beat && f.id) { const k = String(f.beat).toUpperCase(); (framesByBeat.get(k) || framesByBeat.set(k, []).get(k)!).push(f.id); }
  }

  const axes = buildAxisKits(bd);

  // palette — measured hexes from the grading axis (make-prompt + laws + params)
  const grade = axes.find(a => a.slug === 'grading_color');
  const gradeBlob = [grade?.makePrompt, grade?.laws.join(' '), grade?.machineParams, grade?.pasteReady].filter(Boolean).join(' ');
  const paletteHexes = pullHexes(gradeBlob);
  const paletteNote = paletteHexes.length ? undefined
    : (grade?.summary || grade?.laws[0] || 'grade is behavioral — no sampled hexes in this ad’s evidence');

  // theme_look paste-ready = the verbatim look-lock clause
  const look = axes.find(a => a.slug === 'theme_look');
  const lookLockClause = look?.pasteReady || look?.makePrompt || undefined;

  const pl: any = bd.pipeline || {};
  const t = pl.treatment || {};
  const rh = pl.referencesHunt || {};

  // shots + their evidence frames. When the shotlist came from real cut detection
  // (ordered tc), a shot's window is [this tc, NEXT row's tc) — so evidence frames
  // are the ones that actually fall INSIDE the shot, not a nearest-neighbour guess.
  // Falls back to nearest-by-tc, then beat, when a window yields nothing.
  // every finding across all axes, tagged with its axis + the frames it was
  // measured on — the pool we intersect per shot for SHOT-SPECIFIC evidence.
  const allFindings: { axis: string; claim: string; frameIds: string[]; weight: number }[] = [];
  for (const a of Array.isArray(bd.axes) ? bd.axes : []) {
    const slug = matchAxisSlug((a as any).key) || matchAxisSlug((a as any).title_en) || clamp((a as any).key);
    for (const f of Array.isArray(a.findings) ? a.findings : []) {
      const claim = clamp(f.claim_en);
      if (claim) allFindings.push({ axis: slug, claim, frameIds: Array.isArray(f.frameIds) ? f.frameIds : [], weight: f.weight ?? 0 });
    }
  }

  const rows: any[] = Array.isArray(pl.shotlist?.rows) ? pl.shotlist.rows : [];
  const rowSecs = rows.map(r => tcToSec(r.tc));
  const lastT = framesByT.length ? framesByT[framesByT.length - 1].t + 1 : Infinity;
  const shots: MpShotInput[] = rows.map((r: any, i: number) => {
    const sec = rowSecs[i];
    const nextSec = rowSecs.slice(i + 1).find(v => v != null && (sec == null || v > sec));
    const tcOut = nextSec != null ? nextSec : lastT;
    let ev: string[] = [];
    if (sec != null && framesByT.length) {
      ev = framesByT.filter(f => f.t >= sec - 0.05 && f.t < tcOut + 0.05).slice(0, 4).map(f => f.id);
      if (!ev.length) ev = [...framesByT].sort((a, b) => Math.abs(a.t - sec) - Math.abs(b.t - sec)).slice(0, 2).map(f => f.id);
    }
    if (!ev.length && r.beat) ev = (framesByBeat.get(String(r.beat).toUpperCase()) || []).slice(0, 2);
    // shot-specific axis evidence: findings whose frames fall inside THIS shot,
    // strongest first, one line per axis-claim (deduped, capped).
    const evSet = new Set(ev);
    const seen = new Set<string>();
    const axisEvidence = allFindings
      .filter(f => f.frameIds.some(id => evSet.has(id)))
      .sort((a, b) => b.weight - a.weight)
      .filter(f => { const k = f.axis + '::' + f.claim; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 12)
      .map(f => ({ axis: f.axis, claim: f.claim }));
    const hasWindow = sec != null && tcOut != null && tcOut > sec && Number.isFinite(tcOut);
    const durationS = hasWindow ? +(tcOut - sec).toFixed(2) : undefined;
    return {
      no: Number.isFinite(r.no) ? r.no : i + 1,
      tc: clamp(r.tc) || undefined, beat: clamp(r.beat) || undefined,
      size: clamp(r.size) || undefined, lens: clamp(r.lens) || undefined, move: clamp(r.move) || undefined,
      durationS,
      tcInSec: hasWindow ? sec : undefined,
      tcOutSec: hasWindow ? tcOut : undefined,
      description: clamp(r.description),
      evidenceFrameIds: ev,
      axisEvidence,
    };
  }).filter(s => s.description);

  return {
    slug: bd.slug,
    ad: { title: bd.ad?.title || bd.slug, brand: bd.ad?.brand || '', year: bd.ad?.year, durationS: bd.ad?.durationS },
    lookPhrase: clamp(t.lookPhrase) || undefined,
    lookLockClause,
    choicePairs: t.choicePairs || undefined,
    paletteHexes, paletteNote,
    refHuntAxes: Array.isArray(rh.axes) ? rh.axes.map(clamp).filter(Boolean) : [],
    refHuntItems: (Array.isArray(rh.items) ? rh.items : []).map((r: any) => ({
      title: clamp(r.title), take: clamp(r.take), leave: clamp(r.leave),
      frameIds: Array.isArray(r.frameIds) ? r.frameIds.map(fid) : [],
    })).filter((r: MpRefHuntItem) => r.title),
    axes, shots,
    entities: (pl.entities && (Array.isArray(pl.entities.persons) || Array.isArray(pl.entities.places)))
      ? { persons: pl.entities.persons || [], places: pl.entities.places || [] } : undefined,
    frameAbs: (id: string) => frameFile.get(id),
    knownFrameIds,
  };
}

// ─── the shared AD DNA KIT block (fed to every batch, the fusion source) ─────
function kitBlock(input: MasterPromptInput): string {
  const cp = input.choicePairs || {};
  const cpLine = ['aspect', 'lens', 'lightDirection', 'cameraMove', 'hour', 'placeRegister']
    .map(k => cp[k] ? `${k}=${clamp(cp[k])}` : '').filter(Boolean).join(' · ');
  const parts: string[] = [];
  parts.push(`AD: ${input.ad.brand ? input.ad.brand + ' — ' : ''}${input.ad.title}${input.ad.year ? ` (${input.ad.year})` : ''} · ${input.ad.durationS ?? '?'}s`);
  if (input.lookPhrase) parts.push(`LOOK PHRASE: "${input.lookPhrase}"`);
  if (cpLine) parts.push(`CHOICE-PAIRS: ${cpLine}`);
  parts.push(input.paletteHexes.length
    ? `PALETTE (measured hexes — the grade anchors): ${input.paletteHexes.join(', ')}`
    : `PALETTE: no sampled hexes in this ad’s evidence — anchor the grade in words: ${input.paletteNote}`);
  if (input.lookLockClause) parts.push(`LOOK-LOCK CLAUSE (paste VERBATIM into every FRAME prompt):\n${input.lookLockClause}`);

  const axisBlocks = input.axes.map(a => {
    const seg: string[] = [`── ${a.slug} (${a.en}) ──`];
    if (a.summary) seg.push(`thesis: ${a.summary}`);
    if (a.makePrompt) seg.push(`MAKE-PROMPT: ${a.makePrompt.slice(0, 1300)}`);
    if (a.laws.length) seg.push(`LAWS:\n${a.laws.map(l => `  • ${l}`).join('\n')}`);
    if (a.machineParams) seg.push(`MACHINE PARAMS:\n${a.machineParams}`);
    if (a.pasteReady) seg.push(`PASTE-READY: ${a.pasteReady}`);
    return seg.join('\n');
  }).join('\n\n');

  const refs = input.refHuntItems.length
    ? `\n\nREFERENCE HUNT (source EXTERNAL references from here; each names what to TAKE):\n${input.refHuntItems.map((r, i) => `  R${i + 1}. ${r.title} — TAKE: ${r.take}${r.frameIds.length ? ` (nearest ad-frame: ${r.frameIds.join(', ')})` : ''}`).join('\n')}`
    : '';

  return `${parts.join('\n')}\n\n═══════════ THE AD'S 13-AXIS DNA KIT — the CRAFT LAYER (HOW this ad is MADE: light logic, grade, look, wardrobe rules, refusals). It governs STYLE, never the subject you SEE. ═══════════\n${axisBlocks}${refs}`;
}

const MASTER_SYSTEM = `You are HJEN BREAKDOWN's MASTER-PROMPT synthesist. For each shot you write ONE executable per-shot prompt a model can run to MAKE that exact shot.

GROUND TRUTH IS THE FRAME. You are given each shot's ACTUAL frames as images. What is visibly in the frame — how many people, who they are (age, apparent age of a child vs teen vs adult), their pose / gesture / eye-line, the camera angle and height, the real shot size, the wardrobe actually worn, whether the motion is slow-motion or real-time — is the TRUTH and OVERRIDES everything else. Describe the shot that is actually there.

THE 13-AXIS DNA KIT IS THE CRAFT LAYER, NOT THE SUBJECT. The kit tells you HOW this ad is crafted (light architecture, grade/hex anchors, the look-lock clause, wardrobe RULES, the refusals) — apply it to the subject you SEE. It must NEVER replace the observed subject with the ad's generic pattern. If the ad's overall rule is "single figure, effort-first, jaw set" but THIS frame shows several kids and one raising a hand in reaction under a low upward angle, you write THAT — the reaction, the group, the low angle — styled with the ad's craft. A shot's text description or the aggregate kit NEVER wins over the frame; when they conflict, the FRAME wins.

AGE IS CRITICAL — read it off the FACE in the frame and state it precisely: a child is a child (~8–12), a young teen is a young teen (~13–15), an older teen (~16–18), an adult only if adult. NEVER age a young subject UP into a grown adult (a 30–40-year-old) to fit an "athlete / hero" stereotype — that is an egregious error. If the frame shows a kid, the made image MUST be that kid's age; name a tight age bracket so the model cannot drift older.

FULL DEPTH, IN A CONCISE STRIKING FORM. Write the FRAME like a cinematographer pitching the money-shot to a colleague — ONE tight, vivid paragraph where every word earns its place, NOT a padded 13-point checklist. It must still carry the shot's full craft (true age, piece-level wardrobe, the decisive action/physics, camera angle + height + lens, light architecture, grade/palette hexes, look, location/props) — but FUSED as prose, never enumerated, never summarised into blandness.

LEAD WITH ANGLE + ACTION — this is what makes a shot a shot, and it is where MADE most often fails by collapsing into a generic centred eye-level portrait. First, name the EXACT camera vantage — bird's-eye straight down, worm's-eye up from the ground, high aerial-side looking down, over-the-shoulder, hard profile, Dutch tilt — reading it off the frame; NEVER default to eye-level/centred unless the frame truly is that. Second, catch the subject at the DECISIVE physical instant read from the dense sequence (airborne at a leap's apex, exploding out of the blocks, arrow-straight in mid-fall, clinging mid-move, sliding) — never a safe static read. A specific striking angle + a caught action is the whole point; a pretty generic portrait is a FAILURE of this task. THEN weave the light, grade, look and world through as texture. Reproduce the ad's theme/look/light/cinematography faithfully — that study is the value; drop nothing that matters, pad nothing that doesn't.

Do not INVENT specifics the frame and kit are both silent on (a jersey number, a ball-in-hand) — but do FULLY express everything they DO give. House vocabulary law: NEVER use generate / generating / generation — use MAKE / MADE / FRAME / TAKE / REFINE. Any Arabic is living Saudi-register prose, never machine-Arabic, never letter-spaced. Return STRICT JSON only, no code fences.`;

function batchPrompt(input: MasterPromptInput, shots: MpShotInput[], imageMap: ShotImg[]): string {
  const shotBlocks = shots.map(s => {
    const meta = [s.tc && `tc ${s.tc}`, s.beat, s.size, s.lens && `lens ${s.lens}`, s.move && `move ${s.move}`,
      s.durationS != null && `~${s.durationS}s on screen`].filter(Boolean).join(' · ');
    const ev = s.axisEvidence.length
      ? `\n  SHOT-SPECIFIC EVIDENCE (measured on THIS shot's exact frames — prefer over the aggregate kit for wardrobe / light / subject / location):\n${s.axisEvidence.map(e => `    · [${e.axis}] ${e.claim}`).join('\n')}`
      : '';
    const ent = entitiesForShot(input.entities, s.no);
    const entLine = (ent.persons.length || ent.place)
      ? `\n  ENTITIES in this shot (SAME person/place recurs across the ad — keep them IDENTICAL across their shots; their locked reference frame is the unified ref, do not invent a new look):${ent.persons.map(p => `\n    · ${p.id} ${p.descriptor}${p.wardrobe ? ` — ${p.wardrobe}` : ''} [ref ${p.refFrameId}; also in shots ${p.shotNos.join(', ')}]`).join('')}${ent.place ? `\n    · ${ent.place.id} PLACE: ${ent.place.descriptor} [ref ${ent.place.refFrameId}; also in shots ${ent.place.shotNos.join(', ')}]` : ''}`
      : '';
    return `SHOT ${s.no}${meta ? ` [${meta}]` : ''}\n  its frames (see the IMAGES above; attach as ad-frame refs): ${s.evidenceFrameIds.join(', ') || '(none nearby)'}\n  auto description (a weak hint — the FRAME overrides it): ${s.description}${entLine}${ev}`;
  }).join('\n\n');

  const imgLines = imageMap.length
    ? imageMap.map((m, i) => `  image ${i + 1} = SHOT ${m.shotNo} · frame ${m.frameId}${m.t != null ? ` @ ${m.t.toFixed(2)}s` : ''}${m.dense ? ' (dense)' : ''}`).join('\n')
    : '  (no frames available for this batch — ground on the descriptions + kit)';
  const denseShots = [...new Set(imageMap.filter(m => m.dense).map(m => m.shotNo))];
  const denseNote = denseShots.length
    ? `\nSHOTS ${denseShots.join(', ')} carry CONSECUTIVE dense frames (the "@Xs (dense)" images) sampled a fraction of a second apart across the shot's window. Judge each such shot's MOTION REGISTER from them, not from the ad's aggregate edit stats. The PRIMARY, objective cue is MOTION BLUR / sharpness: fast motion captured at NORMAL speed streaks and blurs the moving parts; the SAME fast motion captured for SLOW-MOTION (high-frame-rate) is frozen CRISP and sharp with no blur. So — fast action (a leap, a sprint stride, a kick, flying sweat/dust) rendered SHARP with clean edges on the moving limbs/ball = SLOW-MOTION; visible motion-blur streaks on the moving parts = real-time. Corroborate with: (2) suspended particles — dust/sweat/water/ball hanging or drifting slowly in the air = slow-motion; (3) unnaturally smooth, floaty limb motion across the dense frames = slow-motion; (4) natural-duration — if the on-screen time clearly exceeds how long the action would take in reality, it is slow-motion even when displacement looks large. Do NOT default to "real-time" just because the subject shifts a lot between frames that are ~1s apart. State the register explicitly with the cue you used.
ALSO read the PHYSICS of the shot from the same dense sequence — the body's actual state and trajectory THROUGH SPACE, which one frame alone hides. Across the frames, is the subject airborne / mid-leap / at the jump's apex / rising / descending / landing / sliding / in contact / following through? A single frame is ambiguous (a boy with arms spread could be standing OR at the top of a jump); the consecutive frames disambiguate — e.g. legs leaving the ground across the frames means he is JUMPING / AIRBORNE, not standing. Ground the FRAME's subject in that true physical moment (the exact instant the shot dwells on), not a safe static read.`
    : '';

  return `${kitBlock(input)}

═══════════ THE IMAGES YOU ARE GIVEN (bind each to its shot — these are the GROUND TRUTH) ═══════════
${imgLines}${denseNote}

═══════════ THE SHOTS ═══════════
${shotBlocks}

═══════════ YOUR TASK ═══════════
For EACH shot, FIRST read its actual frame image(s) above, THEN write ONE coherent master-prompt paragraph a model can run to MAKE that exact shot. The 13-axis kit is the CRAFT layer (how to light / grade / style / what to refuse); the FRAME is the truth for who/how-many/pose/angle/motion. If the kit's generic pattern contradicts the frame, follow the frame. Stay silent on anything neither the frame nor the kit supports (honest "unknown" beats invention). Do this for ${shots.length} shot(s).

FRAME prompt — ONE tight cinematic paragraph in a director's voice, fused as prose (NOT a numbered list), that MAKES this exact shot. Build it in this WEIGHT order:
  • FIRST, CAMERA + ACTION together, and lead with it: the exact vantage/angle/height/lens (bird's-eye straight down, worm's-eye up, high aerial-side, over-the-shoulder, profile, Dutch — as SEEN, never a defaulted eye-level centred portrait) AND the subject caught at the decisive physical instant read from the dense sequence (airborne at the apex, exploding from the blocks, arrow-straight in mid-fall, clinging mid-move). This clause is non-negotiable and must be specific and striking.
  • the subject(s): how many, apparent age as a TIGHT bracket read from the FACE (e.g. "a boy about 13–14", never a 30–40 adult), pose/gesture/eye-line, inside-state — and the piece-level wardrobe actually worn (use the shot-specific wardrobe evidence).
  • the LIGHT: key/rim/fill by direction + quality and how it falls on the face/body — specific, never "well-lit / atmospheric".
  • the GRADE + LOOK: name the hex anchors (or the behavioral grade), the film-stock/era feel, then the LOOK-LOCK CLAUSE verbatim.
  • world/location + the telling prop, in a phrase; then a short REFUSE tail (the axes' refusals).
The whole paragraph reads like one confident breath — vivid, faithful, economical — so a model running it lands THIS shot's angle, action, light and grade, not a generic portrait. House imperative throughout (MAKE, never generate).

DESCRIPTION — the grounded human caption for THIS frame: a plain 1–2 sentence read of what is ACTUALLY in the image (who / where / the moment), the line you'd say to a friend, with NONE of the craft details (no lens/angle/light/grade/wardrobe/edit jargon). It MUST match the frame you see — if the frame is a woman alone in a crowd, the caption is a woman in a crowd; NEVER inherit a line from a neighbouring shot or from the weak auto-description. This caption is what labels the shot to the user, so its truth to the frame is mandatory. (e.g. "A young woman stands in a packed arena crowd, looking up, caught in the noise.")

VIDEO prompt — the FRAME evolved for motion, one paragraph for a video model (Seedance / Kling register). CRUCIAL: judge the MOTION REGISTER from the frames + this shot's on-screen duration — if apparent subject/camera displacement is small across the elapsed seconds, it is SLOW-MOTION; state it explicitly. Do NOT assert real-time from the ad's aggregate edit statistics. Then give the real camera MOVE, the action-over-time / effort (action axis), the pace feel for this beat, and ONE line of sound cue (sound axis).

references — the attachment list to reach a result IDENTICAL to this ad:
  · ad-frame refs: this shot's frames (ref = the exact frame id, e.g. "f014"), each with a purpose (what it locks: subject / wardrobe / light / composition / motion…);
  · external refs: 1-2 from the REFERENCE HUNT (ref = the title/description), each with a purpose.

Return STRICT JSON only, no code fences:
{"shots":[
  {"no": <number>, "description": "…", "frame": "…", "video": "…", "references": [{"kind": "ad-frame"|"external", "ref": "…", "purpose": "…"}]}
]}
Rules: return EXACTLY the shots numbered ${shots.map(s => s.no).join(', ')}. ad-frame refs MUST use ONLY this shot's frame ids. Never write generate/generating/generation.`;
}

function coerceRefs(raw: any, shot: MpShotInput, known: Set<string>): RefAttach[] {
  const out: RefAttach[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const kind = clamp(r?.kind) === 'external' ? 'external' : 'ad-frame';
    const purpose = clamp(r?.purpose);
    if (kind === 'ad-frame') {
      const ref = fid(r?.ref);
      if (ref && known.has(ref)) out.push({ kind, ref, purpose });
    } else {
      const ref = clamp(r?.ref);
      if (ref) out.push({ kind, ref, purpose });
    }
  }
  // guarantee at least the shot's own evidence frames as ad-frame refs
  if (!out.some(r => r.kind === 'ad-frame')) {
    for (const id of shot.evidenceFrameIds.slice(0, 2)) out.push({ kind: 'ad-frame', ref: id, purpose: 'nearest evidence frame — palette + composition anchor' });
  }
  return out;
}

/** Reference UNIFICATION: prepend each shot's ENTITY locked reference frames
 *  (one per recurring person + the place) so making shot 4 reuses P1's ONE ref
 *  from shot 1 — not a fresh reference per shot. Deduped against what's there. */
function withEntityRefs(refs: RefAttach[], input: MasterPromptInput, shotNo: number): RefAttach[] {
  const ent = entitiesForShot(input.entities, shotNo);
  if (!ent.persons.length && !ent.place) return refs;
  const have = new Set(refs.filter(r => r.kind === 'ad-frame').map(r => r.ref));
  const add: RefAttach[] = [];
  for (const p of ent.persons) {
    if (p.refFrameId && input.knownFrameIds.has(p.refFrameId) && !have.has(p.refFrameId)) {
      have.add(p.refFrameId);
      add.push({ kind: 'ad-frame', ref: p.refFrameId, purpose: `${p.id} identity lock — ${p.descriptor}${p.wardrobe ? ` (${p.wardrobe})` : ''}; the ONE reference for this person across shots ${p.shotNos.join(', ')}` });
    }
  }
  if (ent.place?.refFrameId && input.knownFrameIds.has(ent.place.refFrameId) && !have.has(ent.place.refFrameId)) {
    add.push({ kind: 'ad-frame', ref: ent.place.refFrameId, purpose: `${ent.place.id} place lock — ${ent.place.descriptor}; the ONE reference for this location across shots ${ent.place.shotNos.join(', ')}` });
  }
  return [...add, ...refs];
}

// Sample a few CONSECUTIVE dense frames inside a shot's window so the fusion can
// SEE the actual motion cadence — the reliable slow-motion signal (sparse 1fps
// frames sit ~1s apart, so their displacement can't reveal playback speed). Best
// effort: needs the ingested source video; returns [] when absent → the caller
// falls back to the stored evidence frames and the motion read stays honest-unknown.
async function denseMotionFrames(slug: string, s: MpShotInput): Promise<{ id: string; t: number; abs: string }[]> {
  if (s.tcInSec == null || s.tcOutSec == null) return [];
  const span = Math.max(0.4, s.tcOutSec - s.tcInSec);
  // denser sampling than the shotlist's ~1fps so the motion CADENCE (and thus
  // slow-motion) is actually visible between adjacent frames.
  const fps = span > 6 ? 4 : span > 3 ? 6 : span > 1.5 ? 8 : 12;
  try {
    const dense = await window.hjen.breakdownDenseFrames({ slug, tcIn: s.tcInSec, tcOut: s.tcOutSec, fps });
    const frames = dense?.ok && Array.isArray(dense.frames) ? dense.frames : [];
    if (!frames.length) return [];
    // thin to ≤6 evenly across the window — finer temporal resolution for motion
    const cap = 6;
    const step = frames.length / cap;
    const picked = frames.length <= cap ? frames
      : Array.from({ length: cap }, (_v, i) => frames[Math.min(frames.length - 1, Math.floor(i * step))]);
    return picked.map((f: any) => ({ id: f.id, t: f.t, abs: f.abs })).filter((f: any) => f.abs);
  } catch { return []; }
}

interface ShotImg { shotNo: number; frameId: string; t?: number; dense: boolean }

async function runBatch(input: MasterPromptInput, shots: MpShotInput[]): Promise<Record<number, ShotMasterPrompt>> {
  // Per-shot image binding, GROUNDED + MOTION-AWARE: for each shot prefer a few
  // consecutive DENSE frames across its window (so the model reads real motion,
  // incl. slow-motion); fall back to ≤2 stored evidence frames when no source
  // video. Each image carries its (shotNo, frameId, t, dense) so the prompt tells
  // the model exactly which image belongs to which shot — the fix for pooled-image
  // confusion.
  const imageMap: ShotImg[] = [];
  const imagePaths: string[] = [];
  const usedPaths = new Set<string>();
  const push = (shotNo: number, frameId: string, abs: string, t: number | undefined, dense: boolean) => {
    if (!abs || usedPaths.has(abs)) return;
    usedPaths.add(abs); imagePaths.push(abs); imageMap.push({ shotNo, frameId, t, dense });
  };
  for (const s of shots) {
    const dense = await denseMotionFrames(input.slug, s);
    if (dense.length) {
      for (const f of dense) push(s.no, f.id, f.abs, f.t, true);
    } else {
      for (const id of s.evidenceFrameIds.slice(0, 2)) push(s.no, id, input.frameAbs(id) || '', undefined, false);
    }
  }

  const res = await llmForTask('breakdown-master', {
    system: MASTER_SYSTEM,
    prompt: batchPrompt(input, shots, imageMap),
    maxTokens: 16000,
    imagePaths: imagePaths.length ? imagePaths : undefined,
  });
  if (!res.ok || !res.text) throw new Error(res.message || res.reason || 'master-prompt call failed');
  const parsed = parseJsonLoose(res.text);
  const arr = Array.isArray(parsed?.shots) ? parsed.shots : Array.isArray(parsed) ? parsed : [];
  const byNo = new Map(shots.map(s => [s.no, s]));
  const out: Record<number, ShotMasterPrompt> = {};
  for (const el of arr) {
    const no = Number(el?.no);
    const shot = byNo.get(no);
    if (!shot) continue;
    const frame = clamp(el?.frame), video = clamp(el?.video);
    if (!frame && !video) continue;
    const description = clamp(el?.description) || undefined;
    out[no] = { description, frame, video, references: withEntityRefs(coerceRefs(el?.references, shot, input.knownFrameIds), input, no) };
  }
  if (!Object.keys(out).length) throw new Error(`model returned no usable shots for batch ${shots[0]?.no}…`);
  return out;
}

// ─── the stage — batch by batch, emitting each shot the moment it lands ──────
export async function runMasterPromptStage(
  input: MasterPromptInput,
  emit: (ev: MpEvent) => void,
  cancelled: () => boolean,
  skip?: Set<number>,
  concurrency = 8,   // how many batch-calls fire at once (bounded pool)
): Promise<MpStageResult> {
  const byNo: Record<number, ShotMasterPrompt> = {};
  const todo = input.shots.filter(s => !(skip?.has(s.no)));
  if (!todo.length) return { ok: true, byNo };

  // enrich the axis kits with the distilled DNAs (measured params + paste-ready)
  await enrichKitsFromDna(input.slug, input.axes);

  const batches: MpShotInput[][] = [];
  for (let i = 0; i < todo.length; i += MASTER_BATCH) batches.push(todo.slice(i, i + MASTER_BATCH));

  // Fire the batches through a BOUNDED-CONCURRENCY POOL instead of one-after-another:
  // every batch is an independent LLM call, so N run at once and the wall-clock
  // becomes ~ceil(batches/N) waves, not the full sum. The cap protects the provider
  // from a rate-limit storm (which would fail calls → single-shot retries → slower).
  let failures = 0;
  const processBatch = async (shots: MpShotInput[], index: number) => {
    if (cancelled()) return;
    emit({ type: 'mp-batch', index: index + 1, total: batches.length, shots: shots.length });
    let res: Record<number, ShotMasterPrompt> = {};
    try {
      res = await runBatch(input, shots);
    } catch (e: any) {
      // A batch failing (a network blip that outlived the retries, or a payload
      // the provider dropped) must NOT sink the whole run. Degrade to single-shot
      // so one bad shot can't kill its neighbours, and each single still gets
      // llmForTask's transient-retry. Shots that still fail are left PENDING — the
      // retro "MAKE THE MASTER PROMPTS" button fills them later — never fatal.
      if (shots.length > 1) {
        for (const s of shots) {
          if (cancelled()) return;
          try { Object.assign(res, await runBatch(input, [s])); }
          catch (e2: any) { failures++; emit({ type: 'mp-error', message: `shot ${s.no}: ${String(e2?.message || e2)}` }); }
        }
      } else {
        failures++; emit({ type: 'mp-error', message: `shot ${shots[0]?.no}: ${String(e?.message || e)}` });
      }
    }
    for (const s of shots) {
      const mp = res[s.no];
      if (mp) { byNo[s.no] = mp; emit({ type: 'mp-shot', no: s.no, mp }); }
    }
  };

  const POOL = Math.max(1, Math.min(concurrency, batches.length));
  let next = 0;
  const worker = async () => {
    for (;;) {
      if (cancelled()) return;
      const i = next++;
      if (i >= batches.length) return;
      await processBatch(batches[i], i);
    }
  };
  await Promise.all(Array.from({ length: POOL }, worker));
  if (cancelled()) return { ok: false, byNo, message: 'cancelled' };
  // Only a TOTAL wipe is a real failure (e.g. the connection is down) — a partial
  // result is a success the user can top up. This is what lets a run finish even
  // when one shot keeps refusing, instead of throwing 33 good shots away.
  if (!Object.keys(byNo).length && todo.length) {
    return { ok: false, byNo, message: 'every master-prompt shot failed — check the connection, then RESUME' };
  }
  return { ok: true, byNo };
}

/** Merge synthesized master prompts into a breakdown's shotlist rows (in place-safe
 *  copy). Used by both the run write path and the retro action's persist. */
export function mergeMasterPrompts(bd: AdBreakdown, byNo: Record<number, ShotMasterPrompt>): AdBreakdown {
  const pl: any = bd.pipeline || {};
  if (!pl.shotlist?.rows) return bd;
  const rows = pl.shotlist.rows.map((r: any) => (byNo[r.no] ? { ...r, masterPrompt: byNo[r.no] } : r));
  return { ...bd, pipeline: { ...pl, shotlist: { ...pl.shotlist, rows } } };
}
