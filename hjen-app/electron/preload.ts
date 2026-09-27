import { contextBridge, ipcRenderer, webUtils } from 'electron';

/** Which side of the title bar macOS put the window buttons on — decided in
 *  MAIN from the system language and handed over as a launch argument, so the
 *  renderer can reserve the gutter on the correct side at first paint rather
 *  than after a round trip. Defaults to 'left', which is every LTR Mac. */
const trafficLights =
  (process.argv.find(a => a.startsWith('--hjen-traffic-lights=')) || '').split('=')[1] === 'right'
    ? 'right' : 'left';

/** Launch flags, read synchronously so the renderer can branch on the FIRST
 *  frame. A detached panel window that had to ASK main what it is would paint
 *  one frame of the full studio shell before swapping. */
const argFlag = (name: string): string =>
  (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');

contextBridge.exposeInMainWorld('hjen', {
  /** Native window chrome the CSS has to lay out around, plus what this window
   *  was launched to BE: '' = the full studio, otherwise a bare panel. */
  chrome: {
    trafficLights,
    role: argFlag('hjen-window'),
    docId: argFlag('hjen-doc'),
    projectId: argFlag('hjen-project'),
  },
  // Cloud gateway (invite link) — the packaged app's opt-in to server-side keys
  getGateway: () => ipcRenderer.invoke('hjen:get-gateway'),
  setGateway: (cfg: { url: string; token: string } | null) => ipcRenderer.invoke('hjen:set-gateway', cfg),
  // API keys
  getApiKey: () => ipcRenderer.invoke('hjen:get-api-key'),
  setApiKey: (key: string) => ipcRenderer.invoke('hjen:set-api-key', key),
  getGoogleKey: () => ipcRenderer.invoke('hjen:get-google-key'),
  setGoogleKey: (key: string) => ipcRenderer.invoke('hjen:set-google-key', key),
  getAnthropicKey: () => ipcRenderer.invoke('hjen:get-anthropic-key'),
  setAnthropicKey: (key: string) => ipcRenderer.invoke('hjen:set-anthropic-key', key),
  getReplicateKey: () => ipcRenderer.invoke('hjen:get-replicate-key'),
  setReplicateKey: (key: string) => ipcRenderer.invoke('hjen:set-replicate-key', key),
  getArkKey: () => ipcRenderer.invoke('hjen:get-ark-key'),
  setArkKey: (key: string) => ipcRenderer.invoke('hjen:set-ark-key', key),

  // In-app Assistant (MCP surface ②)
  assistantTurn: (args: { message: string; history?: any[]; context?: any }) => ipcRenderer.invoke('hjen:assistant-turn', args),
  // Persistent Assistant conversations (general or project-linked) — disk store
  // shared with external agents (hjen_conversations_* MCP tools).
  conversationsList: (args?: { projectSlug?: string }) => ipcRenderer.invoke('hjen:conversations-list', args),
  conversationRead: (args: { id: string; kind?: string; projectSlug?: string }) => ipcRenderer.invoke('hjen:conversation-read', args),
  conversationWrite: (convo: any) => ipcRenderer.invoke('hjen:conversation-write', convo),
  conversationDelete: (args: { id: string }) => ipcRenderer.invoke('hjen:conversation-delete', args),
  onAssistantEvent: (cb: (e: any) => void) => {
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('hjen:assistant-event', h);
    return () => ipcRenderer.removeListener('hjen:assistant-event', h);
  },

  // Deep-link navigation + live hot-reload (hjen-studio:// + control port)
  onNavigate: (cb: (d: { projectId: string | null; view: string; entity?: string }) => void) => {
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('hjen:navigate', h);
    return () => ipcRenderer.removeListener('hjen:navigate', h);
  },
  onReload: (cb: (d: { projectId: string | null; kind: string }) => void) => {
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('hjen:reload', h);
    return () => ipcRenderer.removeListener('hjen:reload', h);
  },

  // Auto-update (Claude-style): a new version is downloaded silently in the
  // background; onUpdateReady fires so the renderer shows a live "Restart to
  // update" badge, and restartToUpdate applies it immediately.
  onUpdateReady: (cb: (d: { version: string }) => void) => {
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('hjen:update-ready', h);
    return () => ipcRenderer.removeListener('hjen:update-ready', h);
  },
  onUpdateDownloading: (cb: (d: { version: string }) => void) => {
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('hjen:update-downloading', h);
    return () => ipcRenderer.removeListener('hjen:update-downloading', h);
  },
  restartToUpdate: () => ipcRenderer.invoke('hjen:restart-to-update'),
  // The user asking, rather than waiting for the automatic check.
  checkForUpdates: () => ipcRenderer.invoke('hjen:check-for-updates'),
  onUpdateProgress: (cb: (d: { percent: number }) => void) => {
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('hjen:update-progress', h);
    return () => ipcRenderer.removeListener('hjen:update-progress', h);
  },

  // Command bridge — the MCP DRIVES a real app action; the renderer runs it and
  // answers back so the MCP gets the result. (MCP→app: onCommand; app→MCP: respondCommand.)
  onCommand: (cb: (d: { requestId: string; action: string; args: any }) => void) => {
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('hjen:command', h);
    return () => ipcRenderer.removeListener('hjen:command', h);
  },
  respondCommand: (requestId: string, result: any) => ipcRenderer.send('hjen:command-result', { requestId, result }),

  // MCP Hub — Connect (surface ①) + External servers (surface ③)
  mcpEndpointConfig: () => ipcRenderer.invoke('hjen:mcp-endpoint-config'),
  mcpListServers: () => ipcRenderer.invoke('hjen:mcp-list-servers'),
  mcpSetServers: (servers: any[]) => ipcRenderer.invoke('hjen:mcp-set-servers', servers),

  // Pricing config — vendor-rate overrides + margin/discount (dashboard).
  getPricingConfig: () => ipcRenderer.invoke('hjen:get-pricing-config'),
  setPricingConfig: (config: any) => ipcRenderer.invoke('hjen:set-pricing-config', config),

  // Theme / appearance config — active theme id + custom themes + import/export.
  getThemeConfig: () => ipcRenderer.invoke('hjen:get-theme-config'),
  setThemeConfig: (config: any) => ipcRenderer.invoke('hjen:set-theme-config', config),
  exportTheme: (args: { theme: any; suggestedName?: string }) => ipcRenderer.invoke('hjen:export-theme', args),
  importTheme: () => ipcRenderer.invoke('hjen:import-theme'),

  // Background-jobs log — crash/quit resilience for the operations subsystem.
  jobsRead: () => ipcRenderer.invoke('hjen:jobs-read'),
  jobsWrite: (payload: { jobs: unknown[] }) => ipcRenderer.invoke('hjen:jobs-write', payload),
  pickImage: (args?: { title?: string }) => ipcRenderer.invoke('hjen:pick-image', args),

  // HJEN SET (world builder) — image → depth-world source, + Angle Pack save
  worldDepth: (args: { imagePath: string; size?: number }) => ipcRenderer.invoke('hjen:world-depth', args),
  emulsionDefocus: (args: { imagePath: string; focus: 'auto' | number; aperture: number; haze: number }) => ipcRenderer.invoke('hjen:emulsion-defocus', args),
  worldPackSave: (args: { dir: string; packId?: string; pngDataUrl: string; camera: any; prompt: string }) => ipcRenderer.invoke('hjen:world-pack-save', args),
  // Film Space — persist a full Angle Pack (plate + depth + outline + pose + camera.json + prompt + optional MOVE preview clip).
  filmspacePackSave: (args: { dir: string; packId?: string; plate: string; depth?: string; outline?: string; pose?: string; camera: any; prompt: string; clip?: string; clipMime?: string; sessionId?: string; projectSlug?: string }) => ipcRenderer.invoke('hjen:filmspace-pack-save', args),
  // Film Space — saved sessions (per project): full stage snapshot + its locked packs.
  filmspaceSessionSave: (args: { projectSlug?: string; sessionId?: string; name: string; state: unknown; thumbnail?: string }) => ipcRenderer.invoke('hjen:filmspace-session-save', args),
  filmspaceSessionsList: (args: { projectSlug?: string }) => ipcRenderer.invoke('hjen:filmspace-sessions-list', args),
  filmspaceSessionGet: (args: { projectSlug?: string; sessionId: string }) => ipcRenderer.invoke('hjen:filmspace-session-get', args),
  filmspaceSessionDelete: (args: { projectSlug?: string; sessionId: string }) => ipcRenderer.invoke('hjen:filmspace-session-delete', args),
  filmspacePresetsSave: (args: { items: { id: string; dataUrl: string }[] }) => ipcRenderer.invoke('hjen:filmspace-presets-save', args),
  filmspacePresetsList: () => ipcRenderer.invoke('hjen:filmspace-presets-list'),
  filmspacePoseDir: () => ipcRenderer.invoke('hjen:filmspace-pose-dir'),
  // Film Space — single-image body recovery (HMR2.0 / SMPL) in a Python sidecar.
  filmspacePoseHmr: (args: { imagePath: string }) => ipcRenderer.invoke('hjen:filmspace-pose-hmr', args),
  onFilmspacePoseProgress: (h: (e: any, data: any) => void) => {
    ipcRenderer.on('hjen:filmspace-pose-progress', h);
    return () => ipcRenderer.removeListener('hjen:filmspace-pose-progress', h);
  },
  filmspacePacksList: (args: { projectSlug?: string }) => ipcRenderer.invoke('hjen:filmspace-packs-list', args),
  worldFinish: (args: { platePath: string; outDir: string; quality?: string }) => ipcRenderer.invoke('hjen:world-finish', args),
  onWorldProgress: (h: (e: any, data: any) => void) => {
    ipcRenderer.on('hjen:world-progress', h);
    return () => ipcRenderer.removeListener('hjen:world-progress', h);
  },

  // Replicate proxy — see main.ts for the polling pipeline
  replicateRun: (args: { model: string; version?: string; input: Record<string, any>; pollIntervalMs?: number; maxWaitMs?: number }) =>
    ipcRenderer.invoke('hjen:replicate-run', args),
  fetchUrlBase64: (url: string) =>
    ipcRenderer.invoke('hjen:fetch-url-base64', url),

  // Reference hunt — visible browser window (persist:refhunt session)
  refHuntOpen: (args: { url: string; hidden?: boolean }) => ipcRenderer.invoke('hjen:refhunt-open', args),
  refHuntRead: () => ipcRenderer.invoke('hjen:refhunt-read'),
  refHuntDownload: (args: { url: string; projectSlug?: string | null; fileName: string; subfolder?: string; referer?: string }) =>
    ipcRenderer.invoke('hjen:refhunt-download', args),
  refHuntCapture: (args: { src: string; projectSlug?: string | null; fileName: string; subfolder?: string }) =>
    ipcRenderer.invoke('hjen:refhunt-capture', args),

  // Generic per-project JSON sidecar (Creative 360 POV, and any cross-tool doc)
  projectDocRead: (args: { id: string; name: string }) => ipcRenderer.invoke('hjen:project-doc-read', args),
  projectDocWrite: (args: { id: string; name: string; data: unknown }) => ipcRenderer.invoke('hjen:project-doc-write', args),
  referenceDeckImport: (args: { projectId: string; sourcePath?: string }) => ipcRenderer.invoke('hjen:reference-deck-import', args),
  referenceSceneImport: (args: {
    projectId: string; sourcePath?: string; sourceKind?: 'reference' | 'generation' | 'device';
    sourceId?: string; name?: string;
  }) => ipcRenderer.invoke('hjen:reference-scene-import', args),
  referenceSceneUnderstand: (args: {
    rawText: string; imagePath: string; page?: number; sceneTitle?: string;
    intentReferences?: Array<{ imagePath: string; label: string; sourceKind: 'reference' | 'generation' | 'device' }>;
    visualRead?: unknown; slots?: unknown;
  }) => ipcRenderer.invoke('hjen:reference-scene-understand', args),
  referenceSceneDrift: (args: {
    sourcePath: string; takePath: string; keepItems: unknown[]; changeItems: unknown[];
    dna?: unknown; dop?: unknown;
  }) => ipcRenderer.invoke('hjen:reference-scene-drift', args),
  referenceSceneReviseContract: (args: {
    directorNote: string; reviewNote: string; sourcePath: string; takePath?: string;
    currentContract: unknown; drift?: unknown;
    references?: Array<{ imagePath: string; label: string; sourceKind: string }>;
  }) => ipcRenderer.invoke('hjen:reference-scene-revise-contract', args),

  // Creative Mind — Zettel memory (fleeting notes, per-user cross-project)
  mindNotesRead: () => ipcRenderer.invoke('hjen:mind-notes-read'),
  mindNotesWrite: (args: { notes: unknown[] }) => ipcRenderer.invoke('hjen:mind-notes-write', args),
  // Resolve board frame ids → saved image paths (legacy answers lack refPaths)
  mindBoardPaths: (args: { ids: string[] }) => ipcRenderer.invoke('hjen:mind-board-paths', args),
  // Ad Breakdown 360 — installed breakdowns + My Mind (curated pipeline DNA)
  mindBreakdownsList: () => ipcRenderer.invoke('hjen:mind-breakdowns-list'),
  mindBreakdownRead: (args: { slug: string }) => ipcRenderer.invoke('hjen:mind-breakdown-read', args),
  mindBreakdownApprove: (args: { slug: string; approved: boolean }) => ipcRenderer.invoke('hjen:mind-breakdown-approve', args),
  mindBreakdownRename: (args: { slug: string; title: string }) => ipcRenderer.invoke('hjen:mind-breakdown-rename', args),
  mindBreakdownDelete: (args: { slug: string }) => ipcRenderer.invoke('hjen:mind-breakdown-delete', args),
  mindBreakdownExportPdf: (args: { slug: string }) => ipcRenderer.invoke('hjen:mind-breakdown-export-pdf', args),
  mindBreakdownDnaList: (args: { slug: string }) => ipcRenderer.invoke('hjen:mind-breakdown-dna-list', args),
  mindBreakdownDnaRead: (args: { slug: string; axis: string }) => ipcRenderer.invoke('hjen:mind-breakdown-dna-read', args),
  mindBreakdownDnaWrite: (args: { slug: string; axis: string; text: string }) => ipcRenderer.invoke('hjen:mind-breakdown-dna-write', args),
  mindBreakdownWriteArabic: (args: { slug: string; data: unknown }) => ipcRenderer.invoke('hjen:mind-breakdown-write-arabic', args),
  // BREAKDOWN run pipeline (native side): ingest → (renderer LLM passes) → write.
  breakdownIngest: (args: { runId: string; url?: string; filePath?: string; slug?: string }) =>
    ipcRenderer.invoke('hjen:breakdown-ingest', args),
  breakdownCancel: (args: { runId: string }) => ipcRenderer.invoke('hjen:breakdown-cancel', args),
  mindBreakdownWrite: (args: { slug: string; breakdown: unknown }) => ipcRenderer.invoke('hjen:mind-breakdown-write', args),
  // ASR / transcription — the BREAKDOWN dialogue layer (swappable engine).
  breakdownTranscribe: (args: { runId?: string; audioPath: string; config?: unknown }) => ipcRenderer.invoke('hjen:breakdown-transcribe', args),
  transcriptionConfigRead: () => ipcRenderer.invoke('hjen:transcription-config-read'),
  transcriptionConfigWrite: (args: { config: unknown }) => ipcRenderer.invoke('hjen:transcription-config-write', args),
  // Precise shot resolver — dense frames + cut candidates for one scene window.
  breakdownDenseFrames: (args: { runId?: string; slug: string; videoPath?: string; tcIn: number; tcOut: number; fps?: number }) => ipcRenderer.invoke('hjen:breakdown-dense-frames', args),
  // Run-state checkpoint — mid-run save so an interrupted run can RESUME.
  breakdownRunstateWrite: (args: { slug: string; state: unknown }) => ipcRenderer.invoke('hjen:breakdown-runstate-write', args),
  breakdownRunstateRead: (args: { slug: string }) => ipcRenderer.invoke('hjen:breakdown-runstate-read', args),
  breakdownRunstateClear: (args: { slug: string }) => ipcRenderer.invoke('hjen:breakdown-runstate-clear', args),
  onBreakdownProgress: (h: (e: any, data: any) => void) => {
    ipcRenderer.on('hjen:breakdown-progress', h);
    return () => ipcRenderer.removeListener('hjen:breakdown-progress', h);
  },
  // Models per task — Settings → Models dashboard + the one text-LLM door
  modelsConfigRead: () => ipcRenderer.invoke('hjen:models-config-read'),
  modelsConfigWrite: (args: { config: unknown }) => ipcRenderer.invoke('hjen:models-config-write', args),
  // لغة العرض — content display language (en | ar | both)
  langModeGet: () => ipcRenderer.invoke('hjen:lang-mode-get'),
  langModeSet: (args: { mode: string }) => ipcRenderer.invoke('hjen:lang-mode-set', args),
  llmJson: (args: { provider: string; model: string; system: string; prompt: string; maxTokens?: number; imagePaths?: string[]; jsonMode?: boolean }) =>
    ipcRenderer.invoke('hjen:llm-json', args),
  myMindRead: () => ipcRenderer.invoke('hjen:my-mind-read'),
  myMindWrite: (args: { items: unknown[] }) => ipcRenderer.invoke('hjen:my-mind-write', args),
  mindBraincardsRead: () => ipcRenderer.invoke('hjen:mind-braincards-read'),
  mindBraincardsWrite: (args: { cards: unknown[] }) => ipcRenderer.invoke('hjen:mind-braincards-write', args),
  // Any-file picker for the thinking canvas (documents / decks / media)
  pickAnyFiles: (args?: { title?: string }) => ipcRenderer.invoke('hjen:pick-any-files', args),

  // Real-browser hunt — launch the user's Chrome (dedicated HJEN profile, their
  // Frameset login persists), driven over CDP from the renderer.
  chromeLaunch: (args: { url: string; headless?: boolean }) => ipcRenderer.invoke('hjen:chrome-launch', args),
  chromePage: (args: { port?: number; url?: string }) => ipcRenderer.invoke('hjen:chrome-page', args),
  chromeNewTab: (args: { port?: number; url?: string }) => ipcRenderer.invoke('hjen:chrome-new-tab', args),
  chromeCloseTab: (args: { port?: number; targetId: string }) => ipcRenderer.invoke('hjen:chrome-close-tab', args),
  chromeClose: () => ipcRenderer.invoke('hjen:chrome-close'),
  saveImageBase64: (args: { base64: string; projectSlug?: string | null; fileName: string; subfolder?: string }) =>
    ipcRenderer.invoke('hjen:save-image-base64', args),
  refHuntClose: () => ipcRenderer.invoke('hjen:refhunt-close'),

  /** Native OS file drag — the only way to hand a real FILE to Finder, or to
   *  another window of this app. Call from onDragStart AFTER e.preventDefault(),
   *  and never await it in a way that blocks the gesture: it resolves only when
   *  the drag ENDS. */
  startDrag: (paths: string[]) => ipcRenderer.invoke('hjen:start-drag', { paths }),

  // ── Panel documents (Mood Board · Timeline) — one store, two features ──
  //    kind is 'moodboard' | 'timeline'; each gets its own project sidecar.
  docList: (args: { id: string; kind: string }) => ipcRenderer.invoke('hjen:doc-list', args),
  docRead: (args: { id: string; kind: string; docId: string }) => ipcRenderer.invoke('hjen:doc-read', args),
  docWrite: (args: { id: string; kind: string; docId: string; doc: unknown; sourceId?: string; allowEmpty?: boolean }) =>
    ipcRenderer.invoke('hjen:doc-write', args),
  docCreate: (args: { id: string; kind: string; name?: string; doc?: unknown }) =>
    ipcRenderer.invoke('hjen:doc-create', args),
  docDelete: (args: { id: string; kind: string; docId: string }) => ipcRenderer.invoke('hjen:doc-delete', args),
  docImport: (args: { id: string; kind: string; paths: string[] }) => ipcRenderer.invoke('hjen:doc-import', args),
  onDocChanged: (cb: (d: { projectId: string; kind: string; docId: string; sourceId: string; rev: number }) => void) => {
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('hjen:doc-changed', h);
    return () => ipcRenderer.removeListener('hjen:doc-changed', h);
  },

  // ── Detached panel windows ──
  panelOpen: (args: { kind: string; id: string; docId: string; name?: string }) =>
    ipcRenderer.invoke('hjen:panel-open', args),
  panelClose: (args: { kind: string; id: string; docId: string }) => ipcRenderer.invoke('hjen:panel-close', args),
  panelList: () => ipcRenderer.invoke('hjen:panel-list'),
  onPanelWindow: (cb: (d: { projectId: string; kind: string; docId: string; open: boolean }) => void) => {
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('hjen:panel-window', h);
    return () => ipcRenderer.removeListener('hjen:panel-window', h);
  },

  /** One cheap ffmpeg read: duration, dimensions, fps, and whether the file
   *  carries an audio stream. Optionally grabs a poster frame for a video. */
  mediaProbe: (args: { path: string; poster?: boolean }) => ipcRenderer.invoke('hjen:media-probe', args),

  // ── Sequence export (the References timeline) ──
  exportSequenceMp4: (args: unknown) => ipcRenderer.invoke('hjen:export-sequence-mp4', args),
  exportSequenceFcpxml: (args: unknown) => ipcRenderer.invoke('hjen:export-sequence-fcpxml', args),
  exportCancel: () => ipcRenderer.invoke('hjen:export-cancel'),
  onExportProgress: (cb: (d: { pct: number; secs: number; total: number }) => void) => {
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('hjen:export-progress', h);
    return () => ipcRenderer.removeListener('hjen:export-progress', h);
  },

  // Seedance 2.0 (BytePlus ModelArk) — submit task + poll until ready.
  // Renderer drives the polling loop so the UI can show live status.
  seedanceSubmit: (args: {
    prompt: string;
    imagePath?: string | null;
    endImagePath?: string | null;
    resolution: '480p' | '720p' | '1080p' | '4k';
    duration: number;
    ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
    fps: number;
    seed?: number | null;
    cameraFixed?: boolean;
    watermark?: boolean;
    audio?: boolean;
    modelId?: string;
  }) => ipcRenderer.invoke('hjen:seedance-submit', args),
  seedancePoll: (args: { taskId: string }) => ipcRenderer.invoke('hjen:seedance-poll', args),

  // Kling video (Kuaishou) — second video backend. Structured JSON body,
  // static API-Key auth, text2video/image2video routes. Response is normalised
  // to Seedance's shape so the renderer reuses one poll loop.
  getKlingKey: () => ipcRenderer.invoke('hjen:get-kling-key'),
  setKlingKey: (key: string) => ipcRenderer.invoke('hjen:set-kling-key', key),
  klingSubmit: (args: {
    prompt: string;
    negativePrompt?: string;
    imagePath?: string | null;
    endImagePath?: string | null;
    modelName: string;
    mode?: 'std' | 'pro' | '4k';
    aspectRatio?: '16:9' | '9:16' | '1:1';
    duration?: number;
    cfgScale?: number | null;
    cameraType?: string | null;
    cameraConfig?: Record<string, number> | null;
    sound?: boolean;
    watermark?: boolean;
    externalTaskId?: string;
  }) => ipcRenderer.invoke('hjen:kling-submit', args),
  klingPoll: (args: { taskId: string; videoType?: 'text2video' | 'image2video' }) =>
    ipcRenderer.invoke('hjen:kling-poll', args),
  saveVideo: (args: {
    base64: string;
    sidecar: any;
    promptSlug: string;
    projectSlug?: string;
    projectId?: string;
    posterPath?: string | null;
  }) => ipcRenderer.invoke('hjen:save-video', args),
  listProjectVideos: (args: { projectSlug?: string | null }) =>
    ipcRenderer.invoke('hjen:list-project-videos', args),
  saveFailedVideo: (args: { id: string; payload: any }) =>
    ipcRenderer.invoke('hjen:save-failed-video', args),
  listFailedVideos: () => ipcRenderer.invoke('hjen:list-failed-videos'),
  deleteFailedVideo: (args: { id: string }) =>
    ipcRenderer.invoke('hjen:delete-failed-video', args),

  // Claude-powered prompt enhancement (vision)
  enhancePrompt: (args: {
    rawPrompt: string;
    references: Array<{
      filePath: string;
      category: string;
      name: string;
      customName?: string;
      parentName?: string;
    }>;
    // Technical settings the user picked via app chips. Claude reads these
    // and ensures its rewrite is compatible (e.g. doesn't describe a wide
    // street if perspective is "extreme close-up").
    settings?: {
      angle?: { name: string; description?: string } | null;
      camera?: { name: string; prompt?: string } | null;
      lens?: { name: string; note?: string } | null;
      stock?: { name: string; usage?: string } | null;
      lighting?: { name: string; description?: string } | null;
      movement?: { name: string; description?: string } | null;
      focal_mm?: number | null;
      aperture_f?: number | null;
      aspect?: string;
      stylePreset?: 'NONE' | 'MOVIE' | 'PHOTOGRAPHER';
      movie?: { title: string; director?: string | null; year?: string | number; type?: string } | null;
      photographer?: { name: string; notes?: string; genre?: string } | null;
      atmosphere?: string;
    };
    projectId?: string | null;
    projectSlug?: string | null;
    projectName?: string | null;
  }) => ipcRenderer.invoke('hjen:enhance-prompt', args),
  listEnhancements: () => ipcRenderer.invoke('hjen:list-enhancements'),

  // Node graph persistence (Studio Node canvas)
  readGraph: (args: { id: string; scope?: 'node' | 'space' }) => ipcRenderer.invoke('hjen:read-graph', args),
  writeGraph: (args: { id: string; doc: any; allowEmpty?: boolean; scope?: 'node' | 'space' }) =>
    ipcRenderer.invoke('hjen:write-graph', args),
  exportTimelineMp4: (args: { clips: any[]; width: number; height: number; fps: number; projectName?: string }) =>
    ipcRenderer.invoke('hjen:export-timeline-mp4', args),
  exportTimelineFcpxml: (args: { clips: any[]; width: number; height: number; fps: number; projectName?: string }) =>
    ipcRenderer.invoke('hjen:export-timeline-fcpxml', args),

  // Support inbox — in-app tickets, no email
  submitSupport: (args: { kind: string; message: string; user?: any; context?: any }) =>
    ipcRenderer.invoke('hjen:submit-support', args),
  listSupport: () => ipcRenderer.invoke('hjen:list-support'),

  // Pending-job crash-recovery
  savePendingJob: (args: { id: string; payload: any }) =>
    ipcRenderer.invoke('hjen:save-pending-job', args),
  clearPendingJob: (args: { id: string }) =>
    ipcRenderer.invoke('hjen:clear-pending-job', args),
  listPendingJobs: () => ipcRenderer.invoke('hjen:list-pending-jobs'),

  // Failed-job debug history (API rejections, network errors, etc.)
  saveFailedJob: (args: { id: string; payload: any }) =>
    ipcRenderer.invoke('hjen:save-failed-job', args),
  listFailedJobs: () => ipcRenderer.invoke('hjen:list-failed-jobs'),
  deleteFailedJob: (args: { id: string }) =>
    ipcRenderer.invoke('hjen:delete-failed-job', args),

  // Projects
  getProjects: () => ipcRenderer.invoke('hjen:get-projects'),
  setLastProjectId: (id: string | null) => ipcRenderer.invoke('hjen:set-last-project-id', id),
  createProject: (args: { name: string }) => ipcRenderer.invoke('hjen:create-project', args),
  deleteProject: (args: { id: string; deleteFiles?: boolean }) => ipcRenderer.invoke('hjen:delete-project', args),
  renameProject: (args: { id: string; name: string }) => ipcRenderer.invoke('hjen:rename-project', args),
  setProjectCover: (args: { id: string; imgPath: string | null }) => ipcRenderer.invoke('hjen:set-project-cover', args),

  // Per-project pipeline state (8-stage workspace)
  readProjectState: (args: { id: string }) => ipcRenderer.invoke('hjen:read-project-state', args),
  writeProjectState: (args: { id: string; state: any }) => ipcRenderer.invoke('hjen:write-project-state', args),
  readStageData: (args: { id: string; stage: number }) => ipcRenderer.invoke('hjen:read-stage-data', args),
  writeStageData: (args: { id: string; stage: number; data: unknown; markdown?: string }) =>
    ipcRenderer.invoke('hjen:write-stage-data', args),

  // Storyboard product (own sidecar, independent of the 8-stage pipeline)
  readStoryboard: (args: { id: string }) => ipcRenderer.invoke('hjen:read-storyboard', args),
  writeStoryboard: (args: { id: string; data: unknown; allowEmpty?: boolean }) => ipcRenderer.invoke('hjen:write-storyboard', args),
  listStoryboardBackups: (args: { id: string }) => ipcRenderer.invoke('hjen:list-storyboard-backups', args),
  restoreStoryboardBackup: (args: { id: string; file: string }) => ipcRenderer.invoke('hjen:restore-storyboard-backup', args),
  readBoardLooks: () => ipcRenderer.invoke('hjen:read-board-looks'),
  writeBoardLooks: (args: { looks: unknown[] }) => ipcRenderer.invoke('hjen:write-board-looks', args),
  claudeJson: (args: { system: string; prompt: string; maxTokens?: number; imagePath?: string; imagePaths?: string[] }) =>
    ipcRenderer.invoke('hjen:claude-json', args),
  exportStoryboard: (args: { folder: string; pdfBase64: string; panels: Array<{ srcPath: string; fileName: string }>; fileName?: string }) =>
    ipcRenderer.invoke('hjen:export-storyboard', args),
  exportReferences: (args: {
    folder: string;
    baseName?: string;
    subfolder?: boolean;
    files?: Array<{ srcPath: string; fileName: string }>;
    pdfBase64?: string | null;
    notesCsv?: string | null;
  }) => ipcRenderer.invoke('hjen:export-references', args),
  pitchPdf: (args: { htmlPath: string; widthMm: number; heightMm: number }) =>
    ipcRenderer.invoke('hjen:pitch-pdf', args),
  exportFile: (args: { folder: string; fileName: string; base64: string }) =>
    ipcRenderer.invoke('hjen:export-file', args),
  projectToolDir: (args: { projectSlug?: string; tool: string }) =>
    ipcRenderer.invoke('hjen:project-tool-dir', args),
  fontsDir: () => ipcRenderer.invoke('hjen:fonts-dir'),
  listFonts: () => ipcRenderer.invoke('hjen:list-fonts'),
  addFonts: () => ipcRenderer.invoke('hjen:add-fonts'),
  removeFont: (file: string) => ipcRenderer.invoke('hjen:remove-font', { file }),
  openFontsDir: () => ipcRenderer.invoke('hjen:open-fonts-dir'),
  pickExportFolder: (args: { projectSlug?: string; tool?: string; title?: string }) => ipcRenderer.invoke('hjen:pick-export-folder', args),
  saveStoryboardImage: (args: { base64: string; sidecar: any; promptSlug: string; projectSlug?: string }) =>
    ipcRenderer.invoke('hjen:save-storyboard-image', args),

  getProjectsRoot: () => ipcRenderer.invoke('hjen:get-projects-root'),
  setProjectsRoot: (root: string) => ipcRenderer.invoke('hjen:set-projects-root', root),
  pickFolder: () => ipcRenderer.invoke('hjen:pick-folder'),

  // Save + Finder
  saveGeneration: (args: {
    base64: string;
    sidecar: any;
    promptSlug: string;
    projectSlug?: string;
    projectId?: string;
  }) => ipcRenderer.invoke('hjen:save-generation', args),

  // Emulsion (Camera Body × Lens × Film) — dedicated global home.
  saveEmulsion: (args: { base64: string; compareBase64?: string; camera: any; scene?: any; sourcePath?: string; sourceName?: string }) =>
    ipcRenderer.invoke('hjen:save-emulsion', args),
  emulsionDepth: (args: { imagePath: string }) => ipcRenderer.invoke('hjen:emulsion-depth', args),
  emulsionDepthPro: (args: { imagePath: string }) => ipcRenderer.invoke('hjen:emulsion-depthpro', args),
  emulsionSegment: (args: { imagePath: string }) => ipcRenderer.invoke('hjen:emulsion-segment', args),
  listEmulsion: () => ipcRenderer.invoke('hjen:list-emulsion'),
  // Emulsion Video — same look pipeline applied to a whole clip (long-running).
  emulsionVideo: (args: { videoPath: string; choice: any; skin?: number; sky?: number; maxw?: number }) =>
    ipcRenderer.invoke('hjen:emulsion-video', args),
  onEmulsionVideoProgress: (h: (e: any, data: { i: number; n: number }) => void) => {
    ipcRenderer.on('hjen:emulsion-video-progress', h);
    return () => ipcRenderer.removeListener('hjen:emulsion-video-progress', h);
  },
  videoFirstFrame: (args: { videoPath: string }) => ipcRenderer.invoke('hjen:video-first-frame', args),

  openFolder: (path: string) => ipcRenderer.invoke('hjen:open-folder', path),
  revealInFinder: (path: string) => ipcRenderer.invoke('hjen:reveal-in-finder', path),
  downloadGeneration: (a: { filePath: string; name?: string }) => ipcRenderer.invoke('hjen:download-generation', a),

  // Cloud-first sync (desktop mirrors the account's cloud deliverables to a folder).
  syncGetConfig: () => ipcRenderer.invoke('hjen:sync-get-config'),
  syncSetEnabled: (enabled: boolean) => ipcRenderer.invoke('hjen:sync-set-enabled', enabled),
  syncPickFolder: () => ipcRenderer.invoke('hjen:sync-pick-folder'),
  syncPullNow: () => ipcRenderer.invoke('hjen:sync-pull-now'),
  onSyncProgress: (cb: (d: { downloaded: number; deleted: number; uploaded?: number; cursor: number; label: string }) => void) => {
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('hjen:sync-progress', h);
    return () => ipcRenderer.removeListener('hjen:sync-progress', h);
  },
  openInBrowser: (path: string) => ipcRenderer.invoke('hjen:open-in-browser', path),
  moveGeneration: (args: { imgPath: string; targetProjectSlug: string | null; targetProjectId?: string | null }) =>
    ipcRenderer.invoke('hjen:move-generation', args),
  deleteGeneration: (args: { imgPath: string }) =>
    ipcRenderer.invoke('hjen:delete-generation', args),

  // Browse past generations
  listProjectFiles: (args: { projectSlug?: string | null }) =>
    ipcRenderer.invoke('hjen:list-project-files', args),
  listAllGenerations: () => ipcRenderer.invoke('hjen:list-all-generations'),
  listGenerationsLog: () => ipcRenderer.invoke('hjen:list-generations-log'),
  readSidecar: (jsonPath: string) => ipcRenderer.invoke('hjen:read-sidecar', jsonPath),
  readImageDataUrl: (imgPath: string) => ipcRenderer.invoke('hjen:read-image-data-url', imgPath),
  readImageUploadDataUrl: (imgPath: string) => ipcRenderer.invoke('hjen:read-image-upload-data-url', imgPath),
  pathExists: (p: string) => ipcRenderer.invoke('hjen:path-exists', p),
  imageDims: (path: string) => ipcRenderer.invoke('hjen:image-dims', { path }),
  backfillThumbnails: (args: { projectSlug?: string | null }) =>
    ipcRenderer.invoke('hjen:backfill-thumbnails', args),

  // Reference library
  listLibrary: () => ipcRenderer.invoke('hjen:list-library'),
  addToLibrary: (args: { category: string; sourcePath: string; name?: string }) =>
    ipcRenderer.invoke('hjen:add-to-library', args),
  deleteFromLibrary: (args: { id: string }) => ipcRenderer.invoke('hjen:delete-from-library', args),
  renameLibraryAsset: (args: { id: string; name: string }) =>
    ipcRenderer.invoke('hjen:rename-library-asset', args),
  moveLibraryAsset: (args: { id: string; newCategory: string }) =>
    ipcRenderer.invoke('hjen:move-library-asset', args),
  dedupLibrary: () => ipcRenderer.invoke('hjen:dedup-library'),
  listCharacterCards: () => ipcRenderer.invoke('hjen:list-character-cards'),
  saveCharacterCard: (args: { id?: string; name: string; profile: any; mainAsset: any; referencePaths: string[] }) =>
    ipcRenderer.invoke('hjen:save-character-card', args),
  deleteCharacterCard: (args: { id: string }) => ipcRenderer.invoke('hjen:delete-character-card', args),
  pickImageFiles: () => ipcRenderer.invoke('hjen:pick-image-files'),
  // Absolute path of a dropped/selected File (Electron 32 removed File.path —
  // webUtils.getPathForFile is the sanctioned replacement). Used by the mind
  // canvas file-drop to seed Source nodes from Finder images.
  pathForFile: (file: File) => {
    try { return webUtils.getPathForFile(file); }
    catch { return (file as unknown as { path?: string }).path || ''; }
  },
  pickAudioFiles: () => ipcRenderer.invoke('hjen:pick-audio-files'),
  pickVideoFile: () => ipcRenderer.invoke('hjen:pick-video-file'),
  pickTextDocument: (args?: { title?: string }) => ipcRenderer.invoke('hjen:pick-text-document', args),

  // Cuts Engine 1.0 — internal shot-boundary + representative-frame extractor
  cutsAnalyze: (args: { sessionId: string; videoPath: string; projectSlug?: string; threshold?: number; stripStep?: number }) =>
    ipcRenderer.invoke('hjen:cuts-analyze', args),
  cutsShotFrames: (args: { sessionId: string; videoPath: string; projectSlug?: string; shotIndex: number; start: number; end: number; count?: number }) =>
    ipcRenderer.invoke('hjen:cuts-shot-frames', args),
  cutsFetch: (args: { url: string; projectSlug?: string }) => ipcRenderer.invoke('hjen:cuts-fetch', args),
  cutsEmbed: (args: { sessionId: string; projectSlug?: string; model?: string; shots: Array<{ i: number; frames: string[] }> }) =>
    ipcRenderer.invoke('hjen:cuts-embed', args),
  onCutsEmbedProgress: (h: (e: unknown, d: { line?: string }) => void) => {
    ipcRenderer.on('hjen:cuts-embed-progress', h);
    return () => ipcRenderer.removeListener('hjen:cuts-embed-progress', h);
  },
  cutsWatch: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; shots: Array<{ i: number; start: number; end: number; frame?: string }> }) =>
    ipcRenderer.invoke('hjen:cuts-watch', args),
  cutsPeople: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; shots: Array<{ i: number; start: number; end: number; frame?: string }> }) =>
    ipcRenderer.invoke('hjen:cuts-people', args),
  cutsVerifyGroups: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; kind: 'scene' | 'person'; groups: Array<{ id: string; label: string; shots: Array<{ i: number; start: number; end: number }> }> }) =>
    ipcRenderer.invoke('hjen:cuts-verify-groups', args),
  cutsDna: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string }) =>
    ipcRenderer.invoke('hjen:cuts-dna', args),
  cutsStory: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; shots: Array<{ i: number; start: number; end: number }> }) =>
    ipcRenderer.invoke('hjen:cuts-story', args),
  cutsBrief: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; shot: { i: number; start: number; end: number }; keyframe?: string; dna: unknown; story?: unknown; context?: string; neighbours?: string; canon?: string }) =>
    ipcRenderer.invoke('hjen:cuts-brief', args),
  cutsVerify: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; shots: Array<{ i: number; start: number; end: number; frame?: string }> }) =>
    ipcRenderer.invoke('hjen:cuts-verify', args),
  cutsSpeech: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; duration?: number }) =>
    ipcRenderer.invoke('hjen:cuts-speech', args),
  cutsSave: (args: { projectSlug?: string; sessionId: string; data: any }) => ipcRenderer.invoke('hjen:cuts-save', args),
  cutsList: (args: { projectSlug?: string }) => ipcRenderer.invoke('hjen:cuts-list', args),
  cutsLoad: (args: { projectSlug?: string; sessionId: string }) => ipcRenderer.invoke('hjen:cuts-load', args),
  cutsDelete: (args: { projectSlug?: string; sessionId: string }) => ipcRenderer.invoke('hjen:cuts-delete', args),
  cutsSource: (args: { videoPath: string }) => ipcRenderer.invoke('hjen:cuts-source', args),
  cutsHasAudio: (args: { videoPath: string }) => ipcRenderer.invoke('hjen:cuts-has-audio', args),
  openExternalUrl: (url: string) => ipcRenderer.invoke('hjen:open-external-url', url),

  // Browser door (HJEN Clipper) — the localhost bridge the extension posts
  // clipped web frames through. The renderer only reads its address + key.
  clipperStatus: () => ipcRenderer.invoke('hjen:clipper-status'),
  clipperRevoke: (args: { id: string }) => ipcRenderer.invoke('hjen:clipper-revoke', args),
  clipperRevokeAll: () => ipcRenderer.invoke('hjen:clipper-revoke-all'),
  clipperSetPrefs: (patch: Record<string, unknown>) => ipcRenderer.invoke('hjen:clipper-set-prefs', patch),
  clipperDownload: (args: { target: string }) => ipcRenderer.invoke('hjen:clipper-download', args),
  // External tools (ffmpeg / yt-dlp / whisper / python) — what THIS Mac has.
  toolsStatus: () => ipcRenderer.invoke('hjen:tools-status'),
  toolsRecheck: () => ipcRenderer.invoke('hjen:tools-recheck'),

  // HJEN REF — internal Saudi reference library (510-ad study, search-only)
  refStatus: () => ipcRenderer.invoke('hjen:ref-status'),
  refSearch: (args: { query: string; limit?: number }) => ipcRenderer.invoke('hjen:ref-search', args),

  // Context Agents — DNA-agnostic creative engine (recipe server-side in MAIN).
  // Studio sends the small {register,beat,energy,goal} state; MAIN retrieves the
  // methods + profile + trusted lexicon, builds the blocks, runs the 3 LLM calls.
  caApply: (args: { profileId: string; register: string; beat: string; energy: string; goal: string }) =>
    ipcRenderer.invoke('hjen:ca-apply', args),
  caVocab: () => ipcRenderer.invoke('hjen:ca-vocab'),
  caListMethods: () => ipcRenderer.invoke('hjen:ca-list-methods'),
  caListProfiles: () => ipcRenderer.invoke('hjen:ca-list-profiles'),
  caReadCard: (args: { id: string }) => ipcRenderer.invoke('hjen:ca-read-card', args),
  caWriteCard: (args: { card: unknown }) => ipcRenderer.invoke('hjen:ca-write-card', args),
  caDeleteCard: (args: { id: string }) => ipcRenderer.invoke('hjen:ca-delete-card', args),
  caReadLexicon: (args?: { status?: string }) => ipcRenderer.invoke('hjen:ca-read-lexicon', args),
  caWriteLexiconEntry: (args: { entry: unknown }) => ipcRenderer.invoke('hjen:ca-write-lexicon-entry', args),
  caStudy: (args: { adId: string; profileId: string; videoPathOrUrl?: string; description?: string; lang?: string }) =>
    ipcRenderer.invoke('hjen:ca-study', args),
  onCaStudyProgress: (cb: (d: { adId: string; profileId: string; line: string }) => void) => {
    const h = (_e: any, d: any) => cb(d);
    ipcRenderer.on('hjen:ca-study-progress', h);
    return () => ipcRenderer.removeListener('hjen:ca-study-progress', h);
  },
  caStatus: () => ipcRenderer.invoke('hjen:ca-status'),

  // Context Eye — the EYE picks the real reference frame for a feeling; the
  // renderer sends the small state + goal and reads back two columns (eye vs
  // naive) to judge. The scoring + VLM pixel-fit recipe stays in MAIN.
  caEyePick: (args: { register: string; beat: string; energy: string; goal: string }) =>
    ipcRenderer.invoke('hjen:ca-eye-pick', args),
  // Frameset path: MAIN builds the smart search query from the distilled criteria;
  // the renderer harvests real film stills itself (like Creative Mind), then hands
  // them back for the VLM pixel-fit ranking. The recipe never crosses IPC.
  caEyeQuery: (args: { register: string; beat: string; energy: string }) =>
    ipcRenderer.invoke('hjen:ca-eye-query', args),
  caEyeConfirmFrames: (args: { register: string; beat: string; energy: string; goal: string; frames: Array<{ id: string; filePath: string }> }) =>
    ipcRenderer.invoke('hjen:ca-eye-confirm-frames', args),
  caEyeJudge: (args: { state: { register: string; beat: string; energy: string } | null; goal: string; verdict: 'eye' | 'naive' | 'tie'; eyeIds: string[]; naiveIds: string[] }) =>
    ipcRenderer.invoke('hjen:ca-eye-judge', args),
  caEyeStatus: () => ipcRenderer.invoke('hjen:ca-eye-status'),

  // The Eye — READ. Send an image path, read back the ten axes. EYE_READ_SYS,
  // the axis discipline and the validation all stay in MAIN; this bridge carries
  // a path in and a finished read out, nothing else.
  eyeRead: (args: { imagePath: string; note?: string; model?: string }) =>
    ipcRenderer.invoke('hjen:eye-read', args),
  eyeGoldenWrite: (args: { entry: unknown }) => ipcRenderer.invoke('hjen:eye-golden-write', args),
  eyeStatus: () => ipcRenderer.invoke('hjen:eye-status'),

  // The Swap — the Eye's read, run backwards. The renderer sends slots and
  // decisions and gets a FINISHED, OPAQUE make prompt: the change contract, the
  // preserve grammar and the acceptance tests all stay in MAIN.
  swapSlots: (args: { imagePath: string; read: unknown; model?: string }) =>
    ipcRenderer.invoke('hjen:swap-slots', args),
  swapConsequence: (args: { slots: unknown; decisions: unknown; model?: string }) =>
    ipcRenderer.invoke('hjen:swap-consequence', args),
  swapPlan: (args: { slots: unknown; requirements: unknown[]; model?: string }) =>
    ipcRenderer.invoke('hjen:swap-plan', args),
  swapCompose: (args: {
    slots: unknown; decisions: unknown; requirements: unknown[]; refs: unknown[];
    preserveKeys: string[]; escalate?: string[]; round?: number; subjectOnlyCanny?: boolean; model?: string;
  }) => ipcRenderer.invoke('hjen:swap-compose', args),
  swapVerify: (args: { takePath: string; requirements: unknown[]; model?: string }) =>
    ipcRenderer.invoke('hjen:swap-verify', args),
  swapCanny: (args: { imagePath: string; maskPath?: string }) =>
    ipcRenderer.invoke('hjen:swap-canny', args),
  readSwapDoc: (args: { id: string }) => ipcRenderer.invoke('hjen:read-swap-doc', args),
  writeSwapDoc: (args: { id: string; doc: unknown; allowEmpty?: boolean }) =>
    ipcRenderer.invoke('hjen:write-swap-doc', args),
  swapGoldenWrite: (args: { entry: unknown }) => ipcRenderer.invoke('hjen:swap-golden-write', args),
  swapStatus: () => ipcRenderer.invoke('hjen:swap-status'),

  // IDEA — Saudi Ad Voice Agent Graph (N0-N8 + independent N6S judge).
  ideaStatus: () => ipcRenderer.invoke('hjen:idea-status'),
  ideaRun: (args: {
    text: string;
    deliverable?: 'idea_narration' | 'dialogue' | 'vo';
    concept_frame?: boolean;
    take_count?: number;
    length_or_duration?: string;
    duration_scope?: 'film_runtime' | 'spoken_copy';
    voice_load?: 'picture_led' | 'balanced' | 'copy_led';
    spoken_word_limit?: number | null;
    brand?: { name?: string; offering?: string };
    speaker?: { origin?: string; age_band?: string; role?: string };
    listener?: { relationship?: string; power_distance?: 'equal' | 'upward' | 'downward' | 'intimate' };
    scene?: { place?: string; operational_state?: string; immediate_pressure?: string; cultural_truth_detail?: string };
    inside_state?: string;
    speech_act?: string;
    narrative_beat?: string;
    requested_locale?: 'saudi-neutral-spoken' | 'najdi-riyadh-light' | 'hijazi-jeddah-light';
    register_target?: 'saudi-neutral-spoken' | 'saudi-institutional-spoken' | 'saudi-family-warm' | 'saudi-youth-banter' | 'saudi-national-elevated';
  }) => ipcRenderer.invoke('hjen:idea-run', args),

  // Skills (Anthropic-style markdown skill files)
  listSkills: () => ipcRenderer.invoke('hjen:list-skills'),
  getSkillsFolder: () => ipcRenderer.invoke('hjen:get-skills-folder'),
  openSkillsFolder: () => ipcRenderer.invoke('hjen:open-skills-folder'),
  pickSkillFile: () => ipcRenderer.invoke('hjen:pick-skill-file'),
  importSkill: (args: { sourcePath: string }) => ipcRenderer.invoke('hjen:import-skill', args),
  saveSkill: (args: { id?: string | null; name: string; description?: string; version?: string; body: string }) => ipcRenderer.invoke('hjen:save-skill', args),
  deleteSkill: (args: { id: string }) => ipcRenderer.invoke('hjen:delete-skill', args),
  runSkill: (args: {
    skillId: string;
    prompt: string;
    references?: Array<{
      category?: string;
      name?: string;
      customName?: string;
      parentName?: string;
      filePath?: string;
    }>;
    settings?: Record<string, unknown>;
    projectId?: string | null;
    projectSlug?: string | null;
    projectName?: string | null;
  }) => ipcRenderer.invoke('hjen:run-skill', args),
  listSkillRuns: () => ipcRenderer.invoke('hjen:list-skill-runs'),
});
