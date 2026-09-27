// Treatment — رؤية المخرج. Stage 4 of the project contract.
//
// The Director persona (STUDY/creative_pipeline/00_THE_COUNCIL.md §٤ +
// _synthesis/D_treatment.md): the treatment is a portrait of the director
// re-tailored per READER — the briefing CALL, not the brief document, is the
// tailoring input. Specificity wins: the six choice-pairs are decided BEFORE
// any descriptive sentence; vague mood words (سينمائي / أجواء / atmospheric)
// lose pitches silently. First/last frames pass the 8-element house
// diagnostic. The page-plan feeds Pitch; imageSpecs feed References.
//
// House laws: MADE not Generate (Decide / Draft / Make / Refine). English
// mono-labels, Arabic serif content. Colour on substrates only.

import { useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/preprod-treatment.css';
import { useStore } from '../../store';
import type { TreatmentData, ChoicePairs, PagePlanRow } from '../../types/preprod';
import { PreprodShell, useStageData, ppClaude, Field, Busy, useToast } from './shared';
import { ArText } from './ArText';
import { loadPovBlock, getPOV, type CreativePOV } from '../../lib/creative360';
import { syncStagesToCreativeGraph } from '../../lib/creativegraph/stageSync';

// ─── constants ──────────────────────────────────────────────────────────────

const ACCENT = '#AF7757';

const EMPTY: TreatmentData = {
  readerProfile: { ego: '', busyness: '', energy: '', preset: undefined },
  approach: '',
  ideaStance: { love: '', expand: '', keep: '' },
  visuals: {
    choicePairs: { aspect: '', lens: '', lightDirection: '', cameraMove: '', hour: '', placeRegister: '' },
    threeReaderNotes: { agency: '', production: '', dp: '' },
  },
  wardrobe: { pieces: '', negatives: [] },
  post: { edit: '', grade: '', cgiRestraint: true },
  firstFrame: '',
  lastFrame: '',
  pagePlan: [],
};

const STEPS: ReadonlyArray<{ n: number; name: string; sub: string }> = [
  { n: 1, name: 'Reader', sub: 'ego · busyness · energy → length' },
  { n: 2, name: 'Stance', sub: 'approach + declared idea stance' },
  { n: 3, name: 'Visuals', sub: 'six choice-pairs · three readers' },
  { n: 4, name: 'Craft', sub: 'wardrobe · post · first/last frames' },
  { n: 5, name: 'Page-plan', sub: 'feeds Pitch · specs feed References' },
];

// `ar` is the Arabic tag written into 04_treatment.md (content) — never shown in the UI.
const PAIRS: ReadonlyArray<{ key: keyof ChoicePairs; label: string; ar: string; either: string }> = [
  { key: 'aspect', label: 'Aspect', ar: 'الأسبكت', either: 'anamorphic or 4:3?' },
  { key: 'lens', label: 'Lens', ar: 'العدسة', either: '40mm prime or long zoom?' },
  { key: 'lightDirection', label: 'Light direction', ar: 'اتجاه الضوء', either: 'front-lit or backlit?' },
  { key: 'cameraMove', label: 'Camera move', ar: 'حركة الكاميرا', either: 'dolly or handheld?' },
  { key: 'hour', label: 'Hour', ar: 'الساعة', either: 'dawn or night?' },
  { key: 'placeRegister', label: 'Place register', ar: 'سجل المكان', either: 'domestic or institutional?' },
];

// Banned-vagueness scanner — the words that lose pitches (Council §٤ constraints).
const BANNED: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /سينمائي/, label: 'سينمائي' },
  { re: /أجواء/, label: 'أجواء' },
  { re: /atmospheric/i, label: 'atmospheric' },
  { re: /bright\s+and\s+airy/i, label: 'bright and airy' },
  { re: /dreamy/i, label: 'dreamy' },
];

function scanBanned(texts: Array<string | undefined>): string[] {
  const joined = texts.filter(Boolean).join('\n');
  return BANNED.filter(b => b.re.test(joined)).map(b => b.label);
}

// 8-element house diagnostic — live keyword heuristics per element.
// Labels are UI (English); the tests read Arabic frame CONTENT.
const FRAME_ELEMENTS: ReadonlyArray<{ key: string; label: string; test: (t: string) => boolean }> = [
  {
    key: 'subject', label: 'Subject state + wardrobe',
    test: t => /(يرتدي|ترتدي|يلبس|تلبس|ثوب|عباية|شماغ|غترة|قميص|فستان|شيلة|يده|يدها|يداه|كفّه|كفّها|نظرته|نظرتها|عيناه|عيناها|وقفة|جالس|واقف|منحنٍ|كتفاه|كتفاها|posture|wardrobe)/.test(t),
  },
  {
    key: 'blocking', label: 'Blocking — position, distance, angle',
    test: t => /(متر|أمتار|خطوة|خطوتين|خطوات|يسار الكادر|يمين الكادر|منتصف الكادر|مقدمة الكادر|من الكاميرا|أمام الكاميرا|بزاوية|زاوية|قبالة|blocking)/.test(t),
  },
  {
    key: 'light', label: 'Light architecture — every source named, with temperature',
    test: t => /(ضوء|إضاءة|مضاء|مفتاح الضوء|كلفن|\d{3,4}\s?K|تنجستن|فلوريسنت|نيون|ظل|ظلال|fill|rim|key)/i.test(t),
  },
  {
    key: 'plates', label: 'Three plates + cultural-truth object',
    test: t => /(مقدمة|المقدمة|خلفية|الخلفية|وسط الكادر|منتصف العمق|طبقة|طبقات|عمق الكادر)/.test(t),
  },
  {
    key: 'sound', label: 'Sound of the frame',
    test: t => /(صوت|يُسمع|يسمع|تسمع|همهمة|هسيس|طنين|أذان|ضجيج|صفير|وشوشة|صمت|سكون|حفيف|أزيز)/.test(t),
  },
  {
    key: 'time', label: 'Time state — hour, weather, operation',
    test: t => /(فجر|شروق|ضحى|ظهر|عصر|مغرب|غروب|عشاء|ليل|صباح|مساء|الساعة|ذروة|dawn|dusk|golden)/i.test(t),
  },
  {
    key: 'crop', label: 'Crop & aspect plan — safe areas',
    test: t => /(أسبكت|القصّ|قصّة|آمن|آمنة|شعار|لوغو|لوكب|9:16|16:9|4:3|1:1|4:5|3:4|21:9|crop|aspect|safe)/i.test(t),
  },
  {
    key: 'inside', label: 'Inside state — one sentence',
    test: t => /(الحالة الداخلية|في داخله|في داخلها|داخله|داخلها|يعرف أن|تعرف أن|لا يقولها|لم يقلها)/.test(t),
  },
];

function missingElements(frame: string | undefined): string[] {
  const t = frame ?? '';
  if (!t.trim()) return FRAME_ELEMENTS.map(e => e.label);
  return FRAME_ELEMENTS.filter(e => !e.test(t)).map(e => e.label);
}

// ─── LLM systems — the Director, encoded (Council §٤) ──────────────────────

const DIRECTOR_SYSTEM = [
  'You are a working commercial director — the generation that wrote over a hundred treatments and lost enough of them to know the vague document loses SILENTLY: the agency simply never replies.',
  '',
  'Doctrine 1 — the treatment is a portrait of the director re-tailored per READER. No fixed template by design. The briefing CALL — not the brief document — is the tailoring input: you read the energy of the room to decide whether the post pages even deserve depth.',
  'Doctrine 2 — SPECIFICITY WINS. Anamorphic vs 4:3, front-lit vs backlit, dolly vs handheld, dawn vs night — each choice changes the perceived story; ambiguity loses pitches. BANNED as description, always: سينمائي / أجواء / atmospheric / bright and airy / dreamy. Every light is named by its source, color temperature (K) and angle — never "well-lit".',
  'Doctrine 3 — the Visuals section serves THREE readers at once: the agency reads the feel, production reads the cost, the DP reads what is expected of them.',
  'Doctrine 4 — sentences that are SEEN. Director voice, not consultant voice: present, concrete, no theorizing.',
  'Era inherits its medium\'s look: a 1987 treatment describes 16mm skin and tungsten falloff, never "vintage".',
  'Never promise what the Frames stage cannot make — no impossible VFX, no celebrity promises, no unbuildable sets. CGI only in the measure that clarifies; too much confuses (الكثير يشوّش).',
  'The signed Big Idea (stage 1) is NOT reopened. Disagreement travels through "what we love + what we propose to expand" — never demolition.',
  'All Arabic in the Saudi novelist register: calm, specific, slightly imperfect. Banned openers: "في عالم اليوم", "نحو مستقبل أفضل", "تجربة لا تُنسى", "أصالة وحداثة", "بلمسة سعودية".',
  '',
  'Return ONLY the JSON object asked for — no prose around it.',
].join('\n');

// ─── markdown (04_treatment.md) ─────────────────────────────────────────────

function mdCell(s: string | undefined): string {
  return (s ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/').trim();
}

function renderTreatmentMarkdown(d: TreatmentData, projectName?: string): string {
  const r = d.readerProfile ?? {};
  const cp = d.visuals?.choicePairs ?? {};
  const notes = d.visuals?.threeReaderNotes ?? {};
  const L: string[] = [];
  L.push(`# رؤية المخرج — ${projectName ?? 'Untitled'}`);
  L.push('');
  L.push('## ملف القارئ — من مكالمة البريف');
  L.push(`- Ego: ${r.ego?.trim() || '—'}`);
  L.push(`- Busyness: ${r.busyness?.trim() || '—'}`);
  L.push(`- Energy: ${r.energy?.trim() || '—'}`);
  L.push(`- Length preset: ${r.preset ?? 25} pages${!r.ego?.trim() && !r.busyness?.trim() && !r.energy?.trim() ? ' — لا ملاحظات مكالمة؛ اعتمدنا وضع الوكالة 20–25 معلناً.' : ''}`);
  L.push('');
  L.push('## Approach — لماذا نحن');
  L.push((d.approach ?? '').trim() || '—');
  L.push('');
  L.push('## الفكرة — الموقف المعلن');
  L.push(`- **نحب:** ${(d.ideaStance?.love ?? '').trim() || '—'}`);
  L.push(`- **نوسّع:** ${(d.ideaStance?.expand ?? '').trim() || '—'}`);
  L.push(`- **نترك كما هي:** ${(d.ideaStance?.keep ?? '').trim() || '—'}`);
  L.push('');
  L.push('## Visuals — القرارات الستة');
  for (const p of PAIRS) L.push(`- **${p.label} · ${p.ar}:** ${((cp as Partial<ChoicePairs>)[p.key] ?? '').trim() || '—'}`);
  L.push('');
  L.push('### قسم واحد، ثلاثة قراء');
  L.push(`- **الوكالة تقرأ الإحساس:** ${(notes.agency ?? '').trim() || '—'}`);
  L.push(`- **الإنتاج يقرأ الكلفة:** ${(notes.production ?? '').trim() || '—'}`);
  L.push(`- **المصور يقرأ المتوقع:** ${(notes.dp ?? '').trim() || '—'}`);
  L.push('');
  L.push('## Wardrobe — الملبس');
  L.push((d.wardrobe?.pieces ?? '').trim() || '—');
  if (d.wardrobe?.negatives?.length) {
    L.push('');
    L.push('**السلبيات المعلنة:**');
    for (const n of d.wardrobe.negatives) L.push(`- ليس: ${n}`);
  }
  L.push('');
  L.push('## Post');
  L.push(`- **Edit:** ${(d.post?.edit ?? '').trim() || '—'}`);
  L.push(`- **Grade:** ${(d.post?.grade ?? '').trim() || '—'}`);
  L.push(`- **CGI restraint:** ${d.post?.cgiRestraint !== false ? 'ON — الكثير يشوّش' : 'OFF'}`);
  L.push('');
  L.push('## الفريم الأول');
  L.push((d.firstFrame ?? '').trim() || '—');
  L.push('');
  L.push('## الفريم الأخير');
  L.push((d.lastFrame ?? '').trim() || '—');
  L.push('');
  L.push('## Page-plan — تُغذّي Pitch؛ وimageSpecs تُغذّي References');
  L.push('');
  L.push('| # | Section | Text | Image spec |');
  L.push('|---|---------|------|------------|');
  (d.pagePlan ?? []).forEach((row, i) => {
    L.push(`| ${i + 1} | ${mdCell(row.section)} | ${mdCell(row.text)} | ${mdCell(row.imageSpec)} |`);
  });
  return L.join('\n');
}

// ─── view ───────────────────────────────────────────────────────────────────

type BusyKind = null | 'stance' | 'six' | 'frames' | 'plan';

export function TreatmentView() {
  const projectId = useStore(s => s.activeProjectId);
  const project = useStore(s => s.projects.find(p => p.id === s.activeProjectId) ?? null);
  const { data, loaded, update, saveNow } = useStageData<TreatmentData>(4, EMPTY);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState<BusyKind>(null);
  const [toast, showToast] = useToast();

  // ── stage-1 pull: the signed idea, read once per project ──
  const [signedIdea, setSignedIdea] = useState<{ proposition?: string; territory?: string; why?: string; oneLine?: string } | null>(null);
  useEffect(() => {
    if (!projectId) { setSignedIdea(null); return; }
    let live = true;
    window.hjen.readStageData({ id: projectId, stage: 1 })
      .then(d => {
        if (!live || !d || typeof d !== 'object') return;
        const b = d as any;
        setSignedIdea({
          proposition: typeof b.proposition === 'string' ? b.proposition : undefined,
          territory: b.bigIdea?.territory,
          why: b.bigIdea?.why,
          oneLine: typeof b.oneLine === 'string' ? b.oneLine : undefined,
        });
      })
      .catch(() => { if (live) setSignedIdea(null); });
    return () => { live = false; };
  }, [projectId]);

  // Creative 360 — every draft obeys the same project POV (esp. its FORBIDDEN).
  // povBlockRef = the composed suffix (offline path); povRef = the raw POV object
  // sent as `vars` so the SERVER composes the suffix in gateway mode (recipe stays
  // off the wire — the base director doctrine never ships to the client).
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

  // ── reader defaults: no call notes → agency mode 25, said out loud ──
  const reader = data.readerProfile ?? {};
  const noCallNotes = !reader.ego?.trim() && !reader.busyness?.trim() && !reader.energy?.trim();
  const defaulted = useRef(false);
  useEffect(() => { defaulted.current = false; }, [projectId]);
  useEffect(() => {
    if (!loaded || defaulted.current) return;
    defaulted.current = true;
    if (noCallNotes && !reader.preset) {
      update({ readerProfile: { ...reader, preset: 25 } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // ── nested updaters ──
  const upReader = (patch: Partial<NonNullable<TreatmentData['readerProfile']>>) =>
    update({ readerProfile: { ...reader, ...patch } });
  const upStance = (patch: Partial<NonNullable<TreatmentData['ideaStance']>>) =>
    update({ ideaStance: { ...(data.ideaStance ?? {}), ...patch } });
  const cp: Partial<ChoicePairs> = data.visuals?.choicePairs ?? {};
  const notes = data.visuals?.threeReaderNotes ?? {};
  const upVisuals = (patch: Partial<NonNullable<TreatmentData['visuals']>>) =>
    update({ visuals: { ...(data.visuals ?? {}), ...patch } });
  const upPair = (key: keyof ChoicePairs, v: string) =>
    upVisuals({ choicePairs: { ...cp, [key]: v } });
  const upNote = (key: 'agency' | 'production' | 'dp', v: string) =>
    upVisuals({ threeReaderNotes: { ...notes, [key]: v } });
  const upWardrobe = (patch: Partial<NonNullable<TreatmentData['wardrobe']>>) =>
    update({ wardrobe: { ...(data.wardrobe ?? {}), ...patch } });
  const upPost = (patch: Partial<NonNullable<TreatmentData['post']>>) =>
    update({ post: { cgiRestraint: true, ...(data.post ?? {}), ...patch } });

  // ── live diagnostics ──
  const decidedCount = PAIRS.filter(p => (cp[p.key] ?? '').trim()).length;
  const step3Banned = scanBanned([
    ...PAIRS.map(p => cp[p.key]),
    notes.agency, notes.production, notes.dp,
  ]);
  const everywhereBanned = scanBanned([
    data.approach, data.ideaStance?.love, data.ideaStance?.expand, data.ideaStance?.keep,
    ...PAIRS.map(p => cp[p.key]), notes.agency, notes.production, notes.dp,
    data.wardrobe?.pieces, data.post?.edit, data.post?.grade,
    data.firstFrame, data.lastFrame,
    ...(data.pagePlan ?? []).flatMap(r => [r.section, r.text, r.imageSpec]),
  ]);
  const ffMiss = missingElements(data.firstFrame);
  const lfMiss = missingElements(data.lastFrame);

  const stepDone: Record<number, boolean> = {
    1: !!reader.preset,
    2: !!data.approach?.trim(),
    3: decidedCount === 6 && step3Banned.length === 0,
    4: !!data.firstFrame?.trim() && !!data.lastFrame?.trim() && ffMiss.length <= 1 && lfMiss.length <= 1,
    5: (data.pagePlan ?? []).length > 0,
  };

  // ── LLM drafts ──
  const ideaLines = [
    signedIdea?.territory ? `Big Idea territory: ${signedIdea.territory}` : '',
    signedIdea?.why ? `Why it won: ${signedIdea.why}` : '',
    signedIdea?.proposition ? `Proposition (ONE sentence): ${signedIdea.proposition}` : '',
    signedIdea?.oneLine ? `One-line intent: ${signedIdea.oneLine}` : '',
  ].filter(Boolean).join('\n') || '(stage 1 has no signed idea text — work from the reader profile alone and say so in the approach)';

  const readerLines = [
    `ego: ${reader.ego?.trim() || '—'}`,
    `busyness: ${reader.busyness?.trim() || '—'}`,
    `room energy: ${reader.energy?.trim() || '—'}`,
    `length preset: ${reader.preset ?? 25} pages${noCallNotes ? ' (agency default — no call notes)' : ''}`,
  ].join(' · ');

  const draftStance = async () => {
    setBusy('stance');
    const res = await ppClaude<{ approach: string; love: string; expand: string; keep: string }>({
      system: sys(DIRECTOR_SYSTEM), promptId: 'treatment.director', vars: { pov: povRef.current },
      prompt: [
        'Draft the treatment STANCE.',
        '',
        'The signed idea (stage 1 — do not reopen it):',
        ideaLines,
        '',
        `Reader profile (from the briefing call): ${readerLines}`,
        '',
        'Return JSON: {"approach": "...", "love": "...", "expand": "...", "keep": "..."}',
        '- approach: two short Arabic paragraphs. Opens with thanks + collaborative humility — the doctrine «هذه الوثيقة نقطة بداية تتطور بعملنا المشترك» in your own phrasing. Why us — without self-marketing, without a single boast.',
        '- love: what we genuinely love in the signed idea — specific, seen, one short Arabic paragraph.',
        '- expand: what we propose to expand or sharpen — a DECLARED decision, Arabic.',
        '- keep: what stays exactly as the agency wrote it — declared, Arabic.',
      ].join('\n'),
    });
    setBusy(null);
    if (!res.ok) { showToast(res.message); return; }
    update({
      approach: res.json.approach ?? data.approach,
      ideaStance: {
        love: res.json.love ?? data.ideaStance?.love,
        expand: res.json.expand ?? data.ideaStance?.expand,
        keep: res.json.keep ?? data.ideaStance?.keep,
      },
    });
  };

  const decideSix = async () => {
    setBusy('six');
    const res = await ppClaude<Record<keyof ChoicePairs, string>>({
      system: sys(DIRECTOR_SYSTEM), promptId: 'treatment.director', vars: { pov: povRef.current },
      prompt: [
        'DECIDE the six choice-pairs of the Visuals section — before any descriptive sentence exists.',
        'Each value = the decision + " — " + a one-line reason, in Arabic. Example: "4:3 — بيتي، ضد سينماسكوب المستورد".',
        'No hedging, no "or", one decision per pair. Never a banned mood word.',
        '',
        'The signed idea:',
        ideaLines,
        '',
        `Reader profile: ${readerLines}`,
        data.approach?.trim() ? `\nApproach already written:\n${data.approach.trim()}` : '',
        '',
        'Current leanings (overwrite freely where empty or weak):',
        ...PAIRS.map(p => `- ${p.label} (${p.either}): ${(cp[p.key] ?? '').trim() || '—'}`),
        '',
        'Return JSON: {"aspect": "...", "lens": "...", "lightDirection": "...", "cameraMove": "...", "hour": "...", "placeRegister": "..."}',
      ].join('\n'),
    });
    setBusy(null);
    if (!res.ok) { showToast(res.message); return; }
    const next: Partial<ChoicePairs> = { ...cp };
    for (const p of PAIRS) {
      const v = res.json[p.key];
      if (typeof v === 'string' && v.trim()) next[p.key] = v.trim();
    }
    upVisuals({ choicePairs: next });
  };

  const draftFrames = async () => {
    setBusy('frames');
    const res = await ppClaude<{ firstFrame: string; lastFrame: string }>({
      system: sys(DIRECTOR_SYSTEM), promptId: 'treatment.director', vars: { pov: povRef.current },
      prompt: [
        'Draft the FIRST FRAME and the LAST FRAME of the film at the full house diagnostic — ALL EIGHT elements present in EACH frame, written as flowing director prose in Arabic (novelist register), one block per frame:',
        '1. حالة الذات — posture, breath, micro-expression, hands (what they hold, how), eye-line with offscreen coordinates + wardrobe piece-by-piece with explicit negatives against the stock-Arab drift.',
        '2. البلوكينج — exact position named relative to the set, distance to lens in meters, angle to camera.',
        '3. معمار الضوء — every source named (key/fill/rim/ambient/event), color temperature in K, angle, in-frame or off. Never "well-lit".',
        '4. أثاث الفريم — three plates (مقدمة / وسط / خلفية) + the ONE cultural-truth object that tells the viewer this is real.',
        '5. صوت الفريم — what the room sounds like at the moment of capture.',
        '6. حالة الزمن — the hour, light state, weather, operational state.',
        '7. خطة القص — which deliverable aspects the frame survives, where the safe areas sit, where the bilingual lockup lands.',
        '8. الحالة الداخلية — ONE sentence, what happens inside the subject in THIS frame.',
        '',
        'The first frame is a promise; the last frame is what the viewer carries out of the feed.',
        'Honor the six decided choice-pairs EXACTLY:',
        ...PAIRS.map(p => `- ${p.label}: ${(cp[p.key] ?? '').trim() || '—'}`),
        '',
        'The signed idea:',
        ideaLines,
        data.wardrobe?.pieces?.trim() ? `\nWardrobe already written:\n${data.wardrobe.pieces.trim()}` : '',
        (data.wardrobe?.negatives?.length ? `Wardrobe negatives: ${data.wardrobe.negatives.join(' · ')}` : ''),
        '',
        'Return JSON: {"firstFrame": "...", "lastFrame": "..."}',
      ].join('\n'),
      maxTokens: 8000,
    });
    setBusy(null);
    if (!res.ok) { showToast(res.message); return; }
    update({
      firstFrame: typeof res.json.firstFrame === 'string' && res.json.firstFrame.trim() ? res.json.firstFrame.trim() : data.firstFrame,
      lastFrame: typeof res.json.lastFrame === 'string' && res.json.lastFrame.trim() ? res.json.lastFrame.trim() : data.lastFrame,
    });
  };

  const draftPlan = async () => {
    const preset = reader.preset ?? 25;
    const target = preset === 8 ? 7 : preset === 50 ? 20 : 12;
    setBusy('plan');
    const res = await ppClaude<{ rows: PagePlanRow[] }>({
      system: sys(DIRECTOR_SYSTEM), promptId: 'treatment.director', vars: { pov: povRef.current },
      prompt: [
        `Draft the PAGE-PLAN for a ${preset}-page treatment — about ${target} rows${preset === 8 ? ' (merge sections aggressively; the reader is busy)' : preset === 50 ? ' (the room asked for depth — split Visuals/Wardrobe/Post into focused pages)' : ''}.`,
        'Each row: {"section": "...", "text": "...", "imageSpec": "..."}',
        '- section: COVER / APPROACH / IDEA / VISUALS / WARDROBE / GRADE / POST / CLOSE … short English tag.',
        '- text: the page body, Arabic, AT MOST two short paragraphs. One idea per page.',
        '- imageSpec: what the page\'s SINGLE image must be — concrete enough to search or make (shot size, palette temperature, hour, people count). This spec feeds the visual researcher.',
        'The persuasion skeleton is fixed: thank-you humility opener → what we love → Visuals for three readers → perfect-fit close.',
        '',
        'Build strictly from what is already decided:',
        `Reader profile: ${readerLines}`,
        'Signed idea:', ideaLines,
        data.approach?.trim() ? `Approach:\n${data.approach.trim()}` : '',
        `Idea stance — love: ${data.ideaStance?.love ?? '—'} / expand: ${data.ideaStance?.expand ?? '—'} / keep: ${data.ideaStance?.keep ?? '—'}`,
        'The six decisions:',
        ...PAIRS.map(p => `- ${p.label}: ${(cp[p.key] ?? '').trim() || '—'}`),
        `Three-reader notes — agency: ${notes.agency ?? '—'} / production: ${notes.production ?? '—'} / dp: ${notes.dp ?? '—'}`,
        `Wardrobe: ${data.wardrobe?.pieces ?? '—'} / negatives: ${(data.wardrobe?.negatives ?? []).join(' · ') || '—'}`,
        `Post — edit: ${data.post?.edit ?? '—'} / grade: ${data.post?.grade ?? '—'} / CGI restraint: ${data.post?.cgiRestraint !== false ? 'ON' : 'OFF'}`,
        data.firstFrame?.trim() ? `First frame:\n${data.firstFrame.trim()}` : '',
        data.lastFrame?.trim() ? `Last frame:\n${data.lastFrame.trim()}` : '',
        '',
        'Return JSON: {"rows": [{"section": "...", "text": "...", "imageSpec": "..."}, ...]}',
      ].join('\n'),
      maxTokens: 8000,
    });
    setBusy(null);
    if (!res.ok) { showToast(res.message); return; }
    const rows = Array.isArray(res.json.rows)
      ? res.json.rows
          .filter(r => r && typeof r === 'object')
          .map(r => ({ section: String(r.section ?? ''), text: String(r.text ?? ''), imageSpec: String(r.imageSpec ?? '') }))
      : [];
    if (rows.length === 0) { showToast('The draft came back empty — try again.'); return; }
    update({ pagePlan: rows });
  };

  // ── page-plan row ops ──
  const plan = data.pagePlan ?? [];
  const setRow = (i: number, patch: Partial<PagePlanRow>) => {
    const next = plan.map((r, j) => (j === i ? { ...r, ...patch } : r));
    update({ pagePlan: next });
  };
  const addRow = () => update({ pagePlan: [...plan, { section: '', text: '', imageSpec: '' }] });
  const removeRow = (i: number) => update({ pagePlan: plan.filter((_, j) => j !== i) });
  const moveRow = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= plan.length) return;
    const next = [...plan];
    [next[i], next[j]] = [next[j], next[i]];
    update({ pagePlan: next });
  };

  // ── negatives chips ──
  const [negDraft, setNegDraft] = useState('');
  const negatives = data.wardrobe?.negatives ?? [];
  const addNegative = () => {
    const v = negDraft.trim();
    if (!v || negatives.includes(v)) { setNegDraft(''); return; }
    upWardrobe({ negatives: [...negatives, v] });
    setNegDraft('');
  };

  // ── sign warnings ──
  const signWarnings = useMemo(() => {
    const w: Array<{ body: string; onJump?: () => void }> = [];
    const missingPairs = PAIRS.filter(p => !(cp[p.key] ?? '').trim());
    if (missingPairs.length > 0) {
      w.push({ body: `Choice-pairs undecided: ${missingPairs.map(p => p.label).join(', ')} — the Visuals section can't open with a pair hanging.`, onJump: () => setStep(3) });
    }
    if (everywhereBanned.length > 0) {
      w.push({ body: `Banned mood words present: ${everywhereBanned.join(' · ')} — name the light by source, temperature and angle instead.`, onJump: () => setStep(3) });
    }
    if (ffMiss.length >= 2) {
      w.push({ body: `First frame is missing ${ffMiss.length} of 8 house elements (${ffMiss.slice(0, 3).join(', ')}${ffMiss.length > 3 ? '…' : ''}).`, onJump: () => setStep(4) });
    }
    if (lfMiss.length >= 2) {
      w.push({ body: `Last frame is missing ${lfMiss.length} of 8 house elements (${lfMiss.slice(0, 3).join(', ')}${lfMiss.length > 3 ? '…' : ''}).`, onJump: () => setStep(4) });
    }
    if (plan.length === 0) {
      w.push({ body: 'Page-plan is empty — Pitch and References have nothing to build from.', onJump: () => setStep(5) });
    }
    if (!data.approach?.trim()) {
      w.push({ body: 'Approach is empty — Direction has no point of view to enforce.', onJump: () => setStep(2) });
    }
    return w;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, everywhereBanned.join('|'), ffMiss.length, lfMiss.length]);

  const beforeSign = async () => {
    await saveNow(renderTreatmentMarkdown(data, project?.name));
    if (projectId) await syncStagesToCreativeGraph(projectId);
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <PreprodShell
      tool="Direction"
      sub="Signed idea → visual law → technical handoffs"
      accent={ACCENT}
      stage={4}
      signWarnings={signWarnings}
      beforeSign={beforeSign}
    >
      <div className="pp-grid">
        <aside className="pp-aside">
          <div className="pp-steps">
            {STEPS.map(s => (
              <button
                key={s.n}
                className={`pp-step ${step === s.n ? 'is-current' : ''} ${stepDone[s.n] ? 'is-done' : ''}`}
                onClick={() => setStep(s.n)}
                type="button"
              >
                <span className="pp-step__n">{s.n}</span>
                <span>
                  <span className="pp-step__name">{s.name}</span>
                  <span className="pp-step__sub">{s.sub}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="ppt-status">
            <div className="mono-label ppt-status__head">Direction contract</div>
            <div className="pp-meter">
              <div className="pp-meter__track">
                <div className="pp-meter__fill" style={{ width: `${(decidedCount / 6) * 100}%` }} />
              </div>
              <div className="pp-meter__label"><span>choice-pairs</span><span>{decidedCount}/6 decided</span></div>
            </div>
            <div className="ppt-status__row mono-label">
              <span>first frame</span><span className={ffMiss.length >= 2 ? 'is-bad' : ''}>{8 - ffMiss.length}/8</span>
            </div>
            <div className="ppt-status__row mono-label">
              <span>last frame</span><span className={lfMiss.length >= 2 ? 'is-bad' : ''}>{8 - lfMiss.length}/8</span>
            </div>
            <div className="ppt-status__row mono-label">
              <span>banned words</span><span className={everywhereBanned.length ? 'is-bad' : ''}>{everywhereBanned.length}</span>
            </div>
            <div className="ppt-status__row mono-label">
              <span>page-plan</span><span>{plan.length} rows</span>
            </div>
          </div>
        </aside>

        <main className="pp-main">
          {!loaded ? <Busy label="Loading Direction…" /> : (
            <>
              {step === 1 && (
                <StepReader
                  reader={reader}
                  noCallNotes={noCallNotes}
                  upReader={upReader}
                />
              )}
              {step === 2 && (
                <StepStance
                  data={data}
                  signedIdea={signedIdea}
                  busy={busy}
                  update={update}
                  upStance={upStance}
                  onDraft={draftStance}
                />
              )}
              {step === 3 && (
                <StepVisuals
                  cp={cp}
                  notes={notes}
                  decidedCount={decidedCount}
                  banned={step3Banned}
                  busy={busy}
                  upPair={upPair}
                  upNote={upNote}
                  onDecide={decideSix}
                />
              )}
              {step === 4 && (
                <StepCraft
                  data={data}
                  busy={busy}
                  negDraft={negDraft}
                  setNegDraft={setNegDraft}
                  addNegative={addNegative}
                  negatives={negatives}
                  upWardrobe={upWardrobe}
                  upPost={upPost}
                  update={update}
                  onDraftFrames={draftFrames}
                />
              )}
              {step === 5 && (
                <StepPagePlan
                  plan={plan}
                  preset={reader.preset ?? 25}
                  busy={busy}
                  setRow={setRow}
                  addRow={addRow}
                  removeRow={removeRow}
                  moveRow={moveRow}
                  onDraft={draftPlan}
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

// ─── Step 1 — READER ────────────────────────────────────────────────────────

function StepReader(props: {
  reader: NonNullable<TreatmentData['readerProfile']>;
  noCallNotes: boolean;
  upReader: (p: Partial<NonNullable<TreatmentData['readerProfile']>>) => void;
}) {
  const { reader, noCallNotes, upReader } = props;
  return (
    <section className="pp-panel">
      <div className="pp-panel__head">
        <span className="pp-panel__title">Reader profile</span>
        <span className="pp-panel__ar ppt-en">from the briefing call, not the brief document</span>
      </div>

      <Field label="Ego" hint="From the briefing CALL, not the brief doc — whose idea is it, how much praise does it need?">
        <input
          className="pp-input pp-input--ar"
          value={reader.ego ?? ''}
          onChange={e => upReader({ ego: e.target.value })}
          placeholder="e.g. the idea is the CD's own — praise it before touching it"
        />
      </Field>
      <Field label="Busyness" hint="Governs the 8-page vs 50-page decision — length is a per-reader variable.">
        <input
          className="pp-input pp-input--ar"
          value={reader.busyness ?? ''}
          onChange={e => upReader({ busyness: e.target.value })}
          placeholder="e.g. reads at the airport between two flights — never past eight pages"
        />
      </Field>
      <Field label="Room energy" hint="Decide from the call whether the post pages even deserve depth.">
        <input
          className="pp-input pp-input--ar"
          value={reader.energy ?? ''}
          onChange={e => upReader({ energy: e.target.value })}
          placeholder="e.g. the room asked about the grade twice — the post pages deserve depth"
        />
      </Field>

      <Field label="Length preset" hint="Tailored per reader — never one template.">
        <div className="pp-chiprow">
          {([8, 25, 50] as const).map(p => (
            <button
              key={p}
              className={`pp-chip ${reader.preset === p ? 'is-on' : ''}`}
              onClick={() => upReader({ preset: p })}
              type="button"
            >
              {p} pages{p === 25 ? ' · agency default' : p === 8 ? ' · busy reader' : ' · deep room'}
            </button>
          ))}
        </div>
      </Field>

      {noCallNotes && (
        <div className="ppt-default">No call notes — defaulting to the 20–25-page agency posture, declared.</div>
      )}
    </section>
  );
}

// ─── Step 2 — STANCE ────────────────────────────────────────────────────────

function StepStance(props: {
  data: TreatmentData;
  signedIdea: { proposition?: string; territory?: string; why?: string; oneLine?: string } | null;
  busy: BusyKind;
  update: (p: Partial<TreatmentData>) => void;
  upStance: (p: Partial<NonNullable<TreatmentData['ideaStance']>>) => void;
  onDraft: () => void;
}) {
  const { data, signedIdea, busy, update, upStance, onDraft } = props;
  const hasIdea = !!(signedIdea?.territory || signedIdea?.proposition || signedIdea?.oneLine);
  return (
    <>
      <section className="pp-panel">
        <div className="pp-panel__head">
          <span className="pp-panel__title">THE SIGNED IDEA</span>
          <span className="pp-panel__ar ppt-en">from stage 1 — never reopened</span>
        </div>
        {hasIdea ? (
          <div className="ppt-idea">
            {signedIdea?.territory && <div className="ppt-idea__line"><span className="mono-label">Big idea</span><span className="ppt-idea__ar">{signedIdea.territory}</span></div>}
            {signedIdea?.why && <div className="ppt-idea__line"><span className="mono-label">Why</span><span className="ppt-idea__ar">{signedIdea.why}</span></div>}
            {signedIdea?.proposition && <div className="ppt-idea__line"><span className="mono-label">Proposition</span><span className="ppt-idea__ar">{signedIdea.proposition}</span></div>}
            {!signedIdea?.territory && !signedIdea?.proposition && signedIdea?.oneLine && (
              <div className="ppt-idea__line"><span className="mono-label">Intent</span><span className="ppt-idea__ar">{signedIdea.oneLine}</span></div>
            )}
          </div>
        ) : (
          <div className="ppt-idea ppt-idea--empty mono-label">Stage 1 has no signed idea yet — Brief Mind writes it.</div>
        )}
      </section>

      <section className="pp-panel">
        <div className="pp-panel__head">
          <span className="pp-panel__title">Approach + declared stance</span>
          <span className="pp-panel__ar ppt-en">the declared position on the idea</span>
          <span className="pp-panel__spacer" />
          {busy === 'stance'
            ? <Busy label="Drafting the stance…" />
            : <button className="pp-btn pp-btn--accent" onClick={onDraft} type="button">Draft the stance</button>}
        </div>

        <Field label="Approach" hint='Thank-you + collaborative humility — "this document is a starting point that grows through our shared work." No self-marketing.'>
          <textarea
            className="pp-textarea pp-textarea--ar ppt-tall"
            value={data.approach ?? ''}
            onChange={e => update({ approach: e.target.value })}
            placeholder="Arabic, two short paragraphs — thanks for the trust and the call; this document is a starting point that grows through our shared work."
          />
          <ArText text={data.approach} />
        </Field>

        <div className="ppt-stance">
          <Field label="We love" hint="What we genuinely love in the signed idea — declared.">
            <textarea
              className="pp-textarea pp-textarea--ar"
              value={data.ideaStance?.love ?? ''}
              onChange={e => upStance({ love: e.target.value })}
              placeholder="What we love in the idea — specific, seen (Arabic)"
            />
            <ArText text={data.ideaStance?.love} />
          </Field>
          <Field label="We expand" hint="What we propose to expand or sharpen — a decision, not a hint.">
            <textarea
              className="pp-textarea pp-textarea--ar"
              value={data.ideaStance?.expand ?? ''}
              onChange={e => upStance({ expand: e.target.value })}
              placeholder="What we propose to expand or sharpen (Arabic)"
            />
            <ArText text={data.ideaStance?.expand} />
          </Field>
          <Field label="We keep" hint="What stays exactly as the agency wrote it — declared.">
            <textarea
              className="pp-textarea pp-textarea--ar"
              value={data.ideaStance?.keep ?? ''}
              onChange={e => upStance({ keep: e.target.value })}
              placeholder="What stays exactly as the agency wrote it (Arabic)"
            />
            <ArText text={data.ideaStance?.keep} />
          </Field>
        </div>
      </section>
    </>
  );
}

// ─── Step 3 — VISUALS ───────────────────────────────────────────────────────

function StepVisuals(props: {
  cp: Partial<ChoicePairs>;
  notes: { agency?: string; production?: string; dp?: string };
  decidedCount: number;
  banned: string[];
  busy: BusyKind;
  upPair: (k: keyof ChoicePairs, v: string) => void;
  upNote: (k: 'agency' | 'production' | 'dp', v: string) => void;
  onDecide: () => void;
}) {
  const { cp, notes, decidedCount, banned, busy, upPair, upNote, onDecide } = props;
  return (
    <>
      <section className="pp-panel">
        <div className="pp-panel__head">
          <span className="pp-panel__title">The six choice-pairs</span>
          <span className="pp-panel__ar ppt-en">the heart of the document — decided before any descriptive sentence</span>
          <span className="pp-panel__spacer" />
          <span className={`ppt-counter mono-label ${decidedCount === 6 ? 'is-full' : ''}`}>{decidedCount}/6 decided</span>
          {busy === 'six'
            ? <Busy label="Deciding…" />
            : <button className="pp-btn pp-btn--accent" onClick={onDecide} type="button">Decide all six</button>}
        </div>

        {banned.length > 0 && (
          <div className="pp-error">
            Vague mood words rejected ({banned.join(' · ')}) — name the source, temperature, and angle. These words lose pitches silently.
          </div>
        )}

        <div className="ppt-pairs">
          {PAIRS.map(p => (
            <div key={p.key} className={`ppt-pair ${(cp[p.key] ?? '').trim() ? 'is-decided' : ''}`}>
              <div className="ppt-pair__label">
                <span className="mono-label">{p.label}</span>
                <span className="ppt-pair__sub">{p.either}</span>
              </div>
              <input
                className="pp-input pp-input--ar"
                value={cp[p.key] ?? ''}
                onChange={e => upPair(p.key, e.target.value)}
                placeholder="The decision — plus a one-line reason"
              />
            </div>
          ))}
        </div>
      </section>

      <section className="pp-panel">
        <div className="pp-panel__head">
          <span className="pp-panel__title">One section, three readers</span>
          <span className="pp-panel__ar ppt-en">agency · production · DP</span>
        </div>
        <div className="ppt-stance">
          <Field label="Agency reads the feel" hint="What will the person who signs feel?">
            <textarea
              className="pp-textarea pp-textarea--ar"
              value={notes.agency ?? ''}
              onChange={e => upNote('agency', e.target.value)}
              placeholder="What the agency reads as the feel (Arabic)"
            />
            <ArText text={notes.agency} />
          </Field>
          <Field label="Production reads the cost" hint="What do these decisions mean for schedule and budget?">
            <textarea
              className="pp-textarea pp-textarea--ar"
              value={notes.production ?? ''}
              onChange={e => upNote('production', e.target.value)}
              placeholder="What production reads as the cost (Arabic)"
            />
            <ArText text={notes.production} />
          </Field>
          <Field label="DP reads the expectation" hint="What will literally be asked of the DP?">
            <textarea
              className="pp-textarea pp-textarea--ar"
              value={notes.dp ?? ''}
              onChange={e => upNote('dp', e.target.value)}
              placeholder="What the DP reads as expected of them (Arabic)"
            />
            <ArText text={notes.dp} />
          </Field>
        </div>
      </section>
    </>
  );
}

// ─── Step 4 — CRAFT ─────────────────────────────────────────────────────────

function StepCraft(props: {
  data: TreatmentData;
  busy: BusyKind;
  negDraft: string;
  setNegDraft: (v: string) => void;
  addNegative: () => void;
  negatives: string[];
  upWardrobe: (p: Partial<NonNullable<TreatmentData['wardrobe']>>) => void;
  upPost: (p: Partial<NonNullable<TreatmentData['post']>>) => void;
  update: (p: Partial<TreatmentData>) => void;
  onDraftFrames: () => void;
}) {
  const { data, busy, negDraft, setNegDraft, addNegative, negatives, upWardrobe, upPost, update, onDraftFrames } = props;
  const cgiOn = data.post?.cgiRestraint !== false;
  return (
    <>
      <section className="pp-panel">
        <div className="pp-panel__head">
          <span className="pp-panel__title">Wardrobe</span>
          <span className="pp-panel__ar ppt-en">wardrobe is character — each piece by what it says about its background</span>
        </div>
        <Field
          label="Pieces"
          hint="Gulf fluency: regional thobe cuts differ; abaya 2026 runs black → navy/charcoal/taupe; no cultural mashup."
        >
          <textarea
            className="pp-textarea pp-textarea--ar ppt-tall"
            value={data.wardrobe?.pieces ?? ''}
            onChange={e => upWardrobe({ pieces: e.target.value })}
            placeholder="Every piece: type + material + color + condition — e.g. a matte navy crepe abaya, pressed but not crisp, previously worn (Arabic)"
          />
          <ArText text={data.wardrobe?.pieces} />
        </Field>
        <Field label="Negatives" hint="What it is NOT — declared, against the stock-thobe drift.">
          <div className="pp-chiprow ppt-negs">
            {negatives.map(n => (
              <button
                key={n}
                className="pp-chip pp-chip--ar is-on ppt-neg"
                onClick={() => upWardrobe({ negatives: negatives.filter(x => x !== n) })}
                title="Remove"
                type="button"
              >{n} ×</button>
            ))}
            <input
              className="pp-input pp-input--ar ppt-neg-input"
              value={negDraft}
              onChange={e => setNegDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNegative(); } }}
              placeholder="e.g. no glossy silk — then Enter"
            />
            <button className="pp-btn pp-btn--ghost" onClick={addNegative} type="button">Add</button>
          </div>
          {negatives.length > 0 && (
            <div className="ppt-negs-ar">
              {negatives.map(n => <ArText key={n} text={n} className="ppt-negs-ar__line" />)}
            </div>
          )}
        </Field>
      </section>

      <section className="pp-panel">
        <div className="pp-panel__head">
          <span className="pp-panel__title">Post</span>
          <span className="pp-panel__ar ppt-en">at a depth matching the room's energy</span>
        </div>
        <div className="ppt-stance">
          <Field label="Edit">
            <textarea
              className="pp-textarea pp-textarea--ar"
              value={data.post?.edit ?? ''}
              onChange={e => upPost({ edit: e.target.value })}
              placeholder="Cut rhythm, match cuts… (Arabic)"
            />
            <ArText text={data.post?.edit} />
          </Field>
          <Field label="Grade">
            <textarea
              className="pp-textarea pp-textarea--ar"
              value={data.post?.grade ?? ''}
              onChange={e => upPost({ grade: e.target.value })}
              placeholder='Grade logic — era inherits its medium: 1987 = 16mm skin, never "vintage" (Arabic)'
            />
            <ArText text={data.post?.grade} />
          </Field>
          <Field label="CGI restraint" hint="CGI only in the measure that clarifies — too much confuses.">
            <button
              className={`pp-chip ppt-toggle ${cgiOn ? 'is-on' : ''}`}
              onClick={() => upPost({ cgiRestraint: !cgiOn })}
              type="button"
            >
              {cgiOn ? 'Restraint ON — too much confuses' : 'Restraint OFF'}
            </button>
          </Field>
        </div>
      </section>

      <section className="pp-panel">
        <div className="pp-panel__head">
          <span className="pp-panel__title">First frame / last frame</span>
          <span className="pp-panel__ar ppt-en">the full 8-element diagnostic — "implied" means rewrite</span>
          <span className="pp-panel__spacer" />
          {busy === 'frames'
            ? <Busy label="Drafting the frames…" />
            : <button className="pp-btn pp-btn--accent" onClick={onDraftFrames} type="button">Draft the frames</button>}
        </div>

        <Field label="First frame" hint="The first frame is a promise.">
          <textarea
            className="pp-textarea pp-textarea--ar ppt-frame"
            value={data.firstFrame ?? ''}
            onChange={e => update({ firstFrame: e.target.value })}
            placeholder="e.g. dawn +20 minutes, a Malaz house kitchen, 4:3, key light an east-facing window… (Arabic)"
          />
          <ArText text={data.firstFrame} />
        </Field>
        <FrameChecklist frame={data.firstFrame} />

        <Field label="Last frame" hint="The last frame is what the viewer carries out of the feed.">
          <textarea
            className="pp-textarea pp-textarea--ar ppt-frame"
            value={data.lastFrame ?? ''}
            onChange={e => update({ lastFrame: e.target.value })}
            placeholder="e.g. maghrib, the same street now lit… (Arabic)"
          />
          <ArText text={data.lastFrame} />
        </Field>
        <FrameChecklist frame={data.lastFrame} />
      </section>
    </>
  );
}

function FrameChecklist({ frame }: { frame: string | undefined }) {
  const t = frame ?? '';
  const empty = !t.trim();
  return (
    <div className="ppt-check">
      {FRAME_ELEMENTS.map(e => {
        const ok = !empty && e.test(t);
        return (
          <span key={e.key} className={`ppt-check__item ${ok ? 'is-ok' : 'is-miss'}`}>
            <span className="ppt-check__dot">{ok ? '●' : '○'}</span>{e.label}
          </span>
        );
      })}
    </div>
  );
}

// ─── Step 5 — PAGE-PLAN ─────────────────────────────────────────────────────

function StepPagePlan(props: {
  plan: PagePlanRow[];
  preset: 8 | 25 | 50;
  busy: BusyKind;
  setRow: (i: number, p: Partial<PagePlanRow>) => void;
  addRow: () => void;
  removeRow: (i: number) => void;
  moveRow: (i: number, d: -1 | 1) => void;
  onDraft: () => void;
}) {
  const { plan, preset, busy, setRow, addRow, removeRow, moveRow, onDraft } = props;
  const target = preset === 8 ? '~7' : preset === 50 ? '~20' : '~12';
  return (
    <section className="pp-panel">
      <div className="pp-panel__head">
        <span className="pp-panel__title">Page-plan</span>
        <span className="pp-panel__ar ppt-en">one image and at most two short paragraphs per page</span>
        <span className="pp-panel__spacer" />
        <span className="ppt-counter mono-label">{plan.length} rows · target {target} for {preset}p</span>
        {busy === 'plan'
          ? <Busy label="Drafting the page-plan…" />
          : <button className="pp-btn pp-btn--accent" onClick={onDraft} type="button">Draft the page-plan</button>}
      </div>

      {plan.length === 0 && (
        <div className="ppt-plan-empty mono-label">No rows yet — Draft the page-plan, or add rows by hand.</div>
      )}

      <div className="ppt-plan">
        {plan.map((row, i) => (
          <div key={i} className="ppt-plan__row">
            <div className="ppt-plan__ctrl">
              <span className="ppt-plan__n mono-label">{i + 1}</span>
              <button className="ppt-rowbtn" onClick={() => moveRow(i, -1)} disabled={i === 0} title="Move up" type="button">↑</button>
              <button className="ppt-rowbtn" onClick={() => moveRow(i, 1)} disabled={i === plan.length - 1} title="Move down" type="button">↓</button>
              <button className="ppt-rowbtn ppt-rowbtn--x" onClick={() => removeRow(i)} title="Remove" type="button">×</button>
            </div>
            <div className="ppt-plan__cells">
              <input
                className="pp-input ppt-plan__section"
                value={row.section}
                onChange={e => setRow(i, { section: e.target.value })}
                placeholder="SECTION — COVER / APPROACH / IDEA / VISUALS…"
              />
              <textarea
                className="pp-textarea pp-textarea--ar ppt-plan__text"
                value={row.text}
                onChange={e => setRow(i, { text: e.target.value })}
                placeholder="Page body — at most two short paragraphs (Arabic)"
              />
              <ArText text={row.text} />
              <input
                className="pp-input ppt-plan__spec"
                value={row.imageSpec}
                onChange={e => setRow(i, { imageSpec: e.target.value })}
                placeholder="Image spec — the page's single image: shot size, temperature, hour, people count"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="ppt-plan__foot">
        <button className="pp-btn pp-btn--ghost" onClick={addRow} type="button">Add a row</button>
        <span className="ppt-plan__note">This plan feeds Pitch; imageSpecs feed References.</span>
      </div>
    </section>
  );
}
