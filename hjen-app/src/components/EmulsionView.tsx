import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store';
import hjenMaster from '../assets/hjen_master.svg';
import type { ProjectFileEntry, ProjectMeta, EmulsionEvent, VideoFileEntry } from '../types/hjen-bridge';
import {
  analyze,
  CAMERA_DEFAULT,
  BODY_LABELS,
  LENS_LABELS,
  STOCK_LABELS,
  DISTORTION_LABELS,
  type CameraChoice,
  type BodyId,
  type LensId,
  type StockId,
  type ScanRes,
  type ScenePreset,
  type SceneInfo,
  type DistortionType,
} from '../lib/emulsion';
import { renderAsync, matchAsync, type DofArg } from '../lib/emulsionClient';
import { depthAt } from '../lib/depthDefocus';
import { QualityBadge, DimsTag, cleanTitle } from './QualityBadge';

// ------------------------------------------------------------------ helpers
function fileUrl(absPath?: string | null): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

/** Read a frame off disk into an ImageData, optionally downscaled so the
 *  live preview stays interactive. Full-res (no maxDim) is used on Apply. */
async function loadImageData(path: string, maxDim?: number): Promise<ImageData> {
  const dataUrl = await window.hjen.readImageDataUrl(path);
  if (!dataUrl) throw new Error('Could not read the frame from disk');
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not decode the image'));
    img.src = dataUrl;
  });
  let w = img.naturalWidth, h = img.naturalHeight;
  if (maxDim && Math.max(w, h) > maxDim) {
    const s = maxDim / Math.max(w, h);
    w = Math.round(w * s); h = Math.round(h * s);
  }
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create a drawing context');
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function imageDataToPngBase64(data: ImageData): string {
  const cv = document.createElement('canvas');
  cv.width = data.width; cv.height = data.height;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('Could not create a save context');
  ctx.putImageData(data, 0, 0);
  return cv.toDataURL('image/png').split(',')[1];
}

const COMPARE_MAX_W = 6000; // combined-width cap for the side-by-side file

/** Compose ORIGINAL (left) | EDITED (right) at full resolution into one PNG.
 *  Both plates share a height; a thin 2px divider (token colour) sits between.
 *  If the combined width would exceed COMPARE_MAX_W, both scale down evenly. */
function composeCompareBase64(original: ImageData, edited: ImageData): string {
  const gap = 2;
  const h = Math.max(original.height, edited.height);
  const rawW = original.width + edited.width + gap;
  const scale = rawW > COMPARE_MAX_W ? COMPARE_MAX_W / rawW : 1;
  const ow = Math.max(1, Math.round(original.width * scale));
  const ew = Math.max(1, Math.round(edited.width * scale));
  const gh = Math.max(1, Math.round(gap * scale));
  const H = Math.max(1, Math.round(h * scale));

  const cv = document.createElement('canvas');
  cv.width = ow + gh + ew; cv.height = H;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('Could not create a compare context');

  const drawPlate = (data: ImageData, dx: number, dw: number) => {
    const tmp = document.createElement('canvas');
    tmp.width = data.width; tmp.height = data.height;
    tmp.getContext('2d')?.putImageData(data, 0, 0);
    ctx.drawImage(tmp, 0, 0, data.width, data.height, dx, 0, dw, H);
  };
  drawPlate(original, 0, ow);
  drawPlate(edited, ow + gh, ew);

  // 2px divider in a token colour (matches the stage divider = --whiteout)
  const line = getComputedStyle(document.documentElement).getPropertyValue('--whiteout').trim() || '#ffffff';
  ctx.fillStyle = line;
  ctx.fillRect(ow, 0, gh, H);

  return cv.toDataURL('image/png').split(',')[1];
}

const PREVIEW_MAX = 1920;   // still-preview cap — off-thread render lets us go crisp (near-WYSIWYG grain)
const SCRUB_MAX = 960;      // motion-preview cap — smaller so the look keeps up while scrubbing/playing
const DEBOUNCE_MS = 200;

// Cheap main-thread scene detection for the "Detected" badge (the worker returns
// only the image). Mirrors renderEmulsion's auto branch: night from median key,
// warm from mid-tone R/B ratio — depends on the base image only, not the choice.
const _smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / Math.max(e1 - e0, 1e-6)));
  return t * t * (3 - 2 * t);
};
function sceneFor(img: ImageData): SceneInfo {
  const a = analyze(img.data);
  const night = 1 - _smoothstep(0.12, 0.34, a.key);
  const warm = _smoothstep(1.05, 1.45, a.warmth);
  return { warmth: a.warmth, key: a.key, night, warm };
}

const SCENES: { id: ScenePreset; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'day', label: 'Day' },
  { id: 'night', label: 'Night' },
  { id: 'studio', label: 'Studio' },
  { id: 'golden', label: 'Golden' },
  { id: 'neon', label: 'Neon' },
];

/** Read-only detection badge text from the auto-analysed scene. */
function detectedLabel(scene: SceneInfo): string {
  const night = scene.night > 0.66 ? 'Night' : scene.night > 0.33 ? 'Dim' : 'Day';
  const warm = scene.warm > 0.66 ? 'Warm' : scene.warm > 0.33 ? 'Neutral' : 'Natural';
  return `Detected: ${night} · ${warm}`;
}

function shortenPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~');
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

// Clean, human display name for the generating model on a video card. Missing →
// null (hide the badge, never render "unknown").
function videoModelName(label?: string): string | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.includes('seedance')) return 'Seedance';
  if (l.includes('kling')) return 'Kling';
  if (l.includes('veo')) return 'Veo';
  if (l.includes('wan')) return 'Wan';
  if (l.includes('hailuo') || l.includes('minimax')) return 'MiniMax';
  if (l.includes('runway')) return 'Runway';
  if (l.includes('luma')) return 'Luma';
  const raw = label.replace(/[_-]+/g, ' ').trim();
  return raw.length > 16 ? raw.slice(0, 16) + '…' : raw;
}

// Quality/duration line from whatever the sidecar carried; omit missing pieces.
function videoMetaBits(e: VideoFileEntry): string {
  const bits: string[] = [];
  const q = e.size || e.ratio;
  if (q) bits.push(q);
  const secs = e.videoSeconds ?? (e.durationMs ? Math.round(e.durationMs / 1000) : undefined);
  if (secs) bits.push(`${secs}s`);
  return bits.join(' · ');
}

// focus is now in METRES; fnum is the aperture f-number (SMALLER = more blur).
interface DofSettings { enabled: boolean; focusAuto: boolean; focus: number; fnum: number; haze: number; }
const DOF_DEFAULT: DofSettings = { enabled: false, focusAuto: true, focus: 2.0, fnum: 2.0, haze: 0.12 };
const DOF_FNUM_MIN = 1.4, DOF_FNUM_MAX = 8;

interface SegSettings { enabled: boolean; skinProtect: number; skyTreat: number; }
const SEG_DEFAULT: SegSettings = { enabled: false, skinProtect: 0.6, skyTreat: 0.4 };

// The Emulsion Video engine processes at the clip's NATIVE resolution and
// preserves its codec + audio (no --maxw sent). We only DISPLAY the source
// resolution/ratio as a read-only "Output matches source" line — no control.
// Prettify a clip's sidecar `size`/`ratio` (720p/1080p/4k/WxH/16:9) for that line.
function sourceResLabel(size?: string | null): string | null {
  if (!size) return null;
  const s = size.toLowerCase().trim();
  const wh = s.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/);
  if (wh) return `${wh[1]}×${wh[2]}`;
  if (s.includes('4k') || s.includes('2160')) return '4K';
  if (s.includes('1440')) return '1440p';
  if (s.includes('1080')) return '1080p';
  if (s.includes('720')) return '720p';
  return size;   // e.g. an aspect ratio like "16:9"
}

// ------------------------------------------------------------------ component
export function EmulsionView() {
  const setActiveView = useStore(s => s.setActiveView);
  const activeProject = useStore(s => s.activeProject)();
  const projects = useStore(s => s.projects);

  const [mode, setMode] = useState<'image' | 'video'>('image');
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [choice, setChoice] = useState<CameraChoice>(CAMERA_DEFAULT);

  // ---- Video mode: the actual clip, its two Scene-Protect strengths, run state ----
  // sourcePath (above) holds the extracted first frame, so the ENTIRE live look
  // preview + camera controls work unchanged on a representative still.
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [vidSkin, setVidSkin] = useState(0);   // 0..1 — Skin Protect (0 = off)
  const [vidSky, setVidSky] = useState(0);     // 0..1 — Sky Treat (0 = off)
  const [vidSourceSize, setVidSourceSize] = useState<string | null>(null); // picked clip's sidecar size/ratio (for the read-only output line)
  const [vidProcessing, setVidProcessing] = useState(false);
  const [vidProgress, setVidProgress] = useState<{ i: number; n: number } | null>(null);
  const [vidOutPath, setVidOutPath] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false); // first-frame extraction in flight

  // ---- Scrub + Play live-look preview (hidden <video> → canvas → renderAsync) ----
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  const scrubCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rvfcRef = useRef<number | null>(null);
  const [vidDuration, setVidDuration] = useState(0);
  const [vidTime, setVidTime] = useState(0);
  const [vidPlaying, setVidPlaying] = useState(false);
  const [scene, setScene] = useState<SceneInfo | null>(null);
  const [working, setWorking] = useState(false);   // preview recompute in flight
  const [applying, setApplying] = useState(false); // full-res render + save
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [split, setSplit] = useState(50);          // before/after divider (0..100)

  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [browseSlug, setBrowseSlug] = useState<string | null>(null);

  const [library, setLibrary] = useState<EmulsionEvent[]>([]);
  const [libNote, setLibNote] = useState<string | null>(null); // e.g. original-not-found fallback

  const [matching, setMatching] = useState(false);          // auto-tuner in flight
  const [matchProgress, setMatchProgress] = useState(0);    // 0..1
  const [matchDist, setMatchDist] = useState<{ before: number; after: number } | null>(null);

  // Depth DoF — LIVE scene-aware defocus. Depth is computed ONCE (~5s Python),
  // then focus/aperture/haze are instant sliders + click-to-focus (worker composites).
  const [dof, setDof] = useState<DofSettings>(DOF_DEFAULT);
  const [depthMap, setDepthMap] = useState<ImageData | null>(null); // 8-bit metric depth (0=near,255=far)
  const [depthRange, setDepthRange] = useState<{ minM: number; maxM: number } | null>(null); // metres reconstruction
  const [dofComputing, setDofComputing] = useState(false);
  const [focusMarker, setFocusMarker] = useState<{ x: number; y: number; key: number } | null>(null);

  const beforeRef = useRef<HTMLCanvasElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const origRef = useRef<ImageData | null>(null);   // downscaled source pixels
  const dimsRef = useRef<{ w: number; h: number } | null>(null);
  const tokenRef = useRef(0);                       // stale-compute guard
  const timerRef = useRef<number | null>(null);
  // live DoF params for the debounced render closure (avoid re-binding recompute)
  const dofRef = useRef<{ enabled: boolean; focus: number | 'auto'; fnum: number; haze: number; depth: ImageData | null; range: { minM: number; maxM: number } | null }>({
    enabled: false, focus: 'auto', fnum: 2.0, haze: 0.12, depth: null, range: null,
  });

  // Scene Protect — segmentation-aware treatment (protect skin, de-grain sky). LIVE:
  // masks computed ONCE (~4s), then skin/sky strengths are instant in the worker.
  const [seg, setSeg] = useState<SegSettings>(SEG_DEFAULT);
  const [segMasks, setSegMasks] = useState<{ skin: ImageData | null; sky: ImageData | null } | null>(null);
  const [segComputing, setSegComputing] = useState(false);
  const segRef = useRef<{ enabled: boolean; skinProtect: number; skyTreat: number; masks: { skin: ImageData | null; sky: ImageData | null } | null }>({
    enabled: false, skinProtect: 0.6, skyTreat: 0.4, masks: null,
  });

  // ---- Library: the dedicated Emulsion folder, newest first ----
  const refreshLibrary = useCallback(async () => {
    try {
      const items = await window.hjen.listEmulsion();
      setLibrary(items);
    } catch {
      setLibrary([]);
    }
  }, []);
  useEffect(() => { refreshLibrary(); }, [refreshLibrary]);

  // ---- project picker: load files (images) or clips (video mode) on open / switch ----
  useEffect(() => {
    if (!pickerOpen) return;
    const slug = browseSlug ?? activeProject?.slug ?? null;
    if (!slug) { setProjectFiles([]); return; }
    let cancelled = false;
    const load = mode === 'video'
      ? window.hjen.listProjectVideos({ projectSlug: slug }) as Promise<VideoFileEntry[]>
      : window.hjen.listProjectFiles({ projectSlug: slug });
    load.then(files => {
      if (!cancelled) setProjectFiles(files);
    }).catch(() => { if (!cancelled) setProjectFiles([]); });
    return () => { cancelled = true; };
  }, [pickerOpen, browseSlug, activeProject?.slug, mode]);

  // ---- Emulsion Video progress stream (frame i/N) ----
  useEffect(() => window.hjen.onEmulsionVideoProgress((_e, d) => setVidProgress(d)), []);

  // ---- load preview pixels whenever the source changes ----
  // Base is ALWAYS the original source — depth-defocus now happens in the worker
  // via the dof arg (no pre-defocused base swap).
  useEffect(() => {
    if (!sourcePath) { origRef.current = null; dimsRef.current = null; return; }
    let cancelled = false;
    setWorking(true);
    setError(null);
    loadImageData(sourcePath, PREVIEW_MAX).then(data => {
      if (cancelled) return;
      origRef.current = data;
      dimsRef.current = { w: data.width, h: data.height };
      // paint the base into the "before" plate once
      const bc = beforeRef.current;
      if (bc) {
        bc.width = data.width; bc.height = data.height;
        bc.getContext('2d')?.putImageData(data, 0, 0);
      }
      // the auto-detected scene depends on the base only — compute once per load
      try { setScene(sceneFor(data)); } catch { /* non-critical badge */ }
      recompute();
    }).catch(err => {
      if (!cancelled) { setWorking(false); setError(err?.message || String(err)); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePath]);

  // ---- recompute the emulsion preview (debounced, off-thread) on control moves ----
  const recompute = useCallback(() => {
    const orig = origRef.current;
    if (!orig) return;
    setWorking(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const myToken = ++tokenRef.current;   // stale-guard: only the latest paints
    timerRef.current = window.setTimeout(() => {
      const choiceNow = choiceRef.current;
      const d = dofRef.current;
      const dofArg: DofArg | undefined = (d.enabled && d.depth && d.range)
        ? { depth: d.depth, range: d.range, params: { focus: d.focus, fnum: d.fnum, haze: d.haze } }
        : undefined;
      const s = segRef.current;
      const segArg = (s.enabled && s.masks)
        ? { masks: s.masks, opts: { skinProtect: s.skinProtect, skyTreat: s.skyTreat } }
        : undefined;
      renderAsync(orig, choiceNow, dofArg, segArg).then(image => {
        if (myToken !== tokenRef.current) return;   // superseded — discard
        const ac = afterRef.current;
        if (ac) {
          ac.width = image.width; ac.height = image.height;
          ac.getContext('2d')?.putImageData(image, 0, 0);
        }
      }).catch(err => {
        if (myToken === tokenRef.current) setError(err?.message || String(err));
      }).finally(() => {
        if (myToken === tokenRef.current) setWorking(false);
      });
    }, DEBOUNCE_MS);
  }, []);

  // keep the latest choice available to the debounced closure without re-binding
  const choiceRef = useRef(choice);
  useEffect(() => { choiceRef.current = choice; recompute(); }, [choice, recompute]);
  // DoF params + depth are live — mirror into the ref and re-render on any change
  useEffect(() => {
    dofRef.current = {
      enabled: dof.enabled,
      focus: dof.focusAuto ? 'auto' : dof.focus,
      fnum: dof.fnum,
      haze: dof.haze,
      depth: depthMap,
      range: depthRange,
    };
    recompute();
  }, [dof, depthMap, depthRange, recompute]);
  // Scene Protect params + masks are live too — mirror + re-render on any change
  useEffect(() => {
    segRef.current = { enabled: seg.enabled, skinProtect: seg.skinProtect, skyTreat: seg.skyTreat, masks: segMasks };
    recompute();
  }, [seg, segMasks, recompute]);

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  // fade the click-to-focus marker after its ring animation
  useEffect(() => {
    if (!focusMarker) return;
    const t = window.setTimeout(() => setFocusMarker(null), 900);
    return () => window.clearTimeout(t);
  }, [focusMarker]);

  // ---- source selection (mirrors the Enhancer) ----
  const pickSource = async () => {
    const paths = await window.hjen.pickImageFiles();
    if (!paths || paths.length === 0) return;
    setSavedPath(null); setScene(null); setSplit(50); setMatchDist(null); setLibNote(null); clearDof(); clearSeg();
    setSourcePath(paths[0]);
  };
  const openPicker = () => { setBrowseSlug(activeProject?.slug ?? null); setPickerOpen(true); };
  const pickFromProject = (entry: ProjectFileEntry) => {
    setPickerOpen(false);
    if (mode === 'video') {
      const v = entry as VideoFileEntry;
      setVidSourceSize(v.size || v.ratio || null);
      applyVideoSource(entry.imgPath);
      return;
    }
    setSavedPath(null); setScene(null); setSplit(50); setMatchDist(null); setLibNote(null); clearDof(); clearSeg();
    setSourcePath(entry.imgPath);
  };
  const reset = () => {
    setSourcePath(null); setScene(null); setSavedPath(null); setMatchDist(null); setLibNote(null); clearDof(); clearSeg();
    setError(null); setChoice(CAMERA_DEFAULT); setSplit(50);
    stopPlay(); setVidDuration(0); setVidTime(0);
    setVideoPath(null); setVidOutPath(null); setVidProgress(null); setVidSkin(0); setVidSky(0); setVidSourceSize(null);
    origRef.current = null; dimsRef.current = null;
  };

  // ---- Video source: pick a clip, extract its first frame as the look preview ----
  const applyVideoSource = async (vPath: string) => {
    stopPlay(); setVidDuration(0); setVidTime(0);
    setVideoPath(vPath);
    setVidOutPath(null); setVidProgress(null);
    setSavedPath(null); setScene(null); setSplit(50); setMatchDist(null); setLibNote(null); clearDof(); clearSeg();
    setError(null); setVideoLoading(true);
    try {
      const r = await window.hjen.videoFirstFrame({ videoPath: vPath });
      if (r.ok && r.path) setSourcePath(r.path);           // drives the existing still preview pipeline
      else { setSourcePath(null); setError(r.message || 'Could not read the first frame of the clip'); }
    } catch (err: any) {
      setSourcePath(null); setError(err?.message || String(err));
    } finally {
      setVideoLoading(false);
    }
  };
  const pickVideoSource = async () => {
    const p = await window.hjen.pickVideoFile();
    if (!p) return;
    setVidSourceSize(null);   // native pick carries no sidecar resolution
    await applyVideoSource(p);
  };

  // ---- Process Video: run the same look over every frame (minutes, streamed) ----
  const processVideo = async () => {
    if (!videoPath || vidProcessing) return;
    setVidProcessing(true); setVidProgress(null); setVidOutPath(null); setError(null);
    try {
      const r = await window.hjen.emulsionVideo({ videoPath, choice, skin: vidSkin, sky: vidSky }); // no maxw ⇒ native resolution + preserved codec/audio
      if (r.ok && r.path) setVidOutPath(r.path);
      else setError(r.message || 'Video processing failed');
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setVidProcessing(false);
    }
  };

  // ---- grab the hidden video's current frame → feed the SAME live look preview ----
  // Renders the look DIRECTLY (not via the 200ms debounce) so the graded plate
  // keeps up during play/scrub; an in-flight guard drops frames when the worker
  // is busy (best-effort moving preview).
  const renderingRef = useRef(false);
  const grabAndPreview = useCallback(() => {
    const v = hiddenVideoRef.current;
    if (!v || !v.videoWidth) return;
    let w = v.videoWidth, h = v.videoHeight;
    // Motion preview: cap smaller than the still PREVIEW_MAX so the per-frame look
    // renders several times faster (a slideshow at 2MP → a moving preview at ~0.6MP).
    // The FINAL render on Process Video is always full-res regardless.
    if (Math.max(w, h) > SCRUB_MAX) {
      const s = SCRUB_MAX / Math.max(w, h);
      w = Math.round(w * s); h = Math.round(h * s);
    }
    const cv = scrubCanvasRef.current || (scrubCanvasRef.current = document.createElement('canvas'));
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    let data: ImageData;
    try {
      ctx.drawImage(v, 0, 0, w, h);
      data = ctx.getImageData(0, 0, w, h);   // clean canvas (ACAO + crossOrigin)
    } catch { return; }                      // a not-yet-decoded seek — next tick repaints
    origRef.current = data;
    dimsRef.current = { w, h };
    const bc = beforeRef.current;
    if (bc) { bc.width = w; bc.height = h; bc.getContext('2d')?.putImageData(data, 0, 0); }
    if (renderingRef.current) return;        // drop this frame; the worker is busy
    renderingRef.current = true;
    renderAsync(data, choiceRef.current, undefined, undefined).then(image => {
      const ac = afterRef.current;
      if (ac) { ac.width = image.width; ac.height = image.height; ac.getContext('2d')?.putImageData(image, 0, 0); }
    }).catch(() => { /* transient */ }).finally(() => { renderingRef.current = false; });
  }, []);

  const cancelPlayLoop = useCallback(() => {
    const v = hiddenVideoRef.current;
    if (rvfcRef.current != null) {
      if (v && 'cancelVideoFrameCallback' in v) (v as any).cancelVideoFrameCallback(rvfcRef.current);
      else cancelAnimationFrame(rvfcRef.current);
      rvfcRef.current = null;
    }
  }, []);

  const stopPlay = useCallback(() => {
    const v = hiddenVideoRef.current;
    if (v) v.pause();
    cancelPlayLoop();
    setVidPlaying(false);
  }, [cancelPlayLoop]);

  const startPlay = useCallback(() => {
    const v = hiddenVideoRef.current;
    if (!v || !v.duration) return;
    if (v.currentTime >= v.duration - 0.05) v.currentTime = 0;   // replay from the top
    const step = () => {
      const vid = hiddenVideoRef.current;
      if (!vid) return;
      grabAndPreview();
      setVidTime(vid.currentTime);
      if ('requestVideoFrameCallback' in vid) rvfcRef.current = (vid as any).requestVideoFrameCallback(step);
      else rvfcRef.current = requestAnimationFrame(step);
    };
    setVidPlaying(true);
    v.play().then(() => {
      if ('requestVideoFrameCallback' in v) rvfcRef.current = (v as any).requestVideoFrameCallback(step);
      else rvfcRef.current = requestAnimationFrame(step);
    }).catch(() => setVidPlaying(false));
  }, [grabAndPreview]);

  const togglePlay = () => { if (vidPlaying) stopPlay(); else startPlay(); };

  const onScrub = (t: number) => {
    const v = hiddenVideoRef.current;
    if (!v) return;
    if (vidPlaying) stopPlay();
    setVidTime(t);
    v.currentTime = t;   // 'seeked' → grabAndPreview repaints
  };

  // release the hidden video on unmount (pause + cancel the frame loop)
  useEffect(() => () => {
    const v = hiddenVideoRef.current;
    if (rvfcRef.current != null) {
      if (v && 'cancelVideoFrameCallback' in v) (v as any).cancelVideoFrameCallback(rvfcRef.current);
      else cancelAnimationFrame(rvfcRef.current);
    }
    if (v) v.pause();
  }, []);

  // ---- switch Image ⇄ Video: clear both flows so they never bleed into each other ----
  const switchMode = (m: 'image' | 'video') => {
    if (m === mode) return;
    setMode(m);
    setSourcePath(null); setVideoPath(null); setVidOutPath(null); setVidProgress(null);
    stopPlay(); setVidDuration(0); setVidTime(0);
    setVidSkin(0); setVidSky(0); setVidSourceSize(null);
    setScene(null); setSavedPath(null); setMatchDist(null); setLibNote(null); setError(null);
    setChoice(CAMERA_DEFAULT); setSplit(50); clearDof(); clearSeg();
    origRef.current = null; dimsRef.current = null;
  };

  const patch = (p: Partial<CameraChoice>) => setChoice(c => ({ ...c, ...p }));

  // ---- reopen a saved render: load its PNG + restore its exact camera look ----
  const openFromLibrary = async (it: EmulsionEvent) => {
    setError(null); setSavedPath(null); setScene(null); setSplit(50); setMatchDist(null); clearDof(); clearSeg();
    setChoice(it.camera ? { ...CAMERA_DEFAULT, ...it.camera } : CAMERA_DEFAULT);
    // Re-derive from the ORIGINAL frame so a re-apply is a single clean pass (no
    // emulsion stacking). Fall back to the rendered PNG only if the original is gone.
    let base = it.imgPath;
    let note: string | null = null;
    if (it.sourcePath && await window.hjen.pathExists(it.sourcePath)) {
      base = it.sourcePath;
    } else {
      note = 'Original not found — editing the rendered image';
    }
    setLibNote(note);
    setSourcePath(base);
  };

  // ---- before/after divider drag ----
  const onStageMove = (clientX: number) => {
    const el = stageRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const pct = ((clientX - box.left) / box.width) * 100;
    setSplit(Math.max(0, Math.min(100, pct)));
  };
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    onStageMove(e.clientX);
    const move = (ev: PointerEvent) => onStageMove(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // current live DoF arg (or undefined) for a render — used by preview + Apply
  const dofArgNow = (): DofArg | undefined =>
    (dof.enabled && depthMap && depthRange)
      ? { depth: depthMap, range: depthRange, params: { focus: dof.focusAuto ? 'auto' : dof.focus, fnum: dof.fnum, haze: dof.haze } }
      : undefined;

  // current live Scene Protect arg (or undefined) for a render
  const segArgNow = (): { masks: { skin: ImageData | null; sky: ImageData | null }; opts: { skinProtect: number; skyTreat: number } } | undefined =>
    (seg.enabled && segMasks)
      ? { masks: segMasks, opts: { skinProtect: seg.skinProtect, skyTreat: seg.skyTreat } }
      : undefined;

  // ---- apply: full-resolution render (DoF + Scene Protect baked via the worker) + save ----
  const apply = async () => {
    if (!sourcePath || applying) return;
    setApplying(true); setError(null);
    try {
      const full = await loadImageData(sourcePath);         // original at full res
      const dofArg = dofArgNow();                            // depth map scales to full-res
      const segArg = segArgNow();                            // masks scale to full-res
      const image = await renderAsync(full, choice, dofArg, segArg); // off-thread; DoF then look then protect
      const info = sceneFor(full);                           // scene metadata for the sidecar
      const base64 = imageDataToPngBase64(image);
      const compareBase64 = composeCompareBase64(full, image); // original | edited
      const sourceName = sourcePath.split('/').pop() || 'frame';
      const saved = await window.hjen.saveEmulsion({
        base64,
        compareBase64,
        camera: choice,
        scene: info,
        sourcePath,
        sourceName,
      });
      if (saved?.imgPath) setSavedPath(saved.imgPath);
      await refreshLibrary();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setApplying(false);
    }
  };

  // ---- Match to Cinema: self-calibrating auto-tuner (greedy camera search) ----
  const matchToCinema = async () => {
    if (!sourcePath || matching) return;
    setMatching(true); setMatchProgress(0); setMatchDist(null); setError(null);
    try {
      const img = origRef.current ?? await loadImageData(sourcePath, PREVIEW_MAX);
      const result = await matchAsync(img, p => setMatchProgress(p));
      setChoice(result.choice);       // drives all controls + the live preview
      setMatchDist({ before: result.before, after: result.after });
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setMatching(false);
    }
  };

  // ---- Depth DoF (LIVE): compute the depth map ONCE, then everything is instant ----
  const clearDof = () => { setDepthMap(null); setDepthRange(null); setDof(DOF_DEFAULT); setFocusMarker(null); };
  // focus (metres) / f-number / haze are live now — no invalidation, just a re-render (via the dof effect)
  const patchDof = (p: Partial<DofSettings>) => setDof(d => ({ ...d, ...p }));
  const computeDepth = async () => {
    if (!sourcePath || dofComputing) return;
    setDofComputing(true); setError(null);
    try {
      const r = await window.hjen.emulsionDepthPro({ imagePath: sourcePath });  // Apple Depth Pro — METRIC
      if (r.ok && r.path && r.minM != null && r.maxM != null) {
        const dm = await loadImageData(r.path);                 // 8-bit metric depth (0=near,255=far)
        const range = { minM: r.minM, maxM: r.maxM };
        setDepthMap(dm);
        setDepthRange(range);
        // seed a near-subject default for the Manual focus slider (metres)
        setDof(d => ({ ...d, enabled: true, focus: range.minM + 0.2 * (range.maxM - range.minM) }));
      } else {
        setError(r.message || 'Local depth model unavailable');  // never crash
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setDofComputing(false);
    }
  };

  // ---- Scene Protect (LIVE): compute masks ONCE, then skin/sky strengths are instant ----
  const clearSeg = () => { setSegMasks(null); setSeg(SEG_DEFAULT); };
  const patchSeg = (p: Partial<SegSettings>) => setSeg(s => ({ ...s, ...p }));
  const computeMasks = async () => {
    if (!sourcePath || segComputing) return;
    setSegComputing(true); setError(null);
    try {
      const r = await window.hjen.emulsionSegment({ imagePath: sourcePath });
      if (r.ok && r.skin && r.sky) {
        const [skin, sky] = await Promise.all([loadImageData(r.skin), loadImageData(r.sky)]);
        setSegMasks({ skin, sky });
        setSeg(s => (s.enabled ? s : { ...s, enabled: true }));  // show it once ready
      } else {
        setError(r.message || 'Local segmentation model unavailable');  // never crash
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSegComputing(false);
    }
  };

  // ---- click-to-focus: map a stage click to the depth at that image point ----
  const focusFromClick = (clientX: number, clientY: number) => {
    const el = stageRef.current, dims = dimsRef.current;
    if (!el || !dims || !depthMap || !depthRange) return;
    const box = el.getBoundingClientRect();
    const scale = Math.min(box.width / dims.w, box.height / dims.h); // object-fit: contain
    const dispW = dims.w * scale, dispH = dims.h * scale;
    const offX = (box.width - dispW) / 2, offY = (box.height - dispH) / 2;
    const fx = (clientX - box.left - offX) / dispW;
    const fy = (clientY - box.top - offY) / dispH;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;             // clicked the letterbox
    const m = depthAt(depthMap, depthRange, fx, fy);              // true metric depth (metres)
    setDof(d => ({ ...d, focusAuto: false, focus: m }));
    setFocusMarker({ x: clientX - box.left, y: clientY - box.top, key: Date.now() });
  };
  const onStagePointerDown = (e: React.PointerEvent) => {
    if (dof.enabled && depthMap) { focusFromClick(e.clientX, e.clientY); return; } // focus mode
    startDrag(e);                                                                   // divider drag
  };

  const hasSource = !!sourcePath;
  const busy = working || applying || matching || dofComputing;
  const dofActive = dof.enabled && !!depthMap;

  // Video engine transparency: name what does the work (HJEN names the model per
  // task). Video runs the deterministic Body×Lens×Stock look — no cloud, no AI
  // generation — plus Segformer only when Scene Protect is engaged.
  const vidSceneProtectOn = vidSkin > 0 || vidSky > 0;
  const vidEngineLine = `Local Emulsion · ${BODY_LABELS[choice.body]} · ${LENS_LABELS[choice.lens]} · ${STOCK_LABELS[choice.stock]}${vidSceneProtectOn ? ' · + Segformer (segmentation)' : ''}`;

  return (
    <div className="emu" dir="ltr">
      <header className="emu__header">
        <button className="emu__back no-drag" onClick={() => setActiveView('studio')}>← Studio</button>
        <div className="emu__title">
          <h1>Emulsion</h1>
          <span className="mono-label">
            {mode === 'video'
              ? 'Give the whole clip a real camera body · local'
              : 'Give the frame a real camera body · local · instant'}
          </span>
        </div>
        <div className="emu-mode segmented no-drag" role="tablist" aria-label="Emulsion mode">
          <button
            className={`segmented__opt ${mode === 'image' ? 'segmented__opt--on' : ''}`}
            onClick={() => switchMode('image')}
            role="tab"
            aria-selected={mode === 'image'}
          >Image</button>
          <button
            className={`segmented__opt ${mode === 'video' ? 'segmented__opt--on' : ''}`}
            onClick={() => switchMode('video')}
            role="tab"
            aria-selected={mode === 'video'}
          >Video</button>
        </div>
        <div className="emu__project mono-label">
          {activeProject ? activeProject.name : 'No project'}
        </div>
      </header>

      <div className="emu__body">
        {/* ---- left: stage + library strip ---- */}
        <div className="emu-main">
          <section className="emu-stage-wrap">
            {!hasSource ? (
              <div className="emu-dropzone-wrap">
                <button
                  className="emu-dropzone no-drag"
                  onClick={mode === 'video' ? pickVideoSource : pickSource}
                  disabled={videoLoading}
                >
                  {videoLoading ? (
                    <>
                      <span className="emu-match__spin" aria-hidden />
                      <div className="emu-dropzone__title">Reading the clip…</div>
                      <div className="emu-dropzone__sub mono-label">Extracting a frame to tune the look</div>
                    </>
                  ) : mode === 'video' ? (
                    <>
                      <img className="emu-dropzone__mark" src={hjenMaster} alt="" />
                      <div className="emu-dropzone__title">Choose a clip</div>
                      <div className="emu-dropzone__sub mono-label">MP4 · any AI-made video</div>
                    </>
                  ) : (
                    <>
                      <img className="emu-dropzone__mark" src={hjenMaster} alt="" />
                      <div className="emu-dropzone__title">Choose a frame</div>
                      <div className="emu-dropzone__sub mono-label">PNG / JPG / WEBP · any AI-made frame</div>
                    </>
                  )}
                </button>
                <button
                  className="emu-fromproject no-drag"
                  onClick={openPicker}
                  disabled={projects.length === 0 || videoLoading}
                  title={projects.length === 0 ? 'No projects yet' : mode === 'video' ? 'Browse earlier clips' : 'Browse earlier frames'}
                >
                  From a project
                </button>
              </div>
            ) : (
              <div
                className={`emu-stage ${dofActive ? 'emu-stage--focus' : ''}`}
                ref={stageRef}
                onPointerDown={onStagePointerDown}
              >
                <canvas className="emu-plate emu-plate--before" ref={beforeRef} />
                <canvas
                  className="emu-plate emu-plate--after"
                  ref={afterRef}
                  style={{ clipPath: `inset(0 0 0 ${split}%)` }}
                />
                <div className="emu-divider" style={{ left: `${split}%` }}>
                  <span className="emu-divider__grip no-drag" onPointerDown={startDrag} aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M9 6l-4 6 4 6M15 6l4 6-4 6" />
                    </svg>
                  </span>
                </div>
                <span className="emu-tag emu-tag--before mono-label">Original · AI</span>
                <span className="emu-tag emu-tag--after mono-label">Emulsion</span>
                <span className="emu-hint mono-label">
                  {mode === 'video'
                    ? 'Representative frame · tune the look, then process the whole clip'
                    : 'Preview downscaled · Apply renders at full resolution'}
                </span>
                {libNote && <span className="emu-libnote mono-label" title="A re-apply would stack a second emulsion pass on the already-rendered image.">{libNote}</span>}
                {focusMarker && <span key={focusMarker.key} className="emu-focus-ring" style={{ left: focusMarker.x, top: focusMarker.y }} aria-hidden />}
                {working && <span className="emu-working mono-label">Rendering…</span>}

                <div className="emu-stage__swap no-drag">
                  <button
                    className="emu-swap"
                    onClick={mode === 'video' ? pickVideoSource : pickSource}
                    title={mode === 'video' ? 'Another clip' : 'Another frame'}
                  >Swap</button>
                  <button className="emu-swap" onClick={openPicker} title="From a project">Project</button>
                </div>
              </div>
            )}
          </section>

          {/* ---- Scrub + Play the live look through the whole clip (video mode) ---- */}
          {mode === 'video' && videoPath && (
            <>
              <video
                ref={hiddenVideoRef}
                className="emu-hidden-video"
                src={fileUrl(videoPath)}
                crossOrigin="anonymous"
                muted
                playsInline
                preload="auto"
                aria-hidden
                onLoadedMetadata={e => setVidDuration((e.currentTarget as HTMLVideoElement).duration || 0)}
                onSeeked={() => { const v = hiddenVideoRef.current; if (v) { grabAndPreview(); setVidTime(v.currentTime); } }}
                onEnded={stopPlay}
              />
              {hasSource && (
                <div className="emu-transport no-drag" aria-label="Preview transport">
                  <button
                    className="emu-transport__play"
                    onClick={togglePlay}
                    disabled={vidProcessing || !vidDuration}
                    title={vidPlaying ? 'Pause' : 'Play the look through the clip'}
                    aria-label={vidPlaying ? 'Pause' : 'Play'}
                  >
                    {vidPlaying ? (
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5z" /></svg>
                    )}
                  </button>
                  <span className="emu-transport__time mono-label">{fmtTime(vidTime)}</span>
                  <input
                    className="emu-range emu-transport__scrub no-drag"
                    type="range"
                    min={0} max={vidDuration || 0} step={0.02}
                    value={Math.min(vidTime, vidDuration || 0)}
                    disabled={vidProcessing || !vidDuration}
                    onChange={e => onScrub(parseFloat(e.target.value))}
                    aria-label="Scrub through the clip"
                  />
                  <span className="emu-transport__time mono-label">{fmtTime(vidDuration)}</span>
                </div>
              )}
            </>
          )}

          {/* ---- Video result / progress (video mode only) ---- */}
          {mode === 'video' && (
            <section className="emu-vidout" aria-label="Video result">
              {vidProcessing ? (
                <div className="emu-vidout__running">
                  <div className="emu-vidout__label mono-label">
                    {vidProgress ? `Processing video… frame ${vidProgress.i}/${vidProgress.n}` : 'Processing video… starting'}
                  </div>
                  <div className="emu-vidout__track" aria-hidden>
                    <span
                      className="emu-vidout__fill"
                      style={{ width: vidProgress ? `${Math.round((vidProgress.i / Math.max(1, vidProgress.n)) * 100)}%` : '4%' }}
                    />
                  </div>
                  <div className="emu-vidout__hint mono-label">Runs locally · minutes for a short clip · the graded clip lands in your Emulsion folder</div>
                </div>
              ) : vidOutPath ? (
                <div className="emu-vidout__done">
                  <video className="emu-vidout__player" src={fileUrl(vidOutPath)} controls />
                  <div className="emu-vidout__meta">
                    <span className="emu-vidout__label mono-label">Saved to your Emulsion folder</span>
                    <div className="emu-vidout__acts no-drag">
                      <button className="emu-swap" onClick={() => window.hjen.revealInFinder(vidOutPath)} title="Reveal in Finder">Reveal in Finder</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="emu-vidout__idle mono-label">
                  {videoPath ? 'Tune the look on the frame, then Process Video' : 'Choose a clip to begin'}
                </div>
              )}
            </section>
          )}

          {/* ---- Library: the dedicated Emulsion folder (image mode) ---- */}
          {mode === 'image' && (
          <section className="emu-lib" aria-label="Emulsion library">
            <div className="emu-lib__head mono-label">
              <span>Library</span>
              {library.length > 0 && <span className="emu-lib__count">{library.length}</span>}
            </div>
            {library.length === 0 ? (
              <div className="emu-lib__empty mono-label">No emulsions yet</div>
            ) : (
              <div className="emu-lib__strip">
                {library.map(it => (
                  <div className="emu-lib__item" key={it.imgPath}>
                    <button
                      className="emu-lib__thumb-btn no-drag"
                      onClick={() => openFromLibrary(it)}
                      title={`Re-open · ${BODY_LABELS[it.camera?.body as BodyId] ?? 'Emulsion'}`}
                    >
                      <img
                        className="emu-lib__thumb"
                        src={fileUrl(it.thumbPath || it.imgPath)}
                        alt=""
                        loading="lazy"
                      />
                    </button>
                    <div className="emu-lib__actions no-drag">
                      {it.comparePath && (
                        <button
                          className="emu-lib__act"
                          onClick={() => window.hjen.openInBrowser(it.comparePath!)}
                          title="Open comparison (original | edited)"
                          aria-label="Open comparison"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M7 8l-3 3 3 3M17 8l3 3-3 3M13 5l-2 14" />
                          </svg>
                        </button>
                      )}
                      <button
                        className="emu-lib__act"
                        onClick={() => window.hjen.revealInFinder(it.imgPath)}
                        title="Reveal in Finder"
                        aria-label="Reveal in Finder"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M4 6a2 2 0 0 1 2-2h3.6l2 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}
        </div>

        {/* ---- controls rail ---- */}
        <aside className="emu-rail">
          {/* Engine transparency (video): name what does the processing */}
          {mode === 'video' && (
            <div className="emu-engine mono-label" title="A deterministic camera-emulation pipeline running on your machine — no cloud, no AI generation. Segformer segments skin/sky only when Scene Protect is engaged.">
              <span className="emu-engine__dot" aria-hidden />
              <span className="emu-engine__text selectable">{vidEngineLine}</span>
            </div>
          )}

          {/* headline action: self-calibrate the camera model to real footage */}
          <div className="emu-match">
            <button
              className="emu-match__btn no-drag"
              onClick={matchToCinema}
              disabled={!hasSource || busy}
            >
              {matching ? (
                <>
                  <span className="emu-match__spin" aria-hidden />
                  Matching to cinema… {Math.round(matchProgress * 100)}%
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
                    <circle cx="12" cy="12" r="3.4" />
                  </svg>
                  Match to Cinema
                </>
              )}
            </button>
            {matching && (
              <div className="emu-match__track" aria-hidden>
                <span className="emu-match__fill" style={{ width: `${Math.round(matchProgress * 100)}%` }} />
              </div>
            )}
            {!matching && matchDist && (
              <span
                className="emu-match__readout mono-label"
                title="Matched against 1,020 real production frames. Lower = closer to real footage."
              >
                Cinema distance {matchDist.before.toFixed(2)} → <b>{matchDist.after.toFixed(2)}</b>
              </span>
            )}
          </div>

          {/* Output (video only) — read-only: the clip is processed at native
              resolution, codec + audio preserved. No control. */}
          {mode === 'video' && (
            <div className="emu-output" title="The clip is processed at its native resolution; its codec and audio are preserved bit-for-bit.">
              <span className="emu-output__label mono-label">Output</span>
              <span className="emu-output__val mono-label selectable">
                Matches source{sourceResLabel(vidSourceSize) ? ` · ${sourceResLabel(vidSourceSize)}` : ''} · codec preserved
              </span>
            </div>
          )}

          {/* Depth DoF is intentionally NOT supported for video (per-frame depth flickers) */}
          {mode === 'image' && (
          <div className="emu-group">
            <div className="emu-group__head mono-label">Depth DoF</div>
            <div className="emu-field">
              <span className="mono-label">Enable Depth DoF</span>
              <div className="segmented no-drag">
                <button
                  className={`segmented__opt ${!dof.enabled ? 'segmented__opt--on' : ''}`}
                  disabled={!hasSource || dofComputing}
                  onClick={() => setDof(d => ({ ...d, enabled: false }))}
                >Off</button>
                <button
                  className={`segmented__opt ${dof.enabled ? 'segmented__opt--on' : ''}`}
                  disabled={!hasSource || dofComputing}
                  onClick={() => setDof(d => ({ ...d, enabled: true }))}
                >On</button>
              </div>
            </div>

            {dof.enabled && (
              <>
                <button
                  className="emu-match__btn no-drag"
                  onClick={computeDepth}
                  disabled={!hasSource || dofComputing}
                >
                  {dofComputing ? (
                    <><span className="emu-match__spin" aria-hidden /> Computing metric depth… (~8s · first run downloads the model)</>
                  ) : depthMap ? (
                    'Recompute Depth'
                  ) : (
                    'Compute Depth'
                  )}
                </button>
                {!depthMap && !dofComputing && (
                  <span className="emu-match__readout mono-label">Compute metric depth once — then focus, aperture &amp; haze are live.</span>
                )}

                <div className="emu-field">
                  <span className="mono-label">Focus</span>
                  <div className="segmented no-drag">
                    <button
                      className={`segmented__opt ${dof.focusAuto ? 'segmented__opt--on' : ''}`}
                      disabled={!hasSource || dofComputing || !depthMap}
                      onClick={() => patchDof({ focusAuto: true })}
                    >Auto</button>
                    <button
                      className={`segmented__opt ${!dof.focusAuto ? 'segmented__opt--on' : ''}`}
                      disabled={!hasSource || dofComputing || !depthMap}
                      onClick={() => patchDof({ focusAuto: false })}
                    >Manual</button>
                  </div>
                </div>
                {!dof.focusAuto && (
                  <div className="emu-field" aria-disabled={!depthMap}>
                    <span className="mono-label emu-field__row">
                      Focus distance
                      <span className="emu-field__val">{dof.focus.toFixed(2)} m</span>
                    </span>
                    <input
                      className="emu-range no-drag"
                      type="range"
                      min={depthRange?.minM ?? 0.5} max={depthRange?.maxM ?? 10} step={0.05}
                      value={dof.focus}
                      disabled={!hasSource || dofComputing || !depthMap}
                      onChange={e => patchDof({ focus: parseFloat(e.target.value) })}
                    />
                  </div>
                )}
                <div className="emu-field" aria-disabled={!depthMap}>
                  <span className="mono-label emu-field__row">
                    Aperture (f/N)
                    <span className="emu-field__val">f/{dof.fnum.toFixed(1)}</span>
                  </span>
                  <input
                    className="emu-range no-drag"
                    type="range"
                    min={DOF_FNUM_MIN} max={DOF_FNUM_MAX} step={0.1}
                    value={dof.fnum}
                    disabled={!hasSource || dofComputing || !depthMap}
                    onChange={e => patchDof({ fnum: parseFloat(e.target.value) })}
                  />
                </div>
                <div className="emu-field" aria-disabled={!depthMap}>
                  <span className="mono-label emu-field__row">
                    Haze
                    <span className="emu-field__val">{Math.round(dof.haze * 100)}%</span>
                  </span>
                  <input
                    className="emu-range no-drag"
                    type="range"
                    min={0} max={0.3} step={0.01}
                    value={dof.haze}
                    disabled={!hasSource || dofComputing || !depthMap}
                    onChange={e => patchDof({ haze: parseFloat(e.target.value) })}
                  />
                </div>

                {dofActive && (
                  <span className="emu-match__readout mono-label" title="Live thin-lens bokeh from a metric depth map. Click the preview to set the focus distance.">
                    Depth DoF · focus {dof.focusAuto ? 'auto' : `${dof.focus.toFixed(2)} m`} · f/{dof.fnum.toFixed(1)} · click to refocus
                  </span>
                )}
              </>
            )}
          </div>
          )}

          {/* Scene Protect — image mode: LIVE mask-based preview. Video mode: two
              plain strengths passed straight to the per-frame engine (no live mask). */}
          {mode === 'video' ? (
          <div className="emu-group">
            <div className="emu-group__head mono-label">Scene Protect</div>
            <div className="emu-field">
              <span className="mono-label emu-field__row">
                Skin Protect
                <span className="emu-field__val">{Math.round(vidSkin * 100)}%</span>
              </span>
              <input
                className="emu-range no-drag"
                type="range"
                min={0} max={1} step={0.01}
                value={vidSkin}
                disabled={!videoPath || vidProcessing}
                onChange={e => setVidSkin(parseFloat(e.target.value))}
              />
            </div>
            <div className="emu-field">
              <span className="mono-label emu-field__row">
                Sky Treat
                <span className="emu-field__val">{Math.round(vidSky * 100)}%</span>
              </span>
              <input
                className="emu-range no-drag"
                type="range"
                min={0} max={1} step={0.01}
                value={vidSky}
                disabled={!videoPath || vidProcessing}
                onChange={e => setVidSky(parseFloat(e.target.value))}
              />
            </div>
            <span className="emu-match__readout mono-label" title="Skin keeps its texture through the grade + grain; the sky is de-grained. Segmented per frame at process time.">
              Adds significant processing time (per-frame segmentation)
            </span>
          </div>
          ) : (
          <div className="emu-group">
            <div className="emu-group__head mono-label">Scene Protect</div>
            <div className="emu-field">
              <span className="mono-label">Enable Scene Protect</span>
              <div className="segmented no-drag">
                <button
                  className={`segmented__opt ${!seg.enabled ? 'segmented__opt--on' : ''}`}
                  disabled={!hasSource || segComputing}
                  onClick={() => setSeg(s => ({ ...s, enabled: false }))}
                >Off</button>
                <button
                  className={`segmented__opt ${seg.enabled ? 'segmented__opt--on' : ''}`}
                  disabled={!hasSource || segComputing}
                  onClick={() => setSeg(s => ({ ...s, enabled: true }))}
                >On</button>
              </div>
            </div>

            {seg.enabled && (
              <>
                <button
                  className="emu-match__btn no-drag"
                  onClick={computeMasks}
                  disabled={!hasSource || segComputing}
                >
                  {segComputing ? (
                    <><span className="emu-match__spin" aria-hidden /> Computing masks… (~4s)</>
                  ) : segMasks ? (
                    'Recompute Masks'
                  ) : (
                    'Compute Masks'
                  )}
                </button>
                {!segMasks && !segComputing && (
                  <span className="emu-match__readout mono-label">Compute masks once — then skin protect &amp; sky treat are live.</span>
                )}

                <div className="emu-field" aria-disabled={!segMasks}>
                  <span className="mono-label emu-field__row">
                    Skin Protect
                    <span className="emu-field__val">{Math.round(seg.skinProtect * 100)}%</span>
                  </span>
                  <input
                    className="emu-range no-drag"
                    type="range"
                    min={0} max={1} step={0.01}
                    value={seg.skinProtect}
                    disabled={!hasSource || segComputing || !segMasks}
                    onChange={e => patchSeg({ skinProtect: parseFloat(e.target.value) })}
                  />
                </div>
                <div className="emu-field" aria-disabled={!segMasks}>
                  <span className="mono-label emu-field__row">
                    Sky Treat
                    <span className="emu-field__val">{Math.round(seg.skyTreat * 100)}%</span>
                  </span>
                  <input
                    className="emu-range no-drag"
                    type="range"
                    min={0} max={1} step={0.01}
                    value={seg.skyTreat}
                    disabled={!hasSource || segComputing || !segMasks}
                    onChange={e => patchSeg({ skyTreat: parseFloat(e.target.value) })}
                  />
                </div>

                {seg.enabled && !!segMasks && (
                  <span className="emu-match__readout mono-label" title="Skin keeps its texture through the grade + grain; the sky is de-grained. Masks from a local segmentation model.">
                    Scene Protect · skin {Math.round(seg.skinProtect * 100)}% · sky {Math.round(seg.skyTreat * 100)}%
                  </span>
                )}
              </>
            )}
          </div>
          )}

          <div className="emu-group">
            <div className="emu-group__head mono-label">Camera</div>
            <label className="emu-field">
              <span className="mono-label">Body</span>
              <select
                className="emu-select no-drag"
                value={choice.body}
                disabled={!hasSource}
                onChange={e => patch({ body: e.target.value as BodyId })}
              >
                {(Object.keys(BODY_LABELS) as BodyId[]).map(id => (
                  <option key={id} value={id}>{BODY_LABELS[id]}</option>
                ))}
              </select>
            </label>
            <label className="emu-field">
              <span className="mono-label">Lens</span>
              <select
                className="emu-select no-drag"
                value={choice.lens}
                disabled={!hasSource}
                onChange={e => patch({ lens: e.target.value as LensId })}
              >
                {(Object.keys(LENS_LABELS) as LensId[]).map(id => (
                  <option key={id} value={id}>{LENS_LABELS[id]}</option>
                ))}
              </select>
            </label>
            <label className="emu-field">
              <span className="mono-label">Stock</span>
              <select
                className="emu-select no-drag"
                value={choice.stock}
                disabled={!hasSource}
                onChange={e => patch({ stock: e.target.value as StockId })}
              >
                {(Object.keys(STOCK_LABELS) as StockId[]).map(id => (
                  <option key={id} value={id}>{STOCK_LABELS[id]}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="emu-group">
            <div className="emu-group__head mono-label">Lens Distortion</div>
            <label className="emu-field">
              <span className="mono-label">Profile</span>
              <select
                className="emu-select no-drag"
                value={choice.distortionType}
                disabled={!hasSource}
                onChange={e => patch({ distortionType: e.target.value as DistortionType })}
              >
                {(Object.keys(DISTORTION_LABELS) as DistortionType[]).map(id => (
                  <option key={id} value={id}>{DISTORTION_LABELS[id]}</option>
                ))}
              </select>
            </label>
            <div className="emu-field" aria-disabled={choice.distortionType === 'none'}>
              <span className="mono-label emu-field__row">
                Amount
                <span className="emu-field__val">{Math.round(choice.distortionAmount * 100)}%</span>
              </span>
              <input
                className="emu-range no-drag"
                type="range"
                min={0} max={1} step={0.01}
                value={choice.distortionAmount}
                disabled={!hasSource || choice.distortionType === 'none'}
                onChange={e => patch({ distortionAmount: parseFloat(e.target.value) })}
              />
            </div>
          </div>

          <div className="emu-group">
            <div className="emu-group__head mono-label">Look</div>
            <div className="emu-field">
              <span className="mono-label emu-field__row">
                Intensity
                <span className="emu-field__val">{Math.round(choice.intensity * 100)}%</span>
              </span>
              <input
                className="emu-range no-drag"
                type="range"
                min={0} max={1.5} step={0.05}
                value={choice.intensity}
                disabled={!hasSource}
                onChange={e => patch({ intensity: parseFloat(e.target.value) })}
              />
            </div>
            <div className="emu-field">
              <span className="mono-label">Scan</span>
              <div className="segmented no-drag">
                {(['2K', '4K'] as ScanRes[]).map(s => (
                  <button
                    key={s}
                    className={`segmented__opt ${choice.scan === s ? 'segmented__opt--on' : ''}`}
                    disabled={!hasSource}
                    onClick={() => patch({ scan: s })}
                  >{s}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="emu-group">
            <div className="emu-group__head mono-label">Scene</div>
            <div className="emu-scenes no-drag">
              {SCENES.map(s => (
                <button
                  key={s.id}
                  className={`emu-scene-opt ${choice.scenePreset === s.id ? 'emu-scene-opt--on' : ''}`}
                  disabled={!hasSource}
                  onClick={() => patch({ scenePreset: s.id })}
                >{s.label}</button>
              ))}
            </div>
            {choice.scenePreset === 'auto' && scene && (
              <span className="emu-badge mono-label">{detectedLabel(scene)}</span>
            )}
          </div>

          <div className="emu-note mono-label" title="Some numbers are research-verified (lens micro-contrast, halation, LogC roll-off); grain amplitude and chromatic aberration are eyeballed estimates, not lab specs.">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
            Film-stock grain values are eyeballed estimates, not lab specs
          </div>
        </aside>
      </div>

      <footer className="emu__foot">
        <button className="btn-secondary no-drag" onClick={reset} disabled={applying || vidProcessing}>Reset</button>
        <div className="emu__foot-meta mono-label">
          {error
            ? <span className="emu__foot-err">{error}</span>
            : mode === 'video'
              ? vidOutPath
                ? <>Saved · <code>{shortenPath(vidOutPath)}</code></>
                : videoPath
                  ? 'Local · offline · the whole clip is processed frame by frame'
                  : 'Choose a clip to begin'
              : savedPath
                ? <>Saved · <code>{shortenPath(savedPath)}</code></>
                : hasSource
                  ? 'Local · offline · saved to your Emulsion folder'
                  : 'Choose a frame to begin'}
        </div>
        {mode === 'video' ? (
          <button
            className="btn-primary emu__cta no-drag"
            onClick={processVideo}
            disabled={!videoPath || vidProcessing || working || videoLoading}
          >
            {vidProcessing
              ? (vidProgress ? `Processing… ${vidProgress.i}/${vidProgress.n}` : 'Processing…')
              : 'Process Video'}
          </button>
        ) : (
          <button
            className="btn-primary emu__cta no-drag"
            onClick={apply}
            disabled={!hasSource || busy}
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
        )}
      </footer>

      {pickerOpen && (
        <EmulsionFilePicker
          projects={projects}
          currentSlug={browseSlug ?? activeProject?.slug ?? null}
          files={projectFiles}
          videoMeta={mode === 'video'}
          heading={mode === 'video' ? 'Choose a clip' : 'Choose a frame'}
          emptyLabel={mode === 'video' ? 'No clips in this project yet.' : 'No frames in this project yet.'}
          onSwitchProject={setBrowseSlug}
          onPick={pickFromProject}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ picker
interface PickerProps {
  projects: ProjectMeta[];
  currentSlug: string | null;
  files: ProjectFileEntry[];
  heading?: string;
  emptyLabel?: string;
  videoMeta?: boolean;   // render the model + quality/duration row (Video mode)
  onSwitchProject: (slug: string | null) => void;
  onPick: (entry: ProjectFileEntry) => void;
  onClose: () => void;
}

function EmulsionFilePicker({ projects, currentSlug, files, heading = 'Choose a frame', emptyLabel = 'No frames in this project yet.', videoMeta = false, onSwitchProject, onPick, onClose }: PickerProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal emu-picker"
        style={{ width: 'min(1080px, 100%)', maxHeight: 'min(720px, 90vh)' }}
        onClick={e => e.stopPropagation()}
        dir="ltr"
      >
        <header className="modal__header">
          <span className="mono-label">{heading}</span>
          <select
            className="emu-picker__project no-drag"
            value={currentSlug ?? ''}
            onChange={e => onSwitchProject(e.target.value || null)}
          >
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
          </select>
          <button className="modal__close no-drag" onClick={onClose}>Close</button>
        </header>
        <div className="emu-picker__body">
          {files.length === 0 ? (
            <div className="emu-picker__empty mono-label">{emptyLabel}</div>
          ) : (
            <div className="emu-picker__grid">
              {files.map(f => (
                <button key={f.imgPath} className="emu-picker__card no-drag" onClick={() => onPick(f)} title={f.promptTitle}>
                  <div className="emu-picker__thumb-wrap">
                    {/* Video cards: a .mp4 is never a valid <img> src — use the thumb,
                        else a neutral clip placeholder (no broken-image glyph). */}
                    {(videoMeta ? f.thumbPath : (f.thumbPath || f.imgPath)) ? (
                      <img className="emu-picker__thumb" src={fileUrl(videoMeta ? f.thumbPath : (f.thumbPath || f.imgPath))} alt="" loading="lazy" />
                    ) : (
                      <div className="emu-picker__thumb emu-picker__thumb--placeholder" aria-hidden>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                          <rect x="3" y="5" width="18" height="14" rx="2" />
                          <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
                        </svg>
                      </div>
                    )}
                    {/* The image-only quality meter is meaningless for clips — hide it in Video mode */}
                    {!videoMeta && <QualityBadge quality={f.quality} variant="overlay" />}
                  </div>
                  <div className="emu-picker__cap">
                    <div className="emu-picker__cap-title selectable">{cleanTitle(f.promptTitle)}</div>
                    {videoMeta ? (() => {
                      const v = f as VideoFileEntry;
                      const model = videoModelName(v.modelLabel);
                      const bits = videoMetaBits(v);
                      if (!model && !bits) return null;
                      return (
                        <div className="emu-picker__vmeta">
                          {model && <span className="emu-picker__vbadge">{model}</span>}
                          {bits && <span className="emu-picker__vqual">{bits}</span>}
                        </div>
                      );
                    })() : (
                      <div className="emu-picker__cap-meta"><DimsTag size={f.size} path={f.imgPath} /></div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
