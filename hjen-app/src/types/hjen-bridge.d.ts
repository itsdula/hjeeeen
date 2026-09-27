// Renderer-side bridge exposed by electron/preload.ts via contextBridge

import type { PricingConfig } from '../lib/cost';
import type { Theme, ThemeConfig } from '../lib/theme/types';

export type StageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type StageStatus = 'draft' | 'signed';

/** HJEN Clipper — which save methods the browser extension is allowed to run.
 *  Owned by the app (Settings → Browser), read by the extension over the door. */
export interface HjenClipperPrefs {
  contextMenu: boolean;
  hoverBadge: boolean;
  shortcut: boolean;
  notify: boolean;
  minSize: number;
  /** '' follows whichever project is open; an id pins the target. */
  projectId: string;
}

/** One browser that has signed itself in through the Allow dialog. */
export interface HjenClipperBrowser {
  id: string;
  browser: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface HjenClipperStatus {
  running: boolean;
  port: number;
  url: string;
  extensionDir: string;
  prefs: HjenClipperPrefs;
  browsers: HjenClipperBrowser[];
}

/** Answer to a manual "check for updates". `current` is always the running
 *  version, so "up to date" can be verified rather than trusted. */
export interface HjenUpdateCheck {
  ok: boolean;
  state: 'current' | 'available' | 'downloading' | 'ready' | 'dev' | 'unsupported' | 'error';
  current: string;
  version?: string;
  percent?: number;
  message?: string;
}

/** One external program the app shells out to, and whether this Mac has it. */
export interface HjenToolStatus {
  id: string;
  label: string;
  /** What stops working without it, in the user's words. */
  powers: string;
  /** The one command that installs it. */
  install: string;
  required: boolean;
  found: boolean;
  path: string | null;
  version: string | null;
  /** The copy in use ships inside the app — nothing for the user to install. */
  bundled: boolean;
}

/** Public, copy-safe output of the Saudi Ad Voice runtime used by IDEA. */
export interface HjenIdeaTake {
  take_id: string;
  copy: string;
  dramatic_move: string;
}

export interface HjenIdeaConceptFrame {
  take_id: string;
  route_name: string;
  idea_definition: string;
  visual_logic: string;
  saudi_insight: string;
  refusals: string[];
}

export interface HjenIdeaGraphOutput {
  schema_version: number;
  run_id?: string;
  status: string;
  deliverable: {
    applied_locale: string;
    register_target: string;
    policy_gate: string;
    concept_frames?: HjenIdeaConceptFrame[];
    takes: HjenIdeaTake[];
  } | null;
  failure_record?: {
    stage?: string;
    code?: string;
    detail?: string;
    decision?: string;
    take_ids?: string[];
    fatal_codes?: string[];
    copy_withheld?: boolean;
  } | null;
  presentation_warning?: {
    stage?: string;
    code?: string;
    detail?: string;
    frame_withheld?: boolean;
  } | null;
  quality_warning?: {
    stage?: string;
    code?: string;
    detail?: string;
    take_ids?: string[];
    advisory_codes?: string[];
  } | null;
  voice_contract?: Record<string, unknown> | null;
  dialect_decision?: { requested?: string; applied?: string };
  evidence_ids?: string[];
  honest_risk?: string;
}

export interface HjenIdeaStatus {
  ok: boolean;
  graphFound: boolean;
  pythonFound: boolean;
  auth: 'local' | 'gateway' | 'none';
  model: string;
  version: string | null;
  message: string;
}

export interface HjenIdeaRunResponse {
  ok: boolean;
  reason?: string;
  message?: string;
  result?: HjenIdeaGraphOutput;
  graph?: {
    final_status?: string;
    nodes?: Record<string, { status?: string; decision?: string; fatal_codes?: string[] }>;
  } | null;
  model?: string;
  ms?: number;
}

/** Which build of the extension a download asks for. */
export type HjenClipperTarget = 'chrome' | 'firefox' | 'safari';

/** Result of zipping the extension into the user's Downloads folder. */
export interface HjenClipperDownload {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  slug: string;
  created: string;
  generationCount: number;
  coverImagePath?: string;
  /** Stage the user was last on (1..8). Optional — projects without a
   *  _project/ sidecar are treated as currentStage=1. */
  currentStage?: StageNumber;
  /** Status map for the 8-stage pipeline. Optional for the same reason. */
  stagesState?: Partial<Record<StageNumber, StageStatus>>;
}

export interface ProjectLedgerEntry {
  id: string;
  ts: number;
  kind: 'note' | 'risk' | 'open';
  body: string;
  resolved?: boolean;
}

/** What lives in {projectSlug}/_project/state.json. Authoritative per-project
 *  pipeline state. ProjectMeta carries a cheap mirror of currentStage + the
 *  status map so list views don't have to read state.json per row. */
export interface ProjectState {
  version: 1;
  currentStage: StageNumber;
  stages: Record<StageNumber, { status: StageStatus; signedAt?: string }>;
  ledger: ProjectLedgerEntry[];
}

/** Stage 01 — Brief. Structured form fields plus a long-form restatement.
 *  Companion human-readable {projectSlug}/_project/01_brief.md is written
 *  alongside on every save. */
export interface BriefData {
  client?: string;
  oneLine?: string;
  regions?: string[];   // 'asir' | 'jizan' | 'hail' | 'najd' | 'hijaz' | 'eastern' | 'alula' | 'neom'
  mood?: string;        // quiet | tender | heroic | atmospheric | documentary | editorial
  paletteSignal?: 'warm' | 'cool' | 'colorful' | 'mixed';
  scope?: {
    frameCount?: number;
    shootDays?: number;
    channels?: string[]; // 'OOH' | 'Digital' | 'Print' | 'Social'
  };
  refusals?: string[];
  honestRisk?: string;
  restatement?: string;
  updatedAt?: string;
}

/** One row of a panel-kind index — enough to draw the document list without
 *  reading every document file. Rebuilt from the files on every write. */
export interface PanelDocSummary {
  id: string;
  name: string;
  updatedAt: string;
  rev: number;
  /** Items on a mood board · clips on a timeline. */
  count: number;
  coverPath?: string;
}

/** The flattened sequence both exporters take — see lib/timeline/exportPayload. */
export interface SequenceExportArgs {
  clips: Array<{
    kind: 'video' | 'image' | 'audio';
    src: string; start: number; dur: number; srcIn: number;
    gain: number; hasAudio: boolean;
    /** 0 = the base video track, 1..n above it; negative = an audio track. */
    lane: number;
    label?: string;
  }>;
  width: number;
  height: number;
  fps: number;
  total: number;
  projectName?: string;
}

/** What one ffmpeg stderr read tells us about a file on the way onto a track. */
export interface MediaProbe {
  ok: boolean;
  kind?: 'video' | 'image' | 'audio';
  duration?: number;
  hasVideo?: boolean;
  /** Load-bearing: the exporter must never reference [n:a] on a silent file. */
  hasAudio?: boolean;
  width?: number;
  height?: number;
  fps?: number;
  poster?: string;
  reason?: string;
  message?: string;
}

declare global {
  interface Window {
    hjen: {
      /** Native window chrome the CSS lays out around. Absent on hosts that
       *  have none (the web mount), which reads as traffic lights on the left. */
      chrome?: {
        trafficLights: 'left' | 'right';
        /** '' (or absent) = the full studio shell. Anything else names the bare
         *  panel this window was launched to be — see PanelWindowRoot. */
        role?: string;
        /** The document that panel window is bound to, and its project. */
        docId?: string;
        projectId?: string;
        /** Theme handed over at launch: a detached window must not repaint in
         *  the Default theme while it waits to read localStorage. */
        themeId?: string;
      };
      // Cloud gateway (invite link)
      getGateway: () => Promise<{ url: string; token: string } | null>;
      setGateway: (cfg: { url: string; token: string } | null) => Promise<boolean>;
      // API keys
      getApiKey: () => Promise<string | null>;
      setApiKey: (key: string) => Promise<boolean>;
      getGoogleKey: () => Promise<string | null>;
      setGoogleKey: (key: string) => Promise<boolean>;
      getAnthropicKey: () => Promise<string | null>;
      setAnthropicKey: (key: string) => Promise<boolean>;
      getReplicateKey: () => Promise<string | null>;
      setReplicateKey: (key: string) => Promise<boolean>;
      getArkKey: () => Promise<string | null>;
      setArkKey: (key: string) => Promise<boolean>;
      getKlingKey: () => Promise<string | null>;
      setKlingKey: (key: string) => Promise<boolean>;

      // In-app Assistant (MCP surface ②) — runs a Claude agent over the hjen MCP tools.
      assistantTurn: (args: { message: string; history?: any[]; context?: { surface?: string; projectId?: string | null; projectName?: string | null; attachments?: string[]; scope?: string } }) => Promise<{
        ok: boolean;
        finalText?: string;
        steps?: Array<{ tool: string; args: any; resultPreview: string; isError?: boolean }>;
        usage?: any;
        message?: string;
        reason?: string;
      }>;
      onAssistantEvent: (cb: (e: { type: string; name?: string; args?: any; text?: string }) => void) => () => void;

      // Persistent Assistant conversations — general or project-linked; the same
      // disk store external agents read via hjen_conversations_* MCP tools.
      conversationsList: (args?: { projectSlug?: string }) => Promise<{ ok: boolean; conversations: Array<{ id: string; title: string; kind: 'general' | 'project'; projectId?: string | null; projectName?: string | null; projectSlug?: string | null; updatedAt: string; msgCount: number }> }>;
      conversationRead: (args: { id: string; kind?: string; projectSlug?: string }) => Promise<{ ok: boolean; conversation: any | null }>;
      conversationWrite: (convo: any) => Promise<{ ok: boolean; reason?: string; path?: string }>;
      conversationDelete: (args: { id: string }) => Promise<{ ok: boolean }>;
      onNavigate: (cb: (d: { projectId: string | null; view: string; entity?: string }) => void) => () => void;
      onReload: (cb: (d: { projectId: string | null; kind: string }) => void) => () => void;

      // Auto-update (desktop): a newer version was downloaded in the background →
      // the renderer shows a live "Restart to update" badge; restartToUpdate applies it.
      onUpdateReady: (cb: (d: { version: string }) => void) => () => void;
      onUpdateDownloading: (cb: (d: { version: string }) => void) => () => void;
      restartToUpdate: () => Promise<{ ok: boolean; message?: string }>;
      checkForUpdates: () => Promise<HjenUpdateCheck>;
      onUpdateProgress?: (cb: (d: { percent: number }) => void) => () => void;

      // Command bridge — MCP drives a REAL app action; renderer runs it and answers back.
      onCommand: (cb: (d: { requestId: string; action: string; args: any }) => void) => () => void;
      respondCommand: (requestId: string, result: any) => void;

      // MCP Hub
      mcpEndpointConfig: () => Promise<{ mcpDir: string; runShPath: string; serveHttpPath: string; defaultHttpUrl: string }>;
      mcpListServers: () => Promise<Array<{ name: string; command: string; args?: string[] }>>;
      mcpSetServers: (servers: Array<{ name: string; command: string; args?: string[] }>) => Promise<{ ok: boolean; reason?: string }>;

      // Pricing config — vendor-rate overrides + margin/discount (dashboard)
      getPricingConfig: () => Promise<PricingConfig | null>;
      setPricingConfig: (config: PricingConfig) => Promise<{ ok: boolean; reason?: string }>;

      // Theme / appearance config — active theme id + custom themes + import/export
      getThemeConfig: () => Promise<ThemeConfig | null>;
      setThemeConfig: (config: ThemeConfig) => Promise<{ ok: boolean; reason?: string }>;
      exportTheme: (args: { theme: Theme; suggestedName?: string }) => Promise<{ ok: boolean; path?: string; reason?: string }>;
      importTheme: () => Promise<unknown | null>;
      pickImage: (args?: { title?: string }) => Promise<string | null>;

      // Background-jobs log — persisted operations history (crash/quit resilience).
      jobsRead: () => Promise<{ version: number; updatedAt?: string; jobs: unknown[] } | null>;
      jobsWrite: (payload: { jobs: unknown[] }) => Promise<{ ok: boolean; reason?: string }>;

      worldDepth: (args: { imagePath: string; size?: number }) => Promise<
        { ok: true; worldId: string; dir: string; imgUrl: string; depthUrl: string }
        | { ok: false; reason: string; message: string }>;
      emulsionDefocus: (args: { imagePath: string; focus: 'auto' | number; aperture: number; haze: number }) => Promise<
        { ok: boolean; path?: string; reason?: string; message?: string }>;
      emulsionDepth: (args: { imagePath: string }) => Promise<
        { ok: boolean; path?: string; reason?: string; message?: string }>;
      emulsionDepthPro: (args: { imagePath: string }) => Promise<
        { ok: boolean; path?: string; minM?: number; maxM?: number; reason?: string; message?: string }>;
      emulsionSegment: (args: { imagePath: string }) => Promise<
        { ok: boolean; skin?: string; sky?: string; reason?: string; message?: string }>;
      worldPackSave: (args: { dir: string; packId?: string; pngDataUrl: string; camera: unknown; prompt: string }) => Promise<
        { ok: true; packDir: string; platePath: string } | { ok: false; message: string }>;
      /** Film Space — write a full Angle Pack (plate + depth + outline + pose + camera.json + prompt + optional MOVE preview clip) from the built stage. Pass sessionId + projectSlug to tie the pack to the active session. */
      filmspacePackSave: (args: { dir: string; packId?: string; plate: string; depth?: string; outline?: string; pose?: string; camera: unknown; prompt: string; clip?: string; clipMime?: string; sessionId?: string; projectSlug?: string }) => Promise<
        { ok: true; packDir: string; packId: string; platePath: string; files: string[]; previewFile: string | null } | { ok: false; message: string }>;
      /** Film Space — persist a saved session (full stage snapshot + optional thumbnail). Preserves any pack ids already recorded for the session. */
      filmspaceSessionSave: (args: { projectSlug?: string; sessionId?: string; name: string; state: unknown; thumbnail?: string }) => Promise<
        { ok: true; sessionId: string; dir: string; savedAt: number; thumbPath: string | null; packIds: string[] } | { ok: false; message: string }>;
      /** Film Space — enumerate a project's saved sessions (metadata only; use filmspaceSessionGet for the full state). */
      filmspaceSessionsList: (args: { projectSlug?: string }) => Promise<
        { ok: true; sessionsRoot: string; sessions: Array<{ id: string; name: string; savedAt: number; thumbPath: string | null; packIds: string[]; dir: string }> } | { ok: false; message: string; sessions: [] }>;
      /** Film Space — read a saved session's full record (incl. the stage state to restore). */
      filmspaceSessionGet: (args: { projectSlug?: string; sessionId: string }) => Promise<
        { ok: true; id: string; name: string; savedAt: number; packIds: string[]; state: unknown } | { ok: false; message: string }>;
      /** Film Space — delete a saved session folder. */
      filmspaceSessionDelete: (args: { projectSlug?: string; sessionId: string }) => Promise<
        { ok: true; sessionId: string } | { ok: false; message: string }>;
      /** Film Space — cache movement-preset preview thumbnails (rendered from our own stage) under userData. */
      filmspacePresetsSave: (args: { items: { id: string; dataUrl: string }[] }) => Promise<
        { ok: true; dir: string; count: number } | { ok: false; message: string }>;
      filmspacePresetsList: () => Promise<{ ok: boolean; dir: string; ids: string[]; message?: string }>;
      filmspacePoseDir: () => Promise<{ ok: boolean; dir: string; ready: boolean; message?: string }>;
      /** Film Space — single-image body recovery (4D-Humans / HMR2.0 → SMPL) in a Python sidecar. Returns the pose.json params (global_orient + body_pose axis-angle, betas, camera, named joints3d). RESEARCH weights, internal use only. */
      filmspacePoseHmr: (args: { imagePath: string }) => Promise<
        { ok: true; params: {
            global_orient: number[]; body_pose: number[][]; betas: number[];
            joints3d: Record<string, number[]>;
            camera: { s: number; tx: number; ty: number; focal_length: number; img_w: number; img_h: number; box: number[] };
            meta: Record<string, unknown>;
          } }
        | { ok: false; reason: string; message?: string }>;
      /** Film Space — stream the body-recovery sidecar's progress lines. */
      onFilmspacePoseProgress: (h: (e: unknown, data: { line: string }) => void) => () => void;
      /** Film Space — READ-ONLY enumeration of a project's locked Angle Packs (plate + camera + prompt per pack). Never writes; used by Camera Angles' "From Film Space" source. */
      filmspacePacksList: (args: { projectSlug?: string }) => Promise<
        { ok: true; packsRoot: string; packs: Array<{ packId: string; packDir: string; platePath: string; outlinePath: string | null; depthPath: string | null; posePath: string | null; camera: unknown; prompt: string; previewFile: string | null; at: number }> }
        | { ok: false; message: string; packs: [] }>;
      worldFinish: (args: { platePath: string; outDir: string; quality?: string }) => Promise<
        { ok: true; lockedPath: string; lockedUrl: string; lockedBase64: string } | { ok: false; message: string }>;
      onWorldProgress: (h: (e: unknown, data: { worldId: string; line: string }) => void) => () => void;

      replicateRun: (args: {
        model: string;
        version?: string;
        input: Record<string, any>;
        pollIntervalMs?: number;
        maxWaitMs?: number;
      }) => Promise<
        | { ok: true; output: any; predictionId: string; metrics: any }
        | { ok: false; reason: string; message: string }
      >;
      fetchUrlBase64: (url: string) => Promise<{ ok: true; base64: string; bytes: number } | { ok: false; message: string }>;

      // Seedance 2.0 (BytePlus ModelArk) — submit + poll + persist
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
      }) => Promise<
        | { ok: true; taskId: string; model: string; promptFull: string }
        | { ok: false; reason: 'no_key' | 'submit_failed' | 'no_task_id' | 'exception'; message: string }
      >;
      seedancePoll: (args: { taskId: string }) => Promise<
        | { ok: true; status: string; videoUrl: string | null; usage: any; errorMessage: string | null; raw: any }
        | { ok: false; reason: 'no_key' | 'poll_failed' | 'exception'; message: string }
      >;

      // Kling video (Kuaishou) — submit + poll (normalised to Seedance's shape)
      getKlingKey: () => Promise<string | null>;
      setKlingKey: (key: string) => Promise<boolean>;
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
      }) => Promise<
        | { ok: true; taskId: string; model: string; promptFull: string; videoType: 'text2video' | 'image2video' }
        | { ok: false; reason: 'no_key' | 'submit_failed' | 'no_task_id' | 'exception'; message: string }
      >;
      klingPoll: (args: { taskId: string; videoType?: 'text2video' | 'image2video' }) => Promise<
        | { ok: true; status: string; videoUrl: string | null; usage: any; errorMessage: string | null; raw: any }
        | { ok: false; reason: 'no_key' | 'poll_failed' | 'exception'; message: string }
      >;
      saveVideo: (args: {
        base64: string;
        sidecar: any;
        promptSlug: string;
        projectSlug?: string;
        projectId?: string;
        posterPath?: string | null;
      }) => Promise<{ videoPath: string; jsonPath: string; dir: string; thumbPath: string }>;
      listProjectVideos: (args: { projectSlug?: string | null }) => Promise<VideoFileEntry[]>;
      saveFailedVideo: (args: { id: string; payload: FailedVideoPayload }) =>
        Promise<{ ok: boolean; reason?: string }>;
      listFailedVideos: () => Promise<FailedVideoPayload[]>;
      deleteFailedVideo: (args: { id: string }) => Promise<{ ok: boolean }>;

      // Prompt enhancement (Claude vision)
      enhancePrompt: (args: {
        rawPrompt: string;
        references: Array<{
          filePath: string;
          category: string;
          name: string;
          customName?: string;
          parentName?: string;
        }>;
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
      }) => Promise<
        | { ok: true; enhancedPrompt: string; usage: { inputTokens: number; outputTokens: number }; usd: number; model: string }
        | { ok: false; reason: 'no_key' | 'empty_prompt' | 'api_error' | 'empty_response' | 'network'; message: string }
      >;
      listEnhancements: () => Promise<EnhancementEvent[]>;

      // Node graph — Studio Node canvas persistence, own sidecar
      // {projectSlug}/_node/graph.json (atomic + backups + auto-heal).
      // Returns the raw GraphDoc; renderer casts via docToGraph().
      /** `scope` picks the workspace: 'node' → _node/graph.json (default),
       *  'space' → _space/graph.json. HJEN NODE and HJEN SPACE never share a file. */
      readGraph: (args: { id: string; scope?: 'node' | 'space' }) => Promise<unknown | null>;
      writeGraph: (args: { id: string; doc: unknown; allowEmpty?: boolean; scope?: 'node' | 'space' }) =>
        Promise<{ ok: boolean; reason?: string }>;
      /** Render the timeline (V1) to an mp4 via local ffmpeg at WxH. */
      exportTimelineMp4: (args: { clips: Array<{ kind: string; src?: string; start: number; duration: number }>; width: number; height: number; fps: number; projectName?: string }) =>
        Promise<{ ok: true; path: string } | { ok: false; reason: string; message?: string }>;
      /** Export the timeline as FCPXML (DaVinci/Premiere/FCP interchange). */
      exportTimelineFcpxml: (args: { clips: Array<{ kind: string; src?: string; start: number; duration: number }>; width: number; height: number; fps: number; projectName?: string }) =>
        Promise<{ ok: true; path: string } | { ok: false; reason: string; message?: string }>;

      // Support inbox — in-app tickets persisted to {projectsRoot}/_support.jsonl.
      // No email client involved; requests are captured locally and can later
      // be synced to a real endpoint or read by an admin view.
      submitSupport: (args: { kind: string; message: string; user?: SupportUser; context?: any }) =>
        Promise<{ ok: true; id: string; ts: number } | { ok: false; reason: string }>;
      listSupport: () => Promise<SupportTicket[]>;

      // Pending-job crash recovery
      savePendingJob: (args: { id: string; payload: PendingJobPayload | PendingVideoPayload }) =>
        Promise<{ ok: boolean; reason?: string }>;
      clearPendingJob: (args: { id: string }) => Promise<{ ok: boolean }>;
      listPendingJobs: () => Promise<Array<PendingJobPayload | PendingVideoPayload>>;

      // Failed-job debug history
      saveFailedJob: (args: { id: string; payload: FailedJobPayload }) =>
        Promise<{ ok: boolean; reason?: string }>;
      listFailedJobs: () => Promise<FailedJobPayload[]>;
      deleteFailedJob: (args: { id: string }) => Promise<{ ok: boolean }>;

      // Projects
      getProjects: () => Promise<{ projects: ProjectMeta[]; projectsRoot: string; lastProjectId: string | null }>;
      setLastProjectId: (id: string | null) => Promise<{ ok: boolean }>;
      createProject: (args: { name: string }) => Promise<ProjectMeta>;
      deleteProject: (args: { id: string; deleteFiles?: boolean }) => Promise<{ ok: boolean }>;
      renameProject: (args: { id: string; name: string }) => Promise<ProjectMeta | null>;
      setProjectCover: (args: { id: string; imgPath: string | null }) => Promise<ProjectMeta | null>;

      // Per-project pipeline state (8-stage workspace)
      readProjectState: (args: { id: string }) => Promise<ProjectState | null>;
      writeProjectState: (args: { id: string; state: ProjectState }) => Promise<ProjectMeta | null>;
      readStageData: (args: { id: string; stage: StageNumber }) => Promise<unknown | null>;
      writeStageData: (args: { id: string; stage: StageNumber; data: unknown; markdown?: string }) =>
        Promise<{ ok: boolean }>;

      // Storyboard product — own sidecar ({projectSlug}/_storyboard/storyboard.json),
      // independent of the 8-stage PPM pipeline. Returns `unknown`; renderer casts to StoryboardData.
      readStoryboard: (args: { id: string }) => Promise<unknown | null>;
      writeStoryboard: (args: { id: string; data: unknown; allowEmpty?: boolean }) => Promise<{ ok: boolean; reason?: string }>;
      /** List restore points (versioned backups) for a project's storyboard, newest first. */
      listStoryboardBackups: (args: { id: string }) => Promise<{ ok: boolean; backups: Array<{ file: string; ts: number; shots: number; characters: number; places: number; elements: number; scriptChars: number }> }>;
      /** Restore a chosen backup over the live board (current state is snapshotted first). */
      restoreStoryboardBackup: (args: { id: string; file: string }) => Promise<{ ok: boolean; reason?: string; message?: string; data?: unknown }>;
      /** Global custom board-look library, shared across ALL storyboard projects. */
      readBoardLooks: () => Promise<{ ok: boolean; looks: unknown[] }>;
      writeBoardLooks: (args: { looks: unknown[] }) => Promise<{ ok: boolean }>;
      /** Structured Claude call for the storyboard breakdown + cast/place extraction.
       *  Returns raw assistant text; renderer parses the fenced JSON block. */
      claudeJson: (args: { system: string; prompt: string; maxTokens?: number; imagePath?: string; imagePaths?: string[] }) => Promise<
        | { ok: true; text: string; usage: { inputTokens: number; outputTokens: number }; usd: number; model: string }
        | { ok: false; reason: 'no_key' | 'empty_prompt' | 'api_error' | 'empty_response' | 'network'; message: string }
      >;
      /** Reference hunt — a visible BrowserWindow (persist:refhunt session) the
       *  user can watch and log into; read the rendered page's images; download
       *  chosen frames through the same session into {project}/_references/. */
      refHuntOpen: (args: { url: string; hidden?: boolean }) => Promise<{ ok: boolean; message?: string }>;
      refHuntRead: () => Promise<
        | { ok: true; url: string; title: string; images: Array<{ src: string; alt: string; w: number; h: number }>; screenshotPath: string }
        | { ok: false; message: string }
      >;
      refHuntDownload: (args: { url: string; projectSlug?: string | null; fileName: string; subfolder?: string; referer?: string }) =>
        Promise<{ ok: true; path: string; bytes: number } | { ok: false; message: string }>;
      /** Capture one <img> element off the rendered hunt page as PNG — Chromium
       *  decodes whatever the CDN serves (AVIF/webp), we keep pixels. */
      refHuntCapture: (args: { src: string; projectSlug?: string | null; fileName: string; subfolder?: string }) =>
        Promise<{ ok: true; path: string; bytes: number } | { ok: false; message: string }>;

      /** Generic per-project JSON sidecar under {slug}/_project/<name>.json —
       *  a cross-tool artifact not owned by any stage (backs the Creative 360 POV). */
      projectDocRead: (args: { id: string; name: string }) => Promise<unknown | null>;
      projectDocWrite: (args: { id: string; name: string; data: unknown }) => Promise<{ ok: boolean }>;
      referenceDeckImport: (args: { projectId: string; sourcePath?: string }) => Promise<{
        ok: boolean; reason?: string; message?: string;
        manifest?: {
          deck: {
            id: string; title: string; sourcePath: string; originalSourcePath?: string;
            manifestPath?: string; pageCount: number; assetCount: number;
            occurrenceCount: number; importedAt: string;
          };
          occurrences: Array<{
            id: string; deckId: string; imagePath: string; page: number; order: number;
            sectionTitle?: string; sceneTitle?: string; bbox?: number[]; pageSize?: number[];
            sourceSize?: number[]; extractionMode?: 'embedded-original' | 'embedded-pixmap' | 'page-render';
            assetHash?: string; fallbackPage?: boolean;
          }>;
        };
      }>;
      referenceSceneImport: (args: {
        projectId: string; sourcePath?: string; sourceKind?: 'reference' | 'generation' | 'device';
        sourceId?: string; name?: string;
      }) => Promise<{
        ok: boolean; reason?: string; message?: string;
        asset?: {
          imagePath: string; sourceKind: 'reference' | 'generation' | 'device';
          sourceId?: string; sourceName: string; assetHash: string; sourceSize?: number[];
        };
      }>;
      referenceSceneUnderstand: (args: {
        rawText: string; imagePath: string; page?: number; sceneTitle?: string;
        intentReferences?: Array<{ imagePath: string; label: string; sourceKind: 'reference' | 'generation' | 'device' }>;
        visualRead?: unknown; slots?: unknown;
      }) => Promise<{ ok: boolean; reason?: string; message?: string; data?: unknown; model?: string }>;
      referenceSceneDrift: (args: {
        sourcePath: string; takePath: string; keepItems: unknown[]; changeItems: unknown[];
        dna?: unknown; dop?: unknown;
      }) => Promise<{ ok: boolean; reason?: string; message?: string; data?: unknown; model?: string }>;
      referenceSceneReviseContract: (args: {
        directorNote: string; reviewNote: string; sourcePath: string; takePath?: string;
        currentContract: unknown; drift?: unknown;
        references?: Array<{ imagePath: string; label: string; sourceKind: string }>;
      }) => Promise<{ ok: boolean; reason?: string; message?: string; data?: unknown; model?: string }>;

      // Creative Mind — Zettel memory (fleeting notes), per-user cross-project
      // at {projectsRoot}/_mind/notes.json.
      mindNotesRead: () => Promise<{ ok: boolean; notes: MindNoteRecord[] }>;
      mindNotesWrite: (args: { notes: unknown[] }) => Promise<{ ok: boolean }>;
      /** Board frame id (`frameset:<query>:<token>`) → saved image path. */
      mindBoardPaths: (args: { ids: string[] }) => Promise<{ ok: boolean; paths: Record<string, string> }>;
      // Ad Breakdown 360 — installed under {projectsRoot}/_mind/breakdowns/;
      // read returns frame paths ABSOLUTE (renderer builds hjen-file:// URLs).
      mindBreakdownsList: () => Promise<{ ok: boolean; breakdowns: Array<{ slug: string; title: string; brand: string; approved: boolean; frames: number }> }>;
      mindBreakdownRead: (args: { slug: string }) => Promise<{ ok: boolean; breakdown?: unknown }>;
      mindBreakdownApprove: (args: { slug: string; approved: boolean }) => Promise<{ ok: boolean }>;
      /** Rename the DISPLAY TITLE only (breakdown.json → ad.title); the folder slug
       *  is immutable (identity key for dna/, sourcePath, job nav). */
      mindBreakdownRename: (args: { slug: string; title: string }) => Promise<{ ok: boolean; title?: string; message?: string }>;
      /** Delete a breakdown — remove the whole _mind/breakdowns/<slug>/ folder. */
      mindBreakdownDelete: (args: { slug: string }) => Promise<{ ok: boolean; message?: string }>;
      /** Render the breakdown as the house A4 treatment PDF and open it. */
      mindBreakdownExportPdf: (args: { slug: string }) => Promise<{ ok: boolean; path?: string; message?: string }>;
      /** Per-breakdown DNA (dna/<axisSlug>.gem.md inside the breakdown folder) —
       *  the forward contract with the factory. List which axis DNAs exist, read one. */
      mindBreakdownDnaList: (args: { slug: string }) => Promise<{ ok: boolean; slugs?: string[] }>;
      mindBreakdownDnaRead: (args: { slug: string; axis: string }) => Promise<{ ok: boolean; text?: string }>;
      /** Write ONE distilled axis DNA (dna/<axis>.gem.md). Used by the run's DNA
       *  stage and the retro "MAKE THE DNAS" action; lights the axis LIVE. */
      mindBreakdownDnaWrite: (args: { slug: string; axis: string; text: string }) => Promise<{ ok: boolean; axis?: string; message?: string }>;
      /** Persist the Arabic re-authoring (الصياغة العربية) beside its breakdown. */
      mindBreakdownWriteArabic: (args: { slug: string; data: unknown }) => Promise<{ ok: boolean }>;
      /** BREAKDOWN run — native ingest (yt-dlp/ffmpeg): download OR local file →
       *  frames + analysis thumbs + audio + captions. Progress streams over
       *  onBreakdownProgress. Returns a meta the renderer feeds to its LLM passes. */
      breakdownIngest: (args: { runId: string; url?: string; filePath?: string; slug?: string }) =>
        Promise<{ ok: boolean; cancelled?: boolean; message?: string; meta?: {
          slug: string; dir: string; durationS: number | null; captions: string;
          transcript: { lang: string; source: 'asr' | 'subs' | 'none'; segments: Array<{ start: number; end: number; text: string; lang?: string }> } | null;
          shots: Array<{ no: number; tcIn: number; tcOut: number; frameIds: string[] }>;
          audioAbs: string | null;
          sourceInfo: { title?: string; uploader?: string | null; webpageUrl?: string | null; uploadDate?: string };
          frames: Array<{ id: string; rel: string; abs: string; t: number }>;
          thumbs: Array<{ id: string; abs: string; t: number }>;
        } }>;
      breakdownCancel: (args: { runId: string }) => Promise<{ ok: boolean }>;
      /** Write the assembled AdBreakdown JSON (frames already placed by ingest). */
      mindBreakdownWrite: (args: { slug: string; breakdown: unknown }) => Promise<{ ok: boolean; slug?: string; message?: string }>;
      /** ASR — transcribe an audio file → timed segments via the configured
       *  engine (local whisper / OpenAI / custom). Never throws; ok:false degrades. */
      breakdownTranscribe: (args: { runId?: string; audioPath: string; config?: unknown }) => Promise<{ ok: boolean; message?: string; transcript?: { lang: string; source: 'asr'; segments: Array<{ start: number; end: number; text: string; lang?: string }> } }>;
      transcriptionConfigRead: () => Promise<{ ok: boolean; config: { engine: 'local-whisper' | 'openai' | 'custom'; model: string; language: string; endpoint?: string } }>;
      transcriptionConfigWrite: (args: { config: unknown }) => Promise<{ ok: boolean; config: { engine: string; model: string; language: string; endpoint?: string } }>;
      /** Dense frames + fine cut candidates for one scene window — the precise
       *  shot resolver's native half. */
      breakdownDenseFrames: (args: { runId?: string; slug: string; videoPath?: string; tcIn: number; tcOut: number; fps?: number }) => Promise<{ ok: boolean; message?: string; frames?: Array<{ id: string; abs: string; t: number }>; candidates?: number[] }>;
      /** Mid-run checkpoint (run-state.json) so an interrupted run can RESUME. */
      breakdownRunstateWrite: (args: { slug: string; state: unknown }) => Promise<{ ok: boolean; message?: string }>;
      breakdownRunstateRead: (args: { slug: string }) => Promise<{ ok: boolean; state?: unknown; message?: string }>;
      breakdownRunstateClear: (args: { slug: string }) => Promise<{ ok: boolean }>;
      onBreakdownProgress: (h: (e: unknown, data: { runId: string; step: string; msg?: string }) => void) => () => void;
      /** Models-per-task config (Settings → Models). Overrides only; defaults
       *  live in src/lib/models/registry.ts. */
      modelsConfigRead: () => Promise<{ ok: boolean; config?: unknown }>;
      modelsConfigWrite: (args: { config: unknown }) => Promise<{ ok: boolean }>;
      /** لغة العرض — content display language ('en' | 'ar' | 'both'), persisted
       *  in {userData}/settings.json. English is always the source. */
      langModeGet: () => Promise<{ ok: boolean; mode?: string }>;
      langModeSet: (args: { mode: string }) => Promise<{ ok: boolean }>;
      /** The one text-LLM door — direct vendor APIs (no middlemen). The
       *  renderer resolves task→provider+model via the registry first. */
      llmJson: (args: { provider: string; model: string; system: string; prompt: string; maxTokens?: number; imagePaths?: string[]; audioPaths?: string[]; promptId?: string; vars?: any; jsonMode?: boolean }) =>
        Promise<{ ok: boolean; text?: string; model?: string; truncated?: boolean; usage?: { inputTokens: number; outputTokens: number }; reason?: string; message?: string }>;
      /** My Mind — the user's curated pipeline DNA at {projectsRoot}/_mind/mymind.json. */
      myMindRead: () => Promise<{ ok: boolean; items: unknown[] }>;
      myMindWrite: (args: { items: unknown[] }) => Promise<{ ok: boolean }>;
      mindBraincardsRead: () => Promise<{ ok: boolean; cards: unknown[] }>;
      mindBraincardsWrite: (args: { cards: unknown[] }) => Promise<{ ok: boolean }>;
      /** Any-file picker (documents / decks / media) for the thinking canvas. */
      pickAnyFiles: (args?: { title?: string }) => Promise<string[] | null>;
      /** Video-file picker for a local BREAKDOWN run (skips download). */
      pickVideoFile: () => Promise<string | null>;
      cutsAnalyze: (args: { sessionId: string; videoPath: string; projectSlug?: string; threshold?: number; stripStep?: number }) => Promise<{
        ok: boolean; reason?: string; message?: string;
        sessionId?: string; videoPath?: string; duration?: number; fps?: number; width?: number; height?: number; dir?: string;
        shots?: Array<{ i: number; start: number; end: number; dur: number; thumb: string }>;
        strip?: Array<{ t: number; path: string }>;
      }>;
      cutsShotFrames: (args: { sessionId: string; videoPath: string; projectSlug?: string; shotIndex: number; start: number; end: number; count?: number }) => Promise<{
        ok: boolean; reason?: string; message?: string; frames?: Array<{ id: string; abs: string; t: number }>;
      }>;
      cutsFetch: (args: { url: string; projectSlug?: string }) => Promise<{
        ok: boolean; reason?: string; message?: string; videoPath?: string; title?: string; cached?: boolean;
      }>;
      cutsEmbed: (args: { sessionId: string; projectSlug?: string; model?: string; shots: Array<{ i: number; frames: string[] }> }) => Promise<{
        ok: boolean; reason?: string; message?: string;
        data?: { vecDim?: number; faceDim?: number; shots?: Array<{ i: number; face?: number[] | null; person?: number[] | null; scene?: number[] | null; hasFace?: boolean }> };
      }>;
      onCutsEmbedProgress?: (h: (e: unknown, d: { line?: string }) => void) => () => void;
      cutsWatch: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; shots: Array<{ i: number; start: number; end: number; frame?: string }> }) => Promise<{
        ok: boolean; reason?: string; message?: string; groups?: Array<{ label?: string; shots?: number[] }>;
      }>;
      cutsPeople: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; shots: Array<{ i: number; start: number; end: number; frame?: string }> }) => Promise<{
        ok: boolean; reason?: string; message?: string;
        people?: Array<{ name?: string; description?: string; appearance?: string; expression?: string; wardrobe?: string; shots?: number[] }>;
      }>;
      cutsVerifyGroups: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; kind: 'scene' | 'person'; groups: Array<{ id: string; label: string; shots: Array<{ i: number; start: number; end: number }> }> }) => Promise<{
        ok: boolean; reason?: string; message?: string;
        groups?: Array<{ id?: string; coherent?: boolean; outliers?: Array<{ shot?: number; confidence?: number; reason?: string }> }>;
        frames?: Array<{ shot: number; path: string }>;
      }>;
      cutsDna: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string }) => Promise<{
        ok: boolean; reason?: string; message?: string; dna?: Record<string, string>;
      }>;
      cutsStory: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; shots: Array<{ i: number; start: number; end: number }> }) => Promise<{
        ok: boolean; reason?: string; message?: string; synopsis?: string; world?: string; continuity?: string;
        shots?: Array<{ i?: number; context?: string }>;
      }>;
      cutsBrief: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; shot: { i: number; start: number; end: number }; keyframe?: string; dna: unknown; story?: unknown; context?: string; neighbours?: string; canon?: string }) => Promise<{
        ok: boolean; reason?: string; message?: string; brief?: Record<string, unknown>;
      }>;
      cutsVerify: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; shots: Array<{ i: number; start: number; end: number; frame?: string }> }) => Promise<{
        ok: boolean; reason?: string; message?: string; merge?: number[][]; split?: Array<{ shot: number; at: number }>;
      }>;
      cutsSpeech: (args: { sessionId: string; projectSlug?: string; videoPath: string; model?: string; duration?: number }) => Promise<{
        ok: boolean; reason?: string; message?: string;
        segments?: Array<{ type?: string; start?: number; end?: number; text?: string; speaker?: string }>;
      }>;
      cutsSave: (args: { projectSlug?: string; sessionId: string; data: unknown }) => Promise<{ ok: boolean; message?: string }>;
      cutsList: (args: { projectSlug?: string }) => Promise<{
        ok: boolean; message?: string;
        sessions?: Array<{ sessionId: string; title?: string; videoPath?: string; duration?: number; shots?: number; scenes?: number; savedAt?: number; projectSlug?: string; project?: string }>;
      }>;
      cutsLoad: (args: { projectSlug?: string; sessionId: string }) => Promise<{ ok: boolean; reason?: string; message?: string; data?: unknown }>;
      cutsDelete: (args: { projectSlug?: string; sessionId: string }) => Promise<{ ok: boolean; message?: string }>;
      cutsSource: (args: { videoPath: string }) => Promise<{ ok: boolean; url?: string; message?: string }>;
      /** Whether the source video file carries an audio stream (ffmpeg probe).
       *  hasAudio is null when it couldn't be determined. */
      cutsHasAudio: (args: { videoPath: string }) => Promise<{ ok: boolean; hasAudio: boolean | null; reason?: string; message?: string }>;
      openExternalUrl: (url: string) => Promise<{ ok: boolean; message?: string }>;

      /** Launch the user's Chrome on a dedicated HJEN profile (Frameset login
       *  persists) with a CDP debug port the renderer drives directly. */
      chromeLaunch: (args: { url: string; headless?: boolean }) => Promise<{ ok: true; port: number; reused?: boolean } | { ok: false; message: string }>;
      chromePage: (args: { port?: number; url?: string }) =>
        Promise<{ ok: true; wsUrl: string; targetId: string; url: string } | { ok: false; message: string }>;
      /** Open a fresh CDP tab (shares the profile login) — one per hunt lane. */
      chromeNewTab: (args: { port?: number; url?: string }) =>
        Promise<{ ok: true; wsUrl: string; targetId: string; url: string } | { ok: false; message: string }>;
      chromeCloseTab: (args: { port?: number; targetId: string }) => Promise<{ ok: boolean }>;
      chromeClose: () => Promise<{ ok: boolean }>;
      saveImageBase64: (args: { base64: string; projectSlug?: string | null; fileName: string; subfolder?: string }) =>
        Promise<{ ok: true; path: string; bytes: number } | { ok: false; message: string }>;
      refHuntClose: () => Promise<{ ok: boolean }>;

      /** Native OS file drag — Finder, another app, or another HJEN window.
       *  Resolves when the DRAG ENDS, so never await it inline in dragstart. */
      startDrag: (paths: string[]) =>
        Promise<{ ok: true; files: number } | { ok: false; message: string }>;

      /** Panel documents (Mood Board · Timeline) — one store, two features. */
      docList: (args: { id: string; kind: string }) =>
        Promise<{ ok: true; docs: PanelDocSummary[] } | { ok: false; message: string }>;
      docRead: (args: { id: string; kind: string; docId: string }) =>
        Promise<{ ok: true; doc: any; healed?: boolean } | { ok: false; reason?: string; message?: string }>;
      docWrite: (args: { id: string; kind: string; docId: string; doc: unknown; sourceId?: string; allowEmpty?: boolean }) =>
        Promise<{ ok: true; rev: number } | { ok: false; reason?: string; doc?: any }>;
      docCreate: (args: { id: string; kind: string; name?: string; doc?: unknown }) =>
        Promise<{ ok: true; doc: any } | { ok: false; message: string }>;
      docDelete: (args: { id: string; kind: string; docId: string }) => Promise<{ ok: boolean }>;
      docImport: (args: { id: string; kind: string; paths: string[] }) =>
        Promise<{ ok: true; files: Array<{ path: string; name: string }> } | { ok: false; message: string }>;
      onDocChanged: (cb: (d: { projectId: string; kind: string; docId: string; sourceId: string; rev: number }) => void) => () => void;

      /** Detached panel windows — the same renderer, told what to be at launch. */
      panelOpen: (args: { kind: string; id: string; docId: string; name?: string }) =>
        Promise<{ ok: true; alreadyOpen: boolean } | { ok: false; message: string }>;
      panelClose: (args: { kind: string; id: string; docId: string }) => Promise<{ ok: boolean }>;
      /** Keys are `${kind}:${projectId}:${docId}`. */
      panelList: () => Promise<{ ok: true; open: string[] }>;
      onPanelWindow: (cb: (d: { projectId: string; kind: string; docId: string; open: boolean }) => void) => () => void;

      /** One cheap ffmpeg stderr read — no ffprobe (see electron/tools.ts). */
      mediaProbe: (args: { path: string; poster?: boolean }) => Promise<MediaProbe>;

      /** Sequence export — the References timeline. Separate channels from the
       *  older exportTimeline* pair, which still serve TimelineDock. */
      exportSequenceMp4: (args: SequenceExportArgs) =>
        Promise<{ ok: true; path: string } | { ok: false; reason?: string; message?: string }>;
      exportSequenceFcpxml: (args: SequenceExportArgs) =>
        Promise<{ ok: true; path: string } | { ok: false; reason?: string; message?: string }>;
      exportCancel: () => Promise<{ ok: boolean; reason?: string }>;
      onExportProgress: (cb: (d: { pct: number; secs: number; total: number }) => void) => () => void;

      /** Character cards (Cast) — portrait + reference photos + locked profile. */
      listCharacterCards: () => Promise<CharacterCard[]>;
      saveCharacterCard: (args: { id?: string; name: string; profile: Record<string, string>; mainAsset: LibraryAsset; referencePaths: string[] }) =>
        Promise<{ ok: boolean; card?: CharacterCard }>;
      deleteCharacterCard: (args: { id: string }) => Promise<{ ok: boolean }>;
      /** Copy approved panel pngs + write the assembled PDF into a user-picked folder. */
      exportStoryboard: (args: { folder: string; pdfBase64: string; panels: Array<{ srcPath: string; fileName: string }>; fileName?: string }) =>
        Promise<{ ok: boolean; reason?: string; written?: number; pdfPath?: string }>;
      /** Copy the reference frames out verbatim (a GIF stays a GIF) + write the
       *  assembled PDF and notes sheet beside them. */
      exportReferences: (args: {
        folder: string;
        baseName?: string;
        /** Wrap everything in <baseName>/ — false drops a lone PDF in the folder. */
        subfolder?: boolean;
        files?: Array<{ srcPath: string; fileName: string }>;
        pdfBase64?: string | null;
        notesCsv?: string | null;
      }) => Promise<{ ok: boolean; reason?: string; dir?: string; written?: number; skipped?: number; pdfPath?: string }>;
      /** Write a single base64 blob (HTML, PPTX, …) to a chosen folder. */
      pitchPdf: (args: { htmlPath: string; widthMm: number; heightMm: number }) =>
        Promise<{ ok: boolean; pdf?: string; reason?: string }>;
      exportFile: (args: { folder: string; fileName: string; base64: string }) =>
        Promise<{ ok: boolean; reason?: string; path?: string }>;
      /** Resolve (and create) a per-tool folder inside the project, e.g. <slug>/Pitch/. */
      projectToolDir: (args: { projectSlug?: string; tool: string }) =>
        Promise<{ ok: boolean; reason?: string; dir?: string }>;
      /** User-fonts folder management (register with the app + install device-wide). */
      fontsDir: () => Promise<string>;
      listFonts: () => Promise<Array<{ family: string; file: string; path: string }>>;
      addFonts: () => Promise<{ ok: boolean; reason?: string; added?: number; fonts?: Array<{ family: string; file: string; path: string }> }>;
      removeFont: (file: string) => Promise<{ ok: boolean; reason?: string; fonts?: Array<{ family: string; file: string; path: string }> }>;
      openFontsDir: () => Promise<boolean>;
      /** Folder picker that opens inside the project's own Storyboard folder. */
      pickExportFolder: (args: { projectSlug?: string; tool?: string; title?: string }) => Promise<string | null>;
      /** Save a storyboard panel/asset OUTSIDE the Frames product (kept in _storyboard/images/). */
      saveStoryboardImage: (args: { base64: string; sidecar: any; promptSlug: string; projectSlug?: string }) =>
        Promise<{ imgPath: string; jsonPath: string; dir: string; thumbPath: string }>;

      getProjectsRoot: () => Promise<string>;
      setProjectsRoot: (root: string) => Promise<{ ok: boolean; root?: string }>;
      pickFolder: () => Promise<string | null>;

      // Save + Finder
      saveGeneration: (args: {
        base64: string;
        sidecar: any;
        promptSlug: string;
        projectSlug?: string;
        projectId?: string;
      }) => Promise<{ imgPath: string; jsonPath: string; dir: string }>;

      // Emulsion (Camera Body × Lens × Film) — dedicated global home.
      saveEmulsion: (args: {
        base64: string;
        compareBase64?: string;
        camera: import('../lib/emulsion').CameraChoice;
        scene?: unknown;
        sourcePath?: string;
        sourceName?: string;
      }) => Promise<{ ok: boolean; imgPath?: string; thumbPath?: string; comparePath?: string }>;
      listEmulsion: () => Promise<EmulsionEvent[]>;
      // Emulsion Video — same look pipeline applied to a whole clip (minutes).
      emulsionVideo: (args: {
        videoPath: string;
        choice: import('../lib/emulsion').CameraChoice;
        skin?: number;
        sky?: number;
        maxw?: number;
      }) => Promise<{ ok: boolean; path?: string; reason?: string; message?: string }>;
      onEmulsionVideoProgress: (h: (e: unknown, data: { i: number; n: number }) => void) => () => void;
      videoFirstFrame: (args: { videoPath: string }) => Promise<{ ok: boolean; path?: string; message?: string }>;

      openFolder: (path: string) => Promise<boolean>;
      revealInFinder: (path: string) => Promise<boolean>;
      /** Download/export a deliverable's master file (web: browser download with a
       *  clean name; desktop: Save-As a named copy). filePath = the gen's imgPath token. */
      downloadGeneration: (a: { filePath: string; name?: string }) => Promise<{ ok: boolean; path?: string; cancelled?: boolean; message?: string }>;

      // Cloud-first sync (desktop only — web has no local folder). Mirrors the
      // account's cloud deliverables into a chosen folder, account-isolated.
      syncGetConfig: () => Promise<{ enabled: boolean; root: string }>;
      syncSetEnabled: (enabled: boolean) => Promise<{ enabled: boolean; root: string }>;
      syncPickFolder: () => Promise<{ ok: boolean; cancelled?: boolean; config?: { enabled: boolean; root: string } }>;
      syncPullNow: () => Promise<{ ok: boolean; message?: string; downloaded?: number; deleted?: number; uploaded?: number; cursor?: number }>;
      onSyncProgress: (cb: (d: { downloaded: number; deleted: number; uploaded?: number; cursor: number; label: string }) => void) => () => void;
      openInBrowser: (path: string) => Promise<{ ok: boolean; message?: string }>;
      moveGeneration: (args: { imgPath: string; targetProjectSlug: string | null; targetProjectId?: string | null }) =>
        Promise<{ ok: boolean; reason?: string; newImgPath?: string; newJsonPath?: string }>;
      deleteGeneration: (args: { imgPath: string }) =>
        Promise<{ ok: boolean; reason?: string }>;

      // Browse
      listProjectFiles: (args: { projectSlug?: string | null }) => Promise<ProjectFileEntry[]>;
      listAllGenerations: () => Promise<GlobalGenerationEntry[]>;
      /** Durable usage history from {projectsRoot}/_generations.jsonl. Survives
       *  deletion of images / projects. Use this for the Usage Report, not
       *  listAllGenerations (which only returns generations whose files are
       *  still on disk). */
      listGenerationsLog: () => Promise<GlobalGenerationEntry[]>;
      /** Files browser source — ONLY present/downloadable deliverables (orphaned
       *  index rows with a missing blob are dropped), each carrying `tool` +
       *  `isVideo` so the UI can group into per-tool folders. */
      filesList: () => Promise<GlobalGenerationEntry[]>;
      readSidecar: (jsonPath: string) => Promise<any | null>;
      readImageDataUrl: (imgPath: string) => Promise<string | null>;
      /** Memory-only, upload-sized copy. The source file remains untouched. */
      readImageUploadDataUrl?: (imgPath: string) => Promise<string | null>;
      pathExists: (p: string) => Promise<boolean>;
      /** Pixel dimensions read from an image file's header. Works even for
       *  images with no saved size metadata (old frames, uploaded refs).
       *  null if the file is missing or the format is unrecognised. */
      imageDims: (path: string) => Promise<{ w: number; h: number } | null>;
      backfillThumbnails: (args: { projectSlug?: string | null }) =>
        Promise<{ processed: number; skipped: number; errors: number }>;

      // Reference library
      listLibrary: () => Promise<LibraryAsset[]>;
      addToLibrary: (args: { category: LibCategory; sourcePath: string; name?: string }) =>
        Promise<{ ok: boolean; reason?: string; asset?: LibraryAsset; deduped?: boolean }>;
      deleteFromLibrary: (args: { id: string }) => Promise<{ ok: boolean }>;
      renameLibraryAsset: (args: { id: string; name: string }) => Promise<LibraryAsset | null>;
      moveLibraryAsset: (args: { id: string; newCategory: LibCategory }) =>
        Promise<{ ok: boolean; reason?: string; asset?: LibraryAsset }>;
      /** One-shot pass: backfill SHA-256 for legacy entries, then collapse
       *  duplicate groups (same hash + category) down to a single survivor.
       *  Returns the new library state + an id-remap so callers can rewrite
       *  layers that pointed to deleted assets. */
      dedupLibrary: () => Promise<{
        ok: boolean;
        backfilled: number;
        removed: number;
        freedBytes: number;
        remap: Record<string, string>;
        survivors: LibraryAsset[];
      }>;
      pickImageFiles: () => Promise<string[] | null>;
      /** Absolute filesystem path of a dropped/selected File (via
       *  webUtils.getPathForFile). Synchronous. '' if unavailable. */
      pathForFile: (file: File) => string;
      pickAudioFiles: () => Promise<string[] | null>;
      /** Load a script / client brief from a text-based file. Returns null if
       *  cancelled, or `{ unsupported: true }` for a binary deck (PDF/DOCX). */
      pickTextDocument: (args?: { title?: string }) => Promise<
        { name: string; text: string; unsupported?: boolean } | null
      >;

      // Browser door (HJEN Clipper) — address, pairing key, and the save
      // methods the app allows. The extension asks; it decides nothing itself.
      clipperStatus: () => Promise<HjenClipperStatus>;
      clipperRevoke: (args: { id: string }) => Promise<HjenClipperStatus>;
      clipperRevokeAll: () => Promise<HjenClipperStatus>;
      clipperSetPrefs: (patch: Partial<HjenClipperPrefs>) => Promise<HjenClipperStatus>;
      clipperDownload: (args: { target: HjenClipperTarget }) => Promise<HjenClipperDownload>;
      toolsStatus: () => Promise<{ ok: boolean; tools: HjenToolStatus[] }>;
      toolsRecheck: () => Promise<{ ok: boolean; tools: HjenToolStatus[] }>;

      // HJEN REF — the internal Saudi reference library (510-ad study).
      // Search-only surface: the library never shows as a browsable gallery.
      refStatus: () => Promise<
        | { ok: true; root: string; frames: number }
        | { ok: false; root: string }
      >;
      refSearch: (args: { query: string; limit?: number }) => Promise<
        | { ok: true; results: HjenRefResult[]; loose?: boolean }
        | { ok: false; reason: 'no_index'; root: string }
      >;

      // Context Agents — DNA-agnostic creative engine. The recipe lives in MAIN;
      // the renderer only sends the state and reads finished output + chosen ids.
      caApply: (args: { profileId: string; register: string; beat: string; energy: string; goal: string }) => Promise<CAApplyResult>;
      caVocab: () => Promise<{ ok: true } & CAVocab>;
      caListMethods: () => Promise<{ ok: true; methods: CACard[] }>;
      caListProfiles: () => Promise<{ ok: true; profiles: CAProfileSummary[] }>;
      caReadCard: (args: { id: string }) => Promise<
        | { ok: true; card: CACard }
        | { ok: false; reason: 'not_found'; message: string }
      >;
      caWriteCard: (args: { card: CACard }) => Promise<
        | { ok: true; id: string; card: CACard }
        | { ok: false; reason: 'bad_card' | 'bad_predicate' | 'write_failed'; message: string }
      >;
      caDeleteCard: (args: { id: string }) => Promise<{ ok: boolean; reason?: string; message?: string }>;
      caReadLexicon: (args?: { status?: string }) => Promise<{ ok: true; entries: CALexiconEntry[] }>;
      caWriteLexiconEntry: (args: { entry: CALexiconEntry }) => Promise<
        | { ok: true; count: number }
        | { ok: false; reason: 'bad_entry' | 'write_failed'; message: string }
      >;
      caStudy: (args: { adId: string; profileId: string; videoPathOrUrl?: string; description?: string; lang?: string }) => Promise<
        | { ok: true; report: string; newCards: string[]; profileId: string }
        | { ok: false; reason: 'bad_args' | 'no_script' | 'study_failed'; message: string }
      >;
      onCaStudyProgress: (cb: (d: { adId: string; profileId: string; line: string }) => void) => () => void;
      caStatus: () => Promise<{ ok: true; root: string; methods: number; profiles: number; lexicon: number; lexiconTrusted: number }>;

      // Context Eye — pick the real reference frame for a feeling. MAIN runs the
      // two-stage eye + the naive baseline; the renderer only judges the columns.
      caEyePick: (args: { register: string; beat: string; energy: string; goal: string }) => Promise<CAEyePickResult>;
      caEyeQuery: (args: { register: string; beat: string; energy: string }) => Promise<CAEyeQueryResult>;
      caEyeConfirmFrames: (args: { register: string; beat: string; energy: string; goal: string; frames: Array<{ id: string; filePath: string }> }) => Promise<CAEyeConfirmResult>;
      caEyeJudge: (args: { state: { register: string; beat: string; energy: string } | null; goal: string; verdict: 'eye' | 'naive' | 'tie'; eyeIds: string[]; naiveIds: string[] }) => Promise<{ ok: boolean; reason?: string; message?: string }>;
      caEyeStatus: () => Promise<{ ok: boolean; criteriaRegisters: string[]; corpusFrames: number }>;

      // ── The Eye — READ. The ten axes of one frame. Recipe stays in MAIN. ──
      eyeRead: (args: { imagePath: string; note?: string; model?: string }) => Promise<{
        ok: boolean; reason?: string; message?: string;
        read?: unknown; thin?: string[]; model?: string; imageHash?: string; ms?: number;
      }>;
      eyeGoldenWrite: (args: { entry: unknown }) => Promise<{ ok: boolean; reason?: string; message?: string }>;
      eyeStatus: () => Promise<{ ok: boolean; root?: string; golden?: number; gradedAxes?: number }>;

      // ── The Swap — the read run backwards. Recipe stays in MAIN. ──────────
      swapSlots: (args: { imagePath: string; read: unknown; model?: string }) => Promise<{
        ok: boolean; reason?: string; message?: string;
        slots?: unknown; thin?: string[]; model?: string; ms?: number;
      }>;
      swapConsequence: (args: { slots: unknown; decisions: unknown; model?: string }) => Promise<{
        ok: boolean; message?: string; follows?: Record<string, string>; model?: string;
      }>;
      swapPlan: (args: { slots: unknown; requirements: unknown[]; model?: string }) => Promise<{
        ok: boolean; message?: string;
        tests?: Record<string, string>; untestable?: string[];
        conflicts?: Array<{ kind: string; between: string[]; message: string }>; model?: string;
      }>;
      swapCompose: (args: {
        slots: unknown; decisions: unknown; requirements: unknown[]; refs: unknown[];
        preserveKeys: string[]; escalate?: string[]; round?: number; subjectOnlyCanny?: boolean; model?: string;
      }) => Promise<{
        ok: boolean; message?: string; prompt?: string;
        requirements?: unknown[]; untestable?: string[]; conflicts?: unknown[];
      }>;
      swapVerify: (args: { takePath: string; requirements: unknown[]; model?: string }) => Promise<{
        ok: boolean; message?: string;
        verdicts?: Array<{ id: string; state: string; evidence: string }>; model?: string;
      }>;
      swapCanny: (args: { imagePath: string; maskPath?: string }) => Promise<{
        ok: boolean; message?: string; cannyPath?: string; available?: boolean;
      }>;
      readSwapDoc: (args: { id: string }) => Promise<unknown | null>;
      writeSwapDoc: (args: { id: string; doc: unknown; allowEmpty?: boolean }) => Promise<{ ok: boolean; reason?: string }>;
      swapGoldenWrite: (args: { entry: unknown }) => Promise<{ ok: boolean; reason?: string; message?: string }>;
      swapStatus: () => Promise<{ ok: boolean; root?: string; golden?: number; judged?: number; agreed?: number }>;

      // IDEA — Saudi Ad Voice Agent Graph (desktop-only runtime).
      ideaStatus?: () => Promise<HjenIdeaStatus>;
      ideaRun?: (args: {
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
      }) => Promise<HjenIdeaRunResponse>;

      // Skills (Anthropic-style markdown skill files)
      listSkills: () => Promise<Skill[]>;
      getSkillsFolder: () => Promise<string>;
      openSkillsFolder: () => Promise<{ ok: boolean; path: string; error?: string }>;
      pickSkillFile: () => Promise<string | null>;
      importSkill: (args: { sourcePath: string }) => Promise<
        | { ok: true; skill: Skill }
        | { ok: false; reason: 'source_not_found' | 'read_failed' | 'no_frontmatter' | 'empty_body' | 'missing_name' | 'already_exists' | 'parse_failed'; existingId?: string; foundKeys?: string[] }
      >;
      saveSkill: (args: { id?: string | null; name: string; description?: string; version?: string; body: string }) => Promise<
        | { ok: true; skill: Skill }
        | { ok: false; reason: 'missing_name' | 'empty_body' | 'not_found' | 'already_exists' | 'parse_failed' | 'write_failed'; existingId?: string; message?: string }
      >;
      deleteSkill: (args: { id: string }) => Promise<{ ok: boolean; reason?: string; message?: string }>;
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
      }) => Promise<
        | { ok: true; masterPrompt: string; usage: { inputTokens: number; outputTokens: number }; usd: number; provider: 'anthropic' | 'openai' | 'google'; model: string; referencesCount: number; settingsHash: string; contractRepaired: boolean; skillId: string; skillName: string }
        | { ok: false; reason: 'no_key' | 'empty_prompt' | 'invalid_skill' | 'skill_not_found' | 'skill_unreadable' | 'api_error' | 'empty_response' | 'network' | 'skill_contract_failed'; message: string }
      >;
      listSkillRuns: () => Promise<SkillRunEvent[]>;

      /* ── Web-only host adapter ─────────────────────────────────────────
       * Present only when the shared renderer runs in the browser build.
       * On desktop these are undefined and __web is falsy. */
      /** True in the web build; undefined/false in the Electron desktop app. */
      __web?: boolean;
      /** The signed-in web account + live credit, or null when signed out.
       *  Web build only. */
      webAccount?: () => Promise<WebAccount | null>;
      /** Clear the web session and redirect to the sign-in landing.
       *  Fire-and-forget — do not await. Web build only. */
      webSignOut?: () => void;
    };
  }
}

/** Signed-in web account snapshot returned by window.hjen.webAccount().
 *  `remaining` is the credit left (integer). Web build only. */
export interface WebAccount {
  ok: boolean;
  name: string;
  email: string;
  plan: string;
  remaining: number;
  genLimit: number;
  genUsed: number;
  daysLeft: number;
  /** Avatar URL, or null/absent when the account has no picture. */
  avatar?: string | null;
  acc?: unknown;
}

export interface SupportUser {
  name?: string;
  email?: string;
  plan?: string;
  host?: string;
}

export interface SupportTicket {
  id: string;
  ts: number;
  kind: string;
  message: string;
  status: 'open' | 'closed';
  user?: SupportUser;
  appVersion?: string;
  platform?: string;
  context?: any;
}

export interface SkillRunEvent {
  ts: number;
  provider?: 'anthropic' | 'openai' | 'google';
  model: string;
  skillId: string;
  skillName: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  rawPromptChars: number;
  masterPromptChars: number;
  rawPromptExcerpt?: string;
  masterPromptExcerpt?: string;
  referencesCount?: number;
  settingsHash?: string;
  contractRepaired?: boolean;
  projectId?: string | null;
  projectSlug?: string | null;
  projectName?: string | null;
}

export interface Skill {
  id: string;             // slug derived from frontmatter `name`, also the filename
  name: string;           // from frontmatter
  description: string;    // from frontmatter (empty string if absent)
  version: string;        // from frontmatter (empty string if absent)
  filePath: string;       // absolute path to the .md on disk
  body: string;           // everything after the frontmatter — used as Claude system prompt
  importedAt: string;     // ISO timestamp from file mtime
  bytes: number;
}

/** One fleeting note in the Creative Mind's Zettel memory (Phase 0: capture only). */
export interface MindNoteRecord {
  id: string;
  text: string;
  tags: string[];
  dimension?: string;
  capturedAt: string;
  status: 'fleeting';
}

/** One HJEN REF search hit — a frame from the 510-Saudi-ad study corpus. */
export interface HjenRefResult {
  id: string;            // "HJC-0106/f01.jpg"
  ad: string;            // "HJC-0106"
  filePath: string;      // absolute path to the frame jpg
  brand: string; company: string; title: string; url: string;
  occasion: string; era: string; region: string;
  q: number;             // ref_quality 0–3 (0 = frame not individually analyzed)
  analyzed: boolean;
  shotSize: string; lightState: string;
  palette: string[]; place: string;
  truthObjects: string[]; dims: string[];
  score: number;
  // ── index v2 · present once the Eye has read this frame ──
  /** false = this frame still has only its six enum tags. */
  hasRead?: boolean;
  /** The 5–10 word key the eye chose AS this frame's handle — show it, it is
   *  the most honest one-line answer to "why did this match?". */
  searchPhrase?: string;
  register?: string;
  energy?: string;
}

// ── Context Agents (DNA-agnostic creative engine) ────────────────────────────
// The renderer sees the small closed-vocab state + the finished texts. The
// recipe (selectMethods, thresholds, prompts) never crosses the IPC boundary.
export interface CAPredicate { register?: string[]; beat?: string[]; energy?: string[] }
export interface CACard {
  id: string;
  craft: string;
  principle: string;
  effect: string;
  when_it_works?: CAPredicate;
  when_it_fails?: CAPredicate | CAPredicate[];
  evidence?: string[];
  weight?: number;
  status?: string;
  source?: string;
}
export interface CAProfileSummary { id: string; name: string }
export interface CALexiconEntry {
  expression: string;
  meaning: string;
  usage: string;
  register?: string;
  example?: string;
  confidence?: string;
  verify?: string;
  verify_why?: string;
  status?: string;
  seen_in?: string[];
}
export interface CAVocab { registers: string[]; beats: string[]; energies: string[] }
// ── Context Eye — the EYE's pick vs the naive baseline, judged by the owner ──
export interface CAEyeFrame {
  id: string;
  filePath: string;   // absolute; render via hjenFileUrl()
  fitScore: number;   // VLM pixel-fit 0-5
  metaScore: number;  // metadata prefilter score
  brand?: string;
  place?: string;
  why: string;        // the VLM's few-word reason
}
export interface CANaiveFrame { id: string; filePath: string; brand?: string; place?: string }
export interface CAEyePickResult {
  ok: boolean;
  reason?: string;
  message?: string;
  eye?: CAEyeFrame[];
  naive?: CANaiveFrame[];
  state?: { register: string; beat: string; energy: string };
  /** The ranking carried no signal — every candidate scored the same, so the
   *  "eye" column is just the input order. Never judge a degenerate pair. */
  degenerate?: boolean;
}
// Frameset path: MAIN returns the smart search query built from the distilled
// criteria; the renderer harvests, then MAIN pixel-fit-ranks the supplied frames.
export interface CAEyeQueryResult {
  ok: boolean;
  reason?: string;
  message?: string;
  query?: string;
  state?: { register: string; beat: string; energy: string };
}
export interface CAEyeConfirmResult {
  ok: boolean;
  reason?: string;
  message?: string;
  eye?: CAEyeFrame[];   // VLM pixel-fit ranking of the harvested Frameset frames
  state?: { register: string; beat: string; energy: string };
  /** Every candidate scored the same — the ranking is the input order. */
  degenerate?: boolean;
}
export interface CAApplyResult {
  ok: boolean;
  reason?: string;
  message?: string;
  state?: { register: string; beat: string; energy: string };
  methods?: Array<{ id: string; craft: string; confirmed: boolean }>;
  profile?: { id: string; name: string };
  lexiconCount?: number;
  use1?: string;
  use2?: string;
  use3?: string;
}

export type LibCategory = 'character' | 'wardrobe' | 'location' | 'prop' | 'general' | 'pose' | 'expression' | 'composition' | 'audio' | 'movement';

export interface LibraryAsset {
  id: string;
  category: LibCategory;
  name: string;
  filename: string;
  filePath: string;
  thumbPath: string;
  addedAt: string;
  bytes: number;
  origin?: string;
  /** SHA-256 of file contents. Optional on entries written before
   *  content-hashing was introduced. */
  contentHash?: string;
}

/** A Cast character card — a portrait Library asset bundled with the extra
 *  reference photos it was read from and the locked profile. */
export interface CharacterCard {
  id: string;
  name: string;
  profile: Record<string, string>;
  mainAsset: LibraryAsset;
  references: { filePath: string; name: string }[];
  savedAt: string;
  version: number;
}

export interface GlobalGenerationEntry {
  imgPath: string;
  thumbPath?: string;
  jsonPath: string;
  dateFolder: string;
  baseName: string;
  ts: number;
  captured: string | null;
  promptTitle: string;
  finalSize?: string;
  modelLabel?: string;
  quality?: string;
  resolution?: string;
  aspect?: string;
  costUsd?: number;
  durationMs?: number;
  referencesCount: number;
  projectId: string | null;
  projectName: string;
  projectSlug: string;
  /** Which tool made this deliverable (frame | video | storyboard | breakdown | …) —
   *  drives the per-tool folders in the Files browser. Present on filesList() items. */
  tool?: string;
  isVideo?: boolean;
}

/** Serializable snapshot persisted to disk for each in-flight generation.
 *  Used to detect interrupted jobs after a crash / forced quit and offer
 *  the user a restore-into-Studio button. We do NOT store full layer images
 *  — just enough metadata + filepaths to rebuild the prompt + selections. */
export interface PendingJobPayload {
  id: string;
  /** Discriminator — an image (Frame) generation. Absent on legacy payloads
   *  written before video pending-jobs existed; treated as 'image'. */
  kind?: 'image';
  ts: number;                        // when the generation was started
  promptTitle: string;
  modelLabel: string;
  aspect: string;
  resolution: string;
  selections: Record<string, any>;   // serializeSelections() output
  layers: Array<{
    id: string;
    assetId: string;
    category: string;
    name: string;
    customName?: string;
    parentLayerId?: string;
    groupName?: string;
    filePath: string;
    thumbPath: string;
  }>;
  project: { id: string; name: string; slug: string } | null;
}

/** Serializable snapshot persisted the moment a VIDEO generation's server task
 *  is accepted (Seedance returns a taskId). Unlike an image job, a video job
 *  keeps rendering SERVER-SIDE after the app is cut off — so on next launch we
 *  re-poll `taskId` and can still retrieve/download the finished clip. Written
 *  to the SAME {projectsRoot}/_pending store (discriminated by `kind:'video'`)
 *  and deleted once the clip is saved or the task is proven dead. */
export interface PendingVideoPayload {
  id: string;
  kind: 'video';
  ts: number;
  /** The BytePlus/Seedance server task id — the recovery key. */
  taskId: string;
  promptTitle: string;
  /** Full prompt actually sent to the model (post DOP-suffix / layer). */
  prompt: string;
  promptFull?: string;
  modelId?: string;
  model?: string;
  imagePath?: string | null;
  endImagePath?: string | null;
  resolution: string;
  duration: number;
  ratio: string;
  fps: number;
  seed?: number | null;
  cameraFixed?: boolean;
  watermark?: boolean;
  audio?: boolean;
  /** Where to save on recovery. */
  promptSlug: string;
  project: { id: string; name: string; slug: string } | null;
  /** Sidecar extras carried through so a recovered clip restores like a live one. */
  videoRefs?: any[];
  rawUserPrompt?: string;
  selectionsSnapshot?: Record<string, any> | null;
  /** Backend routing for crash recovery. Absent (or 'seedance') → the legacy
   *  Seedance resume path; 'kling' → resumeKling(). The fields below carry the
   *  Kling-only params needed to rebuild KlingParams on recovery (Seedance reads
   *  none of them). `ratio` doubles as the Kling aspectRatio. */
  provider?: 'seedance' | 'kling';
  videoType?: 'text2video' | 'image2video';
  mode?: string;                   // Kling std|pro|4k
  cfgScale?: number | null;
  negativePrompt?: string | null;
  sound?: boolean;
}

/** Captured when a generation finishes with an error so the user can
 *  inspect the exact prompt + references that were sent and debug. */
export interface FailedJobPayload extends PendingJobPayload {
  errorMessage: string;
  assembledPrompt: string;   // the full string that went to the image model
  apiSize: string;           // e.g. "2944x1264"
  quality: string;           // mapped api quality (low/medium/high)
}

export interface EnhancementEvent {
  ts: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  referencesCount: number;
  rawPromptChars: number;
  enhancedPromptChars: number;
  rawPromptExcerpt?: string;
  enhancedPromptExcerpt?: string;
  projectId?: string | null;
  projectSlug?: string | null;
  projectName?: string | null;
}

// One entry per Emulsion render saved to {projectsRoot}/Emulsion/.
export interface EmulsionEvent {
  ts: number;
  imgPath: string;
  thumbPath?: string;
  jsonPath: string;
  /** {base}_compare.png — original | edited side-by-side, saved on every Apply. */
  comparePath?: string;
  /** The full CameraChoice used, so the Library can restore the exact look. */
  camera: import('../lib/emulsion').CameraChoice;
  /** The ORIGINAL frame path — reopen re-derives from this (no emulsion stacking). */
  sourcePath?: string;
  sourceName?: string;
}

export interface ProjectFileEntry {
  imgPath: string;
  thumbPath?: string;
  jsonPath: string;
  dateFolder: string;
  baseName: string;
  promptTitle: string;
  size?: string;
  /** MADE quality tier from the sidecar (LOW|MED|HIGH). Absent for older
   *  frames made before quality was recorded. */
  quality?: string;
  ts: number;
  costUsd?: number;
  durationMs?: number;
  modelLabel?: string;
}

/** Returned by hjen.listProjectVideos. Same shape as ProjectFileEntry plus
 *  motion-specific fields (clip length, aspect). `imgPath` points at the
 *  .mp4 on disk so the existing hjen-file:// pipeline streams it without
 *  special-casing. */
export interface VideoFileEntry extends ProjectFileEntry {
  videoSeconds?: number;
  ratio?: string;
  /** Kling quality tier (std|pro|4k). Seedance carries its tier in `size`
   *  (720p|1080p|4k); one of the two is present per backend. */
  mode?: 'std' | 'pro' | '4k';
}

/** Snapshot persisted when a video generation fails. Same role as
 *  FailedJobPayload but with motion-specific fields. Keyed by uuid;
 *  written to {projectsRoot}/_failed_videos/{id}.json. */
export interface FailedVideoPayload {
  id: string;
  ts: number;
  promptTitle: string;
  errorMessage: string;
  prompt: string;
  promptFull?: string;
  imagePath?: string | null;
  endImagePath?: string | null;
  resolution: string;
  duration: number;
  ratio: string;
  fps: number;
  seed?: number | null;
  cameraFixed?: boolean;
  watermark?: boolean;
  audio?: boolean;
  modelId?: string;
  project: { id: string; name: string; slug: string } | null;
}
export {};
