import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type {
  HjenIdeaGraphOutput,
  HjenIdeaConceptFrame,
  HjenIdeaRunResponse,
  HjenIdeaStatus,
  HjenIdeaTake,
} from '../types/hjen-bridge';
import '../styles/idea.css';

type IdeaForm = {
  text: string;
  deliverable: 'idea_narration' | 'dialogue' | 'vo';
  duration: string;
  durationScope: 'film_runtime' | 'spoken_copy';
  voiceLoad: 'picture_led' | 'balanced' | 'copy_led';
  voiceLoadExplicit: boolean;
  wordLimit: string;
  brandName: string;
  offering: string;
  origin: string;
  ageBand: string;
  speakerRole: string;
  relationship: string;
  powerDistance: 'equal' | 'upward' | 'downward' | 'intimate';
  place: string;
  operationalState: string;
  immediatePressure: string;
  culturalTruth: string;
  insideState: string;
  speechAct: string;
  narrativeBeat: string;
  locale: 'saudi-neutral-spoken' | 'najdi-riyadh-light' | 'hijazi-jeddah-light';
  register: 'saudi-neutral-spoken' | 'saudi-institutional-spoken' | 'saudi-family-warm' | 'saudi-youth-banter' | 'saudi-national-elevated';
};

type IdeaFlowStage = 'scan' | 'collect' | 'develop' | 'finalize' | 'locked';
type CurationPart = 'dramatic_move' | 'idea_definition' | 'visual_logic' | 'saudi_insight' | 'copy';
type CurationPick = {
  id: string;
  takeId: string;
  routeName: string;
  part: CurationPart;
  label: string;
  value: string;
};

const EMPTY: IdeaForm = {
  text: '', deliverable: 'idea_narration', duration: '60s',
  durationScope: 'film_runtime', voiceLoad: 'picture_led', voiceLoadExplicit: false, wordLimit: '',
  brandName: '', offering: '', origin: '', ageBand: '', speakerRole: '',
  relationship: '', powerDistance: 'equal', place: '', operationalState: '',
  immediatePressure: '', culturalTruth: '', insideState: '', speechAct: '',
  narrativeBeat: '', locale: 'saudi-neutral-spoken', register: 'saudi-neutral-spoken',
};

const STORAGE_KEY = 'hjen.idea.form.v1';

const DELIVERY = [
  { id: 'idea_narration', ar: 'حكاية الفكرة', en: 'Idea narration' },
  { id: 'vo', ar: 'تعليق صوتي', en: 'Voice-over' },
  { id: 'dialogue', ar: 'حوار', en: 'Dialogue' },
] as const;

const REGISTER = [
  ['saudi-neutral-spoken', 'سعودي محايد'],
  ['saudi-family-warm', 'عائلي دافئ'],
  ['saudi-youth-banter', 'مزاح شبابي'],
  ['saudi-institutional-spoken', 'مؤسسي منطوق'],
  ['saudi-national-elevated', 'وطني مرتفع'],
] as const;

const GRAPH = [
  { ids: ['N0'], label: 'CONTRACT', ar: 'العقد' },
  { ids: ['N1'], label: 'BRIEF', ar: 'تفكيك البريف' },
  { ids: ['N2A', 'N2B', 'N2C'], label: '3× PLAN', ar: 'دليل · شخصية · صيغة' },
  { ids: ['N3'], label: 'SKEPTIC', ar: 'المشكّك' },
  { ids: ['N4'], label: 'VOICE PLAN', ar: 'خطة الصوت' },
  { ids: ['N5', 'N5C'], label: 'WRITE + FRAME', ar: 'النص · إطار الفكرة' },
  { ids: ['N6', 'N6S'], label: '2× JUDGE', ar: 'تحرير · طبيعية سعودية' },
  { ids: ['N7'], label: 'REWRITE', ar: 'إصلاح واحد' },
  { ids: ['N8'], label: 'DELIVER', ar: 'التسليم' },
] as const;

const FLOW_STEPS: Array<{ id: IdeaFlowStage; n: string; ar: string; en: string }> = [
  { id: 'scan', n: '01', ar: 'امسح', en: 'SCAN' },
  { id: 'collect', n: '02', ar: 'اجمع', en: 'COLLECT' },
  { id: 'develop', n: '03', ar: 'طوّر', en: 'DEVELOP' },
  { id: 'finalize', n: '04', ar: 'اعتمد', en: 'APPROVE' },
];

function routeParts(take: HjenIdeaTake, frame?: HjenIdeaConceptFrame): CurationPick[] {
  const routeName = frame?.route_name || take.dramatic_move || take.take_id;
  const values: Array<[CurationPart, string, string]> = [
    ['dramatic_move', 'الحركة الدرامية', take.dramatic_move],
    ['idea_definition', 'الفكرة', frame?.idea_definition || ''],
    ['visual_logic', 'المنطق البصري', frame?.visual_logic || ''],
    ['saudi_insight', 'المرتكز السعودي', frame?.saudi_insight || ''],
    ['copy', 'النص', take.copy],
  ];
  return values.filter(([, , value]) => value.trim()).map(([part, label, value]) => ({
    id: `${take.take_id}:${part}`,
    takeId: take.take_id,
    routeName,
    part,
    label,
    value: value.trim(),
  }));
}

function routeText(take: HjenIdeaTake, frame?: HjenIdeaConceptFrame): string {
  return routeParts(take, frame).map(part => `${part.label}: ${part.value}`).join('\n');
}

function loadForm(): IdeaForm {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const loaded = { ...EMPTY, ...(value && typeof value === 'object' ? value : {}) };
    if (!loaded.voiceLoadExplicit && loaded.deliverable === 'idea_narration' && loaded.durationScope === 'film_runtime') {
      loaded.voiceLoad = 'picture_led';
    }
    return loaded;
  } catch { return EMPTY; }
}

function displayCode(value?: string | null): string {
  return String(value || '—').replace(/-/g, ' ');
}

function formatMs(ms?: number): string {
  if (!ms) return '';
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function graphStepState(
  ids: readonly string[],
  busy: boolean,
  graph: HjenIdeaRunResponse['graph'],
): 'idle' | 'running' | 'done' | 'failed' | 'skipped' {
  if (busy) return 'running';
  const rows = ids.map(id => graph?.nodes?.[id]).filter(Boolean);
  if (!rows.length) return 'idle';
  if (rows.some(row => /fail|fatal|error|withhold/i.test(`${row?.status} ${row?.decision}`))) return 'failed';
  if (rows.every(row => /not-needed|skipped/i.test(`${row?.status} ${row?.decision}`))) return 'skipped';
  if (rows.every(row => /complete|pass|not-needed/i.test(`${row?.status} ${row?.decision}`))) return 'done';
  return 'idle';
}

export function IdeaView() {
  const setActiveView = useStore(s => s.setActiveView);
  const activeView = useStore(s => s.activeView);
  const [form, setForm] = useState<IdeaForm>(loadForm);
  const [status, setStatus] = useState<HjenIdeaStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState<HjenIdeaRunResponse | null>(null);
  const [flowStage, setFlowStage] = useState<IdeaFlowStage>('scan');
  const [picks, setPicks] = useState<Record<string, CurationPick>>({});
  const [anchorTakeId, setAnchorTakeId] = useState('');
  const [curationNote, setCurationNote] = useState('');
  const [developResponse, setDevelopResponse] = useState<HjenIdeaRunResponse | null>(null);
  const [developChoice, setDevelopChoice] = useState('');
  const [finalNote, setFinalNote] = useState('');
  const [finalResponse, setFinalResponse] = useState<HjenIdeaRunResponse | null>(null);
  const [expandedTakeId, setExpandedTakeId] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(form)); } catch { /* best effort */ }
  }, [form]);

  // Re-check when the tab becomes active: a user may have added their API key
  // in Settings while this keep-alive view stayed mounted.
  useEffect(() => {
    if (activeView !== 'idea') return;
    let live = true;
    setChecking(true);
    if (!window.hjen.ideaStatus) {
      setStatus({ ok: false, graphFound: false, pythonFound: false, auth: 'none', model: '', version: null, message: 'IDEA runs in the HJEN desktop app.' });
      setChecking(false);
      return;
    }
    window.hjen.ideaStatus()
      .then(value => { if (live) setStatus(value); })
      .catch(e => { if (live) setStatus({ ok: false, graphFound: false, pythonFound: false, auth: 'none', model: '', version: null, message: String(e?.message || e) }); })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [activeView]);

  const patch = <K extends keyof IdeaForm>(key: K, value: IdeaForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const selectDeliverable = (deliverable: IdeaForm['deliverable']) => {
    setForm(prev => ({
      ...prev,
      deliverable,
      ...(!prev.voiceLoadExplicit && deliverable === 'idea_narration' && prev.durationScope === 'film_runtime'
        ? { voiceLoad: 'picture_led' as const }
        : {}),
    }));
  };

  const selectVoiceLoad = (voiceLoad: IdeaForm['voiceLoad']) => {
    setForm(prev => ({ ...prev, voiceLoad, voiceLoadExplicit: true }));
  };

  const loadBrief = async () => {
    const picked = await window.hjen.pickTextDocument?.({ title: 'Load IDEA brief' });
    if (!picked) return;
    if (picked.unsupported || !picked.text.trim()) {
      setError(`تعذّر قراءة ${picked.name}. استخدم TXT أو MD، أو الصق البريف مباشرة.`);
      return;
    }
    patch('text', form.text.trim() ? `${form.text.trim()}\n\n${picked.text}` : picked.text);
    setError('');
  };

  const graphArgs = (text: string, takeCount: number) => {
    const wordLimit = Number(form.wordLimit || 0);
    return {
      text,
      deliverable: form.deliverable,
      concept_frame: form.deliverable === 'idea_narration',
      take_count: takeCount,
      length_or_duration: form.duration,
      duration_scope: form.durationScope,
      voice_load: form.voiceLoad,
      ...(Number.isFinite(wordLimit) && wordLimit > 0 ? { spoken_word_limit: wordLimit } : {}),
      brand: { name: form.brandName, offering: form.offering },
      speaker: { origin: form.origin, age_band: form.ageBand, role: form.speakerRole },
      listener: { relationship: form.relationship, power_distance: form.powerDistance },
      scene: {
        place: form.place, operational_state: form.operationalState,
        immediate_pressure: form.immediatePressure, cultural_truth_detail: form.culturalTruth,
      },
      inside_state: form.insideState,
      speech_act: form.speechAct,
      narrative_beat: form.narrativeBeat,
      requested_locale: form.locale,
      register_target: form.register,
    };
  };

  const run = async () => {
    if (busy || form.text.trim().length < 8) return;
    if (!window.hjen.ideaRun) { setError('IDEA runs in the HJEN desktop app.'); return; }
    setBusy(true); setError(''); setResponse(null);
    setFlowStage('scan'); setPicks({}); setAnchorTakeId(''); setCurationNote('');
    setDevelopResponse(null); setDevelopChoice(''); setFinalNote(''); setFinalResponse(null); setExpandedTakeId('');
    try {
      const res = await window.hjen.ideaRun(graphArgs(form.text.trim(), 3));
      setResponse(res);
      if (!res.ok) setError(res.message || 'تعذّر تشغيل الرسم. لم يُسلّم أي نص.');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally { setBusy(false); }
  };

  const togglePick = (pick: CurationPick) => {
    setPicks(current => {
      const next = { ...current };
      if (next[pick.id]) delete next[pick.id];
      else next[pick.id] = pick;
      return next;
    });
  };

  const developSelection = async () => {
    if (busy || !window.hjen.ideaRun || Object.keys(picks).length === 0) return;
    const anchor = takes.find(take => take.take_id === anchorTakeId);
    const anchorFrame = conceptFrames.find(frame => frame.take_id === anchorTakeId);
    const selected = Object.values(picks);
    const prompt = [
      form.text.trim(),
      '',
      'USER CURATION CONTRACT — DEVELOPMENT PASS',
      'The material below was explicitly selected by the user from an earlier graph pass. Treat it as user-authorized brief material, never as evidence and never as a finished answer.',
      anchor ? `ANCHOR DIRECTION:\n${routeText(anchor, anchorFrame)}` : 'ANCHOR DIRECTION: none; infer the cleanest center from the selected material.',
      `SELECTED MATERIAL:\n${selected.map(item => `[${item.routeName} / ${item.label}] ${item.value}`).join('\n')}`,
      `USER NOTE: ${curationNote.trim() || 'none'}`,
      'TASK: Make exactly two developed directions. Preserve the selected strengths, resolve contradictions, and refuse collage. Each direction must have one clean center and must still pass the full Saudi Ad Voice graph.',
    ].join('\n');
    setFlowStage('develop'); setBusy(true); setError(''); setDevelopResponse(null); setDevelopChoice(''); setFinalResponse(null);
    try {
      const res = await window.hjen.ideaRun(graphArgs(prompt, 2));
      setDevelopResponse(res);
      if (!res.ok) setError(res.message || 'تعذّر تطوير الاختيارات.');
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const finalizeSelection = async () => {
    const developed = developResponse?.result?.deliverable;
    const take = developed?.takes.find(item => item.take_id === developChoice);
    const frame = developed?.concept_frames?.find(item => item.take_id === developChoice);
    if (busy || !window.hjen.ideaRun || !take) return;
    const prompt = [
      form.text.trim(),
      '',
      'USER CURATION CONTRACT — FINAL PASS',
      'The user selected the direction below after comparing two developed routes. Treat it as the approved center, not as evidence and not as final copy.',
      `SELECTED DIRECTION:\n${routeText(take, frame)}`,
      `FINAL NOTE: ${finalNote.trim() || 'Keep the chosen center; tighten only what the graph requires.'}`,
      'TASK: Make exactly one final candidate. Preserve the selected center. Resolve only contradictions, Saudi naturalness, rhythm, and clarity. Do not reopen discarded routes and do not add a new concept.',
    ].join('\n');
    setFlowStage('finalize'); setBusy(true); setError(''); setFinalResponse(null);
    try {
      const res = await window.hjen.ideaRun(graphArgs(prompt, 1));
      setFinalResponse(res);
      if (!res.ok) setError(res.message || 'تعذّر صنع المرشح النهائي.');
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const output = response?.result;
  const takes = output?.deliverable?.takes || [];
  const conceptFrames = output?.deliverable?.concept_frames || [];
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key); window.setTimeout(() => setCopied(''), 1200);
    }).catch(() => setCopied(''));
  };
  const copyAll = () => copy('all', renderAll(output));
  const stageResponse = flowStage === 'develop'
    ? developResponse
    : (flowStage === 'finalize' || flowStage === 'locked') ? finalResponse : response;
  const verifiedDevelopedTake = developResponse?.result?.deliverable?.takes
    .find(item => item.take_id === developChoice);
  const verifiedDevelopedFrame = developResponse?.result?.deliverable?.concept_frames
    ?.find(item => item.take_id === developChoice);

  return (
    <div className="idea-view">
      <header className="idea-top">
        <button className="idea-back" onClick={() => setActiveView('apphub')}>← App</button>
        <div className="idea-brand">
          <span className="idea-brand__name">IDEA</span>
          <span className="idea-brand__sub mono-label">SAUDI AD VOICE · AGENT GRAPH</span>
        </div>
        <div className="idea-health" aria-label="IDEA runtime status">
          <Health ok={!!status?.graphFound} label="GRAPH" pending={checking} />
          <Health ok={!!status?.pythonFound} label="PYTHON" pending={checking} />
          <Health ok={status?.auth !== 'none'} label={status?.auth === 'gateway' ? 'HJEN ACCOUNT' : 'OPENAI'} pending={checking} />
        </div>
      </header>

      <div className="idea-body">
        <aside className="idea-input">
          <section className="idea-section idea-section--lead">
            <div className="idea-section__head">
              <div>
                <span className="idea-kicker mono-label">01 · OUTCOME</span>
                <h2>وش نكتب؟</h2>
              </div>
              <button className="idea-link" onClick={() => void loadBrief()}>Load brief</button>
            </div>
            <div className="idea-modes">
              {DELIVERY.map(item => (
                <button
                  key={item.id}
                  className={`idea-mode${form.deliverable === item.id ? ' is-on' : ''}`}
                  onClick={() => selectDeliverable(item.id)}
                >
                  <span dir="rtl">{item.ar}</span><small>{item.en}</small>
                </button>
              ))}
            </div>
            <label className="idea-field idea-field--brief">
              <span className="idea-label"><b>البريف</b><em>كل ما هو مؤكد فقط</em></span>
              <textarea
                value={form.text}
                onChange={e => patch('text', e.target.value)}
                placeholder="مثال: فيلم 60 ثانية لعائلة تنتظر الابن عند باب البيت. الصورة تحمل الحكاية، ونحتاج تعليقًا قليل الكلام…"
                dir="auto"
                spellCheck
              />
              <span className="idea-count mono-label">{form.text.trim().length.toLocaleString()} characters</span>
            </label>
          </section>

          <section className="idea-section">
            <span className="idea-kicker mono-label">02 · COMMERCIAL CONTRACT</span>
            <div className="idea-two">
              <Field label="اسم العلامة" note="اختياري" value={form.brandName} onChange={v => patch('brandName', v)} />
              <Field label="المنتج أو الخدمة" note="اختياري" value={form.offering} onChange={v => patch('offering', v)} />
            </div>
            <p className="idea-rule" dir="rtl">إذا غاب الاسم أو العرض، لن يخترع الرسم علامة أو فائدة أو CTA.</p>
          </section>

          <section className="idea-section">
            <span className="idea-kicker mono-label">03 · VOICE LOAD</span>
            <div className="idea-three">
              <SelectField label="المدة" value={form.duration} onChange={v => patch('duration', v)} options={[
                ['30s', '30 ثانية'], ['60s', '60 ثانية'], ['90s', '90 ثانية'],
              ]} />
              <SelectField label="المدة تخص" value={form.durationScope} onChange={v => patch('durationScope', v as IdeaForm['durationScope'])} options={[
                ['film_runtime', 'الفيلم كامل'], ['spoken_copy', 'الكلام فقط'],
              ]} />
              <SelectField label="كثافة الصوت" value={form.voiceLoad} onChange={v => selectVoiceLoad(v as IdeaForm['voiceLoad'])} options={[
                ['picture_led', 'الصورة تقود'], ['balanced', 'متوازن'], ['copy_led', 'النص يقود'],
              ]} />
            </div>
            <div className="idea-two idea-two--later">
              <SelectField label="الـRegister" value={form.register} onChange={v => patch('register', v as IdeaForm['register'])} options={REGISTER.map(([v, l]) => [v, l])} />
              <SelectField label="النطاق المحلي" value={form.locale} onChange={v => patch('locale', v as IdeaForm['locale'])} options={[
                ['saudi-neutral-spoken', 'سعودي محايد'], ['najdi-riyadh-light', 'نجدي خفيف'], ['hijazi-jeddah-light', 'حجازي خفيف'],
              ]} />
            </div>
            <p className="idea-rule" dir="rtl">اللهجة تتبع أصل الشخصية. إذا لم يثبته البريف، يحيّدها الرسم تلقائيًا.</p>
          </section>

          <details className="idea-advanced">
            <summary><span>تفاصيل الشخصية واللحظة</span><small>تزيد الدقة، وليست مطلوبة للبدء</small></summary>
            <div className="idea-advanced__body">
              <div className="idea-three">
                <Field label="أصل المتكلم" value={form.origin} onChange={v => patch('origin', v)} />
                <Field label="العمر" value={form.ageBand} onChange={v => patch('ageBand', v)} />
                <Field label="الدور" value={form.speakerRole} onChange={v => patch('speakerRole', v)} />
              </div>
              <div className="idea-two">
                <Field label="العلاقة بالمستمع" value={form.relationship} onChange={v => patch('relationship', v)} />
                <SelectField label="مسافة السلطة" value={form.powerDistance} onChange={v => patch('powerDistance', v as IdeaForm['powerDistance'])} options={[
                  ['equal', 'متساوية'], ['intimate', 'حميمية'], ['upward', 'إلى أعلى'], ['downward', 'إلى أسفل'],
                ]} />
              </div>
              <div className="idea-two">
                <Field label="المكان" value={form.place} onChange={v => patch('place', v)} />
                <Field label="حالته التشغيلية" value={form.operationalState} onChange={v => patch('operationalState', v)} />
              </div>
              <Field label="الضغط اللحظي" value={form.immediatePressure} onChange={v => patch('immediatePressure', v)} />
              <Field label="الحالة الداخلية" value={form.insideState} onChange={v => patch('insideState', v)} />
              <div className="idea-two">
                <Field label="الفعل الكلامي" value={form.speechAct} onChange={v => patch('speechAct', v)} />
                <Field label="الحقيقة الثقافية" value={form.culturalTruth} onChange={v => patch('culturalTruth', v)} />
              </div>
              <Field label="الضربة الدرامية" value={form.narrativeBeat} onChange={v => patch('narrativeBeat', v)} />
              <Field label="حد كلمات مباشر" note="يعلو على تقدير المدة" value={form.wordLimit} onChange={v => patch('wordLimit', v.replace(/\D/g, '').slice(0, 3))} />
            </div>
          </details>

          {!checking && status && !status.ok && (
            <div className="idea-blocker" role="alert">
              <b>IDEA ليست جاهزة على هذا الجهاز.</b>
              <span>{status.message}</span>
              {status.auth === 'none' && <button onClick={() => setActiveView('settings')}>Open Settings</button>}
            </div>
          )}
          {error && <div className="idea-error" role="alert">{error}</div>}

          <button
            className="idea-make"
            disabled={busy || checking || !status?.ok || form.text.trim().length < 8}
            onClick={() => void run()}
          >
            <span>{busy ? 'الرسم يعمل…' : 'اصنع 3 مسارات'}</span>
            <small>{busy ? 'N0 → N8 · لا تغلق التطبيق' : 'MAKE WITH SAUDI AD VOICE'}</small>
          </button>
        </aside>

        <main className="idea-output" aria-busy={busy} aria-live="polite">
          <GraphRail busy={busy} graph={stageResponse?.graph} />

          {!busy && output?.deliverable && (
            <FlowRail stage={flowStage} onStep={stage => {
              if (stage === 'scan') setFlowStage('scan');
              if (stage === 'collect' && Object.keys(picks).length > 0) setFlowStage('collect');
              if (stage === 'develop' && developResponse?.result?.deliverable) setFlowStage('develop');
              if (stage === 'finalize' && finalResponse?.result?.deliverable) setFlowStage('finalize');
            }} />
          )}

          {!busy && !output && !error && (
            <div className="idea-empty">
              <span className="idea-empty__num">03</span>
              <h1 dir="rtl">ثلاث طرق.<br />ولا جملة تمرّ وحدها.</h1>
              <p dir="rtl">
                الرسم يفصل الدليل عن الشخصية، والكاتب عن المشكّك، والمحرر عن حكم الطبيعية السعودية.
                إذا بقي خطأ قاتل بعد الإصلاح الوحيد، يحجب النص.
              </p>
              <div className="idea-empty__laws">
                <span>3–9 كلمات للجملة</span><span>12 حد أقصى</span><span>لا اختراع للـCTA</span><span>لا خلط مناطقي</span>
              </div>
            </div>
          )}

          {busy && <Running />}

          {!busy && flowStage === 'scan' && output?.deliverable && (
            <ScanWorkspace
              output={output}
              response={response}
              picks={picks}
              anchorTakeId={anchorTakeId}
              expandedTakeId={expandedTakeId}
              onTogglePick={togglePick}
              onAnchor={setAnchorTakeId}
              onExpand={id => setExpandedTakeId(current => current === id ? '' : id)}
              onCollect={() => setFlowStage('collect')}
              onCopyAll={copyAll}
              copiedAll={copied === 'all'}
              onCopy={(take, frame) => copy(take.take_id, renderRoute(take, frame))}
              copied={copied}
            />
          )}

          {!busy && flowStage === 'collect' && output?.deliverable && (
            <CollectionBoard
              picks={Object.values(picks)}
              anchorTakeId={anchorTakeId}
              takes={takes}
              frames={conceptFrames}
              note={curationNote}
              onNote={setCurationNote}
              onRemove={id => setPicks(current => { const next = { ...current }; delete next[id]; return next; })}
              onBack={() => setFlowStage('scan')}
              onDevelop={() => void developSelection()}
            />
          )}

          {!busy && flowStage === 'develop' && developResponse?.result && (
            <DevelopmentWorkspace
              output={developResponse.result}
              response={developResponse}
              choice={developChoice}
              finalNote={finalNote}
              onChoice={setDevelopChoice}
              onFinalNote={setFinalNote}
              onBack={() => setFlowStage('collect')}
              onFinalize={() => void finalizeSelection()}
              onOpenSettings={() => setActiveView('settings')}
              onCopy={(take, frame) => copy(`dev:${take.take_id}`, renderRoute(take, frame))}
              copied={copied}
            />
          )}

          {!busy && (flowStage === 'finalize' || flowStage === 'locked') && finalResponse?.result && (
            <FinalWorkspace
              output={finalResponse.result}
              response={finalResponse}
              locked={flowStage === 'locked'}
              fallbackTake={verifiedDevelopedTake}
              fallbackFrame={verifiedDevelopedFrame}
              onBack={() => setFlowStage('develop')}
              onRetry={() => void finalizeSelection()}
              onLock={() => setFlowStage('locked')}
              onOpenSettings={() => setActiveView('settings')}
              onCopy={(take, frame) => copy(`final:${take.take_id}`, renderRoute(take, frame))}
              copied={copied}
            />
          )}

          {!busy && flowStage === 'scan' && output && !output.deliverable && (
            <Withheld output={output} onOpenSettings={() => setActiveView('settings')} />
          )}

          {!busy && stageResponse?.result?.honest_risk && (
            <div className="idea-risk"><b>Honest risk:</b><span>{stageResponse.result.honest_risk}</span></div>
          )}
        </main>
      </div>
    </div>
  );
}

function Health({ ok, label, pending }: { ok: boolean; label: string; pending?: boolean }) {
  return <span className={`idea-health__pill${pending ? ' is-pending' : ok ? ' is-ok' : ' is-off'}`}><i />{label}</span>;
}

function Field({ label, note, value, onChange }: { label: string; note?: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="idea-field">
      <span className="idea-label"><b>{label}</b>{note && <em>{note}</em>}</span>
      <input value={value} onChange={e => onChange(e.target.value)} dir="auto" />
    </label>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: readonly (readonly string[])[] }) {
  return (
    <label className="idea-field">
      <span className="idea-label"><b>{label}</b></span>
      <select value={value} onChange={e => onChange(e.target.value)} dir="rtl">
        {options.map(([id, text]) => <option value={id} key={id}>{text}</option>)}
      </select>
    </label>
  );
}

function GraphRail({ busy, graph }: { busy: boolean; graph: HjenIdeaRunResponse['graph'] }) {
  return (
    <div className={`idea-graph${busy ? ' is-running' : ''}`}>
      <div className="idea-graph__head">
        <span className="mono-label">THE OPERATING GRAPH</span>
        <span className="mono-label">N0—N8 · N6S INDEPENDENT</span>
      </div>
      <div className="idea-graph__line">
        {GRAPH.map((step, index) => {
          const state = graphStepState(step.ids, busy, graph);
          return (
            <div className={`idea-node is-${state}`} key={step.label} style={{ ['--idea-node-i' as any]: index }}>
              <i>{index + 1}</i><b>{step.label}</b><span dir="rtl">{step.ar}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FlowRail({ stage, onStep }: { stage: IdeaFlowStage; onStep: (stage: IdeaFlowStage) => void }) {
  const activeIndex = stage === 'locked' ? 3 : FLOW_STEPS.findIndex(item => item.id === stage);
  return (
    <nav className="idea-flow" aria-label="IDEA curation flow">
      {FLOW_STEPS.map((step, index) => (
        <button
          key={step.id}
          className={`${index === activeIndex ? 'is-active' : ''}${index < activeIndex ? ' is-done' : ''}`}
          onClick={() => onStep(step.id)}
        >
          <i>{index < activeIndex ? '✓' : step.n}</i>
          <span dir="rtl">{step.ar}</span>
          <small>{step.en}</small>
        </button>
      ))}
    </nav>
  );
}

function ScanWorkspace({
  output, response, picks, anchorTakeId, expandedTakeId,
  onTogglePick, onAnchor, onExpand, onCollect, onCopyAll, copiedAll, onCopy, copied,
}: {
  output: HjenIdeaGraphOutput;
  response: HjenIdeaRunResponse | null;
  picks: Record<string, CurationPick>;
  anchorTakeId: string;
  expandedTakeId: string;
  onTogglePick: (pick: CurationPick) => void;
  onAnchor: (takeId: string) => void;
  onExpand: (takeId: string) => void;
  onCollect: () => void;
  onCopyAll: () => void;
  copiedAll: boolean;
  onCopy: (take: HjenIdeaTake, frame?: HjenIdeaConceptFrame) => void;
  copied: string;
}) {
  const deliverable = output.deliverable!;
  const selectedCount = Object.keys(picks).length;
  return (
    <>
      <ResultHeader output={output} response={response} onCopyAll={onCopyAll} copied={copiedAll} />
      {output.quality_warning && <QualityWarning output={output} />}
      <div className="idea-scan-intro" dir="rtl">
        <div><b>لا تختار مسارًا كاملًا الآن.</b><span>امسح الثلاثة، وخذ فقط الأجزاء التي تستحق التطوير.</span></div>
        <span className="mono-label">SELECT PARTS · MIXING IS ALLOWED · COLLAGE IS NOT</span>
      </div>
      <div className="idea-scan-grid">
        {deliverable.takes.map((take, index) => {
          const frame = deliverable.concept_frames?.find(item => item.take_id === take.take_id);
          const parts = routeParts(take, frame);
          const routeSelected = parts.filter(part => picks[part.id]).length;
          return (
            <article className={`idea-scan-card${anchorTakeId === take.take_id ? ' is-anchor' : ''}`} key={take.take_id}>
              <header>
                <span className="idea-take__num">0{index + 1}</span>
                <div><span className="mono-label">DIRECTION</span><h3 dir="auto">{frame?.route_name || take.dramatic_move}</h3></div>
                <button className={anchorTakeId === take.take_id ? 'is-on' : ''} onClick={() => onAnchor(anchorTakeId === take.take_id ? '' : take.take_id)}>
                  {anchorTakeId === take.take_id ? 'الأساس ✓' : 'اجعله الأساس'}
                </button>
              </header>
              <div className="idea-scan-card__parts" dir="rtl">
                {parts.map(part => (
                  <button className={picks[part.id] ? 'is-picked' : ''} key={part.id} onClick={() => onTogglePick(part)}>
                    <span><i>{picks[part.id] ? '✓' : '+'}</i><b>{part.label}</b></span>
                    <p>{part.value}</p>
                  </button>
                ))}
              </div>
              <footer>
                <span>{routeSelected ? `${routeSelected} مختارة` : 'لم تختر منه بعد'}</span>
                <button onClick={() => onExpand(take.take_id)}>{expandedTakeId === take.take_id ? 'إغلاق التفاصيل' : 'اقرأ كاملًا'}</button>
              </footer>
            </article>
          );
        })}
      </div>
      {expandedTakeId && (() => {
        const take = deliverable.takes.find(item => item.take_id === expandedTakeId);
        const frame = deliverable.concept_frames?.find(item => item.take_id === expandedTakeId);
        return take ? <div className="idea-scan-expanded"><TakeCard take={take} frame={frame} index={deliverable.takes.indexOf(take)} copied={copied === take.take_id} onCopy={() => onCopy(take, frame)} /></div> : null;
      })()}
      {output.failure_record && <PartialWithheld output={output} />}
      {output.presentation_warning && <ConceptWithheld />}
      <div className="idea-flow-dock" dir="rtl">
        <div><b>{selectedCount ? `${selectedCount} عناصر في السلة` : 'ابدأ بما شدّك.'}</b><span>{anchorTakeId ? 'حددت Direction أساس.' : 'الأساس اختياري؛ يمكن للرسم إيجاد المركز.'}</span></div>
        <button disabled={!selectedCount} onClick={onCollect}>راجع اختياراتك <i>←</i></button>
      </div>
    </>
  );
}

function CollectionBoard({ picks, anchorTakeId, takes, frames, note, onNote, onRemove, onBack, onDevelop }: {
  picks: CurationPick[];
  anchorTakeId: string;
  takes: HjenIdeaTake[];
  frames: HjenIdeaConceptFrame[];
  note: string;
  onNote: (value: string) => void;
  onRemove: (id: string) => void;
  onBack: () => void;
  onDevelop: () => void;
}) {
  const anchor = takes.find(item => item.take_id === anchorTakeId);
  const anchorFrame = frames.find(item => item.take_id === anchorTakeId);
  return (
    <div className="idea-collection">
      <header dir="rtl"><span className="idea-kicker mono-label">02 · COLLECT</span><h2>هذه ليست خلطة. هذه نية تحريرية.</h2><p>راجع ما اخترته. الرسم سيبحث عن مركز واحد، لا عن طريقة لحشر كل شيء.</p></header>
      {anchor && <div className="idea-anchor" dir="rtl"><span className="mono-label">ANCHOR DIRECTION</span><b>{anchorFrame?.route_name || anchor.dramatic_move}</b><p>{anchor.dramatic_move}</p></div>}
      <div className="idea-pick-list">
        {picks.map((pick, index) => (
          <article key={pick.id} dir="rtl">
            <i>{String(index + 1).padStart(2, '0')}</i>
            <div><span>{pick.routeName} · {pick.label}</span><p>{pick.value}</p></div>
            <button onClick={() => onRemove(pick.id)}>×</button>
          </article>
        ))}
      </div>
      <label className="idea-curation-note" dir="rtl">
        <span><b>ما الذي لا تريد أن يضيع؟</b><em>اختياري · جملة واحدة تكفي</em></span>
        <textarea value={note} onChange={event => onNote(event.target.value)} maxLength={500} placeholder="مثال: أبغى المفارقة تبقى هادئة، ولا يتحول الغبار إلى نكتة." />
      </label>
      <div className="idea-stage-actions"><button onClick={onBack}>← ارجع للمسح</button><button className="is-primary" disabled={!picks.length} onClick={onDevelop}>طوّر اختياراتي إلى مسارين</button></div>
    </div>
  );
}

function DevelopmentWorkspace({ output, response, choice, finalNote, onChoice, onFinalNote, onBack, onFinalize, onOpenSettings, onCopy, copied }: {
  output: HjenIdeaGraphOutput;
  response: HjenIdeaRunResponse;
  choice: string;
  finalNote: string;
  onChoice: (takeId: string) => void;
  onFinalNote: (value: string) => void;
  onBack: () => void;
  onFinalize: () => void;
  onOpenSettings: () => void;
  onCopy: (take: HjenIdeaTake, frame?: HjenIdeaConceptFrame) => void;
  copied: string;
}) {
  if (!output.deliverable) return <Withheld output={output} onOpenSettings={onOpenSettings} />;
  return (
    <div className="idea-development">
      <header dir="rtl"><span className="idea-kicker mono-label">03 · DEVELOP · {formatMs(response.ms)}</span><h2>مساران من اختياراتك، لا ثلاثة من الصفر.</h2><p>اختر الاتجاه الذي يستحق الجولة الأخيرة. هنا نختار مركزًا كاملًا، لا أجزاء جديدة.</p></header>
      {output.quality_warning && <QualityWarning output={output} />}
      <div className="idea-developed-grid">
        {output.deliverable.takes.map((take, index) => {
          const frame = output.deliverable?.concept_frames?.find(item => item.take_id === take.take_id);
          return <div className={`idea-developed-choice${choice === take.take_id ? ' is-chosen' : ''}`} key={take.take_id}>
            <button className="idea-choose" onClick={() => onChoice(take.take_id)}>{choice === take.take_id ? 'المسار المختار ✓' : 'اختر هذا المسار'}</button>
            <TakeCard take={take} frame={frame} index={index} copied={copied === `dev:${take.take_id}`} onCopy={() => onCopy(take, frame)} />
          </div>;
        })}
      </div>
      {output.failure_record && <PartialWithheld output={output} />}
      {choice && <label className="idea-curation-note" dir="rtl"><span><b>ملاحظة الجولة الأخيرة</b><em>اختياري · لا تعِد فتح الفكرة</em></span><textarea value={finalNote} onChange={event => onFinalNote(event.target.value)} maxLength={500} placeholder="مثال: اختصر النهاية، وحافظ على هدوء البداية." /></label>}
      <div className="idea-stage-actions"><button onClick={onBack}>← عدّل التجميع</button><button className="is-primary" disabled={!choice} onClick={onFinalize}>اصنع المرشح النهائي</button></div>
    </div>
  );
}

function FinalWorkspace({ output, response, locked, fallbackTake, fallbackFrame, onBack, onRetry, onLock, onOpenSettings, onCopy, copied }: {
  output: HjenIdeaGraphOutput;
  response: HjenIdeaRunResponse;
  locked: boolean;
  fallbackTake?: HjenIdeaTake;
  fallbackFrame?: HjenIdeaConceptFrame;
  onBack: () => void;
  onRetry: () => void;
  onLock: () => void;
  onOpenSettings: () => void;
  onCopy: (take: HjenIdeaTake, frame?: HjenIdeaConceptFrame) => void;
  copied: string;
}) {
  if (!output.deliverable) {
    return (
      <FinalRecovery
        output={output}
        fallbackTake={fallbackTake}
        fallbackFrame={fallbackFrame}
        onBack={onBack}
        onRetry={onRetry}
        onOpenSettings={onOpenSettings}
        onCopy={onCopy}
        copied={copied}
      />
    );
  }
  const take = output.deliverable.takes[0];
  const frame = output.deliverable.concept_frames?.find(item => item.take_id === take?.take_id);
  if (!take) return null;
  return (
    <div className={`idea-final${locked ? ' is-locked' : ''}`}>
      <header dir="rtl"><span className="idea-kicker mono-label">04 · {locked ? 'USER APPROVED' : output.quality_warning ? 'REVIEWABLE FINAL' : 'FINAL CANDIDATE'} · {formatMs(response.ms)}</span><h2>{locked ? 'هذا هو الاتجاه المعتمد.' : output.quality_warning ? 'المسار قابل للمراجعة. أذنك تحسمه.' : 'الـAI توقف هنا. القرار لك.'}</h2><p>{locked ? 'تم القفل بقرار المستخدم. أي تعديل بعده يفتح جولة جديدة.' : output.quality_warning ? 'اجتاز الفحص الحتمي والتحرير المستقل، وبقي حكم طبيعيّة عام. اقرأه بصوت مسموع قبل الاعتماد.' : 'اقرأه كاملًا. اعتماده فعل صريح؛ الوصول إلى هذه الشاشة لا يعني الموافقة.'}</p></header>
      {output.quality_warning && <QualityWarning output={output} />}
      <TakeCard take={take} frame={frame} index={0} copied={copied === `final:${take.take_id}`} onCopy={() => onCopy(take, frame)} />
      {output.presentation_warning && <ConceptWithheld />}
      <div className="idea-stage-actions"><button onClick={onBack}>← ارجع للمسارين</button><button className="is-primary" disabled={locked} onClick={onLock}>{locked ? 'معتمد ✓' : 'اعتماد هذا الاتجاه'}</button></div>
    </div>
  );
}

function Running() {
  return (
    <div className="idea-running">
      <div className="idea-running__mark"><i /><i /><i /></div>
      <span className="mono-label">SAUDI AD VOICE IS RUNNING</span>
      <h2 dir="rtl">الدليل يشتغل بعيدًا عن الكاتب.<br />والحكم ينتظر بعيدًا عن الاثنين.</h2>
      <p dir="rtl">يمكنك الانتقال إلى تبويب آخر. ستبقى العملية حية هنا حتى تكتمل.</p>
    </div>
  );
}

function ResultHeader({ output, response, onCopyAll, copied }: { output: HjenIdeaGraphOutput; response: HjenIdeaRunResponse | null; onCopyAll: () => void; copied: boolean }) {
  const count = output.deliverable?.takes.length || 0;
  const guarded = output.status.includes('guarded-pass');
  const title = guarded
    ? (count === 1 ? 'مسار واحد جاهز للمراجعة.' : `${count} مسارات جاهزة للمراجعة.`)
    : count === 1 ? 'نجا مسار واحد من الحكم.' : count === 2 ? 'نجا مساران من الحكم.' : 'نجت ثلاثة مسارات من الحكم.';
  return (
    <div className="idea-result-head">
      <div>
        <span className="idea-kicker mono-label">{guarded ? 'REVIEWABLE DRAFT' : output.status === 'partial-pass' ? 'PARTIAL PASS' : 'GRAPH PASS'} · {formatMs(response?.ms)} · {response?.model}</span>
        <h2 dir="rtl">{title}</h2>
      </div>
      <div className="idea-result-head__actions">
        <span>{displayCode(output.deliverable?.applied_locale)}</span>
        <span>{displayCode(output.deliverable?.register_target)}</span>
        <button onClick={onCopyAll}>{copied ? 'Copied' : 'Copy all'}</button>
      </div>
    </div>
  );
}

function QualityWarning({ output }: { output: HjenIdeaGraphOutput }) {
  const warning = output.quality_warning;
  if (!warning) return null;
  return (
    <aside className="idea-partial idea-quality-warning" dir="rtl">
      <div>
        <span className="mono-label">REVIEWABLE DRAFT · {warning.stage || 'FINAL CHECK'}</span>
        <b>لم نحجب النص بسبب حكم طبيعيّة بلا سطر محدد.</b>
        <p>الإصلاح اجتاز الفحص الحتمي والمحرر المستقل. بقيت ملاحظة سمعية عامة؛ لذلك يظهر كمسودة للمراجعة، لا كنص معتمد.</p>
      </div>
      {!!warning.advisory_codes?.length && (
        <div className="idea-quality-warning__codes">
          {warning.advisory_codes.map(code => <span key={code}>{displayCode(code)}</span>)}
        </div>
      )}
    </aside>
  );
}

function FinalRecovery({ output, fallbackTake, fallbackFrame, onBack, onRetry, onOpenSettings, onCopy, copied }: {
  output: HjenIdeaGraphOutput;
  fallbackTake?: HjenIdeaTake;
  fallbackFrame?: HjenIdeaConceptFrame;
  onBack: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onCopy: (take: HjenIdeaTake, frame?: HjenIdeaConceptFrame) => void;
  copied: string;
}) {
  const diagnosis = diagnoseFailure(output);
  const failure = output.failure_record;
  const codes = failure?.fatal_codes || (failure?.code ? [failure.code] : []);
  return (
    <div className="idea-final idea-final-recovery">
      <header dir="rtl">
        <span className="idea-kicker mono-label">04 · FINAL CHECK STOPPED · {failure?.stage || 'GRAPH'}</span>
        <h2>{fallbackTake ? 'الجولة الأخيرة توقفت. اختيارك ما ضاع.' : diagnosis.title}</h2>
        <p>{fallbackTake
          ? 'النسخة التي فشلت في التحقق محجوبة. أبقينا أدناه آخر مسار اجتاز الحكم قبل الجولة الأخيرة؛ ارجع للمسارين أو أعد محاولة التشذيب.'
          : diagnosis.body}</p>
      </header>
      <div className="idea-partial idea-final-recovery__status" dir="rtl">
        <div><b>{fallbackTake ? 'آخر نسخة متحققة' : diagnosis.kicker}</b><span>{fallbackTake ? 'هذه ليست النسخة الفاشلة، ولم ندخلها من باب خلفي.' : 'لا توجد نسخة سابقة متحققة لعرضها في هذه الجولة.'}</span></div>
        {!!codes.length && <div className="idea-withheld__codes">{codes.map(code => <span key={code}>{displayCode(code)}</span>)}</div>}
      </div>
      {fallbackTake && (
        <TakeCard
          take={fallbackTake}
          frame={fallbackFrame}
          index={0}
          copied={copied === `final:${fallbackTake.take_id}`}
          onCopy={() => onCopy(fallbackTake, fallbackFrame)}
        />
      )}
      <div className="idea-stage-actions">
        <button onClick={onBack}>← ارجع للمسارين</button>
        <div className="idea-final-recovery__actions">
          {diagnosis.openSettings && <button onClick={onOpenSettings}>Open Settings</button>}
          <button className="is-primary" onClick={onRetry}>أعد الجولة الأخيرة</button>
        </div>
      </div>
    </div>
  );
}

function PartialWithheld({ output }: { output: HjenIdeaGraphOutput }) {
  const failed = output.failure_record?.take_ids?.length || 0;
  const codes = output.failure_record?.fatal_codes || [];
  return (
    <div className="idea-partial" dir="rtl">
      <div><b>{failed === 1 ? 'حُجب مسار واحد.' : `حُجب ${failed} من المسارات.`}</b><span>المسارات الظاهرة أعلاه فقط هي التي نجت من التحقق النهائي.</span></div>
      {codes.length > 0 && <div className="idea-withheld__codes">{codes.map(code => <span key={code}>{displayCode(code)}</span>)}</div>}
    </div>
  );
}

function ConceptWithheld() {
  return (
    <div className="idea-partial" dir="rtl">
      <div>
        <b>حُجب إطار الفكرة، وليس النص.</b>
        <span>النص الظاهر اجتاز الحكم النهائي. Concept Frame لم يلتزم بعقده المستقل، لذلك لم يُرفق.</span>
      </div>
      <div className="idea-withheld__codes"><span>concept frame withheld</span></div>
    </div>
  );
}

function TakeCard({ take, frame, index, copied, onCopy }: { take: HjenIdeaTake; frame?: HjenIdeaConceptFrame; index: number; copied: boolean; onCopy: () => void }) {
  return (
    <article className="idea-take">
      <header>
        <span className="idea-take__num">0{index + 1}</span>
        <div>
          <span className="mono-label">DRAMATIC MOVE</span>
          <h3 dir="auto">{take.dramatic_move || `المسار ${index + 1}`}</h3>
        </div>
        <button onClick={onCopy}>{copied ? 'Copied' : 'Copy'}</button>
      </header>
      {frame && (
        <div className="idea-frame" dir="rtl">
          <div className="idea-frame__route">
            <span className="mono-label">CONCEPT FRAME</span>
            <h4>{frame.route_name}</h4>
          </div>
          <FrameField label="تعريف الفكرة" value={frame.idea_definition} />
          <FrameField label="المنطق البصري" value={frame.visual_logic} />
          <FrameField label="المرتكز السعودي" value={frame.saudi_insight} />
          <div className="idea-frame__field">
            <b>نرفض</b>
            <ul>{frame.refusals.map(item => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>
      )}
      <span className="idea-take__copy-label mono-label">SPOKEN / ON-SCREEN COPY</span>
      <div className="idea-take__copy selectable" dir="auto">{take.copy}</div>
    </article>
  );
}

function FrameField({ label, value }: { label: string; value: string }) {
  return <div className="idea-frame__field"><b>{label}</b><p>{value}</p></div>;
}

function Withheld({ output, onOpenSettings }: { output: HjenIdeaGraphOutput; onOpenSettings: () => void }) {
  const failure = output.failure_record;
  const codes = failure?.fatal_codes || (failure?.code ? [failure.code] : []);
  const diagnosis = diagnoseFailure(output);
  return (
    <div className="idea-withheld">
      <span className="idea-withheld__lock">×</span>
      <span className="idea-kicker mono-label">{diagnosis.kicker} · {failure?.stage || 'GRAPH'}</span>
      <h2 dir="rtl">{diagnosis.title}</h2>
      <p dir="rtl">{diagnosis.body}</p>
      <div className="idea-withheld__actions">
        {diagnosis.openSettings && <button onClick={onOpenSettings}>Open Settings</button>}
        {codes.length > 0 && <div className="idea-withheld__codes">{codes.map(code => <span key={code}>{displayCode(code)}</span>)}</div>}
      </div>
    </div>
  );
}

function diagnoseFailure(output: HjenIdeaGraphOutput): {
  kicker: string;
  title: string;
  body: string;
  openSettings: boolean;
} {
  const failure = output.failure_record;
  const raw = [failure?.code, failure?.detail, ...(failure?.fatal_codes || [])]
    .filter(Boolean).join(' ').toLowerCase();
  if (/credit_balance_exhausted|insufficient_quota|no credits remaining/.test(raw)) {
    return {
      kicker: 'OPENAI CREDIT REQUIRED',
      title: 'رصيد OpenAI انتهى.',
      body: 'أضف رصيدًا إلى حساب OpenAI المرتبط، أو استبدل المفتاح بمفتاح فعّال، ثم أعد التشغيل. البريف لم يدخل مرحلة الكتابة بعد.',
      openSettings: true,
    };
  }
  if (/invalid_api_key|incorrect api key|authentication/.test(raw)) {
    return {
      kicker: 'OPENAI KEY REQUIRED',
      title: 'مفتاح OpenAI غير صالح.',
      body: 'استبدل المفتاح من Settings ثم أعد التشغيل. IDEA حجبت الطلب قبل أن يبدأ الكاتب.',
      openSettings: true,
    };
  }
  if (/rate.?limit|too many requests/.test(raw)) {
    return {
      kicker: 'OPENAI RATE LIMIT',
      title: 'OpenAI أوقف الطلب مؤقتًا.',
      body: 'انتظر قليلًا ثم أعد التشغيل. لم يُسلّم الرسم نصًا ناقصًا.',
      openSettings: false,
    };
  }
  if (output.status === 'runtime-error') {
    return {
      kicker: 'GRAPH STOPPED',
      title: 'الرسم توقف قبل التسليم.',
      body: 'هذا عطل تشغيل، وليس حكمًا على الفكرة. راجع الاتصال والنموذج ثم أعد التشغيل.',
      openSettings: true,
    };
  }
  return {
    kicker: 'COPY WITHHELD',
    title: 'النص ما نجح. لذلك لن نجمّله ونسلّمه.',
    body: 'بقي خطأ قاتل بعد مسار الإصلاح المسموح. غيّر البريف أو خفّف التحديد المناطقي ثم أعد التشغيل.',
    openSettings: false,
  };
}

function renderAll(output?: HjenIdeaGraphOutput): string {
  if (!output?.deliverable) return '';
  const head = [
    `Locale: ${output.deliverable.applied_locale}`,
    `Register: ${output.deliverable.register_target}`,
    `Policy gate: ${output.deliverable.policy_gate}`,
    output.evidence_ids?.length ? `Evidence: ${output.evidence_ids.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  const body = output.deliverable.takes.map((take, index) => {
    const frame = output.deliverable?.concept_frames?.find(item => item.take_id === take.take_id);
    return `${String(index + 1).padStart(2, '0')} — ${take.dramatic_move || take.take_id}\n\n${renderRoute(take, frame)}`;
  }).join('\n\n———\n\n');
  const warning = output.presentation_warning
    ? '\n\nConcept Frame withheld: its independent contract did not pass.'
    : '';
  const qualityWarning = output.quality_warning
    ? `\n\nReviewable draft: ${output.quality_warning.advisory_codes?.map(displayCode).join(', ') || 'live read advised'}.`
    : '';
  return `${head}\n\n${body}${warning}${qualityWarning}\n\nHonest risk: ${output.honest_risk || '—'}`;
}

function renderRoute(take: HjenIdeaTake, frame?: HjenIdeaConceptFrame): string {
  const concept = frame ? [
    `إطار الفكرة: ${frame.route_name}`,
    `تعريف الفكرة: ${frame.idea_definition}`,
    `المنطق البصري: ${frame.visual_logic}`,
    `المرتكز السعودي: ${frame.saudi_insight}`,
    `نرفض: ${frame.refusals.join(' · ')}`,
    '',
  ] : [];
  return [...concept, 'النص المنطوق / المكتوب:', take.copy].join('\n');
}
