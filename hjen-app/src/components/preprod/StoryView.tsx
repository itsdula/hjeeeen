// Story — نص القصة. Standalone stage-5 tool: idea-gate → 5 beats → timed AV
// blocks → hand the compiled script to the Storyboard (which parses it into
// panels). Encodes the Council §٦ two-brains doctrine: the ENGINEER machines
// (gate / compass / word budget) run in English internally and never surface;
// the NOVELIST writes the Arabic that ships — long–short–long rhythm, one
// thought per sentence, one named cultural-truth detail, weight word last.
//
// House laws: MADE not Generate (Check / Draft / Seed / Compile / Send).
// English mono-labels, Arabic serif content. Colour lives on --pp-accent.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/preprod-story.css';
import { useStore } from '../../store';
import { useStoryboard } from '../../store/storyboardStore';
import { loadPovBlock, getPOV, type CreativePOV } from '../../lib/creative360';
import {
  PreprodShell, useStageData, ppClaude, voWordCount, Field, Busy, useToast,
} from './shared';
import { ArText } from './ArText';
import type { ScreenplayData, StoryBeat, AvBlock, BeatName, StorySourceContract } from '../../types/preprod';
import { runWritingGraph } from '../../lib/creativegraph/writingGraph';
import { compileStorySource, sourceFingerprint } from '../../lib/story/sourceContract';
import { syncStagesToCreativeGraph } from '../../lib/creativegraph/stageSync';

// ─── constants ──────────────────────────────────────────────────────────────

const ACCENT = '#D1B310';

const BEAT_ORDER: BeatName[] = ['SETUP', 'DESIRE', 'CONFLICT', 'CHANGE', 'RESULT'];
/** Arabic beat names — DELIVERABLE CONTENT ONLY: used as the compiled-script
 *  scene-tag fallback that the storyboard breakdown parses. Never shown as UI. */
const BEAT_AR: Record<BeatName, string> = {
  SETUP: 'التأسيس', DESIRE: 'الرغبة', CONFLICT: 'الصراع', CHANGE: 'التحوّل', RESULT: 'النتيجة',
};
const BEAT_RULE: Record<BeatName, string> = {
  SETUP: 'World + person, one line — no backstory dump.',
  DESIRE: 'Names a WANT — a person wanting something, out loud.',
  CONFLICT: 'Holds the tension — internal, external, or anticipation.',
  CHANGE: 'An ACTION, not a wish — something done, seen on camera.',
  RESULT: 'What the viewer carries out — lands the emotional question.',
};

/** Dialect VALUES stay Arabic — they are content, passed verbatim into the
 *  compiled script + LLM prompts. Only the chip/field LABELS are English. */
const DIALECTS = ['نجدية بيتية', 'حجازية', 'فصحى بيضاء'] as const;
const DIALECT_LABEL: Record<string, string> = {
  'نجدية بيتية': 'Najdi (home)', 'حجازية': 'Hijazi', 'فصحى بيضاء': 'White Fusha',
};
const DURATIONS = [15, 30, 60] as const;
type Duration = (typeof DURATIONS)[number];
const MAX_WORDS: Record<Duration, number> = { 15: 33, 30: 65, 60: 130 };

/** Mood words that fail the VISUAL channel — VISUAL takes camera-able sentences. */
const MOOD_RE = /\b(dreamy|magical|cinematic|atmospheric|moody|ethereal)\b|سحري|حالم|ساحر|أجواء|سينمائي/i;
const CTA_RE = /CTA|LOGO|لوقو|لوجو|شعار/i;

const EMPTY: ScreenplayData = {
  gate: { want: '', tension: '', change: '', passed: false },
  compass: '',
  emotionalQuestion: '',
  beats: BEAT_ORDER.map(b => ({ beat: b, line: '', visualMetaphor: '' })),
  blocks: [],
  budget: { durationSec: 30, voWords: 0, maxWords: 65 },
  dialect: 'نجدية بيتية',
  scriptText: '',
};

// ─── LLM systems — Council §٦ two-brains doctrine, encoded ─────────────────

/** The banned generic-Arabic list — zero tolerance in any surfaced line. */
const BANNED_AR = [
  'اكتشف الآن', 'انضم إلينا في رحلة', 'في عالم اليوم', 'تجربة لا تُنسى',
  'لا مثيل له', 'رحلة استثنائية', 'شركتنا رائدة', 'نفخر بأن', 'بين يديك الآن',
  'عالم من', 'دعنا نأخذك',
];

/** The novelist brain — every Arabic word that surfaces obeys this. */
const NOVELIST = `THE NOVELIST BRAIN — every Arabic sentence that surfaces obeys the Saudi-novelist register (ساق البامبو، موت صغير):
- Rhythm: long–short–long. A four-word sentence after a long one is intentional.
- One thought per sentence. One named cultural-truth detail per piece (a real noun — "دلة أمي المخدوشة", never "تراثنا").
- End on the weight word — the heaviest word closes the sentence.
- The product appears as PART OF THE STORY, never as a sales pitch (Google Reunion model).
- Story-opening beats descriptor-opening: "حين أسّس أبي المحل سنة ١٩٧٦…" wins; "شركتنا رائدة في…" is forbidden.
- BANNED phrases (any one of these fails the line): ${BANNED_AR.join(' · ')}.`;

/** The engineer brain — internal machines, English, never surfaces in Arabic copy. */
const ENGINEER = `THE ENGINEER BRAIN — internal machines, run in English, NEVER shown in the delivered Arabic:
- Idea gate: want? tension (internal / external / anticipation)? change? No tension AND no change = a topic, not a story — REJECT and dig with "what was really worth remembering?".
- Compass: one want–but–until sentence above everything; every later decision is measured against it.
- Critique rule: if the UNTIL restates the WANT, the change is too weak — probe "what actually shifted?".
- One emotional question under the whole piece; every block is another angle on it.
- Hard second-budget: 15s ≤33 VO words · 30s ≤65 · 60s ≤130 (spoken-fusha rate, verified by reading aloud). HOOK 0–3s, STORY middle, CTA+LOGO reserved at the end — no new VO in the last ~3 seconds so the logo breathes.`;

const GATE_SYSTEM = `You are the ENGINEER brain of a Saudi commercial screenwriter — the idea gate.
${ENGINEER}

Judge the submitted idea (want / tension / change + any source context). You CAN and SHOULD reject: if there is no real tension AND no real change, it is a topic, not a story.
If want/tension/change are blank but a sourceContract is supplied, derive them from the signed Big Idea, proposition, persona and insight before judging. Do not invent a second idea. Also derive one want–but–until compass and one emotionalQuestion when the source supports them.
Return STRICT JSON only:
{"passed": boolean, "reason": "one Arabic sentence in the novelist register explaining the verdict", "digQuestion": "Arabic — the digging question if rejected", "want":"the concrete want", "tension":"the human cost/pressure", "change":"the visible action/change", "compass":"one English want–but–until sentence", "emotionalQuestion":"one concise Arabic question"}
${NOVELIST}
Only reason, digQuestion and emotionalQuestion surface in Arabic — keep the machinery invisible.`;

const COMPASS_SYSTEM = `You are the ENGINEER brain of a Saudi commercial screenwriter — the compass critic.
${ENGINEER}

You receive a want–but–until compass sentence (English, an INTERNAL engine artifact — it never surfaces in Arabic copy). Apply the critique rule: if the UNTIL merely restates the WANT, the change is too weak.
Return STRICT JSON only:
{"weakChange": boolean, "note": "one short English note — internal, engineer voice: what actually shifted, or why the compass holds"}`;

const BEATS_SYSTEM = `You are a Saudi commercial screenwriter with two separated brains.
${ENGINEER}
${NOVELIST}

Draft the 5-beat spine (SETUP / DESIRE / CONFLICT / CHANGE / RESULT) from the gate answers, the compass, the emotional question and any treatment context. Per-beat law:
- DESIRE names a want. CONFLICT holds the tension. CHANGE is an action, not a wish.
- Every beat carries a visualMetaphor that EXTERNALIZES the internal — الشعور يُرى — a camera-able image, never event-listing ("يستلقي على لوح التزلج وسط الشارع" not "يشعر بالضياع").
- "line" is Arabic in the novelist register. "visualMetaphor" is Arabic, concrete, filmable.
Return STRICT JSON only:
{"beats":[{"beat":"SETUP","line":"…","visualMetaphor":"…"}, … exactly 5, in order SETUP,DESIRE,CONFLICT,CHANGE,RESULT]}`;

const BLOCKS_SYSTEM = `You are a Saudi commercial screenwriter with two separated brains.
${ENGINEER}
${NOVELIST}

Turn the 5 beats into timed AV blocks for the given duration and dialect. This is a MACHINE-HANDOFF document — the storyboard breakdown parses it with zero guessing. Laws:
- Exactly 5 blocks, one per beat, contiguous timecodes covering the full duration. tcIn/tcOut are integers (seconds).
- The FINAL block is the reserved CTA/LOGO block — logo hold, super text, and NO new VO in the last ~3 seconds (for 30s: nothing new after ~27s). Name CTA/LOGO explicitly in its superSfx.
- "visual": camera-able Arabic sentences — verbs, objects, distances. Mood words (dreamy, سحري, cinematic, أجواء) FAIL the channel.
- "vo": the declared dialect, novelist register, total VO across ALL blocks ≤ the word budget. Over budget = loud failure, so write UNDER it. Stage directions in parentheses don't count.
- "superSfx": the SUPER (RTL Arabic, written knowing it stands over the frame) + the real sound of the moment.
- "transition": WRITTEN, never implied — "hard cut على صمت الفوران" not "".
Return STRICT JSON only:
{"blocks":[{"scene":1,"tcIn":0,"tcOut":3,"visual":"…","vo":"…","superSfx":"…","transition":"…"}, … exactly 5]}`;

// ─── pure helpers ───────────────────────────────────────────────────────────

function normBeats(raw: StoryBeat[] | undefined): StoryBeat[] {
  return BEAT_ORDER.map((name, i) => {
    const found = raw?.find(b => b?.beat === name) ?? raw?.[i];
    return { beat: name, line: String(found?.line ?? ''), visualMetaphor: String(found?.visualMetaphor ?? '') };
  });
}

function seedTimecodes(durationSec: Duration): Array<[number, number]> {
  if (durationSec === 15) return [[0, 2], [2, 5], [5, 8], [8, 12], [12, 15]];
  if (durationSec === 60) return [[0, 5], [5, 18], [18, 31], [31, 48], [48, 60]];
  return [[0, 3], [3, 10], [10, 17], [17, 24], [24, 30]];
}

function totalVo(blocks: AvBlock[]): number {
  return blocks.reduce((n, b) => n + voWordCount(b.vo), 0);
}

/** First clause of the visual — the scene header's location tag. */
function locationTag(visual: string): string {
  const clause = (visual || '').split(/[،.؛—\n]/)[0].trim();
  return clause.length > 42 ? `${clause.slice(0, 42).trim()}…` : clause;
}

/** Compile the exact hand-off text the storyboard breakdown parses. Pure. */
export function compileScriptText(
  blocks: AvBlock[], dialect: string, durationSec: number, projectName: string,
): string {
  const head = `إعلان ${projectName} · ${durationSec} ثانية · ${dialect}`;
  const body = blocks.map((b, i) => {
    const last = i === blocks.length - 1;
    const tag = last ? 'CTA/LOGO' : (locationTag(b.visual) || BEAT_AR[BEAT_ORDER[i] ?? 'SETUP']);
    const lines = [`مشهد ${b.scene} · [${b.tcIn}–${b.tcOut} ثوانٍ] · ${tag}`];
    if (b.visual.trim()) lines.push(`VISUAL: ${b.visual.trim()}`);
    if (b.vo.trim()) lines.push(`VO (${dialect}): ${b.vo.trim()}`);
    if (b.superSfx.trim()) lines.push(`AUDIO: ${b.superSfx.trim()}`);
    if (b.transition.trim()) lines.push(`الانتقال: ${b.transition.trim()}`);
    return lines.join('\n');
  });
  return [head, ...body].join('\n\n');
}

function coerceBlock(raw: Partial<AvBlock> | undefined, i: number, tc: [number, number]): AvBlock {
  return {
    scene: Number.isFinite(Number(raw?.scene)) ? Number(raw?.scene) : i + 1,
    tcIn: Number.isFinite(Number(raw?.tcIn)) ? Number(raw?.tcIn) : tc[0],
    tcOut: Number.isFinite(Number(raw?.tcOut)) ? Number(raw?.tcOut) : tc[1],
    visual: String(raw?.visual ?? ''),
    vo: String(raw?.vo ?? ''),
    superSfx: String(raw?.superSfx ?? ''),
    transition: String(raw?.transition ?? ''),
  };
}

// ─── the view ───────────────────────────────────────────────────────────────

type StepN = 1 | 2 | 3 | 4;
type GateVerdict = {
  passed: boolean; reason: string; digQuestion?: string;
  want?: string; tension?: string; change?: string; compass?: string; emotionalQuestion?: string;
};
type CompassVerdict = { weakChange: boolean; note: string };

const STEPS: Array<{ n: StepN; name: string; sub: string }> = [
  { n: 1, name: 'GATE', sub: 'Idea gate' },
  { n: 2, name: 'BEATS', sub: 'The five beats' },
  { n: 3, name: 'BLOCKS', sub: 'Budget & AV blocks' },
  { n: 4, name: 'HANDOFF', sub: 'Send to Storyboard' },
];

/** UI fallback only — if the LLM returns its own Arabic digQuestion, that
 *  content renders as returned. */
const DIG_FALLBACK = 'What was actually worth remembering?';

export function StoryView() {
  const projectId = useStore(s => s.activeProjectId);
  const projects = useStore(s => s.projects);
  const addLedger = useStore(s => s.addLedgerEntry);
  const projectName = projects.find(p => p.id === projectId)?.name ?? 'HJEN';

  const { data, loaded, update, saveNow } = useStageData<ScreenplayData>(5, EMPTY);
  const [step, setStep] = useState<StepN>(1);
  const [toast, showToast] = useToast();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'gate' | 'compass' | 'beats' | 'blocks' | 'send'>(null);

  // Story-specific note; the signed upstream contract remains the source of truth.
  const [freeIdea, setFreeIdea] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);

  // Creative 360 — the novelist brain obeys the same project POV (esp. FORBIDDEN).
  // povBlockRef = composed suffix (offline); povRef = raw POV object sent as vars
  // so the SERVER composes the recipe in gateway mode (engineer/novelist doctrine
  // never ships to the client).
  const povBlockRef = useRef('');
  const povRef = useRef<CreativePOV | null>(null);
  useEffect(() => {
    if (!projectId) { povBlockRef.current = ''; povRef.current = null; return; }
    let live = true;
    loadPovBlock(projectId).then(b => { if (live) povBlockRef.current = b; }).catch(() => undefined);
    getPOV(projectId).then(p => { if (live) povRef.current = p; }).catch(() => undefined);
    return () => { live = false; };
  }, [projectId]);
  const sys = (base: string) => base + povBlockRef.current;

  // Engine verdicts — internal artifacts, not persisted (only gate.passed is).
  const [gateVerdict, setGateVerdict] = useState<GateVerdict | null>(null);
  const [compassVerdict, setCompassVerdict] = useState<CompassVerdict | null>(null);

  const gate = data.gate ?? EMPTY.gate!;
  const beats = useMemo(() => normBeats(data.beats), [data.beats]);
  const blocks = data.blocks ?? [];
  const dur = (data.budget?.durationSec ?? 30) as Duration;
  const maxWords = MAX_WORDS[dur] ?? 65;
  const dialect = data.dialect ?? DIALECTS[0];
  const voWords = totalVo(blocks);
  const over = voWords > maxWords;
  const voCutoff = dur - 3; // no new VO in the last ~3s (≈27s for the 30s case)

  const script = useMemo(
    () => compileScriptText(blocks, dialect, dur, projectName),
    [blocks, dialect, dur, projectName],
  );

  // Keep the compiled script persisted as stage-5 scriptText once blocks exist,
  // so saveNow() before sign / handoff always flushes the real hand-off text.
  useEffect(() => {
    if (!loaded || blocks.length === 0) return;
    if (script !== data.scriptText) update({ scriptText: script });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script, loaded]);

  // ── data writers ──────────────────────────────────────────────────────────

  const setGate = (patch: Partial<NonNullable<ScreenplayData['gate']>>) => {
    setGateVerdict(null);
    update({ gate: { ...gate, ...patch, passed: false } });
  };
  const setBeat = (i: number, patch: Partial<StoryBeat>) => {
    update({ beats: beats.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  };
  const writeBlocks = (next: AvBlock[], nextDur: Duration = dur) => {
    update({
      blocks: next,
      budget: { durationSec: nextDur, voWords: totalVo(next), maxWords: MAX_WORDS[nextDur] },
    });
  };
  const setBlock = (i: number, patch: Partial<AvBlock>) => {
    writeBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  };
  const setDuration = (d: Duration) => writeBlocks(blocks, d);

  const seedRows = () => {
    const tcs = seedTimecodes(dur);
    writeBlocks(BEAT_ORDER.map((_, i) => coerceBlock(undefined, i, tcs[i])));
  };

  // ── LLM machines ──────────────────────────────────────────────────────────

  const syncSource = useCallback(async (announce = true) => {
    if (!projectId) return;
    setSourceLoading(true); setErr(null);
    try {
      const [brief, treatment] = await Promise.all([
        window.hjen.readStageData({ id: projectId, stage: 1 }),
        window.hjen.readStageData({ id: projectId, stage: 4 }),
      ]);
      const source = compileStorySource(projectId, brief, treatment);
      const fingerprint = sourceFingerprint(source);
      update({ source, sourceFingerprint: fingerprint, sourceSyncedAt: new Date().toISOString() });
      await syncStagesToCreativeGraph(projectId);
      if (announce) showToast(source.missing.length
        ? `Source synced — ${source.missing.length} upstream decisions still missing.`
        : 'Brief Mind + Treatment synced into Story.');
    } catch {
      setErr('Could not sync Brief Mind and Treatment into Story.');
    } finally {
      setSourceLoading(false);
    }
  }, [projectId, update, showToast]);

  // Story opens on the current upstream contract. A focus sync catches a user
  // returning from Brief Mind/Treatment without requiring a mystery pull button.
  const syncedProject = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || !projectId || syncedProject.current === projectId) return;
    syncedProject.current = projectId;
    void syncSource(false);
  }, [loaded, projectId, syncSource]);
  useEffect(() => {
    const onFocus = () => { if (loaded && projectId) void syncSource(false); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loaded, projectId, syncSource]);

  const checkGate = async () => {
    setErr(null); setBusy('gate');
    const res = await ppClaude<GateVerdict>({
      system: sys(GATE_SYSTEM), promptId: 'story.gate', vars: { pov: povRef.current },
      maxTokens: 1200,
      prompt: JSON.stringify({
        want: gate.want ?? '', tension: gate.tension ?? '', change: gate.change ?? '',
        freeIdea, sourceContract: data.source, project: projectName,
      }),
    });
    setBusy(null);
    if (!res.ok) { setErr(res.message); return; }
    const v: GateVerdict = {
      passed: !!res.json.passed,
      reason: String(res.json.reason ?? ''),
      digQuestion: res.json.digQuestion ? String(res.json.digQuestion) : DIG_FALLBACK,
      want: String(res.json.want ?? '').trim() || undefined,
      tension: String(res.json.tension ?? '').trim() || undefined,
      change: String(res.json.change ?? '').trim() || undefined,
      compass: String(res.json.compass ?? '').trim() || undefined,
      emotionalQuestion: String(res.json.emotionalQuestion ?? '').trim() || undefined,
    };
    setGateVerdict(v);
    update({
      gate: {
        ...gate,
        want: v.want || gate.want, tension: v.tension || gate.tension,
        change: v.change || gate.change, passed: v.passed,
      },
      compass: v.compass || data.compass,
      emotionalQuestion: v.emotionalQuestion || data.emotionalQuestion,
    });
  };

  const checkCompass = async () => {
    setErr(null); setBusy('compass');
    const res = await ppClaude<CompassVerdict>({
      system: sys(COMPASS_SYSTEM), promptId: 'story.compass', vars: { pov: povRef.current },
      maxTokens: 800,
      prompt: JSON.stringify({ compass: data.compass ?? '', gate: { want: gate.want, tension: gate.tension, change: gate.change } }),
    });
    setBusy(null);
    if (!res.ok) { setErr(res.message); return; }
    setCompassVerdict({ weakChange: !!res.json.weakChange, note: String(res.json.note ?? '') });
  };

  const draftBeats = async () => {
    setErr(null); setBusy('beats');
    const payload = {
        gate: { want: gate.want, tension: gate.tension, change: gate.change },
        compass: data.compass ?? '', emotionalQuestion: data.emotionalQuestion ?? '',
        freeIdea, sourceContract: data.source, project: projectName, dialect,
    };
    const res = await runWritingGraph<StoryBeat[]>({
      system: sys(BEATS_SYSTEM), promptId: 'story.beats', vars: { pov: povRef.current }, payload,
      rubric: 'Exactly five causal beats. DESIRE names a want; CONFLICT makes that want costly; CHANGE is a visible action that cannot be swapped with RESULT; every visual metaphor is camera-provable; Arabic carries one thought per sentence and ends on the weight word.',
      readDraft: json => Array.isArray(json?.beats) ? json.beats : null,
    });
    setBusy(null);
    if (!res.ok) { setErr(res.message); return; }
    update({ beats: normBeats(res.value), beatsSourceFingerprint: data.sourceFingerprint });
    showToast('Beats drafted — read them aloud before moving on.');
  };

  const draftBlocks = async () => {
    setErr(null); setBusy('blocks');
    const payload = {
        beats, dialect, durationSec: dur, maxVoWords: maxWords,
        emotionalQuestion: data.emotionalQuestion ?? '', compass: data.compass ?? '',
        project: projectName, sourceContract: data.source,
    };
    const res = await runWritingGraph<AvBlock[]>({
      system: sys(BLOCKS_SYSTEM), promptId: 'story.blocks', vars: { pov: povRef.current }, payload,
      rubric: `Exactly five contiguous AV blocks covering ${dur}s. Total VO <= ${maxWords} words. No new VO in the final three seconds. Every visual uses observable action, object, distance, or sound; transitions are explicit; final block reserves CTA/LOGO; the product changes the action rather than entering as pack-shot decoration.`,
      readDraft: json => Array.isArray(json?.blocks) && json.blocks.length ? json.blocks : null,
    });
    setBusy(null);
    if (!res.ok) { setErr(res.message); return; }
    const tcs = seedTimecodes(dur);
    writeBlocks(res.value.slice(0, 5).map((b, i) => coerceBlock(b, i, tcs[Math.min(i, tcs.length - 1)])));
    update({ blocksSourceFingerprint: data.sourceFingerprint });
    showToast('Blocks drafted — check the meter, then read the VO aloud.');
  };

  // ── handoff ───────────────────────────────────────────────────────────────

  const gatePassed = !!gate.passed;
  const lastBlock = blocks[blocks.length - 1];
  const hasCtaBlock = !!lastBlock && CTA_RE.test(`${lastBlock.superSfx} ${lastBlock.visual} ${lastBlock.transition}`);
  const sourceMissing = !data.source || !data.source.brief.bigIdea || !data.source.brief.proposition;
  const beatsHaveContent = beats.some(b => b.line.trim() || b.visualMetaphor.trim());
  const beatsStale = beatsHaveContent && !!data.sourceFingerprint && data.beatsSourceFingerprint !== data.sourceFingerprint;
  const blocksStale = blocks.length > 0 && !!data.sourceFingerprint && data.blocksSourceFingerprint !== data.sourceFingerprint;
  const sendBlockReason = sourceMissing
    ? 'Story has no signed Brief Mind source — return to SOURCE and sync upstream.'
    : beatsStale || blocksStale ? 'Upstream changed — re-draft the stale Beats and Blocks before handoff.'
    : !gatePassed
    ? 'The idea gate has not passed — go back to GATE and check it.'
    : over ? `VO is over budget — ${voWords}/${maxWords} words. Cut before sending.`
    : blocks.length === 0 ? 'No blocks yet — draft or seed them in BLOCKS.'
    : null;

  const sendToStoryboard = async () => {
    if (!projectId || sendBlockReason) return;
    setErr(null); setBusy('send');
    try {
      update({ scriptText: script });
      await saveNow();                                    // stage 5 — data only, no markdown companion
      await useStoryboard.getState().open(projectId);     // load the project's board
      useStoryboard.getState().patch({ scriptText: script }); // set the board's script
      void addLedger({ kind: 'note', body: `Story: script handed to the Storyboard (${dur}s · ${DIALECT_LABEL[dialect] ?? dialect} · ${voWords} VO words).` });
      showToast('Script sent — the Storyboard has it.');
      useStore.getState().setActiveView('storyboard');
    } finally {
      setBusy(null);
    }
  };

  // ── sign warnings ─────────────────────────────────────────────────────────

  const signWarnings: Array<{ body: string; onJump?: () => void }> = [];
  if (sourceMissing) signWarnings.push({ body: 'Story is not attached to a signed Brief Mind idea.', onJump: () => setStep(1) });
  if (data.source?.missing.length) signWarnings.push({ body: `Source contract is incomplete: ${data.source.missing.join(', ')}.`, onJump: () => setStep(1) });
  if (beatsStale) signWarnings.push({ body: 'Beats were written from an older Brief Mind/Treatment source.', onJump: () => setStep(2) });
  if (blocksStale) signWarnings.push({ body: 'AV blocks were written from an older Brief Mind/Treatment source.', onJump: () => setStep(3) });
  if (!gatePassed) signWarnings.push({ body: 'Idea gate has not passed — a topic is not a story.', onJump: () => setStep(1) });
  if (!(data.compass ?? '').trim()) signWarnings.push({ body: 'Compass is empty — no want–but–until sentence to measure against.', onJump: () => setStep(1) });
  if (beats.some(b => !b.visualMetaphor.trim())) signWarnings.push({ body: 'A beat has no visual metaphor — the feeling must be SEEN.', onJump: () => setStep(2) });
  if (over) signWarnings.push({ body: `VO over budget: ${voWords}/${maxWords} words.`, onJump: () => setStep(3) });
  if (!hasCtaBlock) signWarnings.push({ body: 'No CTA/LOGO block reserved at the end — the logo needs room to breathe.', onJump: () => setStep(3) });
  if (blocks.length === 0 || blocks.some(b => !b.transition.trim())) signWarnings.push({ body: 'A block has an empty transition — transitions are written, never implied.', onJump: () => setStep(3) });

  // ── render ────────────────────────────────────────────────────────────────

  const stepDone: Record<StepN, boolean> = {
    1: gatePassed && !!(data.compass ?? '').trim(),
    2: beats.every(b => b.line.trim() && b.visualMetaphor.trim()),
    3: blocks.length > 0 && !over,
    4: !!data.scriptText?.trim(),
  };

  return (
    <PreprodShell tool="Story" sub="Idea-gate → 5 beats → timed AV script" accent={ACCENT} stage={5}
      signWarnings={signWarnings} beforeSign={async () => { await saveNow(); if (projectId) await syncStagesToCreativeGraph(projectId); }}>
      <div className="pp-grid">
        <aside className="pp-aside">
          <div className="pp-steps">
            {STEPS.map(s => (
              <button key={s.n}
                className={`pp-step${step === s.n ? ' is-current' : ''}${stepDone[s.n] && step !== s.n ? ' is-done' : ''}`}
                onClick={() => setStep(s.n)}>
                <span className="pp-step__n">{s.n}</span>
                <span>
                  <span className="pp-step__name">{s.name}</span>
                  <span className="pp-step__sub">{s.sub}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="pps-side">
            <div className="mono-label pps-side__label">VO budget · {dur}s</div>
            <div className="pp-meter">
              <div className="pp-meter__track">
                <div className={`pp-meter__fill${over ? ' is-over' : ''}`}
                  style={{ width: `${Math.min(100, (voWords / maxWords) * 100)}%` }} />
              </div>
              <div className="pp-meter__label"><span>{voWords} words</span><span>max {maxWords}</span></div>
            </div>
            {(data.compass ?? '').trim() && (
              <div className="pps-side__compass">
                <div className="mono-label pps-side__label">COMPASS · INTERNAL</div>
                <p>{data.compass}</p>
                <ArText text={data.compass} />
              </div>
            )}
          </div>
        </aside>

        <main className="pp-main">
          {!loaded ? <Busy label="Reading stage 05…" /> : (
            <>
              {err && <div className="pp-error">{err}</div>}
              {(beatsStale || blocksStale) && (
                <div className="pp-error">Upstream changed after this draft. Re-draft {beatsStale ? 'Beats' : 'Blocks'} before signing or handoff.</div>
              )}
              {step === 1 && (
                <StepGate
                  gate={gate} setGate={setGate}
                  compass={data.compass ?? ''} setCompass={v => { setCompassVerdict(null); update({ compass: v }); }}
                  emotionalQuestion={data.emotionalQuestion ?? ''} setEq={v => update({ emotionalQuestion: v })}
                  freeIdea={freeIdea} setFreeIdea={setFreeIdea}
                  source={data.source} sourceFingerprint={data.sourceFingerprint}
                  sourceLoading={sourceLoading} syncSource={syncSource}
                  gateVerdict={gateVerdict} compassVerdict={compassVerdict}
                  checkGate={checkGate} checkCompass={checkCompass} busy={busy}
                />
              )}
              {step === 2 && (
                <StepBeats beats={beats} setBeat={setBeat} draftBeats={draftBeats} busy={busy} />
              )}
              {step === 3 && (
                <StepBlocks
                  blocks={blocks} setBlock={setBlock} seedRows={seedRows} draftBlocks={draftBlocks}
                  dur={dur} setDuration={setDuration} dialect={dialect}
                  setDialect={d => update({ dialect: d })}
                  voWords={voWords} maxWords={maxWords} over={over} voCutoff={voCutoff} busy={busy}
                />
              )}
              {step === 4 && (
                <StepHandoff
                  script={script} blocksCount={blocks.length}
                  sendBlockReason={sendBlockReason} send={sendToStoryboard} busy={busy}
                />
              )}
            </>
          )}
        </main>
      </div>
      {toast && <div className="pp-toast">{toast}</div>}
    </PreprodShell>
  );
}

// ─── Step 1 — GATE · بوابة الفكرة ──────────────────────────────────────────

function StepGate(props: {
  gate: NonNullable<ScreenplayData['gate']>;
  setGate: (p: Partial<NonNullable<ScreenplayData['gate']>>) => void;
  compass: string; setCompass: (v: string) => void;
  emotionalQuestion: string; setEq: (v: string) => void;
  freeIdea: string; setFreeIdea: (v: string) => void;
  source?: StorySourceContract; sourceFingerprint?: string;
  sourceLoading: boolean; syncSource: (announce?: boolean) => Promise<void>;
  gateVerdict: GateVerdict | null; compassVerdict: CompassVerdict | null;
  checkGate: () => Promise<void>; checkCompass: () => Promise<void>;
  busy: string | null;
}) {
  const { gate, setGate } = props;
  return (
    <>
      <div className="pp-panel">
        <div className="pp-panel__head">
          <span className="pp-panel__title mono-label">SOURCE CONTRACT</span>
          <span className="pps-sub">Brief Mind → Treatment → Story</span>
          <span className="pp-panel__spacer" />
          <button className="pp-btn pp-btn--ghost" disabled={props.sourceLoading}
            onClick={() => void props.syncSource(true)}>{props.sourceLoading ? 'Syncing…' : 'Sync upstream'}</button>
        </div>
        {props.source ? (
          <div className="pps-source">
            <div className={`pps-source__status${props.source.missing.length ? ' is-thin' : ' is-ready'}`}>
              <span className="mono-label">{props.source.missing.length ? 'INCOMPLETE CONTRACT' : 'SOURCE CURRENT'}</span>
              <span className="pps-source__fingerprint">{props.sourceFingerprint}</span>
            </div>
            <div className="pps-source__grid">
              <SourceRow label="BIG IDEA" value={props.source.brief.bigIdea} />
              <SourceRow label="PROPOSITION" value={props.source.brief.proposition} />
              <SourceRow label="PERSONA" value={props.source.brief.persona} />
              <SourceRow label="INSIGHT" value={props.source.brief.insight} />
              <SourceRow label="CULTURAL TRUTH" value={props.source.brief.culturalTruth} />
              <SourceRow label="TREATMENT" value={props.source.treatment.approach} />
            </div>
            {props.source.missing.length > 0 && (
              <div className="pps-source__missing"><span className="mono-label">MISSING UPSTREAM</span>{props.source.missing.join(' · ')}</div>
            )}
          </div>
        ) : (
          <p className="pps-treat__empty">No upstream contract yet. Finish Brief Mind, then sync.</p>
        )}
        <Field label="DIRECTOR NOTE · OPTIONAL" hint="A local story note — it adds to the signed source; it does not replace it">
          <textarea className="pp-textarea pp-textarea--ar" value={props.freeIdea}
            onChange={e => props.setFreeIdea(e.target.value)} placeholder="A story-specific note, if the source needs one…" />
        </Field>
      </div>

      <div className="pp-panel">
        <div className="pp-panel__head">
          <span className="pp-panel__title mono-label">IDEA GATE</span>
          <span className="pps-sub">No tension and no change = a topic, not a story</span>
        </div>
        <Field label="WANT" hint="What do they want? One line">
          <input className="pp-input pp-input--ar" value={gate.want ?? ''}
            onChange={e => setGate({ want: e.target.value })} placeholder="Wants to…" />
        </Field>
        <Field label="TENSION" hint="Internal, external, or anticipation — anticipation is tension too">
          <input className="pp-input pp-input--ar" value={gate.tension ?? ''}
            onChange={e => setGate({ tension: e.target.value })} placeholder="But…" />
        </Field>
        <Field label="CHANGE" hint="What changed by the end of the story?">
          <input className="pp-input pp-input--ar" value={gate.change ?? ''}
            onChange={e => setGate({ change: e.target.value })} placeholder="Until…" />
        </Field>
        <div className="pps-row">
          <button className="pp-btn pp-btn--accent" disabled={props.busy !== null}
            onClick={() => void props.checkGate()}>Check the gate</button>
          {props.busy === 'gate' && <Busy label="The engineer is judging…" />}
          {gate.passed && !props.gateVerdict && <span className="pps-verdict__ok mono-label">GATE PASSED</span>}
        </div>
        {props.gateVerdict && (
          <div className={`pps-verdict${props.gateVerdict.passed ? ' is-pass' : ' is-fail'}`}>
            <div className="mono-label pps-verdict__tag">{props.gateVerdict.passed ? 'PASSED' : 'REJECTED — TOPIC, NOT STORY'}</div>
            <p className="pps-verdict__reason">{props.gateVerdict.reason}</p>
            {!props.gateVerdict.passed && (
              <p className="pps-verdict__dig" dir="auto">{props.gateVerdict.digQuestion ?? DIG_FALLBACK}</p>
            )}
          </div>
        )}
      </div>

      <div className="pp-panel">
        <div className="pp-panel__head">
          <span className="pp-panel__title mono-label">COMPASS · INTERNAL</span>
          <span className="pps-sub">Internal engine — never surfaces in the Arabic copy</span>
        </div>
        <Field label="WANT–BUT–UNTIL" hint="One English sentence. Every later decision is measured against it.">
          <input className="pp-input" dir="ltr" value={props.compass}
            onChange={e => props.setCompass(e.target.value)}
            placeholder="I wanted …, but …, until …" />
        </Field>
        <div className="pps-row">
          <button className="pp-btn" disabled={props.busy !== null || !props.compass.trim()}
            onClick={() => void props.checkCompass()}>Check the compass</button>
          {props.busy === 'compass' && <Busy label="Critiquing…" />}
        </div>
        {props.compassVerdict && (
          <div className={`pps-verdict${props.compassVerdict.weakChange ? ' is-fail' : ' is-pass'}`}>
            <div className="mono-label pps-verdict__tag">
              {props.compassVerdict.weakChange ? 'WEAK CHANGE — the until restates the want' : 'COMPASS HOLDS'}
            </div>
            <p className="pps-verdict__note" dir="ltr">{props.compassVerdict.note}</p>
          </div>
        )}
        <Field label="EMOTIONAL QUESTION" hint="One question under the whole piece — every block is another angle on it">
          <input className="pp-input pp-input--ar" value={props.emotionalQuestion}
            onChange={e => props.setEq(e.target.value)}
            placeholder="If I'm living my dream, why does it feel heavier?" />
          <ArText text={props.emotionalQuestion} />
        </Field>
      </div>
    </>
  );
}

function SourceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={`pps-source__row${value ? '' : ' is-empty'}`}>
      <span className="mono-label">{label}</span>
      <p>{value || '—'}</p>
    </div>
  );
}

// ─── Step 2 — BEATS · الضربات الخمس ─────────────────────────────────────────

function StepBeats(props: {
  beats: StoryBeat[]; setBeat: (i: number, p: Partial<StoryBeat>) => void;
  draftBeats: () => Promise<void>; busy: string | null;
}) {
  return (
    <>
      <div className="pps-row pps-row--head">
        <button className="pp-btn pp-btn--accent" disabled={props.busy !== null}
          onClick={() => void props.draftBeats()}>Draft the beats</button>
        {props.busy === 'beats' && <Busy label="The novelist is writing…" />}
      </div>
      {props.beats.map((b, i) => (
        <div className="pp-panel pps-beat" key={b.beat}>
          <div className="pp-panel__head">
            <span className="pp-panel__title mono-label">{i + 1} · {b.beat}</span>
            <span className="pp-panel__spacer" />
            <span className="pps-beat__rule">{BEAT_RULE[b.beat]}</span>
          </div>
          <Field label="LINE" hint="Arabic, in the novelist's rhythm">
            <textarea className="pp-textarea pp-textarea--ar pps-beat__line" value={b.line}
              onChange={e => props.setBeat(i, { line: e.target.value })}
              placeholder="One line, in the novelist's rhythm…" />
          </Field>
          <Field label="VISUAL METAPHOR" hint="The feeling must be SEEN — no event-listing">
            <input className="pp-input pp-input--ar" value={b.visualMetaphor}
              onChange={e => props.setBeat(i, { visualMetaphor: e.target.value })}
              placeholder="An external image of the internal — filmable…" />
          </Field>
        </div>
      ))}
    </>
  );
}

// ─── Step 3 — BLOCKS · الميزانية والبلوكات ─────────────────────────────────

function StepBlocks(props: {
  blocks: AvBlock[]; setBlock: (i: number, p: Partial<AvBlock>) => void;
  seedRows: () => void; draftBlocks: () => Promise<void>;
  dur: Duration; setDuration: (d: Duration) => void;
  dialect: string; setDialect: (d: string) => void;
  voWords: number; maxWords: number; over: boolean; voCutoff: number;
  busy: string | null;
}) {
  return (
    <>
      <div className="pp-panel">
        <div className="pp-panel__head">
          <span className="pp-panel__title mono-label">BUDGET</span>
          <span className="pps-sub">The budget is declared before the first word</span>
        </div>
        <div className="pps-budgetrow">
          <div>
            <div className="mono-label pps-side__label">DURATION</div>
            <div className="pp-chiprow">
              {DURATIONS.map(d => (
                <button key={d} className={`pp-chip${props.dur === d ? ' is-on' : ''}`}
                  onClick={() => props.setDuration(d)}>{d}s · ≤{MAX_WORDS[d]} words</button>
              ))}
            </div>
          </div>
          <div>
            <div className="mono-label pps-side__label">DIALECT · DRIVES THE VO</div>
            <div className="pp-chiprow">
              {DIALECTS.map(d => (
                <button key={d} className={`pp-chip${props.dialect === d ? ' is-on' : ''}`}
                  onClick={() => props.setDialect(d)}>{DIALECT_LABEL[d] ?? d}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="pp-meter pps-meter">
          <div className="pp-meter__track">
            <div className={`pp-meter__fill${props.over ? ' is-over' : ''}`}
              style={{ width: `${Math.min(100, (props.voWords / props.maxWords) * 100)}%` }} />
          </div>
          <div className="pp-meter__label">
            <span>VO {props.voWords} / {props.maxWords} words</span>
            <span>read aloud to verify</span>
          </div>
        </div>
        {props.over && (
          <div className="pp-error">Over budget — {props.voWords}/{props.maxWords} VO words. Over budget = loud failure, not "almost". Cut.</div>
        )}
        <ul className="pps-rules">
          <li>The final block is the reserved CTA/LOGO block — the logo breathes.</li>
          <li>No new VO after ~{props.voCutoff}s.</li>
          <li>Transitions are written, never implied.</li>
          <li>VISUAL takes camera-able sentences — mood words in any language fail the channel.</li>
        </ul>
      </div>

      <div className="pps-row pps-row--head">
        <button className="pp-btn pp-btn--accent" disabled={props.busy !== null}
          onClick={() => void props.draftBlocks()}>Draft the blocks</button>
        {props.blocks.length === 0 && (
          <button className="pp-btn pp-btn--ghost" onClick={props.seedRows}>Seed empty rows</button>
        )}
        {props.busy === 'blocks' && <Busy label="Timing the blocks…" />}
      </div>

      {props.blocks.map((b, i) => {
        const beatName = BEAT_ORDER[i] ?? 'RESULT';
        const isLast = i === props.blocks.length - 1;
        const moody = MOOD_RE.test(b.visual);
        const lateVo = b.vo.trim() !== '' && b.tcIn >= props.voCutoff;
        return (
          <div className="pp-panel pps-block" key={i}>
            <div className="pp-panel__head">
              <span className="pp-panel__title mono-label">SCENE {b.scene} · {beatName}{isLast ? ' · CTA/LOGO' : ''}</span>
              <span className="pp-panel__spacer" />
              <span className="pps-block__tc mono-label">
                <input className="pp-input pps-block__num" type="number" value={b.tcIn} min={0}
                  onChange={e => props.setBlock(i, { tcIn: Number(e.target.value) })} />
                –
                <input className="pp-input pps-block__num" type="number" value={b.tcOut} min={0}
                  onChange={e => props.setBlock(i, { tcOut: Number(e.target.value) })} />
                s
              </span>
            </div>
            <Field label="VISUAL" hint="Verbs, objects, distances — no mood">
              <textarea className="pp-textarea pp-textarea--ar pps-block__visual" value={b.visual}
                onChange={e => props.setBlock(i, { visual: e.target.value })} />
              <ArText text={b.visual} />
              {moody && <div className="pps-flag">Mood words rejected — write what the camera does.</div>}
            </Field>
            <Field label={`VO (${DIALECT_LABEL[props.dialect] ?? props.dialect})`} hint={`${voWordCount(b.vo)} words`}>
              <textarea className="pp-textarea pp-textarea--ar pps-block__vo" value={b.vo}
                onChange={e => props.setBlock(i, { vo: e.target.value })} />
              {lateVo && <div className="pps-flag">New VO after ~{props.voCutoff}s — the last block belongs to the logo. Cut or move it.</div>}
            </Field>
            <div className="pps-block__pair">
              <Field label="SUPER + SFX" hint="The SUPER is born with the script — RTL over the frame">
                <input className="pp-input pp-input--ar" value={b.superSfx}
                  onChange={e => props.setBlock(i, { superSfx: e.target.value })} />
                <ArText text={b.superSfx} />
              </Field>
              <Field label="TRANSITION" hint="Written, never implied">
                <input className="pp-input pp-input--ar" value={b.transition}
                  onChange={e => props.setBlock(i, { transition: e.target.value })}
                  placeholder="hard cut on…" />
                <ArText text={b.transition} />
              </Field>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ─── Step 4 — HANDOFF · التسليم ─────────────────────────────────────────────

function StepHandoff(props: {
  script: string; blocksCount: number;
  sendBlockReason: string | null; send: () => Promise<void>; busy: string | null;
}) {
  return (
    <>
      <div className="pp-panel">
        <div className="pp-panel__head">
          <span className="pp-panel__title mono-label">COMPILED SCRIPT</span>
          <span className="pps-sub">Exactly what the storyboard breakdown reads — zero guessing</span>
        </div>
        {props.blocksCount === 0 ? (
          <p className="pps-treat__empty">No blocks yet — go back to BLOCKS and draft them.</p>
        ) : (
          <pre className="pps-script" dir="rtl">{props.script}</pre>
        )}
      </div>
      <div className="pps-row">
        <button className="pp-btn pp-btn--accent" disabled={props.busy !== null || props.sendBlockReason !== null}
          onClick={() => void props.send()}>Send to Storyboard</button>
        {props.busy === 'send' && <Busy label="Handing the script over…" />}
        {props.sendBlockReason && <span className="pps-flag pps-flag--inline">{props.sendBlockReason}</span>}
      </div>
    </>
  );
}
