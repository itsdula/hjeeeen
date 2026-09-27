import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import CutsGenPanel from './CutsGenPanel';
import {
  analyzeVideo, verifyCuts, watchAndGroup, analyzeSpeech, identifyPeople, fuseGroups, pickKeyframes,
  splitShotAt, mergeWithPrev, setKeyframeAt, linkShots, unlinkShots, suggestLinks,
  renamePerson, deletePerson, addShotToPerson, removeShotFromPerson, mergePeople,
  verifyGroups, readDna, readStory, writeBriefs,
  saveSession, listSessions, loadSession, deleteSession,
  makeTrack, defaultTracks,
  type CutsAnalysis, type CutShot, type CutScene, type CutPerson, type CutSessionMeta, type LinkSuggestion, type SpeechSegment, type GroupVerdict,
  type CutTrack, type CutClip,
} from '../lib/cuts/engine';

// One "grouping strength" knob → the two embedding thresholds. Higher = merge
// more (lower cosine bar). Face is a touch more lenient than appearance.
const thresholds = (strength: number) => ({
  faceThr: 0.55 - strength * 0.20,   // 0.55 … 0.35
  personThr: 0.70 - strength * 0.20, // 0.70 … 0.50
});

// Undo/redo captures only the mutable parts of the analysis.
type CutSnapshot = { shots: CutShot[]; scenes: CutScene[] };
const snapClone = (a: CutsAnalysis): CutSnapshot => ({
  shots: structuredClone(a.shots), scenes: structuredClone(a.scenes),
});
import '../styles/cuts.css';
import '../styles/cuts-sorbet.css';

const fileUrl = (p: string) => (p ? `hjen-file://${encodeURI(p)}` : '');
// A clip thumb is only a usable poster if it's an IMAGE — never a video file.
// (The gallery falls its thumb back to the media path; older sessions persisted
// that .mp4 as the clip thumb, which an <img> can't render → broken icon.)
const isImageThumb = (p?: string) => !!p && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(p);
const fmt = (s: number) => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

type Busy = null | 'analyze' | 'verify' | 'group' | 'frames' | 'speech' | 'people' | 'check' | 'dna' | 'story' | 'brief';

// Sorbet Grid candy palette — the 5 sanctioned NIGHT-SHIFT hues, in order.
// A scene's hue = CANDY_HUES[sceneOrderIndex % 5]; a shot inherits its scene's
// hue so its Cuts-lane segment matches its Scenes-rail dot (see hueForShot).
const CANDY_HUES = ['#8455EA', '#1AAEFC', '#F07A3C', '#35C4A8', '#F5E642'] as const;

// Lane row heights (px) — read-only lanes + edit tracks. Heads mirror these inline.
const LANE_H = { strip: 56, shots: 44, keys: 64, speech: 34, video: 64, audio: 40 } as const;
const HIDDEN_H = 18;   // collapsed row height when a lane/track is hidden
const DIV_H = 10;      // separator between edit tracks and read-only lanes

// A scoped <audio> for one active audio-track clip. It plays NATIVELY in sync
// with the master (aligned once on mount / play-flip; hard-seek only while
// paused/scrubbing — same discipline as the video overlay, no per-frame seek).
// Mounted only while its clip covers the playhead on a visible track → a hidden
// track never renders one → it is silent.
function ClipAudio({ src, clipStart, srcIn, playhead, playing, muted }: {
  src: string; clipStart: number; srcIn: number; playhead: number; playing: boolean; muted: boolean;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  // Source media time at the playhead honours the clip's trimmed in-point.
  const targetT = () => Math.max(0, srcIn + (playhead - clipStart));
  // Strictly bound to the transport: play only when playing+unmuted, else pause.
  useEffect(() => {
    const a = ref.current; if (!a) return;
    a.muted = muted;
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      try { a.currentTime = targetT(); } catch { /* ignore */ }
      if (playing && !muted) { void a.play().then(() => { a.dataset.playok = '1'; }).catch(err => { a.dataset.playok = '0'; a.dataset.playerr = String((err && err.name) || err); }); }
      else a.pause();
    };
    if (a.readyState >= 1) apply();
    else a.addEventListener('loadedmetadata', apply, { once: true });
    // Cancel a deferred play + drop the listener when deps change/unmount, so a
    // late-loading element can never start after the transport has moved on.
    return () => { cancelled = true; a.removeEventListener('loadedmetadata', apply); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, muted, srcIn, clipStart]);
  useEffect(() => {
    if (playing) return;
    const a = ref.current; if (!a) return;
    const t = targetT();
    if (Math.abs(a.currentTime - t) > 0.12) { try { a.currentTime = t; } catch { /* ignore */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, playing, clipStart, srcIn]);
  // On a REAL unmount (clip scrubbed/played out of its window, or removed) the
  // <audio> detaches — a detached media element keeps playing in Chromium, so
  // pause it so sound truly stops and the transport stays authoritative.
  // IMPORTANT: do NOT removeAttribute('src')/load() here. Under React StrictMode
  // the mount effect runs setup→cleanup→setup on the SAME live element, so
  // stripping the src would leave the <audio> permanently source-less
  // (readyState 0) and silent — that silenced every dropped clip. pause() alone
  // stops a detached element without destroying the React-managed src.
  useEffect(() => {
    const a = ref.current;
    return () => { try { a?.pause(); } catch { /* ignore */ } };
  }, []);
  return <audio ref={ref} src={src} className="cut-aud" preload="auto" />;
}

// The transcript panel — VO + dialogue segments, copyable, click-to-seek.
function TranscriptList({ speech, selSpeech, setSel, copyText }: {
  speech: SpeechSegment[]; selSpeech: number | null; setSel: (i: number) => void; copyText: (t: string) => void;
}) {
  const all = speech.map(s => `[${s.type === 'vo' ? 'VO' : 'DL'} ${fmt(s.start)}] ${s.speaker ? s.speaker + ': ' : ''}${s.text}`).join('\n');
  return (
    <div className="cut-tr__list">
      <div className="cut-tr__listhead">
        <span className="mono-label">TRANSCRIPT · {speech.length}</span>
        <button className="cut-tool" onClick={() => copyText(all)} title="Copy full transcript">Copy all</button>
      </div>
      {speech.map((s, i) => (
        <div key={i} className={`cut-trrow ${i === selSpeech ? 'is-sel' : ''}`} onClick={() => setSel(i)}>
          <span className={`cut-say__tag ${s.type}`}>{s.type === 'vo' ? 'VO' : 'DL'}</span>
          <span className="cut-trrow__tc mono-label">{fmt(s.start)}</span>
          <span className="cut-copytext cut-trrow__t">{s.speaker ? <b>{s.speaker}: </b> : null}{s.text}</span>
        </div>
      ))}
    </div>
  );
}

export default function CutsView() {
  const activeProject = useStore(s => s.projects.find(p => p.id === s.activeProjectId));
  const projectSlug = activeProject?.slug;
  const activeView = useStore(s => s.activeView);
  const genProject = useMemo(
    () => (activeProject ? { id: activeProject.id, slug: activeProject.slug, name: activeProject.name } : null),
    [activeProject],
  );

  const [videoPath, setVideoPath] = useState<string>('');
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [videoSource, setVideoSource] = useState<string>('');   // YouTube URL if fetched, else '' (local file)
  const [url, setUrl] = useState<string>('');
  const [fetching, setFetching] = useState(false);
  const [sessMenuOpen, setSessMenuOpen] = useState(false);      // session manager popover
  const [sessions, setSessions] = useState<CutSessionMeta[]>([]);
  const [analysis, setAnalysis] = useState<CutsAnalysis | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState<string>('Pick a video to start.');
  const [threshold, setThreshold] = useState(0.30);
  const [pxs, setPxs] = useState(48);           // pixels per second (zoom)
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [selShot, setSelShot] = useState<number | null>(null);
  const [selSpeech, setSelSpeech] = useState<number | null>(null);   // index into analysis.speech
  const [multiSel, setMultiSel] = useState<Set<number>>(new Set());
  const [linkStrength, setLinkStrength] = useState(0.4);
  const [step, setStep] = useState<string>('cuts');   // selected pipeline step for the Step ▾ + Go control
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [filterScene, setFilterScene] = useState<string | null>(null);  // null = show all
  const [sidePanel, setSidePanel] = useState<'scenes' | 'people'>('scenes');  // left list tab
  const [filterPerson, setFilterPerson] = useState<string | null>(null);      // person id, null = all
  const [editPeople, setEditPeople] = useState(false);                        // manual edit mode for people groups
  const [personSel, setPersonSel] = useState<Set<string>>(new Set());         // people checked for merge
  const [verdicts, setVerdicts] = useState<Record<string, GroupVerdict>>({}); // QA results keyed by group id
  const [verifyFrames, setVerifyFrames] = useState<Record<number, string>>({}); // fresh frame per shot from the check
  const [reviewKind, setReviewKind] = useState<'scene' | 'person' | null>(null); // which review overlay is open
  const [editing, setEditing] = useState(false);
  const [undoStack, setUndoStack] = useState<CutSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<CutSnapshot[]>([]);
  const [tick, setTick] = useState(0);          // force re-render after in-place shot mutation
  const [selClip, setSelClip] = useState<string | null>(null);       // selected edit clip
  const [dropTrack, setDropTrack] = useState<string | null>(null);   // track being dragged over

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number>(0);
  const headsRef = useRef<HTMLDivElement | null>(null);              // heads column, vertical-scroll synced
  const clipDrag = useRef<{
    trackId: string; clipId: string; mode: 'move' | 'trim-l' | 'trim-r';
    grabDx: number; x0: number; start0: number; dur0: number; srcIn0: number;
  } | null>(null);
  const overlayVideoRef = useRef<HTMLVideoElement | null>(null);     // monitor overlay clip (video kind)
  // Refs so the playhead line + timecode move at 60fps WITHOUT a React re-render
  // every frame (state is throttled to ~10Hz during playback for smoothness).
  const playheadElRef = useRef<HTMLDivElement | null>(null);
  const tcRef = useRef<HTMLSpanElement | null>(null);
  const pxsRef = useRef(pxs);
  const durationRef = useRef(0);

  // ── Resizable layout — panel width + stage/timeline split (persisted) ──
  const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const [panelW, setPanelW] = useState(() => { const s = Number(localStorage.getItem('hjen.cuts.panelW')); return clampN(Number.isFinite(s) && s > 0 ? s : 384, 300, 680); });
  const [stageH, setStageH] = useState(() => { const s = Number(localStorage.getItem('hjen.cuts.stageH')); return clampN(Number.isFinite(s) && s > 0 ? s : 300, 160, 620); });

  const startPanelResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = panelW; let latest = startW;
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => { latest = clampN(startW + (startX - ev.clientX), 300, 680); setPanelW(latest); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      try { localStorage.setItem('hjen.cuts.panelW', String(latest)); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }, [panelW]);

  const startStageResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY, startH = stageH; let latest = startH;
    document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => { latest = clampN(startH + (ev.clientY - startY), 160, 620); setStageH(latest); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      try { localStorage.setItem('hjen.cuts.stageH', String(latest)); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }, [stageH]);

  const duration = analysis?.duration || 0;
  durationRef.current = duration;
  pxsRef.current = pxs;
  const shots = analysis?.shots || [];
  const tracks = useMemo(() => analysis?.tracks || [], [analysis, tick]);
  const scenes = analysis?.scenes || [];
  const people = useMemo(() => analysis?.people || [], [analysis, tick]);
  const personById = useMemo(() => {
    const m = new Map<string, CutPerson>();
    for (const p of people) m.set(p.id, p);
    return m;
  }, [people]);
  const speech = useMemo(() => analysis?.speech || [], [analysis, tick]);
  const voSegs = useMemo(() => speech.filter(s => s.type === 'vo'), [speech]);
  const dlSegs = useMemo(() => speech.filter(s => s.type === 'dialogue'), [speech]);
  const copyText = useCallback((t: string) => { try { void navigator.clipboard?.writeText(t); } catch { /* ignore */ } }, []);
  const selSeg = selSpeech != null ? speech[selSpeech] : undefined;
  const sceneById = useMemo(() => {
    const m = new Map<string, { color: string; label: string }>();
    for (const sc of scenes) m.set(sc.id, { color: sc.color, label: sc.label });
    return m;
  }, [scenes, tick]);

  // ── Sorbet hue keying (presentation only — no engine data changed) ──
  // Deterministic scene index → one of the 5 candy hues. The SAME hue is fed to
  // the Scenes-rail dot AND the Cuts-lane segment / keyframe frame for that
  // scene's shots, so a clip's colour corresponds to its scene's dot.
  const sceneOrder = useMemo(() => {
    const m = new Map<string, number>();
    scenes.forEach((sc, i) => m.set(sc.id, i));
    return m;
  }, [scenes, tick]);
  const hueForScene = useCallback((sceneId?: string | null): string | undefined => {
    if (sceneId == null) return undefined;
    const i = sceneOrder.get(sceneId);
    return i == null ? undefined : CANDY_HUES[i % CANDY_HUES.length];
  }, [sceneOrder]);
  // A shot with no scene yet (pre-grouping) still gets a candy hue by shot index,
  // so the timeline reads colourful before Agent 1 runs.
  const hueForShot = useCallback((s: CutShot): string =>
    hueForScene(s.sceneId) ?? CANDY_HUES[((s.i - 1) % CANDY_HUES.length + CANDY_HUES.length) % CANDY_HUES.length],
  [hueForScene]);

  // ── Playhead ↔ <video> sync ──────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    let lastState = 0;
    const loop = () => {
      const v = videoRef.current;
      if (v) {
        const t = v.currentTime;
        // Move the visual playhead + timecode every frame via the DOM (no React
        // re-render), so the line tracks the video at 60fps.
        if (playheadElRef.current) playheadElRef.current.style.left = `${t * pxsRef.current}px`;
        if (tcRef.current) tcRef.current.textContent = `${fmt(t)} / ${fmt(durationRef.current)}`;
        // Throttle the React state that drives heavy logic (overlay switching,
        // inspector) to ~10Hz — the source of the previous per-frame jank.
        const now = performance.now();
        if (now - lastState >= 100) { lastState = now; setPlayhead(t); }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(duration || 0, t));
    setPlayhead(clamped);
    if (videoRef.current) videoRef.current.currentTime = clamped;
  }, [duration]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) { void v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  }, []);

  // ── Sessions (Cuts Engine projects) ──────────────────────────────
  const refreshSessions = useCallback(async () => {
    setSessions(await listSessions(projectSlug));
  }, [projectSlug]);

  // Save current state + refresh the session list. Called after every change.
  const persist = useCallback(async (a: CutsAnalysis | null) => {
    if (!a) return;
    await saveSession(a);
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => { void refreshSessions(); }, [refreshSessions]);

  // Explicit save (also runs automatically after every change).
  const doSave = useCallback(async () => {
    if (!analysis) { setStatus('Nothing to save yet — Detect cuts first.'); return; }
    await persist(analysis);
    setStatus(`Saved ✓  ${analysis.title || analysis.videoPath}`);
  }, [analysis, persist]);

  // Rename the session (the project name shown in "Open session…").
  const onRename = useCallback((name: string) => {
    if (!analysis) return;
    analysis.title = name; setTick(t => t + 1);
  }, [analysis]);

  // ── Undo / redo — call pushHistory() BEFORE any mutating edit ─────
  const pushHistory = useCallback(() => {
    if (!analysis) return;
    const snap = snapClone(analysis);
    setUndoStack(s => [...s, snap].slice(-60));
    setRedoStack([]);
  }, [analysis]);

  const applySnap = useCallback((snap: CutSnapshot) => {
    if (!analysis) return;
    analysis.shots = structuredClone(snap.shots);
    analysis.scenes = structuredClone(snap.scenes);
    // Keep selection/filter valid against the restored state.
    setSelShot(sel => (sel != null && analysis.shots.some(s => s.i === sel) ? sel : null));
    setFilterScene(f => (f != null && analysis.scenes.some(s => s.id === f) ? f : null));
    setTick(t => t + 1);
    void persist(analysis);
  }, [analysis, persist]);

  const undo = useCallback(() => {
    if (!analysis || !undoStack.length) return;
    const cur = snapClone(analysis);
    const snap = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    setRedoStack(r => [...r, cur].slice(-60));
    applySnap(snap);
    setStatus('Undo.');
  }, [analysis, undoStack, applySnap]);

  const redo = useCallback(() => {
    if (!analysis || !redoStack.length) return;
    const cur = snapClone(analysis);
    const snap = redoStack[redoStack.length - 1];
    setRedoStack(r => r.slice(0, -1));
    setUndoStack(s => [...s, cur].slice(-60));
    applySnap(snap);
    setStatus('Redo.');
  }, [analysis, redoStack, applySnap]);

  // Keyboard: Space play/pause · ←/→ step frame · ⇧←/⇧→ cut-to-cut · ⌘Z/⌘⇧Z undo/redo.
  // Bound only while this view is active; ignored while typing in an input.
  useEffect(() => {
    if (activeView !== 'cuts') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (!e.metaKey && !e.ctrlKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); setPxs(p => Math.min(240, Math.round(p * 1.25))); return; }
      if (!e.metaKey && !e.ctrlKey && (e.key === '-' || e.key === '_')) { e.preventDefault(); setPxs(p => Math.max(8, Math.round(p * 0.8))); return; }
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
      const v = videoRef.current; if (!v) return;
      const list = analysis?.shots || [];
      const step = 1 / (analysis?.fps || 25);
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) { const nx = list.find(s => s.start > v.currentTime + 0.02); if (nx) seek(nx.start + 0.02); }
        else seek(v.currentTime + step);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) { const pv = [...list].reverse().find(s => s.start < v.currentTime - 0.05); seek(pv ? pv.start + 0.02 : 0); }
        else seek(v.currentTime - step);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeView, analysis, togglePlay, seek, undo, redo]);

  const onOpenSession = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    const meta = sessions.find(s => s.sessionId === sessionId);   // each session knows its own bucket
    setBusy('analyze'); setStatus('Opening session…');
    try {
      const a = await loadSession(meta?.projectSlug ?? projectSlug, sessionId);
      if (a) {
        setAnalysis(a); setVideoPath(a.videoPath); setVideoTitle(a.title || ''); setVideoSource(a.sourceUrl || '');
        setFilterScene(null); setSelShot(null); setPlayhead(0); setUndoStack([]); setRedoStack([]);
        setStatus(`Opened: ${a.title || a.videoPath} — ${a.shots.length} shots.`);
      } else { setStatus('Could not open session.'); }
    } catch (e: any) { setStatus(`Open failed: ${e?.message || e}`); }
    finally { setBusy(null); }
  }, [projectSlug, sessions]);

  const onDeleteSession = useCallback(async (m: CutSessionMeta) => {
    const name = m.title || m.sessionId;
    if (!window.confirm(`Delete session "${name}"? This removes its frames and data permanently.`)) return;
    try {
      await deleteSession(m.projectSlug ?? projectSlug, m.sessionId);
      await refreshSessions();
      if (analysis?.sessionId === m.sessionId) { setAnalysis(null); setVideoPath(''); setVideoTitle(''); setVideoSource(''); }
      setStatus(`Deleted session "${name}".`);
    } catch (e: any) { setStatus(`Delete failed: ${e?.message || e}`); }
  }, [projectSlug, analysis, refreshSessions]);

  // Recover the YouTube link for older sessions that never stored one (read it
  // back from the yt-dlp .info.json beside the fetched video). Upgrades the
  // Source button from "Reveal file" to "YouTube" the moment the clip is viewed.
  useEffect(() => {
    if (!videoPath || videoSource) return;
    let cancelled = false;
    void window.hjen.cutsSource({ videoPath }).then(r => {
      if (cancelled || !r?.ok || !r.url) return;
      setVideoSource(r.url);
      if (analysis && analysis.videoPath === videoPath) { analysis.sourceUrl = r.url; void persist(analysis); }
    });
    return () => { cancelled = true; };
  }, [videoPath, videoSource, analysis, persist]);

  // Show where this video came from — open the YouTube link, or reveal the file.
  const onOpenSource = useCallback(async () => {
    if (videoSource) { void window.hjen.openExternalUrl(videoSource); return; }
    if (videoPath) {
      const r = await window.hjen.cutsSource({ videoPath });   // last-chance resolve on click
      if (r?.ok && r.url) { setVideoSource(r.url); void window.hjen.openExternalUrl(r.url); }
      else void window.hjen.revealInFinder(videoPath);
    }
  }, [videoSource, videoPath]);

  // ── Stage 0 · pick + analyze ─────────────────────────────────────
  const onPick = useCallback(async () => {
    const p = await window.hjen.pickVideoFile();
    if (p) {
      setVideoPath(p); setVideoTitle(p.split('/').pop()?.replace(/\.[^.]+$/, '') || ''); setVideoSource('');
      setAnalysis(null); setPlayhead(0); setSelShot(null); setStatus('Ready. Click "Detect cuts".');
    }
  }, []);

  const onFetch = useCallback(async () => {
    const u = url.trim();
    if (!u) return;
    setFetching(true); setStatus('Fetching from YouTube… (may take a minute)');
    try {
      const r = await window.hjen.cutsFetch({ url: u, projectSlug });
      if (r.ok && r.videoPath) {
        setVideoPath(r.videoPath); setVideoTitle(r.title || ''); setVideoSource(u); setAnalysis(null); setPlayhead(0); setSelShot(null);
        setStatus(`${r.cached ? 'Already cached' : 'Fetched'}: ${r.title || u} — click "Detect cuts".`);
      } else { setStatus(r.message || 'Fetch failed.'); }
    } catch (e: any) { setStatus(`Fetch failed: ${e?.message || e}`); }
    finally { setFetching(false); }
  }, [url, projectSlug]);

  const onAnalyze = useCallback(async () => {
    if (!videoPath) return;
    setBusy('analyze'); setStatus('Cutting… (detecting cuts + extracting frames)');
    try {
      const a = await analyzeVideo({ videoPath, projectSlug, threshold, title: videoTitle || undefined });
      if (videoSource) a.sourceUrl = videoSource;   // remember where this video came from
      setAnalysis(a); setFilterScene(null); setSelShot(null); setUndoStack([]); setRedoStack([]);
      void persist(a);
      setStatus(`Done: ${a.shots.length} shots · ${fmt(a.duration)} · ${a.width}×${a.height} @ ${a.fps}fps · saved`);
    } catch (e: any) {
      setStatus(`Analyze failed: ${e?.message || e}`);
    } finally { setBusy(null); }
  }, [videoPath, projectSlug, threshold, videoTitle, videoSource, persist]);

  // Verify cuts by comprehension — MERGE false cuts + SPLIT missed cuts.
  const onVerify = useCallback(async () => {
    if (!analysis) return;
    setBusy('verify'); pushHistory();
    setStatus('Verifying cuts… (the mind checks for false cuts AND missed cuts)');
    try {
      const { removed, added } = await verifyCuts(analysis);
      setFilterScene(null); setSelShot(null); setMultiSel(new Set()); setSuggestions([]);
      setTick(t => t + 1); void persist(analysis);
      const parts: string[] = [];
      if (removed) parts.push(`merged ${removed} false cut${removed > 1 ? 's' : ''}`);
      if (added) parts.push(`added ${added} missed cut${added > 1 ? 's' : ''}`);
      setStatus(parts.length
        ? `Verify: ${parts.join(' · ')} → ${analysis.shots.length} shots. Re-run Agent 1.`
        : 'All cuts look correct — nothing to merge or split.');
    } catch (e: any) { setStatus(`Verify failed: ${e?.message || e}`); }
    finally { setBusy(null); }
  }, [analysis, persist, pushHistory]);

  // VO / Dialogue layers — the mind listens + watches, splits speech.
  const onSpeech = useCallback(async () => {
    if (!analysis) return;
    setBusy('speech'); setStatus('Listening… (transcribing VO & dialogue)');
    try {
      const segs = await analyzeSpeech(analysis);
      setTick(t => t + 1); void persist(analysis);
      const vo = segs.filter(s => s.type === 'vo').length, dl = segs.length - vo;
      setStatus(`Speech: ${vo} voice-over · ${dl} dialogue segment${dl === 1 ? '' : 's'}.`);
    } catch (e: any) { setStatus(`Speech failed: ${e?.message || e}`); }
    finally { setBusy(null); }
  }, [analysis, persist]);

  // ── Stage 1 · Agent 1 = the mind WATCHES the ad and groups by understanding ──
  const onGroup = useCallback(async () => {
    if (!analysis) return;
    setBusy('group'); setFilterScene(null); setMultiSel(new Set()); setSuggestions([]); pushHistory();
    try {
      setStatus('Agent 1 · watching the ad… (sending the video to the mind — ~30–60s)');
      const sc = await watchAndGroup(analysis);
      setTick(t => t + 1); void persist(analysis);
      const multi = sc.filter(s => s.shots.length > 1).length;
      setStatus(`Agent 1 watched the ad → ${sc.length} groups · ${multi} multi-shot. ⌘-click + Link to correct.`);
    } catch (e: any) { setStatus(`Watch failed: ${e?.message || e}`); }
    finally { setBusy(null); }
  }, [analysis, persist, pushHistory]);

  // ── People = the mind identifies the MAIN characters across the whole ad ──
  const onPeople = useCallback(async () => {
    if (!analysis) return;
    setBusy('people'); setFilterPerson(null); pushHistory();
    try {
      setStatus('Identifying people… (the mind watches the ad for its main characters — ~30–60s)');
      const ppl = await identifyPeople(analysis);
      setTick(t => t + 1); void persist(analysis);
      setSidePanel('people');
      setStatus(ppl.length ? `Found ${ppl.length} main character${ppl.length > 1 ? 's' : ''}. Pick one on the left to isolate their shots.` : 'No recurring main character found in this ad.');
    } catch (e: any) { setStatus(`People failed: ${e?.message || e}`); }
    finally { setBusy(null); }
  }, [analysis, persist, pushHistory]);

  // ── Phase 0 · read the ad's shared LOOK (DNA) ──
  const onReadDna = useCallback(async () => {
    if (!analysis) return;
    setBusy('dna'); setStatus('Reading the ad look… (the DP reverse-reads the grade, optics & light)');
    try {
      const d = await readDna(analysis);
      setTick(t => t + 1); void persist(analysis);
      setStatus(`Look read: ${d.intent || d.mood || 'DNA captured'} — injected into every master prompt.`);
    } catch (e: any) { setStatus(`Look read failed: ${e?.message || e}`); }
    finally { setBusy(null); }
  }, [analysis, persist]);

  // ── Comprehend the whole ad (the wide eye) — narrative + world + context ──
  const onReadStory = useCallback(async () => {
    if (!analysis) return;
    setBusy('story'); setStatus('Understanding the ad… (watching end to end for story, world & continuity)');
    try {
      const s = await readStory(analysis);
      setTick(t => t + 1); void persist(analysis);
      setStatus(`Ad understood: ${s.synopsis ? s.synopsis.slice(0, 80) : 'comprehension captured'}… — feeds every master prompt.`);
    } catch (e: any) { setStatus(`Comprehension failed: ${e?.message || e}`); }
    finally { setBusy(null); }
  }, [analysis, persist]);

  // ── Phase 2/3 · deep description + master prompt per shot ──
  const onWriteBriefs = useCallback(async () => {
    if (!analysis) return;
    setBusy('brief');
    if (!analysis.dna) setStatus('Tip: run "Read look" first for a shared look. Writing prompts…');
    try {
      await writeBriefs(analysis, (done, total) => { setStatus(`Writing master prompts… ${done}/${total}`); setTick(t => t + 1); });
      setTick(t => t + 1); void persist(analysis);
      const n = analysis.shots.filter(s => s.brief?.prompt).length;
      setStatus(`Master prompts written for ${n}/${analysis.shots.length} shots. Select a shot to read its prompt.`);
    } catch (e: any) { setStatus(`Writing prompts failed: ${e?.message || e}`); }
    finally { setBusy(null); }
  }, [analysis, persist]);

  // ── Manual edits to the People groups (the mind's grouping is a draft) ──
  const onRenamePerson = useCallback((id: string, name: string) => {
    if (!analysis) return; renamePerson(analysis, id, name); setTick(t => t + 1); void persist(analysis);
  }, [analysis, persist]);
  const onDeletePerson = useCallback((id: string) => {
    if (!analysis) return;
    deletePerson(analysis, id);
    if (filterPerson === id) setFilterPerson(null);
    setPersonSel(prev => { const n = new Set(prev); n.delete(id); return n; });
    setTick(t => t + 1); void persist(analysis);
  }, [analysis, persist, filterPerson]);
  const onAddShotToPerson = useCallback((id: string, n: number) => {
    if (!analysis) return; addShotToPerson(analysis, id, n); setTick(t => t + 1); void persist(analysis);
  }, [analysis, persist]);
  const onRemoveShotFromPerson = useCallback((id: string, n: number) => {
    if (!analysis) return; removeShotFromPerson(analysis, id, n); setTick(t => t + 1); void persist(analysis);
  }, [analysis, persist]);
  const togglePersonSel = useCallback((id: string) => {
    setPersonSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const onMergePeople = useCallback(() => {
    if (!analysis || personSel.size < 2) return;
    const kept = mergePeople(analysis, [...personSel]);
    setPersonSel(new Set());
    if (kept) setFilterPerson(kept);
    setTick(t => t + 1); void persist(analysis);
    setStatus(`Merged ${personSel.size} people into one.`);
  }, [analysis, persist, personSel]);

  // ── QA · verify a grouping against its own images ──
  const onCheck = useCallback(async (kind: 'scene' | 'person') => {
    if (!analysis) return;
    setBusy('check'); setStatus(`Checking ${kind === 'scene' ? 'scenes' : 'people'}… (the mind compares each group to its frames)`);
    try {
      const { verdicts: v, frames } = await verifyGroups(analysis, kind);
      setVerdicts(prev => { const n = { ...prev }; for (const gv of v) n[gv.id] = gv; return n; });
      setVerifyFrames(prev => ({ ...prev, ...frames }));
      setTick(t => t + 1); void persist(analysis);   // fresh frames were folded onto shots
      setReviewKind(kind);
      const flagged = v.reduce((m, gv) => m + gv.outliers.length, 0);
      setStatus(flagged ? `Check done — ${flagged} suspect shot${flagged > 1 ? 's' : ''} across ${v.filter(x => x.outliers.length).length} group(s). Review below.` : 'Check done — every group looks coherent.');
    } catch (e: any) { setStatus(`Check failed: ${e?.message || e}`); }
    finally { setBusy(null); }
  }, [analysis, persist]);

  // Remove a flagged shot from its group (scene → make solo; person → drop it).
  const onFixOutlier = useCallback((kind: 'scene' | 'person', groupId: string, shot: number) => {
    if (!analysis) return;
    if (kind === 'scene') unlinkShots(analysis, [shot]);
    else removeShotFromPerson(analysis, groupId, shot);
    // drop it from the stored verdict so the review reflects the fix
    setVerdicts(prev => {
      const gv = prev[groupId]; if (!gv) return prev;
      return { ...prev, [groupId]: { ...gv, outliers: gv.outliers.filter(o => o.shot !== shot) } };
    });
    setTick(t => t + 1); void persist(analysis);
  }, [analysis, persist]);

  // Live re-cluster from cached vectors when the strength knob moves (no re-embed).
  const reclusterAt = useCallback((strength: number) => {
    if (!analysis || !analysis.shots.some(s => s.emb)) return;
    const { faceThr, personThr } = thresholds(strength);
    const sc = fuseGroups(analysis, faceThr, personThr);
    setSuggestions(suggestLinks(analysis));
    setFilterScene(null); setTick(t => t + 1); void persist(analysis);
    setStatus(`Re-grouped: ${sc.length} groups · ${sc.filter(s => s.shots.length > 1).length} multi-shot.`);
  }, [analysis, persist]);

  // Confirm one suggested link (a↔b) → merge into one group + refresh suggestions.
  const onLinkPair = useCallback((a: number, b: number) => {
    if (!analysis) return;
    pushHistory();
    linkShots(analysis, [a, b]);
    setSuggestions(suggestLinks(analysis));
    setTick(t => t + 1); void persist(analysis);
  }, [analysis, persist, pushHistory]);

  const dismissSuggestion = useCallback((a: number, b: number) => {
    setSuggestions(prev => prev.filter(s => !(s.a === a && s.b === b)));
  }, []);

  // ── Manual linking — force selected shots into one group ─────────
  const onLinkSelected = useCallback(() => {
    if (!analysis || multiSel.size < 2) return;
    pushHistory();
    linkShots(analysis, [...multiSel]);
    setSuggestions(suggestLinks(analysis));
    setMultiSel(new Set()); setTick(t => t + 1); void persist(analysis);
    setStatus(`Linked ${multiSel.size} shots into one group.`);
  }, [analysis, multiSel, persist, pushHistory]);

  const onUnlinkSelected = useCallback(() => {
    if (!analysis || !multiSel.size) return;
    pushHistory();
    unlinkShots(analysis, [...multiSel]);
    setMultiSel(new Set()); setTick(t => t + 1); void persist(analysis);
    setStatus(`Unlinked ${multiSel.size} shots.`);
  }, [analysis, multiSel, persist, pushHistory]);

  // ── Stage 2 · وكيل اختيار الصورة ─────────────────────────────────
  const onPickFrames = useCallback(async () => {
    if (!analysis) return;
    setBusy('frames'); setStatus('Agent 2 picking frames…'); pushHistory();
    try {
      await pickKeyframes(analysis, (done, total) => {
        setStatus(`Agent 2: picked frame for ${done}/${total} shots…`);
        setTick(t => t + 1);
      });
      setTick(t => t + 1); void persist(analysis);
      setStatus(`Agent 2: keyframes chosen for all shots.`);
    } catch (e: any) { setStatus(`Frame selection failed: ${e?.message || e}`); }
    finally { setBusy(null); }
  }, [analysis]);

  // ── Edit timeline (editable tracks) ──────────────────────────────
  // Every session gets a Video + Audio track on first open.
  useEffect(() => {
    if (analysis && !analysis.tracks) {
      analysis.tracks = defaultTracks();
      setTick(t => t + 1); void persist(analysis);
    }
  }, [analysis, persist]);

  const addTrack = useCallback((kind: 'video' | 'audio') => {
    if (!analysis) return;
    analysis.tracks = [...(analysis.tracks || []), makeTrack(kind, analysis.tracks || [])];
    setTick(t => t + 1); void persist(analysis);
  }, [analysis, persist]);

  const toggleTrackHidden = useCallback((id: string) => {
    if (!analysis?.tracks) return;
    const t = analysis.tracks.find(x => x.id === id); if (!t) return;
    t.hidden = !t.hidden; setTick(x => x + 1); void persist(analysis);
  }, [analysis, persist]);

  const toggleLaneHidden = useCallback((key: string) => {
    if (!analysis) return;
    analysis.laneHidden = { ...(analysis.laneHidden || {}), [key]: !analysis.laneHidden?.[key] };
    setTick(x => x + 1); void persist(analysis);
  }, [analysis, persist]);

  // Drop a Take from the gallery onto a track → a clip at the drop x-position.
  const onTrackDrop = useCallback((trackId: string, e: React.DragEvent) => {
    e.preventDefault(); setDropTrack(null);
    if (!analysis?.tracks) return;
    const track = analysis.tracks.find(t => t.id === trackId); if (!track) return;
    let payload: { srcKind: 'frame' | 'video'; src: string; thumb?: string; label?: string; dur?: number };
    try { payload = JSON.parse(e.dataTransfer.getData('application/x-cut-clip')); } catch { return; }
    if (!payload?.src) return;
    // Audio tracks only accept audio-bearing items (videos); video tracks accept both.
    if (track.kind === 'audio' && payload.srcKind !== 'video') { setStatus('Audio tracks take video clips (for their sound).'); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left + (e.currentTarget as HTMLElement).scrollLeft;
    const start = Math.max(0, Math.round((x / pxs) * 100) / 100);
    const dur = Math.max(0.5, payload.dur || (payload.srcKind === 'video' ? 5 : 3));
    const srcDur = payload.srcKind === 'video' ? (payload.dur || undefined) : undefined;   // media length (videos)
    const uid = () => `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // The gallery falls its thumb back to the media path when there's no poster.
    // For a VIDEO that means the .mp4 — and an <img src=video> can't render (the
    // broken-image icon Anwar saw). Drop that fake thumb so the clip paints a
    // real <video> first-frame poster instead. (For a frame, the fallback is the
    // image itself, which renders fine — keep it.)
    const posterThumb = payload.srcKind === 'video' && payload.thumb === payload.src ? undefined : payload.thumb;
    const clip: CutClip = {
      id: uid(), srcKind: payload.srcKind, src: payload.src, thumb: posterThumb, label: payload.label,
      start, dur, srcIn: 0, srcDur,
    };
    track.clips = [...track.clips, clip];

    // Pro behaviour: dropping a VIDEO on a video track brings its AUDIO down
    // onto an audio track directly below (created if none), time-aligned + linked.
    if (track.kind === 'video' && payload.srcKind === 'video') {
      const linkId = `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      clip.linkId = linkId;
      const vi = analysis.tracks.indexOf(track);
      let audioTrack = analysis.tracks.slice(vi + 1).find(t => t.kind === 'audio');
      if (!audioTrack) { audioTrack = makeTrack('audio', analysis.tracks); analysis.tracks.splice(vi + 1, 0, audioTrack); }
      // A hidden destination track would swallow the audio silently — make it
      // active so the dropped clip's sound is both visible and audible.
      audioTrack.hidden = false;
      const audioClip: CutClip = {
        id: uid(), srcKind: 'video', src: payload.src, thumb: posterThumb,
        label: `♪ ${payload.label || 'audio'}`, start, dur, srcIn: 0, srcDur, linkId,
      };
      audioTrack.clips = [...audioTrack.clips, audioClip];
      setStatus(muted
        ? `Added video + linked audio — unmute the monitor (🔇) to hear it.`
        : `Added video + linked audio to ${track.label} @ ${fmt(start)}.`);
    } else {
      setStatus(`Added ${payload.srcKind} clip to ${track.label} @ ${fmt(start)}.`);
    }
    setSelClip(clip.id); setTick(t => t + 1); void persist(analysis);
  }, [analysis, persist, pxs, muted]);

  // Remove a clip + any clip linked to it (A/V pair), wherever they live.
  const removeClipByLink = useCallback((clipId: string) => {
    if (!analysis?.tracks) return;
    let linkId: string | undefined;
    for (const t of analysis.tracks) { const c = t.clips.find(x => x.id === clipId); if (c) { linkId = c.linkId; break; } }
    for (const t of analysis.tracks) {
      t.clips = t.clips.filter(c => c.id !== clipId && !(linkId && c.linkId === linkId));
    }
    if (selClip === clipId) setSelClip(null);
    setTick(t => t + 1); void persist(analysis);
  }, [analysis, persist, selClip]);

  const deleteClip = useCallback((_trackId: string, clipId: string) => {
    removeClipByLink(clipId);
  }, [removeClipByLink]);

  // Delete the selected clip — Del / Backspace (whichever track it's on).
  const deleteSelectedClip = useCallback(() => {
    if (!selClip) return;
    removeClipByLink(selClip);
    setStatus('Clip removed.');
  }, [selClip, removeClipByLink]);

  // Del / Backspace removes the selected clip — only while the Cuts view is
  // active and not while typing in a field.
  useEffect(() => {
    if (activeView !== 'cuts') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (!selClip) return;
      e.preventDefault();
      deleteSelectedClip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeView, selClip, deleteSelectedClip]);

  const CLIP_MIN = 0.1;   // shortest a clip may trim to (seconds)

  // Copy timeline+source geometry onto any clip linked to this one (A/V pair).
  const syncLinked = useCallback((clip: CutClip) => {
    if (!clip.linkId || !analysis?.tracks) return;
    for (const t of analysis.tracks) for (const c of t.clips) {
      if (c.linkId === clip.linkId && c.id !== clip.id) { c.start = clip.start; c.dur = clip.dur; c.srcIn = clip.srcIn; }
    }
  }, [analysis]);

  // Body drag = move · edge handles = trim. `mode` decides which.
  const onClipPointerDown = useCallback((trackId: string, clipId: string, mode: 'move' | 'trim-l' | 'trim-r', e: React.PointerEvent) => {
    if (!analysis?.tracks) return;
    const track = analysis.tracks.find(t => t.id === trackId); if (!track) return;
    const clip = track.clips.find(c => c.id === clipId); if (!clip) return;
    e.stopPropagation();
    setSelClip(clipId);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    clipDrag.current = {
      trackId, clipId, mode, grabDx: e.clientX - rect.left,
      x0: e.clientX, start0: clip.start, dur0: clip.dur, srcIn0: clip.srcIn || 0,
    };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [analysis]);

  const onClipPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = clipDrag.current; if (!drag || !analysis?.tracks) return;
    const track = analysis.tracks.find(t => t.id === drag.trackId); if (!track) return;
    const clip = track.clips.find(c => c.id === drag.clipId); if (!clip) return;
    const round = (v: number) => Math.round(v * 100) / 100;

    if (drag.mode === 'move') {
      const laneEl = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
      const rect = laneEl.getBoundingClientRect();
      const x = e.clientX - rect.left + laneEl.scrollLeft - drag.grabDx;
      clip.start = Math.max(0, round(x / pxs));
    } else {
      const deltaT = (e.clientX - drag.x0) / pxs;   // seconds the edge moved
      if (drag.mode === 'trim-l') {
        // Left edge: start + in-point move; right edge (start+dur) stays fixed.
        // Clamp so dur ≥ MIN, srcIn ≥ 0, start ≥ 0.
        const lo = Math.max(-drag.srcIn0, -drag.start0);
        const hi = drag.dur0 - CLIP_MIN;
        const d = Math.min(hi, Math.max(lo, deltaT));
        clip.start = round(drag.start0 + d);
        clip.dur = round(drag.dur0 - d);
        clip.srcIn = round(drag.srcIn0 + d);
      } else {
        // Right edge: dur (out-point) moves; start + in-point stay fixed.
        // Clamp so dur ≥ MIN and, if media length known, out ≤ srcDur.
        const maxDur = clip.srcDur != null ? clip.srcDur - drag.srcIn0 : Infinity;
        clip.dur = round(Math.min(maxDur, Math.max(CLIP_MIN, drag.dur0 + deltaT)));
      }
    }
    syncLinked(clip);
    setTick(t => t + 1);
  }, [analysis, pxs, syncLinked]);

  const onClipPointerUp = useCallback((e: React.PointerEvent) => {
    if (!clipDrag.current) return;
    clipDrag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (analysis) void persist(analysis);
  }, [analysis, persist]);

  // ── Per-clip overlay transform (geometry over the base video) ──────
  const ovlDrag = useRef<{ x0: number; y0: number; cx: number; cy: number } | null>(null);
  const xf = (c: CutClip) => ({ x: c.x || 0, y: c.y || 0, scale: c.scale ?? 1, rotate: c.rotate || 0, opacity: c.opacity ?? 1 });
  const patchXform = useCallback((clip: CutClip, patch: Partial<CutClip>, commit: boolean) => {
    Object.assign(clip, patch); setTick(t => t + 1);
    if (commit && analysis) void persist(analysis);
  }, [analysis, persist]);
  const commitXform = useCallback(() => { if (analysis) void persist(analysis); }, [analysis, persist]);
  const resetXform = useCallback((clip: CutClip) => {
    clip.x = 0; clip.y = 0; clip.scale = 1; clip.rotate = 0; clip.opacity = 1;
    setTick(t => t + 1); if (analysis) void persist(analysis);
  }, [analysis, persist]);

  // (overlay-drag handlers defined after overlayClip below)

  // ── Timeline geometry ────────────────────────────────────────────
  const laneW = Math.max(320, duration * pxs);
  const RULER_STEP = pxs < 24 ? 5 : pxs < 60 ? 2 : 1;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= duration + 0.001; t += RULER_STEP) out.push(Math.round(t * 100) / 100);
    return out;
  }, [duration, RULER_STEP]);

  const scrubFromEvent = useCallback((e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    seek((e.clientX - rect.left + (e.currentTarget as HTMLElement).scrollLeft) / pxs);
  }, [pxs, seek]);

  // Fit zoom to width on new analysis.
  useEffect(() => {
    if (duration > 0) setPxs(Math.max(12, Math.min(120, Math.floor((window.innerWidth - 220) / duration))));
  }, [duration]);

  const selectedShot = selShot != null ? shots.find(s => s.i === selShot) : null;
  const personShots = filterPerson ? new Set(personById.get(filterPerson)?.shots || []) : null;
  const visibleShots = personShots ? shots.filter(s => personShots.has(s.i))
    : filterScene ? shots.filter(s => s.sceneId === filterScene) : shots;
  const playInSel = !!selectedShot && playhead > selectedShot.start + 0.08 && playhead < selectedShot.end - 0.08;

  // ── Monitor overlay — an edit-track clip composited over the source video ──
  // The topmost VISIBLE video track whose clip covers the playhead wins; hidden
  // tracks + audio tracks never affect the preview.
  const overlayClip = useMemo(() => {
    let found: CutClip | null = null;
    for (const tr of tracks) {
      if (tr.kind !== 'video' || tr.hidden) continue;
      for (const c of tr.clips) {
        if (playhead >= c.start && playhead < c.start + c.dur) found = c;   // later track wins → topmost
      }
    }
    return found;
    // tick: tracks is a stable ref mutated in place — re-derive on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, playhead, tick]);

  // Direct-drag the composited overlay in the monitor to reposition (x/y).
  const onOvlPointerDown = useCallback((e: React.PointerEvent) => {
    if (!overlayClip) return;
    e.preventDefault();
    const f = xf(overlayClip);
    ovlDrag.current = { x0: f.x, y0: f.y, cx: e.clientX, cy: e.clientY };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [overlayClip]);
  const onOvlPointerMove = useCallback((e: React.PointerEvent) => {
    const d = ovlDrag.current; if (!d || !overlayClip) return;
    overlayClip.x = Math.round(d.x0 + (e.clientX - d.cx));
    overlayClip.y = Math.round(d.y0 + (e.clientY - d.cy));
    setTick(t => t + 1);
  }, [overlayClip]);
  const onOvlPointerUp = useCallback((e: React.PointerEvent) => {
    if (!ovlDrag.current) return;
    ovlDrag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (analysis) void persist(analysis);
  }, [analysis, persist]);

  // Overlay video clips play NATIVELY in sync with the master — align once when
  // a clip becomes active or the play state flips, then let it run (no per-frame
  // seek, which was the source of the hitching).
  useEffect(() => {
    const v = overlayVideoRef.current;
    if (!v || overlayClip?.srcKind !== 'video') return;
    try { v.currentTime = Math.max(0, (overlayClip.srcIn || 0) + (playhead - overlayClip.start)); } catch { /* ignore */ }
    if (playing) void v.play().catch(() => {}); else v.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayClip?.id, playing]);

  // While paused/scrubbing, hold the overlay frame on the playhead (honours in-point).
  useEffect(() => {
    if (playing) return;
    const v = overlayVideoRef.current;
    if (!v || overlayClip?.srcKind !== 'video') return;
    const t = Math.max(0, (overlayClip.srcIn || 0) + (playhead - overlayClip.start));
    if (Math.abs(v.currentTime - t) > 0.12) { try { v.currentTime = t; } catch { /* ignore */ } }
  }, [overlayClip, playhead, playing]);

  // ── Audio routing — sound comes ONLY from ACTIVE (visible) audio tracks ──
  // User audio-track clips covering the playhead, on non-hidden tracks. Each
  // gets its own scoped <audio> (rendered below). A hidden track is silent.
  const activeAudioClips = useMemo(() => {
    const out: CutClip[] = [];
    for (const tr of tracks) {
      if (tr.kind !== 'audio' || tr.hidden) continue;
      for (const c of tr.clips) {
        // The SOURCE audio already plays through the master <video> — never route
        // the same source file through a clip <audio> too (that doubled it).
        if (c.src === videoPath) continue;
        if (playhead >= c.start && playhead < c.start + c.dur) out.push(c);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, playhead, tick, videoPath]);

  // Audio is a simple MIX of every visible audio track. The SOURCE audio = the
  // master <video>'s own track — it plays whenever its track is visible and the
  // monitor isn't master-muted. Clip tracks play alongside it (each <audio>);
  // it does NOT yield to an active clip. Hidden track = silent.
  const srcAudioHidden = !!analysis?.laneHidden?.srcaud;
  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    v.muted = muted || srcAudioHidden;
  }, [muted, srcAudioHidden]);

  // Does THIS project's source file actually carry an audio stream? A YouTube
  // fetch can be video-only, or a made clip silent — either way the monitor is
  // silent through no fault of the UI. Probe once per source so "no sound" reads
  // honestly on the SOURCE ♪ lane instead of looking like a broken toggle.
  const [srcHasAudio, setSrcHasAudio] = useState<boolean | null>(null);
  useEffect(() => {
    setSrcHasAudio(null);
    if (!videoPath) return;
    let cancelled = false;
    void window.hjen.cutsHasAudio?.({ videoPath })
      .then(r => { if (!cancelled && r?.ok) setSrcHasAudio(r.hasAudio); })
      .catch(() => { /* probe is best-effort; unknown → assume audible */ });
    return () => { cancelled = true; };
  }, [videoPath]);

  // The one true source-audio status, resolved across file + lane + master mute.
  // Drives every SOURCE ♪ affordance so the reason for silence is always visible.
  const srcAudioState: 'none' | 'off' | 'muted' | 'active' =
    srcHasAudio === false ? 'none'
    : srcAudioHidden ? 'off'          // lane hidden → force-muted (recover via 👁)
    : muted ? 'muted'                 // monitor master-muted
    : 'active';
  const SRC_AUDIO_LABEL: Record<typeof srcAudioState, string> = {
    none: 'no audio in source', off: 'muted · lane hidden', muted: 'muted', active: 'active',
  };

  // ── Manual edits (hard cases) ────────────────────────────────────
  const doSplit = useCallback(async () => {
    if (!analysis || !selectedShot || !playInSel) return;
    pushHistory();
    setEditing(true); setStatus(`Splitting shot ${selectedShot.i} at ${fmt(playhead)}…`);
    try {
      const ok = await splitShotAt(analysis, selectedShot.i, playhead);
      setTick(t => t + 1); if (ok) void persist(analysis);
      setStatus(ok ? `Cut added — now ${analysis.shots.length} shots. saved` : 'Playhead too close to a shot edge.');
    } finally { setEditing(false); }
  }, [analysis, selectedShot, playInSel, playhead]);

  const doMerge = useCallback(async () => {
    if (!analysis || !selectedShot || selectedShot.i <= 1) return;
    const target = selectedShot.i - 1;
    pushHistory();
    setEditing(true); setStatus(`Merging shot ${selectedShot.i} into ${target}…`);
    try {
      const ok = await mergeWithPrev(analysis, selectedShot.i);
      setSelShot(target); setTick(t => t + 1); if (ok) void persist(analysis);
      setStatus(ok ? `Cut removed — now ${analysis.shots.length} shots. saved` : 'Cannot merge.');
    } finally { setEditing(false); }
  }, [analysis, selectedShot]);

  const doSetKey = useCallback(async () => {
    if (!analysis || !selectedShot || !playInSel) return;
    pushHistory();
    setEditing(true); setStatus(`Setting keyframe of shot ${selectedShot.i} to ${fmt(playhead)}…`);
    try {
      const ok = await setKeyframeAt(analysis, selectedShot.i, playhead);
      setTick(t => t + 1); if (ok) void persist(analysis);
      setStatus(ok ? `Keyframe set @ ${playhead.toFixed(2)}s. saved` : 'Could not grab that frame.');
    } finally { setEditing(false); }
  }, [analysis, selectedShot, playInSel, playhead]);

  // ── Pipeline as one ordered Step ▾ + Go control ──────────────────────────
  const anyBusy = !!busy || fetching;
  const STEPS: { key: string; label: string; run: () => any; ready: boolean; doing: string }[] = [
    { key: 'fetch',  label: 'Fetch from YouTube',            run: onFetch,     ready: !!url.trim(),  doing: 'Fetching…' },
    { key: 'cuts',   label: 'Detect cuts',                   run: onAnalyze,   ready: !!videoPath,   doing: 'Cutting…' },
    { key: 'verify', label: 'Verify cuts',                   run: onVerify,    ready: !!analysis,    doing: 'Verifying…' },
    { key: 'group',  label: 'Agent 1 · Group scenes',        run: onGroup,     ready: !!analysis,    doing: 'Grouping…' },
    { key: 'frames', label: 'Agent 2 · Pick frame',          run: onPickFrames, ready: !!analysis,   doing: 'Picking…' },
    { key: 'people', label: 'Identify people',               run: onPeople,    ready: !!analysis,    doing: 'Identifying…' },
    { key: 'speech', label: 'Detect speech · VO / dialogue', run: onSpeech,    ready: !!analysis,    doing: 'Listening…' },
    { key: 'dna',    label: 'Read look (DNA)',               run: onReadDna,   ready: !!analysis,    doing: 'Reading look…' },
    { key: 'story',  label: 'Understand ad (story/world)',    run: onReadStory, ready: !!analysis,    doing: 'Understanding…' },
    { key: 'brief',  label: 'Write master prompts',          run: onWriteBriefs, ready: !!analysis,  doing: 'Writing…' },
  ];
  const curStep = STEPS.find(s => s.key === step) || STEPS[1];
  const onGo = useCallback(async () => {
    const cur = STEPS.find(s => s.key === step);
    if (!cur || !cur.ready || anyBusy) return;
    await cur.run();
    const i = STEPS.findIndex(s => s.key === cur.key);        // advance to the next runnable step
    const next = STEPS.slice(i + 1).find(s => s.ready) || STEPS[i + 1];
    if (next) setStep(next.key);
  }, [step, anyBusy, url, videoPath, analysis]);

  return (
    <div className="cut-view cuts-sorbet">
      <div className="cut-main">
      {/* ── Toolbar ── */}
      <div className="cut-bar">
        <div className="cut-bar__brand">
          <span className="cut-bar__title">CUTS ENGINE</span>
          <span className="cut-bar__sub">Precision cuts. Stronger stories.</span>
        </div>
        <div className="cut-stat" title="Cuts detected in this session">
          <span className="cut-stat__n">{shots.length || '—'}</span>
          <span className="cut-stat__l">cuts</span>
        </div>
        <button className="cut-btn" onClick={onPick} disabled={anyBusy}>Pick video</button>
        <div className="cut-fetch">
          <input
            className="cut-url" type="text" dir="ltr" placeholder="Paste a YouTube link…"
            value={url} onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setStep('fetch'); void onFetch(); } }}
            disabled={anyBusy} />
        </div>
        <div className="cut-sess">
          <button className="cut-sessions" disabled={!!busy || fetching}
            onClick={() => setSessMenuOpen(v => !v)}
            title={sessions.length ? 'Open or delete saved sessions' : 'Sessions auto-save after you Detect cuts'}>
            {sessions.length ? `Sessions (${sessions.length})` : 'No sessions yet'} ▾
          </button>
          {sessMenuOpen && (
            <>
              <div className="cut-sess__scrim" onClick={() => setSessMenuOpen(false)} />
              <div className="cut-sess__menu">
                {sessions.length === 0 && <div className="cut-sess__empty">No saved sessions.</div>}
                {sessions.map(s => (
                  <div key={s.sessionId} className={`cut-sess__row ${analysis?.sessionId === s.sessionId ? 'is-open' : ''}`}>
                    <button className="cut-sess__open" title="Open this session"
                      onClick={() => { setSessMenuOpen(false); void onOpenSession(s.sessionId); }}>
                      <span className="cut-sess__name">{(s.title || s.sessionId)}</span>
                      <span className="cut-sess__meta">{s.project ? `${s.project} · ` : ''}{s.shots}sh{s.scenes ? ` / ${s.scenes}sc` : ''}</span>
                    </button>
                    <button className="cut-sess__del" title="Delete this session permanently"
                      onClick={() => void onDeleteSession(s)}>🗑</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        {(videoSource || videoPath) && (
          <button className="cut-btn cut-src" onClick={onOpenSource}
            title={videoSource ? `Source: ${videoSource}` : `File: ${videoPath}`}>
            {videoSource ? '▶ YouTube' : '⧉ Reveal file'}
          </button>
        )}
        {analysis && (
          <input className="cut-name" type="text" placeholder="Session name"
            value={analysis.title || ''} onChange={e => onRename(e.target.value)}
            onBlur={() => void doSave()}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            title="Rename this session" />
        )}
        <button className="cut-btn" onClick={() => void doSave()} disabled={!analysis || !!busy}
          title="Save this session (also auto-saves after each change)">Save</button>
        <div className="cut-run" title="Run the pipeline step — it advances to the next one after each Go">
          <select className="cut-step" value={step} onChange={e => setStep(e.target.value)} disabled={anyBusy}>
            {STEPS.map((s, i) => (
              <option key={s.key} value={s.key} disabled={!s.ready}>{`${i + 1}. ${s.label}`}</option>
            ))}
          </select>
          <button className="cut-btn cut-btn--go" onClick={onGo} disabled={anyBusy || !curStep.ready}>
            {anyBusy ? curStep.doing : 'Go'}
          </button>
        </div>
        <div className="cut-thr" title="Cut sensitivity — used by Detect cuts">
          <label className="mono-label">SCENE&nbsp;{threshold.toFixed(2)}</label>
          <input type="range" min={0.10} max={0.60} step={0.02} value={threshold}
            onChange={e => setThreshold(parseFloat(e.target.value))} disabled={!!busy} />
        </div>
        <div className="cut-thr" title="Grouping strength — higher merges more (re-clusters live)">
          <label className="mono-label">GROUP&nbsp;{linkStrength.toFixed(2)}</label>
          <input type="range" min={0} max={1} step={0.05} value={linkStrength}
            onChange={e => { const v = parseFloat(e.target.value); setLinkStrength(v); reclusterAt(v); }}
            disabled={!!busy} />
        </div>
        <div className="cut-bar__spacer" />
        <div className="cut-undo">
          <button className="cut-icon" onClick={undo} disabled={!undoStack.length || editing}
            title="Undo (⌘Z)">↶</button>
          <button className="cut-icon" onClick={redo} disabled={!redoStack.length || editing}
            title="Redo (⌘⇧Z)">↷</button>
        </div>
        <div className="cut-zoom">
          <button className="cut-icon" onClick={() => setPxs(p => Math.max(8, Math.round(p * 0.8)))} disabled={!analysis}>−</button>
          <span className="mono-label">{pxs}px/s</span>
          <button className="cut-icon" onClick={() => setPxs(p => Math.min(240, Math.round(p * 1.25)))} disabled={!analysis}>＋</button>
        </div>
      </div>

      {/* ── Monitor + inspector ── */}
      <div className="cut-stage" style={{ height: stageH }}>
        <div className="cut-monitor">
          {videoPath ? (
            <video
              ref={videoRef} src={fileUrl(videoPath)} muted={muted} playsInline
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
              onTimeUpdate={() => { if (!playing && videoRef.current) setPlayhead(videoRef.current.currentTime); }}
            />
          ) : <div className="cut-monitor__empty">No video</div>}
          {/* Big centred play affordance (Sorbet) — shown while paused. */}
          {videoPath && !playing && (
            <button className="cut-play" onClick={togglePlay} aria-label="Play" title="Play (Space)">
              <span className="cut-play__disc">
                <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
              </span>
            </button>
          )}
          {/* Edit-track clip composited over the source video at the playhead */}
          {overlayClip && (() => { const f = xf(overlayClip); return (
            <div className="cut-ovl" key={overlayClip.id}>
              <div className="cut-ovl__media"
                style={{ transform: `translate(${f.x}px, ${f.y}px) scale(${f.scale}) rotate(${f.rotate}deg)`, opacity: f.opacity }}
                title="Drag to move"
                onPointerDown={onOvlPointerDown} onPointerMove={onOvlPointerMove} onPointerUp={onOvlPointerUp}>
                {overlayClip.srcKind === 'frame'
                  ? <img src={fileUrl(overlayClip.src)} alt="" draggable={false} />
                  : <video ref={overlayVideoRef} src={fileUrl(overlayClip.src)} muted playsInline />}
              </div>
              <span className="cut-ovl__tag mono-label">OVERLAY · {overlayClip.label || overlayClip.srcKind} · drag to move</span>
            </div>
          ); })()}
          {/* Active audio-track clips — sound routed ONLY from visible audio tracks */}
          {activeAudioClips.map(c => (
            <ClipAudio key={c.id} src={fileUrl(c.src)} clipStart={c.start} srcIn={c.srcIn || 0} playhead={playhead} playing={playing} muted={muted} />
          ))}
          <div className="cut-transport">
            <button className="cut-icon" onClick={togglePlay} disabled={!videoPath}>{playing ? '❚❚' : '►'}</button>
            <button className="cut-icon" onClick={() => setMuted(m => !m)}
              disabled={!videoPath} title={muted ? 'Unmute' : 'Mute'}>{muted ? '🔇' : '🔊'}</button>
            <span ref={tcRef} className="mono-label">{fmt(playhead)} / {fmt(duration)}</span>
            <span className="cut-hint">Space play · ← → step · ⇧ cut-to-cut · +/− zoom · ⌘Z undo</span>
          </div>
          {/* Per-clip overlay transform — shown for the composited clip */}
          {overlayClip && (() => { const f = xf(overlayClip); return (
            <div className="cut-xform">
              <div className="cut-xform__head">
                <span className="mono-label">OVERLAY TRANSFORM</span>
                <button className="cut-tool" onClick={() => resetXform(overlayClip)}>Reset</button>
              </div>
              <div className="cut-xform__nums">
                <label className="cut-xform__num"><span>X</span>
                  <input type="number" value={f.x} onChange={e => patchXform(overlayClip, { x: Number(e.target.value) || 0 }, false)} onBlur={commitXform} /></label>
                <label className="cut-xform__num"><span>Y</span>
                  <input type="number" value={f.y} onChange={e => patchXform(overlayClip, { y: Number(e.target.value) || 0 }, false)} onBlur={commitXform} /></label>
              </div>
              <label className="cut-xform__slider"><span>Scale · {f.scale.toFixed(2)}×</span>
                <input type="range" min={0.1} max={3} step={0.05} value={f.scale}
                  onChange={e => patchXform(overlayClip, { scale: parseFloat(e.target.value) }, false)} onPointerUp={commitXform} /></label>
              <label className="cut-xform__slider"><span>Rotate · {Math.round(f.rotate)}°</span>
                <input type="range" min={-180} max={180} step={1} value={f.rotate}
                  onChange={e => patchXform(overlayClip, { rotate: parseFloat(e.target.value) }, false)} onPointerUp={commitXform} /></label>
              <label className="cut-xform__slider"><span>Opacity · {Math.round(f.opacity * 100)}%</span>
                <input type="range" min={0} max={1} step={0.01} value={f.opacity}
                  onChange={e => patchXform(overlayClip, { opacity: parseFloat(e.target.value) }, false)} onPointerUp={commitXform} /></label>
            </div>
          ); })()}
        </div>
        <div className="cut-inspect">
          {selSeg ? (
            <div className="cut-tr">
              <div className="cut-tr__sel">
                <div className="cut-tr__selhead">
                  <span className={`cut-say__tag ${selSeg.type}`}>{selSeg.type === 'vo' ? 'VOICE-OVER' : 'DIALOGUE'}</span>
                  <span className="cut-inspect__tc">{fmt(selSeg.start)} → {fmt(selSeg.end)}</span>
                  {selSeg.speaker && <span className="cut-tr__spk">{selSeg.speaker}</span>}
                  <button className="cut-tool" onClick={() => copyText(selSeg.text)} title="Copy text">Copy</button>
                </div>
                <p className="cut-copytext cut-tr__big">{selSeg.text}</p>
              </div>
              <TranscriptList speech={speech} selSpeech={selSpeech} setSel={i => { setSelSpeech(i); setSelShot(null); seek(speech[i].start + 0.02); }} copyText={copyText} />
            </div>
          ) : selectedShot ? (
            <>
              <div className="cut-inspect__head">
                <span className="mono-label">Shot {selectedShot.i}</span>
                <span className="cut-inspect__tc">{fmt(selectedShot.start)} → {fmt(selectedShot.end)} · {selectedShot.dur.toFixed(2)}s</span>
              </div>
              {selectedShot.sceneId && (
                <div className="cut-inspect__scene">
                  <span className="cut-swatch" style={{ background: sceneById.get(selectedShot.sceneId)?.color, '--sb-hue': hueForScene(selectedShot.sceneId) } as React.CSSProperties} />
                  {sceneById.get(selectedShot.sceneId)?.label}
                </div>
              )}
              {selectedShot.perception && (
                <div className="cut-percept">
                  <div><b>Place</b> · {selectedShot.perception.place?.kind}
                    {selectedShot.perception.place?.inOut ? ` · ${selectedShot.perception.place.inOut}` : ''}
                    {selectedShot.perception.place?.backdrop ? ` · ${selectedShot.perception.place.backdrop}` : ''}</div>
                  {selectedShot.perception.subjects?.length ? selectedShot.perception.subjects.map((s, i) => (
                    <div key={i}><b>Person</b> · {[s.sex, s.build, s.skinTone, s.hair].filter(Boolean).join(' ')}
                      {s.wardrobe ? ` — ${s.wardrobe}` : ''}{s.activity ? ` · ${s.activity}` : ''}</div>
                  )) : <div><b>Person</b> · none</div>}
                </div>
              )}
              <div className="cut-inspect__key">
                {selectedShot.keyframe ? (
                  <img src={fileUrl(selectedShot.keyframe)} alt="" />
                ) : <img src={fileUrl(selectedShot.thumb)} alt="" />}
              </div>
              {selectedShot.keyframeT != null && (
                <div className="mono-label">Keyframe @ {selectedShot.keyframeT.toFixed(2)}s</div>
              )}
              {selectedShot.pickReason && <div className="cut-inspect__why">“{selectedShot.pickReason}”</div>}
              {selectedShot.brief?.prompt && (
                <div className="cut-mp">
                  <div className="cut-mp__head">
                    <span className="mono-label">MASTER PROMPT</span>
                    <button className="cut-tool" onClick={() => copyText(selectedShot.brief!.prompt)} title="Copy the master prompt">Copy</button>
                  </div>
                  <textarea className="cut-mp__text cut-copytext" value={selectedShot.brief.prompt}
                    onChange={e => { if (selectedShot.brief) { selectedShot.brief.prompt = e.target.value; setTick(t => t + 1); } }}
                    onBlur={() => void persist(analysis)} spellCheck={false} />
                  {(() => { const c = selectedShot.brief!.camera; const cam = [c.shotSize, c.lens, c.angle, c.movement, c.dof].filter(Boolean).join(' · '); return cam ? <div className="cut-mp__cam"><b>Camera</b> {cam}</div> : null; })()}
                  {selectedShot.brief.inside && <div className="cut-mp__inside cut-copytext">“{selectedShot.brief.inside}”</div>}
                </div>
              )}
              <div className="cut-inspect__tools">
                <button className="cut-tool" onClick={doSplit} disabled={editing || !playInSel}
                  title={playInSel ? 'Split this shot at the playhead' : 'Move the playhead inside this shot first'}>✂ Split here</button>
                <button className="cut-tool" onClick={doMerge} disabled={editing || selectedShot.i <= 1}
                  title="Merge this shot into the previous one (remove a false cut)">⇤ Merge prev</button>
                <button className="cut-tool" onClick={doSetKey} disabled={editing || !playInSel}
                  title={playInSel ? 'Use the current playhead frame as the keyframe' : 'Move the playhead inside this shot first'}>◎ Keyframe = playhead</button>
              </div>
              {!!selectedShot.candidates?.length && (
                <div className="cut-inspect__cands">
                  {selectedShot.candidates.map(c => (
                    <img key={c.id} src={fileUrl(c.abs)} title={`${c.t.toFixed(2)}s`}
                      className={selectedShot.keyframe === c.abs ? 'is-pick' : ''}
                      onClick={() => {
                        pushHistory();
                        selectedShot.keyframe = c.abs; selectedShot.keyframeT = c.t; selectedShot.pickReason = 'manual';
                        setTick(t => t + 1); void persist(analysis);
                      }} />
                  ))}
                </div>
              )}
            </>
          ) : speech.length ? (
            <TranscriptList speech={speech} selSpeech={selSpeech} setSel={i => { setSelSpeech(i); setSelShot(null); seek(speech[i].start + 0.02); }} copyText={copyText} />
          ) : <div className="cut-inspect__empty">Select a shot to inspect · run “Detect speech” for the transcript.</div>}
        </div>
      </div>

      {/* Drag to resize the stage vs the timeline below */}
      <div className="cut-hsplit" title="Drag to resize" onPointerDown={startStageResize} />

      {/* ── Status ── */}
      <div className="cut-status">{status}</div>

      {/* Manual-link bar — appears when ⌘-clicking multiple shots */}
      {multiSel.size > 0 && (
        <div className="cut-linkbar">
          <span className="mono-label">{multiSel.size} selected</span>
          <button className="cut-btn" onClick={onLinkSelected} disabled={multiSel.size < 2}>⛓ Link into one group</button>
          <button className="cut-btn" onClick={onUnlinkSelected}>Unlink</button>
          <button className="cut-btn" onClick={() => setMultiSel(new Set())}>Clear</button>
          <span className="cut-hint">⌘-click shots to add/remove</span>
        </div>
      )}

      {/* ── Lower: scenes list (left) + timeline (right) ── */}
      {analysis && (
        <div className="cut-lower">
        <aside className="cut-scenes">
          <div className="cut-side__tabs">
            <button className={`cut-side__tab ${sidePanel === 'scenes' ? 'is-active' : ''}`}
              onClick={() => { setSidePanel('scenes'); setFilterPerson(null); }}>Scenes <em>{scenes.length}</em></button>
            <button className={`cut-side__tab ${sidePanel === 'people' ? 'is-active' : ''}`}
              onClick={() => { setSidePanel('people'); setFilterScene(null); }}>People <em>{people.length}</em></button>
          </div>

          {sidePanel === 'scenes' ? (
          <>
          {suggestions.length > 0 && (
            <div className="cut-suggest">
              <div className="cut-scenes__head mono-label">SUGGESTED LINKS · {suggestions.length}</div>
              <div className="cut-suggest__list">
                {suggestions.map(sg => {
                  const A = shots.find(s => s.i === sg.a), B = shots.find(s => s.i === sg.b);
                  return (
                    <div key={`${sg.a}-${sg.b}`} className="cut-sugg">
                      <img src={fileUrl(A?.keyframe || A?.thumb || '')} alt="" title={`Shot ${sg.a}`}
                        onClick={() => { setSelShot(sg.a); if (A) seek(A.start + 0.02); }} />
                      <img src={fileUrl(B?.keyframe || B?.thumb || '')} alt="" title={`Shot ${sg.b}`}
                        onClick={() => { setSelShot(sg.b); if (B) seek(B.start + 0.02); }} />
                      <div className="cut-sugg__meta">
                        <span className="mono-label">S{sg.a}↔S{sg.b}</span>
                        <span className={`cut-sugg__tag ${sg.kind}`}>{sg.kind === 'face' ? 'face' : 'look'} {sg.sim.toFixed(2)}{sg.adjacent ? '' : ' ·far'}</span>
                      </div>
                      <button className="cut-sugg__link" title="Link these two" onClick={() => onLinkPair(sg.a, sg.b)}>⛓</button>
                      <button className="cut-sugg__x" title="Dismiss" onClick={() => dismissSuggestion(sg.a, sg.b)}>×</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="cut-scenes__head mono-label">
            SCENES · {scenes.length}
            {scenes.length > 0 && (
              <button className="cut-check" disabled={busy === 'check'} onClick={() => void onCheck('scene')}
                title="The mind compares each scene to its frames and flags shots that don't belong">
                {busy === 'check' ? 'Checking…' : '✓ Check'}
              </button>
            )}
          </div>
          <div className="cut-scenes__list">
            <button className={`cut-scene ${filterScene === null ? 'is-active' : ''}`}
              onClick={() => setFilterScene(null)}>
              <span className="cut-swatch" style={{ background: 'var(--ink-dim)' }} />
              <span className="cut-scene__label">All shots</span>
              <em>{shots.length}</em>
            </button>
            {scenes.map(sc => {
              const n = shots.filter(x => x.sceneId === sc.id).length;
              const vd = verdicts[sc.id];
              return (
                <button key={sc.id} title={sc.label}
                  className={`cut-scene ${filterScene === sc.id ? 'is-active' : ''}`}
                  onClick={() => {
                    const nextFilter = filterScene === sc.id ? null : sc.id;
                    setFilterScene(nextFilter);
                    const first = shots.find(x => x.sceneId === sc.id);
                    if (first) { setSelShot(first.i); seek(first.start + 0.02); }
                  }}>
                  <span className="cut-swatch" style={{ background: sc.color, '--sb-hue': hueForScene(sc.id) } as React.CSSProperties} />
                  <span className="cut-scene__label">{sc.label}</span>
                  {vd && (vd.outliers.length
                    ? <span className="cut-flag" title={`${vd.outliers.length} suspect shot(s)`}>⚠ {vd.outliers.length}</span>
                    : <span className="cut-flag cut-flag--ok" title="Checked · coherent">✓</span>)}
                  <em>{n}</em>
                </button>
              );
            })}
            {!scenes.length && <div className="cut-scenes__empty">Run Agent 1 to group shots into scenes.</div>}
          </div>
          </>
          ) : (
          <>
          {people.length > 0 && (
            <div className="cut-people__bar">
              <button className={`cut-people__edit ${editPeople ? 'is-active' : ''}`}
                onClick={() => { setEditPeople(v => !v); setPersonSel(new Set()); }}
                title="Fix the grouping — rename, delete, merge people, add/remove shots">
                {editPeople ? 'Done' : '✎ Edit'}
              </button>
              {editPeople ? (
                <button className="cut-people__merge" disabled={personSel.size < 2} onClick={onMergePeople}
                  title="Merge the checked people into one">⛓ Merge{personSel.size >= 2 ? ` (${personSel.size})` : ''}</button>
              ) : (
                <button className={`cut-person__all ${filterPerson === null ? 'is-active' : ''}`}
                  onClick={() => setFilterPerson(null)}>All shots · {shots.length}</button>
              )}
              <button className="cut-check" disabled={busy === 'check'} onClick={() => void onCheck('person')}
                title="The mind compares each person to their frames and flags shots that don't belong">
                {busy === 'check' ? 'Checking…' : '✓ Check'}
              </button>
            </div>
          )}
          <div className="cut-people__list">
            {people.map(p => {
              const key = p.keyShot != null ? shots.find(s => s.i === p.keyShot) : undefined;
              const img = key?.keyframe || key?.thumb;
              const active = filterPerson === p.id;
              const expanded = editPeople || active;
              const checked = personSel.has(p.id);
              const vd = verdicts[p.id];
              return (
                <div key={p.id} className={`cut-person ${active && !editPeople ? 'is-active' : ''} ${editPeople ? 'is-edit' : ''} ${checked ? 'is-checked' : ''}`}
                  style={{ '--pc': p.color } as React.CSSProperties}
                  onClick={() => {
                    if (editPeople) return;                          // no toggle in edit mode
                    if (window.getSelection()?.toString()) return;   // don't toggle while selecting text to copy
                    const next = active ? null : p.id;
                    setFilterPerson(next);
                    const first = shots.find(s => s.i === p.shots[0]);
                    if (next && first) { setSelShot(first.i); seek(first.start + 0.02); }
                  }}>
                  <div className="cut-person__top">
                    {editPeople && (
                      <input type="checkbox" className="cut-person__check" checked={checked}
                        onClick={e => e.stopPropagation()} onChange={() => togglePersonSel(p.id)}
                        title="Check to merge" />
                    )}
                    {img ? <img className="cut-person__face" src={fileUrl(img)} alt="" draggable={false} />
                         : <div className="cut-person__face cut-person__face--empty" />}
                    <div className="cut-person__id">
                      {editPeople ? (
                        <input className="cut-person__nameedit" value={p.name}
                          onClick={e => e.stopPropagation()}
                          onChange={e => onRenamePerson(p.id, e.target.value)} />
                      ) : (
                        <span className="cut-person__name" title={p.name}>{p.name}</span>
                      )}
                      <span className="cut-person__count">{p.shots.length} shot{p.shots.length > 1 ? 's' : ''}</span>
                    </div>
                    {vd && !editPeople && (vd.outliers.length
                      ? <span className="cut-flag" title={`${vd.outliers.length} suspect shot(s)`}>⚠ {vd.outliers.length}</span>
                      : <span className="cut-flag cut-flag--ok" title="Checked · coherent">✓</span>)}
                    {editPeople
                      ? <button className="cut-person__del" title="Delete this person"
                          onClick={e => { e.stopPropagation(); onDeletePerson(p.id); }}>🗑</button>
                      : <span className="cut-person__chev">{active ? '▾' : '▸'}</span>}
                  </div>
                  {expanded && (
                    <div className="cut-person__body">
                      {p.description && <p className="cut-person__desc">{p.description}</p>}
                      {p.appearance && <div className="cut-person__row"><b>Build</b> {p.appearance}</div>}
                      {p.expression && <div className="cut-person__row"><b>Expression</b> {p.expression}</div>}
                      {p.wardrobe && <div className="cut-person__row"><b>Wardrobe</b> {p.wardrobe}</div>}
                      <div className="cut-person__shots">
                        {p.shots.map(n => (
                          <span key={n} className={`cut-person__chip ${editPeople ? 'is-edit' : ''}`}>
                            <button className="cut-person__chipgo" title={`Go to shot ${n}`}
                              onClick={e => { e.stopPropagation(); const sh = shots.find(s => s.i === n); setSelShot(n); if (sh) seek(sh.start + 0.02); }}>{n}</button>
                            {editPeople && (
                              <button className="cut-person__chipx" title={`Remove shot ${n}`}
                                onClick={e => { e.stopPropagation(); onRemoveShotFromPerson(p.id, n); }}>×</button>
                            )}
                          </span>
                        ))}
                        {editPeople && (
                          <select className="cut-person__add" value="" title="Add a shot to this person"
                            onClick={e => e.stopPropagation()}
                            onChange={e => { const n = parseInt(e.target.value, 10); if (n) onAddShotToPerson(p.id, n); e.currentTarget.value = ''; }}>
                            <option value="">＋</option>
                            {shots.filter(s => !p.shots.includes(s.i)).map(s => (
                              <option key={s.i} value={s.i}>Shot {s.i}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {!people.length && <div className="cut-scenes__empty">Run “Identify people” to find the ad’s main characters and group them across shots.</div>}
          </div>
          </>
          )}
          {/* Export hero + film-reel mascot (Sorbet play signal). Saves the cut. */}
          <div className="cut-scenes__foot">
            <button className="cut-export" onClick={() => void doSave()} disabled={!analysis}
              title="Save this cut as a session">
              <span className="cut-export__label">Export cut</span>
              <span className="cut-export__arrow" aria-hidden="true">↗</span>
              <svg className="cut-export__doodle" viewBox="0 0 140 60" fill="none"
                stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 30 H62" strokeDasharray="6 7" />
                <path d="M62 30 L92 20" />
                <path d="M62 30 L92 40" />
                <circle cx="98" cy="17" r="7" />
                <circle cx="98" cy="43" r="7" />
                <path d="M92 22 L130 41" />
                <path d="M92 38 L130 19" />
              </svg>
            </button>
            <svg className="cut-mascot" viewBox="0 0 80 78" aria-hidden="true">
              <circle cx="40" cy="34" r="30" fill="#3A3A42" stroke="#4A4A54" strokeWidth={2} />
              <circle cx="40" cy="34" r="7" fill="#1B1B22" />
              <circle cx="40" cy="14" r="4.6" fill="#1B1B22" />
              <circle cx="20" cy="34" r="4.6" fill="#1B1B22" />
              <circle cx="60" cy="34" r="4.6" fill="#1B1B22" />
              <path d="M27 47 q4 4 8 0" stroke="#0E0E13" strokeWidth={2.4} fill="none" strokeLinecap="round" />
              <path d="M45 47 q4 4 8 0" stroke="#0E0E13" strokeWidth={2.4} fill="none" strokeLinecap="round" />
              <path d="M28 66 h8 M44 66 h8" stroke="#3A3A42" strokeWidth={5} strokeLinecap="round" />
            </svg>
          </div>
        </aside>
        <div className="cut-tl">
          {/* Add-track toolbar */}
          <div className="cut-tl__tools">
            <span className="mono-label">TRACKS</span>
            <button className="cut-tool" onClick={() => addTrack('video')}>＋ Video track</button>
            <button className="cut-tool" onClick={() => addTrack('audio')}>＋ Audio track</button>
            <span className="cut-hint">Drag Takes from the right onto a track</span>
          </div>
          <div className="cut-tl__body">
          <div className="cut-tl__heads" ref={headsRef}>
            <div className="cut-tl__headspacer" />
            {/* Editable track heads (top) */}
            {tracks.map(tr => {
              const hidden = !!tr.hidden;
              const h = hidden ? HIDDEN_H : (tr.kind === 'video' ? LANE_H.video : LANE_H.audio);
              return (
                <div key={tr.id} className={`cut-tl__head cut-tl__head--edit ${hidden ? 'is-hidden' : ''}`} style={{ height: h }}>
                  <button className={`cut-eye ${hidden ? 'is-off' : ''}`} title={hidden ? 'Show track' : 'Hide track'} onClick={() => toggleTrackHidden(tr.id)}>👁</button>
                  <span className="cut-tl__headlabel">{tr.label}</span>
                </div>
              );
            })}
            {/* Original source — its own locked base video + audio tracks */}
            {(() => { const hidden = !!analysis.laneHidden?.src; return (
              <div className={`cut-tl__head cut-tl__head--edit cut-tl__head--src ${hidden ? 'is-hidden' : ''}`} style={{ height: hidden ? HIDDEN_H : LANE_H.video }}>
                <button className={`cut-eye ${hidden ? 'is-off' : ''}`} title={hidden ? 'Show source video' : 'Hide source video'} onClick={() => toggleLaneHidden('src')}>👁</button>
                <span className="cut-tl__headlabel">🔒 SOURCE</span>
              </div>
            ); })()}
            {(() => { const hidden = !!analysis.laneHidden?.srcaud; return (
              <div className={`cut-tl__head cut-tl__head--edit cut-tl__head--src ${hidden ? 'is-hidden' : ''}`} style={{ height: hidden ? HIDDEN_H : LANE_H.audio }}>
                <button className={`cut-eye ${hidden ? 'is-off' : ''}`}
                  title={srcAudioState === 'none' ? 'Source has no audio stream'
                    : hidden ? 'Source audio is muted (lane hidden) — click to unmute + show'
                    : 'Mute source audio (hide lane)'}
                  onClick={() => toggleLaneHidden('srcaud')}>👁</button>
                <span className="cut-tl__headlabel">🔒 SOURCE ♪</span>
                {/* Always-visible cue for WHY the source is silent — shows even when
                    the lane is collapsed, so a hidden/no-audio source is never a mystery. */}
                {srcAudioState === 'none'
                  ? <span className="cut-tl__headflag cut-tl__headflag--warn" title="This source file has no audio stream">no audio</span>
                  : srcAudioState === 'off'
                    ? <span className="cut-tl__headflag cut-tl__headflag--warn" title="Source audio muted — click 👁 to restore">🔇</span>
                    : null}
              </div>
            ); })()}
            <div className="cut-tl__head cut-tl__head--div" style={{ height: DIV_H }} />
            {/* Read-only lane heads (below), each with a hide toggle */}
            {([
              { key: 'ad', label: 'Ad', h: LANE_H.strip },
              { key: 'cuts', label: 'Cuts', h: LANE_H.shots },
              { key: 'keyframe', label: 'Keyframe', h: LANE_H.keys },
              { key: 'vo', label: 'VO', h: LANE_H.speech },
              { key: 'dialogue', label: 'Dialogue', h: LANE_H.speech },
            ]).map(l => {
              const hidden = !!analysis.laneHidden?.[l.key];
              return (
                <div key={l.key} className={`cut-tl__head ${hidden ? 'is-hidden' : ''}`} style={{ height: hidden ? HIDDEN_H : l.h }}>
                  <button className={`cut-eye ${hidden ? 'is-off' : ''}`} title={hidden ? 'Show lane' : 'Hide lane'} onClick={() => toggleLaneHidden(l.key)}>👁</button>
                  <span className="cut-tl__headlabel">{l.label}</span>
                </div>
              );
            })}
          </div>
          <div className="cut-tl__scroll" onScroll={e => { if (headsRef.current) headsRef.current.style.transform = `translateY(${-(e.currentTarget as HTMLElement).scrollTop}px)`; }}>
            <div className="cut-tl__inner" style={{ width: laneW }}>
              {/* Ruler */}
              <div className="cut-tl__ruler" onPointerDown={scrubFromEvent}>
                {ticks.map(t => (
                  <div key={t} className="cut-tl__tick" style={{ left: t * pxs }}>
                    <span>{fmt(t)}</span>
                  </div>
                ))}
              </div>
              {/* Playhead across all lanes (moved via ref at 60fps during play) */}
              <div ref={playheadElRef} className="cut-tl__playhead" style={{ left: playhead * pxs }} />

              {/* ── Edit tracks (editable — drop Takes here) ── */}
              {tracks.map(tr => {
                const hidden = !!tr.hidden;
                const h = hidden ? HIDDEN_H : (tr.kind === 'video' ? LANE_H.video : LANE_H.audio);
                return (
                  <div key={tr.id}
                    className={`cut-tl__lane cut-tl__lane--edit cut-tl__lane--${tr.kind} ${dropTrack === tr.id ? 'is-dropok' : ''}`}
                    style={{ height: h }}
                    onDragOver={e => { if (!hidden) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (dropTrack !== tr.id) setDropTrack(tr.id); } }}
                    onDragLeave={() => setDropTrack(d => (d === tr.id ? null : d))}
                    onDrop={e => onTrackDrop(tr.id, e)}>
                    {!hidden && tr.clips.map(c => (
                      <div key={c.id}
                        className={`cut-clip ${tr.kind === 'audio' ? 'cut-clip--audio' : ''} ${selClip === c.id ? 'is-sel' : ''}`}
                        style={{ left: c.start * pxs, width: Math.max(10, c.dur * pxs) }}
                        title={`${c.label || c.srcKind} · ${fmt(c.start)}–${fmt(c.start + c.dur)} · ${c.dur.toFixed(2)}s${c.srcIn ? ` · in ${c.srcIn.toFixed(2)}s` : ''} — drag body to move, edges to trim`}
                        onPointerDown={e => onClipPointerDown(tr.id, c.id, 'move', e)}
                        onPointerMove={onClipPointerMove}
                        onPointerUp={onClipPointerUp}>
                        {tr.kind === 'video' && (isImageThumb(c.thumb)
                          ? <img src={fileUrl(c.thumb!)} alt="" draggable={false}
                              onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
                          : c.srcKind === 'video'
                            // No usable image poster (none, or a legacy .mp4 thumb) →
                            // paint the video's own first frame (metadata-only load)
                            // rather than a broken <img src=video>.
                            ? <video className="cut-clip__poster" src={fileUrl(c.src)} muted playsInline
                                preload="metadata" tabIndex={-1} />
                            : null)}
                        {tr.kind === 'video' && c.srcKind === 'video' && <span className="cut-clip__play">▶</span>}
                        <span className="cut-clip__label">{c.label || c.srcKind}</span>
                        {/* Edge trim handles */}
                        <span className="cut-clip__trim cut-clip__trim--l" title="Trim in-point"
                          onPointerDown={e => onClipPointerDown(tr.id, c.id, 'trim-l', e)}
                          onPointerMove={onClipPointerMove} onPointerUp={onClipPointerUp} />
                        <span className="cut-clip__trim cut-clip__trim--r" title="Trim out-point"
                          onPointerDown={e => onClipPointerDown(tr.id, c.id, 'trim-r', e)}
                          onPointerMove={onClipPointerMove} onPointerUp={onClipPointerUp} />
                        <button className="cut-clip__x" title="Remove clip"
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); deleteClip(tr.id, c.id); }}>×</button>
                      </div>
                    ))}
                    {!hidden && tr.clips.length === 0 && <span className="cut-tl__lanehint">Drag a Take here</span>}
                  </div>
                );
              })}

              {/* ── ORIGINAL source · locked base video track ── */}
              <div className="cut-tl__lane cut-tl__lane--edit cut-tl__lane--video cut-tl__lane--src"
                style={{ height: analysis.laneHidden?.src ? HIDDEN_H : LANE_H.video }}>
                {!analysis.laneHidden?.src && (
                  <div className="cut-clip cut-clip--src" style={{ left: 0, width: Math.max(10, duration * pxs) }}
                    title={`Original source — locked · ${fmt(duration)}`}>
                    {(shots[0]?.keyframe || shots[0]?.thumb || analysis.strip[0]?.path) &&
                      <img src={fileUrl(shots[0]?.keyframe || shots[0]?.thumb || analysis.strip[0]?.path)} alt="" draggable={false} />}
                    <span className="cut-clip__lock">🔒</span>
                    <span className="cut-clip__label">SOURCE</span>
                  </div>
                )}
              </div>
              {/* ── ORIGINAL source · locked audio track ── */}
              <div className="cut-tl__lane cut-tl__lane--edit cut-tl__lane--audio cut-tl__lane--src"
                style={{ height: analysis.laneHidden?.srcaud ? HIDDEN_H : LANE_H.audio }}>
                {!analysis.laneHidden?.srcaud && (
                  <div className={`cut-clip cut-clip--audio cut-clip--src ${srcAudioState === 'none' ? 'cut-clip--noaudio' : ''}`}
                    style={{ left: 0, width: Math.max(10, duration * pxs) }}
                    title={srcAudioState === 'none' ? 'This source file has no audio stream'
                      : `Original audio — locked · ${muted ? 'monitor muted (click 🔊 to hear)' : 'active (mixed)'}`}>
                    <span className="cut-clip__lock">🔒</span>
                    <span className="cut-clip__label">SOURCE ♪ · {SRC_AUDIO_LABEL[srcAudioState]}</span>
                  </div>
                )}
              </div>

              <div className="cut-tl__divider" style={{ height: DIV_H }} />

              {/* Lane 1 — الإعلان (filmstrip) */}
              <div className="cut-tl__lane cut-tl__lane--strip"
                style={{ height: analysis.laneHidden?.ad ? HIDDEN_H : LANE_H.strip }} onPointerDown={scrubFromEvent}>
                {!analysis.laneHidden?.ad && analysis.strip.map((f, i) => {
                  const next = analysis.strip[i + 1]?.t ?? duration;
                  return (
                    <img key={i} src={fileUrl(f.path)} alt="" className="cut-strip__f"
                      style={{ left: f.t * pxs, width: Math.max(2, (next - f.t) * pxs) }} draggable={false} />
                  );
                })}
              </div>

              {/* Lane 2 — Cuts (shot segments, colored by scene) */}
              <div className="cut-tl__lane cut-tl__lane--shots"
                style={{ height: analysis.laneHidden?.cuts ? HIDDEN_H : LANE_H.shots }}>
                {!analysis.laneHidden?.cuts && visibleShots.map(s => {
                  const color = s.sceneId ? sceneById.get(s.sceneId)?.color : undefined;
                  return (
                    <div key={s.i}
                      className={`cut-seg ${selShot === s.i ? 'is-sel' : ''} ${multiSel.has(s.i) ? 'is-multi' : ''}`}
                      style={{ left: s.start * pxs, width: Math.max(3, s.dur * pxs), '--seg': color || 'var(--line-strong)', '--sb-hue': hueForShot(s) } as React.CSSProperties}
                      title={`Shot ${s.i} · ${fmt(s.start)}–${fmt(s.end)} · ⌘-click to multi-select`}
                      onClick={e => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey) {
                          setMultiSel(prev => { const n = new Set(prev); n.has(s.i) ? n.delete(s.i) : n.add(s.i); return n; });
                        } else { setMultiSel(new Set()); setSelSpeech(null); setSelShot(s.i); seek(s.start + 0.02); }
                      }}>
                      <span className="cut-seg__no">{s.i}</span>
                    </div>
                  );
                })}
              </div>

              {/* Lane 3 — Keyframe (chosen frame per shot) */}
              <div className="cut-tl__lane cut-tl__lane--keys"
                style={{ height: analysis.laneHidden?.keyframe ? HIDDEN_H : LANE_H.keys }}>
                {!analysis.laneHidden?.keyframe && visibleShots.map(s => {
                  const img = s.keyframe || s.thumb;
                  return (
                    <div key={s.i}
                      className={`cut-key ${selShot === s.i ? 'is-sel' : ''} ${s.keyframe ? 'is-picked' : ''}`}
                      style={{ left: s.start * pxs, width: Math.max(3, s.dur * pxs), '--sb-hue': hueForShot(s) } as React.CSSProperties}
                      onClick={() => { setSelSpeech(null); setSelShot(s.i); seek(s.keyframeT ?? s.start + 0.02); }}>
                      {img ? <img src={fileUrl(img)} alt="" draggable={false} /> : <div className="cut-key__empty" />}
                    </div>
                  );
                })}
              </div>

              {/* Lane 4 — VO (voice-over) */}
              <div className="cut-tl__lane cut-tl__lane--speech"
                style={{ height: analysis.laneHidden?.vo ? HIDDEN_H : LANE_H.speech }}>
                {!analysis.laneHidden?.vo && voSegs.map((sg, i) => (
                  <div key={i} className={`cut-say cut-say--vo ${speech.indexOf(sg) === selSpeech ? 'is-sel' : ''}`}
                    title={`${sg.speaker ? sg.speaker + ' · ' : ''}${sg.text}`}
                    style={{ left: sg.start * pxs, width: Math.max(6, (sg.end - sg.start) * pxs) }}
                    onClick={() => { setSelSpeech(speech.indexOf(sg)); setSelShot(null); seek(sg.start + 0.02); }}>
                    <span className="cut-say__t">{sg.text}</span>
                  </div>
                ))}
              </div>

              {/* Lane 5 — Dialogue (on-screen speaker) */}
              <div className="cut-tl__lane cut-tl__lane--speech"
                style={{ height: analysis.laneHidden?.dialogue ? HIDDEN_H : LANE_H.speech }}>
                {!analysis.laneHidden?.dialogue && dlSegs.map((sg, i) => (
                  <div key={i} className={`cut-say cut-say--dl ${speech.indexOf(sg) === selSpeech ? 'is-sel' : ''}`}
                    title={`${sg.speaker ? sg.speaker + ' · ' : ''}${sg.text}`}
                    style={{ left: sg.start * pxs, width: Math.max(6, (sg.end - sg.start) * pxs) }}
                    onClick={() => { setSelSpeech(speech.indexOf(sg)); setSelShot(null); seek(sg.start + 0.02); }}>
                    <span className="cut-say__t">{sg.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          </div>
        </div>
        </div>
      )}
      </div>

      {/* ── Right dock · on-page make + takes gallery ── */}
      <CutsGenPanel
        project={genProject}
        selectedShot={selectedShot ?? null}
        dnaLook={analysis?.dna?.intent || analysis?.dna?.mood || undefined}
        onPromptEdit={(text) => {
          if (selectedShot?.brief) { selectedShot.brief.prompt = text; setTick(t => t + 1); }
        }}
        onPersist={() => { if (analysis) void persist(analysis); }}
        width={panelW}
        onResizeStart={startPanelResize}
      />

      {/* ── QA review overlay — compare each group to its frames ── */}
      {reviewKind && analysis && (() => {
        const groups = reviewKind === 'scene'
          ? scenes.map(sc => ({ id: sc.id, label: sc.label, color: sc.color, shots: sc.shots }))
          : people.map(p => ({ id: p.id, label: p.name, color: p.color, shots: p.shots }));
        const totalFlags = groups.reduce((m, g) => m + (verdicts[g.id]?.outliers.length || 0), 0);
        const frameFor = (i: number) => { const s = shots.find(x => x.i === i); return verifyFrames[i] || s?.keyframe || s?.thumb || ''; };
        return (
          <div className="cut-review" onClick={() => setReviewKind(null)}>
            <div className="cut-review__panel" onClick={e => e.stopPropagation()}>
              <div className="cut-review__head">
                <span className="cut-review__title">Verify {reviewKind === 'scene' ? 'Scenes' : 'People'}</span>
                <span className="cut-review__sub">{totalFlags ? `${totalFlags} suspect shot${totalFlags > 1 ? 's' : ''} flagged` : 'All groups coherent'}</span>
                <button className="cut-review__x" onClick={() => setReviewKind(null)} title="Close">×</button>
              </div>
              <div className="cut-review__body">
                {groups.map(g => {
                  const vd = verdicts[g.id];
                  const flagged = new Map((vd?.outliers || []).map(o => [o.shot, o]));
                  return (
                    <div key={g.id} className={`cut-rev ${vd ? (flagged.size ? 'is-warn' : 'is-ok') : ''}`} style={{ '--pc': g.color } as React.CSSProperties}>
                      <div className="cut-rev__head">
                        <span className="cut-rev__swatch" style={{ background: g.color }} />
                        <span className="cut-rev__label">{g.label}</span>
                        <span className="cut-rev__badge">{!vd ? '—' : flagged.size ? `⚠ ${flagged.size}` : '✓ coherent'}</span>
                      </div>
                      <div className="cut-rev__strip">
                        {g.shots.map(i => {
                          const o = flagged.get(i);
                          return (
                            <div key={i} className={`cut-rev__cell ${o ? 'is-out' : ''}`}>
                              <img src={fileUrl(frameFor(i))} alt="" draggable={false}
                                title={o ? `Shot ${i} — ${o.reason} (${Math.round(o.confidence * 100)}%)` : `Shot ${i}`}
                                onClick={() => { const s = shots.find(x => x.i === i); setSelShot(i); if (s) seek(s.start + 0.02); }} />
                              <span className="cut-rev__no">{i}</span>
                              {o && (
                                <button className="cut-rev__drop" title={`Remove shot ${i} from this group — ${o.reason}`}
                                  onClick={() => onFixOutlier(reviewKind, g.id, i)}>Remove</button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {vd && flagged.size > 0 && (
                        <div className="cut-rev__reasons">
                          {[...flagged.values()].map(o => (
                            <div key={o.shot} className="cut-rev__reason cut-copytext"><b>Shot {o.shot}:</b> {o.reason}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!groups.length && <div className="cut-scenes__empty">No groups to review.</div>}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
