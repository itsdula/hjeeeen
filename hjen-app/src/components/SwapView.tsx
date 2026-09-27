import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Quality, ModelId } from '../types/catalog';
import type { ProjectFileEntry } from '../types/hjen-bridge';
import { MODELS } from '../lib/models';
import { hjenFileUrl } from '../lib/theme/apply';
import { eyeRead } from '../lib/eye/engine';
import { swapSlots, swapConsequence, swapPlan } from '../lib/swap/engine';
import { SWAP_SLOTS, slotLabel, emptyDecisions } from '../lib/swap/types';
import type {
  FrameSlots, SlotDecisions, SlotKey, Requirement, Verdict, Conflict,
  SwapDoc, SwapSession, SavedRun, SavedTake,
} from '../lib/swap/types';
import type { EyeRead } from '../lib/eye/types';
import { resolveFollows, blastRadius } from '../lib/swap/deps';
import { toRequirements, conflictCheck } from '../lib/swap/ledger';
import { lockPlanFor } from '../lib/swap/lock';
import { loadSwapDoc, saveSession, deleteSession, sessionForSource, newSessionId, sessionTitle } from '../lib/swap/doc';
import { ProjectAssetPicker } from './ProjectAssetPicker';
import '../styles/angles.css';
import '../styles/swap.css';

// The Swap. One frame in, the same frame back with the listed changes in it —
// all of them, checked.
//
// Three columns because the tool is three questions: what am I re-shooting
// (left), what changes (middle), did it actually land (right). The right column
// is what makes this different from a prompt box: every take carries a verdict
// per requirement, and anything that missed was re-driven before it was shown.
//
// NOTHING IS PAID FOR WITHOUT A CLICK. Choosing a frame does not read it —
// reading costs two vision calls, and a file picker is not consent. The owner
// presses Read the frame.
//
// EVERY DECOMPOSITION IS KEPT. A session (frame + read + decisions + tests +
// takes) is written to <project>/_swap/swap.json and listed in the history
// strip. Reopening one restores it exactly and never re-reads — a read is paid
// for once. Picking a frame that already has a session reopens that session.
//
// UI copy is English only (house law). The Arabic that matters lives in the read.

const MAX_RUNS = 10;
const TAKES = [1, 2, 4] as const;

type TakeStatus = SavedTake['status'];
interface RunTake extends SavedTake { phase?: string }
interface Run extends Omit<SavedRun, 'takes' | 'model' | 'quality'> {
  model: ModelId; quality: Quality; takes: RunTake[];
}

const VERDICT_MARK: Record<string, string> = { landed: '✓', partial: '~', missed: '✗' };
const DEFAULTS = { model: 'GPT_IMAGE_2' as ModelId, quality: 'HIGH' as Quality, aspect: '16:9', count: 2 };

export function SwapView() {
  const setActiveView = useStore(s => s.setActiveView);
  const makeSwapFrame = useStore(s => s.makeSwapFrame);
  const openPreview = useStore(s => s.openPreview);
  const activeProject = useStore(s => s.activeProject());
  const projectId = activeProject?.id ?? null;

  // ── the project's decompositions ──────────────────────────────────────────
  const [doc, setDoc] = useState<SwapDoc | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // ── the open session's live state ─────────────────────────────────────────
  const [srcPath, setSrcPath] = useState<string | null>(null);
  const [read, setRead] = useState<EyeRead | null>(null);
  const [slots, setSlots] = useState<FrameSlots | null>(null);
  const [thin, setThin] = useState<SlotKey[]>([]);
  const [decisions, setDecisions] = useState<SlotDecisions>(emptyDecisions);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [untestable, setUntestable] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [model, setModel] = useState<ModelId>(DEFAULTS.model);
  const [quality, setQuality] = useState<Quality>(DEFAULTS.quality);
  const [aspect, setAspect] = useState<string>(DEFAULTS.aspect);
  const [count, setCount] = useState<number>(DEFAULTS.count);

  const [reading, setReading] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** What the asset picker is currently choosing FOR — the source frame, or one
   *  slot's new value. Null when it is closed. */
  const [pickerFor, setPickerFor] = useState<'source' | SlotKey | null>(null);

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2400); };

  // Load this project's sessions on mount and on project switch.
  useEffect(() => {
    let cancelled = false;
    if (!projectId) { setDoc(null); return; }
    void loadSwapDoc(projectId).then(d => { if (!cancelled) setDoc(d); });
    return () => { cancelled = true; };
  }, [projectId]);

  // ── persistence ───────────────────────────────────────────────────────────
  // A ref of the live state, so the debounced writer never persists a snapshot
  // that React has already moved past.
  const live = useRef({ srcPath, read, slots, thin, decisions, tests, untestable, conflicts, runs, model, quality, aspect, count });
  live.current = { srcPath, read, slots, thin, decisions, tests, untestable, conflicts, runs, model, quality, aspect, count };

  const buildSession = (id: string, createdAt?: string): SwapSession | null => {
    const s = live.current;
    if (!s.srcPath) return null;
    return {
      id,
      createdAt: createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourcePath: s.srcPath,
      title: sessionTitle(s.read ?? undefined, s.srcPath),
      read: s.read ?? undefined,
      slots: s.slots ?? undefined,
      thin: s.thin,
      decisions: s.decisions,
      tests: s.tests,
      untestable: s.untestable,
      conflicts: s.conflicts,
      settings: { model: s.model, quality: s.quality, aspect: s.aspect, count: s.count },
      // the transient phase line is a spinner, not work — it is not persisted
      runs: s.runs.map(r => ({ ...r, takes: r.takes.map(({ phase, ...t }) => t) })),
    };
  };

  const persist = async (id: string | null = sessionId) => {
    if (!projectId || !id) return;
    const created = doc?.sessions.find(s => s.id === id)?.createdAt;
    const session = buildSession(id, created);
    if (!session) return;
    setDoc(await saveSession(projectId, session));
  };

  // Debounced autosave — a decision toggle must survive a crash, but not cost a
  // disk write per keystroke.
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!sessionId || !projectId || !srcPath) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void persist(); }, 700);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisions, tests, untestable, conflicts, runs, slots, model, quality, aspect, count, sessionId]);

  // ── opening / closing a session ───────────────────────────────────────────
  const openSession = (s: SwapSession) => {
    setSessionId(s.id);
    setSrcPath(s.sourcePath);
    setRead(s.read ?? null);
    setSlots(s.slots ?? null);
    setThin(s.thin ?? []);
    setDecisions(s.decisions ?? emptyDecisions());
    setTests(s.tests ?? {});
    setUntestable(s.untestable ?? []);
    setConflicts(s.conflicts ?? []);
    setModel((s.settings?.model as ModelId) ?? DEFAULTS.model);
    setQuality((s.settings?.quality as Quality) ?? DEFAULTS.quality);
    setAspect(s.settings?.aspect ?? DEFAULTS.aspect);
    setCount(s.settings?.count ?? DEFAULTS.count);
    // A take still 'making' was driven by a renderer that no longer exists.
    setRuns((s.runs ?? []).map(r => ({
      ...r, model: r.model as ModelId, quality: r.quality as Quality,
      takes: r.takes.map(t => t.status === 'making'
        ? { ...t, status: 'interrupted' as TakeStatus, message: 'Interrupted — the app closed mid-make.' }
        : t),
    })));
    setError(null);
  };

  const newFrame = () => {
    setSessionId(null); setSrcPath(null); setRead(null); setSlots(null); setThin([]);
    setDecisions(emptyDecisions()); setTests({}); setUntestable([]); setConflicts([]);
    setRuns([]); setError(null);
  };

  const chooseSource = (p: string) => {
    // Already decomposed? Return the owner to that work instead of charging him
    // for a second read of the same frame.
    const existing = doc ? sessionForSource(doc, p) : undefined;
    if (existing) { openSession(existing); flash('Reopened the decomposition you already made of this frame.'); return; }
    newFrame();
    setSrcPath(p);
  };
  const pickSourceFile = async () => {
    const picked = await window.hjen.pickImageFiles();
    if (picked?.[0]) chooseSource(picked[0]);
  };

  /** Every image this tool takes in comes through the studio's own picker first —
   *  the project's makes, its signed reference set, and the shared library with
   *  its categories. A raw file dialog is the fallback, not the front door: the
   *  frame you want is almost always one this studio already made or filed. */
  const onPicked = (paths: string[]) => {
    const p = paths[0];
    const target = pickerFor;
    setPickerFor(null);
    if (!p || !target) return;
    if (target === 'source') chooseSource(p);
    else setSlot(target, { refPath: p });
  };

  const removeSession = async (id: string) => {
    if (!projectId) return;
    setDoc(await deleteSession(projectId, id));
    if (id === sessionId) newFrame();
  };

  // ── read the frame — ONLY on an explicit click ────────────────────────────
  // Two passes, in order, never in parallel: the Eye reads the frame, then the
  // split re-reads only what the Eye fuses into one line plus the wardrobe it
  // has never looked at. The split is HANDED the read rather than shown the
  // image cold — re-reading a solved axis is how two passes drift apart.
  const readFrame = async () => {
    if (!srcPath) return;
    if (!projectId) { flash('Open a project first — a decomposition is saved with the project its takes land in.'); return; }
    setError(null);
    setReading('Reading the frame…');
    const eye = await eyeRead({ imagePath: srcPath });
    if (!eye.ok || !eye.read) { setReading(null); setError(eye.message || 'The Eye could not read this frame.'); return; }
    setReading('Splitting the person…');
    const sp = await swapSlots({ imagePath: srcPath, read: eye.read });
    setReading(null);
    if (!sp.ok || !sp.slots) { setError(sp.message || 'The frame could not be split into slots.'); return; }

    setRead(eye.read);
    setSlots(sp.slots);
    setThin(sp.thin ?? []);
    // Persist immediately, not on the debounce: this is the expensive artifact,
    // and losing it to a crash means paying for it twice.
    const id = sessionId ?? newSessionId();
    setSessionId(id);
    live.current = { ...live.current, read: eye.read, slots: sp.slots, thin: sp.thin ?? [] };
    void persist(id);
  };

  // ── the decision map ──────────────────────────────────────────────────────
  const setSlot = (key: SlotKey, patch: Partial<SlotDecisions[SlotKey]>) => {
    setDecisions(prev => resolveFollows({ ...prev, [key]: { ...prev[key], ...patch } }));
  };
  /** THE STATE CHIP DOES ONE THING: it opens a slot for change, or closes it.
   *
   *  It used to cycle keep → swap → pin, which meant clicking a FOLLOWING row —
   *  the natural move when you want to author that value yourself — silently
   *  PINNED it instead. The owner ended up unable to change posture, hands, gaze,
   *  light or colour, and staring at six conflict warnings he never created.
   *  EVERY slot is swappable, from whatever state it is in. Pinning is a separate,
   *  deliberate act with its own control. */
  const toggleSwap = (key: SlotKey) => {
    if (key === 'camera') { flash('A camera change is Camera Angles — that tool already owns the geometry.'); return; }
    const cur = decisions[key];
    if (cur.state === 'swap') { setDecisions(p => resolveFollows({ ...p, [key]: { state: 'keep' } })); return; }
    // A slot the read could not see is still the owner's to change — it just has
    // no read behind it to preserve against, and the row says so.
    setDecisions(p => resolveFollows({ ...p, [key]: { state: 'swap', value: cur.proposed ?? '' } }));
  };

  /** Hold a following slot exactly as it is, knowing the frame will read false —
   *  or let it follow again. Deliberate, never a side effect of a click. */
  const togglePin = (key: SlotKey) => {
    const cur = decisions[key];
    setDecisions(p => resolveFollows({
      ...p,
      [key]: cur.pinnedAgainstGraph
        ? { state: 'keep' }
        : { state: 'keep', pinnedAgainstGraph: true, becauseOf: cur.becauseOf },
    }));
  };

  const requirements = useMemo(
    () => toRequirements(decisions).map(r => ({ ...r, test: tests[r.id] ?? '' })),
    [decisions, tests],
  );
  const followed = useMemo(
    () => SWAP_SLOTS.map(s => s.key).filter(k => decisions[k].state === 'follow' && !decisions[k].proposed),
    [decisions],
  );
  const lock = useMemo(() => lockPlanFor(decisions), [decisions]);
  const pinConflicts = useMemo(() => conflictCheck(decisions, requirements), [decisions, requirements]);
  const radius = blastRadius(decisions);

  // ── the consequence pass (debounced) ──────────────────────────────────────
  const conseqTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!slots || !followed.length) return;
    if (conseqTimer.current) window.clearTimeout(conseqTimer.current);
    conseqTimer.current = window.setTimeout(async () => {
      const r = await swapConsequence({ slots, decisions });
      if (!r.ok || !r.follows) return;
      setDecisions(prev => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(r.follows!)) {
          const key = k as SlotKey;
          if (next[key]?.state === 'follow' && !next[key].proposed) next[key] = { ...next[key], proposed: v };
        }
        return next;
      });
    }, 900);
    return () => { if (conseqTimer.current) window.clearTimeout(conseqTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followed.join('|'), slots]);

  // ── the plan pass (debounced, before any make) ────────────────────────────
  const planTimer = useRef<number | null>(null);
  const planKey = requirements.map(r => `${r.slot}:${r.value}:${r.refPath ?? ''}`).join('|');
  useEffect(() => {
    if (!slots || !requirements.length) { setUntestable([]); setConflicts([]); return; }
    if (planTimer.current) window.clearTimeout(planTimer.current);
    planTimer.current = window.setTimeout(async () => {
      setPlanning(true);
      const r = await swapPlan({ slots, requirements });
      setPlanning(false);
      if (!r.ok) return;
      setTests(prev => ({ ...prev, ...r.tests }));
      setUntestable(r.untestable); setConflicts(r.conflicts);
    }, 1100);
    return () => { if (planTimer.current) window.clearTimeout(planTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, slots]);

  // ── fire ──────────────────────────────────────────────────────────────────
  const patchTake = (runId: string, key: string, patch: Partial<RunTake>) => {
    setRuns(prev => prev.map(r => r.id === runId
      ? { ...r, takes: r.takes.map(t => t.key === key ? { ...t, ...patch } : t) }
      : r));
  };

  const driveTake = async (run: Run, take: RunTake, snap: { slots: FrameSlots; decisions: SlotDecisions }, index: number) => {
    patchTake(run.id, take.key, { status: 'making', message: undefined, phase: 'starting' });
    const res = await makeSwapFrame({
      sourcePath: run.srcPath, slots: snap.slots, decisions: snap.decisions,
      requirements: run.requirements,
      quality: run.quality, aspect: run.aspect, model: run.model, index,
      // The frame is painted the MOMENT the round saves it — before the check
      // that follows, which is its own vision call. Waiting for the verdict to
      // show an image that already exists reads as a tool that stalled.
      onRound: info => patchTake(run.id, take.key, {
        ...(info.takePath ? { path: info.takePath, jsonPath: info.jsonPath, status: 'done' as TakeStatus } : null),
        ...(info.verdicts ? { verdicts: info.verdicts, rounds: info.round } : null),
        phase: info.takePath && !info.verdicts ? `round ${info.round} · checking what landed`
          : info.note || (info.phase === 'plates' ? 'building the structure plates'
          : info.phase === 'compose' ? `round ${info.round} · writing the contract`
          : info.phase === 'make' ? `round ${info.round} · making`
          : `round ${info.round} · checking`),
      }),
    });
    patchTake(run.id, take.key, res.ok
      ? { status: 'done', path: res.path, jsonPath: res.jsonPath, verdicts: res.verdicts, unresolved: res.unresolved, rounds: res.rounds, phase: undefined }
      : { status: 'error', message: res.message, phase: undefined });
    if (res.ok && res.lockKit) {
      setRuns(prev => prev.map(r => r.id === run.id ? { ...r, lockKit: res.lockKit, lockReason: res.lockReason } : r));
    }
    void persist();
  };

  const fire = () => {
    if (!srcPath || !slots) return;
    if (!requirements.length) { flash('Nothing is being changed yet — set at least one slot to SWAP.'); return; }
    const snap = { slots, decisions };
    const run: Run = {
      id: `run-${Date.now().toString(36)}`, at: Date.now(),
      srcPath, model, quality, aspect, requirements,
      takes: Array.from({ length: count }, (_, i) => ({ key: `t${i}`, status: 'making' as TakeStatus })),
    };
    setRuns(prev => [run, ...prev].slice(0, MAX_RUNS));
    // Every take fires at once and climbs its own ladder. A blend that lost the
    // face on take 1 is often a stranger on take 3 — that spread IS the
    // mitigation for the morph, so takes must not be serialised into a queue.
    run.takes.forEach((t, i) => { void driveTake(run, t, snap, i); });
  };

  const decomposed = !!srcPath && !!slots;
  const sessions = doc?.sessions ?? [];

  const takeToEntry = (run: Run, t: RunTake): ProjectFileEntry | null => {
    if (!t.path) return null;
    const base = (t.path.split('/').pop() || 'take').replace(/\.(png|jpe?g|webp)$/i, '');
    return {
      imgPath: t.path, thumbPath: t.path, jsonPath: t.jsonPath || '',
      dateFolder: '', baseName: base,
      promptTitle: run.requirements.map(r => `${r.id} ${slotLabel(r.slot)}`).join(' · '),
      ts: run.at,
    };
  };
  const openTake = (run: Run, take: RunTake) => {
    const entry = takeToEntry(run, take);
    if (!entry) return;
    const list = run.takes.map(t => takeToEntry(run, t)).filter((e): e is ProjectFileEntry => !!e);
    openPreview(entry, list.length ? list : [entry]);
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="ang swap">
      <div className="ang-bar">
        <button className="ang-back" onClick={() => setActiveView('studio')} title="Back to Studio">‹ Studio</button>
        <div className="ang-bar__head">
          <h2 className="ang-bar__title">The Swap</h2>
          <span className="ang-bar__lead">One frame. Change what you name, keep everything else — and every change is checked before it ships</span>
        </div>
        {srcPath && <button className="ang-btn ang-btn--ghost" onClick={newFrame}>+ New frame</button>}
      </div>

      <div className="ang-grid swap-grid">
        {/* ── left: the frame ─────────────────────────────────────────────── */}
        <aside className="ang-left">
          <div className="mono-label ang-eyebrow">Source frame<span className="ang-eyebrow__hint">the one you want back</span></div>
          {srcPath ? (
            <div className="ang-src">
              <img src={hjenFileUrl(srcPath)} alt="" />
              <div className="ang-src__acts">
                <button className="ang-btn" onClick={() => setPickerFor('source')}>Change frame</button>
                <button className="ang-btn ang-btn--ghost" onClick={pickSourceFile}>From a file</button>
                <button className="ang-btn ang-btn--ghost" onClick={newFrame}>Remove</button>
              </div>
            </div>
          ) : (
            <>
              <button className="ang-drop" onClick={() => setPickerFor('source')}>
                <span className="ang-drop__plus">＋</span>
                <span className="ang-drop__t">Choose the frame you want to change</span>
                <span className="ang-drop__sub">this project’s makes · its references · the library</span>
              </button>
              <button className="swap-row__file swap-src__file" onClick={pickSourceFile}>or a file from disk…</button>
            </>
          )}

          {/* Reading is paid for, so it waits for a click. */}
          {srcPath && !slots && (
            <>
              <button className="ang-btn ang-btn--accent swap-fire" disabled={!!reading} onClick={() => void readFrame()}>
                {reading || 'Read the frame'}
              </button>
              <p className="ang-help selectable">
                Two passes: the Eye reads the frame, then it is split into the thirteen things you can change. Paid for once and kept with the project.
              </p>
            </>
          )}
          {error && <p className="swap-note swap-note--bad selectable">{error}</p>}
          {!projectId && <p className="swap-note swap-note--warn selectable">No project is open. Open one first — a decomposition is saved with the project its takes land in.</p>}

          {decomposed && (
            <>
              <div className="ang-ctrl">
                <div className="mono-label ang-eyebrow">What holds it<span className="ang-eyebrow__hint">{lock.kit}</span></div>
                <p className="ang-help selectable">{lock.reason}</p>
              </div>

              <div className="ang-ctrl">
                <div className="mono-label ang-eyebrow">Takes<span className="ang-eyebrow__hint">per run</span></div>
                <div className="ang-count">
                  {TAKES.map(n => (
                    <button key={n} className={`ang-count__b${count === n ? ' is-on' : ''}`} onClick={() => setCount(n)}>{n}</button>
                  ))}
                </div>
                <p className="ang-help selectable">
                  A face swap blends as often as it replaces. More takes is how you get a stranger instead of a relative. Each take may cost up to three makes — the ladder re-drives whatever misses.
                </p>
              </div>

              <div className="ang-ctrl swap-settings">
                <div className="mono-label ang-eyebrow">Make settings</div>
                <select value={model} onChange={e => setModel(e.target.value as ModelId)}>
                  {Object.entries(MODELS).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
                </select>
                <select value={quality} onChange={e => setQuality(e.target.value as Quality)}>
                  {['LOW', 'MEDIUM', 'HIGH'].map(q => <option key={q} value={q}>{q}</option>)}
                </select>
                <select value={aspect} onChange={e => setAspect(e.target.value)}>
                  {['1:1', '4:5', '3:2', '16:9', '9:16', '21:9'].map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              <button className="ang-btn ang-btn--accent swap-fire" disabled={!requirements.length} onClick={fire}>
                Make {count} {count === 1 ? 'take' : 'takes'}
              </button>
              {radius > 3 && (
                <p className="swap-note swap-note--warn selectable">
                  {radius} slots are moving in one pass. Expect the ladder to run — the takes will re-drive whatever the model averages away.
                </p>
              )}
            </>
          )}

          {/* ── every decomposition in this project ─────────────────────── */}
          {sessions.length > 0 && (
            <div className="swap-hist">
              <div className="mono-label ang-eyebrow">
                Frames in this project<span className="ang-eyebrow__hint">{sessions.length}</span>
              </div>
              <div className="swap-hist__list">
                {sessions.map(s => {
                  const takes = s.runs.reduce((n, r) => n + r.takes.filter(t => t.status === 'done').length, 0);
                  const changes = Object.values(s.decisions ?? {}).filter((d: any) => d?.state === 'swap').length;
                  return (
                    <div key={s.id} className={`swap-hist__item${s.id === sessionId ? ' is-open' : ''}`}>
                      <button className="swap-hist__open" onClick={() => openSession(s)} title={s.sourcePath}>
                        <img src={hjenFileUrl(s.sourcePath)} alt="" />
                        <span className="swap-hist__meta">
                          <span className="swap-hist__title selectable">{s.title}</span>
                          <span className="swap-hist__sub">
                            {changes ? `${changes} change${changes === 1 ? '' : 's'}` : 'no changes yet'}
                            {takes ? ` · ${takes} take${takes === 1 ? '' : 's'}` : ''}
                          </span>
                        </span>
                      </button>
                      <button className="swap-hist__del" title="Forget this decomposition" onClick={() => void removeSession(s.id)}>×</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* ── middle: the slots ───────────────────────────────────────────── */}
        <section className="swap-mid">
          <div className="mono-label ang-eyebrow">
            The frame, in parts
            <span className="ang-eyebrow__hint">{decomposed ? 'keep · swap · follows' : 'not read yet'}</span>
          </div>
          {!decomposed && (
            <p className="ang-help selectable">
              {srcPath ? 'Press Read the frame on the left when you are ready. Nothing is read, and nothing is charged, until you do.'
                       : 'Choose a frame on the left, then read it. It comes apart into the thirteen things you can change.'}
            </p>
          )}
          {decomposed && slots && (
            <div className="swap-slots">
              {SWAP_SLOTS.map(({ key, en, hint }) => {
                const d = decisions[key];
                const isThin = thin.includes(key);
                return (
                  <div key={key} className={`swap-row is-${d.state}${d.pinnedAgainstGraph ? ' is-pinned' : ''}${isThin ? ' is-thin' : ''}`}>
                    <div className="swap-row__ctrl">
                      <button className="swap-row__state" onClick={() => toggleSwap(key)}
                        title={key === 'camera' ? 'A camera change belongs to Camera Angles' : d.state === 'swap' ? 'Stop changing this' : 'Change this'}>
                        {d.state === 'swap' ? 'SWAP' : d.state === 'follow' ? 'FOLLOWS' : d.pinnedAgainstGraph ? 'PINNED' : 'KEEP'}
                      </button>
                      {(d.state === 'follow' || d.pinnedAgainstGraph) && (
                        <button className="swap-row__pinbtn" onClick={() => togglePin(key)}
                          title={d.pinnedAgainstGraph ? 'Let it follow the change again' : 'Hold it exactly as it is'}>
                          {d.pinnedAgainstGraph ? 'let it follow' : 'hold it'}
                        </button>
                      )}
                    </div>
                    <div className="swap-row__body">
                      <div className="swap-row__head">
                        <span className="swap-row__name">{en}</span>
                        <span className="swap-row__hint">{hint}</span>
                      </div>
                      {d.state === 'keep' && !d.pinnedAgainstGraph && (
                        <p className="swap-row__now selectable">{slotText(slots, key) || <em>not visible in this frame</em>}</p>
                      )}
                      {d.state === 'swap' && (
                        <div className="swap-row__edit">
                          <textarea value={d.value ?? ''} rows={2}
                            placeholder={`What it becomes — ${hint}`}
                            onChange={e => setSlot(key, { value: e.target.value })} />
                          <div className="swap-row__refs">
                            {d.refPath
                              ? <>
                                  <img className="swap-row__ref" src={hjenFileUrl(d.refPath)} alt="" />
                                  <button className="ang-btn ang-btn--ghost" onClick={() => setSlot(key, { refPath: undefined })}>Drop image</button>
                                </>
                              : <>
                                  <button className="ang-btn" onClick={() => setPickerFor(key)}>Show it in an image</button>
                                  <button className="swap-row__file" onClick={async () => {
                                    const picked = await window.hjen.pickImageFiles();
                                    if (picked?.[0]) setSlot(key, { refPath: picked[0] });
                                  }}>or a file…</button>
                                </>}
                          </div>
                          {isThin && (
                            <p className="swap-row__thin selectable">
                              The read could not see this in the frame, so there is nothing behind it to preserve against — say plainly what should be there.
                            </p>
                          )}
                        </div>
                      )}
                      {d.state === 'follow' && (
                        <p className="swap-row__follow selectable">
                          <span className="swap-row__because">follows {slotLabel(d.becauseOf ?? 'time').toLowerCase()}</span>
                          {d.proposed || 'working out what it becomes…'}
                        </p>
                      )}
                      {d.pinnedAgainstGraph && d.becauseOf && (
                        <p className="swap-row__pin selectable">
                          Held as it is while {slotLabel(d.becauseOf).toLowerCase()} changes. The frame will read false — click again to release it.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── right: the ledger and the takes ─────────────────────────────── */}
        <section className="swap-right">
          <div className="mono-label ang-eyebrow">
            The change ledger
            <span className="ang-eyebrow__hint">{planning ? 'writing the tests…' : `${requirements.length} required`}</span>
          </div>
          {!requirements.length && <p className="ang-help selectable">Nothing is being changed yet. Set a slot to SWAP and it appears here as a numbered requirement with the test that proves it.</p>}
          {requirements.map(r => (
            <div key={r.id} className={`swap-req${untestable.includes(r.id) ? ' is-vague' : ''}`}>
              <span className="swap-req__id">{r.id}</span>
              <div>
                <p className="swap-req__what selectable"><b>{slotLabel(r.slot)}</b> — {r.value || 'the image attached'}</p>
                {r.test && <p className="swap-req__test selectable">{r.test}</p>}
                {untestable.includes(r.id) && <p className="swap-req__vague selectable">Too vague to check. Name what would actually be different in the frame, or this one ships unverified.</p>}
              </div>
            </div>
          ))}
          {[...pinConflicts, ...conflicts].map((c, i) => (
            <p key={i} className="swap-note swap-note--warn selectable"><b>{c.between.join(' + ')}</b> — {c.message}</p>
          ))}

          {runs.length > 0 && <div className="mono-label ang-eyebrow swap-runs__label">Takes<span className="ang-eyebrow__hint">newest first</span></div>}
          {runs.map(run => (
            <div key={run.id} className="swap-run">
              <div className="swap-run__head selectable">
                {run.requirements.map(r => `${r.id} ${slotLabel(r.slot)}`).join(' · ')}
                <span className="swap-run__meta">{MODELS[run.model]?.label} · {run.quality} · {run.aspect}{run.lockKit ? ` · ${run.lockKit}` : ''}</span>
              </div>
              <div className="swap-run__takes">
                {run.takes.map(t => (
                  <div key={t.key} className={`swap-take is-${t.status}`}>
                    {t.status === 'done' && t.path && (
                      <button className="swap-take__img" onClick={() => openTake(run, t)}>
                        <img src={hjenFileUrl(t.path)} alt="" />
                      </button>
                    )}
                    {t.status === 'making' && <div className="swap-take__work selectable">{t.phase || 'making…'}</div>}
                    {t.status === 'done' && t.phase && <div className="swap-take__work selectable">{t.phase}</div>}
                    {(t.status === 'error' || t.status === 'interrupted') && (
                      <div className="swap-take__bad selectable">{t.message || 'This take did not make.'}</div>
                    )}
                    {t.verdicts && t.verdicts.length > 0 && (
                      <div className="swap-take__verdicts">
                        {t.verdicts.map(v => (
                          <span key={v.id} className={`swap-v is-${v.state}`} title={v.evidence}>{VERDICT_MARK[v.state]} {v.id}</span>
                        ))}
                        {typeof t.rounds === 'number' && t.rounds > 1 && (
                          <span className="swap-v is-rounds" title="How many makes the ladder needed">{t.rounds} rounds</span>
                        )}
                      </div>
                    )}
                    {t.unresolved && t.unresolved.length > 0 && (
                      <p className="swap-take__unresolved selectable">{t.unresolved.join(' · ')} never landed. The take ships as it is.</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>

      {toast && <div className="ang-toast selectable">{toast}</div>}
      {pickerFor && (
        <ProjectAssetPicker onClose={() => setPickerFor(null)} onAttach={onPicked} />
      )}
    </div>
  );
}

/** What a slot currently says, flattened for display. The structured slots read
 *  as one line here — the full grammar is what goes into the prompt, not what a
 *  person scans down a column. */
function slotText(f: FrameSlots, key: SlotKey): string {
  switch (key) {
    case 'camera': return [f.camera?.size, f.camera?.angle, `${f.camera?.height} height`, `${f.camera?.focal} lens`].filter(Boolean).join(' · ');
    case 'light': return [f.light?.key, f.light?.fill, f.light?.kelvin, f.light?.state].filter(Boolean).join(' · ');
    case 'colour': return f.colour?.behaviour || [f.colour?.dominant, f.colour?.second, f.colour?.accent].filter(Boolean).join(' / ');
    case 'objects': return (f.objects || []).join(' · ');
    default: return String((f as unknown as Record<string, unknown>)[key] ?? '');
  }
}
