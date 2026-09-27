// BREAKDOWN — SERVER-SIDE run orchestration (Phase 2): the VISION stage. Reads the
// ingested frames/thumbs + transcript, runs the 13 craft axes across 6 multimodal
// vision passes (Gemini), and returns per-axis findings + reproduction prompts.
// Faithful port of app/src/lib/breakdown/run.ts's vision half. LAW: the analysis
// recipe (job briefs + premise + finding schema + prompts) lives here, server-side.
//
// Not yet ported (later batches): the docs/DNA/master-prompt/entity stages.

import fs from 'node:fs';
import path from 'node:path';
import { JOB_RAW } from './content.js';
import { AXIS_SLUGS, BREAKDOWN_AXES, axisDef } from './axes.js';

// ── the six vision passes (group 13 axes into ~5-6 multi-image calls) ────────
export const VISION_PASSES = [
  { id: 'story_message', label: 'STORY · BRIEF · MESSAGE', axes: ['story', 'brief', 'message'], frameCap: 40 },
  { id: 'image_look',    label: 'VISUALS · THEME & LOOK · GRADING', axes: ['visuals', 'theme_look', 'grading_color'], frameCap: 52 },
  { id: 'camera_edit',   label: 'CINEMATOGRAPHY · EDIT', axes: ['cinematography', 'edit'], frameCap: 52, withTimes: true },
  { id: 'people',        label: 'WARDROBE · CHARACTERS · ACTION', axes: ['wardrobe', 'characters', 'action'], frameCap: 52 },
  { id: 'sound',         label: 'MUSIC · SOUND DESIGN · VO', axes: ['sound'], frameCap: 14, withAudio: true },
  { id: 'art',           label: 'ART DIRECTION · LOCATION', axes: ['art_location'], frameCap: 44 },
];

const PREMISE = `GOVERNING PREMISE — non-negotiable: treat this ad as a finished AI-MADE film produced through HJEN Studio (a Saudi cinematic AI studio — image models MAKE first-frame plates, video models MAKE the moving shots, all controlled by written frame descriptions, look-locks and reference frames). You are reverse-engineering the craft AS IF it were a set of HJEN controls. There is no physical shoot in this fiction; never write "filmed on location with a crew".`;

const FINDING_SCHEMA = `Each finding is ONE atomic craft fact (one fact per card, never a paragraph):
{"claim_en": "specific, concrete, defensible from the frames",
 "claim_ar": "نفس الحقيقة بعربية طبيعية حيّة (لا ترجمة آلية)",
 "how_hjen_makes_it": "the concrete HJEN control that produces this exact fact — a prompt clause, a look-lock phrase, a choice-pair value, a reference-frame move, an edit decision",
 "frames": ["f012", ...]  (1-4 evidence frames, EXACT filenames from the list),
 "tags": ["2-4 short search tags"],
 "weight": 3 = a law of this ad / 2 = strong pattern / 1 = flavour}`;

// ── helpers ──────────────────────────────────────────────────────────────────
export function parseJsonLoose(text) {
  const t = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch { /* try to slice */ }
  const m = t.match(/[{[][\s\S]*[}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw new Error('model did not return valid JSON');
}
const clamp = (s) => String(s == null ? '' : s).trim();

/** evenly pick up to `cap` frames across the timeline (preserves order). */
function pickFrames(frames, cap) {
  if (frames.length <= cap) return frames;
  const step = frames.length / cap;
  return Array.from({ length: cap }, (_v, i) => frames[Math.min(frames.length - 1, Math.floor(i * step))]);
}

/** The spoken track as TIMED lines from the ASR transcript, else the flat caption. */
function renderTranscript(meta, maxChars = 6000) {
  const tr = meta.transcript;
  if (tr && Array.isArray(tr.segments) && tr.segments.length) {
    const body = tr.segments.map((s) => `[${Number(s.start).toFixed(1)}s] ${s.text}`).join('\n');
    return body.length > maxChars ? body.slice(0, maxChars) + ' …' : (body || 'none');
  }
  return meta.captions || 'none';
}
function dialogueLabel(meta) {
  const tr = meta.transcript;
  const src = tr?.source === 'asr' ? 'transcribed from audio, timed' : tr?.source === 'subs' ? 'subtitles, timed' : 'none';
  return `DIALOGUE / VO (${src}${tr?.lang ? `, ${tr.lang}` : ''})`;
}
function adHeader(meta, sent, withTimes) {
  const info = meta.sourceInfo || {};
  const list = withTimes ? sent.map((f) => `${f.id}@${f.t}s`).join(', ') : sent.map((f) => f.id).join(', ');
  return [
    `AD: ${info.title || meta.title || meta.slug}${info.uploader ? ` — ${info.uploader}` : ''}, duration ${meta.durationS ?? meta.duration ?? '?'}s, ${sent.length} frames sampled of ${meta.frames.length}.`,
    `${dialogueLabel(meta)}:\n${renderTranscript(meta)}`,
    `FRAMES (${withTimes ? 'filename@seconds, ' : ''}in timecode order): ${list}`,
  ].filter(Boolean).join('\n');
}

function visionPrompt(pass, meta, sent) {
  const jobs = pass.axes.map((slug) =>
    `\n══════════════════ AXIS: ${slug} (${axisDef(slug)?.en || slug}) ══════════════════\n${JOB_RAW[slug] || ''}`,
  ).join('\n');
  const contract = pass.axes.map((slug) =>
    `  "${slug}": {"title_en": "${axisDef(slug)?.en || slug}", "summary": "one-line thesis of THIS axis in THIS ad", "hero_frames": ["3-4 most representative frame filenames"], "reproduction_prompt": "…", "findings": [4-8 findings]}`,
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

// ── Gemini multimodal caller (server key) ────────────────────────────────────
const VISION_FALLBACK = 'gemini-2.5-flash'; // available to the server key when a gated model 404s
async function callGeminiVision(model, system, prompt, imageParts, audioPart, key, maxTokens) {
  const parts = [{ text: prompt }, ...imageParts];
  if (audioPart) parts.push(audioPart);
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: maxTokens || 32000, temperature: 0.4, responseMimeType: 'application/json' },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    // Self-heal: a gated/renamed model (404 "no longer available" / "not found")
    // falls back to a model this key can actually run — never hardcode-and-fail.
    if (res.status === 404 && model !== VISION_FALLBACK && /no longer available|not found|unsupported|does not exist/i.test(text)) {
      return callGeminiVision(VISION_FALLBACK, system, prompt, imageParts, audioPart, key, maxTokens);
    }
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
  }
  let j; try { j = JSON.parse(text); } catch { throw new Error('Gemini returned non-JSON envelope'); }
  const out = (j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!out) throw new Error('Gemini returned no text (safety/empty)');
  return out;
}

function imagePart(absPath) {
  const b64 = fs.readFileSync(absPath).toString('base64');
  return { inline_data: { mime_type: 'image/jpeg', data: b64 } };
}

/**
 * Run ONE vision pass over the ingested thumbs. Returns { slug: axisResult, … }
 * for this pass's axes only. Reads thumbs from `thumbAbs(id)`; audio from audioPath.
 */
async function runVisionPass(pass, meta, thumbAbs, audioPath, key, model) {
  const sent = pickFrames(meta.frames, pass.frameCap);
  const imageParts = [];
  for (const f of sent) {
    const abs = thumbAbs(f.id);
    try { if (abs && fs.existsSync(abs)) imageParts.push(imagePart(abs)); } catch { /* skip unreadable */ }
  }
  let audioPart = null;
  if (pass.withAudio && audioPath && fs.existsSync(audioPath)) {
    try { audioPart = { inline_data: { mime_type: 'audio/mp4', data: fs.readFileSync(audioPath).toString('base64') } }; } catch { /* no audio */ }
  }
  const system = 'You are HJEN BREAKDOWN — a world-class ad-deconstruction analyst. You return strict JSON only.';
  const out = await callGeminiVision(model, system, visionPrompt(pass, meta, sent), imageParts, audioPart, key, 32000);
  const parsed = parseJsonLoose(out);
  const res = {};
  for (const slug of pass.axes) if (parsed[slug]) res[slug] = parsed[slug];
  if (!Object.keys(res).length) throw new Error(`model returned none of: ${pass.axes.join(', ')}`);
  return res;
}

/**
 * Run the whole VISION stage. `opts.meter` (optional) = { reserve:()=>Promise<bool>,
 * refund:()=>Promise<void> } charges one make per pass (refunded if the pass fails).
 * `opts.onProgress(done,total,label)` reports as passes complete. Returns
 * { vision: {slug: result}, passes:[{id,ok,error?}] }.
 */
export async function runVisionStage(meta, { thumbAbs, audioPath, key, model = 'gemini-2.5-flash', concurrency = 3, meter = null, onProgress = null }) {
  const vision = {};
  const passReport = [];
  let done = 0;
  const queue = [...VISION_PASSES];
  const worker = async () => {
    while (queue.length) {
      const pass = queue.shift();
      let charged = false;
      try {
        if (meter) { const ok = await meter.reserve(); if (!ok) { passReport.push({ id: pass.id, ok: false, error: 'quota' }); continue; } charged = true; }
        const res = await runVisionPass(pass, meta, thumbAbs, audioPath, key, model);
        Object.assign(vision, res);
        passReport.push({ id: pass.id, ok: true, axes: Object.keys(res) });
      } catch (e) {
        if (charged && meter) { try { await meter.refund(); } catch {} }
        passReport.push({ id: pass.id, ok: false, error: String(e?.message || e).slice(0, 200) });
      } finally {
        done++;
        if (onProgress) { try { onProgress(done, VISION_PASSES.length, pass.label); } catch {} }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, VISION_PASSES.length) }, worker));
  return { vision, passes: passReport };
}

// ═══ DOCS stage (Phase 2b) — the pre-production package from the vision findings ═══
const DOCS_SYSTEM = `You are HJEN's creative director + strategist, authoring a pre-production package for a real client pitch. Voice: precise, confident, cinematic — the register of the house treatment. House vocabulary law: never use the words generate / generating / generation. Use make / made / frame / take / refine. Any Arabic must be living Saudi-register prose, never machine-Arabic, never letter-spaced. Return strict JSON only, no code fences.`;

const DBEATS = ['SETUP', 'DESIRE', 'CONFLICT', 'CHANGE', 'RESULT'];

function findAxis(vision, slug) { return vision[slug] || null; }
function findingsDigest(vision) {
  const parts = [];
  for (const slug of AXIS_SLUGS) {
    const ax = findAxis(vision, slug);
    if (!ax) continue;
    const lines = [`### ${axisDef(slug)?.en || slug}`];
    if (ax.summary) lines.push(ax.summary);
    if (ax.reproduction_prompt) lines.push(`MAKE-PROMPT: ${clamp(ax.reproduction_prompt)}`);
    for (const f of (ax.findings || []).slice(0, 8)) {
      lines.push(`- [w${f.weight == null ? 1 : f.weight}] ${clamp(f.claim_en)}${f.how_hjen_makes_it ? `  ⟶ ${clamp(f.how_hjen_makes_it)}` : ''}`);
    }
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}
function frameLine(meta) { return meta.frames.map((f) => `${f.id}@${f.t}s`).join(', '); }
function fmtTc(sec) {
  const s = Math.max(0, sec); const m = Math.floor(s / 60); const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${(Math.round(r * 10) / 10).toString().replace(/\.0$/, '')}`;
}
function realShotsBlock(meta) {
  if (!meta.shots || !meta.shots.length) return '';
  return meta.shots.map((s) =>
    `SHOT ${s.no} [${fmtTc(s.tcIn)}–${fmtTc(s.tcOut)}] frames ${(s.frameIds || []).join(', ') || '(none)'}`,
  ).join('\n');
}

async function callClaude(system, prompt, imageParts, key, maxTokens) {
  const content = [{ type: 'text', text: prompt }, ...imageParts];
  const body = { model: 'claude-sonnet-4-6', max_tokens: maxTokens || 20000, system, messages: [{ role: 'user', content }] };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Claude ${res.status}: ${text.slice(0, 200)}`);
  let j; try { j = JSON.parse(text); } catch { throw new Error('Claude returned non-JSON envelope'); }
  const out = (j?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  if (!out) throw new Error('Claude returned no text (safety/empty)');
  return out;
}
function claudeImageParts(meta, thumbAbs, n) {
  const parts = [];
  for (const f of pickFrames(meta.frames, n)) {
    try { const abs = thumbAbs(f.id); if (abs && fs.existsSync(abs)) parts.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(abs).toString('base64') } }); } catch {}
  }
  return parts;
}

async function runDocsA(vision, meta, brand, title, thumbAbs, key) {
  const prompt = `Reverse-engineer the pre-production of this finished ad AS IF HJEN were about to make it — the package we would have put in front of the client BEFORE production, to win approval. Work from the craft findings + the MAKE-PROMPTS + the VO/captions below.

AD: ${brand ? brand + ' — ' : ''}${title} · duration ${meta.durationS ?? meta.duration ?? '?'}s
${dialogueLabel(meta)}:
${renderTranscript(meta)}
FRAMES (filename@seconds): ${frameLine(meta)}

CRAFT FINDINGS (evidence, per axis):
${findingsDigest(vision)}

Author these four documents. Cite frames by their EXACT filenames (e.g. "f012") only where asked.
Return STRICT JSON:
{
 "brief": {"rawBrief": "the client brief that MUST have produced this ad — audience, business problem, what success looks like (2-4 sentences)", "proposition": "the single-minded proposition in one line", "persona": "one named human the ad speaks to — a life, not a demographic", "bigIdea": {"name": "the idea's name", "hook": "the hook line", "insight": "the human insight under it", "culturalTruth": "the cultural truth it stands on (or empty)"}},
 "wantButUntil": "the want-but-until tension in one sentence",
 "story": {"wantButUntil": "same tension, phrased for the writers' room", "emotionalQuestion": "the single emotional question the film asks", "narrative": "how we would WRITE this — 1-2 tight paragraphs of narrative prose", "beats": [ {"beat": "SETUP|DESIRE|CONFLICT|CHANGE|RESULT", "line": "this beat written as narrative", "metaphor": "the externalizing visual metaphor"} ]},
 "beats": [ {"beat": "SETUP|DESIRE|CONFLICT|CHANGE|RESULT", "visual": "what we SEE in this beat", "vo": "VO/super for this beat or empty", "frames": ["f003"]} ],
 "treatment": {"choicePairs": {"aspect": "e.g. 2.39:1", "lens": "e.g. 32mm anamorphic", "lightDirection": "e.g. hard 3/4 back", "cameraMove": "e.g. slow push", "hour": "e.g. blue hour", "placeRegister": "e.g. working rail concourse"}, "lookPhrase": "the ONE named look philosophy a DP would say", "prose": "the detailed treatment prose — 2-3 paragraphs", "firstFrame": "fNNN", "lastFrame": "fNNN"}
}`;
  return parseJsonLoose(await callClaude(DOCS_SYSTEM, prompt, claudeImageParts(meta, thumbAbs, 8), key, 20000));
}

async function runDocsB(vision, meta, brand, title, thumbAbs, key) {
  const shotsBlock = realShotsBlock(meta);
  const shotlistSpec = shotsBlock
    ? ` "shotlist": {"rows": [ {"no": 1, "beat": "SETUP|DESIRE|CONFLICT|CHANGE|RESULT", "size": "WS|MS|CU|ECU|OTS", "lens": "e.g. 32mm", "move": "e.g. slow push", "description": "the shot in one line"} ]  // EXACTLY ONE row per REAL SHOT below, SAME numbers, SAME order. Do NOT add/merge/drop/renumber, and do NOT output "tc".},`
    : ` "shotlist": {"rows": [ {"no": 1, "tc": "0:03", "beat": "SETUP", "size": "WS|MS|CU|ECU|OTS", "lens": "e.g. 32mm", "move": "e.g. slow push", "description": "the shot in one line"} ]  // number every A-shot in timecode order; tc from the frame seconds},`;
  const prompt = `Continue the pre-production package for this finished ad (read AS IF HJEN made it). Author the reference hunt, the shotlist, and the pitch-deck page plan — client-facing.

AD: ${brand ? brand + ' — ' : ''}${title} · duration ${meta.durationS ?? meta.duration ?? '?'}s
${dialogueLabel(meta)}:
${renderTranscript(meta)}
FRAMES (filename@seconds): ${frameLine(meta)}
${shotsBlock ? `\nREAL SHOTS — measured from cut detection (describe EACH by its number, one row per shot, never invent/merge/renumber):\n${shotsBlock}\n` : ''}
CRAFT FINDINGS (evidence, per axis):
${findingsDigest(vision)}

Return STRICT JSON:
{
 "referencesHunt": {"axes": ["4-7 named search axes we would hunt along"], "items": [ {"title": "a named reference (photographer/campaign/year, or a precise search string)", "take": "what to TAKE", "leave": "what to LEAVE", "frames": ["f012"]} ]},
${shotlistSpec}
 "pitchPages": [ {"title": "the page title", "content": "the page's copy / argument (1-3 sentences)", "visualSlot": "what image fills this page's frame slot"} ]
}`;
  return parseJsonLoose(await callClaude(DOCS_SYSTEM, prompt, claudeImageParts(meta, thumbAbs, 8), key, 20000));
}

// ═══ ASSEMBLE — vision + docs → the AdBreakdown JSON the UI renders (Phase 5) ═══
const beatOf = (b) => { const u = String(b || '').toUpperCase(); return DBEATS.includes(u) ? u : 'SETUP'; };

/** Build the renderable AdBreakdown from the flat vision map + merged docs.
 *  `frameUrl(id)` yields the display URL for a frame (server route, token added
 *  by the client adapter). Faithful port of run.ts assemble() for the flat shapes. */
export function assembleBreakdown(vision, docs, meta, brand, title, frameUrl) {
  const slug = meta.slug;
  const known = new Set(meta.frames.map((f) => f.id));
  const keep = (names) => (Array.isArray(names) ? names : []).map((s) => String(s || '').trim().replace(/\.jpe?g$/i, '')).filter((i) => known.has(i));
  const A = docs || {}; const B = docs || {};

  const axes = BREAKDOWN_AXES.map((def) => {
    const src = findAxis(vision, def.slug);
    const findings = ((src && src.findings) || []).map((f, n) => ({
      id: `bd-${slug}/${def.slug}/${String(n + 1).padStart(2, '0')}`,
      claim_en: clamp(f.claim_en), claim_ar: clamp(f.claim_ar) || undefined,
      howHjenMakesIt: clamp(f.how_hjen_makes_it) || undefined,
      frameIds: keep(f.frames), tags: Array.isArray(f.tags) ? f.tags : [],
      weight: [1, 2, 3].includes(f.weight) ? f.weight : undefined,
    })).filter((f) => f.claim_en);
    return { key: def.slug, title_en: def.en, title_ar: def.ar, summary: clamp(src && src.summary) || undefined, heroFrameIds: keep(src && src.hero_frames), findings, reproductionPrompt: clamp(src && src.reproduction_prompt) || undefined };
  });

  const beats = (Array.isArray(A.beats) ? A.beats : []).slice(0, 6).map((b, i) => ({
    id: `bd-${slug}/pipeline/beat/${String(i + 1).padStart(2, '0')}`, beat: beatOf(b.beat), visual: clamp(b.visual), vo: clamp(b.vo) || undefined, frameIds: keep(b.frames),
  })).filter((b) => b.visual);
  const beatByFrame = {};
  for (const b of beats) for (const i of b.frameIds) if (!beatByFrame[i]) beatByFrame[i] = b.beat;

  const story = A.story ? {
    id: `bd-${slug}/pipeline/story`, wantButUntil: clamp(A.story.wantButUntil) || clamp(A.wantButUntil), emotionalQuestion: clamp(A.story.emotionalQuestion) || undefined, narrative: clamp(A.story.narrative),
    beats: (Array.isArray(A.story.beats) ? A.story.beats : []).map((b) => ({ beat: beatOf(b.beat), line: clamp(b.line), metaphor: clamp(b.metaphor) || undefined })).filter((b) => b.line),
  } : undefined;

  const t = A.treatment || {};
  const treatment = {
    id: `bd-${slug}/pipeline/treatment`,
    choicePairs: { aspect: clamp(t.choicePairs?.aspect), lens: clamp(t.choicePairs?.lens), lightDirection: clamp(t.choicePairs?.lightDirection), cameraMove: clamp(t.choicePairs?.cameraMove), hour: clamp(t.choicePairs?.hour), placeRegister: clamp(t.choicePairs?.placeRegister) },
    lookPhrase: clamp(t.lookPhrase), prose: clamp(t.prose) || undefined, firstFrameId: keep([t.firstFrame])[0], lastFrameId: keep([t.lastFrame])[0],
  };

  const referencesHunt = B.referencesHunt ? {
    id: `bd-${slug}/pipeline/refhunt`, axes: (Array.isArray(B.referencesHunt.axes) ? B.referencesHunt.axes : []).map(clamp).filter(Boolean),
    items: (Array.isArray(B.referencesHunt.items) ? B.referencesHunt.items : []).map((r) => ({ title: clamp(r.title), take: clamp(r.take), leave: clamp(r.leave), frameIds: keep(r.frames) })).filter((r) => r.title),
  } : undefined;
  const references = ((referencesHunt && referencesHunt.items) || []).map((r, i) => ({ id: `bd-${slug}/pipeline/ref/${String(i + 1).padStart(2, '0')}`, note: [r.title, r.take && `TAKE: ${r.take}`, r.leave && `LEAVE: ${r.leave}`].filter(Boolean).join(' · '), frameIds: r.frameIds || [] }));

  const modelRows = Array.isArray(B.shotlist?.rows) ? B.shotlist.rows : [];
  let shotlist;
  if (meta.shots && meta.shots.length) {
    const byNo = new Map(); for (const r of modelRows) if (Number.isFinite(r?.no)) byNo.set(Number(r.no), r);
    shotlist = { id: `bd-${slug}/pipeline/shotlist`, rows: meta.shots.map((s) => { const r = byNo.get(s.no) || {}; return { no: s.no, tc: fmtTc(s.tcIn), beat: clamp(r.beat) || undefined, size: clamp(r.size) || undefined, lens: clamp(r.lens) || undefined, move: clamp(r.move) || undefined, description: clamp(r.description) || `Shot ${s.no}` }; }) };
  } else if (B.shotlist) {
    shotlist = { id: `bd-${slug}/pipeline/shotlist`, rows: modelRows.map((r, i) => ({ no: Number.isFinite(r.no) ? r.no : i + 1, tc: clamp(r.tc) || undefined, beat: clamp(r.beat) || undefined, size: clamp(r.size) || undefined, lens: clamp(r.lens) || undefined, move: clamp(r.move) || undefined, description: clamp(r.description) })).filter((r) => r.description) };
  }

  const pitchPages = (Array.isArray(B.pitchPages) ? B.pitchPages : []).map((p, i) => ({ id: `bd-${slug}/pipeline/pitchpage/${String(i + 1).padStart(2, '0')}`, title: clamp(p.title), content: clamp(p.content), visualSlot: clamp(p.visualSlot) })).filter((p) => p.title || p.content);

  const brief = A.brief ? {
    id: `bd-${slug}/pipeline/brief`, rawBrief: clamp(A.brief.rawBrief), proposition: clamp(A.brief.proposition), persona: clamp(A.brief.persona),
    bigIdea: { name: clamp(A.brief.bigIdea?.name), hook: clamp(A.brief.bigIdea?.hook), insight: clamp(A.brief.bigIdea?.insight), culturalTruth: clamp(A.brief.bigIdea?.culturalTruth) || undefined },
  } : { id: `bd-${slug}/pipeline/brief`, rawBrief: '', proposition: '', persona: '', bigIdea: { name: '', hook: '', insight: '' } };

  // frames — carry the display URL (web) so the renderer draws them directly.
  const frames = meta.frames.map((f) => ({ id: f.id, file: frameUrl ? frameUrl(f.id) : `frames/${f.id}.jpg`, t: f.t, ...(beatByFrame[f.id] ? { beat: beatByFrame[f.id] } : {}) }));

  return {
    version: 1, id: `bd-${slug}`, slug,
    ad: { title: title || meta.title || slug, brand: brand || '', durationS: meta.durationS ?? meta.duration ?? undefined, logline_en: clamp(A.brief?.proposition) || undefined, premise: 'made-by-hjen' },
    frames, axes,
    pipeline: { brief, beats, wantButUntil: clamp(A.wantButUntil) || undefined, references, referencesHunt, treatment, pitch: [], pitchPages, story, shotlist },
    approved: false, createdAt: new Date().toISOString(), model: 'hjen-breakdown-run', generatedByRun: true,
  };
}

/** Run the DOCS stage (2 Claude calls). meter charges one make per doc call. */
export async function runDocsStage(vision, meta, { brand = '', title = '', thumbAbs, key, meter = null, onProgress = null }) {
  const out = {}; const report = [];
  const steps = [
    { id: 'docsA', fn: () => runDocsA(vision, meta, brand, title, thumbAbs, key) },
    { id: 'docsB', fn: () => runDocsB(vision, meta, brand, title, thumbAbs, key) },
  ];
  let done = 0;
  for (const step of steps) {
    let charged = false;
    try {
      if (meter) { const ok = await meter.reserve(); if (!ok) { report.push({ id: step.id, ok: false, error: 'quota' }); continue; } charged = true; }
      Object.assign(out, await step.fn());
      report.push({ id: step.id, ok: true });
    } catch (e) {
      if (charged && meter) { try { await meter.refund(); } catch {} }
      report.push({ id: step.id, ok: false, error: String(e?.message || e).slice(0, 200) });
    } finally {
      done++;
      if (onProgress) { try { onProgress(done, steps.length, step.id); } catch {} }
    }
  }
  return { docs: out, docsReport: report };
}
