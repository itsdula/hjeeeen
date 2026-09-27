import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { Quality, ModelId } from '../types/catalog';
import type { ProjectFileEntry } from '../types/hjen-bridge';
import { MODELS } from '../lib/models';
import { hjenFileUrl } from '../lib/theme/apply';
import { proposeAngles, MAX_ANGLES } from '../lib/cameraAngles';
import { ProjectAssetPicker } from './ProjectAssetPicker';
import '../styles/angles.css';

// Camera Angles. One still scene in -> N genuinely-distinct camera angles out,
// each MADE through the existing Frame engine with the verbatim make template
// (only the [CAMERA ANGLE] token swapped). A make tool, so its chrome matches its
// siblings (Frame / Video / Cast): black ground, white ink, one ember accent,
// its own sky-blue identity tint. UI copy is English only.
//
// RUN-BATCH MODEL — the composer (source · angles · Film Space · settings) is
// NEVER blocked by making. Firing a make snapshots the composer into a RUN
// {id, source, aspect snapshot, model/quality snapshot, takes[]} appended to a
// bounded runs list. Old runs stream their takes independently; the user can
// change the source or the angles and fire another run immediately, in parallel.
// The only disabled state is a single take's OWN "Try again" while it is in flight.

type Mode = 'auto' | 'approve';

interface AngleRow { id: string; text: string; locked: boolean; custom: boolean }

// ── From Film Space — a locked Angle Pack read (read-only) from the project's
// FilmSpace/packs folder. The PLATE (Film Space frame) is the geometry anchor
// that lets gpt-image-2 render behind/overhead viewpoints it would otherwise
// refuse. camera.json is optional metadata; we only use it for a human readout
// on the tile.
interface PackCamera { vocab?: { shot_size?: string; angle?: string; lens_code?: string; lens_prime?: number }; lens?: { focal_mm?: number } }
interface LockedPack { packId: string; packDir: string; platePath: string; camera: PackCamera | null; prompt: string; previewFile: string | null; at: number }

// ── A RUN — one fired batch, snapshotted so it makes independently of the live
// composer. `kind` is the whole-run path; each take carries the minimal payload
// to re-fire ITSELF (angle text, or the pack plate + id) against the RUN's
// snapshot settings — never the current composer state.
type TakeStatus = 'making' | 'done' | 'error' | 'interrupted';
interface RunTake {
  key: string; kind: 'angle' | 'pack'; status: TakeStatus;
  angle: string; path?: string; jsonPath?: string; message?: string;
  platePath?: string; packId?: string;
}
interface Run {
  id: string; at: number; kind: 'angle' | 'pack';
  srcPath: string; srcAspect: string | null;
  model: ModelId; quality: Quality; aspect: string;
  takes: RunTake[];
  // For pack runs: the project the Angle Packs were pulled FROM (may differ from
  // the active project the takes SAVE into — cross-project Film Space reuse).
  packProject?: string;
}

/** A compact, honest readout from a pack's camera.json — falls back to '' when
 *  the pack carries no recognizable camera vocab (older/partial packs). */
function packReadout(cam: PackCamera | null): string {
  const v = cam?.vocab;
  if (!v) return '';
  const focal = cam?.lens?.focal_mm;
  return [v.shot_size, v.angle, focal ? `${focal}mm` : v.lens_code].filter(Boolean).join(' · ');
}

const QUALITIES: Quality[] = ['LOW', 'MED', 'HIGH'];
// Marker string — bumped for the run-batch model; also proves the shipped asar.
const LS_KEY = 'hjen_angles_runs_v2';
const FALLBACK_ASPECT = '16:9';
const MAX_RUNS = 10;

const rid = () => `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const toRow = (text: string, custom = false): AngleRow => ({ id: rid(), text, locked: false, custom });

/** Read the source image's REAL pixel dimensions → an exact "W:H" aspect string.
 *  resolveSize() computes aw/ah, so raw pixels give the true source aspect; every
 *  made angle then inherits it. Falls back to 16:9 if the image can't be read. */
function readSourceAspect(path: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? `${img.naturalWidth}:${img.naturalHeight}` : FALLBACK_ASPECT);
    img.onerror = () => resolve(FALLBACK_ASPECT);
    img.src = hjenFileUrl(path);
  });
}
/** Human-readable label for a raw "W:H" — gcd-reduced (2880:1800 → 8:5). */
function aspectLabel(asp: string | null): string {
  if (!asp) return '—';
  const [w, h] = asp.split(':').map(Number);
  if (!w || !h) return asp;
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(Math.round(w), Math.round(h));
  return `${Math.round(w) / d}:${Math.round(h) / d}`;
}

interface Persisted {
  srcPath: string | null; srcAspect: string | null; count: number; mode: Mode;
  model: ModelId; quality: Quality;
  rows: AngleRow[]; selectedPacks: string[]; runs: Run[];
}
function loadWork(): Persisted {
  const base: Persisted = { srcPath: null, srcAspect: null, count: 3, mode: 'auto', model: 'GPT_IMAGE_2', quality: 'HIGH', rows: [], selectedPacks: [], runs: [] };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p: Persisted = { ...base, ...JSON.parse(raw) };
      // Crash/quit reconciliation (mirrors the store's BgJob reconcile): any take
      // still 'making' was driven by a renderer that no longer exists — flip it to
      // 'interrupted' so it shows a Try again, never a stuck spinner.
      p.runs = (p.runs || []).slice(0, MAX_RUNS).map(run => ({
        ...run,
        takes: (run.takes || []).map(t => t.status === 'making'
          ? { ...t, status: 'interrupted' as const, message: 'Interrupted — the app restarted mid-make.' }
          : t),
      }));
      return p;
    }
  } catch { /* ignore */ }
  return base;
}

export function CameraAnglesView() {
  const setActiveView = useStore(s => s.setActiveView);
  const makeCameraAngleFrame = useStore(s => s.makeCameraAngleFrame);
  const makeCameraAngleFromPack = useStore(s => s.makeCameraAngleFromPack);
  const openPreview = useStore(s => s.openPreview);
  const activeProject = useStore(s => s.activeProject());
  const projects = useStore(s => s.projects);

  const [init] = useState(loadWork);
  const [srcPath, setSrcPath] = useState<string | null>(init.srcPath);
  const [srcAspect, setSrcAspect] = useState<string | null>(init.srcAspect);
  const [count, setCount] = useState(init.count);
  const [mode, setMode] = useState<Mode>(init.mode);
  const [model, setModel] = useState<ModelId>(init.model);
  const [quality, setQuality] = useState<Quality>(init.quality);
  const [rows, setRows] = useState<AngleRow[]>(init.rows);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // The runs list — every fired batch, newest first.
  const [runs, setRuns] = useState<Run[]>(init.runs);

  // ── From Film Space state ──
  const [packs, setPacks] = useState<LockedPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(false);
  const [packsError, setPacksError] = useState<string | null>(null);
  const [selectedPacks, setSelectedPacks] = useState<string[]>(init.selectedPacks || []);
  // Which project's Film Space data to read. Defaults to the active project;
  // the user can point it at ANY project to pull THAT project's locked packs.
  const [packProjectSlug, setPackProjectSlug] = useState<string | undefined>(activeProject?.slug);

  // Persistence — always MERGE from disk so overlapping writers (composer field
  // changes vs. run-take patches from parallel batches) never clobber each other.
  const writeLS = (patch: Partial<Persisted>) => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const cur = raw ? JSON.parse(raw) : {};
      localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...patch }));
    } catch { /* ignore */ }
  };
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 1900); };

  // Restore-safety: a source can survive from a prior session (or arrive without
  // a cached aspect). If so, re-derive its aspect on mount so every make still
  // inherits the true source ratio — never a silent fallback.
  useEffect(() => {
    if (srcPath && !srcAspect) {
      void readSourceAspect(srcPath).then(a => { setSrcAspect(a); writeLS({ srcAspect: a }); });
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── From Film Space: enumerate a CHOSEN project's locked Angle Packs ──
  // The bridge takes any project slug, so the Film Space data is decoupled from
  // the active project — the user can pull one project's packs and make them into
  // takes that save into a different (active) project.
  const loadPacks = async (slug?: string) => {
    const projectSlug = slug ?? packProjectSlug ?? activeProject?.slug;
    setPacksLoading(true); setPacksError(null);
    try {
      const res = await window.hjen.filmspacePacksList({ projectSlug });
      if (res.ok) {
        setPacks(res.packs as LockedPack[]);
        setSelectedPacks(prev => prev.filter(id => res.packs.some(p => p.packId === id)));
      } else {
        setPacks([]); setPacksError(res.message || 'Could not read the project\'s Angle Packs.');
      }
    } catch (e) {
      setPacks([]); setPacksError('Could not read the project\'s Angle Packs: ' + String((e as Error)?.message || e));
    } finally { setPacksLoading(false); }
  };
  // When the app's active project changes, reset the Film Space selector back to
  // it (default = active) and drop any cross-project pack selection.
  useEffect(() => {
    setPackProjectSlug(activeProject?.slug);
    setSelectedPacks([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.slug]);
  // Read the chosen project's packs whenever the selection changes.
  useEffect(() => {
    void loadPacks(packProjectSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packProjectSlug]);
  // Switch the Film Space source project — resets selection so a fired batch can
  // never mix a stale project's packs.
  const pickPackProject = (slug: string) => {
    if (slug === packProjectSlug) return;
    setSelectedPacks([]);
    setPackProjectSlug(slug);
  };

  const filledRows = rows.filter(r => r.text.trim());
  const referenceRides = MODELS[model].provider === 'openai';

  // ── source ──────────────────────────────────────────────────
  const applySource = async (p: string) => {
    setSrcPath(p); setSrcAspect(null); setError(null);
    writeLS({ srcPath: p, srcAspect: null });
    const asp = await readSourceAspect(p);
    setSrcAspect(asp);
    writeLS({ srcPath: p, srcAspect: asp });
  };
  const pickSourceFile = async () => {
    const picked = await window.hjen.pickImageFiles();
    if (!picked || !picked.length) return;
    await applySource(picked[0]);
  };
  const pickFromProject = (paths: string[]) => {
    setPickerOpen(false);
    if (paths && paths.length) void applySource(paths[0]);
  };
  // Clear the COMPOSER only — a fresh setup. Existing runs are untouched and keep
  // streaming their takes.
  const clearComposer = () => {
    setSrcPath(null); setSrcAspect(null); setRows([]); setSelectedPacks([]); setError(null);
    writeLS({ srcPath: null, srcAspect: null, rows: [], selectedPacks: [] });
  };
  const removeSource = () => {
    setSrcPath(null); setSrcAspect(null); setError(null);
    writeLS({ srcPath: null, srcAspect: null });
  };

  // ── row ops (approve editor) ────────────────────────────────
  const setRowText = (id: string, text: string) => {
    const next = rows.map(r => r.id === id ? { ...r, text } : r);
    setRows(next); writeLS({ rows: next });
  };
  const toggleLock = (id: string) => {
    const next = rows.map(r => r.id === id ? { ...r, locked: !r.locked } : r);
    setRows(next); writeLS({ rows: next });
  };
  const removeRow = (id: string) => {
    const next = rows.filter(r => r.id !== id);
    setRows(next); writeLS({ rows: next });
  };
  const addCustom = () => {
    if (rows.length >= MAX_ANGLES) { flash(`Six angles is the limit.`); return; }
    const next = [...rows, toRow('', true)];
    setRows(next); writeLS({ rows: next });
  };

  // ── read the scene → distinct angles ────────────────────────
  const readScene = async (): Promise<AngleRow[] | null> => {
    if (!srcPath) return null;
    setError(null); setReading(true);
    try {
      const keep = rows.filter(r => r.locked || (r.custom && r.text.trim()));
      const need = Math.max(0, Math.min(MAX_ANGLES, count) - keep.length);
      let proposed: AngleRow[] = [];
      if (need > 0) {
        const res = await proposeAngles(srcPath, need, keep.map(r => r.text));
        if (!res.ok || !res.angles) {
          setError(res.message || 'The scene read did not return.');
          return null;
        }
        proposed = res.angles.map(a => toRow(a));
      }
      const next = [...keep, ...proposed].slice(0, Math.min(MAX_ANGLES, Math.max(count, keep.length)));
      setRows(next); writeLS({ rows: next });
      return next;
    } finally { setReading(false); }
  };

  // ── run helpers ─────────────────────────────────────────────
  // Patch a single take across the runs list. Functional set + merge-from-disk
  // persistence, so two parallel batches never clobber each other's takes.
  const patchTake = (runId: string, key: string, patch: Partial<RunTake>) => {
    setRuns(prev => {
      const next = prev.map(run => run.id !== runId ? run : { ...run, takes: run.takes.map(t => t.key === key ? { ...t, ...patch } : t) });
      writeLS({ runs: next });
      return next;
    });
  };
  const appendRun = (run: Run) => {
    setRuns(prev => { const next = [run, ...prev].slice(0, MAX_RUNS); writeLS({ runs: next }); return next; });
  };

  // ── fire an ANGLE run — all takes in ONE parallel batch (batch-generation law).
  // Snapshots the composer into a run; the composer stays free for the next run.
  const fireAngleRun = async (fromRows: AngleRow[]) => {
    if (!srcPath) return;
    const valid = fromRows.filter(r => r.text.trim()).slice(0, MAX_ANGLES);
    if (!valid.length) return;
    const runAspect = srcAspect || FALLBACK_ASPECT;
    const run: Run = {
      id: uid(), at: Date.now(), kind: 'angle',
      srcPath, srcAspect, model, quality, aspect: runAspect,
      takes: valid.map(r => ({ key: uid(), kind: 'angle', status: 'making', angle: r.text.trim() })),
    };
    appendRun(run);
    flash(`Making ${valid.length} take${valid.length === 1 ? '' : 's'}`);
    await Promise.all(run.takes.map((t, i) =>
      makeCameraAngleFrame({ angle: t.angle, refPath: run.srcPath, quality: run.quality, aspect: run.aspect, model: run.model, index: i })
        .then(res => patchTake(run.id, t.key, res.ok
          ? { status: 'done', path: res.path, jsonPath: res.jsonPath }
          : { status: 'error', message: res.message })),
    ));
  };

  // ── From Film Space — fire a PACK run. Each pack → one make: Image 1 = plate
  // (geometry), Image 2 = source scene. One parallel batch, snapshotted as a run.
  const togglePack = (packId: string) => {
    setSelectedPacks(prev => {
      let next: string[];
      if (prev.includes(packId)) next = prev.filter(id => id !== packId);
      else if (prev.length >= MAX_ANGLES) { flash(`Six angles is the limit.`); return prev; }
      else next = [...prev, packId];
      writeLS({ selectedPacks: next });
      return next;
    });
  };
  const packMode = selectedPacks.length > 0;
  const firePackRun = async () => {
    if (!srcPath) { flash('Add a source scene first.'); return; }
    const chosen = packs.filter(p => selectedPacks.includes(p.packId)).slice(0, MAX_ANGLES);
    if (!chosen.length) return;
    const runAspect = srcAspect || FALLBACK_ASPECT;
    const run: Run = {
      id: uid(), at: Date.now(), kind: 'pack',
      srcPath, srcAspect, model, quality, aspect: runAspect,
      packProject: packProjectSlug,
      takes: chosen.map(p => ({ key: uid(), kind: 'pack', status: 'making', angle: packReadout(p.camera) || 'Film Space angle', platePath: p.platePath, packId: p.packId })),
    };
    appendRun(run);
    flash(`Making ${chosen.length} Film Space take${chosen.length === 1 ? '' : 's'}`);
    await Promise.all(run.takes.map((t, i) =>
      makeCameraAngleFromPack({ platePath: t.platePath!, refPath: run.srcPath, quality: run.quality, aspect: run.aspect, model: run.model, index: i, packId: t.packId, readout: t.angle })
        .then(res => patchTake(run.id, t.key, res.ok
          ? { status: 'done', path: res.path, jsonPath: res.jsonPath }
          : { status: 'error', message: res.message })),
    ));
  };

  // ── per-take "Try again" — re-fires ONE take against its RUN's snapshot
  // settings (source / aspect / model / quality from the run, not the composer).
  const retryTake = async (run: Run, take: RunTake) => {
    const i = run.takes.findIndex(t => t.key === take.key);
    patchTake(run.id, take.key, { status: 'making', message: undefined });
    const res = take.kind === 'pack'
      ? await makeCameraAngleFromPack({ platePath: take.platePath!, refPath: run.srcPath, quality: run.quality, aspect: run.aspect, model: run.model, index: Math.max(0, i), packId: take.packId, readout: take.angle })
      : await makeCameraAngleFrame({ angle: take.angle, refPath: run.srcPath, quality: run.quality, aspect: run.aspect, model: run.model, index: Math.max(0, i) });
    patchTake(run.id, take.key, res.ok
      ? { status: 'done', path: res.path, jsonPath: res.jsonPath }
      : { status: 'error', message: res.message });
  };

  // ── primary action ── never blocks; fires and returns, run streams on its own.
  const primary = async () => {
    if (!srcPath) { void pickSourceFile(); return; }
    if (packMode) { void firePackRun(); return; }
    const next = await readScene();
    if (!next) return;
    if (mode === 'auto') void fireAngleRun(next);
    // approve: rows are now proposed; the user fires with "Make N takes".
  };

  // Open a made take in the app's shared generation lightbox. Navigable list =
  // that RUN's done takes, so arrows cycle the run you're viewing.
  const takeToEntry = (t: RunTake): ProjectFileEntry | null => {
    if (!t.path) return null;
    const base = (t.path.split('/').pop() || 'take').replace(/\.(png|jpe?g|webp)$/i, '');
    return { imgPath: t.path, thumbPath: t.path, jsonPath: t.jsonPath || '', dateFolder: '', baseName: base, promptTitle: t.angle, ts: Date.now() };
  };
  const openTake = (run: Run, take: RunTake) => {
    const entry = takeToEntry(take);
    if (!entry) return;
    const list = run.takes
      .filter(t => t.status === 'done' && !!t.path)
      .map(takeToEntry)
      .filter((e): e is ProjectFileEntry => !!e);
    openPreview(entry, list.length ? list : [entry]);
  };

  const primaryLabel = reading ? 'Reading the scene…'
    : !srcPath ? 'Add a source scene'
    : packMode ? `Make ${selectedPacks.length} from Film Space`
    : mode === 'auto' ? `Read the scene · Make ${count}`
    : `Read the scene → propose ${count}`;

  const composerHasContent = !!srcPath || rows.length > 0 || selectedPacks.length > 0;
  const hasContent = composerHasContent || runs.length > 0 || packs.length > 0;

  return (
    <div className="ang">
      {/* ── bar ── */}
      <div className="ang-bar">
        <button className="ang-back" onClick={() => setActiveView('studio')} title="Back to Studio">‹ Studio</button>
        <div className="ang-bar__head">
          <h2 className="ang-bar__title">Camera Angles</h2>
          <span className="ang-bar__lead">One scene, re-shot from genuinely different viewpoints — fire as many runs as you like, all making at once</span>
        </div>
        {composerHasContent && <button className="ang-btn ang-btn--ghost" onClick={clearComposer}>+ New scene</button>}
      </div>

      <div className="ang-grid">
        {/* ── left: source + controls (composer — never blocked) ── */}
        <aside className="ang-left">
          <div className="mono-label ang-eyebrow">Source scene<span className="ang-eyebrow__hint">{srcPath ? `aspect ${aspectLabel(srcAspect)}` : 'one scene'}</span></div>
          {srcPath ? (
            <div className="ang-src">
              <img src={hjenFileUrl(srcPath)} alt="source scene" />
              <div className="ang-src__acts">
                <button className="ang-btn" onClick={pickSourceFile}>Change file</button>
                <button className="ang-btn" onClick={() => setPickerOpen(true)}>Project makes</button>
                <button className="ang-btn ang-btn--ghost" onClick={removeSource}>Remove</button>
              </div>
            </div>
          ) : (
            <>
              <button className="ang-drop" onClick={pickSourceFile}>
                <span className="ang-drop__plus">＋</span>
                <span className="ang-drop__t">Drop one still of the scene</span>
                <small>The performance source for every angle</small>
              </button>
              <button className="ang-btn ang-src__pick" onClick={() => setPickerOpen(true)}>Choose from project makes</button>
            </>
          )}

          {/* count */}
          <div className="ang-ctrl">
            <div className="mono-label ang-eyebrow">Angles<span className="ang-eyebrow__hint">1–6</span></div>
            <div className="ang-count">
              {[1, 2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  className={`ang-count__pill ${count === n ? 'ang-count__pill--on' : ''}`}
                  onClick={() => { setCount(n); writeLS({ count: n }); }}
                >{n}</button>
              ))}
            </div>
          </div>

          {/* mode */}
          <div className="ang-ctrl">
            <div className="mono-label ang-eyebrow">Mode</div>
            <div className="ang-seg" data-i={mode === 'auto' ? 0 : 1}>
              <span className="ang-seg__glider" aria-hidden />
              <button className={`ang-seg__btn ${mode === 'auto' ? 'ang-seg__btn--on' : ''}`} onClick={() => { setMode('auto'); writeLS({ mode: 'auto' }); }}>Automatic</button>
              <button className={`ang-seg__btn ${mode === 'approve' ? 'ang-seg__btn--on' : ''}`} onClick={() => { setMode('approve'); writeLS({ mode: 'approve' }); }}>Approve</button>
            </div>
            <p className="ang-help selectable">{mode === 'auto'
              ? 'HJEN decides the distinct angles and makes them straight away.'
              : 'HJEN proposes the angles as editable rows — edit, lock, delete or add your own, then make.'}</p>
          </div>

          {/* make settings */}
          <div className="ang-ctrl">
            <div className="mono-label ang-eyebrow">Make settings</div>
            <div className="ang-settings">
              <label className="ang-set">
                <span>Model</span>
                <select value={model} onChange={e => { setModel(e.target.value as ModelId); writeLS({ model: e.target.value as ModelId }); }}>
                  {(Object.keys(MODELS) as ModelId[]).map(m => <option key={m} value={m}>{MODELS[m].label}</option>)}
                </select>
              </label>
              <label className="ang-set">
                <span>Quality</span>
                <select value={quality} onChange={e => { setQuality(e.target.value as Quality); writeLS({ quality: e.target.value as Quality }); }}>
                  {QUALITIES.map(q => <option key={q} value={q}>{q}</option>)}
                </select>
              </label>
            </div>
            <p className="ang-note selectable">Aspect ratio is inherited from the source scene{srcAspect ? ` (${aspectLabel(srcAspect)})` : ''} — every take matches the original frame.</p>
            {!referenceRides && (
              <p className="ang-note selectable">The scene reference rides with ChatGPT Image 2. Nano Banana Pro makes from the angle prompt alone.</p>
            )}
          </div>

          <button className="ang-btn ang-btn--accent ang-go" onClick={primary} disabled={reading}>
            {reading && <span className="ang-spin" aria-hidden />}
            {primaryLabel}
          </button>
          {packMode && !reading && (
            <p className="ang-note ang-note--fs selectable">{selectedPacks.length} Film Space {selectedPacks.length === 1 ? 'pack' : 'packs'} selected — the button makes from {selectedPacks.length === 1 ? 'it' : 'them'}. Clear the selection to read the scene for auto angles instead.</p>
          )}
          {runs.some(r => r.takes.some(t => t.status === 'making')) && (
            <p className="ang-note selectable">A run is making — the composer stays free. Change the source or the angles and fire another run; they make in parallel.</p>
          )}
          {error && (
            <div className="ang-error" role="alert">
              <span className="selectable">{error}</span>
              {srcPath && !reading && <button className="ang-btn ang-btn--ghost ang-error__retry" onClick={() => void primary()}>Try again</button>}
            </div>
          )}
        </aside>

        {/* ── right: angle editor + Film Space + runs ── */}
        <main className="ang-right">
          {!hasContent && (
            <div className="ang-hint">
              <h3>One scene. Every angle.</h3>
              <p className="selectable">Drop a single still of a scene. Camera Angles reads what the frame actually shows — where the subject is, the eyeline, the space around them — and proposes camera viewpoints as different from each other as the scene allows — all staying in front of the subject: a worm's-eye look up from the front, a full side profile, a front three-quarter, a far-back frontal on a long lens. Every angle is MADE through the Frame engine, preserving the original performance and changing only the camera.</p>
              <p className="ang-hint__steps selectable">Set how many angles you want (up to six), choose Automatic to let HJEN fire them, or Approve to edit each angle first — you can always add your own. Fire a run, then change the source or the angles and fire another straight away — every run makes at once. Or reach past the front of the subject entirely: pull a locked Angle Pack from Film Space and its frame anchors a behind-the-subject or overhead viewpoint the scene read can't invent.</p>
            </div>
          )}

          {(srcPath || rows.length > 0 || reading) && (
            <section className="ang-plan">
              <div className="ang-plan__head">
                <span className="mono-label">The angles</span>
                <span className="ang-plan__count">{filledRows.length} / {count}</span>
              </div>

              {reading && rows.length === 0 && (
                <div className="ang-reading selectable"><span className="ang-spin" aria-hidden />Reading the scene…</div>
              )}
              {rows.length === 0 && !reading && (
                <p className="ang-plan__empty selectable">{mode === 'auto'
                  ? 'Read the scene and HJEN makes the distinct angles for you — or add your own below first.'
                  : 'Read the scene to propose editable angles — or add your own below.'}</p>
              )}

              <div className="ang-rows">
                {rows.map((r, i) => (
                  <div className={`ang-row ${r.locked ? 'ang-row--locked' : ''}`} key={r.id}>
                    <span className="ang-row__no">{String(i + 1).padStart(2, '0')}</span>
                    <textarea
                      className="ang-row__text"
                      value={r.text}
                      rows={2}
                      placeholder="Describe a camera angle — e.g. a low worm's-eye angle looking steeply up at the subject"
                      onChange={e => setRowText(r.id, e.target.value)}
                    />
                    <div className="ang-row__acts">
                      {r.custom && <span className="ang-row__tag">yours</span>}
                      <button
                        className={`ang-row__ic ${r.locked ? 'ang-row__ic--on' : ''}`}
                        onClick={() => toggleLock(r.id)}
                        title={r.locked ? 'Locked — kept when you propose again' : 'Lock this angle'}
                      >{r.locked ? '🔒' : '🔓'}</button>
                      <button className="ang-row__ic ang-row__ic--del" onClick={() => removeRow(r.id)} title="Remove angle">✕</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="ang-plan__toolbar">
                <button className="ang-btn" onClick={addCustom} disabled={rows.length >= MAX_ANGLES}>＋ Add your own angle</button>
                {mode === 'approve' && (
                  <>
                    <button className="ang-btn" onClick={() => void readScene()} disabled={reading || !srcPath}>Propose again</button>
                    <button className="ang-btn ang-btn--accent" onClick={() => void fireAngleRun(rows)} disabled={!srcPath || !filledRows.length}>
                      Make {filledRows.length} take{filledRows.length === 1 ? '' : 's'}
                    </button>
                  </>
                )}
              </div>
            </section>
          )}

          {/* ── From Film Space — locked Angle Packs as camera angles ── */}
          {(!!activeProject || packs.length > 0 || packsLoading || packsError) && (
            <section className="ang-fs">
              <div className="ang-plan__head">
                <span className="mono-label">From Film Space</span>
                <span className="ang-plan__count">{selectedPacks.length ? `${selectedPacks.length} selected` : `${packs.length} pack${packs.length === 1 ? '' : 's'}`}</span>
              </div>

              {/* Project selector — pull ANY project's Film Space data, not just
                  the active one. Default is the active project. */}
              <div className="ang-fs__pick">
                <span className="mono-label ang-fs__picklbl">Packs from</span>
                <select
                  className="ang-fs__select"
                  value={packProjectSlug ?? ''}
                  onChange={e => pickPackProject(e.target.value)}
                >
                  {!packProjectSlug && <option value="">Choose a project…</option>}
                  {projects.map(p => (
                    <option key={p.id} value={p.slug}>{p.name}{p.slug === activeProject?.slug ? ' · active' : ''}</option>
                  ))}
                </select>
                {packProjectSlug && activeProject && packProjectSlug !== activeProject.slug && (
                  <span className="ang-fs__xhint selectable">takes save into {activeProject.name}</span>
                )}
              </div>

              <p className="ang-fs__lead selectable">Locked Angle Packs become camera angles. The pack's Film Space frame anchors the geometry (behind the subject, overhead, anything a normal angle can't reach), and your source scene fills in the real subject and location — one make, the frame plus your scene.</p>

              {packsLoading && <div className="ang-reading selectable"><span className="ang-spin" aria-hidden />Reading the project's Angle Packs…</div>}
              {packsError && !packsLoading && (
                <div className="ang-error" role="alert"><span className="selectable">{packsError}</span><button className="ang-btn ang-btn--ghost ang-error__retry" onClick={() => void loadPacks()}>Try again</button></div>
              )}
              {!packsLoading && !packsError && packs.length === 0 && (
                <p className="ang-plan__empty selectable">No locked Angle Packs in this project yet. Lock a camera in Film Space and it appears here as an angle.</p>
              )}

              {packs.length > 0 && (
                <>
                  <div className="ang-fs__grid">
                    {packs.map(p => {
                      const on = selectedPacks.includes(p.packId);
                      const ro = packReadout(p.camera);
                      return (
                        <button
                          key={p.packId}
                          className={`ang-fs__tile ${on ? 'ang-fs__tile--on' : ''}`}
                          onClick={() => togglePack(p.packId)}
                          title={ro || p.packId}
                          aria-pressed={on}
                        >
                          <span className="ang-fs__thumb"><img src={hjenFileUrl(p.platePath)} alt={ro || 'Angle Pack plate'} loading="lazy" /></span>
                          {on && <span className="ang-fs__check" aria-hidden>✓</span>}
                          <span className="ang-fs__ro selectable">{ro || 'Angle Pack'}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="ang-plan__toolbar">
                    <button className="ang-btn" onClick={() => void loadPacks()} disabled={packsLoading} title="Re-read locked packs from disk">Refresh</button>
                    <button className="ang-btn ang-btn--accent" onClick={() => void firePackRun()} disabled={!srcPath || !selectedPacks.length}>
                      Make {selectedPacks.length || ''} from Film Space
                    </button>
                    {!srcPath && <span className="ang-fs__need selectable">Add a source scene to make.</span>}
                  </div>
                </>
              )}
            </section>
          )}

          {/* ── runs — every fired batch, newest first, each its own group ── */}
          {runs.length > 0 && (
            <section className="ang-runs">
              <div className="ang-plan__head"><span className="mono-label">Takes</span><span className="ang-plan__count">{runs.length} run{runs.length === 1 ? '' : 's'}</span></div>
              {runs.map(run => {
                const done = run.takes.filter(t => t.status === 'done').length;
                const making = run.takes.filter(t => t.status === 'making').length;
                return (
                  <div className="ang-run" key={run.id}>
                    <div className="ang-run__head">
                      <span className="ang-run__src"><img src={hjenFileUrl(run.srcPath)} alt="run source" /></span>
                      <div className="ang-run__info">
                        <span className="ang-run__title">{run.kind === 'pack' ? 'From Film Space' : 'Angles'}<span className="ang-run__badge">{run.takes.length}</span></span>
                        <span className="ang-run__meta selectable">{MODELS[run.model].label} · {run.quality} · {aspectLabel(run.aspect)}</span>
                        {run.kind === 'pack' && run.packProject && run.packProject !== activeProject?.slug && (
                          <span className="ang-run__xproj selectable">packs from: {run.packProject}</span>
                        )}
                      </div>
                      <span className="ang-run__status selectable">{making > 0 ? <><span className="ang-spin" aria-hidden />{making} making</> : `${done} / ${run.takes.length} made`}</span>
                    </div>
                    <div className="ang-cards">
                      {run.takes.map((t, i) => (
                        <div className="ang-card" key={t.key}>
                          <div className={`ang-card__img ang-card__img--${t.status}`}>
                            {t.status === 'done' && t.path
                              ? <button className="ang-card__open" onClick={() => openTake(run, t)} title="Open this take">
                                  <img src={hjenFileUrl(t.path)} alt={t.angle} />
                                  <span className="ang-card__zoom" aria-hidden>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></svg>
                                  </span>
                                </button>
                              : t.status === 'making'
                                ? <div className="ang-card__making"><span className="ang-spin ang-spin--lg" aria-hidden /><span className="mono-label">Making</span></div>
                                : <div className="ang-card__fail"><span>{t.status === 'interrupted' ? 'Interrupted' : 'Stopped'}</span><small className="selectable">{t.message || 'The make did not return.'}</small><button className="ang-btn ang-btn--ghost" onClick={() => void retryTake(run, t)}>Try again</button></div>}
                            <span className={`ang-card__no ${t.kind === 'pack' ? 'ang-card__no--fs' : ''}`}>{t.kind === 'pack' ? 'FS' : String(i + 1).padStart(2, '0')}</span>
                          </div>
                          <p className="ang-card__cap selectable">{t.angle}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </main>
      </div>

      {toast && <div className="ang-toast">{toast}</div>}

      {/* Reuse the app's shared picker — GENERATIONS (project makes) + LIBRARY.
       *  Single-source: only the first pick is taken. */}
      {pickerOpen && <ProjectAssetPicker onClose={() => setPickerOpen(false)} onAttach={pickFromProject} />}
    </div>
  );
}
