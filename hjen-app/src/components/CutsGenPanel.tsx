// Cuts Engine · right dock — on-page experimentation.
//
// A shot's MASTER PROMPT (selectedShot.brief.prompt) is the raw material; from it
// the user MAKES a Frame or a Video and sees the take, without leaving the page.
//
//   • BOTTOM = the workspace. Two tabs (Frames / Video), each with the full,
//     grouped settings for that type, plus the editable master prompt + a Make.
//   • TOP    = the takes gallery. Two tabs (Video / Frames), DRIVEN by the
//     bottom tab — pick "Frames" below → the frames takes show above.
//
// Reuses the app's real generation core: runFrameGeneration() for frames,
// the store's submitVideoJob() (Seedance) + runKling() (Kling) for video, and
// the existing save/list IPC so takes land in the active project like any other.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { CutShot } from '../lib/cuts/engine';
import type { Selections, ModelId, Quality, Resolution, StylePreset } from '../types/catalog';
import { runFrameGeneration } from '../lib/frameGen';
import { buildPrompt } from '../lib/promptBuilder';
import { MODELS } from '../lib/models';
import { movieThumb, photographerThumb, cameraIcon, lensIcon, stockIcon, lightingThumb } from '../lib/catalog';
import { VIDEO_MODELS, videoModelById } from '../lib/video/models';
import { slugifyPrompt } from '../lib/seedance';
import { runKling, type KlingParams, type KlingMode, type KlingRatio } from '../lib/kling';
import type { GlobalGenerationEntry, VideoFileEntry } from '../types/hjen-bridge';

const fileUrl = (p?: string) => (p ? `hjen-file://${encodeURI(p)}` : '');

// ── Take-metadata helpers (model · dimensions · quality strip) ──
// Format a stored "WxH" size as "W×H"; reduce a pixel pair to its aspect label.
const fmtDims = (s?: string) => (s ? s.replace(/x/i, '×') : '');
const reduceAspect = (w: number, h: number): string => {
  if (!w || !h) return '';
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const d = gcd(w, h) || 1;
  return `${Math.round(w / d)}:${Math.round(h / d)}`;
};
// Best aspect: prefer the exact stored label (e.g. "2.39:1"), else reduce pixels.
const aspectFor = (stored: string | undefined, dims: string): string => {
  if (stored) return stored;
  const m = dims.match(/(\d+)\D+(\d+)/);
  return m ? reduceAspect(+m[1], +m[2]) : '';
};

type GenTab = 'frames' | 'video';
type SeedRes = '480p' | '720p' | '1080p' | '4k';

const MODE_LABEL: Record<'std' | 'pro' | '4k', string> = { std: '720P', pro: '1080P', '4k': '4K' };
const QUALITIES: Quality[] = ['LOW', 'MED', 'HIGH'];
const RESOLUTIONS: Resolution[] = ['1MP', '3.7MP', '8.3MP'];
const FRAME_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '2.39:1', '21:9'];

export interface CutsGenPanelProps {
  project: { id: string; slug: string; name: string } | null;
  selectedShot: CutShot | null;
  /** Look context (from Read look / DNA) — shown as a hint for the maker. */
  dnaLook?: string;
  /** Mutate the selected shot's master prompt in place + re-render the view. */
  onPromptEdit: (text: string) => void;
  /** Persist the analysis (called on blur, mirroring the inspector). */
  onPersist: () => void;
  /** Panel width (px) — driven by the parent so it stays constant per tab. */
  width: number;
  /** Pointer-down on the left-edge resize handle. */
  onResizeStart: (e: React.PointerEvent) => void;
}

export default function CutsGenPanel({ project, selectedShot, dnaLook, onPromptEdit, onPersist, width, onResizeStart }: CutsGenPanelProps) {
  const submitVideoJob = useStore(s => s.submitVideoJob);
  const videoJobs = useStore(s => s.videoJobs);
  // DOP — the app's cinematography Selections + the global picker system (same
  // as the Studio Frame view). These augment the master prompt for frame makes.
  const dop = useStore(s => s.selections);
  const openPicker = useStore(s => s.openPicker);
  const setSelection = useStore(s => s.setSelection);

  const [tab, setTab] = useState<GenTab>('frames');
  const [dopOpen, setDopOpen] = useState(true);   // DOP section open by default (both tabs)

  // Default to the newest takes; expand on demand rather than dumping hundreds.
  const TAKE_CAP = 30;
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setShowAll(false); }, [tab]);

  // ── Master prompt (seeded from the shot, editable, experiment-local) ──
  const [promptText, setPromptText] = useState<string>(selectedShot?.brief?.prompt || '');
  const lastShot = useRef<number | null>(selectedShot?.i ?? null);
  useEffect(() => {
    if (selectedShot?.i !== lastShot.current) {
      lastShot.current = selectedShot?.i ?? null;
      setPromptText(selectedShot?.brief?.prompt || '');
    }
  }, [selectedShot]);
  const onPromptChange = useCallback((text: string) => {
    setPromptText(text);
    if (selectedShot?.brief) onPromptEdit(text);   // write back only when a brief exists
  }, [selectedShot, onPromptEdit]);

  // ── Frame settings ──
  const [fModel, setFModel] = useState<ModelId>('GPT_IMAGE_2');
  const [fQuality, setFQuality] = useState<Quality>('MED');
  const [fAspect, setFAspect] = useState<string>('16:9');
  const [fRes, setFRes] = useState<Resolution>('1MP');
  const [fNegative, setFNegative] = useState<string>('');

  // ── Video settings ──
  const [vModelId, setVModelId] = useState<string>(VIDEO_MODELS[0].id);
  const vModel = useMemo(() => videoModelById(vModelId) ?? VIDEO_MODELS[0], [vModelId]);
  const isKling = vModel.provider === 'kling';
  const [vRes, setVRes] = useState<SeedRes>('720p');
  const [vMode, setVMode] = useState<'std' | 'pro' | '4k'>('pro');
  const [vDuration, setVDuration] = useState<number>(5);
  const [vRatio, setVRatio] = useState<string>('16:9');
  const [vFps, setVFps] = useState<number>(24);
  const [vAudio, setVAudio] = useState<boolean>(false);
  const [vCameraFixed, setVCameraFixed] = useState<boolean>(false);
  const [vWatermark, setVWatermark] = useState<boolean>(false);
  const [vSeed, setVSeed] = useState<string>('');
  const [vCfg, setVCfg] = useState<number>(0.5);
  const [vNegative, setVNegative] = useState<string>('');
  const [vUseKeyframe, setVUseKeyframe] = useState<boolean>(true);

  const hasKeyframe = !!selectedShot?.keyframe;

  // Clamp video controls to what the chosen model actually supports.
  useEffect(() => {
    const d = vModel;
    if (d.provider === 'seedance' && d.resolutions && !d.resolutions.includes(vRes)) setVRes(d.resolutions[1] ?? d.resolutions[0]);
    if (d.provider === 'kling' && d.modes && !d.modes.includes(vMode)) setVMode(d.modes[0]);
    if (!d.durations.includes(vDuration)) setVDuration(d.durations.includes(5) ? 5 : d.durations[0]);
    if (!d.aspectRatios.includes(vRatio)) setVRatio(d.aspectRatios[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vModelId]);

  // ── Results (takes) ──
  const [frames, setFrames] = useState<GlobalGenerationEntry[]>([]);
  const [videos, setVideos] = useState<VideoFileEntry[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  // Pixel dimensions measured client-side (path → "W×H"). Fallback for takes
  // whose record carries no stored size: frames without finalSize, and every
  // video (only a resolution TIER is stored, never the exact pixels).
  const [measured, setMeasured] = useState<Record<string, string>>({});
  const noteDims = useCallback((path: string, w: number, h: number) => {
    if (!w || !h) return;
    setMeasured(m => (m[path] ? m : { ...m, [path]: `${w}×${h}` }));
  }, []);

  const refreshResults = useCallback(async () => {
    setLoadingResults(true);
    try {
      const [all, vids] = await Promise.all([
        window.hjen.listAllGenerations(),
        window.hjen.listProjectVideos({ projectSlug: project?.slug ?? null }),
      ]);
      const mine = project ? all.filter(g => g.projectSlug === project.slug) : all;
      mine.sort((a, b) => b.ts - a.ts);
      vids.sort((a, b) => b.ts - a.ts);
      setFrames(mine);
      setVideos(vids);
    } catch { /* results are best-effort */ }
    finally { setLoadingResults(false); }
  }, [project]);

  useEffect(() => { void refreshResults(); }, [refreshResults]);

  // Refresh videos whenever a render finishes (submitVideoJob is fire-and-forget).
  const doneVideoCount = videoJobs.filter(j => j.phase === 'done').length;
  useEffect(() => { void refreshResults(); }, [doneVideoCount, refreshResults]);

  // ── Lightbox ──
  const [light, setLight] = useState<{ kind: 'image' | 'video'; src: string; path: string } | null>(null);

  // ── Make · concurrent jobs registry ──────────────────────────────
  // Several makes can run at once — each frame/Kling make is its own async task
  // tracked here with live progress; new takes drop into the gallery as they
  // finish. (Seedance runs through the store's video-job lifecycle.)
  type MakeJob = { id: string; kind: 'frame' | 'video'; label: string; status: string };
  const [makeJobs, setMakeJobs] = useState<MakeJob[]>([]);
  const [msg, setMsg] = useState<string>('');
  const addJob = useCallback((j: MakeJob) => setMakeJobs(js => [...js, j]), []);
  const patchJob = useCallback((id: string, status: string) => setMakeJobs(js => js.map(j => (j.id === id ? { ...j, status } : j))), []);
  const dropJob = useCallback((id: string) => setMakeJobs(js => js.filter(j => j.id !== id)), []);
  const newId = () => `mk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const runMakeFrame = useCallback(() => {
    const prompt = promptText.trim();
    if (!prompt) return;
    const id = newId();
    const label = (prompt.split(/\s+/).slice(0, 4).join(' ') || 'frame').slice(0, 28);
    addJob({ id, kind: 'frame', label, status: 'Making…' });
    // Fire without awaiting → the form stays live so more makes can start.
    void (async () => {
      try {
        // DOP chips (camera/lens/lighting/movie/style…) flow through buildPrompt;
        // the panel's own model/quality/aspect/resolution/prompt/exclude win.
        const base = useStore.getState().selections;
        const sel: Selections = {
          ...base,
          prompt,
          negative: fNegative.trim(),
          quality: fQuality,
          aspect: fAspect,
          resolution: fRes,
          model: fModel,
        };
        const { result, apiSize, size } = await runFrameGeneration(sel, []);
        await window.hjen.saveGeneration({
          base64: result.b64,
          promptSlug: slugifyPrompt(prompt, 40),
          projectSlug: project?.slug,
          projectId: project?.id,
          sidecar: {
            captured: new Date().toISOString(),
            project: project ? { id: project.id, name: project.name, slug: project.slug } : null,
            prompt: result.prompt,
            size: result.size,
            apiSize,
            finalSize: `${size.targetWidth}x${size.targetHeight}`,
            finalMP: size.finalMP,
            model: MODELS[fModel].label,
            apiModelId: MODELS[fModel].apiModelId,
            source: 'cuts-engine',
            shot: selectedShot?.i ?? null,
            selections: sel,
          },
        });
        dropJob(id); setMsg('Frame made ✓'); setTab('frames'); await refreshResults();
      } catch (e: any) {
        dropJob(id); setMsg(`Make failed: ${e?.message || e}`);
      }
    })();
  }, [promptText, fNegative, fQuality, fAspect, fRes, fModel, project, selectedShot, refreshResults, addJob, dropJob]);

  const runMakeVideo = useCallback(() => {
    const prompt = promptText.trim();
    if (!prompt) return;
    const d = vModel;
    const sourcePath = vUseKeyframe && selectedShot?.keyframe ? selectedShot.keyframe : null;
    const audio = d.features.audio && vAudio;

    // DOP augments the video prompt too — same cinematography clause as frames.
    const base = useStore.getState().selections;
    const hasDop = !!(base.camera || base.lens || base.stock || base.lighting || base.movement || base.angle || base.focal_mm || base.aperture_f || base.style_preset !== 'NONE');
    const finalPrompt = hasDop ? buildPrompt({ ...base, prompt }, []) : prompt;

    if (d.provider === 'seedance') {
      // The store's video-job lifecycle already runs concurrently + shows in the
      // status bar; its progress is surfaced in the panel's job list too.
      submitVideoJob({
        prompt: finalPrompt, sourcePath, endFramePath: null,
        resolution: vRes, duration: vDuration, ratio: vRatio as any, fps: vFps,
        seed: vSeed.trim() ? Number(vSeed) : null,
        cameraFixed: vCameraFixed, watermark: vWatermark, audio, modelId: d.apiModelId,
        rawUserPrompt: prompt,
        selectionsSnapshot: hasDop ? (base as unknown as Record<string, any>) : undefined,
      });
      setMsg('Video submitted — rendering server-side; the take appears here when ready.');
      setTab('video');
      return;
    }

    // Kling — its own concurrent job (runKling saves into the project itself).
    const id = newId();
    const label = (prompt.split(/\s+/).slice(0, 4).join(' ') || 'video').slice(0, 28);
    addJob({ id, kind: 'video', label, status: 'Submitting…' });
    setTab('video');
    void (async () => {
      try {
        const params: KlingParams = {
          prompt: finalPrompt,
          negativePrompt: d.features.negativePrompt ? (vNegative.trim() || undefined) : undefined,
          imagePath: sourcePath, endImagePath: null,
          modelId: d.apiModelId, mode: vMode as KlingMode, aspectRatio: vRatio as KlingRatio,
          duration: vDuration, cfgScale: d.features.cfgScale ? vCfg : null, sound: audio, watermark: vWatermark,
          rawUserPrompt: prompt,
        };
        await runKling(
          params,
          { promptSlug: slugifyPrompt(prompt, 40), projectSlug: project?.slug, projectId: project?.id },
          (p) => patchJob(id, `${p.phase}${p.status ? ` · ${p.status}` : ''}`),
        );
        dropJob(id); setMsg('Video made ✓'); await refreshResults();
      } catch (e: any) {
        dropJob(id); setMsg(`Make failed: ${e?.message || e}`);
      }
    })();
  }, [promptText, vModel, vUseKeyframe, selectedShot, vAudio, vRes, vDuration, vRatio, vFps, vSeed, vCameraFixed, vWatermark, vNegative, vMode, vCfg, submitVideoJob, project, refreshResults, addJob, patchJob, dropJob]);

  // Active makes for the current tab — drives the button spinner (but never
  // blocks: a new make can always start).
  const activeStoreVideos = useMemo(
    () => videoJobs.filter(j => j.phase !== 'done' && j.phase !== 'failed'),
    [videoJobs],
  );
  const framesActive = makeJobs.filter(j => j.kind === 'frame').length;
  const videoActive = makeJobs.filter(j => j.kind === 'video').length + activeStoreVideos.length;
  const activeForTab = tab === 'frames' ? framesActive : videoActive;
  const canMake = !!promptText.trim();

  // The DOP chip rows (compact, reuse the global picker system).
  const DOP_ROWS: { label: string; value?: string | null; sub?: string; thumb?: string; picker: any }[] = [
    { label: 'Camera', value: dop.camera?.name, thumb: dop.camera ? cameraIcon(dop.camera.filename) : undefined, picker: 'camera' },
    { label: 'Lens', value: dop.lens?.name, thumb: dop.lens ? lensIcon(dop.lens.filename) : undefined, picker: 'lens' },
    { label: 'Film stock', value: dop.stock?.name, thumb: dop.stock ? stockIcon(dop.stock.filename) : undefined, picker: 'stock' },
    { label: 'Lighting', value: dop.lighting?.name, sub: dop.lighting?.description, thumb: dop.lighting ? lightingThumb(dop.lighting.filename) : undefined, picker: 'lighting' },
    { label: 'Movement', value: dop.movement?.name, sub: dop.movement?.description, picker: 'movement' },
    { label: 'Perspective', value: dop.angle?.name, sub: dop.angle?.description, picker: 'angle' },
  ];
  const dopCount = DOP_ROWS.filter(r => r.value).length + (dop.style_preset !== 'NONE' ? 1 : 0);

  // DOP · cinematography — one section, shown in BOTH make tabs. Frames feed it
  // through buildPrompt; Video appends the same cinematography clause.
  const dopSection = (
    <div className="cut-gen__dop">
      <button className="cut-gen__dophead" onClick={() => setDopOpen(o => !o)}
        title="Cinematography — camera, lens, film stock, lighting, style">
        <span className="mono-label">DOP · CINEMATOGRAPHY</span>
        {dopCount > 0 && <span className="cut-gen__dopcount">{dopCount}</span>}
        <span className="cut-gen__grow" />
        <span className="cut-gen__chev">{dopOpen ? '▾' : '▸'}</span>
      </button>
      {dopOpen && (
        <div className="cut-gen__dopbody">
          <div className="cut-gen__seg cut-gen__seg--sm">
            {(['NONE', 'MOVIE', 'PHOTOGRAPHER'] as StylePreset[]).map(v => (
              <button key={v} className={dop.style_preset === v ? 'is-active' : ''}
                onClick={() => setSelection('style_preset', v)}>
                {v === 'NONE' ? 'No style' : v === 'MOVIE' ? 'Movie' : 'Photographer'}
              </button>
            ))}
          </div>
          {dop.style_preset === 'MOVIE' && (
            <DopRow label="Movie" value={dop.movie?.title}
              sub={dop.movie ? `${dop.movie.year}${dop.movie.director ? ' · ' + dop.movie.director : ''}` : undefined}
              thumb={dop.movie ? movieThumb(dop.movie.filename) : undefined} onClick={() => openPicker('movie')} />
          )}
          {dop.style_preset === 'PHOTOGRAPHER' && (
            <DopRow label="Photographer" value={dop.photographer?.name} sub={dop.photographer?.notes}
              thumb={dop.photographer ? photographerThumb(dop.photographer.filename) : undefined} onClick={() => openPicker('photographer')} />
          )}
          {DOP_ROWS.map(r => (
            <DopRow key={r.label} label={r.label} value={r.value} sub={r.sub} thumb={r.thumb} onClick={() => openPicker(r.picker)} />
          ))}
        </div>
      )}
    </div>
  );

  // ── Render helpers ──
  const Tabs = ({ order }: { order: GenTab[] }) => (
    <div className="cut-gen__tabs">
      {order.map(t => (
        <button key={t} className={`cut-gen__tab ${tab === t ? 'is-active' : ''}`} onClick={() => setTab(t)}>
          {t === 'frames' ? 'Frames' : 'Video'}
        </button>
      ))}
    </div>
  );

  const fullList = tab === 'frames' ? frames : videos;
  const shown = showAll ? fullList : fullList.slice(0, TAKE_CAP);

  return (
    <aside className="cut-gen" style={{ width }}>
      {/* Left-edge drag handle → resize panel width */}
      <div className="cut-gen__resize" title="Drag to resize" onPointerDown={onResizeStart} />
      {/* ── TOP · takes gallery (driven by the bottom tab) ── */}
      <div className="cut-gen__results">
        <div className="cut-gen__seghead">
          <span className="mono-label">TAKES</span>
          <Tabs order={['frames', 'video']} />
          <span className="cut-gen__grow" />
          <button className="cut-icon" title="Refresh takes" disabled={loadingResults} onClick={() => void refreshResults()}>↻</button>
        </div>
        <div className="cut-gen__grid">
          {fullList.length === 0 ? (
            <div className="cut-gen__empty">
              {loadingResults ? 'Loading takes…'
                : tab === 'frames'
                  ? 'No frames yet. Write a master prompt below and Make a frame — it lands here.'
                  : 'No video takes yet. Set up the shot below and Make a video.'}
            </div>
          ) : tab === 'frames' ? (
            (shown as GlobalGenerationEntry[]).map(g => {
              // Dimensions come from the record's finalSize; derive from the
              // full image only when it wasn't stored (older frames).
              const dimStr = fmtDims(g.finalSize) || measured[g.imgPath] || '';
              const needsProbe = !g.finalSize && !measured[g.imgPath];
              return (
              <button key={g.imgPath} className="cut-gen__card"
                title={`${g.promptTitle}  ·  drag onto a track`}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('application/x-cut-clip', JSON.stringify({
                    srcKind: 'frame', src: g.imgPath, thumb: g.thumbPath || g.imgPath,
                    label: g.promptTitle || g.baseName, dur: 3,
                  }));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => setLight({ kind: 'image', src: fileUrl(g.imgPath), path: g.imgPath })}>
                <span className="cut-gen__thumb">
                  <img src={fileUrl(g.thumbPath || g.imgPath)} alt="" draggable={false}
                    onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
                  {g.finalSize && <span className="cut-gen__badge">{g.finalSize}</span>}
                </span>
                <span className="cut-gen__cap cut-copytext">{g.promptTitle || g.baseName}</span>
                <CutMeta model={g.modelLabel || '—'} dims={dimStr}
                  aspect={aspectFor(g.aspect, dimStr)} quality={g.quality || '—'} />
                {needsProbe && (
                  <img alt="" src={fileUrl(g.imgPath)} style={{ display: 'none' }}
                    onLoad={e => noteDims(g.imgPath, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />
                )}
              </button>
            ); })
          ) : (
            (shown as VideoFileEntry[]).map(v => {
              // Exact pixels aren't stored for video — only a tier + ratio. Read
              // the real dimensions from the clip's metadata; tier = the quality.
              const dimStr = measured[v.imgPath] || '';
              const model = videoModelById(v.modelLabel || '')?.label || v.modelLabel || '—';
              const quality = v.size || (v.mode ? MODE_LABEL[v.mode] : '') || '—';
              return (
              <button key={v.imgPath} className="cut-gen__card"
                title={`${v.promptTitle}  ·  drag onto a track`}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('application/x-cut-clip', JSON.stringify({
                    srcKind: 'video', src: v.imgPath, thumb: v.thumbPath || v.imgPath,
                    label: v.promptTitle || v.baseName, dur: v.videoSeconds || 5,
                  }));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => setLight({ kind: 'video', src: fileUrl(v.imgPath), path: v.imgPath })}>
                <span className="cut-gen__thumb cut-gen__thumb--v">
                  <img src={fileUrl(v.thumbPath || v.imgPath)} alt="" draggable={false}
                    onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
                  <span className="cut-gen__play">▶</span>
                  {v.videoSeconds != null && <span className="cut-gen__badge">{v.videoSeconds}s</span>}
                </span>
                <span className="cut-gen__cap cut-copytext">{v.promptTitle || v.baseName}</span>
                <CutMeta model={model} dims={dimStr}
                  aspect={aspectFor(v.ratio, dimStr)} quality={quality} />
                {!measured[v.imgPath] && (
                  <video muted preload="metadata" src={fileUrl(v.imgPath)} style={{ display: 'none' }}
                    onLoadedMetadata={e => noteDims(v.imgPath, e.currentTarget.videoWidth, e.currentTarget.videoHeight)} />
                )}
              </button>
            ); })
          )}
          {fullList.length > TAKE_CAP && (
            <button className="cut-gen__more" onClick={() => setShowAll(s => !s)}>
              {showAll ? 'Show fewer' : `Show all ${fullList.length} takes`}
            </button>
          )}
        </div>
      </div>

      {/* ── BOTTOM · workspace (settings + master prompt + Make) ── */}
      <div className="cut-gen__work">
        <div className="cut-gen__seghead">
          <span className="mono-label">MAKE</span>
          <Tabs order={['frames', 'video']} />
        </div>

        <div className="cut-gen__wbody">
          {/* Master prompt — the raw material for every take */}
          <div className="cut-gen__mp">
            <div className="cut-gen__mphead">
              <span className="mono-label">MASTER PROMPT{selectedShot ? ` · SHOT ${selectedShot.i}` : ''}</span>
              {promptText && (
                <button className="cut-tool" title="Copy the master prompt"
                  onClick={() => { try { void navigator.clipboard?.writeText(promptText); } catch { /* ignore */ } }}>Copy</button>
              )}
            </div>
            <textarea
              className="cut-gen__prompt"
              value={promptText}
              placeholder={selectedShot ? 'No master prompt yet — write one, or run “Write master prompts”.' : 'Select a shot, or type a prompt to experiment…'}
              onChange={e => onPromptChange(e.target.value)}
              onBlur={() => { if (selectedShot?.brief) onPersist(); }}
              spellCheck={false}
            />
            {dnaLook && <div className="cut-gen__look cut-copytext" title={dnaLook}>Look · {dnaLook}</div>}
          </div>

          {tab === 'frames' ? (
            <>
              <div className="cut-gen__group">
                <span className="mono-label">MODEL</span>
                <div className="cut-gen__seg">
                  {(Object.keys(MODELS) as ModelId[]).map(m => (
                    <button key={m} className={fModel === m ? 'is-active' : ''} onClick={() => setFModel(m)}>{MODELS[m].label}</button>
                  ))}
                </div>
              </div>

              <div className="cut-gen__group">
                <span className="mono-label">QUALITY</span>
                <div className="cut-gen__seg">
                  {QUALITIES.map(q => (
                    <button key={q} className={fQuality === q ? 'is-active' : ''} onClick={() => setFQuality(q)}>{q}</button>
                  ))}
                </div>
              </div>

              <div className="cut-gen__rows">
                <div className="cut-gen__field">
                  <label>Aspect</label>
                  <select className="cut-gen__select" value={fAspect} onChange={e => setFAspect(e.target.value)}>
                    {FRAME_ASPECTS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className="cut-gen__field">
                  <label>Resolution</label>
                  <select className="cut-gen__select" value={fRes} onChange={e => setFRes(e.target.value as Resolution)}>
                    {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <div className="cut-gen__group">
                <span className="mono-label">EXCLUDE (OPTIONAL)</span>
                <textarea className="cut-gen__prompt cut-gen__prompt--sm" value={fNegative}
                  placeholder="e.g. text, logos, watermark, extra fingers…"
                  onChange={e => setFNegative(e.target.value)} spellCheck={false} />
              </div>

              {dopSection}
            </>
          ) : (
            <>
              <div className="cut-gen__group">
                <span className="mono-label">MODEL</span>
                <select className="cut-gen__select" value={vModelId} onChange={e => setVModelId(e.target.value)}>
                  <optgroup label="Seedance">
                    {VIDEO_MODELS.filter(m => m.provider === 'seedance').map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </optgroup>
                  <optgroup label="Kling">
                    {VIDEO_MODELS.filter(m => m.provider === 'kling').map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </optgroup>
                </select>
                {vModel.blurb && <div className="cut-gen__hint cut-copytext">{vModel.blurb}</div>}
              </div>

              {/* First-frame anchor — animate the shot's chosen frame */}
              <div className="cut-gen__group">
                <span className="mono-label">FIRST FRAME</span>
                <div className={`cut-gen__anchor ${vUseKeyframe && hasKeyframe ? '' : 'is-off'}`}>
                  {hasKeyframe
                    ? <img src={fileUrl(selectedShot!.keyframe)} alt="" draggable={false} />
                    : <div className="cut-gen__anchor-empty">No keyframe</div>}
                  <button className={`cut-gen__toggle ${vUseKeyframe && hasKeyframe ? 'is-on' : ''}`}
                    disabled={!hasKeyframe} onClick={() => setVUseKeyframe(v => !v)}>
                    {vUseKeyframe && hasKeyframe ? 'Anchored to shot' : 'Text-to-video'}
                  </button>
                </div>
              </div>

              <div className="cut-gen__rows">
                {isKling ? (
                  <div className="cut-gen__field">
                    <label>Quality</label>
                    <select className="cut-gen__select" value={vMode} onChange={e => setVMode(e.target.value as any)}>
                      {(vModel.modes || ['std']).map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                    </select>
                  </div>
                ) : (
                  <div className="cut-gen__field">
                    <label>Resolution</label>
                    <select className="cut-gen__select" value={vRes} onChange={e => setVRes(e.target.value as SeedRes)}>
                      {(vModel.resolutions || ['720p']).map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                )}
                <div className="cut-gen__field">
                  <label>Duration</label>
                  <select className="cut-gen__select" value={vDuration} onChange={e => setVDuration(Number(e.target.value))}>
                    {vModel.durations.map(d => <option key={d} value={d}>{d}s</option>)}
                  </select>
                </div>
                <div className="cut-gen__field">
                  <label>Ratio</label>
                  <select className="cut-gen__select" value={vRatio} onChange={e => setVRatio(e.target.value)}
                    disabled={vUseKeyframe && hasKeyframe}
                    title={vUseKeyframe && hasKeyframe ? 'Ratio follows the anchored frame' : undefined}>
                    {vModel.aspectRatios.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                {!isKling && (
                  <div className="cut-gen__field">
                    <label>FPS</label>
                    <select className="cut-gen__select" value={vFps} onChange={e => setVFps(Number(e.target.value))}>
                      {[24, 30].map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                )}
                {isKling && vModel.features.cfgScale && (
                  <div className="cut-gen__field">
                    <label>Adherence {vCfg.toFixed(1)}</label>
                    <input className="cut-gen__num" type="range" min={0} max={1} step={0.1} value={vCfg}
                      onChange={e => setVCfg(parseFloat(e.target.value))} />
                  </div>
                )}
                {!isKling && (
                  <div className="cut-gen__field">
                    <label>Seed</label>
                    <input className="cut-gen__num" type="number" value={vSeed} placeholder="random"
                      onChange={e => setVSeed(e.target.value)} />
                  </div>
                )}
              </div>

              <div className="cut-gen__group">
                <span className="mono-label">OPTIONS</span>
                <div className="cut-gen__toggles">
                  <button className={`cut-gen__toggle ${vAudio ? 'is-on' : ''}`} disabled={!vModel.features.audio}
                    title={vModel.features.audio ? 'Native audio' : 'This model has no audio'}
                    onClick={() => setVAudio(v => !v)}>Audio</button>
                  {!isKling && (
                    <button className={`cut-gen__toggle ${vCameraFixed ? 'is-on' : ''}`}
                      onClick={() => setVCameraFixed(v => !v)}>Fixed camera</button>
                  )}
                  <button className={`cut-gen__toggle ${vWatermark ? 'is-on' : ''}`}
                    onClick={() => setVWatermark(v => !v)}>Watermark</button>
                </div>
              </div>

              {isKling && vModel.features.negativePrompt && (
                <div className="cut-gen__group">
                  <span className="mono-label">EXCLUDE (OPTIONAL)</span>
                  <textarea className="cut-gen__prompt cut-gen__prompt--sm" value={vNegative}
                    placeholder="e.g. blur, distortion, morphing…"
                    onChange={e => setVNegative(e.target.value)} spellCheck={false} />
                </div>
              )}

              {dopSection}
            </>
          )}
        </div>

        {/* Active makes — concurrent, each with its own live progress */}
        {(makeJobs.length > 0 || activeStoreVideos.length > 0) && (
          <div className="cut-gen__jobs">
            {makeJobs.map(j => (
              <div key={j.id} className="cut-gen__job">
                <span className="cut-spin" />
                <span className="cut-gen__joblabel">{j.kind === 'frame' ? 'Frame' : 'Video'} · {j.label}</span>
                <span className="cut-gen__jobstatus cut-copytext">{j.status}</span>
              </div>
            ))}
            {activeStoreVideos.map(j => (
              <div key={j.id} className="cut-gen__job">
                <span className="cut-spin" />
                <span className="cut-gen__joblabel">Video · {j.promptTitle || 'take'}</span>
                <span className="cut-gen__jobstatus cut-copytext">{j.status || j.phase}</span>
              </div>
            ))}
          </div>
        )}

        <div className="cut-gen__foot">
          <button className="cut-gen__make" disabled={!canMake}
            onClick={() => (tab === 'frames' ? runMakeFrame() : runMakeVideo())}>
            {activeForTab > 0
              ? <><span className="cut-spin cut-spin--onaccent" /> Making{activeForTab > 1 ? ` ${activeForTab}` : ''}…</>
              : tab === 'frames' ? 'Make frame' : 'Make video'}
          </button>
        </div>
        {msg && <div className="cut-gen__msgrow"><span className="cut-gen__msg cut-copytext">{msg}</span></div>}
      </div>

      {/* ── Lightbox — enlarge a take ── */}
      {light && (
        <div className="cut-gen__light" onClick={() => setLight(null)}>
          <div className="cut-gen__lightbar">
            <button className="cut-icon" title="Reveal in Finder"
              onClick={e => { e.stopPropagation(); void window.hjen.revealInFinder(light.path); }}>⧉</button>
            <button className="cut-icon" title="Close" onClick={() => setLight(null)}>×</button>
          </div>
          {light.kind === 'image'
            ? <img src={light.src} alt="" onClick={e => e.stopPropagation()} />
            : <video src={light.src} controls autoPlay onClick={e => e.stopPropagation()} />}
        </div>
      )}
    </aside>
  );
}

// The take-metadata strip: model · dimensions · aspect · quality — one compact,
// selectable line so the exact make settings can be read and copied off a take.
// A missing field shows "—"; the aspect token is dropped when unknown.
function CutMeta({ model, dims, aspect, quality }: {
  model: string; dims?: string; aspect?: string; quality: string;
}) {
  return (
    <span className="cut-gen__meta cut-copytext">
      <span className="cut-gen__mmodel">{model}</span>
      <span className="cut-gen__mdot" aria-hidden>·</span>
      <span className="cut-gen__mnum">{dims || '—'}</span>
      {aspect && <><span className="cut-gen__mdot" aria-hidden>·</span><span className="cut-gen__mnum">{aspect}</span></>}
      <span className="cut-gen__mdot" aria-hidden>·</span>
      <span className="cut-gen__mq">{quality}</span>
    </span>
  );
}

// A compact DOP row — opens the app's global picker; value reflects the store.
function DopRow({ label, value, sub, thumb, onClick }: {
  label: string; value?: string | null; sub?: string; thumb?: string; onClick: () => void;
}) {
  return (
    <button className={`cut-gen__doprow ${value ? '' : 'is-empty'}`} onClick={onClick}>
      {thumb ? <img className="cut-gen__dopthumb" src={thumb} alt="" loading="lazy" /> : <span className="cut-gen__dopthumb cut-gen__dopthumb--none" />}
      <span className="cut-gen__dopmeta">
        <span className="cut-gen__doplabel">{label}</span>
        <span className="cut-gen__dopvalue">{value || 'Not set'}</span>
        {sub && <span className="cut-gen__dopsub">{sub}</span>}
      </span>
      <span className="cut-gen__chev">›</span>
    </button>
  );
}
