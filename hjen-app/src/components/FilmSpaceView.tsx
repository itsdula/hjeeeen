import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { hjenFileUrl } from '../lib/theme/apply';
import { SHOT_SIZES, ANGLES, LENSES, shotSizePrompt, anglePrompt, lensPrompt, movePrompt } from '../lib/storyboardCamera';
import { MOVEMENTS, movementsByCategory, getMovement, type Motion } from '../lib/cameraMovements';
import { ProjectAssetPicker } from './ProjectAssetPicker';
import '../styles/filmspace.css';

/**
 * Film Space (Phase 3) — a BUILT 3D studio stage. A realistic FK-posable stand-in
 * (COCO-17 exact), an objects library (Nth stand-in · wall · window · car · shop
 * · a real CubeCamera mirror), a bottom keyframe timeline (camera + per-object
 * tracks), real-time Play, and MOVE recording up to 20s. Movement presets move
 * the CAMERA only, relative to a static character; subject/object motion is
 * authored on the timeline. LOCK writes an Angle Pack the Frame + Video engines
 * obey. Black ground, white ink, one ember accent, altitude tint, Pro-safe. EN only.
 */

interface Readout { focalMm: number; lensPrime: number; lensCode: string; shotCode: string; angleCode: string; distanceM: number; camHeight: number; figureHeight: number }
interface SceneObj { id: string; type: string; selected: boolean }
interface SelInfo { id: string; type: string; px: number; py: number; pz: number; rx: number; ry: number; rz: number; scale: number; isMann: boolean; pose: string | null }
interface KeyRef { id: string; t: number }
interface SelKey { track: string; id: string }
interface TimelineState { duration: number; head: number; selKey: SelKey | null; camera: KeyRef[]; objectId: string | null; object: KeyRef[] }
interface CaptureMsg { plate: string; outline: string; depth: string; pose: string; camera: unknown; readout: Readout; clip?: string | null; clipMime?: string | null; hasMove?: boolean; error?: string }
interface LockedPack { packDir: string; platePath: string; files: string[]; previewFile: string | null; at: number; readout: Readout; hasMove: boolean }
interface SessionMeta { id: string; name: string; savedAt: number; thumbPath: string | null; packIds: string[] }
/** The iframe's full stage snapshot — opaque except for the few scalars the rail mirrors. */
interface SceneState {
  mode?: 'frame' | 'move';
  figureHeight?: number;
  figureRotation?: number;
  camera?: { focalMm?: number; dist?: number; camY?: number };
  timeline?: { duration?: number; armedMeta?: { presetId?: string | null } | null };
  [k: string]: unknown;
}

const LENS_PRESETS = [8, 14, 24, 35, 50, 75, 200] as const;
const DURATIONS = [3, 5, 10, 15, 20] as const;
const OBJECT_TYPES: { type: string; label: string }[] = [
  { type: 'mannequin', label: 'Stand-in' }, { type: 'wall', label: 'Wall' }, { type: 'window', label: 'Window' },
  { type: 'car', label: 'Car' }, { type: 'shop', label: 'Shop' }, { type: 'mirror', label: 'Mirror' },
];
const POSE_PRESETS = ['stand', 'contrapposto', 'walk-stride', 'sit', 'point', 'reach', 'hands-in-pockets'];
const OBJ_LABEL: Record<string, string> = { mannequin: 'Stand-in', wall: 'Wall', window: 'Window', car: 'Car', shop: 'Shop', mirror: 'Mirror' };
const LS_KEY = 'hjen_filmspace_work3';

const COMPOSITION_LOCK =
  'Do NOT reframe, re-crop, rotate, change angle, change height, or invent a new composition — ' +
  'reproduce this EXACT camera angle, lens perspective, subject placement and framing rectangle; ' +
  'the output spatial geometry must MATCH the plate when the two are overlaid.';

const fmtDate = (ms: number) => {
  try { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};
const shotLabel = (c: string) => SHOT_SIZES.find(s => s.code === c)?.label ?? c;
const angleLabel = (c: string) => ANGLES.find(a => a.code === c)?.label ?? c;
const lensLabel = (c: string) => LENSES.find(l => l.code === c)?.label ?? c;

function buildPrompt(r: Readout, movementId?: string | null): string {
  const mv = getMovement(movementId);
  const moveClause = mv
    ? `Camera movement: ${mv.promptKeyword} — ${mv.description}`
    : (movePrompt('▣ static') || 'STATIC, locked-off camera — a still, composed frame.');
  return [shotSizePrompt(r.shotCode), anglePrompt(r.angleCode), lensPrompt(r.lensCode), moveClause + '.', COMPOSITION_LOCK].filter(Boolean).join(' ');
}

interface Persisted { focalMm: number; distanceM: number; camHeight: number; figureHeight: number; figureRotation: number; duration: number }
function loadWork(): Persisted {
  const base: Persisted = { focalMm: 50, distanceM: 3.6, camHeight: 1.08, figureHeight: 1.75, figureRotation: 0, duration: 5 };
  try { const raw = localStorage.getItem(LS_KEY); if (raw) return { ...base, ...JSON.parse(raw) }; } catch { /* ignore */ }
  return base;
}

export function FilmSpaceView() {
  const setActiveView = useStore(s => s.setActiveView);
  const activeProject = useStore(s => s.activeProject());
  const frameRef = useRef<HTMLIFrameElement>(null);
  const init = useRef(loadWork());

  const [ready, setReady] = useState(false);
  const [focalMm, setFocalMm] = useState(init.current.focalMm);
  const [distanceM, setDistanceM] = useState(init.current.distanceM);
  const [camHeight, setCamHeight] = useState(init.current.camHeight);
  const [figureHeight, setFigureHeight] = useState(init.current.figureHeight);
  const [figureRotation, setFigureRotation] = useState(init.current.figureRotation);
  const [readout, setReadout] = useState<Readout | null>(null);

  const [mode, setMode] = useState<'frame' | 'move'>('frame');
  const [objs, setObjs] = useState<SceneObj[]>([]);
  const [sel, setSel] = useState<SelInfo | null>(null);

  const [armedId, setArmedId] = useState<string | null>(null);
  const [duration, setDuration] = useState(init.current.duration);
  const [playing, setPlaying] = useState(false);
  const [tl, setTl] = useState<TimelineState>({ duration: init.current.duration, head: 0, selKey: null, camera: [], objectId: null, object: [] });
  const selKey = tl.selKey;   // the iframe owns selection; React reflects it

  const [pickerOpen, setPickerOpen] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const thumbsBuilding = useRef(false);

  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [packs, setPacks] = useState<LockedPack[]>([]);

  // ── saved sessions (per project) ──
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState('Session 1');
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [savingSession, setSavingSession] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const sessionNameRef = useRef('Session 1');
  useEffect(() => { sessionIdRef.current = currentSessionId; }, [currentSessionId]);
  useEffect(() => { sessionNameRef.current = sessionName; }, [sessionName]);

  // ── runtime undo/redo history — snapshots ride on getSceneState/setSceneState.
  // Debounced per gesture (one entry per settled slider/gizmo/camera move), 50 deep,
  // runtime-only (never touches saved session files). ──
  const histRef = useRef<{ entries: SceneState[]; pos: number }>({ entries: [], pos: -1 });
  const histTimer = useRef(0);
  const restoringRef = useRef(false);
  const readyRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // in-flight getSceneState round-trips (token → resolver)
  const sceneReqs = useRef<Map<string, (v: { state: SceneState; thumb: string | null } | null) => void>>(new Map());

  // Pose from image (local, offline) — a Python sidecar (4D-Humans / HMR2.0)
  // recovers SMPL body params on-device; the iframe retargets them onto the rig.
  const [poseReady, setPoseReady] = useState(false);
  const [poseImg, setPoseImg] = useState<string | null>(null);
  const [posing, setPosing] = useState(false);
  const [poseMsg, setPoseMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [posePickerOpen, setPosePickerOpen] = useState(false);

  const post = useCallback((cmd: string, extra: Record<string, unknown> = {}) => {
    frameRef.current?.contentWindow?.postMessage({ cmd, ...extra }, '*');
  }, []);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2200); };
  const persist = useCallback((patch: Partial<Persisted>) => {
    const next: Persisted = { focalMm, distanceM, camHeight, figureHeight, figureRotation, duration, ...patch };
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, [focalMm, distanceM, camHeight, figureHeight, figureRotation, duration]);

  // Ask the iframe for a full snapshot (round-trips as hjen:fs-scene-state).
  const requestSceneState = useCallback((withThumb = true) => new Promise<{ state: SceneState; thumb: string | null } | null>(resolve => {
    const token = 'ss' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    sceneReqs.current.set(token, resolve);
    post('getSceneState', { token, withThumb });
    window.setTimeout(() => { if (sceneReqs.current.has(token)) { sceneReqs.current.delete(token); resolve(null); } }, 4000);
  }), [post]);

  // ── history ──
  const syncHistFlags = useCallback(() => { const h = histRef.current; setCanUndo(h.pos > 0); setCanRedo(h.pos < h.entries.length - 1); }, []);
  const captureHist = useCallback(async () => {
    if (restoringRef.current || !readyRef.current) return;
    const cap = await requestSceneState(false);
    if (!cap || !cap.state) return;
    const h = histRef.current;
    const json = JSON.stringify(cap.state);
    if (h.pos >= 0 && JSON.stringify(h.entries[h.pos]) === json) return;   // no-op gesture / duplicate
    h.entries = h.entries.slice(0, h.pos + 1);
    h.entries.push(cap.state);
    if (h.entries.length > 50) h.entries.shift();
    h.pos = h.entries.length - 1;
    syncHistFlags();
  }, [requestSceneState, syncHistFlags]);
  const scheduleHist = useCallback((delay = 260) => {
    if (restoringRef.current || !readyRef.current) return;
    window.clearTimeout(histTimer.current);
    histTimer.current = window.setTimeout(() => { histTimer.current = 0; captureHist(); }, delay);
  }, [captureHist]);
  const flushHist = useCallback(() => {
    if (histTimer.current) { window.clearTimeout(histTimer.current); histTimer.current = 0; captureHist(); }
  }, [captureHist]);

  const hydrateControls = useCallback((st: SceneState) => {
    const cam = st.camera || {};
    setMode(st.mode === 'move' ? 'move' : 'frame');
    setFocalMm(cam.focalMm ?? 50); setDistanceM(cam.dist ?? 3.6); setCamHeight(cam.camY ?? 1.08);
    setFigureHeight(st.figureHeight ?? 1.75); setFigureRotation(st.figureRotation ?? 0);
    setDuration(st.timeline?.duration ?? 5); setArmedId(st.timeline?.armedMeta?.presetId ?? null);
    persist({ focalMm: cam.focalMm ?? 50, distanceM: cam.dist ?? 3.6, camHeight: cam.camY ?? 1.08, figureHeight: st.figureHeight ?? 1.75, figureRotation: st.figureRotation ?? 0, duration: st.timeline?.duration ?? 5 });
  }, [persist]);
  // Apply a snapshot to the stage WITHOUT pushing a new history entry (no loops).
  const restoreState = useCallback((st: SceneState) => {
    restoringRef.current = true;
    window.clearTimeout(histTimer.current); histTimer.current = 0;
    hydrateControls(st);
    post('setSceneState', { state: st });
    window.setTimeout(() => { restoringRef.current = false; }, 520);
  }, [hydrateControls, post]);
  const undo = useCallback(() => {
    window.clearTimeout(histTimer.current); histTimer.current = 0;
    const h = histRef.current; if (h.pos <= 0) return;
    h.pos -= 1; syncHistFlags(); restoreState(h.entries[h.pos]);
  }, [restoreState, syncHistFlags]);
  const redo = useCallback(() => {
    window.clearTimeout(histTimer.current); histTimer.current = 0;
    const h = histRef.current; if (h.pos >= h.entries.length - 1) return;
    h.pos += 1; syncHistFlags(); restoreState(h.entries[h.pos]);
  }, [restoreState, syncHistFlags]);

  // ── sessions ──
  const refreshSessions = useCallback(async () => {
    try { const res = await window.hjen.filmspaceSessionsList({ projectSlug: activeProject?.slug }); if (res.ok) setSessions(res.sessions); } catch { /* ignore */ }
  }, [activeProject?.slug]);
  const saveSession = useCallback(async (opts?: { silent?: boolean }): Promise<string | null> => {
    const cap = await requestSceneState(true);
    if (!cap || !cap.state) { if (!opts?.silent) setError('Could not read the stage to save the session.'); return sessionIdRef.current; }
    setSavingSession(true);
    try {
      const res = await window.hjen.filmspaceSessionSave({
        projectSlug: activeProject?.slug, sessionId: sessionIdRef.current || undefined,
        name: sessionNameRef.current || 'Untitled session', state: cap.state, thumbnail: cap.thumb || undefined,
      });
      if (!res.ok) { if (!opts?.silent) setError(res.message || 'Could not save the session.'); return sessionIdRef.current; }
      sessionIdRef.current = res.sessionId; setCurrentSessionId(res.sessionId);
      await refreshSessions();
      if (!opts?.silent) { setError(null); flash('Session saved'); }
      return res.sessionId;
    } finally { setSavingSession(false); }
  }, [activeProject?.slug, requestSceneState, refreshSessions]);
  // Repopulate the Locked-packs grid from a session's own pack ids (disk-read).
  const loadSessionPacks = useCallback(async (packIds: string[]) => {
    try {
      const res = await window.hjen.filmspacePacksList({ projectSlug: activeProject?.slug });
      if (!res.ok) { setPacks([]); return; }
      const want = new Set(packIds || []);
      setPacks(res.packs.filter(p => want.has(p.packId)).map(p => {
        const cam = (p.camera || {}) as { lens?: { focal_mm?: number }; vocab?: Record<string, unknown>; subject?: { distance_m?: number; height_m?: number }; move?: unknown };
        const v = (cam.vocab || {}) as Record<string, string | number>;
        const readout: Readout = {
          focalMm: (cam.lens?.focal_mm as number) ?? (v.lens_prime as number) ?? 50, lensPrime: (v.lens_prime as number) ?? 50, lensCode: (v.lens_code as string) || '',
          shotCode: (v.shot_size as string) || '—', angleCode: (v.angle as string) || '—',
          distanceM: cam.subject?.distance_m ?? 0, camHeight: 0, figureHeight: cam.subject?.height_m ?? 1.75,
        };
        return { packDir: p.packDir, platePath: p.platePath, files: [], previewFile: p.previewFile, at: p.at, readout, hasMove: !!cam.move };
      }));
    } catch { setPacks([]); }
  }, [activeProject?.slug]);
  const loadSession = useCallback(async (s: SessionMeta) => {
    const res = await window.hjen.filmspaceSessionGet({ projectSlug: activeProject?.slug, sessionId: s.id });
    if (!res.ok) { setError(res.message || 'Could not read that session.'); return; }
    if (!res.state) { setError('That session has no saved stage to load.'); return; }
    restoreState(res.state as SceneState);
    sessionIdRef.current = s.id; setCurrentSessionId(s.id); setSessionName(s.name); sessionNameRef.current = s.name;
    setSel(null); loadSessionPacks(s.packIds); setError(null); flash(`Loaded · ${s.name}`);
    // record the loaded scene as a fresh entry so you can undo back out of the load
    window.setTimeout(() => { restoringRef.current = false; captureHist(); }, 560);
  }, [activeProject?.slug, restoreState, loadSessionPacks, captureHist]);
  const newSession = useCallback(() => {
    restoringRef.current = true;
    window.clearTimeout(histTimer.current); histTimer.current = 0;
    post('newScene');
    setMode('frame'); setFocalMm(50); setDistanceM(3.6); setCamHeight(1.08); setFigureHeight(1.75); setFigureRotation(0); setDuration(5); setArmedId(null); setSel(null); setPoseImg(null); setPoseMsg(null);
    persist({ focalMm: 50, distanceM: 3.6, camHeight: 1.08, figureHeight: 1.75, figureRotation: 0, duration: 5 });
    sessionIdRef.current = null; setCurrentSessionId(null); setSessionName(`Session ${sessions.length + 1}`); setPacks([]); setError(null);
    window.setTimeout(() => { restoringRef.current = false; captureHist(); }, 560);
  }, [post, persist, sessions.length, captureHist]);
  const deleteSession = useCallback(async (s: SessionMeta) => {
    const res = await window.hjen.filmspaceSessionDelete({ projectSlug: activeProject?.slug, sessionId: s.id });
    if (!res.ok) { setError(res.message || 'Could not delete the session.'); return; }
    if (sessionIdRef.current === s.id) { sessionIdRef.current = null; setCurrentSessionId(null); }
    setConfirmDelId(null); await refreshSessions(); flash('Session deleted');
  }, [activeProject?.slug, refreshSessions]);

  // list this project's sessions on mount + when the project changes
  useEffect(() => { refreshSessions(); sessionIdRef.current = null; setCurrentSessionId(null); setSessionName('Session 1'); }, [activeProject?.slug, refreshSessions]);

  // keyboard: ⌘Z undo · ⇧⌘Z redo (matches the Node canvas). Never while typing, and
  // never colliding with the timeline Delete/Backspace or the W/E/R gizmo keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().activeView !== 'filmspace') return;
      if (!((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z'))) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // The HMR sidecar checks its own availability at call time (clear error if the
  // Python venv is missing), so the pose controls are enabled once the stage is up.
  useEffect(() => { setPoseReady(true); }, []);

  // Surface the sidecar's progress lines ("loading the body model…", "finding the
  // figure…", "reading the body…") while a recovery is in flight.
  useEffect(() => {
    const off = window.hjen.onFilmspacePoseProgress((_e, data) => {
      const line = (data?.line || '').trim();
      if (!line) return;
      // show only the human-readable step lines; skip the technical telemetry
      if (/cache dir|model ready|inference|figure box|^done|downloading/i.test(line)) return;
      setPoseMsg(prev => (prev && !prev.ok) ? prev : { ok: true, text: line.charAt(0).toUpperCase() + line.slice(1) });
    });
    return off;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const rr = await window.hjen.filmspacePresetsList();
        if (rr.ok && rr.dir && rr.ids.length) {
          const map: Record<string, string> = {};
          for (const id of rr.ids) map[id] = hjenFileUrl(`${rr.dir}/${id}.png`);
          setThumbs(map);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      const m = e.data; if (!m || !m.type) return;
      if (m.type === 'hjen:fs-scene-state') {
        const d = m.data || {}; const r = sceneReqs.current.get(d.token);
        if (r) { sceneReqs.current.delete(d.token); r({ state: d.state, thumb: d.thumb ?? null }); }
        return;
      }
      if (m.type === 'hjen:fs-ready') {
        setReady(true); setReadout(m.data as Readout);
        post('setFigureHeight', { h: init.current.figureHeight });
        post('setFigureRotation', { deg: init.current.figureRotation });
        post('setFocal', { mm: init.current.focalMm });
        post('setDistance', { d: init.current.distanceM });
        post('setCamHeight', { y: init.current.camHeight });
        post('setDuration', { sec: init.current.duration });
        readyRef.current = true;
        window.setTimeout(() => captureHist(), 300);   // baseline history entry
      }
      if (m.type === 'hjen:fs-readout') { const rr = m.data as Readout; setReadout(rr); setFocalMm(rr.focalMm); setDistanceM(rr.distanceM); setCamHeight(rr.camHeight); scheduleHist(); }
      if (m.type === 'hjen:fs-scene') { setObjs(m.data.objects || []); setSel(m.data.selected || null); scheduleHist(); }
      if (m.type === 'hjen:fs-select') setSel(m.data || null);
      if (m.type === 'hjen:fs-armed') setArmedId(m.data?.presetId ?? null);
      if (m.type === 'hjen:fs-pose-init') { if (!m.data?.ok) { setPosing(false); setPoseMsg({ ok: false, text: m.data?.reason || 'Could not load the on-device pose engine.' }); } }
      if (m.type === 'hjen:fs-pose') {
        setPosing(false);
        const d = m.data as { ok?: boolean; segments?: number; reason?: string };
        if (d?.ok) { setPoseMsg({ ok: true, text: `Body read · ${d.segments ?? 0} joints retargeted` }); flash('Body read from image'); }
        else setPoseMsg({ ok: false, text: d?.reason || 'Could not read a body from that image.' });
      }
      if (m.type === 'hjen:fs-timeline') { setTl(m.data as TimelineState); scheduleHist(); }
      if (m.type === 'hjen:fs-playhead') setTl(prev => ({ ...prev, head: m.data.head }));
      if (m.type === 'hjen:fs-play') { if (m.data?.done) setPlaying(false); }
      if (m.type === 'hjen:fs-preset-thumbs') {
        const items = (m.data?.items || []) as { id: string; dataUrl: string }[];
        try {
          const rr = await window.hjen.filmspacePresetsSave({ items });
          if (rr.ok && rr.dir) {
            const map: Record<string, string> = {};
            for (const it of items) map[it.id] = `${hjenFileUrl(`${rr.dir}/${it.id}.png`)}?t=${Date.now()}`;
            setThumbs(prev => ({ ...prev, ...map }));
          }
        } catch { /* ignore */ }
        thumbsBuilding.current = false;
      }
      if (m.type === 'hjen:fs-capture') {
        try {
          const cap = m.data as CaptureMsg;
          if (cap.error) { setError(cap.error); return; }
          const prompt = buildPrompt(cap.readout, cap.hasMove ? armedId : null);
          const dirRes = await window.hjen.projectToolDir({ projectSlug: activeProject?.slug, tool: 'FilmSpace' });
          if (!dirRes.ok || !dirRes.dir) { setError('Could not resolve the project folder to save the pack.'); return; }
          // Auto-save the session first so this output is never orphaned — creates a
          // session id if this is a fresh, unsaved session; refreshes its snapshot otherwise.
          let sid: string | null = sessionIdRef.current;
          try { sid = await saveSession({ silent: true }); } catch { /* keep whatever id we have */ }
          const res = await window.hjen.filmspacePackSave({
            dir: dirRes.dir, plate: cap.plate, depth: cap.depth, outline: cap.outline, pose: cap.pose,
            camera: cap.camera, prompt, clip: cap.clip || undefined, clipMime: cap.clipMime || undefined,
            sessionId: sid || undefined, projectSlug: activeProject?.slug,
          });
          if (res.ok) {
            setError(null);
            setPacks(prev => [{ packDir: res.packDir, platePath: res.platePath, files: res.files, previewFile: res.previewFile, at: Date.now(), readout: cap.readout, hasMove: !!cap.hasMove }, ...prev]);
            flash(cap.hasMove ? `Move locked · ${res.files.length} files${res.previewFile ? ` · ${res.previewFile}` : ''}` : `Angle locked · ${res.files.length} files`);
            await refreshSessions();   // update the session's pack count
          } else setError(res.message || 'Could not write the Angle Pack.');
        } catch (err) { setError('Could not write the Angle Pack: ' + String((err as Error)?.message || err)); }
        finally { setLocking(false); }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [post, activeProject?.slug, armedId, scheduleHist, captureHist, saveSession, refreshSessions]);

  // ── controls ──
  const dialFocal = (mm: number) => { flushHist(); setFocalMm(mm); persist({ focalMm: mm }); post('setFocal', { mm }); };
  // (delSelKey defined below; keyboard Delete effect placed after handlers)
  const dialDistance = (d: number) => { setDistanceM(d); persist({ distanceM: d }); post('setDistance', { d }); };
  const dialCamHeight = (y: number) => { setCamHeight(y); persist({ camHeight: y }); post('setCamHeight', { y }); };
  const dialFigureHeight = (h: number) => { setFigureHeight(h); persist({ figureHeight: h }); post('setFigureHeight', { h }); };
  const dialFigureRot = (deg: number) => { setFigureRotation(deg); persist({ figureRotation: deg }); post('setFigureRotation', { deg }); };
  const dialDuration = (sec: number) => { flushHist(); setDuration(sec); persist({ duration: sec }); post('setDuration', { sec }); };

  const switchMode = (m2: 'frame' | 'move') => { flushHist(); setMode(m2); post('setMode', { mode: m2 }); };
  const addObject = (t: string) => { flushHist(); post('addObject', { objType: t }); };
  const deleteObject = (id: string) => { flushHist(); post('deleteObject', { id }); };
  const selectObject = (id: string) => post('selectObject', { id });
  const setObjTransform = (patch: Record<string, number>) => { if (sel) post('setObjTransform', { id: sel.id, ...patch }); };
  const setPose = (pose: string) => { flushHist(); post('setPose', { pose }); };
  const resetStage = () => { flushHist(); setFocalMm(50); setDistanceM(3.6); setCamHeight(1.08); setFigureRotation(0); setArmedId(null); setPoseImg(null); setPoseMsg(null); persist({ focalMm: 50, distanceM: 3.6, camHeight: 1.08, figureRotation: 0 }); post('reset'); post('clearCaptureAspect'); };

  // Pose from image — a Python sidecar (4D-Humans / HMR2.0) recovers full SMPL
  // params + posed joints from the one image, so global body orientation (a
  // horizontal dive, a pitched crouch) is recovered, not discarded. We hand the
  // params to the iframe, which retargets the rotations onto the stand-in. Manual
  // FK/rotation refine stays available after.
  const runPose = useCallback(async (path: string) => {
    flushHist();
    setPoseImg(path); setPoseMsg({ ok: true, text: 'Reading the body…' }); setPosing(true);
    try {
      const res = await window.hjen.filmspacePoseHmr({ imagePath: path });
      if (!res.ok) { setPosing(false); setPoseMsg({ ok: false, text: res.message || 'Could not read the body from that image.' }); return; }
      post('poseFromParams', { params: res.params });   // iframe replies hjen:fs-pose
    } catch (err) {
      setPosing(false); setPoseMsg({ ok: false, text: 'Could not read the body: ' + String((err as Error)?.message || err) });
    }
  }, [post, flushHist]);
  // PRIMARY pull — a still the project already made (Generations + Library).
  const openPosePicker = useCallback(() => { if (ready && poseReady && !posing) setPosePickerOpen(true); }, [ready, poseReady, posing]);
  const pickPoseFromProject = useCallback((paths: string[]) => {
    setPosePickerOpen(false);
    if (paths && paths.length) runPose(paths[0]);   // single-source: first pick wins
  }, [runPose]);
  // SECONDARY pull — a file on disk.
  const pickPoseFile = useCallback(async () => {
    if (!ready || !poseReady || posing) return;
    const p = await window.hjen.pickImage({ title: 'Choose a source image to read the pose from' });
    if (p) runPose(p);
  }, [ready, poseReady, posing, runPose]);

  const armPreset = (id: string, motion: Motion) => { flushHist(); post('armPreset', { presetId: id, motion }); setPickerOpen(false); };
  const clearMove = () => { flushHist(); post('clearMove'); setArmedId(null); };
  const play = () => { setPlaying(true); post('playMove', { loop: true }); };
  const stop = () => { setPlaying(false); post('stopMove'); };

  // timeline — the iframe owns the keyframes + selection; these just message it
  const addCamKey = () => { flushHist(); post('addKey', { track: 'camera' }); };
  const addObjKey = () => { if (sel) { flushHist(); post('addKey', { track: sel.id }); } };
  const delSelKey = useCallback(() => { if (selKey) { flushHist(); post('delKey', { track: selKey.track, id: selKey.id }); } }, [selKey, post, flushHist]);
  const clearTimeline = () => { flushHist(); post('clearTimeline'); };
  const seek = (u: number) => { post('seek', { u }); setTl(prev => ({ ...prev, head: u })); };
  const selectKeyframe = (track: string, id: string) => post('seekKey', { track, id });
  const dragKey = (track: string, id: string, t: number) => { post('moveKey', { track, id, t }); setTl(prev => ({ ...prev, head: t })); };

  // Delete / Backspace removes the selected keyframe (unless typing in a field)
  useEffect(() => {
    if (mode !== 'move') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!selKey) return;
      e.preventDefault(); delSelKey();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, selKey, delSelKey]);

  const buildThumbs = () => { if (thumbsBuilding.current) return; thumbsBuilding.current = true; post('renderPresetThumbs', { list: MOVEMENTS.map(mv => ({ id: mv.id, motion: mv.motion })) }); };
  const openPicker = () => { setPickerOpen(true); if (Object.keys(thumbs).length < MOVEMENTS.length) buildThumbs(); };

  const hasMove = !!armedId || tl.camera.length >= 1 || tl.object.length >= 1;
  const lock = () => { if (!ready || locking) return; if (mode === 'move' && !hasMove) { setError('Arm a preset or add camera keyframes before locking a move.'); return; } setLocking(true); setError(null); post('capture'); };

  const r = readout;
  const armed = getMovement(armedId);

  return (
    <div className="fs">
      <header className="fs__bar">
        <button className="fs__back" onClick={() => setActiveView('studio')} title="Back to Studio">‹ Studio</button>
        <div className="fs__head">
          <h1 className="fs__title"><span className="fs__pip" aria-hidden />Film Space</h1>
          <span className="fs__lead">A built studio stage — block a scene, set the camera, lock a frame or a move</span>
        </div>
        <div className="fs__hist" role="group" aria-label="History">
          <button className="fs__histbtn" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-1" /></svg>
          </button>
          <button className="fs__histbtn" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h1" /></svg>
          </button>
        </div>
        <span className="fs__tier">Local · Offline · exact geometry</span>
      </header>

      <div className="fs__body">
        {/* ── left: objects + packs ── */}
        <aside className="fs__gallery">
          <div className="fs__proj">
            <span className="mono-label fs__proj-label">Project</span>
            <b className="selectable">{activeProject?.name || 'No project — general'}</b>
          </div>

          <div className="fs__panel">
            <div className="mono-label fs__eyebrow">Objects<span className="fs__eyebrow-hint">library</span></div>
            <div className="fs__addgrid">
              {OBJECT_TYPES.map(o => (
                <button key={o.type} className="fs-btn fs-btn--add" disabled={!ready} onClick={() => addObject(o.type)}>+ {o.label}</button>
              ))}
            </div>
            <div className="fs__objlist">
              {objs.map((o, i) => (
                <div key={o.id} className={`fs__objrow ${o.selected ? 'fs__objrow--on' : ''}`}>
                  <button className="fs__objsel selectable" onClick={() => selectObject(o.id)} title="Select">
                    <span className="fs__objname">{OBJ_LABEL[o.type] || o.type}</span>
                    <span className="fs__objidx">{String(i + 1).padStart(2, '0')}</span>
                  </button>
                  <button className="fs__objdel" onClick={() => deleteObject(o.id)} title="Delete object"
                    disabled={o.type === 'mannequin' && objs.filter(x => x.type === 'mannequin').length <= 1}>✕</button>
                </div>
              ))}
            </div>

            {sel && (
              <div className="fs__transform">
                <div className="mono-label fs__eyebrow">Transform<span className="fs__eyebrow-hint selectable">{OBJ_LABEL[sel.type] || sel.type}</span></div>
                <Slider label="X" min={-6} max={6} step={0.05} value={sel.px} suffix=" m" onChange={v => setObjTransform({ px: v })} />
                <Slider label="Y" min={0} max={3} step={0.05} value={sel.py} suffix=" m" onChange={v => setObjTransform({ py: v })} />
                <Slider label="Z" min={-6} max={6} step={0.05} value={sel.pz} suffix=" m" onChange={v => setObjTransform({ pz: v })} />
                <Slider label="Heading" min={-180} max={180} step={1} value={sel.ry} suffix="°" onChange={v => setObjTransform({ ry: v })} />
                <p className="fs__note fs__note--tight selectable">Heading turns the object flat (Y). For pitch and roll, use the on-stage Rotate gizmo (E) — it turns on all three axes.</p>
                <Slider label="Scale" min={0.3} max={3} step={0.02} value={sel.scale} onChange={v => setObjTransform({ scale: v })} />
                {sel.isMann && (
                  <>
                    <div className="mono-label fs__eyebrow" style={{ marginTop: 'var(--s-3)' }}>Pose</div>
                    <div className="fs__poses">
                      {POSE_PRESETS.map(p => (
                        <button key={p} className={`fs-chip ${sel.pose === p ? 'fs-chip--on' : ''}`} onClick={() => setPose(p)}>{p.replace('-', ' ')}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="fs__sessions">
            <div className="fs__gal-head">
              <span className="mono-label">Session</span>
              {currentSessionId && <span className="fs__sess-live" title="Locks attach to this session">● live</span>}
            </div>
            <div className="fs__sess-current">
              <input
                className="fs__sess-name" value={sessionName}
                onChange={e => setSessionName(e.target.value)}
                placeholder="Session name" aria-label="Current session name" spellCheck={false} />
              <div className="fs__sess-actions">
                <button className="fs-btn fs-btn--add" disabled={!ready || savingSession} onClick={() => saveSession()}>
                  {savingSession ? <><span className="fs-spin" aria-hidden />Saving…</> : 'Save session'}
                </button>
                <button className="fs-btn fs-btn--ghost" disabled={!ready} onClick={newSession}>New session</button>
              </div>
            </div>

            <div className="fs__gal-head"><span className="mono-label">Saved sessions</span><span className="fs__gal-count">{sessions.length}</span></div>
            <div className="fs__sess-list">
              {sessions.length === 0 && <p className="fs__gal-empty selectable">Saved sessions land here — each keeps its full stage and the packs locked inside it. Save this one, or New session to start clean.</p>}
              {sessions.map(s => (
                <div key={s.id} className={`fs__sess-item ${s.id === currentSessionId ? 'fs__sess-item--on' : ''}`}>
                  <button className="fs__sess-open" onClick={() => loadSession(s)} title="Load this session onto the stage">
                    <span className="fs__sess-thumb">
                      {s.thumbPath ? <img src={`${hjenFileUrl(s.thumbPath)}?t=${s.savedAt}`} alt="" loading="lazy" /> : <span className="fs__sess-glyph" aria-hidden>▤</span>}
                    </span>
                    <span className="fs__sess-meta">
                      <b className="fs__sess-title selectable">{s.name}</b>
                      <span className="fs__sess-sub selectable">{fmtDate(s.savedAt)} · {s.packIds.length} pack{s.packIds.length === 1 ? '' : 's'}</span>
                    </span>
                  </button>
                  {confirmDelId === s.id ? (
                    <span className="fs__sess-confirm">
                      <button className="fs__sess-yes" onClick={() => deleteSession(s)} title="Confirm delete">Delete</button>
                      <button className="fs__sess-no" onClick={() => setConfirmDelId(null)} title="Keep">Keep</button>
                    </span>
                  ) : (
                    <button className="fs__sess-del" onClick={() => setConfirmDelId(s.id)} title="Delete session">✕</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="fs__gal-head"><span className="mono-label">Locked packs</span><span className="fs__gal-count">{packs.length}</span></div>
          <div className="fs__gal-grid">
            {packs.length === 0 && <p className="fs__gal-empty selectable">Locked Angle Packs land here — plate, depth, outline, pose, camera.json, prompt (and a preview for moves).</p>}
            {packs.map(p => (
              <button key={p.packDir} className="fs__gal-item" title={`${p.readout.shotCode} · ${p.readout.angleCode} · ${p.readout.focalMm}mm${p.hasMove ? ' · move' : ''} — reveal in Finder`} onClick={() => window.hjen.openFolder(p.platePath)}>
                <img src={`${hjenFileUrl(p.platePath)}?t=${p.at}`} alt="locked plate" loading="lazy" />
                <span className="fs__gal-tag">{p.hasMove ? '▶ ' : ''}{p.readout.shotCode}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* ── centre: stage + timeline ── */}
        <div className="fs__center">
          <div className="fs__stage">
            <iframe ref={frameRef} className="fs__viewer" title="Film Space studio stage" src="filmspace/index.html" />
            {!ready && <div className="fs__overlay">Building the stage…</div>}
          </div>

          {mode === 'move' && (
            <Timeline
              ready={ready} playing={playing} hasMove={hasMove}
              duration={duration} head={tl.head} selKey={selKey}
              cameraKeys={tl.camera}
              objectTrack={sel ? { id: sel.id, label: OBJ_LABEL[sel.type] || sel.type, keys: tl.object } : null}
              onPlayToggle={playing ? stop : play}
              onSeek={seek} onSelectKey={selectKeyframe} onDragKey={dragKey}
              onAddCamKey={addCamKey} onAddObjKey={addObjKey}
              onDelKey={delSelKey} onClear={clearTimeline}
            />
          )}
        </div>

        {/* ── right: camera + capture ── */}
        <aside className="fs__rail">
          <div className="fs__readout" aria-live="polite">
            <div className="fs__ro-row"><span className="mono-label">Shot</span><b className="selectable">{r ? shotLabel(r.shotCode) : '—'}</b></div>
            <div className="fs__ro-row"><span className="mono-label">Angle</span><b className="selectable">{r ? angleLabel(r.angleCode) : '—'}</b></div>
            <div className="fs__ro-row"><span className="mono-label">Lens</span><b className="selectable">{r ? `${r.focalMm}mm · ${lensLabel(r.lensCode)}` : '—'}</b></div>
            <div className="fs__ro-row"><span className="mono-label">Distance</span><b className="selectable">{r ? `${r.distanceM.toFixed(2)} m` : '—'}</b></div>
          </div>

          {error && <div className="fs__error selectable" role="alert">{error}</div>}

          <div className="fs__seg" data-i={mode === 'frame' ? 0 : 1}>
            <span className="fs__seg-glider" aria-hidden />
            <button className={`fs__seg-btn ${mode === 'frame' ? 'fs__seg-btn--on' : ''}`} onClick={() => switchMode('frame')}>Frame</button>
            <button className={`fs__seg-btn ${mode === 'move' ? 'fs__seg-btn--on' : ''}`} onClick={() => switchMode('move')}>Move</button>
          </div>

          <div className="fs__ctrl">
            <div className="mono-label fs__eyebrow">Lens<span className="fs__eyebrow-hint">focal length</span></div>
            <div className="fs__chips">
              {LENS_PRESETS.map(mm => (
                <button key={mm} className={`fs-chip ${focalMm === mm ? 'fs-chip--on' : ''}`} disabled={!ready} onClick={() => dialFocal(mm)}>{mm}mm</button>
              ))}
            </div>
          </div>

          <div className="fs__ctrl">
            <Slider label="Camera height" min={0.1} max={Math.max(2.6, figureHeight * 2.4)} step={0.01} value={camHeight} suffix=" m" onChange={dialCamHeight} disabled={!ready} />
            <Slider label="Distance" min={0.6} max={16} step={0.05} value={distanceM} suffix=" m" onChange={dialDistance} disabled={!ready} />
          </div>

          <div className="fs__ctrl">
            <div className="mono-label fs__eyebrow">Stand-in<span className="fs__eyebrow-hint">primary</span></div>
            <Slider label="Height" min={1.2} max={2.1} step={0.01} value={figureHeight} suffix=" m" onChange={dialFigureHeight} disabled={!ready} />
            <Slider label="Rotation" min={-180} max={180} step={1} value={figureRotation} suffix="°" onChange={dialFigureRot} disabled={!ready} />
          </div>

          <div className="fs__ctrl">
            <div className="mono-label fs__eyebrow">Pose from image<span className="fs__eyebrow-hint">on-device</span></div>
            {poseImg && (
              <div className="fs__poseimg">
                {/* The pose source doubles as the Camera-Angles source scene, so the
                    export frame must match its aspect. Post the natural dimensions the
                    moment the preview loads so the viewer letterboxes to the real frame. */}
                <img src={hjenFileUrl(poseImg)} alt="pose source"
                  onLoad={e => { const im = e.currentTarget; if (im.naturalWidth && im.naturalHeight) post('setCaptureAspect', { w: im.naturalWidth, h: im.naturalHeight }); }} />
                {posing && <span className="fs__poseimg-load"><span className="fs-spin" aria-hidden />Reading the body…</span>}
              </div>
            )}
            <button className="fs-btn fs-btn--add" disabled={!ready || !poseReady || posing} onClick={openPosePicker}>
              {posing ? <><span className="fs-spin" aria-hidden />Reading the body…</> : (poseImg ? 'Pose from another make' : 'Pose from project makes')}
            </button>
            <div className="fs__pose-alt">
              <button className="fs-btn fs-btn--ghost" disabled={!ready || !poseReady || posing} onClick={pickPoseFile}>From a file…</button>
              {poseImg && !posing && <button className="fs-btn fs-btn--ghost" disabled={!ready || !poseReady} onClick={() => runPose(poseImg)}>Read again</button>}
            </div>
            {poseMsg && <p className={`fs__pose-status ${poseMsg.ok ? 'fs__pose-status--ok' : 'fs__pose-status--err'} selectable`} role="status">{poseMsg.text}</p>}
            {poseImg && <p className="fs__note fs__note--tight selectable">The export frame is now locked to this source's aspect — the stage is letterboxed to it, so plate, output and source share one frame.</p>}
            <p className="fs__note fs__note--tight selectable">
              {poseReady
                ? 'Recovers the whole body on-device from a still the project made — global orientation, facing and every joint — then adopts it on the stand-in to refine with the FK sliders. First read loads the model (a few seconds); reads after are quick.'
                : 'Preparing the offline body engine…'}
            </p>
          </div>

          {mode === 'move' && (
            <div className="fs__ctrl fs__move">
              <div className="mono-label fs__eyebrow">Move<span className="fs__eyebrow-hint">up to 20s</span></div>
              <div className="mono-label fs__sublabel">Duration</div>
              <div className="fs__chips">
                {DURATIONS.map(d => (
                  <button key={d} className={`fs-chip ${duration === d ? 'fs-chip--on' : ''}`} disabled={!ready} onClick={() => dialDuration(d)}>{d}s</button>
                ))}
              </div>
              <div className="mono-label fs__sublabel">Camera preset</div>
              <button className="fs-btn" disabled={!ready} onClick={openPicker}>{armed ? `Preset · ${armed.name}` : 'Choose a movement preset'}</button>
              {armed && <>
                <p className="fs__note fs__note--tight selectable">{armed.description}</p>
                <button className="fs-btn fs-btn--ghost" onClick={clearMove}>Clear preset + timeline</button>
              </>}
              <p className="fs__note fs__note--tight selectable">Presets move the camera around a still character. For subject/object motion, keyframe it on the timeline below.</p>
            </div>
          )}

          <div className="fs__actions">
            <button className="fs-lock" disabled={!ready || locking || (mode === 'move' && !hasMove)} onClick={lock}>
              {locking ? <><span className="fs-spin" aria-hidden />Locking…</> : (mode === 'move' ? '● Lock Move' : '● Lock Angle')}
            </button>
            <button className="fs-btn" disabled={!ready} onClick={resetStage}>Reset stage</button>
          </div>

          {packs[0] && (
            <div className="fs__pack">
              <div className="mono-label">Last pack</div>
              <code className="selectable">{packs[0].packDir.split('/').slice(-3).join('/')}</code>
              <div className="fs__pack-files selectable">{packs[0].files.join(' · ')}</div>
              <button className="fs-btn fs-btn--ghost" onClick={() => window.hjen.openFolder(packs[0].platePath)}>Reveal in Finder</button>
            </div>
          )}

          <p className="fs__note selectable">
            Real geometry, so depth, outline and the COCO-17 pose are exact and made offline. A locked move also writes a camera path and a preview clip the Video engine can obey.
          </p>
        </aside>
      </div>

      {pickerOpen && (
        <div className="fs-presets" role="dialog" aria-label="Movement presets">
          <div className="fs-presets__scrim" onClick={() => setPickerOpen(false)} />
          <div className="fs-presets__panel">
            <div className="fs-presets__head">
              <h2>Camera movements</h2>
              <span className="mono-label selectable">{MOVEMENTS.length} presets · 7 categories · camera moves, character still</span>
              <button className="fs__back" onClick={() => setPickerOpen(false)}>Close</button>
            </div>
            <div className="fs-presets__body">
              {movementsByCategory().map(group => (
                <section key={group.category} className="fs-presets__cat">
                  <div className="mono-label fs-presets__catname">{group.category}<span>{group.items.length}</span></div>
                  <div className="fs-presets__grid">
                    {group.items.map(mv => (
                      <button key={mv.id} className={`fs-preset ${armedId === mv.id ? 'fs-preset--on' : ''}`} onClick={() => armPreset(mv.id, mv.motion)} title={mv.description}>
                        <span className="fs-preset__thumb">
                          {thumbs[mv.id] ? <img src={thumbs[mv.id]} alt={mv.name} loading="lazy" /> : <span className="fs-preset__glyph" aria-hidden>▶</span>}
                        </span>
                        <span className="fs-preset__name selectable">{mv.name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {posePickerOpen && <ProjectAssetPicker onClose={() => setPosePickerOpen(false)} onAttach={pickPoseFromProject} />}

      {toast && <div className="fs__toast">{toast}</div>}
    </div>
  );
}

/**
 * The interactive keyframe timeline. One aligned scrub surface (a ruler + one lane
 * per track) shares a single x-space, so a click or drag anywhere seeks the
 * playhead, and each keyframe diamond drags along its track to retime. Presets and
 * manual keys are the same diamonds — the timeline is the single source of truth.
 */
const TL_TICKS = [0, 0.25, 0.5, 0.75, 1];
function Timeline({ ready, playing, hasMove, duration, head, selKey, cameraKeys, objectTrack,
  onPlayToggle, onSeek, onSelectKey, onDragKey, onAddCamKey, onAddObjKey, onDelKey, onClear }: {
  ready: boolean; playing: boolean; hasMove: boolean; duration: number; head: number; selKey: SelKey | null;
  cameraKeys: KeyRef[]; objectTrack: { id: string; label: string; keys: KeyRef[] } | null;
  onPlayToggle: () => void; onSeek: (u: number) => void; onSelectKey: (track: string, id: string) => void;
  onDragKey: (track: string, id: string, t: number) => void; onAddCamKey: () => void; onAddObjKey: () => void;
  onDelKey: () => void; onClear: () => void;
}) {
  const scrubRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'scrub' | 'key'; track?: string; id?: string } | null>(null);

  const uFromClientX = (clientX: number) => {
    const el = scrubRef.current; if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
  };
  const scrubDown = (e: React.PointerEvent) => {
    if (!ready || playing) return;
    if ((e.target as HTMLElement).closest('.fs__tl-key')) return;   // diamonds self-handle
    e.preventDefault();
    drag.current = { mode: 'scrub' };
    scrubRef.current?.setPointerCapture(e.pointerId);
    onSeek(uFromClientX(e.clientX));
  };
  const scrubMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const u = uFromClientX(e.clientX);
    if (drag.current.mode === 'scrub') onSeek(u);
    else if (drag.current.track && drag.current.id) onDragKey(drag.current.track, drag.current.id, u);
  };
  const scrubUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    try { scrubRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const keyDown = (e: React.PointerEvent, track: string, id: string) => {
    if (!ready || playing) return;
    e.preventDefault(); e.stopPropagation();
    drag.current = { mode: 'key', track, id };
    scrubRef.current?.setPointerCapture(e.pointerId);
    onSelectKey(track, id);
  };
  const keyNudge = (e: React.KeyboardEvent, track: string, id: string, t: number) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onDragKey(track, id, Math.max(0, t - 0.02)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onDragKey(track, id, Math.min(1, t + 0.02)); }
  };

  const lanes: { track: string; label: string; keys: KeyRef[] }[] = [
    { track: 'camera', label: 'Camera', keys: cameraKeys },
    ...(objectTrack ? [{ track: objectTrack.id, label: objectTrack.label, keys: objectTrack.keys }] : []),
  ];

  return (
    <div className="fs__timeline">
      <div className="fs__tl-transport">
        <button className={`fs-btn fs-btn--sm ${playing ? 'fs-btn--done' : ''}`} disabled={!ready || !hasMove} onClick={onPlayToggle}>{playing ? '■ Stop' : '▶ Play'}</button>
        <span className="fs__tl-time selectable">{(head * duration).toFixed(1)}s / {duration}s</span>
        <span className="fs__tl-spacer" />
        <button className="fs-btn fs-btn--sm" disabled={!ready} onClick={onAddCamKey}>◆ Camera key</button>
        {objectTrack && <button className="fs-btn fs-btn--sm" disabled={!ready} onClick={onAddObjKey}>◆ {objectTrack.label} key</button>}
        <button className="fs-btn fs-btn--sm fs-btn--ghost" disabled={!selKey} onClick={onDelKey}>Delete key</button>
        <button className="fs-btn fs-btn--sm fs-btn--ghost" disabled={!ready} onClick={onClear}>Clear</button>
      </div>

      <div className="fs__tl-body">
        <div className="fs__tl-labels">
          <span className="fs__tl-lbl fs__tl-lbl--ruler mono-label">Time</span>
          {lanes.map(l => <span key={l.track} className="fs__tl-lbl mono-label">{l.label}</span>)}
        </div>
        <div className="fs__tl-scrub" ref={scrubRef}
          onPointerDown={scrubDown} onPointerMove={scrubMove} onPointerUp={scrubUp} onPointerCancel={scrubUp}
          role="slider" tabIndex={ready ? 0 : -1} aria-label="Timeline playhead"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(head * 100)}
          onKeyDown={e => { if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, head - 0.02)); } else if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(1, head + 0.02)); } }}>
          <div className="fs__tl-ruler" aria-hidden>
            {TL_TICKS.map(t => (
              <span key={t} className="fs__tl-tick" style={{ left: `${t * 100}%` }}>
                <i className="fs__tl-tickmark" />
                <em className="fs__tl-ticklabel">{(t * duration).toFixed(t === 0 || t === 1 ? 0 : 1)}s</em>
              </span>
            ))}
          </div>
          {lanes.map(l => (
            <div key={l.track} className="fs__tl-lane">
              {l.keys.length === 0 && <span className="fs__tl-lane-empty" aria-hidden />}
              {l.keys.map(k => {
                const on = !!selKey && selKey.track === l.track && selKey.id === k.id;
                return (
                  <button key={k.id} type="button"
                    className={`fs__tl-key ${on ? 'fs__tl-key--on' : ''}`}
                    style={{ left: `${k.t * 100}%` }}
                    title={`${(k.t * duration).toFixed(2)}s — drag to retime`}
                    aria-label={`${l.label} keyframe at ${(k.t * duration).toFixed(2)} seconds`}
                    onPointerDown={e => keyDown(e, l.track, k.id)}
                    onKeyDown={e => keyNudge(e, l.track, k.id, k.t)} />
                );
              })}
            </div>
          ))}
          <span className="fs__tl-playhead" style={{ left: `${head * 100}%` }} aria-hidden />
        </div>
      </div>
    </div>
  );
}

/** A labelled range control (token-driven; honours the Pro appearance). */
function Slider({ label, min, max, step, value, onChange, suffix, disabled }:
  { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; suffix?: string; disabled?: boolean }) {
  return (
    <label className="fs__slider">
      <span className="fs__slider-top"><span className="mono-label">{label}</span><span className="fs__slider-val selectable">{Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}{suffix || ''}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => onChange(parseFloat(e.target.value))} />
    </label>
  );
}
