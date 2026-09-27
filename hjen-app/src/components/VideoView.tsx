import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type VideoJob, type VideoRef } from '../store';
import { runLayer } from '../lib/compiler';
import { normalizeMentions } from '../lib/mentions';
import { MentionTextarea } from './MentionTextarea';
import type { Selections } from '../types/catalog';
import { estimateSeedanceCost, estimateKlingCost, formatUSD } from '../lib/pricing';
import {
  slugifyPrompt,
  type SeedanceRatio,
  type SeedanceResolution,
} from '../lib/seedance';
import { runKling, type KlingParams, type KlingMode, type KlingRatio } from '../lib/kling';
import { VIDEO_MODELS, videoModelById } from '../lib/video/models';
import { dispSrc } from '../lib/dispUrl';
import hjenMaster from '../assets/hjen_master.svg';
import type {
  FailedVideoPayload,
  LibCategory,
  LibraryAsset,
  PendingVideoPayload,
  ProjectFileEntry,
  ProjectMeta,
  VideoFileEntry,
} from '../types/hjen-bridge';

// Kling mode → the label shown on the Mode chips + a display resolution string
// for the Seedance-shaped VideoJob record (std=720P · pro=1080P · 4K).
const MODE_RES: Record<KlingMode, string> = { std: '720P', pro: '1080P', '4k': '4K' };
const MODE_TO_RES: Record<KlingMode, SeedanceResolution> = { std: '720p', pro: '1080p', '4k': '4k' };

function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

const RESOLUTIONS: { value: SeedanceResolution; label: string }[] = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
];
const DURATIONS = [5, 10];
const RATIOS: SeedanceRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const FPS_OPTIONS = [24, 30];

const VIDEO_REF_CATEGORIES: Array<{ id: LibCategory; label: string }> = [
  { id: 'character',   label: 'Characters' },
  { id: 'composition', label: 'Composition' },
  { id: 'prop',        label: 'Props' },
  { id: 'location',    label: 'Set' },
  { id: 'general',     label: 'General' },
  { id: 'audio',       label: 'Audio' },
  { id: 'movement',    label: 'Movement' },
];

interface FormState {
  prompt: string;
  sourcePath: string | null;
  endFramePath: string | null;
  resolution: SeedanceResolution;
  duration: number;
  ratio: SeedanceRatio;
  fps: number;
  seed: string;
  cameraFixed: boolean;
  watermark: boolean;
  audio: boolean;
  modelId: string;
  // Kling-family fields — inert while a Seedance model is active.
  mode: KlingMode;
  cfgScale: number;
  negativePrompt: string;
}

const INITIAL_FORM: FormState = {
  prompt: '',
  sourcePath: null,
  endFramePath: null,
  resolution: '1080p',
  duration: 5,
  ratio: '16:9',
  fps: 24,
  seed: '',
  cameraFixed: false,
  watermark: false,
  audio: false,
  modelId: 'dreamina-seedance-2-0-260128',
  mode: 'pro',
  cfgScale: 0.5,
  negativePrompt: '',
};

export function VideoView() {
  const setActiveView = useStore(s => s.setActiveView);
  const activeProjectId = useStore(s => s.activeProjectId);
  const projects = useStore(s => s.projects);
  const activeProject = useMemo(
    () => projects.find(p => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );
  const selectProject = useStore(s => s.selectProject);
  const openPicker = useStore(s => s.openPicker);
  const library = useStore(s => s.library);
  const loadLibrary = useStore(s => s.loadLibrary);

  const jobs = useStore(s => s.videoJobs);
  const focusedJobId = useStore(s => s.focusedVideoJobId);
  const submitVideoJob = useStore(s => s.submitVideoJob);
  const focusVideoJob = useStore(s => s.focusVideoJob);
  const addVideoJob = useStore(s => s.addVideoJob);
  // Kling drives its own lifecycle from the view (Seedance lives in the store's
  // submitVideoJob). These are the same exported actions the store uses, so the
  // Kling path feeds the identical videoJobs list + operations strip.
  const updateVideoJob = useStore(s => s.updateVideoJob);
  const startJob = useStore(s => s.startJob);
  const updateJob = useStore(s => s.updateJob);
  const finishJob = useStore(s => s.finishJob);

  const videoRefs = useStore(s => s.videoRefs);
  const addVideoRef = useStore(s => s.addVideoRef);
  const removeVideoRef = useStore(s => s.removeVideoRef);
  const setVideoRefs = useStore(s => s.setVideoRefs);
  const videoMentionItems = useMemo(
    () => videoRefs.map(r => ({ id: r.id, name: r.name, thumbPath: r.thumbPath })),
    [videoRefs],
  );

  // DOP — Cinematography selections (shared with Frames). When the user
  // hits Animate, these get woven into the text prompt via buildVideoDopSuffix.
  const selections = useStore(s => s.selections);
  const setSelection = useStore(s => s.setSelection);
  const dopOpen = useStore(s => s.dopOpen);
  const toggleDop = useStore(s => s.toggleDop);
  const dopActiveCount = countActiveDopSelections(selections);

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [previewVideo, setPreviewVideo] = useState<string | null>(null);
  const [refPickerCategory, setRefPickerCategory] = useState<LibCategory | null>(null);
  const [bgPaused, setBgPaused] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  // Guards double-submit while the Saudi DNA Layer compiles the prompt.
  const submittingRef = useRef(false);

  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [browseProjectSlug, setBrowseProjectSlug] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<null | 'source' | 'end'>(null);

  const [pastVideos, setPastVideos] = useState<VideoFileEntry[]>([]);
  const [failedVideos, setFailedVideos] = useState<FailedVideoPayload[]>([]);
  const [inspectFailed, setInspectFailed] = useState<FailedVideoPayload | null>(null);
  const [arkKeyPresent, setArkKeyPresent] = useState<boolean | null>(null);
  const [klingKeyPresent, setKlingKeyPresent] = useState<boolean | null>(null);

  const bgVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => { window.hjen.getArkKey().then(k => setArkKeyPresent(!!k)); }, []);
  useEffect(() => { window.hjen.getKlingKey().then(k => setKlingKeyPresent(!!k)); }, []);

  const completedTick = jobs.filter(j => j.phase === 'done' || j.phase === 'failed').length;
  useEffect(() => {
    let cancelled = false;
    const slug = activeProject?.slug ?? null;
    window.hjen.listProjectVideos({ projectSlug: slug }).then(v => {
      if (!cancelled) setPastVideos(v);
    }).catch(() => { if (!cancelled) setPastVideos([]); });
    window.hjen.listFailedVideos().then(f => {
      if (!cancelled) setFailedVideos(f);
    }).catch(() => { if (!cancelled) setFailedVideos([]); });
    return () => { cancelled = true; };
  }, [activeProject?.slug, completedTick]);

  useEffect(() => {
    if (!pickerOpen) return;
    const slug = browseProjectSlug ?? activeProject?.slug ?? null;
    if (!slug) { setProjectFiles([]); return; }
    let cancelled = false;
    window.hjen.listProjectFiles({ projectSlug: slug }).then(files => {
      if (!cancelled) setProjectFiles(files);
    }).catch(() => { if (!cancelled) setProjectFiles([]); });
    return () => { cancelled = true; };
  }, [pickerOpen, browseProjectSlug, activeProject?.slug]);

  // Background video: pause/resume based on bgPaused. When a new job becomes
  // focused, reset paused so the new result auto-plays.
  useEffect(() => {
    setBgPaused(false);
  }, [focusedJobId]);

  useEffect(() => {
    const el = bgVideoRef.current;
    if (!el) return;
    if (bgPaused) el.pause();
    else if (el.paused) el.play().catch(() => {});
  }, [bgPaused]);

  // Active descriptor drives every capability decision below. form.modelId holds
  // the wire id (apiModelId); videoModelById resolves it via id OR apiModelId, so
  // the Seedance default + old sidecars keep working untouched.
  const activeModel = useMemo(() => videoModelById(form.modelId) ?? VIDEO_MODELS[0], [form.modelId]);
  const isKling = activeModel.provider === 'kling';
  const vendorLabel = isKling ? 'Kuaishou' : 'BytePlus';

  // Pre-flight cost — Kling is priced per output second, so we can show the
  // estimate BEFORE the make. Seedance is token-metered post-hoc → stays null.
  const preUsd = useMemo(
    () => isKling
      ? (estimateKlingCost(activeModel.apiModelId, form.mode, form.duration, activeModel.features.audio && form.audio)?.usd ?? null)
      : null,
    [isKling, activeModel, form.mode, form.duration, form.audio],
  );

  const canRun = useMemo(
    () => form.prompt.trim().length > 0 && (isKling ? klingKeyPresent === true : arkKeyPresent === true),
    [form.prompt, isKling, klingKeyPresent, arkKeyPresent],
  );

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(f => ({ ...f, [key]: value }));
  };

  // Switching models clamps dependent fields into the new descriptor so a make
  // never ships an unsupported value (e.g. a Kling-only 7s duration is reset
  // when returning to Seedance; a 4:3 ratio is dropped when moving to Kling).
  const selectModel = (apiModelId: string) => {
    const desc = videoModelById(apiModelId) ?? VIDEO_MODELS[0];
    setForm(f => {
      const next: FormState = { ...f, modelId: desc.apiModelId };
      if (desc.provider === 'kling') {
        const modes = desc.modes ?? ['pro'];
        next.mode = modes.includes(f.mode) ? f.mode : (modes.includes('pro') ? 'pro' : modes[0]);
        if (!desc.aspectRatios.includes(f.ratio)) next.ratio = desc.aspectRatios[0] as SeedanceRatio;
        if (!desc.features.endFrame) next.endFramePath = null;
      }
      if (!desc.durations.includes(f.duration)) {
        next.duration = desc.durations.includes(5) ? 5 : desc.durations[0];
      }
      return next;
    });
  };

  const pickSource = async () => {
    const paths = await window.hjen.pickImageFiles();
    if (!paths || paths.length === 0) return;
    updateForm('sourcePath', paths[0]);
  };
  const pickEndFrame = async () => {
    const paths = await window.hjen.pickImageFiles();
    if (!paths || paths.length === 0) return;
    updateForm('endFramePath', paths[0]);
  };
  const pickFromProject = (entry: ProjectFileEntry) => {
    if (pickerOpen === 'end') updateForm('endFramePath', entry.imgPath);
    else updateForm('sourcePath', entry.imgPath);
    setPickerOpen(null);
  };
  const openProjectPicker = (which: 'source' | 'end') => {
    setBrowseProjectSlug(activeProject?.slug ?? null);
    setPickerOpen(which);
  };

  const submit = async () => {
    if (!canRun || submittingRef.current) return;
    const seedNum = form.seed.trim() === '' ? null : Number(form.seed);
    if (seedNum != null && Number.isNaN(seedNum)) {
      alert('Seed must be an integer or empty.');
      return;
    }
    // LAYER STEP — Saudi DNA compiler on the video prompt. Same discipline
    // as the image path: cultural correction + the Arabic-text law (Seedance
    // renders Arabic glyphs poorly, so in-model text asks get stripped into
    // an overlay plan). Any failure falls back silently to the raw prompt.
    submittingRef.current = true;
    // @mentions resolve to plain names before the layer/model see the text —
    // Seedance never receives the ref images, so the token is prose-only.
    let promptForVideo = normalizeMentions(
      form.prompt.trim(),
      videoRefs.map(r => r.name),
      'strip',
    );
    try {
      if (useStore.getState().layerEnabled && promptForVideo) {
        // DOP chips get woven in as buildVideoDopSuffix below — if any are
        // active, the user owns the look and the layer stays cultural-only.
        const lookLocked = countActiveDopSelections(selections) > 0;
        const layerRun = await runLayer({
          userPrompt: promptForVideo,
          mode: 'video',
          modelId: form.modelId,
          lookLocked,
          llm: (a) => window.hjen.claudeJson(a),
        });
        if (layerRun) {
          promptForVideo = layerRun.compiledPrompt;
          useStore.setState({ lastLayerRun: layerRun });
        }
      }
    } catch { /* the layer never blocks a make */ }
    finally { submittingRef.current = false; }
    // Weave DOP selections into the prompt before submit. Seedance has no
    // structured cinematography params — every cinematography hint travels
    // as text. We keep the (layer-compiled) user text first (so it stays
    // the dominant signal) and append the DOP descriptors as a second paragraph.
    const dopSuffix = buildVideoDopSuffix(selections);
    const finalPrompt = dopSuffix
      ? `${promptForVideo}\n\n${dopSuffix}`
      : promptForVideo;

    // Provider branch. Kling speaks structured JSON (its own adapter); Seedance
    // stays on the store's submitVideoJob path (flags-in-prompt). Both feed the
    // SAME videoJobs list + operations strip + progress UI.
    if (isKling) {
      runKlingJob(finalPrompt);
    } else {
      submitVideoJob({
        prompt: finalPrompt,
        sourcePath: form.sourcePath,
        endFramePath: form.endFramePath,
        resolution: form.resolution,
        duration: form.duration,
        ratio: form.ratio,
        fps: form.fps,
        seed: seedNum,
        cameraFixed: form.cameraFixed,
        watermark: form.watermark,
        audio: form.audio,
        modelId: form.modelId,
        videoRefs: videoRefs,
        // Snapshot the raw user prompt + DOP selections so a click on the
        // saved video restores the exact recipe (form is re-typeable, DOP
        // pickers re-fill, refs come back).
        rawUserPrompt: form.prompt.trim(),
        selectionsSnapshot: serializeSelections(selections),
      });
    }
    updateForm('prompt', '');
    setTimeout(() => {
      window.hjen.listFailedVideos().then(setFailedVideos).catch(() => {});
    }, 1000);
  };

  // Kling make — mirrors the store's submitVideoJob (Seedance) lifecycle from
  // the view: register a VideoJob + a video-make operation, drive runKling, and
  // persist a durable pending record (tagged provider:'kling' + videoType) so a
  // mid-render crash is recoverable via resumeKling on next launch.
  const runKlingJob = (finalPrompt: string) => {
    const desc = activeModel;
    const proj = activeProject;
    const id = `vjob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const title = finalPrompt.trim().split(/[.!?\n]/)[0]?.slice(0, 80) || 'untitled';
    const displayRes = MODE_TO_RES[form.mode];
    const sound = desc.features.audio && form.audio;
    const endImagePath = desc.features.endFrame ? form.endFramePath : null;
    const promptSlug = slugifyPrompt(finalPrompt);
    const startedAt = Date.now();
    const projectRef = proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null;
    const refsSnapshot = videoRefs;
    const selectionsSnap = serializeSelections(selections);
    const rawUser = form.prompt.trim();

    addVideoJob({
      id, startedAt,
      prompt: finalPrompt, promptTitle: title,
      sourcePath: form.sourcePath, endFramePath: endImagePath,
      resolution: displayRes, duration: form.duration, ratio: form.ratio, fps: 24,
      seed: null, cameraFixed: false, watermark: form.watermark, audio: sound,
      modelId: desc.apiModelId, phase: 'submitting',
    });

    const bgId = startJob({
      kind: 'video-make',
      title: `Video · ${title}`,
      projectId: proj?.id ?? null,
      nav: { view: 'video', projectId: proj?.id ?? null },
      stages: [
        { key: 'submit', label: 'Submit to the server', state: 'pending' },
        { key: 'render', label: 'Render (server-side)', state: 'pending' },
        { key: 'download', label: 'Download the clip', state: 'pending' },
        { key: 'save', label: 'Save into the project', state: 'pending' },
      ],
      progressText: `${MODE_RES[form.mode]} · ${form.duration}s`,
    });

    const params: KlingParams = {
      prompt: finalPrompt,
      negativePrompt: desc.features.negativePrompt ? (form.negativePrompt.trim() || undefined) : undefined,
      imagePath: form.sourcePath,
      endImagePath,
      modelId: desc.apiModelId,
      mode: form.mode,
      aspectRatio: form.ratio as KlingRatio,   // ignored by Kling in image mode
      duration: form.duration,
      cfgScale: desc.features.cfgScale ? form.cfgScale : null,
      sound,
      watermark: form.watermark,
      videoRefs: refsSnapshot,
      rawUserPrompt: rawUser,
      selectionsSnapshot: selectionsSnap,
    };

    void (async () => {
      try {
        const result = await runKling(
          params,
          { promptSlug, projectSlug: proj?.slug, projectId: proj?.id },
          (prog) => {
            updateVideoJob(id, { phase: prog.phase, status: prog.status, taskId: prog.taskId });
            const stage = prog.phase === 'downloading' ? 'download'
              : prog.phase === 'saving' ? 'save'
              : (prog.phase === 'queued' || prog.phase === 'running') ? 'render'
              : 'submit';
            updateJob(bgId, { activeStage: stage, progressText: prog.status || prog.phase });
          },
          ({ taskId, model, promptFull, videoType }) => {
            updateVideoJob(id, { taskId });
            updateJob(bgId, { activeStage: 'render' });
            const payload: PendingVideoPayload = {
              id, kind: 'video', ts: startedAt, taskId,
              promptTitle: title, prompt: finalPrompt, promptFull,
              modelId: desc.apiModelId, model,
              imagePath: form.sourcePath, endImagePath,
              resolution: displayRes, duration: form.duration, ratio: form.ratio,
              fps: 24, seed: null, cameraFixed: false,
              watermark: form.watermark, audio: sound,
              promptSlug, project: projectRef,
              videoRefs: refsSnapshot, rawUserPrompt: rawUser, selectionsSnapshot: selectionsSnap,
              // Kling routing + params to rebuild KlingParams on recovery.
              provider: 'kling', videoType, mode: form.mode,
              cfgScale: params.cfgScale ?? null,
              negativePrompt: params.negativePrompt ?? null, sound,
            };
            void window.hjen.savePendingJob({ id, payload });
          },
        );
        const cost = estimateKlingCost(desc.apiModelId, form.mode, form.duration, sound);
        updateVideoJob(id, {
          phase: 'done', taskId: result.taskId, resultPath: result.videoPath,
          finishedAt: Date.now(), estimatedUsd: cost?.usd,
        });
        finishJob(bgId, { status: 'done' });
        try { await window.hjen.clearPendingJob({ id }); } catch {}
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        updateVideoJob(id, { phase: 'failed', error: errMsg, finishedAt: Date.now() });
        finishJob(bgId, { status: 'error', error: errMsg });
        try { await window.hjen.clearPendingJob({ id }); } catch {}
        try {
          const fid = `vfail-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await window.hjen.saveFailedVideo({
            id: fid,
            payload: {
              id: fid, ts: Date.now(), promptTitle: title, errorMessage: errMsg,
              prompt: finalPrompt, imagePath: form.sourcePath, endImagePath,
              resolution: displayRes, duration: form.duration, ratio: form.ratio, fps: 24,
              seed: null, cameraFixed: false, watermark: form.watermark, audio: sound,
              modelId: desc.apiModelId, project: projectRef,
            },
          });
        } catch {}
      }
    })();
  };

  const enhance = async () => {
    if (!form.prompt.trim() || enhancing) return;
    setEnhancing(true);
    try {
      // Claude vision processes IMAGES only — passing an audio file path
      // returns "Could not process image" (400). Audio + non-image refs
      // are filtered out before the call; they still ship with the
      // sidecar but Enhance never sees them.
      const refs = videoRefs
        .filter(r => r.category !== 'audio' && isImageFile(r.filePath))
        .map(r => ({
          filePath: r.filePath,
          category: r.category,
          name: r.name,
        }));
      if (form.sourcePath && isImageFile(form.sourcePath)) {
        refs.push({ filePath: form.sourcePath, category: 'general', name: 'first frame' });
      }
      if (form.endFramePath && isImageFile(form.endFramePath)) {
        refs.push({ filePath: form.endFramePath, category: 'general', name: 'end frame' });
      }

      const res = await window.hjen.enhancePrompt({
        rawPrompt: form.prompt.trim(),
        references: refs,
        settings: {
          aspect: form.ratio,
        },
        projectId: activeProject?.id ?? null,
        projectSlug: activeProject?.slug ?? null,
        projectName: activeProject?.name ?? null,
      });
      if (res.ok) {
        updateForm('prompt', res.enhancedPrompt);
      } else {
        alert(`Enhance failed: ${res.message}`);
      }
    } catch (err: any) {
      alert(`Enhance failed: ${err?.message || err}`);
    } finally {
      setEnhancing(false);
    }
  };

  const newFresh = () => {
    setForm(INITIAL_FORM);
    focusVideoJob(null);
  };

  const dismissFailed = async (id: string) => {
    await window.hjen.deleteFailedVideo({ id });
    setFailedVideos(prev => prev.filter(f => f.id !== id));
  };
  const restoreFailed = (f: FailedVideoPayload) => {
    setForm({
      prompt: f.prompt,
      sourcePath: f.imagePath ?? null,
      endFramePath: f.endImagePath ?? null,
      resolution: f.resolution as SeedanceResolution,
      duration: f.duration,
      ratio: f.ratio as SeedanceRatio,
      fps: f.fps,
      seed: f.seed != null ? String(f.seed) : '',
      cameraFixed: !!f.cameraFixed,
      watermark: !!f.watermark,
      audio: !!f.audio,
      modelId: f.modelId || INITIAL_FORM.modelId,
      mode: INITIAL_FORM.mode,
      cfgScale: INITIAL_FORM.cfgScale,
      negativePrompt: INITIAL_FORM.negativePrompt,
    });
    setInspectFailed(null);
    focusVideoJob(null);
  };

  const [previewEntry, setPreviewEntry] = useState<VideoFileEntry | null>(null);

  // Build the synthetic VideoJob for a past video (used by both single-click
  // focus + restore-from-modal). Reads the sidecar to get full metadata.
  const buildJobFromEntry = async (v: VideoFileEntry): Promise<VideoJob> => {
    let sidecar: any = null;
    try { sidecar = await window.hjen.readSidecar(v.jsonPath); } catch {}
    const tokens: number | undefined = sidecar?.usage?.completion_tokens;
    // Cost: Seedance is token-metered; Kling is priced per second (no tokens),
    // so branch on the resolved provider.
    const pastDesc = videoModelById(sidecar?.apiModelId || sidecar?.model || v.modelLabel || '');
    const cost = pastDesc?.provider === 'kling'
      ? estimateKlingCost(pastDesc.apiModelId, (sidecar?.mode as KlingMode) ?? 'pro', sidecar?.duration ?? v.videoSeconds ?? 5, !!sidecar?.sound)
      : estimateSeedanceCost(tokens);
    return {
      id: `past-${v.baseName}`,
      startedAt: v.ts,
      finishedAt: v.ts,
      prompt: sidecar?.prompt || v.promptTitle,
      promptTitle: v.promptTitle,
      sourcePath: sidecar?.imagePath ?? null,
      endFramePath: sidecar?.endImagePath ?? null,
      resolution: (sidecar?.resolution as SeedanceResolution) || (sidecar?.mode ? MODE_TO_RES[sidecar.mode as KlingMode] : undefined) || (v.size as SeedanceResolution) || '1080p',
      duration: sidecar?.duration ?? v.videoSeconds ?? 5,
      ratio: (sidecar?.ratio as SeedanceRatio) || (sidecar?.aspectRatio as SeedanceRatio) || (v.ratio as SeedanceRatio) || '16:9',
      fps: sidecar?.fps ?? 24,
      seed: sidecar?.seed ?? null,
      cameraFixed: !!sidecar?.cameraFixed,
      watermark: !!sidecar?.watermark,
      audio: !!sidecar?.audio,
      modelId: sidecar?.apiModelId || sidecar?.model || v.modelLabel || INITIAL_FORM.modelId,
      phase: 'done',
      taskId: sidecar?.taskId,
      resultPath: v.imgPath,
      tokens,
      estimatedUsd: cost?.usd,
    };
  };

  // Single click in sidebar = focus this video as the background AND restore
  // every input that produced it (prompt, params, frame slots, references)
  // back into the form + right rail. Mirrors the Frames "view past frame"
  // pattern where clicking a thumb brings its full recipe back into Studio.
  const focusPastVideo = async (v: VideoFileEntry) => {
    let sidecar: any = null;
    try { sidecar = await window.hjen.readSidecar(v.jsonPath); } catch {}

    const synthetic = await buildJobFromEntry(v);
    if (!jobs.some(j => j.id === synthetic.id)) addVideoJob(synthetic);
    focusVideoJob(synthetic.id);

    // Restore the form fields exactly as they were at submit time.
    setForm({
      prompt: synthetic.prompt,
      sourcePath: synthetic.sourcePath,
      endFramePath: synthetic.endFramePath,
      resolution: synthetic.resolution,
      duration: synthetic.duration,
      ratio: synthetic.ratio,
      fps: synthetic.fps,
      seed: synthetic.seed != null ? String(synthetic.seed) : '',
      cameraFixed: synthetic.cameraFixed,
      watermark: synthetic.watermark,
      audio: synthetic.audio,
      modelId: synthetic.modelId,
      // Kling-only fields live in the sidecar, not the VideoJob.
      mode: (sidecar?.mode as KlingMode) ?? 'pro',
      cfgScale: typeof sidecar?.cfgScale === 'number' ? sidecar.cfgScale : 0.5,
      negativePrompt: sidecar?.negativePrompt ?? '',
    });

    // Restore the attached references (right rail). Older sidecars (saved
    // before this feature) won't have the field — we treat that as "no
    // refs were saved" and clear the rail.
    const savedRefs = Array.isArray(sidecar?.videoRefs) ? sidecar.videoRefs : [];
    setVideoRefs(savedRefs);

    // Restore the DOP selections — picks the editable raw prompt back
    // (NOT the DOP-enriched promptFull) and refills every Cinematography
    // chip. Subsequent Animate will re-append the suffix from chips, so
    // the prompt text stays free of auto-generated cruft.
    if (sidecar?.selectionsSnapshot) {
      restoreSelections(sidecar.selectionsSnapshot, setSelection);
    }
    if (typeof sidecar?.rawUserPrompt === 'string') {
      setForm(f => ({ ...f, prompt: sidecar.rawUserPrompt }));
    }

    setBgPaused(false);
  };

  // Double click in sidebar = open the comprehensive lightbox preview.
  const previewPastVideo = (v: VideoFileEntry) => {
    setPreviewEntry(v);
    setBgPaused(true);
  };

  // Lightbox "Restore" button — same effect as a single-click on the sidebar
  // item (focus + restore form + restore refs), plus closes the lightbox.
  const restoreFromVideo = async (v: VideoFileEntry) => {
    await focusPastVideo(v);
    setPreviewEntry(null);
  };

  const deletePastVideo = async (v: VideoFileEntry) => {
    if (!confirm(`Delete this video permanently?\n\n${v.promptTitle}\n\nThe file will be removed from disk.`)) return;
    await window.hjen.deleteGeneration({ imgPath: v.imgPath });
    setPreviewEntry(null);
    setBgPaused(false);
    // Refresh list
    const slug = activeProject?.slug ?? null;
    const list = await window.hjen.listProjectVideos({ projectSlug: slug });
    setPastVideos(list);
  };

  const revealInFinder = (v: VideoFileEntry) => {
    window.hjen.openFolder(v.imgPath.replace(/\/[^/]+$/, ''));
  };

  // backgroundJob — what plays full-screen in the canvas:
  //  - If the user explicitly focused a DONE job (via sidebar click), show it
  //  - Otherwise show the latest done job
  //  - Running/failed focus does NOT replace the bg (it keeps playing the
  //    last result while a new one renders)
  const latestDone = useMemo(
    () => jobs.find(j => j.phase === 'done' && j.resultPath) || null,
    [jobs],
  );
  const backgroundJob = useMemo(() => {
    if (focusedJobId) {
      const f = jobs.find(j => j.id === focusedJobId);
      if (f?.phase === 'done' && f.resultPath) return f;
    }
    return latestDone;
  }, [jobs, focusedJobId, latestDone]);
  const focusedJob = useMemo(() => {
    if (focusedJobId) return jobs.find(j => j.id === focusedJobId) || null;
    return latestDone;
  }, [jobs, focusedJobId, latestDone]);

  const runningCount = jobs.filter(j => j.phase !== 'done' && j.phase !== 'failed').length;

  return (
    <div className="video">
      {/* FULLSCREEN BACKGROUND — always shows the latest DONE video.
       *  Keeps playing while new jobs run so the user has visual feedback
       *  rather than a black void. The currently-running job (if any)
       *  shows a small status pill in the corner instead of replacing
       *  the whole canvas. */}
      <div className="video-bg">
        {backgroundJob?.resultPath ? (
          <>
            <video
              ref={bgVideoRef}
              key={backgroundJob.resultPath}
              className="video-bg__player"
              src={fileUrl(backgroundJob.resultPath)}
              autoPlay={!bgPaused}
              loop
              /* Always muted on the main canvas — even if the generated
               * clip has audio. Sound plays only inside the Preview
               * lightbox (which has visible controls), so the user
               * intentionally activates audio rather than being
               * surprised by it from a passive background loop. */
              muted
              playsInline
              onDoubleClick={() => setPreviewVideo(backgroundJob.resultPath ?? null)}
            />
            <div className="video-bg__tint" />
          </>
        ) : focusedJob?.phase === 'failed' ? (
          <div className="video-bg__failed">
            <div className="video-bg__failed-title">Generation failed</div>
            <pre className="video-bg__failed-msg">{focusedJob.error}</pre>
            <div className="mono-label" style={{ color: 'var(--ink-muted)' }}>
              Saved in Failed · left sidebar
            </div>
          </div>
        ) : (
          <div className="video-bg__placeholder">
            <img src={hjenMaster} alt="" className="video-bg__mark" />
            <div className="mono-label">Write a motion prompt below, then press Animate.</div>
            <div className="mono-label video-bg__placeholder-sub">
              Multiple jobs run in parallel. Drop refs from the right rail.
            </div>
          </div>
        )}

        {/* Small status pill — overlays the bg, doesn't replace it */}
        {runningCount > 0 && (
          <div className="video-bg__statuspill mono-label">
            <div className="spinner spinner--small" />
            <span>{runningCount} running</span>
            {focusedJob && focusedJob.phase !== 'done' && focusedJob.phase !== 'failed' && (
              <span className="video-bg__statuspill-detail">
                · {phaseLabel(focusedJob.phase, focusedJob.status)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* OVERLAY HEADER */}
      <header className="video__header video__header--overlay">
        <button className="video__back" onClick={() => setActiveView('studio')}>← Studio</button>
        <div className="video__title">
          <h1>Video</h1>
          <span className="mono-label">
            Image → motion · {activeModel.label} · {vendorLabel}
            {runningCount > 0 && <> · <span style={{ color: 'var(--flash)' }}>{runningCount} running</span></>}
          </span>
        </div>
        <div className="video__project mono-label">
          {activeProject ? activeProject.name : 'No project — saves to root'}
        </div>
      </header>

      {!isKling && arkKeyPresent === false && (
        <div className="video__keywarn video__keywarn--overlay">
          <strong>ARK_API_KEY missing.</strong> Open Settings (⚙) and paste a BytePlus ARK key.
        </div>
      )}
      {isKling && klingKeyPresent === false && (
        <div className="video__keywarn video__keywarn--overlay">
          <strong>Kling API key missing.</strong> Open Settings (⚙) and paste a Kling key.
        </div>
      )}

      {/* LEFT RAIL — project + jobs */}
      <VideoLeftSidebar
        activeProject={activeProject}
        projects={projects}
        jobs={jobs}
        videos={pastVideos}
        failed={failedVideos}
        focusedJobId={focusedJobId}
        currentResultPath={focusedJob?.resultPath ?? null}
        onPickProject={() => openPicker('projects')}
        onSwitchProject={selectProject}
        onPickVideo={focusPastVideo}
        onPreviewEntry={previewPastVideo}
        onPickJob={(id) => { focusVideoJob(id); }}
        onPreviewVideo={(p) => setPreviewVideo(p)}
        onInspectFailed={setInspectFailed}
        onDismissFailed={dismissFailed}
        onRestoreFailed={restoreFailed}
      />

      {/* RIGHT RAIL — slots + refs */}
      <VideoRightRail
        sourcePath={form.sourcePath}
        endFramePath={form.endFramePath}
        showEndFrame={!isKling || activeModel.features.endFrame}
        videoRefs={videoRefs}
        onPickSource={pickSource}
        onPickSourceFromProject={() => openProjectPicker('source')}
        onClearSource={() => updateForm('sourcePath', null)}
        onPickEnd={pickEndFrame}
        onPickEndFromProject={() => openProjectPicker('end')}
        onClearEnd={() => updateForm('endFramePath', null)}
        onOpenRefPicker={(cat) => setRefPickerCategory(cat)}
        onRemoveRef={removeVideoRef}
      />

      {/* BOTTOM OVERLAY — prompt + Enhance + controls + Animate */}
      <div className="video-bottom">
        <div className="video-promptbar">
          <MentionTextarea
            className="video-promptbar__input"
            placeholder="Motion prompt — describe how the still should move. Arabic or English."
            value={form.prompt}
            onChange={v => updateForm('prompt', v)}
            rows={3}
            dir="auto"
            items={videoMentionItems}
          />
          <button
            className="video-promptbar__enhance"
            onClick={enhance}
            disabled={!form.prompt.trim() || enhancing}
            title="Send prompt + refs to Claude vision for a motion-aware rewrite"
          >
            {enhancing ? 'Enhancing…' : 'Enhance ✨'}
          </button>
          <button
            className={`video-promptbar__dop ${dopOpen ? 'video-promptbar__dop--open' : ''} ${dopActiveCount > 0 ? 'video-promptbar__dop--active' : ''}`}
            onClick={toggleDop}
            title="Open Cinematography panel — camera, lens, stock, lighting, movement"
          >
            DOP{dopActiveCount > 0 ? ` · ${dopActiveCount}` : ''}
          </button>
        </div>

        <div className="video-controls">
          {isKling ? (
            <>
              <ControlGroup label="Mode">
                {(activeModel.modes ?? []).map(m => (
                  <Chip key={m} active={form.mode === m} onClick={() => updateForm('mode', m)}>{MODE_RES[m]}</Chip>
                ))}
              </ControlGroup>
              <ControlGroup label="Duration">
                {activeModel.durations.map(d => (
                  <Chip key={d} active={form.duration === d} onClick={() => updateForm('duration', d)}>{d}s</Chip>
                ))}
              </ControlGroup>
              {/* Aspect only for text-to-video — image mode derives ratio from the frame. */}
              {form.sourcePath ? (
                <ControlGroup label="Aspect">
                  <span className="video-controls__hint mono-label" style={{ color: 'var(--ink-muted)', letterSpacing: 0, textTransform: 'none' }}>
                    Follows the first frame
                  </span>
                </ControlGroup>
              ) : (
                <ControlGroup label="Aspect">
                  {activeModel.aspectRatios.map(r => (
                    <Chip key={r} active={form.ratio === r} onClick={() => updateForm('ratio', r as SeedanceRatio)}>{r}</Chip>
                  ))}
                </ControlGroup>
              )}
              {activeModel.features.cfgScale && (
                <ControlGroup label="CFG">
                  <div className="video-control__row" style={{ alignItems: 'center', gap: 'var(--s-2)' }}>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={form.cfgScale}
                      onChange={e => updateForm('cfgScale', Number(e.target.value))}
                      style={{ accentColor: 'var(--flash)', flex: 1, minWidth: 72 }}
                      aria-label="CFG scale"
                    />
                    <span className="mono-label">{form.cfgScale.toFixed(2)}</span>
                  </div>
                </ControlGroup>
              )}
              {activeModel.features.negativePrompt && (
                <ControlGroup label="Negative">
                  <input
                    className="video-controls__model"
                    type="text"
                    placeholder="What to avoid"
                    value={form.negativePrompt}
                    onChange={e => updateForm('negativePrompt', e.target.value)}
                    dir="auto"
                  />
                </ControlGroup>
              )}
              <ControlGroup label="Flags">
                {activeModel.features.audio && (
                  <Chip active={form.audio} onClick={() => updateForm('audio', !form.audio)}>Sound</Chip>
                )}
                <Chip active={form.watermark} onClick={() => updateForm('watermark', !form.watermark)}>Keep watermark</Chip>
              </ControlGroup>
            </>
          ) : (
            <>
              <ControlGroup label="Resolution">
                {RESOLUTIONS.map(r => (
                  <Chip key={r.value} active={form.resolution === r.value} onClick={() => updateForm('resolution', r.value)}>{r.label}</Chip>
                ))}
              </ControlGroup>
              <ControlGroup label="Duration">
                {DURATIONS.map(d => (
                  <Chip key={d} active={form.duration === d} onClick={() => updateForm('duration', d)}>{d}s</Chip>
                ))}
              </ControlGroup>
              <ControlGroup label="Aspect">
                {RATIOS.map(r => (
                  <Chip key={r} active={form.ratio === r} onClick={() => updateForm('ratio', r)}>{r}</Chip>
                ))}
              </ControlGroup>
              <ControlGroup label="FPS">
                {FPS_OPTIONS.map(f => (
                  <Chip key={f} active={form.fps === f} onClick={() => updateForm('fps', f)}>{f}</Chip>
                ))}
              </ControlGroup>
              <ControlGroup label="Seed">
                <input
                  className="video-controls__seed"
                  type="text"
                  inputMode="numeric"
                  placeholder="random"
                  value={form.seed}
                  onChange={e => updateForm('seed', e.target.value.replace(/[^0-9-]/g, ''))}
                />
              </ControlGroup>
              <ControlGroup label="Flags">
                <Chip active={form.cameraFixed} onClick={() => updateForm('cameraFixed', !form.cameraFixed)}>Camera fixed</Chip>
                <Chip active={form.audio} onClick={() => updateForm('audio', !form.audio)}>Audio</Chip>
                <Chip active={form.watermark} onClick={() => updateForm('watermark', !form.watermark)}>Keep watermark</Chip>
              </ControlGroup>
            </>
          )}
          <ControlGroup label="Model">
            <select
              className="video-controls__model"
              value={activeModel.id}
              onChange={e => {
                const picked = videoModelById(e.target.value);
                if (picked) selectModel(picked.apiModelId);
              }}
            >
              <optgroup label="Seedance">
                {VIDEO_MODELS.filter(m => m.provider === 'seedance').map(m => (
                  <option key={m.id} value={m.id} title={m.blurb}>{m.label}</option>
                ))}
              </optgroup>
              <optgroup label="Kling">
                {VIDEO_MODELS.filter(m => m.provider === 'kling').map(m => (
                  <option key={m.id} value={m.id} title={m.blurb}>{m.label}</option>
                ))}
              </optgroup>
            </select>
            {activeModel.blurb && (
              <div
                className="video-controls__blurb"
                style={{ color: 'var(--ink-muted)', fontSize: 'var(--t-micro)', lineHeight: 1.4, marginTop: 'var(--s-1)' }}
              >
                {activeModel.blurb}
              </div>
            )}
          </ControlGroup>
        </div>

        <footer className="video__foot">
          <button className="btn-secondary" onClick={newFresh}>Clear form</button>
          <div className="video__foot-meta mono-label">
            {focusedJob?.phase === 'done' && focusedJob.resultPath ? (
              <>
                Saved · <code>{shortenPath(focusedJob.resultPath)}</code>
                {focusedJob.estimatedUsd != null && (
                  <>
                    {' · '}
                    <span title={focusedJob.tokens != null ? `${focusedJob.tokens.toLocaleString()} tokens (estimated)` : 'Estimated cost'}>
                      {formatUSD(focusedJob.estimatedUsd)}
                    </span>
                  </>
                )}
              </>
            ) : (
              <>
                {activeModel.label} · {isKling ? MODE_RES[form.mode] : form.resolution} · {form.duration}s · {isKling && form.sourcePath ? 'frame-derived' : form.ratio}
                {preUsd != null && <> · ~{formatUSD(preUsd)}</>}
              </>
            )}
          </div>
          <button className="btn-primary video__cta" onClick={submit} disabled={!canRun}>
            Animate{runningCount > 0 ? ` (+${runningCount})` : ''}
          </button>
        </footer>
      </div>

      {pickerOpen && (
        <VideoFramePicker
          projects={projects}
          currentSlug={browseProjectSlug ?? activeProject?.slug ?? null}
          files={projectFiles}
          which={pickerOpen}
          onSwitchProject={setBrowseProjectSlug}
          onPick={pickFromProject}
          onClose={() => setPickerOpen(null)}
        />
      )}

      {inspectFailed && (
        <FailedVideoInspector
          failed={inspectFailed}
          onRestore={restoreFailed}
          onClose={() => setInspectFailed(null)}
        />
      )}

      {previewVideo && (
        <VideoPreviewModal
          path={previewVideo}
          onClose={() => { setPreviewVideo(null); setBgPaused(false); }}
        />
      )}

      {previewEntry && (
        <VideoLightbox
          entry={previewEntry}
          onClose={() => { setPreviewEntry(null); setBgPaused(false); }}
          onRestore={() => restoreFromVideo(previewEntry)}
          onReveal={() => revealInFinder(previewEntry)}
          onDelete={() => deletePastVideo(previewEntry)}
        />
      )}

      {refPickerCategory && (
        <RefPickerModal
          category={refPickerCategory}
          library={library}
          onPick={(asset) => { addVideoRef(asset, refPickerCategory); setRefPickerCategory(null); }}
          onUploadAndPick={async () => {
            const isAudio = refPickerCategory === 'audio';
            const paths = isAudio
              ? await window.hjen.pickAudioFiles()
              : await window.hjen.pickImageFiles();
            if (!paths || paths.length === 0) return;
            for (const p of paths) {
              const r = await window.hjen.addToLibrary({ category: refPickerCategory, sourcePath: p });
              if (r.ok && r.asset) addVideoRef(r.asset, refPickerCategory);
            }
            await loadLibrary();
            setRefPickerCategory(null);
          }}
          onClose={() => setRefPickerCategory(null)}
        />
      )}
    </div>
  );
}

// ===================== LEFT SIDEBAR =====================

interface VideoLeftSidebarProps {
  activeProject: ProjectMeta | null;
  projects: ProjectMeta[];
  jobs: VideoJob[];
  videos: VideoFileEntry[];
  failed: FailedVideoPayload[];
  focusedJobId: string | null;
  currentResultPath: string | null;
  onPickProject: () => void;
  onSwitchProject: (id: string | null) => void;
  onPickJob: (id: string) => void;
  /** Single click — focus this video in the main background canvas. */
  onPickVideo: (v: VideoFileEntry) => void;
  /** Double click — open the comprehensive lightbox preview. */
  onPreviewEntry: (v: VideoFileEntry) => void;
  /** Legacy raw-path preview (used by bg double-click). */
  onPreviewVideo: (path: string) => void;
  onInspectFailed: (f: FailedVideoPayload) => void;
  onDismissFailed: (id: string) => void;
  onRestoreFailed: (f: FailedVideoPayload) => void;
}

function VideoLeftSidebar({
  activeProject, projects, jobs, videos, failed,
  focusedJobId, currentResultPath,
  onPickProject, onSwitchProject, onPickJob, onPickVideo, onPreviewEntry, onInspectFailed, onDismissFailed, onRestoreFailed,
}: VideoLeftSidebarProps) {
  const inflight = jobs.filter(j => j.phase !== 'done' && j.phase !== 'failed');
  const grouped = groupByDate(videos);

  return (
    <aside className="video-sidebar video-sidebar--overlay">
      <header className="video-sidebar__header">
        <button className="sidebar__project-pill" onClick={onPickProject}>
          <div className="sidebar__project-pill-top">
            <span className="mono-label">Project</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M2 3.5l3 3 3-3"/>
            </svg>
          </div>
          <div className="sidebar__project-pill-name">
            {activeProject ? activeProject.name : 'Choose project'}
          </div>
        </button>
        {projects.length > 1 && (
          <div className="sidebar__quickswitch">
            <span className="mono-label">Switch</span>
            <div className="sidebar__quickswitch-list">
              {projects.slice(0, 4).filter(p => p.id !== activeProject?.id).map(p => (
                <button key={p.id} className="sidebar__quickswitch-chip" onClick={() => onSwitchProject(p.id)} title={p.name}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="video-sidebar__body">
        {inflight.length > 0 && (
          <section className="sidebar__group sidebar__group--running">
            <div className="sidebar__group-header mono-label">In progress · {inflight.length}</div>
            <div className="sidebar__group-items">
              {inflight.map(j => (
                <button
                  key={j.id}
                  className={`sidebar__item ${j.id === focusedJobId ? 'sidebar__item--active' : ''}`}
                  onClick={() => onPickJob(j.id)}
                >
                  <div className="sidebar__item-thumb sidebar__item-thumb--running">
                    <div className="spinner spinner--small" />
                  </div>
                  <div className="sidebar__item-body">
                    <div className="sidebar__item-title">{j.promptTitle}</div>
                    <div className="sidebar__item-meta mono-label">
                      {j.phase}{j.status ? ` · ${j.status}` : ''} · {j.resolution}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {failed.length > 0 && (
          <section className="sidebar__group sidebar__group--failed">
            <div className="sidebar__group-header mono-label">Failed · {failed.length}</div>
            <div className="sidebar__group-items">
              {failed.slice(0, 20).map(f => (
                <div
                  key={f.id}
                  className="sidebar__item sidebar__item--failed sidebar__item--clickable"
                  title={`${f.errorMessage} · click for details`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onInspectFailed(f)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onInspectFailed(f); } }}
                >
                  <div className="sidebar__item-thumb sidebar__item-thumb--warn">
                    <span className="warn-mark">!</span>
                  </div>
                  <div className="sidebar__item-body">
                    <div className="sidebar__item-title">{f.promptTitle || 'untitled'}</div>
                    <div className="sidebar__item-meta mono-label">
                      {f.resolution} · {f.duration}s
                    </div>
                    <div className="sidebar__interrupted-actions">
                      <button
                        className="sidebar__interrupted-btn sidebar__interrupted-btn--primary"
                        onClick={(e) => { e.stopPropagation(); onRestoreFailed(f); }}
                        title="Re-apply this prompt + settings into the form (stays here)"
                      >Restore</button>
                      <button
                        className="sidebar__interrupted-btn"
                        onClick={(e) => { e.stopPropagation(); onDismissFailed(f.id); }}
                        title="Delete this failed entry"
                      >Dismiss</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {videos.length === 0 && failed.length === 0 && inflight.length === 0 && (
          <div className="sidebar__empty">
            No videos yet. Drop refs in the right rail, write a prompt, Animate.
          </div>
        )}

        {grouped.map(group => (
          <section key={group.date} className="sidebar__group">
            <div className="sidebar__group-header mono-label">
              {prettyDate(group.date)}
              <span className="sidebar__group-count">{group.items.length}</span>
            </div>
            <div className="sidebar__group-items">
              {group.items.map(v => (
                <button
                  key={v.imgPath}
                  className={`sidebar__item ${v.imgPath === currentResultPath ? 'sidebar__item--active' : ''}`}
                  onClick={() => onPickVideo(v)}
                  onDoubleClick={() => onPreviewEntry(v)}
                  title={`${v.promptTitle} · single click = show in canvas · double-click = preview`}
                >
                  {v.thumbPath ? (
                    <img className="sidebar__item-thumb" src={dispSrc(v.thumbPath, 'thumb')} alt="" loading="lazy" />
                  ) : (
                    <div className="sidebar__item-thumb sidebar__item-thumb--placeholder">▶</div>
                  )}
                  <div className="sidebar__item-body">
                    <div className="sidebar__item-title">{v.promptTitle}</div>
                    <div className="sidebar__item-meta mono-label">
                      {(v.videoSeconds ?? '?')}s · {v.ratio ?? '—'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}

        <SessionCost />
      </div>
    </aside>
  );
}

function SessionCost() {
  const jobs = useStore(s => s.videoJobs);
  const done = jobs.filter(j => j.phase === 'done' && j.estimatedUsd != null);
  if (done.length === 0) return null;
  const total = done.reduce((acc, j) => acc + (j.estimatedUsd ?? 0), 0);
  return (
    <section className="sidebar__group sidebar__group--cost">
      <div className="sidebar__group-header mono-label">Session · {done.length} clip{done.length === 1 ? '' : 's'}</div>
      <div className="sidebar__cost-row mono-label">
        <span>Estimated spend</span>
        <span className="sidebar__cost-val">{formatUSD(total)}</span>
      </div>
      <div className="sidebar__cost-hint mono-label">Estimated — verify against provider billing</div>
    </section>
  );
}

// ===================== RIGHT RAIL =====================

interface VideoRightRailProps {
  sourcePath: string | null;
  endFramePath: string | null;
  /** Hide the end-frame slot for Kling models that don't support image_tail. */
  showEndFrame: boolean;
  videoRefs: VideoRef[];
  onPickSource: () => void;
  onPickSourceFromProject: () => void;
  onClearSource: () => void;
  onPickEnd: () => void;
  onPickEndFromProject: () => void;
  onClearEnd: () => void;
  onOpenRefPicker: (cat: LibCategory) => void;
  onRemoveRef: (id: string) => void;
}

function VideoRightRail({
  sourcePath, endFramePath, showEndFrame, videoRefs,
  onPickSource, onPickSourceFromProject, onClearSource,
  onPickEnd, onPickEndFromProject, onClearEnd,
  onOpenRefPicker, onRemoveRef,
}: VideoRightRailProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (cat: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    return next;
  });

  const refsByCat = useMemo(() => {
    const m = new Map<LibCategory, VideoRef[]>();
    for (const r of videoRefs) {
      const arr = m.get(r.category) || [];
      arr.push(r);
      m.set(r.category, arr);
    }
    return m;
  }, [videoRefs]);

  return (
    <aside className="right-sidebar video-rightrail video-rightrail--overlay">
      <header className="right-sidebar__header">
        <div className="right-sidebar__title">
          <span className="mono-label">Inputs</span>
          <span className="right-sidebar__count">{videoRefs.length}</span>
        </div>
      </header>

      <div className="right-sidebar__body">
        {/* Frame slots — Seedance's two real inputs */}
        <section className="layer-group video-slots">
          <header className="layer-group__header">
            <button className="layer-group__toggle">
              <span className="mono-label">Frame slots</span>
            </button>
          </header>
          <FrameSlotCard
            label="First frame"
            path={sourcePath}
            onPick={onPickSource}
            onPickFromProject={onPickSourceFromProject}
            onClear={onClearSource}
          />
          {showEndFrame && (
            <FrameSlotCard
              label="End frame"
              path={endFramePath}
              onPick={onPickEnd}
              onPickFromProject={onPickEndFromProject}
              onClear={onClearEnd}
            />
          )}
        </section>

        {/* References — only items the user has explicitly added show here */}
        {VIDEO_REF_CATEGORIES.map(cat => {
          const items = refsByCat.get(cat.id) || [];
          const isCollapsed = collapsed.has(cat.id);
          const isAudio = cat.id === 'audio';
          return (
            <section
              key={cat.id}
              className={`layer-group ${isCollapsed ? 'layer-group--collapsed' : ''}`}
            >
              <header className="layer-group__header">
                <button className="layer-group__toggle" onClick={() => toggle(cat.id)}>
                  <svg className="tree-caret" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 1.5l3 3-3 3" />
                  </svg>
                  <span className="mono-label">{cat.label}</span>
                  {items.length > 0 && <span className="layer-group__count">{items.length}</span>}
                </button>
                <button
                  className="layer-group__add"
                  onClick={(e) => { e.stopPropagation(); onOpenRefPicker(cat.id); }}
                  title={`Add ${cat.label.toLowerCase()}`}
                >+</button>
              </header>
              {!isCollapsed && isAudio && items.length > 0 && (
                <div className="video-rightrail__audiowarn mono-label">
                  ⓘ Audio files aren't sent to the model. Stored with the clip
                  for sound design / PPM handover only.
                </div>
              )}
              {!isCollapsed && items.length > 0 && (
                <div className="layer-group__items video-rightrail__grid">
                  {items.map(r => (
                    <RefThumb
                      key={r.id}
                      ref_={r}
                      isAudio={isAudio}
                      onRemove={() => onRemoveRef(r.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        <div className="right-sidebar__footnote mono-label">
          Frame slots feed the model directly. Other refs travel with the sidecar.
        </div>
      </div>
    </aside>
  );
}

function FrameSlotCard({ label, path, onPick, onPickFromProject, onClear }: {
  label: string;
  path: string | null;
  onPick: () => void;
  onPickFromProject: () => void;
  onClear: () => void;
}) {
  return (
    <div className="video-slotcard">
      <div className="video-slotcard__label mono-label">{label}</div>
      {path ? (
        <div className="video-slotcard__set">
          <img src={fileUrl(path)} alt="" className="video-slotcard__img" />
          <div className="video-slotcard__actions">
            <button onClick={onPick}>Swap</button>
            <button onClick={onPickFromProject}>Project</button>
            <button onClick={onClear}>Clear</button>
          </div>
        </div>
      ) : (
        <div className="video-slotcard__empty">
          <button onClick={onPick}>Pick file</button>
          <button onClick={onPickFromProject}>From project</button>
        </div>
      )}
    </div>
  );
}

function RefThumb({ ref_, isAudio, onRemove }: {
  ref_: VideoRef;
  isAudio: boolean;
  onRemove: () => void;
}) {
  return (
    <div className={`video-refthumb ${isAudio ? 'video-refthumb--audio' : ''}`} title={ref_.name}>
      {isAudio ? (
        <div className="video-refthumb__audio">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
          </svg>
        </div>
      ) : (
        <img src={dispSrc(ref_.thumbPath || ref_.filePath, 'thumb')} alt={ref_.name} loading="lazy" />
      )}
      <span className="video-refthumb__name">{ref_.name}</span>
      <button className="video-refthumb__remove" onClick={onRemove} title="Remove">×</button>
    </div>
  );
}

// ===================== REF PICKER MODAL =====================

function RefPickerModal({ category, library, onPick, onUploadAndPick, onClose }: {
  /** The category the [+] was clicked on — this is where the picked asset
   *  gets attached, regardless of where it lives in the Library. */
  category: LibCategory;
  library: LibraryAsset[];
  onPick: (asset: LibraryAsset) => void;
  onUploadAndPick: () => void;
  onClose: () => void;
}) {
  // Default filter to the [+]'s category, but the user can switch freely
  // to browse ANY part of the library. "All" lets them see everything.
  const [filter, setFilter] = useState<'all' | LibCategory>(category);

  const items = useMemo(() => {
    if (filter === 'all') return library;
    return library.filter(a => a.category === filter);
  }, [library, filter]);

  const catLabel = VIDEO_REF_CATEGORIES.find(c => c.id === category)?.label || category;
  const tabs: Array<{ id: 'all' | LibCategory; label: string }> = [
    { id: 'all', label: 'All' },
    ...VIDEO_REF_CATEGORIES.map(c => ({ id: c.id as 'all' | LibCategory, label: c.label })),
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 'min(1000px, 100%)', maxHeight: 'min(720px, 90vh)' }}
        onClick={e => e.stopPropagation()}
      >
        <header className="modal__header">
          <span className="mono-label">Add to {catLabel}</span>
          <button className="btn-secondary" onClick={onUploadAndPick}>Upload new</button>
          <button className="modal__close" onClick={onClose}>Close</button>
        </header>

        {/* Category tabs — browse anywhere in the library. Asset still
         *  attaches to the original {catLabel} on the right rail. */}
        <div className="ref-picker__tabs">
          {tabs.map(t => {
            const count = t.id === 'all'
              ? library.length
              : library.filter(a => a.category === t.id).length;
            return (
              <button
                key={t.id}
                className={`ref-picker__tab ${filter === t.id ? 'ref-picker__tab--active' : ''}`}
                onClick={() => setFilter(t.id)}
              >
                {t.label}
                <span className="ref-picker__tab-count">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="modal__body modal__body--padded">
          {items.length === 0 ? (
            <div className="mono-label" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-muted)' }}>
              {filter === 'all'
                ? <>Library is empty. Click <em>Upload new</em> to add a file.</>
                : <>Nothing in <em>{tabs.find(t => t.id === filter)?.label}</em>. Switch to another tab — or upload new.</>}
            </div>
          ) : (
            <div className="video-picker__grid">
              {items.map(a => (
                <button
                  key={a.id}
                  className="video-picker__card"
                  onClick={() => onPick(a)}
                  title={`${a.name} — stored as ${a.category}, will attach as ${catLabel}`}
                >
                  {a.category === 'audio' ? (
                    <div className="video-refthumb__audio" style={{ aspectRatio: 1 }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18V5l12-2v13"/>
                        <circle cx="6" cy="18" r="3"/>
                        <circle cx="18" cy="16" r="3"/>
                      </svg>
                    </div>
                  ) : (
                    <img className="video-picker__thumb" src={dispSrc(a.thumbPath || a.filePath, 'thumb')} alt="" loading="lazy" />
                  )}
                  <div className="video-picker__caption mono-label">
                    {a.name.slice(0, 48)}
                    {a.category !== category && (
                      <span className="ref-picker__source-cat"> · {a.category}</span>
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

// ===================== VIDEO LIGHTBOX (comprehensive preview) =====================
// Mirrors the Frames GenerationPreview lightbox: large player on left, side
// panel on the right with every detail from the sidecar (prompt, references,
// settings, cost, model), plus action buttons (Restore, Reveal, Delete).

interface VideoSidecarLite {
  prompt?: string;
  promptFull?: string;
  rawUserPrompt?: string;
  model?: string;
  apiModelId?: string;
  taskId?: string;
  imagePath?: string | null;
  endImagePath?: string | null;
  resolution?: string;
  duration?: number;
  ratio?: string;
  fps?: number;
  seed?: number | null;
  cameraFixed?: boolean;
  watermark?: boolean;
  audio?: boolean;
  durationMs?: number;
  videoUrl?: string;
  usage?: { completion_tokens?: number } | null;
  project?: { id: string; name: string; slug: string } | null;
  captured?: string;
  // Kling sidecar fields.
  mode?: string;
  aspectRatio?: string;
  cfgScale?: number | null;
  negativePrompt?: string | null;
  sound?: boolean;
  videoRefs?: Array<{
    id: string;
    assetId: string;
    category: string;
    filePath: string;
    thumbPath: string;
    name: string;
  }>;
  selectionsSnapshot?: Record<string, any> | null;
}

function VideoLightbox({
  entry, onClose, onRestore, onReveal, onDelete,
}: {
  entry: VideoFileEntry;
  onClose: () => void;
  onRestore: () => void;
  onReveal: () => void;
  onDelete: () => void;
}) {
  const [sidecar, setSidecar] = useState<VideoSidecarLite | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.hjen.readSidecar(entry.jsonPath).then(s => {
      if (!cancelled) setSidecar(s);
    });
    return () => { cancelled = true; };
  }, [entry.jsonPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const promptText = sidecar?.prompt || entry.promptTitle || '';
  const lbDesc = videoModelById(sidecar?.apiModelId || sidecar?.model || entry.modelLabel || '');
  const tokens = sidecar?.usage?.completion_tokens;
  const cost = lbDesc?.provider === 'kling'
    ? estimateKlingCost(lbDesc.apiModelId, (sidecar?.mode as KlingMode) ?? 'pro', sidecar?.duration ?? 5, !!sidecar?.sound)
    : estimateSeedanceCost(tokens);

  const copyPrompt = async () => {
    try {
      // Copy the FULL prompt that Seedance received (raw + DOP suffix +
      // --flags) — that's what someone reproducing the result needs.
      await navigator.clipboard.writeText(sidecar?.promptFull || promptText);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="video-lightbox" onClick={onClose}>
      <div className="video-lightbox__player-wrap" onClick={e => e.stopPropagation()}>
        <video
          className="video-lightbox__player"
          src={fileUrl(entry.imgPath)}
          controls
          autoPlay
          loop
        />
      </div>

      <aside className="video-lightbox__side" onClick={e => e.stopPropagation()}>
        <header className="video-lightbox__head">
          <div className="video-lightbox__title" dir="auto" title={promptText}>
            {(promptText.split(/[.!?\n,]/)[0] || 'Untitled').slice(0, 80)}
          </div>
          <button className="video-lightbox__close" onClick={onClose} title="Close (Esc)">×</button>
        </header>

        <div className="video-lightbox__body">
          <VLRow label="Project" value={sidecar?.project?.name || '—'} />
          <VLRow
            label="Model"
            value={sidecar?.model || entry.modelLabel || '—'}
            sub={sidecar?.apiModelId}
          />
          <VLRow
            label="Resolution"
            value={sidecar?.resolution || (sidecar?.mode ? MODE_RES[sidecar.mode as KlingMode] : undefined) || entry.size || '—'}
            sub={`${sidecar?.duration ?? entry.videoSeconds ?? '?'}s · ${sidecar?.ratio ?? sidecar?.aspectRatio ?? entry.ratio ?? '—'}${sidecar?.fps != null ? ` · ${sidecar.fps} fps` : ''}`}
          />
          {cost && (
            <VLRow
              label="Cost (est.)"
              value={`~${formatUSD(cost.usd)}`}
              sub={tokens != null ? `${tokens.toLocaleString()} tokens @ $1.50/M` : cost.breakdown}
              accent
            />
          )}
          {sidecar?.durationMs != null && (
            <VLRow label="Wall time" value={fmtMs(sidecar.durationMs)} />
          )}
          {sidecar?.taskId && (
            <VLRow label="Task ID" value={sidecar.taskId} mono />
          )}

          {/* Flags */}
          {sidecar && (sidecar.seed != null || sidecar.cameraFixed || sidecar.audio || sidecar.watermark) && (
            <section className="video-lightbox__section">
              <div className="mono-label video-lightbox__section-head">Flags</div>
              <div className="video-lightbox__flags">
                {sidecar.seed != null && <span className="video-lightbox__chip">seed {sidecar.seed}</span>}
                {sidecar.cameraFixed && <span className="video-lightbox__chip">camera-fixed</span>}
                {sidecar.audio && <span className="video-lightbox__chip">audio on</span>}
                {sidecar.watermark && <span className="video-lightbox__chip">watermark kept</span>}
              </div>
            </section>
          )}

          {/* DOP snapshot — what Cinematography chips were active. Refilled
           *  on Restore via setSelection per key. */}
          {sidecar?.selectionsSnapshot && (() => {
            const dopRows = collectDopRows(sidecar.selectionsSnapshot);
            if (dopRows.length === 0) return null;
            return (
              <section className="video-lightbox__section">
                <div className="mono-label video-lightbox__section-head">DOP · Cinematography</div>
                <div className="video-lightbox__dop">
                  {dopRows.map(([k, v]) => (
                    <div key={k} className="video-lightbox__dop-row">
                      <div className="mono-label video-lightbox__dop-key">{k}</div>
                      <div className="video-lightbox__dop-val">{v}</div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}

          {/* References — split into two groups so the user can see
           *  exactly what Seedance ate vs. what only travels with the
           *  sidecar (audio + movement aren't consumed by the model). */}
          <section className="video-lightbox__section">
            <div className="mono-label video-lightbox__section-head">References sent to the model</div>
            <div className="video-lightbox__refs">
              {sidecar?.imagePath && <RefCard label="First frame" filePath={sidecar.imagePath} />}
              {sidecar?.endImagePath && <RefCard label="End frame" filePath={sidecar.endImagePath} />}
              {!sidecar?.imagePath && !sidecar?.endImagePath && (
                <div className="video-lightbox__empty mono-label">
                  Text-to-video — no image input.
                </div>
              )}
            </div>
          </section>

          {/* Sidecar-only refs — these were attached for PPM/handover but
           *  Seedance never consumed them (its API takes only text + 1-2 images). */}
          {sidecar?.videoRefs && sidecar.videoRefs.length > 0 && (() => {
            const byCat = new Map<string, typeof sidecar.videoRefs>();
            for (const r of sidecar.videoRefs!) {
              const arr = byCat.get(r.category) || [];
              arr.push(r);
              byCat.set(r.category, arr);
            }
            return (
              <section className="video-lightbox__section">
                <div className="mono-label video-lightbox__section-head">
                  Sidecar refs · NOT sent to model
                </div>
                <div className="video-lightbox__sidecar-note mono-label">
                  The model accepts only text + first/end frame. These travel
                  with the clip for sound-design + PPM handover.
                </div>
                <div className="video-lightbox__refs">
                  {Array.from(byCat.entries()).map(([cat, refs]) => (
                    <div key={cat} className="video-lightbox__sidecar-group">
                      <div className="mono-label video-lightbox__sidecar-cat">{cat.toUpperCase()} · {refs.length}</div>
                      <div className="video-lightbox__sidecar-thumbs">
                        {refs.map(r => (
                          <div key={r.id} className="video-lightbox__sidecar-thumb" title={r.name}>
                            {cat === 'audio' ? (
                              <div className="video-refthumb__audio" style={{ width: 56, height: 56 }}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M9 18V5l12-2v13"/>
                                  <circle cx="6" cy="18" r="3"/>
                                  <circle cx="18" cy="16" r="3"/>
                                </svg>
                              </div>
                            ) : (
                              <img src={dispSrc(r.thumbPath || r.filePath, 'thumb')} alt={r.name} loading="lazy" />
                            )}
                            <div className="video-lightbox__sidecar-thumb-name mono-label">{r.name.slice(0, 24)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}

          {/* Prompts — show raw user prompt AND full assembled prompt
           *  separately. The raw is what the user typed; the full is what
           *  the model received (raw + DOP suffix + --flags). */}
          {sidecar?.rawUserPrompt && sidecar.rawUserPrompt !== sidecar.prompt && (
            <section className="video-lightbox__section">
              <div className="mono-label video-lightbox__section-head">Raw user prompt</div>
              <pre className="video-lightbox__prompt video-lightbox__prompt--raw" dir="auto">
                {sidecar.rawUserPrompt}
              </pre>
            </section>
          )}
          {promptText && (
            <section className="video-lightbox__section">
              <div className="mono-label video-lightbox__section-head video-lightbox__section-head--row">
                <span>Prompt sent to the model (full)</span>
                <button className="video-lightbox__copy" onClick={copyPrompt}>
                  {promptCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="video-lightbox__prompt" dir="auto">{sidecar?.promptFull || promptText}</pre>
            </section>
          )}

          {sidecar?.videoUrl && (
            <section className="video-lightbox__section">
              <div className="mono-label video-lightbox__section-head">Source video URL (signed, expires)</div>
              <div className="video-lightbox__source-url mono-label" title={sidecar.videoUrl}>
                {sidecar.videoUrl.slice(0, 60)}…
              </div>
            </section>
          )}
        </div>

        <footer className="video-lightbox__foot">
          <button className="video-lightbox__action" onClick={onRestore} title="Load these settings back into the form">
            Restore
          </button>
          <button className="video-lightbox__action" onClick={onReveal} title="Open the folder in Finder">
            Reveal
          </button>
          <button className="video-lightbox__action video-lightbox__action--danger" onClick={onDelete} title="Delete this video from disk">
            Delete
          </button>
        </footer>
      </aside>
    </div>
  );
}

function VLRow({ label, value, sub, mono, accent }: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="video-lightbox__row">
      <div className="mono-label video-lightbox__row-label">{label}</div>
      <div className={`video-lightbox__row-val ${mono ? 'video-lightbox__row-val--mono' : ''} ${accent ? 'video-lightbox__row-val--accent' : ''}`}>
        {value}
      </div>
      {sub && <div className="video-lightbox__row-sub mono-label">{sub}</div>}
    </div>
  );
}

function RefCard({ label, filePath }: { label: string; filePath: string }) {
  return (
    <div className="video-lightbox__refcard">
      <img
        className="video-lightbox__refthumb"
        src={fileUrl(filePath)}
        alt={label}
        loading="lazy"
      />
      <div className="video-lightbox__refbody">
        <div className="mono-label video-lightbox__refcat">{label}</div>
        <div className="video-lightbox__refpath" title={filePath}>
          {filePath.split('/').pop()}
        </div>
      </div>
    </div>
  );
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const min = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${min}m ${sec}s`;
}

// ===================== VIDEO PREVIEW MODAL (simple, for bg double-click) =====================

function VideoPreviewModal({ path, onClose }: { path: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="video-preview-backdrop" onClick={onClose}>
      <div className="video-preview-wrap" onClick={e => e.stopPropagation()}>
        <button className="video-preview-close" onClick={onClose}>× Close</button>
        <video className="video-preview-player" src={fileUrl(path)} controls autoPlay loop />
        <div className="video-preview-path mono-label">{shortenPath(path)}</div>
      </div>
    </div>
  );
}

// ===================== INSPECTOR + PROJECT FRAME PICKER =====================

function FailedVideoInspector({ failed, onRestore, onClose }: {
  failed: FailedVideoPayload;
  onRestore: (f: FailedVideoPayload) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal failed-inspector" style={{ width: 'min(900px, 100%)', maxHeight: 'min(720px, 90vh)' }} onClick={e => e.stopPropagation()}>
        <header className="modal__header">
          <span className="mono-label">Failed video · {new Date(failed.ts).toLocaleString()}</span>
          <button className="modal__close" onClick={onClose}>Close</button>
        </header>
        <div className="modal__body modal__body--padded failed-inspector__body">
          <div className="failed-inspector__title">{failed.promptTitle}</div>
          <div className="failed-inspector__meta mono-label">
            {failed.resolution} · {failed.duration}s · {failed.ratio} · {failed.fps}fps
            {failed.seed != null && ` · seed ${failed.seed}`}
            {failed.modelId && ` · ${failed.modelId}`}
          </div>
          <div className="failed-inspector__section mono-label">Error</div>
          <pre className="failed-inspector__pre">{failed.errorMessage}</pre>
          <div className="failed-inspector__section mono-label">Prompt</div>
          <pre className="failed-inspector__pre">{failed.prompt}</pre>
          {failed.imagePath && (
            <>
              <div className="failed-inspector__section mono-label">Source image</div>
              <code className="failed-inspector__code">{failed.imagePath}</code>
            </>
          )}
        </div>
        <footer className="failed-inspector__foot">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={() => onRestore(failed)}>Restore settings into Studio</button>
        </footer>
      </div>
    </div>
  );
}

function VideoFramePicker({ projects, currentSlug, files, which, onSwitchProject, onPick, onClose }: {
  projects: ProjectMeta[];
  currentSlug: string | null;
  files: ProjectFileEntry[];
  which: 'source' | 'end';
  onSwitchProject: (slug: string | null) => void;
  onPick: (entry: ProjectFileEntry) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal video-picker" style={{ width: 'min(1080px, 100%)', maxHeight: 'min(720px, 90vh)' }} onClick={e => e.stopPropagation()}>
        <header className="modal__header">
          <span className="mono-label">Pick a frame to {which === 'end' ? 'land on (last frame)' : 'animate'}</span>
          <select className="video-picker__project" value={currentSlug ?? ''} onChange={e => onSwitchProject(e.target.value || null)}>
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
          </select>
          <button className="modal__close" onClick={onClose}>Close</button>
        </header>
        <div className="video-picker__body">
          {files.length === 0 ? (
            <div className="video-picker__empty mono-label">No frames in this project yet.</div>
          ) : (
            <div className="video-picker__grid">
              {files.map(f => (
                <button key={f.imgPath} className="video-picker__card" onClick={() => onPick(f)} title={f.promptTitle}>
                  <img className="video-picker__thumb" src={dispSrc(f.thumbPath || f.imgPath, 'thumb')} alt="" loading="lazy" />
                  <div className="video-picker__caption mono-label">{f.promptTitle.slice(0, 48)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================== HELPERS =====================

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="video-control">
      <div className="mono-label video-control__label">{label}</div>
      <div className="video-control__row">{children}</div>
    </div>
  );
}

function Chip({ active, disabled, onClick, children }: { active?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button className={`video-chip ${active ? 'video-chip--active' : ''}`} disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function groupByDate<T extends { dateFolder: string }>(entries: T[]): Array<{ date: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const e of entries) {
    if (!map.has(e.dateFolder)) map.set(e.dateFolder, []);
    map.get(e.dateFolder)!.push(e);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({ date, items }));
}

function prettyDate(d: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (d === today) return 'Today';
  const yest = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
  if (d === yest) return 'Yesterday';
  return new Date(d + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function phaseLabel(phase: VideoJob['phase'], status?: string): string {
  if (phase === 'submitting') return 'Submitting task to ModelArk…';
  if (phase === 'queued') return `Queued · ${status ?? 'queued'}`;
  if (phase === 'running') return `Running · ${status ?? 'in_progress'}`;
  if (phase === 'downloading') return 'Downloading MP4…';
  if (phase === 'saving') return 'Saving to project…';
  if (phase === 'done') return 'Done.';
  if (phase === 'failed') return 'Failed';
  return 'Running…';
}

function shortenPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~');
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'bmp'];
function isImageFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTS.includes(ext);
}

// Collect human-readable rows from a serialized selections snapshot. Same
// extraction the DopSidebar uses, but flattened for the preview side panel.
function collectDopRows(snap: any): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (!snap || typeof snap !== 'object') return rows;
  if (snap.style_preset === 'MOVIE' && snap.movie) {
    const meta = [snap.movie.director, snap.movie.year].filter(Boolean).join(', ');
    rows.push(['Look (Movie)', `${snap.movie.title}${meta ? ` (${meta})` : ''}`]);
  }
  if (snap.style_preset === 'PHOTOGRAPHER' && snap.photographer) {
    rows.push(['Look (Photographer)', snap.photographer.name]);
  }
  if (snap.angle?.name) rows.push(['Perspective', snap.angle.name]);
  if (snap.camera?.name) rows.push(['Camera', snap.camera.name]);
  if (snap.lens?.name) rows.push(['Lens', snap.lens.name]);
  if (snap.focal_mm) rows.push(['Focal length', `${snap.focal_mm}mm`]);
  if (snap.aperture_f) rows.push(['Aperture', `f/${snap.aperture_f}`]);
  if (snap.stock?.name) rows.push(['Film stock', snap.stock.name]);
  if (snap.lighting?.name) rows.push(['Lighting', snap.lighting.name]);
  if (snap.movement?.name) rows.push(['Camera movement', snap.movement.name]);
  if (typeof snap.atmosphere === 'string' && snap.atmosphere.trim()) {
    rows.push(['Atmosphere', snap.atmosphere.trim()]);
  }
  return rows;
}

// ===================== DOP → prompt suffix =====================
// Seedance accepts no structured cinematography params — every camera /
// lens / stock / lighting hint travels as plain text. We assemble the
// active DOP selections into a compact descriptor that gets appended
// after the user's motion prompt. Order matters for prompt weighting:
// look-philosophy first, then technical (camera/lens/stock), then
// lighting + motion, then atmosphere as the closing note.
function buildVideoDopSuffix(s: Selections): string {
  const parts: string[] = [];

  if (s.style_preset === 'MOVIE' && s.movie) {
    const meta = [s.movie.director, s.movie.year].filter(Boolean).join(', ');
    parts.push(`In the visual style of ${s.movie.title}${meta ? ` (${meta})` : ''}.`);
  }
  if (s.style_preset === 'PHOTOGRAPHER' && s.photographer) {
    parts.push(`Visual register of ${s.photographer.name}${s.photographer.genre ? ` — ${s.photographer.genre}` : ''}.`);
  }

  if (s.angle) {
    parts.push(s.angle.description || s.angle.name);
  }

  const techParts: string[] = [];
  if (s.camera) techParts.push(`shot on ${s.camera.prompt || s.camera.name}`);
  if (s.lens) techParts.push(`${s.lens.name} lens`);
  if (s.focal_mm) techParts.push(`${s.focal_mm}mm`);
  if (s.aperture_f) techParts.push(`f/${s.aperture_f}`);
  if (s.stock) techParts.push(`on ${s.stock.name} film stock`);
  if (techParts.length) parts.push(`${techParts.join(', ')}.`);

  if (s.lighting) {
    parts.push(`Lighting: ${s.lighting.description || s.lighting.name}.`);
  }

  // Camera movement — critical for video specifically. In Frames this is
  // largely interpretive; in motion the model needs an explicit cue.
  if (s.movement) {
    // Prefer the exact AI-video trigger phrase (promptKeyword from the shared
    // lib/cameraMovements.ts) so Seedance / Kling get the matching movement cue.
    const kw = s.movement.promptKeyword;
    parts.push(`Camera movement: ${kw ? `${kw} — ${s.movement.description || s.movement.name}` : (s.movement.description || s.movement.name)}.`);
  }

  if (s.atmosphere?.trim()) {
    parts.push(`Atmosphere: ${s.atmosphere.trim()}.`);
  }

  return parts.join(' ');
}

function countActiveDopSelections(s: Selections): number {
  let n = 0;
  if (s.style_preset === 'MOVIE' && s.movie) n++;
  if (s.style_preset === 'PHOTOGRAPHER' && s.photographer) n++;
  if (s.angle) n++;
  if (s.camera) n++;
  if (s.lens) n++;
  if (s.focal_mm) n++;
  if (s.aperture_f) n++;
  if (s.stock) n++;
  if (s.lighting) n++;
  if (s.movement) n++;
  if (s.atmosphere?.trim()) n++;
  return n;
}

// Snapshot only the DOP-relevant slice (aspect/resolution/quality/model
// live in form, not DOP). Stored as plain JSON in the sidecar so older
// sidecars without this field degrade gracefully.
function serializeSelections(s: Selections): Record<string, any> {
  return {
    style_preset: s.style_preset,
    movie: s.movie,
    photographer: s.photographer,
    angle: s.angle,
    camera: s.camera,
    lens: s.lens,
    focal_mm: s.focal_mm,
    aperture_f: s.aperture_f,
    stock: s.stock,
    lighting: s.lighting,
    movement: s.movement,
    atmosphere: s.atmosphere,
  };
}

function restoreSelections(snapshot: any, setSelection: <K extends keyof Selections>(k: K, v: Selections[K]) => void) {
  if (!snapshot || typeof snapshot !== 'object') return;
  const keys: (keyof Selections)[] = [
    'style_preset', 'movie', 'photographer', 'angle',
    'camera', 'lens', 'focal_mm', 'aperture_f',
    'stock', 'lighting', 'movement', 'atmosphere',
  ];
  for (const k of keys) {
    if (k in snapshot) {
      try { setSelection(k as any, snapshot[k]); } catch {}
    }
  }
}
