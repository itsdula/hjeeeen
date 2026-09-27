import { create } from 'zustand';
import type { Catalog, Selections, Quality, Resolution, ModelId, StylePreset } from './types/catalog';
import type { ProjectMeta, ProjectFileEntry, LibraryAsset, LibCategory, PendingJobPayload, PendingVideoPayload, FailedJobPayload, FailedVideoPayload, Skill, ProjectState, StageNumber, ProjectLedgerEntry } from './types/hjen-bridge';
import { runLayer, type LayerRun } from './lib/compiler';

/** A single in-flight generation request. Removed when the request resolves or fails. */
export interface Job {
  id: string;
  promptTitle: string;
  startedAt: number;
  modelLabel: string;
  aspect: string;
  resolution: string;
  bgId?: string;        // linked BgJob id, so the reconciler can finish it too
}

/** A Seedance video job — lives in the store so navigation away from the
 *  Video page doesn't lose track of running jobs. Each runSeedance promise
 *  writes back here via updateVideoJob, surviving component unmounts. */
export type VideoJobPhase = 'submitting' | 'queued' | 'running' | 'downloading' | 'saving' | 'done' | 'failed';
export interface VideoJob {
  id: string;
  startedAt: number;
  finishedAt?: number;
  // Input snapshot — preserved so the user can re-click a finished job and
  // restore the exact form that produced it.
  prompt: string;
  promptTitle: string;
  sourcePath: string | null;
  endFramePath: string | null;
  resolution: '480p' | '720p' | '1080p' | '4k';
  duration: number;
  ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  fps: number;
  seed: number | null;
  cameraFixed: boolean;
  watermark: boolean;
  audio: boolean;
  modelId: string;
  // Live state
  phase: VideoJobPhase;
  status?: string;
  taskId?: string;
  // Outcome
  resultPath?: string;
  error?: string;
  /** completion_tokens from BytePlus usage object — drives cost calc. */
  tokens?: number;
  /** USD estimate using pricing.ts rate. Recomputed on each successful save. */
  estimatedUsd?: number;
}

/** A reference attached to the current Video generation. Same role as Layer
 *  in Frames, but flatter — Seedance doesn't have parent/child semantics.
 *  Picked from the Library via the right-rail [+] picker; persists in the
 *  store across navigation. */
export interface VideoRef {
  id: string;          // attach-id, distinct from assetId (so user can attach same asset twice)
  assetId: string;
  category: LibCategory;
  filePath: string;
  thumbPath: string;
  name: string;
}

export interface VideoJobInput {
  prompt: string;
  sourcePath: string | null;
  endFramePath: string | null;
  resolution: '480p' | '720p' | '1080p' | '4k';
  duration: number;
  ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  fps: number;
  seed: number | null;
  cameraFixed: boolean;
  watermark: boolean;
  audio: boolean;
  modelId: string;
  /** Refs attached at submit time — persisted in the sidecar so a single
   *  click on the past video restores them into the right rail. */
  videoRefs?: VideoRef[];
  /** The raw user prompt (before DOP suffix was appended). Stored so the
   *  click-to-restore flow drops the editable text back into the form
   *  without the auto-generated cinematography paragraph polluting it. */
  rawUserPrompt?: string;
  /** Snapshot of the DOP selections used at submit time. Restored back
   *  into the global selections store when the user clicks this past
   *  video — so the chips refill alongside the form. */
  selectionsSnapshot?: Record<string, any>;
}
import { loadCatalog } from './lib/catalog';
import { migrateMovementId } from './lib/cameraMovements';
import { beginBreakdownResume } from './lib/breakdown/resume';
import { HJEN_DNA_IDS } from './lib/dna';
import { buildPrompt, detectPromptRenderMode } from './lib/promptBuilder';
import type { GenerateResult } from './lib/openai';
import { MODELS, mapQuality, resolveSize } from './lib/models';
import { estimateCost } from './lib/pricing';
import { initialSelections } from './lib/selectionsDefault';
import { runFrameGeneration, isGatewayActive, gatewayConf } from './lib/frameGen';
import { buildAnglePrompt, buildPackAnglePrompt } from './lib/cameraAngles';
import type { FrameSlots, SlotDecisions, Requirement, Verdict, SwapRound } from './lib/swap/types';
import { preserveSet, preserveSetFull } from './lib/swap/deps';
import { toRequirements, firstRound, advanceLadder } from './lib/swap/ledger';
import { lockPlanFor } from './lib/swap/lock';
import { orderSwapRefs, refsToLayers } from './lib/swap/refs';
import { buildPlates } from './lib/swap/plates';
import { swapCompose, swapVerify } from './lib/swap/engine';
import { findEntity, patchEntity, linkBuiltRefToShots, foldLegacy } from './lib/breakdown/entityEdit';
// NODE engine — generic node-graph framework (Griptape-style) wired to HJEN products.
import type { NodeInstance, GraphEdge, NodeRuntime } from './lib/node-engine/types';
import type { EdgeStyle } from './lib/node-engine/edgeRoute';
import type { ClipPayload } from './components/node/nodeClipboard';
import { GraphEngine } from './lib/node-engine/engine';
import { getNodeSpec } from './lib/node-engine/registry';
import { registerBuiltinNodes } from './lib/node-engine/nodes';
import { graphToDoc, docToGraph } from './lib/node-engine/serialize';
import type { SpacePlan, PlanStep } from './lib/space/plan';

/** The two node-graph workspaces. HJEN NODE is the orchestration pipeline (it
 *  owns the Sequence timeline + the Edit sequencer); HJEN SPACE is the same
 *  infinite board with the sequence removed — a pure spatial workspace. They
 *  are separate TOOLS with separate files, never two views of one board. */
export type GraphScope = 'node' | 'space';
/** Per-scope graph file key. The desktop host maps this to a folder
 *  (_node / _space); the web host maps it to a project-doc key. */
export const GRAPH_SCOPE_KEY: Record<GraphScope, 'graph' | 'space-graph'> = {
  node: 'graph', space: 'space-graph',
};

export type TimelineTrack = 'V2' | 'V1' | 'A1' | 'A2';
/** One clip on the docked timeline. Time fields are in seconds. */
export interface TimelineClip {
  id: string;
  nodeId: string;
  kind: 'video' | 'image' | 'audio';
  track: TimelineTrack;
  start: number;
  duration: number;
  label: string;
  thumb?: string;   // hjen-file:// or url for the clip poster (UI)
  src?: string;     // absolute media file path (video/image) — used by export (ffmpeg/XML)
  inPoint?: number; // source trim offset (seconds) — set by split / set-in
}
import { applyTheme, readCachedTheme, readCachedAppearance, readCachedHubTiles, readCachedBgShade, BG_SHADE_THEME } from './lib/theme/apply';
import { DEFAULT_THEME, getBuiltin, normalizeTheme } from './lib/theme/presets';
import { cloneTheme, makeThemeId, isValidTheme, type Theme, type ThemePatch, type Appearance, type HubTiles } from './lib/theme/types';

type ActivePicker = null | 'angle' | 'movie' | 'photographer' | 'camera' | 'lens' | 'stock' | 'lighting' | 'movement' | 'focal' | 'aperture' | 'aspect' | 'settings' | 'projects' | 'details' | 'library';

/** Every navigable surface the app can render. Navigation is state, not routes —
 *  App.tsx renders one view by this value. Kept as a single source of truth so
 *  the store field, the setter, and the Tab model all share one union. */
export type ActiveView =
  | 'studio' | 'apphub' | 'frame' | 'enhancer' | 'emulsion' | 'video' | 'node' | 'space' | 'cast' | 'world'
  | 'projects' | 'project' | 'storyboard' | 'library' | 'files' | 'usage' | 'pricing'
  | 'learn' | 'support' | 'settings' | 'mcp' | 'brief' | 'creativemind'
  | 'story' | 'treatment' | 'references' | 'pitch' | 'advisor' | 'breakdown'
  | 'shotlist'
  | 'log' | 'cuts' | 'idea' | 'angles' | 'filmspace' | 'ca-studio' | 'ca-trainer' | 'ca-eye' | 'eye' | 'swap' | 'reference-maker'
  // The four asset factories — stage 06 of the project contract.
  | 'a-character' | 'a-location' | 'a-prop' | 'a-wardrobe';

/** A browser-style tab. Each tab captures a full navigation state — which
 *  view, which project, plus any per-view ephemeral sub-state needed to
 *  restore it (e.g. an open breakdown slug). `activeView` / `activeProjectId`
 *  remain the live render source; tabs are saved navigation snapshots that get
 *  applied on switch, and the ACTIVE tab is kept in sync with the live nav. */
export interface Tab {
  id: string;
  /** Live view this tab points at. */
  view: ActiveView;
  /** Project bound to this tab, or null for project-agnostic surfaces. */
  projectId: string | null;
  /** View-specific ephemeral state to restore on switch (session-lifetime). */
  sub?: Record<string, unknown>;
  /** Browser-style page history owned by this tab. Session-lifetime only. */
  history?: TabHistoryEntry[];
  /** Pages left by Back and available to Forward. Session-lifetime only. */
  forward?: TabHistoryEntry[];
}

export interface TabHistoryEntry {
  view: ActiveView;
  projectId: string | null;
  sub?: Record<string, unknown>;
}

let tabIdSeq = 0;
const newTabId = () => `tab-${Date.now().toString(36)}-${(tabIdSeq++).toString(36)}`;
const INITIAL_TAB_ID = newTabId();

// Views that stand on their own — their tab title never carries a project name.
const GLOBAL_VIEWS: ReadonlySet<ActiveView> = new Set<ActiveView>([
  'studio', 'apphub', 'projects', 'library', 'files', 'usage', 'pricing', 'learn', 'support', 'settings', 'mcp', 'log', 'cuts', 'idea',
  // Context Agents runs against a shared library, not a per-project contract.
  'ca-studio', 'ca-trainer', 'ca-eye',
  // The Eye bench reads any frame from anywhere — it belongs to no project.
  'eye',
]);
const VIEW_TITLES: Record<ActiveView, string> = {
  studio: 'Studio', apphub: 'App', frame: 'Frame', enhancer: 'Enhancer', emulsion: 'Emulsion', video: 'Video',
  node: 'Node', space: 'HJEN SPACE', cast: 'Cast', world: 'HJEN SET', projects: 'Projects',
  project: 'Project', storyboard: 'Storyboard', library: 'Library', files: 'Files', usage: 'Usage',
  pricing: 'Pricing', learn: 'Learn', support: 'Support', settings: 'Settings',
  mcp: 'MCP', brief: 'Brief Mind', creativemind: 'Creative Mind', story: 'Story',
  treatment: 'Direction', references: 'References', pitch: 'Pitch', shotlist: 'Shotlist',
  advisor: 'Creative Advisor', breakdown: 'Breakdown', log: 'Operations',
  cuts: 'Cuts Engine', idea: 'IDEA', angles: 'Camera Angles', filmspace: 'Film Space',
  'ca-studio': 'Context Studio', 'ca-trainer': 'Context Trainer', 'ca-eye': 'Context Eye',
  eye: 'The Eye', swap: 'The Swap', 'reference-maker': 'Reference Maker',
  'a-character': 'Character', 'a-location': 'Location', 'a-prop': 'Prop', 'a-wardrobe': 'Wardrobe',
};
/** Human-readable tab label derived from (view, project). Project-scoped views
 *  read "Project · Tool"; global surfaces read the tool name alone. */
export function tabTitle(view: ActiveView, projectId: string | null, projects: ProjectMeta[]): string {
  const base = VIEW_TITLES[view] ?? 'Studio';
  if (GLOBAL_VIEWS.has(view) || !projectId) return base;
  const name = projects.find(p => p.id === projectId)?.name;
  return name ? `${name} · ${base}` : base;
}

// ===== Background jobs — the app-wide operations subsystem =====
// Any long-running operation the user starts keeps RUNNING even if they leave
// the page. It is registered here as a BgJob (single source of truth) and
// surfaces on four surfaces: a red/green job-tab in the TabStrip, the global
// StatusBar, its last-10 popover, and the Operations LOG view. The store is
// in-memory (like videoJobs) so the running promise still has a valid target
// after the launching component unmounts — leaving a view never loses the run.
// Named BgJob to avoid collision with the image-generation `Job` interface.
export type JobStageState = 'pending' | 'active' | 'done' | 'error' | 'interrupted';
/** One step in an operation's completion sequence (e.g. FETCH → READ → WRITE). */
/** One orphaned BUILD REFERENCE surfaced by the ORPHANED REFERENCES sweep — a
 *  built reference image on disk (sidecar `breakdownEntity`) that no entity's
 *  history in the current breakdown points at anymore. `matched` = its entity id
 *  still exists in the roster (so RESTORE can re-append it); when false the ref is
 *  viewable but unmatched (RESTORE disabled). Nothing here is ever deleted. */
export interface OrphanRef {
  imgPath: string;
  thumbPath?: string;
  id: string;
  kind: 'person' | 'place' | 'asset';
  part?: 'face' | 'sheet';
  at: string;            // sidecar.captured, else the file mtime as ISO
  dateFolder: string;
  matched: boolean;
}
export interface JobStage { key: string; label: string; state: JobStageState }
/** running · done · error, plus `interrupted` — the app quit/crashed while the
 *  op was running (the renderer that drove it is gone). NOT a failure: the work
 *  it completed is checkpointed on disk and can be RESUMED from there. */
export type JobStatus = 'running' | 'done' | 'error' | 'interrupted';
/** Where clicking a completed job navigates back to — the view+project+sub
 *  where the work was started, so a finished job returns you to its home. */
export interface JobNav { view: ActiveView; projectId: string | null; sub?: Record<string, unknown> }
export interface BgJob {
  id: string;
  /** Operation family — 'breakdown-run' | 'breakdown-dna' | 'breakdown-master' | … */
  kind: string;
  title: string;
  projectId: string | null;
  nav: JobNav;
  stages: JobStage[];
  status: JobStatus;
  /** Free-text progress line (e.g. "3 / 13 axes") shown under the stage rail. */
  progressText?: string;
  createdAt: number;
  doneAt?: number;
  error?: string;
  /** Hidden from the TabStrip (still kept in history + the LOG view). */
  dismissedFromTab?: boolean;
  /** When an `interrupted` job has been RESUMED, this points to the fresh job
   *  that continues its unfinished work from the on-disk checkpoint. Presence
   *  swaps the LOG's RESUME button for a "Resumed →" link and blocks a second
   *  resume of the same run. */
  resumedJobId?: string;
}
/** Bounded history for the LOG page — keep the most recent N operations. */
const JOB_HISTORY_CAP = 50;
let bgJobSeq = 0;
const newBgJobId = () => `bgjob-${Date.now().toString(36)}-${(bgJobSeq++).toString(36)}`;
/** Advance a stage list so `activeKey` is active, everything before it done,
 *  everything after it left as-is (already-done stages stay done). */
function advanceStages(stages: JobStage[], activeKey: string): JobStage[] {
  const idx = stages.findIndex(s => s.key === activeKey);
  if (idx < 0) return stages;
  return stages.map((s, i) => {
    if (i < idx) return s.state === 'error' ? s : { ...s, state: 'done' };
    if (i === idx) return { ...s, state: 'active' };
    return s;
  });
}

// ===== Theme helpers (module-level) =====
/** Resolve a theme id to a concrete Theme (built-in or custom, default fallback). */
function resolveTheme(id: string, customThemes: Theme[]): Theme {
  return getBuiltin(id) || customThemes.find(t => t.id === id) || DEFAULT_THEME;
}
/** Debounced write-through so live editing doesn't hammer the disk. */
let themePersistTimer: ReturnType<typeof setTimeout> | null = null;
function persistThemeConfig(activeThemeId: string, customThemes: Theme[], appearance: Appearance, hubTiles: HubTiles, bgShade: string) {
  if (themePersistTimer) clearTimeout(themePersistTimer);
  themePersistTimer = setTimeout(() => {
    window.hjen.setThemeConfig({ version: 1, activeThemeId, customThemes, appearance, hubTiles, bgShade }).catch(() => {});
  }, 350);
}

/** Debounced write-through of the operations log to {userData}/jobs.json — the
 *  crash/quit-resilience mirror. Called on every meaningful BgJob transition
 *  (start / stage advance / finish / dismiss / resume). The snapshot is captured
 *  synchronously (bgJobs arrays are replaced immutably on each set), so a queued
 *  write always persists the latest state. */
let jobsPersistTimer: ReturnType<typeof setTimeout> | null = null;
function persistJobs(jobs: BgJob[]) {
  const snapshot = jobs;
  if (jobsPersistTimer) clearTimeout(jobsPersistTimer);
  jobsPersistTimer = setTimeout(() => {
    window.hjen.jobsWrite({ jobs: snapshot }).catch(() => {});
  }, 300);
}

export const MAX_LAYERS = 14;
export const LAYER_CATEGORIES: Array<{ id: LibCategory; label: string }> = [
  { id: 'character',   label: 'Characters' },
  { id: 'composition', label: 'Composition' },
  { id: 'prop',        label: 'Props' },
  { id: 'location',    label: 'Set' },
  { id: 'general',     label: 'General' },
];

/** A reference attached to the current generation. */
export interface Layer {
  /** stable per-attach id (different from library asset id, in case user attaches same asset twice) */
  id: string;
  assetId: string;
  category: LibCategory;
  /** Base name from the library asset. Display fallback. */
  name: string;
  /** Per-generation rename (optional). Takes precedence over `name` in UI + prompt. */
  customName?: string;
  /** Hierarchical parent — used by wardrobe/accessory layers to bind to a character.
   *  When set, the layer is rendered nested under its parent character in the sidebar
   *  and described in the prompt as belonging to that subject. */
  parentLayerId?: string;
  /** Legacy free-form group (older sidecars). Still respected as a fallback. */
  groupName?: string;
  thumbPath: string;
  filePath: string;
}

/** Last successful Claude enhancement on the current prompt. Used by the UI
 *  to show "Undo enhancement" + the cost of the call. Cleared whenever the
 *  user manually edits the prompt or runs Enhance again. */
export interface PromptEnhancement {
  originalPrompt: string;
  enhancedPrompt: string;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  ts: number;
}

/**
 * A skill run uses the Settings-selected Frame Skills model to transform the textarea prompt into a
 * "Master Prompt" *transparently inside Generate*. The master prompt is
 * what actually hits the image API. The user never sees it in the textbox —
 * it's recorded in the sidecar so the full chain (original → optional enhanced
 * → master) is preserved alongside the generated image.
 */
export interface PromptMasterRun {
  originalPrompt: string;     // textarea content at the moment Generate was clicked
  masterPrompt: string;       // selected text model's output — what was sent to the image API
  skillId: string;
  skillName: string;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  provider?: 'anthropic' | 'openai' | 'google';
  model: string;
  referencesCount?: number;
  settingsHash?: string;
  contractRepaired?: boolean;
  ts: number;
}

/** A locally saved Frame look. Scene copy is deliberately excluded: presets
 *  carry the camera/film/output setup, never the shot the user is writing. */
export interface DnaPresetSettings {
  angle: string | null;
  movie: string | null;
  photographer: string | null;
  camera: string | null;
  lens: string | null;
  stock: string | null;
  lighting: string | null;
  movement: string | null;
  focal_mm: number | null;
  aperture_f: number | null;
  aspect: string;
  resolution: Resolution;
  quality: Quality;
  model: ModelId;
  style_preset: StylePreset;
}

export interface DnaPreset {
  id: string;
  name: string;
  description: string;
  settings: DnaPresetSettings;
  createdAt: number;
  updatedAt: number;
}

const CLAY_BASIL_DNA_PRESET_ID = 'hjen-dna-clay-basil';
const DNA_PRESETS_PREF_KEY = 'hjen.framePresets.v2';
const LEGACY_DNA_PRESETS_PREF_KEY = 'hjen.framePresets.v1';
const DNA_PRESET_KEYS = new Set<keyof Selections>([
  'angle', 'movie', 'photographer', 'camera', 'lens', 'stock', 'lighting',
  'movement', 'focal_mm', 'aperture_f', 'aspect', 'resolution', 'quality',
  'model', 'style_preset',
]);

interface Store {
  catalog: Catalog | null;
  catalogReady: boolean;
  selections: Selections;
  activePicker: ActivePicker;
  history: GenerateResult[];
  current: GenerateResult | null;
  /** In-flight generation jobs, one per click of Generate */
  jobs: Job[];
  /** Seedance video jobs — survives VideoView unmount. Includes in-flight,
   *  completed, failed, and synthesized "past video" entries the user
   *  clicked from the sidebar. */
  videoJobs: VideoJob[];
  /** Which video job's result is shown in the right pane. null = latest done. */
  focusedVideoJobId: string | null;
  /** References attached to the next Video generation — analogue of `layers`
   *  in Frames. User adds via right-rail [+] button. Persists across nav. */
  videoRefs: VideoRef[];
  /** App-wide background operations — running + finished (bounded history).
   *  Single source of truth for the job-tab, StatusBar and LOG surfaces. */
  bgJobs: BgJob[];
  /** When set, the LOG view auto-expands this stopped op's error detail and
   *  scrolls it into view — used when a STOPPED job-chip routes to the LOG so
   *  the user lands ON the failure, not in an anonymous list. Cleared once read. */
  logFocusJobId: string | null;
  /** The global bottom StatusBar is a CORE bar (a future settings toggle can
   *  hide it). true by default. */
  statusBarVisible: boolean;
  /** True if at least one generation is in flight (derived from jobs) */
  generating: boolean;
  /** True while Claude enhancement is being computed */
  enhancing: boolean;
  /** Most recent enhancement on the current prompt; null if undone or none yet */
  lastEnhancement: PromptEnhancement | null;
  /** Most recent skill run (master prompt) attached to the last Generate. null
   *  until at least one Generate-with-skill has completed. Used by the
   *  GenerationPreview sidecar to render the chain. */
  lastMasterRun: PromptMasterRun | null;
  /** Jobs persisted to disk that survived an app restart — the API call
   *  was either lost mid-flight or completed server-side without the
   *  client ever receiving the response. Surface these to the user so
   *  they know what happened. */
  interruptedJobs: PendingJobPayload[];
  /** Jobs that ran but were rejected by the API (safety filter, content
   *  policy, transient network errors). Kept on disk for debugging so
   *  the user can click into one and see exactly what was sent. */
  failedJobs: FailedJobPayload[];
  /** When set, the FailedJobInspector modal is showing this entry. */
  inspectingFailedJob: FailedJobPayload | null;
  error: string | null;

  // UI state
  sidebarOpen: boolean;
  layersOpen: boolean;
  /** Left-side DOP (Director of Photography) panel — slides in when the
   *  user clicks the DOP button. Holds Framing, Style, Camera Gear,
   *  Lighting & Movement sections. */
  dopOpen: boolean;
  /** When the DOP is opened FROM a Node canvas Frame node, this holds that
   *  node's id so selection edits write back into the node's `dop` param.
   *  null on the Studio Frame path (which edits global selections only). */
  dopTargetNodeId: string | null;
  activeView: ActiveView;
  /** Browser-style tabs — the app's open workspaces. Always ≥1. The active
   *  tab mirrors the live (activeView, activeProjectId); switching a tab
   *  applies that tab's saved navigation state. */
  tabs: Tab[];
  activeTabId: string;
  /** Global MCP dock (the Assistant drawer) — pinned in the top bar, available
   *  on EVERY view. One unified surface; the Node-canvas button opens it too. */
  mcpDockOpen: boolean;
  /** When set, a fullscreen lightbox of this generation is shown. */
  preview: ProjectFileEntry | null;
  /** The navigable list the preview was opened from (e.g., the active project's history).
   *  Arrow keys cycle through this in the lightbox. */
  previewList: ProjectFileEntry[];
  /** Where the preview was opened (which tab + view). The lightbox is a single
   *  app-root overlay, so it must only render when we're back on the exact spot
   *  it was opened from — otherwise it would cover other tabs/views. We do NOT
   *  clear the preview on navigation: leaving hides it (origin no longer matches),
   *  returning to the same tab+view shows it again with its state intact. */
  previewOrigin: { tabId: string; view: ActiveView } | null;

  // Projects
  projects: ProjectMeta[];
  projectsRoot: string;
  activeProjectId: string | null;
  /** Which stage tool the Project Workspace is showing. Null when no
   *  project workspace is open (activeView !== 'project'). */
  activeProjectStage: StageNumber | null;
  /** In-memory state.json for the currently open project, hydrated on
   *  workspace open. Components mutate via setProjectStage(); persistence
   *  to disk happens in the action. */
  projectState: ProjectState | null;

  // Reference library + current generation's layers
  library: LibraryAsset[];
  layers: Layer[];
  libraryPickerCategory: LibCategory | null;  // when library modal is open, which category to assign to

  // Skills (Anthropic-style .md files that transform the prompt into a Master Prompt before generate)
  skills: Skill[];
  activeSkillId: string | null;
  /** Last skill-import attempt error, surfaced to UI for one render cycle. */
  skillImportError: string | null;

  // Frame look presets. Every look, including Clay & Basil, lives in this one
  // persisted catalog and has the same edit/update/delete lifecycle.
  dnaPresets: DnaPreset[];
  activeDnaPresetId: string | null;

  // Saudi DNA Layer — the cultural compiler between the user and the models.
  // On by default for every user; transparent and inspectable via the
  // "ماذا فعلت الطبقة" panel. When a Skill is active the skill supersedes.
  layerEnabled: boolean;
  lastLayerRun: LayerRun | null;

  init: () => Promise<void>;
  setSelection: <K extends keyof Selections>(key: K, value: Selections[K]) => void;
  openPicker: (p: ActivePicker) => void;
  closePicker: () => void;
  applyHJENDNA: () => void;
  applyDnaPreset: (id: string | null) => void;
  createDnaPreset: (name: string, description: string) => string;
  editDnaPreset: (id: string, patch: { name: string; description: string; captureCurrent?: boolean }) => void;
  updateDnaPreset: (id: string) => void;
  deleteDnaPreset: (id: string) => void;
  resetSelections: () => void;
  generate: () => Promise<void>;
  /** Isolated Frame make for a Breakdown shotlist row — MADE-not-Generate.
   *  Clones initialSelections (every chip null → no DOP interference) and
   *  overrides ONLY prompt/quality/aspect, registers a frame-make BgJob
   *  (task-tab + status bar + LOG, lands in Frame), makes the image via the
   *  shared runFrameGeneration, and saves it into the active project's library.
   *  Returns the saved imgPath so the caller pins it into the shot row and
   *  persists the breakdown. NEVER touches the user's live Frame selections. */
  makeBreakdownShotFrame: (args: { slug: string; no: number; prompt: string; quality: Quality; aspect: string; model?: ModelId; refPaths?: string[]; appendix?: string; title?: string }) => Promise<{ ok: boolean; path?: string; message?: string }>;
  makeBreakdownShotVideo: (args: { slug: string; no: number; prompt: string; imagePath: string; modelId: string; resolution: '480p' | '720p' | '1080p' | '4k'; duration: number; ratio: string; endImagePath?: string | null; refPaths?: string[]; appendix?: string; title?: string }) => Promise<{ ok: boolean; path?: string; message?: string }>;
  /** CAMERA ANGLES — MAKE one new camera angle of a source scene through the
   *  existing Frames engine. `refPath` is the scene/performance source (attached
   *  as a composition reference so the OpenAI path re-shoots the same action);
   *  `angle` is the distinct [CAMERA ANGLE] string. The verbatim make template
   *  (with ONLY the [CAMERA ANGLE] token swapped) is built inside — no caller can
   *  bypass it. Saves to the active project's library with `cameraAngle`
   *  provenance. NEVER touches the user's live Frame selections. */
  makeCameraAngleFrame: (args: { angle: string; refPath: string; quality: Quality; aspect: string; model: ModelId; index: number }) => Promise<{ ok: boolean; path?: string; jsonPath?: string; message?: string }>;
  /** MAKE FROM FILM SPACE — the fix for the 360°/behind-the-subject ceiling.
   *  A SINGLE direct make: feeds gpt-image-2 exactly TWO composition references,
   *  the Film Space frame first then the SOURCE:
   *  Image 1 = the pack's grey blocking frame / plate (geometry / framing / pose
   *  anchor, any angle — behind / overhead), Image 2 = the user's source scene
   *  (subject identity + wardrobe + real location). No front-hemisphere guard —
   *  the frame IS the licence to shoot from behind. The plate is a featureless
   *  clay figure, so it is sent directly (no outline/depth/pose workaround).
   *  Saves with `cameraAngle.fromPack` provenance; never touches the user's live
   *  Frame selections. */
  makeCameraAngleFromPack: (args: { platePath: string; refPath: string; quality: Quality; aspect: string; model: ModelId; index: number; packId?: string; readout?: string }) => Promise<{ ok: boolean; path?: string; jsonPath?: string; message?: string }>;
  /** THE SWAP — one frame, re-photographed with the listed changes and nothing
   *  else. Runs the whole enforcement loop for ONE take: build the structure
   *  plates this swap admits, compose the contract MAIN-side, make, then read the
   *  result back against each requirement's acceptance test and re-drive whatever
   *  did not land — chaining from the take, landed requirements demoted to KEEP
   *  lines, capped at three rounds.
   *
   *  Every round after the first is a real make and costs a real make. The
   *  standalone Swap tool uses that enforcement ladder. Reference Maker passes
   *  `generationPolicy: single-pass`: it still verifies the result, but returns
   *  every miss to Review and leaves the decision to spend again with the user.
   *  `onRound` reports progress so the UI can show the trail rather than a spinner.
   *
   *  The prompt is OPAQUE here — composed in MAIN and passed straight through.
   *  NEVER touches the user's live Frame selections. */
  makeSwapFrame: (args: {
    /** Stable per-take key used by the gateway to resume/dedupe paid rounds. */
    recoveryId?: string;
    /** Reference Maker uses single-pass: verify the paid take, report misses,
     *  and never purchase an automatic corrective generation. The standalone
     *  Swap tool keeps its enforcement ladder unless it opts into this policy. */
    generationPolicy?: 'enforced' | 'single-pass';
    sourcePath: string;
    slots: FrameSlots;
    decisions: SlotDecisions;
    facePath?: string;
    quality: Quality; aspect: string; model: ModelId; index: number;
    /** Already-planned requirements (tests written, conflicts shown). Omit and
     *  they are compiled from `decisions` and tested at compose time. */
    requirements?: Requirement[];
    preserveMode?: 'neighbourhood' | 'full';
    /** Optional snapshot from Frame Tools. Used only when Reference Maker's
     *  DNA or DOP switch is enabled; Make-owned prompt/model/quality/aspect stay
     *  authoritative and cannot be overwritten by the snapshot. */
    frameTools?: Partial<Selections>;
    /** Progress, and — the moment a round's frame exists on disk — its path, so
     *  the caller can paint it before the check that follows has run. */
    onRound?: (info: {
      round: number; phase: 'plates' | 'compose' | 'make' | 'verify'; note?: string;
      takePath?: string; jsonPath?: string; verdicts?: Verdict[];
    }) => void;
  }) => Promise<{
    ok: boolean; path?: string; jsonPath?: string; message?: string;
    requirements?: Requirement[]; verdicts?: Verdict[]; unresolved?: string[];
    rounds?: number; lockKit?: string; lockReason?: string; untestable?: string[];
  }>;
  /** BUILD REFERENCE — MAKE a clean, isolated reference image for ONE roster
   *  entity (person / place / asset) purely from its self-contained text `prompt`
   *  — TEXT-TO-IMAGE ONLY, never the ad's video frame (in forward use there is no
   *  source film). Clones initialSelections (every chip null), overrides ONLY the
   *  prompt + a sensible MED / 16:9, passes NO layers / NO reference images.
   *  Registers a frame-make BgJob, saves into the active project library, then —
   *  on the FRESHEST breakdown read from disk — stamps `builtRef` on the entity
   *  and LINKS the image as an attachment onto every shot the entity appears in
   *  (de-duped), and persists. Returns the merged breakdown so the caller refreshes
   *  its in-memory copy. NEVER touches the user's live Frame selections/layers. */
  buildEntityReference: (args: { slug: string; kind: 'person' | 'place' | 'asset'; id: string }) => Promise<{ ok: boolean; path?: string; message?: string; breakdown?: import('./lib/creativemind/breakdown').AdBreakdown }>;
  /** ORPHANED REFERENCES sweep — scan the active project's library for BUILD
   *  REFERENCE images (sidecar `breakdownEntity`) whose file is NO LONGER pointed
   *  to by ANY entity's history in this breakdown. Before the history feature,
   *  BUILD AGAIN overwrote the pointer (not the file), so older builds became
   *  orphans on disk. Read-only: hits disk, mutates nothing. Returns the orphans
   *  (grouped-ready), each carrying its inferred `{id,kind,part}` + `matched`
   *  (whether that id still exists in the roster). */
  scanOrphanRefs: (args: { slug: string }) => Promise<OrphanRef[]>;
  /** RESTORE one orphaned reference — APPEND it (as a BuiltRef) to the matching
   *  entity's correct slot history (person+face → builtFaces · person+sheet or a
   *  legacy single-image person build → builtSheets · place/asset → builtRefs),
   *  de-duped by path. Does NOT change the active pointer (the user picks it via
   *  the history viewer). Persists on the freshest disk read. NOTHING is deleted
   *  or moved — this only re-surfaces a dropped pointer. */
  restoreOrphanRef: (args: { slug: string; imgPath: string; id: string; kind: 'person' | 'place' | 'asset'; part?: 'face' | 'sheet'; at: string }) => Promise<{ ok: boolean; message?: string; breakdown?: import('./lib/creativemind/breakdown').AdBreakdown }>;
  promptPreview: () => string;
  /** Send the current prompt + layer references to Claude, replace the
   *  prompt with a refined scene description. Counted as a paid call —
   *  cost surfaced via lastEnhancement.usd. */
  enhancePrompt: () => Promise<void>;
  /** Restore the prompt that was active before the most recent Enhance call. */
  undoEnhancement: () => void;
  /** Re-apply the most recent enhancement after an undo — no new API call. */
  redoEnhancement: () => void;
  /** Wipe scene-specific state (prompt + atmosphere + all references) while
   *  keeping camera/lens/stock/etc settings. Useful when starting a fresh
   *  composition without inheriting elements from the previous shot. */
  resetScene: () => void;
  /** Dismiss the current error banner. */
  clearError: () => void;
  /** Surface an error banner message. */
  setError: (message: string) => void;
  /** Restore an interrupted job's prompt + selections + layers into the
   *  studio dock so the user can review and re-click Generate. The disk
   *  record is removed once restored. */
  restoreInterruptedJob: (id: string) => void;
  /** Drop an interrupted job from the list (also deletes the disk record). */
  dismissInterruptedJob: (id: string) => void;
  loadFailedJobs: () => Promise<void>;
  inspectFailedJob: (job: FailedJobPayload | null) => void;
  dismissFailedJob: (id: string) => Promise<void>;
  /** Re-apply a FAILED frame job's exact prompt + settings + refs back into the
   *  Frame form, IN PLACE (never navigates away). The failed entry is kept so
   *  the user can still inspect it; DISMISS is the delete. */
  restoreFailedJob: (id: string) => void;
  /** Boot recovery: for every pending VIDEO task that survived a crash, re-poll
   *  its server task id and either retrieve → save the finished clip, keep
   *  polling if still rendering, or mark it interrupted with an honest reason. */
  recoverPendingVideos: () => Promise<void>;
  /** Boot/reconnect recovery: for every pending IMAGE make that survived an app
   *  close, ask the server for the paid frame (keyed by job id) and — if it was
   *  delivered+charged — save it into its project AUTOMATICALLY, no RESTORE, no
   *  re-charge. Only makes the server never delivered (already refunded) remain
   *  as interrupted jobs for a clean re-run. */
  recoverPendingFrames: () => Promise<void>;

  loadProjects: () => Promise<void>;
  createProject: (name: string) => Promise<ProjectMeta>;
  deleteProject: (id: string, deleteFiles: boolean) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  setProjectCover: (id: string, imgPath: string | null) => Promise<void>;
  selectProject: (id: string | null) => void;
  activeProject: () => ProjectMeta | null;
  /** Open a project in the new 8-stage workspace. Loads state.json from
   *  disk (seeded if missing) and sets activeView to 'project'. */
  openProjectWorkspace: (id: string, stage?: StageNumber) => Promise<void>;
  /** Switch to a different stage inside the open workspace. Persists the
   *  new currentStage so reopening lands at the same place. */
  setActiveProjectStage: (stage: StageNumber) => Promise<void>;
  /** Mark a stage signed (advisory — UI may show warnings but the call
   *  always succeeds). */
  signProjectStage: (stage: StageNumber) => Promise<void>;
  /** Move a stage back to draft. */
  unsignProjectStage: (stage: StageNumber) => Promise<void>;
  /** Append a ledger entry to the open project's right-rail. */
  addLedgerEntry: (entry: Omit<ProjectLedgerEntry, 'id' | 'ts'>) => Promise<void>;
  /** Remove a ledger entry by id. */
  removeLedgerEntry: (entryId: string) => Promise<void>;
  /** Toggle resolved flag on a ledger entry. */
  toggleLedgerEntry: (entryId: string) => Promise<void>;
  changeProjectsRoot: (root: string) => Promise<void>;
  viewPastGeneration: (entry: ProjectFileEntry) => Promise<void>;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleLayers: () => void;
  setLayersOpen: (open: boolean) => void;
  toggleDop: () => void;
  setDopOpen: (open: boolean) => void;
  /** Open the DOP panel bound to a Node canvas Frame node: loads that node's
   *  look into the global selections, then edits flow back into the node. */
  openNodeDop: (nodeId: string) => void;
  setActiveView: (view: ActiveView) => void;
  toggleMcpDock: () => void;

  // ===== Tabs (browser-style navigation) =====
  /** Open a fresh tab on the default surface (Studio) and switch to it. */
  newTab: () => void;
  /** Close a tab. Keeps ≥1 tab open; if the active tab closes, a neighbour is
   *  activated and its navigation restored. */
  closeTab: (id: string) => void;
  /** Switch to a tab, restoring its view + project + sub-state. */
  selectTab: (id: string) => void;
  /** Record the page just left in the active tab's browser-style history. */
  recordTabHistory: (entry: TabHistoryEntry) => void;
  /** Return to the previous page inside the active tab. */
  goBack: () => void;
  /** Advance to the next page after going back inside the active tab. */
  goForward: () => void;
  /** Merge a patch into the active tab's ephemeral sub-state (used by views to
   *  stash restorable state like a breakdown's open slug). */
  setActiveTabSub: (patch: Record<string, unknown>) => void;
  /** The currently active tab (never null — there is always ≥1 tab). */
  activeTab: () => Tab;

  // ===== Theme / appearance =====
  /** Id of the currently applied theme (built-in or custom). */
  activeThemeId: string;
  /** User-created themes (built-ins are not stored here). */
  customThemes: Theme[];
  /** Interface re-skin ('classic' | 'pro'), orthogonal to the active theme. */
  appearance: Appearance;
  /** Switch the interface re-skin, apply live, and persist. */
  setAppearance: (a: Appearance) => void;
  /** Product-Hub tile colouring (auto/industrial/identity/faint). */
  hubTiles: HubTiles;
  /** Set the hub-tile colouring, apply live, and persist. */
  setHubTiles: (h: HubTiles) => void;
  /** Background shade — 'theme' (leave the theme's bg) or a #rrggbb grey base. */
  bgShade: string;
  /** Set the background shade, apply live, and persist. */
  setBgShade: (v: string) => void;
  /** Hydrate theme config from disk + apply the active theme. Called in init(). */
  loadThemeConfig: () => Promise<void>;
  /** Activate a theme by id (built-in or custom). */
  setActiveTheme: (id: string) => void;
  /** Deep-merge a patch into the active CUSTOM theme + apply live. No-op on built-ins. */
  updateActiveTheme: (patch: ThemePatch) => void;
  /** Clone a theme into a new editable custom theme, activate it, return it. */
  duplicateTheme: (id: string) => Theme;
  /** Rename a custom theme. */
  renameTheme: (id: string, name: string) => void;
  /** Delete a custom theme; falls back to Default if it was active. */
  deleteTheme: (id: string) => void;
  /** Open a file dialog and import a theme JSON as a new custom theme. */
  importThemeFromFile: () => Promise<void>;
  /** Open a save dialog and export a theme to JSON. */
  exportThemeToFile: (id: string) => Promise<void>;

  // Seedance video jobs — persistent across navigation
  addVideoJob: (job: VideoJob) => void;
  updateVideoJob: (id: string, patch: Partial<VideoJob>) => void;
  focusVideoJob: (id: string | null) => void;
  removeVideoJob: (id: string) => void;
  submitVideoJob: (input: VideoJobInput) => void;

  // ===== Background jobs (operations subsystem) — the 3-call API any async op
  //  registers with: startJob → updateJob(*) → finishJob. =====
  /** Register a new running operation. Returns its id. */
  startJob: (partial: {
    kind: string; title: string; projectId?: string | null;
    nav: JobNav; stages: JobStage[]; progressText?: string;
  }) => string;
  /** Advance a running op — set the active stage, bump progress, replace stages
   *  wholesale, or capture its resume `nav` (e.g. the breakdown slug, once known).
   *  Safe to call after the launching component unmounts. */
  updateJob: (id: string, patch: {
    activeStage?: string; progressText?: string; stages?: JobStage[]; nav?: JobNav;
  }) => void;
  /** Finish an op — status 'done' (all stages done, tab turns green/clickable)
   *  or 'error' (active stage flips error). Optional nav overrides where a
   *  click lands (e.g. the freshly-written breakdown slug). */
  finishJob: (id: string, opts: { status: 'done' | 'error' | 'interrupted'; nav?: JobNav; error?: string }) => void;
  getJob: (id: string) => BgJob | undefined;
  /** Most-recent-first, up to n. */
  recentJobs: (n: number) => BgJob[];
  /** Hide a finished job from the TabStrip (kept in history + LOG). */
  dismissJobTab: (id: string) => void;
  /** Bulk-dismiss (used by the consolidated per-tool chip → dismiss all its
   *  finished jobs at once, keeping any still running). */
  dismissJobTabs: (ids: string[]) => void;
  /** Boot-time: read the persisted operations log + reconcile any `running`
   *  survivor to `interrupted`. */
  hydrateJobs: () => Promise<void>;
  /** Resume an interrupted job from its on-disk checkpoint — registers a fresh
   *  running job that re-runs ONLY the unfinished work, dispatched by kind. */
  resumeJob: (id: string) => void;
  /** Navigate to a job's saved nav (its home view+project+sub). */
  openJobNav: (id: string) => Promise<void>;
  /** Set (or clear) the stopped op whose error the LOG view should auto-open. */
  setLogFocusJobId: (id: string | null) => void;
  setStatusBarVisible: (v: boolean) => void;
  addVideoRef: (asset: LibraryAsset, category: LibCategory) => void;
  removeVideoRef: (id: string) => void;
  clearVideoRefs: () => void;
  /** Bulk replace — used by "click a past video to restore refs". */
  setVideoRefs: (refs: VideoRef[]) => void;
  openPreview: (entry: ProjectFileEntry, list?: ProjectFileEntry[]) => void;
  closePreview: () => void;
  navigatePreview: (direction: -1 | 1) => void;

  // Library + layers
  loadLibrary: () => Promise<void>;
  /** Pick files (or use prePickedPaths if provided) and add them all to
   *  the given category. Pass prePickedPaths from the new Library page
   *  flow: pick files once, then ask the user which category. */
  uploadToLibrary: (category: LibCategory, prePickedPaths?: string[]) => Promise<number>;
  /** Open the system file picker without uploading. Used by the Library
   *  page so the category prompt can come AFTER files are chosen. */
  pickLibraryFiles: () => Promise<string[] | null>;
  /** Move an asset to a different category (physically relocates the
   *  file + thumb on disk, updates the index). */
  moveLibraryAsset: (id: string, newCategory: LibCategory) => Promise<void>;
  /** Bulk delete — single Promise.all, with the existing per-asset
   *  cleanup (file unlink + layer detach) running per id. */
  bulkDeleteLibraryAssets: (ids: string[]) => Promise<void>;
  /** Backfill hashes + collapse duplicates in the Library. Rewrites
   *  in-memory layers that pointed at deleted assets so the sidebar
   *  doesn't end up with broken references. */
  dedupLibrary: () => Promise<{ removed: number; freedBytes: number; backfilled: number }>;
  /** Take the currently displayed result, push it to the Library as a
   *  `composition` asset, attach it as a Layer, and open the Layers
   *  sidebar so the user can immediately iterate. The "Refine" workflow. */
  refineFromCurrent: () => Promise<void>;
  deleteLibraryAsset: (id: string) => Promise<void>;
  addLayer: (asset: LibraryAsset, category?: LibCategory, parentLayerId?: string) => void;
  removeLayer: (layerId: string) => void;
  reorderLayer: (layerId: string, newCategory: LibCategory) => void;
  renameLayer: (layerId: string, newName: string) => Promise<void>;
  setLayerGroup: (layerId: string, groupName: string | null) => void;
  setLayerParent: (layerId: string, parentLayerId: string | null) => void;
  clearLayers: () => void;
  openLibraryFor: (category: LibCategory | null, parentLayerId?: string | null) => void;

  /** when set, the library picker will attach the chosen asset to this character */
  libraryPickerParentId: string | null;

  // Skills
  loadSkills: () => Promise<void>;
  importSkill: () => Promise<{ ok: boolean; reason?: string }>;
  saveSkill: (draft: { id?: string | null; name: string; description?: string; version?: string; body: string }) => Promise<{ ok: boolean; reason?: string; message?: string }>;
  deleteSkill: (id: string) => Promise<void>;
  setActiveSkill: (id: string | null) => void;
  clearSkillImportError: () => void;
  setLayerEnabled: (on: boolean) => void;

  // ---- NODE engine (visual pipeline) -------------------------------------
  /** Named canvases within the active project. The active canvas's live data
   *  is mirrored into graphNodes/graphEdges/timelineClips; the rest sit in
   *  canvasData. Each project persists all its canvases to _node/graph.json. */
  canvasList: Array<{ id: string; name: string; kind?: 'media' | 'mind'; edgeStyle?: EdgeStyle }>;
  activeCanvasId: string | null;
  canvasData: Record<string, { nodes: NodeInstance[]; edges: GraphEdge[]; clips: TimelineClip[]; plan?: SpacePlan | null }>;
  createCanvas: (name?: string, kind?: 'media' | 'mind') => void;
  /** Wire shape for one canvas (curve / straight / step), persisted. */
  setCanvasEdgeStyle: (id: string, style: EdgeStyle) => void;
  switchCanvas: (id: string) => void;
  renameCanvas: (id: string, name: string) => void;
  deleteCanvas: (id: string) => void;
  /** A clip placed on the docked timeline (bottom of the Node canvas). */
  timelineClips: TimelineClip[];
  /** Timeline dock expanded? */
  timelineOpen: boolean;
  toggleTimeline: () => void;
  /** Append a canvas node's output to the timeline as a clip. */
  addToTimeline: (nodeId: string) => void;
  moveClip: (id: string, start: number, track?: TimelineTrack) => void;
  removeClip: (id: string) => void;
  /** Docked-timeline playback + editing state — lifted from TimelineDock so
   *  keyboard shortcuts can drive it. Ephemeral, not persisted. */
  timelinePlayhead: number;
  timelinePlaying: boolean;
  timelineFocused: boolean;
  timelineSnapping: boolean;
  selectedClipId: string | null;
  setPlayhead: (t: number) => void;
  setPlaying: (on: boolean) => void;
  stepPlayhead: (dt: number) => void;
  setTimelineFocused: (on: boolean) => void;
  toggleSnapping: () => void;
  selectClip: (id: string | null) => void;
  splitClip: (id: string, atTime: number) => void;
  nudgeClip: (id: string, frames: number) => void;
  setClipInOut: (id: string, which: 'in' | 'out', atTime: number) => void;
  rippleDeleteClip: (id: string) => void;
  /** Playback rate/direction for the transport (J/K/L shuttle). */
  timelineRate: number;
  setPlayRate: (r: number) => void;
  /** Nonce the dock watches to open the export panel (⌘M). */
  exportPing: number;
  requestExport: () => void;
  /** HJEN SPACE — the production the gateway agent laid out for THIS canvas.
   *  null = the canvas has never been asked, so SPACE shows its gateway. The
   *  plan persists with the canvas, so a reopened Space picks up mid-production
   *  instead of asking again. Node ignores this field entirely. */
  spacePlan: SpacePlan | null;
  setSpacePlan: (plan: SpacePlan | null) => void;
  /** Patch one step in place — the only way step state ever changes, because
   *  the agent waits and every change is caused by a press. */
  patchPlanStep: (pipelineId: string, stepIndex: number, patch: Partial<PlanStep>) => void;

  /** Node view working mode: the generation canvas vs the full-screen editor. */
  nodeMode: 'create' | 'edit';
  setNodeMode: (m: 'create' | 'edit') => void;
  graphNodes: NodeInstance[];
  graphEdges: GraphEdge[];
  /** Live per-node execution state, keyed by node id. Not persisted. */
  nodeRuntime: Record<string, NodeRuntime>;
  graphRunning: boolean;
  selectedNodeId: string | null;
  /** Last status line from a graph run, shown in the NODE toolbar. */
  graphStatus: string;
  /** Which project the in-memory graph belongs to (persistence scope). null =
   *  the unsaved seed graph (no active project). Not the same as activeProjectId. */
  graphLoadedFor: string | null;
  /** WHICH WORKSPACE the in-memory graph belongs to. Node and SPACE are two
   *  separate tools that share one engine, one canvas renderer and one graph
   *  slice — but never one file. 'node' persists to _node/graph.json, 'space'
   *  to _space/graph.json, so a Space board can never overwrite a Node board.
   *  Every load/persist carries this; switching tools reloads the other file. */
  graphScope: GraphScope;
  /** Load a project's saved node graph from disk (or seed if none). Additive —
   *  never touches Frame/Storyboard/Video state. `scope` picks the workspace
   *  (Node vs SPACE); omitted keeps whichever is current. */
  loadGraphForProject: (id: string | null, scope?: GraphScope) => Promise<void>;
  /** Debounced persist of the current graph to its project's graph file
   *  (_node/graph.json or _space/graph.json — see graphScope). */
  persistGraph: () => void;
  addGraphNode: (type: string, pos: { x: number; y: number }) => void;
  moveGraphNode: (id: string, pos: { x: number; y: number }) => void;
  /** Corner-drag resize override (history is pushed by the gesture, like Move). */
  resizeGraphNode: (id: string, size: { w: number; h: number }) => void;
  /** Batch-reposition many nodes in ONE undoable step (used by Arrange). */
  arrangeGraphNodes: (moves: Array<{ id: string; position: { x: number; y: number } }>) => void;
  removeGraphNode: (id: string) => void;
  addGraphEdge: (from: { node: string; param: string }, to: { node: string; param: string }) => void;
  removeGraphEdge: (id: string) => void;
  setNodeParam: (id: string, param: string, value: unknown) => void;
  selectGraphNode: (id: string | null) => void;
  /** Graph undo/redo — snapshots of {nodes, edges} only, scoped per canvas.
   *  Never touches Frame/Storyboard/Video/timeline state. */
  graphUndoStack: GraphSnapshot[];
  graphRedoStack: GraphSnapshot[];
  graphHistoryCanvasId: string | null;
  /** Snapshot the current graph BEFORE a mutation (called at the top of edits,
   *  and once per drag gesture by NodeView). */
  pushGraphHistory: (label?: string) => void;
  undoGraph: () => void;
  redoGraph: () => void;
  /** Jump N steps along the combined history timeline (−back / +forward). */
  jumpHistory: (steps: number) => void;
  /** Batch delete = one undo step. */
  removeGraphNodes: (ids: string[]) => void;
  /** Clone clipboard nodes at `at` (board space); returns the new node ids. */
  pasteNodes: (payload: ClipPayload, at: { x: number; y: number }) => string[];
  // ---- take-loop (favorite / reject / label / stacks) ----
  setNodeFavorite: (id: string, on?: boolean) => void;
  setNodeRejected: (id: string, on?: boolean) => void;
  setNodeColorLabel: (id: string, label: 1 | 2 | 3 | 4 | 5 | null) => void;
  renameNode: (id: string, name: string) => void;
  duplicateAsTake: (id: string) => string;
  runGraph: () => Promise<void>;
  cancelGraph: () => void;
}

// NODE engine — the live engine instance for the current run (kept out of store
// state so the class isn't treated as serializable data). A monotonic counter
// gives stable graph node/edge ids.
let activeGraphEngine: GraphEngine | null = null;
let graphIdSeq = 0;
const graphId = (p: string) => `${p}-${Date.now().toString(36)}-${(graphIdSeq++).toString(36)}`;
const clipId = () => `clip-${Date.now().toString(36)}-${(graphIdSeq++).toString(36)}`;

// Graph undo/redo — an in-memory snapshot stack of the undoable subset only
// ({nodes, edges}; never runtime, selection, timeline, or other views). Each
// snapshot carries a human label + id so the History panel can list + jump.
interface GraphSnapshot { nodes: NodeInstance[]; edges: GraphEdge[]; label: string; id: number; ts: number }
const GRAPH_HISTORY_LIMIT = 80;
let graphSnapSeq = 0;
const cloneGraph = (nodes: NodeInstance[], edges: GraphEdge[], label: string): GraphSnapshot => ({
  nodes: JSON.parse(JSON.stringify(nodes)),
  edges: JSON.parse(JSON.stringify(edges)),
  label, id: graphSnapSeq++, ts: Date.now(),
});
const sameGraph = (a: GraphSnapshot, nodes: NodeInstance[], edges: GraphEdge[]): boolean =>
  JSON.stringify({ n: a.nodes, e: a.edges }) === JSON.stringify({ n: nodes, e: edges });
// Which (project, workspace) the pending debounced write belongs to. Kept
// beside the timer so a tool/project switch can flush it into the RIGHT file
// instead of silently writing a Node board into _space/graph.json.
let graphPending: { id: string; scope: GraphScope } | null = null;

/** Serialize the live canvases and write them to one project+scope's graph
 *  file. Shared by the debounced persist and the synchronous flush. */
function writeGraphNow(get: StoreGet, id: string, scope: GraphScope) {
  const s = get();
  // Project or workspace switched mid-debounce — the in-memory board is no
  // longer the one this write was scheduled for. Drop it rather than corrupt.
  if (s.graphLoadedFor !== id || s.graphScope !== scope) return;
  // Fold the active canvas's live working copy back into the data map.
  const data = s.activeCanvasId
    ? { ...s.canvasData, [s.activeCanvasId]: { nodes: s.graphNodes, edges: s.graphEdges, clips: s.timelineClips, plan: s.spacePlan } }
    : s.canvasData;
  const canvases = s.canvasList.map(c => {
    const d = data[c.id] ?? { nodes: [], edges: [], clips: [], plan: null };
    const doc = graphToDoc(d.nodes, d.edges, { id: c.id, name: c.name });
    // `plan` is the SPACE production. Node canvases simply never have one, so
    // the same doc serves both tools without a second schema.
    return { id: c.id, name: c.name, kind: c.kind ?? 'media', edgeStyle: c.edgeStyle, nodes: doc.nodes, edges: doc.edges, clips: d.clips, plan: d.plan ?? null };
  });
  const doc = { schemaVersion: 3, activeCanvasId: s.activeCanvasId, canvases };
  window.hjen.writeGraph({ id, doc, allowEmpty: true, scope }).catch(() => {});
}

/** Write any pending debounced graph edit NOW. Called before swapping the
 *  loaded project/workspace out from under the timer. */
function flushGraphPersist(get: StoreGet) {
  if (!graphPersistTimer || !graphPending) return;
  clearTimeout(graphPersistTimer);
  graphPersistTimer = null;
  const { id, scope } = graphPending;
  graphPending = null;
  writeGraphNow(get, id, scope);
}

// Debounce handle for graph persistence — coalesces rapid edits (drag, typing)
// into one disk write. Kept out of the store so it isn't serialized.
let graphPersistTimer: ReturnType<typeof setTimeout> | null = null;

// A history pop changes the live location and would otherwise be observed as
// new forward navigation by App.tsx. Consume exactly that next observation.
const suppressNextTabHistory = new Set<string>();

// ===== Tab <-> live-nav sync =====
// The ACTIVE tab always mirrors the live (activeView, activeProjectId). Every
// navigation mutation (setActiveView / selectProject / openProjectWorkspace)
// calls this so entry points — ProductHub tiles, deep links, the MCP bridge,
// the project switcher — all act on the active tab automatically.
type StoreGet = () => Store;
type StoreSet = (partial: Partial<Store> | ((s: Store) => Partial<Store>)) => void;
function syncActiveTab(get: StoreGet, set: StoreSet) {
  const { tabs, activeTabId, activeView, activeProjectId } = get();
  const next = tabs.map(t =>
    t.id === activeTabId ? { ...t, view: activeView, projectId: activeProjectId } : t);
  // Skip the write if nothing changed (avoids needless re-renders on no-op nav).
  const cur = tabs.find(t => t.id === activeTabId);
  if (cur && cur.view === activeView && cur.projectId === activeProjectId) return;
  set({ tabs: next });
}

/** Shallow equality for a tab's ephemeral sub-state — small plain key/value
 *  bags (e.g. { breakdownSlug }). Used to focus an existing identical tab
 *  instead of piling on duplicates when a job destination is opened. */
function sameSub(a?: Record<string, unknown>, b?: Record<string, unknown>): boolean {
  const ak = a ? Object.keys(a) : [];
  const bk = b ? Object.keys(b) : [];
  if (ak.length !== bk.length) return false;
  return ak.every(k => a![k] === b![k]);
}

// Restore a tab's saved navigation — reuses the SAME store actions a real
// click/deep-link uses (openProjectWorkspace / loadGraphForProject / storyboard
// open / setActiveView), so a tab switch behaves identically to navigating there.
async function applyTabNav(get: StoreGet, tab: Tab) {
  let pid = tab.projectId;
  if (pid) {
    if (!get().projects.some(p => p.id === pid)) await get().loadProjects();
    if (!get().projects.some(p => p.id === pid)) pid = null;        // project gone — drop it
    else get().selectProject(pid);
  }
  const view = tab.view;
  if (view === 'project' && pid) {
    await get().openProjectWorkspace(pid, tab.sub?.stage as StageNumber | undefined);
    return;
  }
  // Node and SPACE are two workspaces over one graph slice — a tab switch must
  // load the file that belongs to the tab's tool, not just the project.
  if ((view === 'node' || view === 'space') && pid) await get().loadGraphForProject(pid, view === 'space' ? 'space' : 'node');
  if (view === 'storyboard' && pid) {
    try {
      const { useStoryboard } = await import('./store/storyboardStore');
      const sb = useStoryboard.getState();
      // open() starts with `set({ data: null, loaded: false })` — "the open()
      // flash". On a tab RETURN the kept-alive storyboard view already holds this
      // project's board, so re-running open() would blank it then refill = flash.
      // Only (re)open when the board isn't already this project's / isn't loaded.
      if (sb.projectId !== pid || !sb.loaded) await sb.open(pid);
    } catch {}
  }
  get().setActiveView(view);
}

export const useStore = create<Store>((set, get) => ({
  catalog: null,
  catalogReady: false,
  selections: initialSelections,
  activePicker: null,
  history: [],
  current: null,
  generating: false,
  enhancing: false,
  lastEnhancement: null,
  lastMasterRun: null,
  interruptedJobs: [],
  failedJobs: [],
  inspectingFailedJob: null,
  error: null,

  jobs: [],
  videoJobs: [],
  focusedVideoJobId: null,
  videoRefs: [],
  bgJobs: [],
  logFocusJobId: null,
  statusBarVisible: true,
  sidebarOpen: loadSidebarOpenPref(),
  layersOpen: loadLayersOpenPref(),
  dopOpen: false,
  dopTargetNodeId: null,
  activeView: 'studio',
  tabs: [{ id: INITIAL_TAB_ID, view: 'studio', projectId: null }],
  activeTabId: INITIAL_TAB_ID,
  mcpDockOpen: false,
  preview: null,
  previewList: [],
  previewOrigin: null,
  activeThemeId: 'default',
  customThemes: [],
  appearance: readCachedAppearance(),
  hubTiles: readCachedHubTiles(),
  bgShade: readCachedBgShade(),
  projects: [],
  projectsRoot: '',
  activeProjectId: null,
  activeProjectStage: null,
  projectState: null,
  library: [],
  layers: [],
  libraryPickerCategory: null,
  libraryPickerParentId: null,
  skills: [],
  activeSkillId: null,
  skillImportError: null,
  dnaPresets: loadDnaPresets(),
  activeDnaPresetId: null,
  layerEnabled: loadLayerEnabledPref(),
  lastLayerRun: null,

  // NODE engine state — board seeded with the canonical pipeline.
  // Fresh canvas starts EMPTY (an empty "Start creating" canvas) — nodes are
  // added from the tool rail, not pre-seeded.
  graphNodes: [],
  graphEdges: [],
  graphLoadedFor: null,
  graphScope: 'node',
  canvasList: [],
  activeCanvasId: null,
  canvasData: {},
  timelineClips: [],
  timelineOpen: true,
  timelinePlayhead: 0,
  timelinePlaying: false,
  timelineFocused: false,
  timelineSnapping: true,
  timelineRate: 1,
  exportPing: 0,
  spacePlan: null,
  nodeMode: 'create',
  selectedClipId: null,
  graphUndoStack: [],
  graphRedoStack: [],
  graphHistoryCanvasId: null,
  nodeRuntime: {},
  graphRunning: false,
  selectedNodeId: null,
  graphStatus: 'Pipeline loaded. Double-click a product node to open it · Run to execute.',

  async init() {
    // Register the built-in NODE product types once, up front.
    registerBuiltinNodes();
    // Theme: paint the last-used theme instantly from the localStorage cache
    // (avoids a flash of Default), then hydrate the authoritative config from
    // disk. Fire-and-forget — don't block catalog load on it.
    const cached = readCachedTheme();
    if (cached) applyTheme(cached, get().appearance, get().hubTiles, get().bgShade);
    get().loadThemeConfig().catch(() => {});
    // Crash/quit resilience: hydrate the operations log + reconcile any job that
    // was `running` when the app died into `interrupted`. Must land before any
    // new job can start, so it never clobbers a fresh run.
    await get().hydrateJobs();
    try {
      const [catalog] = await Promise.all([
        loadCatalog(),
        get().loadProjects(),
        get().loadLibrary(),
        get().loadSkills(),
      ]);
      set({ catalog, catalogReady: true });
      // #4 — restore the exact navigation from the last session (tabs + active
      // view/project) so a reload/relaunch lands where the user was, never on Home.
      // Projects are loaded by now, so applyTabNav can validate + drop a gone one.
      try {
        const nav = readNavPref();
        if (nav && Array.isArray(nav.tabs) && nav.tabs.length) {
          const tabs = nav.tabs as Tab[];
          const activeTabId = tabs.some(t => t.id === nav.activeTabId) ? nav.activeTabId : tabs[0].id;
          set({ tabs, activeTabId, activeView: nav.activeView, activeProjectId: nav.activeProjectId ?? null });
          const active = tabs.find(t => t.id === activeTabId);
          if (active) await applyTabNav(get, active);
        }
      } catch { /* nav restore is best-effort — fall back to the default Home tab */ }
      // Persist navigation whenever it changes (debounced) so the next reload restores it.
      if (typeof window !== 'undefined' && !(window as any).__hjenNavHooked) {
        (window as any).__hjenNavHooked = true;
        let navT: ReturnType<typeof setTimeout> | null = null;
        useStore.subscribe((s, prev) => {
          if (s.tabs !== prev.tabs || s.activeTabId !== prev.activeTabId || s.activeView !== prev.activeView || s.activeProjectId !== prev.activeProjectId) {
            if (navT) clearTimeout(navT);
            navT = setTimeout(() => writeNavPref(useStore.getState()), 250);
          }
        });
      }
      // Crash-recovery, IMAGE jobs: a pending IMAGE make that survived an app
      // close is a paid frame the server may still hold. recoverPendingFrames()
      // re-fetches it by job id and saves it AUTOMATICALLY — no RESTORE button,
      // no re-charge. Only makes the server never delivered stay interrupted for
      // a clean re-run. (LAW: credit deducted ⟺ the file returns on its own.)
      get().recoverPendingFrames().catch(() => {});
      // Crash-recovery, VIDEO jobs: the render kept running SERVER-SIDE while
      // the app was gone. Re-poll each saved task id — retrieve + save if it
      // finished, keep polling if it's still rendering, mark interrupted if the
      // server has no record. THIS is what stops clients losing paid videos.
      get().recoverPendingVideos().catch(() => {});
      // Load any previously-failed jobs so the user can inspect them
      // from the sidebar Failed group.
      get().loadFailedJobs().catch(() => {});
      // Reconnect resilience: when the network comes back, silently re-sync so a
      // paid result the SERVER already saved (credit spent ⟺ file saved) reappears
      // on its own — no red error, no manual RESTORE. Re-fetch is idempotent and
      // never double-charges; it only reads. Hooked once per window.
      if (typeof window !== 'undefined' && !(window as any).__hjenOnlineHooked) {
        (window as any).__hjenOnlineHooked = true;
        window.addEventListener('online', () => {
          get().loadProjects().catch(() => {});
          get().loadLibrary().catch(() => {});
          get().recoverPendingFrames().catch(() => {});
          get().recoverPendingVideos().catch(() => {});
          const active = get().activeProjectId;
          if (active) { try { get().selectProject(active); } catch { /* re-select refreshes project frames */ } }
        });
      }
    } catch (e: any) {
      set({ error: `Failed to load: ${e.message}` });
    }
  },

  async loadProjects() {
    const { projects, projectsRoot, lastProjectId } = await window.hjen.getProjects();
    const prevActive = get().activeProjectId;
    const prevStillExists = prevActive && projects.some(p => p.id === prevActive);
    const lastStillExists = lastProjectId && projects.some(p => p.id === lastProjectId);
    set({
      projects,
      projectsRoot,
      // Priority: in-memory selection (set after boot) → persisted last project
      // → first project in the list. This restores the user's last-used project
      // across app launches.
      activeProjectId: prevStillExists ? prevActive
                      : lastStillExists ? lastProjectId
                      : (projects[0]?.id ?? null),
    });
  },

  async createProject(name: string) {
    const p = await window.hjen.createProject({ name });
    set(state => ({
      projects: [p, ...state.projects.filter(x => x.id !== p.id)],
      activeProjectId: p.id,
    }));
    window.hjen.setLastProjectId(p.id).catch(() => {});
    return p;
  },

  async deleteProject(id: string, deleteFiles: boolean) {
    await window.hjen.deleteProject({ id, deleteFiles });
    set(state => ({
      projects: state.projects.filter(p => p.id !== id),
      activeProjectId: state.activeProjectId === id ? (state.projects.find(p => p.id !== id)?.id ?? null) : state.activeProjectId,
    }));
  },

  async renameProject(id: string, name: string) {
    const updated = await window.hjen.renameProject({ id, name });
    if (!updated) return;
    set(state => ({
      projects: state.projects.map(p => p.id === id ? updated : p),
    }));
  },

  async setProjectCover(id: string, imgPath: string | null) {
    const updated = await window.hjen.setProjectCover({ id, imgPath });
    if (!updated) return;
    set(state => ({
      projects: state.projects.map(p => p.id === id ? updated : p),
    }));
  },

  selectProject(id: string | null) {
    set({ activeProjectId: id, activePicker: null });
    syncActiveTab(get, set);
    // Persist so the next app launch reopens the same project.
    window.hjen.setLastProjectId(id).catch(() => {});
  },

  activeProject() {
    const { projects, activeProjectId } = get();
    return projects.find(p => p.id === activeProjectId) ?? null;
  },

  async openProjectWorkspace(id, stage) {
    const state = await window.hjen.readProjectState({ id });
    if (!state) {
      // Project not found / load failed — fall back to closing the workspace.
      set({ activeView: 'projects', activeProjectStage: null, projectState: null });
      return;
    }
    const targetStage: StageNumber = stage ?? state.currentStage ?? 1;
    set({
      activeProjectId: id,
      activeView: 'project',
      activeProjectStage: targetStage,
      projectState: state,
      activePicker: null,
    });
    syncActiveTab(get, set);
    get().setActiveTabSub({ stage: targetStage });
    window.hjen.setLastProjectId(id).catch(() => {});
    // Persist last-viewed stage so re-opening lands here
    if (state.currentStage !== targetStage) {
      const next: ProjectState = { ...state, currentStage: targetStage };
      const updated = await window.hjen.writeProjectState({ id, state: next });
      if (updated) {
        set(s => ({
          projects: s.projects.map(p => p.id === id ? updated : p),
          projectState: next,
        }));
      }
    }
  },

  async setActiveProjectStage(stage) {
    const { activeProjectId, projectState } = get();
    if (!activeProjectId || !projectState) return;
    set({ activeProjectStage: stage });
    get().setActiveTabSub({ stage });
    if (projectState.currentStage === stage) return;
    const next: ProjectState = { ...projectState, currentStage: stage };
    const updated = await window.hjen.writeProjectState({ id: activeProjectId, state: next });
    if (updated) {
      set(s => ({
        projects: s.projects.map(p => p.id === activeProjectId ? updated : p),
        projectState: next,
      }));
    }
  },

  async signProjectStage(stage) {
    const { activeProjectId, projectState } = get();
    if (!activeProjectId || !projectState) return;
    const next: ProjectState = {
      ...projectState,
      stages: {
        ...projectState.stages,
        [stage]: { status: 'signed', signedAt: new Date().toISOString() },
      },
    };
    const updated = await window.hjen.writeProjectState({ id: activeProjectId, state: next });
    if (updated) {
      set(s => ({
        projects: s.projects.map(p => p.id === activeProjectId ? updated : p),
        projectState: next,
      }));
    }
  },

  async unsignProjectStage(stage) {
    const { activeProjectId, projectState } = get();
    if (!activeProjectId || !projectState) return;
    const next: ProjectState = {
      ...projectState,
      stages: {
        ...projectState.stages,
        [stage]: { status: 'draft' },
      },
    };
    const updated = await window.hjen.writeProjectState({ id: activeProjectId, state: next });
    if (updated) {
      set(s => ({
        projects: s.projects.map(p => p.id === activeProjectId ? updated : p),
        projectState: next,
      }));
    }
  },

  async addLedgerEntry(entry) {
    const { activeProjectId, projectState } = get();
    if (!activeProjectId || !projectState) return;
    const newEntry: ProjectLedgerEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      ...entry,
    };
    const next: ProjectState = { ...projectState, ledger: [newEntry, ...projectState.ledger] };
    const updated = await window.hjen.writeProjectState({ id: activeProjectId, state: next });
    if (updated) {
      set(s => ({
        projects: s.projects.map(p => p.id === activeProjectId ? updated : p),
        projectState: next,
      }));
    }
  },

  async removeLedgerEntry(entryId) {
    const { activeProjectId, projectState } = get();
    if (!activeProjectId || !projectState) return;
    const next: ProjectState = { ...projectState, ledger: projectState.ledger.filter(e => e.id !== entryId) };
    const updated = await window.hjen.writeProjectState({ id: activeProjectId, state: next });
    if (updated) {
      set(s => ({
        projects: s.projects.map(p => p.id === activeProjectId ? updated : p),
        projectState: next,
      }));
    }
  },

  async toggleLedgerEntry(entryId) {
    const { activeProjectId, projectState } = get();
    if (!activeProjectId || !projectState) return;
    const next: ProjectState = {
      ...projectState,
      ledger: projectState.ledger.map(e => e.id === entryId ? { ...e, resolved: !e.resolved } : e),
    };
    const updated = await window.hjen.writeProjectState({ id: activeProjectId, state: next });
    if (updated) {
      set(s => ({
        projects: s.projects.map(p => p.id === activeProjectId ? updated : p),
        projectState: next,
      }));
    }
  },

  async changeProjectsRoot(root: string) {
    const res = await window.hjen.setProjectsRoot(root);
    if (res.ok && res.root) {
      set({ projectsRoot: res.root });
    }
  },

  toggleSidebar() {
    const next = !get().sidebarOpen;
    set({ sidebarOpen: next });
    persistSidebarOpenPref(next);
  },

  setSidebarOpen(open: boolean) {
    set({ sidebarOpen: open });
    persistSidebarOpenPref(open);
  },

  toggleLayers() {
    const next = !get().layersOpen;
    set({ layersOpen: next });
    persistLayersOpenPref(next);
  },

  setLayersOpen(open: boolean) {
    set({ layersOpen: open });
    persistLayersOpenPref(open);
  },

  toggleDop() {
    set(state => ({ dopOpen: !state.dopOpen }));
  },
  setDopOpen(open: boolean) {
    // Closing the DOP unbinds it from any Node Frame it was editing.
    set(open ? { dopOpen: true } : { dopOpen: false, dopTargetNodeId: null });
  },

  openNodeDop(nodeId) {
    const node = get().graphNodes.find(n => n.id === nodeId);
    const dop = node?.paramValues?.dop as { selections?: Selections } | undefined;
    // Seed the global DOP from the node's stored look (fallback: keep current).
    set(state => ({
      selections: dop?.selections ? { ...state.selections, ...dop.selections } : state.selections,
      ...(dop?.selections ? { activeDnaPresetId: null } : {}),
      dopTargetNodeId: nodeId,
      dopOpen: true,
      selectedNodeId: nodeId,
    }));
  },

  setActiveView(view) {
    // Leaving a view drops any Node↔DOP binding so the Studio path stays clean.
    // The generation preview is NOT cleared here — it's an app-root overlay bound
    // to its origin (tab + view), so it auto-hides when we navigate away and
    // reappears intact when we come back. See previewOrigin + GenerationPreview.
    set({ activeView: view, dopTargetNodeId: null });
    syncActiveTab(get, set);
  },

  setLogFocusJobId(id) {
    set({ logFocusJobId: id });
  },

  toggleMcpDock() {
    set(state => ({ mcpDockOpen: !state.mcpDockOpen }));
  },

  // ========== Tabs ==========
  newTab() {
    const tab: Tab = { id: newTabId(), view: 'studio', projectId: null };
    set(st => ({ tabs: [...st.tabs, tab], activeTabId: tab.id }));
    // Land on the default surface; setActiveView syncs the new active tab.
    get().setActiveView('studio');
  },

  closeTab(id) {
    const st = get();
    const idx = st.tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    const tabs = st.tabs.filter(t => t.id !== id);
    if (tabs.length === 0) {
      // Never leave the app blank — reopen the default surface.
      const fresh: Tab = { id: newTabId(), view: 'studio', projectId: null };
      set({ tabs: [fresh], activeTabId: fresh.id });
      get().setActiveView('studio');
      return;
    }
    if (id !== st.activeTabId) { set({ tabs }); return; }
    // Closing the active tab — activate the neighbour (prefer the one to the left).
    // Set activeView synchronously too (same reason as selectTab: avoid a
    // tab-switched-but-view-stale gap that flashes).
    const nextTab = tabs[Math.max(0, idx - 1)];
    set({ tabs, activeTabId: nextTab.id, activeView: nextTab.view });
    void applyTabNav(get, nextTab);
  },

  selectTab(id) {
    const st = get();
    if (id === st.activeTabId) return;
    const tab = st.tabs.find(t => t.id === id);
    if (!tab) return;
    // Update activeView SYNCHRONOUSLY with activeTabId. applyTabNav sets the view
    // asynchronously (after awaiting project/graph/storyboard loads), which left a
    // one-render gap where activeTabId had switched but activeView had not — during
    // it a kept-alive pane (e.g. frame) showed while its origin-bound overlay (the
    // preview) was still hidden, so returning to a tab flashed the bare view before
    // the preview popped in. Setting the view here closes the gap; applyTabNav's
    // later setActiveView(tab.view) is idempotent. The preview stays in state,
    // origin-bound, so it reveals in the same commit.
    set({ activeTabId: id, activeView: tab.view });
    void applyTabNav(get, tab);
  },

  recordTabHistory(entry) {
    const st = get();
    const tab = st.tabs.find(t => t.id === st.activeTabId);
    if (!tab) return;
    if (suppressNextTabHistory.delete(tab.id)) return;
    if (entry.view === st.activeView && entry.projectId === st.activeProjectId) return;

    const history = [...(tab.history || [])];
    const last = history[history.length - 1];
    if (!last || last.view !== entry.view || last.projectId !== entry.projectId || !sameSub(last.sub, entry.sub)) {
      history.push({ ...entry, sub: entry.sub ? { ...entry.sub } : undefined });
    }
    if (history.length > 50) history.splice(0, history.length - 50);
    // A fresh navigation creates a new branch, exactly like a browser: pages
    // previously exposed by Forward no longer belong to this route.
    set({ tabs: st.tabs.map(t => t.id === tab.id ? { ...t, history, forward: [] } : t) });
  },

  goBack() {
    const st = get();
    const tab = st.tabs.find(t => t.id === st.activeTabId);
    const history = [...(tab?.history || [])];
    const target = history.pop();
    if (!tab || !target) return;

    const current: TabHistoryEntry = {
      view: st.activeView,
      projectId: st.activeProjectId,
      sub: tab.sub ? { ...tab.sub } : undefined,
    };
    const forward = [...(tab.forward || []), current];
    if (forward.length > 50) forward.splice(0, forward.length - 50);

    suppressNextTabHistory.add(tab.id);
    const restored: Tab = { ...tab, ...target, history, forward };
    set({
      tabs: st.tabs.map(t => t.id === tab.id ? restored : t),
      activeView: target.view,
      activeProjectId: target.projectId,
      dopTargetNodeId: null,
    });
    void applyTabNav(get, restored);
  },

  goForward() {
    const st = get();
    const tab = st.tabs.find(t => t.id === st.activeTabId);
    const forward = [...(tab?.forward || [])];
    const target = forward.pop();
    if (!tab || !target) return;

    const current: TabHistoryEntry = {
      view: st.activeView,
      projectId: st.activeProjectId,
      sub: tab.sub ? { ...tab.sub } : undefined,
    };
    const history = [...(tab.history || []), current];
    if (history.length > 50) history.splice(0, history.length - 50);

    suppressNextTabHistory.add(tab.id);
    const restored: Tab = { ...tab, ...target, history, forward };
    set({
      tabs: st.tabs.map(t => t.id === tab.id ? restored : t),
      activeView: target.view,
      activeProjectId: target.projectId,
      dopTargetNodeId: null,
    });
    void applyTabNav(get, restored);
  },

  setActiveTabSub(patch) {
    set(st => ({
      tabs: st.tabs.map(t => t.id === st.activeTabId ? { ...t, sub: { ...t.sub, ...patch } } : t),
    }));
  },

  activeTab() {
    const st = get();
    return st.tabs.find(t => t.id === st.activeTabId) ?? st.tabs[0];
  },

  // ========== Theme / appearance ==========
  async loadThemeConfig() {
    let cfg: any = null;
    try { cfg = await window.hjen.getThemeConfig(); } catch { /* fall back to default */ }
    const customThemes: Theme[] = Array.isArray(cfg?.customThemes)
      ? cfg.customThemes.filter(isValidTheme).map(normalizeTheme)
      : [];
    const wantId: string = typeof cfg?.activeThemeId === 'string' ? cfg.activeThemeId : 'default';
    // Guard: active id must resolve to something real.
    const activeThemeId = (getBuiltin(wantId) || customThemes.find(t => t.id === wantId)) ? wantId : 'default';
    const appearance: Appearance = cfg?.appearance === 'pro' ? 'pro' : 'classic';
    const hubTiles: HubTiles = (cfg?.hubTiles === 'industrial' || cfg?.hubTiles === 'identity' || cfg?.hubTiles === 'faint')
      ? cfg.hubTiles : 'auto';
    const bgShade: string = (typeof cfg?.bgShade === 'string' && /^#[0-9a-fA-F]{6}$/.test(cfg.bgShade))
      ? cfg.bgShade : BG_SHADE_THEME;
    set({ customThemes, activeThemeId, appearance, hubTiles, bgShade });
    applyTheme(resolveTheme(activeThemeId, customThemes), appearance, hubTiles, bgShade);
  },

  setAppearance(a) {
    const { activeThemeId, customThemes, hubTiles, bgShade } = get();
    set({ appearance: a });
    applyTheme(resolveTheme(activeThemeId, customThemes), a, hubTiles, bgShade);
    persistThemeConfig(activeThemeId, customThemes, a, hubTiles, bgShade);
  },

  setHubTiles(h) {
    const { activeThemeId, customThemes, appearance, bgShade } = get();
    set({ hubTiles: h });
    applyTheme(resolveTheme(activeThemeId, customThemes), appearance, h, bgShade);
    persistThemeConfig(activeThemeId, customThemes, appearance, h, bgShade);
  },

  setBgShade(v) {
    const { activeThemeId, customThemes, appearance, hubTiles } = get();
    set({ bgShade: v });
    applyTheme(resolveTheme(activeThemeId, customThemes), appearance, hubTiles, v);
    persistThemeConfig(activeThemeId, customThemes, appearance, hubTiles, v);
  },

  setActiveTheme(id) {
    const { customThemes, appearance, hubTiles, bgShade } = get();
    set({ activeThemeId: id });
    applyTheme(resolveTheme(id, customThemes), appearance, hubTiles, bgShade);
    persistThemeConfig(id, customThemes, appearance, hubTiles, bgShade);
  },

  updateActiveTheme(patch) {
    const { activeThemeId, customThemes, appearance, hubTiles, bgShade } = get();
    const cur = resolveTheme(activeThemeId, customThemes);
    if (cur.builtin) return; // editing a built-in is a no-op — UI duplicates first
    const next: Theme = {
      ...cur,
      ...(patch.name != null ? { name: patch.name } : {}),
      ...(patch.base != null ? { base: patch.base } : {}),
      tokens: { ...cur.tokens, ...(patch.tokens || {}) },
      controls: { ...cur.controls, ...(patch.controls || {}) },
      brand: { ...cur.brand, ...(patch.brand || {}) },
      images: { products: { ...cur.images.products, ...(patch.images?.products || {}) } },
      actions: { ...cur.actions, ...(patch.actions || {}) },
    };
    const customThemesNext = customThemes.map(t => (t.id === next.id ? next : t));
    set({ customThemes: customThemesNext });
    applyTheme(next, appearance, hubTiles, bgShade);
    persistThemeConfig(activeThemeId, customThemesNext, appearance, hubTiles, bgShade);
  },

  duplicateTheme(id) {
    const { customThemes, appearance, hubTiles, bgShade } = get();
    const base = resolveTheme(id, customThemes);
    const copy = cloneTheme(base);
    copy.id = makeThemeId();
    copy.builtin = false;
    copy.name = base.builtin ? `${base.name} (custom)` : `${base.name} copy`;
    const customThemesNext = [...customThemes, copy];
    set({ customThemes: customThemesNext, activeThemeId: copy.id });
    applyTheme(copy, appearance, hubTiles, bgShade);
    persistThemeConfig(copy.id, customThemesNext, appearance, hubTiles, bgShade);
    return copy;
  },

  renameTheme(id, name) {
    const { customThemes, activeThemeId, appearance, hubTiles, bgShade } = get();
    const customThemesNext = customThemes.map(t => (t.id === id ? { ...t, name } : t));
    set({ customThemes: customThemesNext });
    if (activeThemeId === id) applyTheme(resolveTheme(id, customThemesNext), appearance, hubTiles, bgShade);
    persistThemeConfig(activeThemeId, customThemesNext, appearance, hubTiles, bgShade);
  },

  deleteTheme(id) {
    const { customThemes, activeThemeId, appearance, hubTiles, bgShade } = get();
    const customThemesNext = customThemes.filter(t => t.id !== id);
    let nextActive = activeThemeId;
    if (activeThemeId === id) {
      nextActive = 'default';
      applyTheme(DEFAULT_THEME, appearance, hubTiles, bgShade);
    }
    set({ customThemes: customThemesNext, activeThemeId: nextActive });
    persistThemeConfig(nextActive, customThemesNext, appearance, hubTiles, bgShade);
  },

  async importThemeFromFile() {
    let raw: any = null;
    try { raw = await window.hjen.importTheme(); } catch { /* ignore */ }
    if (!raw) return; // user cancelled
    if (!isValidTheme(raw)) {
      set({ error: 'Import failed — that file is not a valid HJEN theme.' });
      return;
    }
    const imported = normalizeTheme(raw as Theme);
    imported.id = makeThemeId();
    imported.name = raw.name ? `${raw.name}` : 'Imported theme';
    const { customThemes, appearance, hubTiles, bgShade } = get();
    const customThemesNext = [...customThemes, imported];
    set({ customThemes: customThemesNext, activeThemeId: imported.id });
    applyTheme(imported, appearance, hubTiles, bgShade);
    persistThemeConfig(imported.id, customThemesNext, appearance, hubTiles, bgShade);
  },

  async exportThemeToFile(id) {
    const theme = resolveTheme(id, get().customThemes);
    try {
      await window.hjen.exportTheme({ theme, suggestedName: theme.name });
    } catch (e: any) {
      set({ error: `Export failed: ${e?.message || 'unknown error'}` });
    }
  },

  // ========== Seedance video jobs ==========
  // These actions live in the store (not local component state) so an
  // in-flight runSeedance promise still has a valid target when the user
  // navigates away from the Video page and back. Lost-state was the bug
  // that made jobs vanish on tab switch.
  addVideoJob(job: VideoJob) {
    set(state => ({
      videoJobs: [job, ...state.videoJobs],
      focusedVideoJobId: job.id,
    }));
  },
  updateVideoJob(id: string, patch: Partial<VideoJob>) {
    set(state => ({
      videoJobs: state.videoJobs.map(j => j.id === id ? { ...j, ...patch } : j),
    }));
  },
  focusVideoJob(id: string | null) {
    set({ focusedVideoJobId: id });
  },
  removeVideoJob(id: string) {
    set(state => ({
      videoJobs: state.videoJobs.filter(j => j.id !== id),
      focusedVideoJobId: state.focusedVideoJobId === id ? null : state.focusedVideoJobId,
    }));
  },

  // ========== Background jobs (operations subsystem) ==========
  // Same durability contract as video jobs: the running promise writes back
  // here via get().updateJob / get().finishJob, so leaving the launching view
  // never loses the op. History is bounded to the last JOB_HISTORY_CAP.
  startJob(partial) {
    const id = newBgJobId();
    const job: BgJob = {
      id,
      kind: partial.kind,
      title: partial.title,
      projectId: partial.projectId ?? null,
      nav: partial.nav,
      // first stage starts active so the tab reads "1/n" immediately
      stages: partial.stages.map((s, i) => ({ ...s, state: i === 0 ? 'active' : 'pending' })),
      status: 'running',
      progressText: partial.progressText,
      createdAt: Date.now(),
    };
    set(state => {
      const next = [job, ...state.bgJobs];
      // drop the oldest FINISHED jobs past the cap (never evict a running one)
      if (next.length > JOB_HISTORY_CAP) {
        const finished = next.filter(j => j.status !== 'running');
        const overflow = next.length - JOB_HISTORY_CAP;
        const evict = new Set(finished.slice(-overflow).map(j => j.id));
        return { bgJobs: next.filter(j => !evict.has(j.id)) };
      }
      return { bgJobs: next };
    });
    persistJobs(get().bgJobs);
    return id;
  },
  updateJob(id, patch) {
    set(state => ({
      bgJobs: state.bgJobs.map(j => {
        if (j.id !== id || j.status !== 'running') return j;
        const stages = patch.stages ?? (patch.activeStage ? advanceStages(j.stages, patch.activeStage) : j.stages);
        return { ...j, stages, progressText: patch.progressText ?? j.progressText, nav: patch.nav ?? j.nav };
      }),
    }));
    persistJobs(get().bgJobs);
  },
  finishJob(id, opts) {
    set(state => ({
      bgJobs: state.bgJobs.map(j => {
        if (j.id !== id) return j;
        const stages = opts.status === 'done'
          ? j.stages.map(s => ({ ...s, state: 'done' as JobStageState }))
          : opts.status === 'interrupted'
          ? j.stages.map(s => s.state === 'active' ? { ...s, state: 'interrupted' as JobStageState } : s)
          : j.stages.map(s => s.state === 'active' ? { ...s, state: 'error' as JobStageState } : s);
        return {
          ...j,
          status: opts.status,
          stages,
          nav: opts.nav ?? j.nav,
          error: opts.error ?? j.error,
          doneAt: Date.now(),
        };
      }),
    }));
    persistJobs(get().bgJobs);
  },
  getJob(id) { return get().bgJobs.find(j => j.id === id); },
  recentJobs(n) { return get().bgJobs.slice(0, Math.max(0, n)); },
  dismissJobTabs(ids) {
    const set2 = new Set(ids);
    set(state => ({ bgJobs: state.bgJobs.map(j => set2.has(j.id) ? { ...j, dismissedFromTab: true } : j) }));
  },
  dismissJobTab(id) {
    set(state => ({ bgJobs: state.bgJobs.map(j => j.id === id ? { ...j, dismissedFromTab: true } : j) }));
    persistJobs(get().bgJobs);
  },
  // ── Crash/quit resilience — hydrate + reconcile ──
  // Read the persisted operations log on boot. Any job left `running` was being
  // driven by a renderer that no longer exists (the app quit/crashed) — reconcile
  // it to `interrupted` (NOT done, NOT error) and mark its active stage as the
  // stop point. Completed work stays checkpointed on disk; RESUME re-runs only
  // what's missing. Runs before any new job can start, so it never clobbers.
  async hydrateJobs() {
    try {
      const data = await window.hjen.jobsRead();
      const raw = (data?.jobs ?? []) as BgJob[];
      if (!Array.isArray(raw) || raw.length === 0) return;
      let changed = false;
      const reconciled = raw.map(j => {
        if (j.status !== 'running') return j;
        changed = true;
        const stages = j.stages.map(s => s.state === 'active' ? { ...s, state: 'interrupted' as JobStageState } : s);
        return { ...j, status: 'interrupted' as JobStatus, stages, doneAt: j.doneAt ?? Date.now() };
      });
      set({ bgJobs: reconciled });
      if (changed) persistJobs(reconciled);
    } catch {
      // non-fatal — a missing/corrupt log just means an empty operations register
    }
  },
  // RESUME an interrupted job from its on-disk checkpoint. Dispatches by kind to
  // the SAME retro path the "FINISH THE DNAS" / "MAKE THE MASTER PROMPTS" buttons
  // use (which make ONLY the missing pieces), registering a fresh running job that
  // continues from the checkpoint. No-op when the job isn't interrupted, is
  // already resumed, or has no resume path (RESUME is disabled for those in the UI).
  resumeJob(id) {
    const job = get().getJob(id);
    // Resume an interrupted (app-quit) OR errored (a stage failed) job — both keep
    // their on-disk checkpoint, so either can be continued from where it stopped.
    if (!job || (job.status !== 'interrupted' && job.status !== 'error') || job.resumedJobId) return;
    // A crashed image make resumes by re-applying its saved prompt + settings
    // into the Frame form (the pending payload was loaded into interruptedJobs
    // on boot; the BgJob links to it via nav.sub.pendingId). No fresh job is
    // registered — the restore IS the resume.
    if (job.kind === 'frame-make' && job.status === 'interrupted') {
      const pendingId = job.nav.sub?.pendingId;
      if (typeof pendingId === 'string' && get().interruptedJobs.some(p => p.id === pendingId)) {
        get().restoreInterruptedJob(pendingId);
      } else {
        get().setActiveView('frame');
      }
      set(state => ({ bgJobs: state.bgJobs.map(j => j.id === id ? { ...j, status: 'done' as JobStatus, resumedJobId: j.id } : j) }));
      persistJobs(get().bgJobs);
      return;
    }
    const newId = beginBreakdownResume(job);
    if (!newId) return;
    set(state => ({ bgJobs: state.bgJobs.map(j => j.id === id ? { ...j, resumedJobId: newId } : j) }));
    persistJobs(get().bgJobs);
  },
  async openJobNav(id) {
    const job = get().bgJobs.find(j => j.id === id);
    if (!job) return;
    let { view, projectId, sub } = job.nav;
    // A RUNNING breakdown-run has no disc on disk yet — send the click to its
    // LIVE progress page (the re-attach view) via a liveJobId hint, not the
    // (missing) disc. Finished jobs keep their normal nav (the disc).
    if (job.kind === 'breakdown-run' && job.status === 'running') {
      view = 'breakdown';
      projectId = null;
      sub = { liveJobId: job.id };
    }
    // Every frame make lands in the ONE Frame view — its per-job pendingId is a
    // resume handle, not a tab identity. Drop it so clicking ten finished frame
    // jobs activates the single Frame tab, never opens ten of them.
    if (job.kind === 'frame-make') {
      view = 'frame';
      sub = undefined;
    }
    // Resolve the project the destination TAB will actually adopt, so matching
    // works: an explicit still-existing nav project resolves to itself; a
    // project-agnostic job (projectId null) adopts the LIVE active project —
    // that's what syncActiveTab stamps onto the tab once opened. Matching on the
    // raw nav.projectId (null) is why a project-agnostic job never re-matched.
    let resolvedPid: string | null = projectId;
    if (resolvedPid) {
      if (!get().projects.some(p => p.id === resolvedPid)) await get().loadProjects();
      if (!get().projects.some(p => p.id === resolvedPid)) resolvedPid = null; // project gone
    }
    if (!resolvedPid) resolvedPid = get().activeProjectId;
    const matches = (t: Tab) =>
      t.view === view && t.projectId === resolvedPid && sameSub(t.sub, sub);

    // Anwar's 3-case dedup — never hijack the current tab, never proliferate:
    // 1) destination IS the active tab → do nothing (the chip is dismissed by
    //    the caller; the user is already on that task's page).
    const activeTab = get().tabs.find(t => t.id === get().activeTabId);
    if (activeTab && matches(activeTab)) return;
    // 2) destination is open in ANOTHER tab → activate that tab, no new one.
    const existing = get().tabs.find(t => t.id !== get().activeTabId && matches(t));
    if (existing) { get().selectTab(existing.id); return; }
    // 3) no tab holds the destination → open a NEW tab at it and activate it.
    //    applyTabNav restores view/project/sub (BreakdownView reads sub.slug),
    //    and syncActiveTab stamps the resolved project onto the new tab.
    const tab: Tab = { id: newTabId(), view, projectId, sub };
    set(st => ({ tabs: [...st.tabs, tab], activeTabId: tab.id }));
    await applyTabNav(get, tab);
  },
  setStatusBarVisible(v) { set({ statusBarVisible: v }); },
  addVideoRef(asset: LibraryAsset, category: LibCategory) {
    const ref: VideoRef = {
      id: `vref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      assetId: asset.id,
      category,
      filePath: asset.filePath,
      thumbPath: asset.thumbPath,
      name: asset.name,
    };
    set(state => ({ videoRefs: [...state.videoRefs, ref] }));
  },
  removeVideoRef(id: string) {
    set(state => ({ videoRefs: state.videoRefs.filter(r => r.id !== id) }));
  },
  clearVideoRefs() {
    set({ videoRefs: [] });
  },
  setVideoRefs(refs: VideoRef[]) {
    set({ videoRefs: refs });
  },
  /** Submit a Seedance job AND fire the runSeedance promise. The promise is
   *  intentionally NOT awaited — we want the call site (the Animate button)
   *  to return immediately so the form is ready for the next submission.
   *  The promise's completion writes back via updateVideoJob, surviving
   *  any unmount. */
  submitVideoJob(input: VideoJobInput) {
    const id = `vjob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const proj = get().activeProject();
    const title = input.prompt.trim().split(/[.!?\n]/)[0]?.slice(0, 80) || 'untitled';
    const job: VideoJob = {
      id,
      startedAt: Date.now(),
      prompt: input.prompt,
      promptTitle: title,
      sourcePath: input.sourcePath,
      endFramePath: input.endFramePath,
      resolution: input.resolution,
      duration: input.duration,
      ratio: input.ratio,
      fps: input.fps,
      seed: input.seed,
      cameraFixed: input.cameraFixed,
      watermark: input.watermark,
      audio: input.audio,
      modelId: input.modelId,
      phase: 'submitting',
    };
    get().addVideoJob(job);

    // Register the make as an app-wide operation (BgJob) — task-tab + status bar
    // + LOG. Video is the TRUE durability case: the render runs server-side, so
    // the pending payload we persist on submit carries the server taskId and a
    // crash is recoverable by re-polling on reopen (see recoverPendingVideos).
    const bgId = get().startJob({
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
      progressText: `${input.resolution} · ${input.duration}s`,
    });

    // Fire and forget. The async import avoids a top-of-file dep cycle —
    // seedance.ts pulls types that aren't materialized at store-init time.
    void (async () => {
      const { runSeedance, slugifyPrompt } = await import('./lib/seedance');
      const { estimateSeedanceCost } = await import('./lib/pricing');
      const update = get().updateVideoJob;
      const promptSlug = slugifyPrompt(input.prompt);
      try {
        const result = await runSeedance(
          {
            prompt: input.prompt,
            imagePath: input.sourcePath,
            endImagePath: input.endFramePath,
            resolution: input.resolution,
            duration: input.duration,
            ratio: input.ratio,
            fps: input.fps,
            seed: input.seed,
            cameraFixed: input.cameraFixed,
            watermark: input.watermark,
            audio: input.audio,
            modelId: input.modelId || undefined,
            videoRefs: input.videoRefs,
            rawUserPrompt: input.rawUserPrompt,
            selectionsSnapshot: input.selectionsSnapshot,
          },
          {
            promptSlug,
            projectSlug: proj?.slug,
            projectId: proj?.id,
          },
          (p) => {
            update(id, { phase: p.phase, status: p.status, taskId: p.taskId });
            const stage = p.phase === 'downloading' ? 'download'
              : p.phase === 'saving' ? 'save'
              : (p.phase === 'queued' || p.phase === 'running') ? 'render'
              : 'submit';
            get().updateJob(bgId, { activeStage: stage, progressText: p.status || p.phase });
          },
          // onSubmitted — the server accepted the task. Persist a durable pending
          // record NOW (with the taskId) so a crash mid-render is recoverable.
          ({ taskId, model, promptFull }) => {
            update(id, { taskId });
            get().updateJob(bgId, { activeStage: 'render' });
            const payload: PendingVideoPayload = {
              id, kind: 'video', ts: job.startedAt, taskId,
              promptTitle: title, prompt: input.prompt, promptFull,
              modelId: input.modelId, model,
              imagePath: input.sourcePath, endImagePath: input.endFramePath,
              resolution: input.resolution, duration: input.duration, ratio: input.ratio,
              fps: input.fps, seed: input.seed ?? null, cameraFixed: input.cameraFixed,
              watermark: input.watermark, audio: input.audio, promptSlug,
              project: proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null,
              videoRefs: input.videoRefs, rawUserPrompt: input.rawUserPrompt,
              selectionsSnapshot: input.selectionsSnapshot ?? null,
            };
            void window.hjen.savePendingJob({ id, payload });
          },
        );
        const tokens = result.usage?.completion_tokens ?? null;
        const cost = estimateSeedanceCost(tokens);
        update(id, {
          phase: 'done',
          taskId: result.taskId,
          resultPath: result.videoPath,
          finishedAt: Date.now(),
          tokens: tokens ?? undefined,
          estimatedUsd: cost?.usd,
        });
        get().finishJob(bgId, { status: 'done' });
        try { await window.hjen.clearPendingJob({ id }); } catch {}
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        update(id, { phase: 'failed', error: errMsg, finishedAt: Date.now() });
        get().finishJob(bgId, { status: 'error', error: errMsg });
        try { await window.hjen.clearPendingJob({ id }); } catch {}
        // Persist failure to disk for the sidebar — mirrors what the old
        // local-state code did but here it survives unmount.
        try {
          const fid = `vfail-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await window.hjen.saveFailedVideo({
            id: fid,
            payload: {
              id: fid,
              ts: Date.now(),
              promptTitle: title,
              errorMessage: errMsg,
              prompt: input.prompt,
              imagePath: input.sourcePath,
              endImagePath: input.endFramePath,
              resolution: input.resolution,
              duration: input.duration,
              ratio: input.ratio,
              fps: input.fps,
              seed: input.seed,
              cameraFixed: input.cameraFixed,
              watermark: input.watermark,
              audio: input.audio,
              modelId: input.modelId,
              project: proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null,
            },
          });
        } catch {}
      }
    })();
  },

  openPreview(entry, list) {
    const { activeTabId, activeView } = get();
    set({
      preview: entry,
      previewList: list && list.length > 0 ? list : [entry],
      previewOrigin: { tabId: activeTabId, view: activeView },
    });
  },

  closePreview() {
    set({ preview: null, previewList: [], previewOrigin: null });
  },

  navigatePreview(direction) {
    const { preview, previewList } = get();
    if (!preview || previewList.length === 0) return;
    const idx = previewList.findIndex(e => e.imgPath === preview.imgPath);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= previewList.length) return;
    set({ preview: previewList[newIdx] });
  },

  // ---- Library ----

  async loadLibrary() {
    try {
      const library = await window.hjen.listLibrary();
      set({ library });
    } catch {
      // leave existing
    }
  },

  async uploadToLibrary(category: LibCategory, prePickedPaths?: string[]) {
    const paths = prePickedPaths ?? await window.hjen.pickImageFiles();
    if (!paths || paths.length === 0) return 0;
    const results = await Promise.all(paths.map(p =>
      window.hjen.addToLibrary({ category, sourcePath: p })
    ));
    const added = results
      .filter(r => r.ok && r.asset)
      .map(r => r.asset!);
    // Dedup against the in-memory index: the main process may have
    // returned an existing asset (same content hash) instead of creating
    // a new one, in which case it's already in s.library and we'd push
    // a React-key collision if we prepended blindly.
    set(state => {
      const known = new Set(state.library.map(a => a.id));
      const fresh = added.filter(a => !known.has(a.id));
      return { library: [...fresh, ...state.library] };
    });
    return added.length;
  },

  async pickLibraryFiles() {
    return window.hjen.pickImageFiles();
  },

  async moveLibraryAsset(id: string, newCategory: LibCategory) {
    const result = await window.hjen.moveLibraryAsset({ id, newCategory });
    if (!result.ok || !result.asset) {
      set({ error: result.reason || 'Could not move asset.' });
      return;
    }
    const moved = result.asset;
    set(state => ({
      library: state.library.map(a => a.id === id ? moved : a),
      error: null,
    }));
  },

  async bulkDeleteLibraryAssets(ids: string[]) {
    if (ids.length === 0) return;
    await Promise.all(ids.map(id => window.hjen.deleteFromLibrary({ id })));
    const dropped = new Set(ids);
    set(state => ({
      library: state.library.filter(a => !dropped.has(a.id)),
      layers: state.layers.filter(l => !dropped.has(l.assetId)),
    }));
  },

  async dedupLibrary() {
    const result = await window.hjen.dedupLibrary();
    if (!result.ok) {
      set({ error: 'Dedup failed.' });
      return { removed: 0, freedBytes: 0, backfilled: 0 };
    }
    // Rewrite any in-memory layers that pointed at a now-deleted asset
    // to its surviving twin. Without this, the Layers sidebar would
    // render with broken thumbnails until next loadLibrary().
    set(state => ({
      library: result.survivors,
      layers: state.layers.map(l => {
        const survivorId = result.remap[l.assetId];
        return survivorId ? { ...l, assetId: survivorId } : l;
      }),
      error: null,
    }));
    return {
      removed: result.removed,
      freedBytes: result.freedBytes,
      backfilled: result.backfilled,
    };
  },

  async refineFromCurrent() {
    const state = get();
    const cur = state.current;
    if (!cur?.savedPath) {
      set({ error: 'Save the frame first — Refine needs a file path to anchor the composition lock.' });
      return;
    }
    // Use the first clause of the prompt as the asset name, capped — gives the
    // user a recognisable label in the Library and Layers list.
    const rawName = (state.selections.prompt || cur.prompt || 'Refine source').trim();
    const name = (rawName.split(/[.!?\n,]/)[0] || rawName).slice(0, 60).trim() || 'Refine source';
    try {
      const result = await window.hjen.addToLibrary({
        category: 'composition',
        sourcePath: cur.savedPath,
        name,
      });
      if (!result.ok || !result.asset) {
        set({ error: result.reason || 'Could not push the frame to the Library.' });
        return;
      }
      const asset = result.asset;
      // Library: only prepend if the asset isn't already in the in-memory
      // index. On dedup the main process returns the existing asset, which
      // is normally already present (loadLibrary runs at startup), so this
      // would push a duplicate React entry without the guard.
      set(s => ({
        library: s.library.some(a => a.id === asset.id) ? s.library : [asset, ...s.library],
        error: null,
      }));
      // Layer: skip the add if a composition layer is already locked to
      // this asset. The user repeatedly pressing Refine on the same frame
      // is a no-op past the first press — same file, same lock, no new
      // entry stacking up in the sidebar.
      const alreadyLayered = get().layers.some(l =>
        l.category === 'composition' && l.assetId === asset.id
      );
      if (!alreadyLayered) {
        get().addLayer(asset, 'composition');
      }
      // Always reveal the sidebar so the press feels acknowledged, even
      // when nothing new was added.
      get().setLayersOpen(true);
    } catch (err: any) {
      set({ error: err?.message || 'Refine failed.' });
    }
  },

  async deleteLibraryAsset(id: string) {
    await window.hjen.deleteFromLibrary({ id });
    set(state => ({
      library: state.library.filter(a => a.id !== id),
      // Also remove any layers that referenced this asset
      layers: state.layers.filter(l => l.assetId !== id),
    }));
  },

  // ---- Skills ----

  async loadSkills() {
    try {
      const skills = await window.hjen.listSkills();
      set(state => ({
        skills,
        // A file may have been removed directly from the Skills folder while
        // it was active. Never leave a stale transformation selected.
        activeSkillId: state.activeSkillId && skills.some(skill => skill.id === state.activeSkillId)
          ? state.activeSkillId
          : null,
      }));
    } catch {
      // leave existing
    }
  },

  async importSkill() {
    const sourcePath = await window.hjen.pickSkillFile();
    if (!sourcePath) return { ok: false, reason: 'cancelled' };
    const res = await window.hjen.importSkill({ sourcePath });
    if (!res.ok) {
      // Map the storage-layer reason to a user-readable message
      const found = res.foundKeys && res.foundKeys.length > 0
        ? ` Found keys instead: ${res.foundKeys.join(', ')}.`
        : '';
      const msg = res.reason === 'already_exists' ? 'A skill with this name is already installed.'
        : res.reason === 'missing_name'     ? `Skill file is missing a \`name:\` field in its frontmatter.${found}`
        : res.reason === 'no_frontmatter'   ? 'Skill file has no YAML frontmatter. Add a `---` block at the top with at least a `name:` line.'
        : res.reason === 'empty_body'       ? 'Skill file has no body content after the frontmatter.'
        : res.reason === 'read_failed'      ? 'Could not read the selected file.'
        : res.reason === 'source_not_found' ? 'Selected file no longer exists.'
        : 'Skill import failed.';
      set({ skillImportError: msg });
      return { ok: false, reason: res.reason };
    }
    set(state => ({
      skills: [...state.skills.filter(s => s.id !== res.skill.id), res.skill]
        .sort((a, b) => a.name.localeCompare(b.name)),
      skillImportError: null,
    }));
    return { ok: true };
  },

  async saveSkill(draft) {
    const res = await window.hjen.saveSkill(draft);
    if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
    set(state => ({
      skills: [...state.skills.filter(skill => skill.id !== res.skill.id), res.skill]
        .sort((a, b) => a.name.localeCompare(b.name)),
      skillImportError: null,
    }));
    return { ok: true };
  },

  async deleteSkill(id: string) {
    await window.hjen.deleteSkill({ id });
    set(state => ({
      skills: state.skills.filter(s => s.id !== id),
      activeSkillId: state.activeSkillId === id ? null : state.activeSkillId,
    }));
  },

  setActiveSkill(id: string | null) {
    set({ activeSkillId: id });
  },

  setLayerEnabled(on: boolean) {
    set({ layerEnabled: on });
    persistLayerEnabledPref(on);
  },

  clearSkillImportError() {
    set({ skillImportError: null });
  },

  // ---- NODE engine ----

  addGraphNode(type, pos) {
    registerBuiltinNodes();
    const spec = getNodeSpec(type);
    if (!spec) return;
    get().pushGraphHistory(`Add ${spec.label}`);
    const paramValues: Record<string, unknown> = {};
    for (const p of spec.params) {
      if (p.kind === 'property' && p.default !== undefined) paramValues[p.name] = p.default;
    }
    // A Frame node inherits the current DOP selections as its baseline look.
    if (type === 'frame') {
      paramValues.dop = { type: 'selectionSet', selections: { ...get().selections } };
    }
    const node: NodeInstance = { id: graphId('n'), type, position: pos, paramValues };
    set(s => ({ graphNodes: [...s.graphNodes, node], selectedNodeId: node.id, graphStatus: `Added ${spec.label} node.` }));
    get().persistGraph();
    // DOP is NOT auto-opened — it opens only when the user clicks "Open DOP"
    // in the Frame's right-hand settings, and appears on the RIGHT.
  },

  moveGraphNode(id, pos) {
    set(s => ({ graphNodes: s.graphNodes.map(n => n.id === id ? { ...n, position: pos } : n) }));
    get().persistGraph();
  },

  resizeGraphNode(id, size) {
    set(s => ({ graphNodes: s.graphNodes.map(n => n.id === id ? { ...n, size } : n) }));
    get().persistGraph();
  },

  arrangeGraphNodes(moves) {
    if (!moves.length) return;
    get().pushGraphHistory('Arrange');
    const at = new Map(moves.map(m => [m.id, m.position]));
    set(s => ({
      graphNodes: s.graphNodes.map(n => at.has(n.id) ? { ...n, position: at.get(n.id)! } : n),
      graphStatus: `Arranged ${moves.length} node${moves.length === 1 ? '' : 's'}.`,
    }));
    get().persistGraph();
  },

  removeGraphNode(id) {
    get().pushGraphHistory('Delete node');
    set(s => ({
      graphNodes: s.graphNodes.filter(n => n.id !== id),
      graphEdges: s.graphEdges.filter(e => e.from.node !== id && e.to.node !== id),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
      graphStatus: 'Node removed.',
    }));
    get().persistGraph();
  },

  addGraphEdge(from, to) {
    if (from.node === to.node) return;
    get().pushGraphHistory('Connect');
    set(s => {
      // An input port accepts a single connection — replace any existing edge
      // into the same target param, and dedupe identical edges.
      const filtered = s.graphEdges.filter(e => !(e.to.node === to.node && e.to.param === to.param));
      const dup = filtered.some(e => e.from.node === from.node && e.from.param === from.param && e.to.node === to.node && e.to.param === to.param);
      if (dup) return {};
      return { graphEdges: [...filtered, { id: graphId('e'), from, to }] };
    });
    get().persistGraph();
  },

  removeGraphEdge(id) {
    get().pushGraphHistory('Disconnect');
    set(s => ({ graphEdges: s.graphEdges.filter(e => e.id !== id) }));
    get().persistGraph();
  },

  setNodeParam(id, param, value) {
    get().pushGraphHistory('Edit settings');
    set(s => ({
      graphNodes: s.graphNodes.map(n => n.id === id ? { ...n, paramValues: { ...n.paramValues, [param]: value } } : n),
    }));
    get().persistGraph();
  },

  selectGraphNode(id) {
    set({ selectedNodeId: id });
  },

  // ---- Graph undo/redo (nodes + edges only, scoped per canvas) ----
  pushGraphHistory(label = 'Edit') {
    const s = get();
    const top = s.graphUndoStack[s.graphUndoStack.length - 1];
    // Skip a no-op push (e.g. a click with no actual change).
    if (top && sameGraph(top, s.graphNodes, s.graphEdges)) {
      if (s.graphHistoryCanvasId !== s.activeCanvasId) set({ graphHistoryCanvasId: s.activeCanvasId });
      return;
    }
    const snap = cloneGraph(s.graphNodes, s.graphEdges, label);
    set({
      graphUndoStack: [...s.graphUndoStack, snap].slice(-GRAPH_HISTORY_LIMIT),
      graphRedoStack: [],
      graphHistoryCanvasId: s.activeCanvasId,
    });
  },

  undoGraph() {
    const s = get();
    if (!s.graphUndoStack.length) return;
    const prev = s.graphUndoStack[s.graphUndoStack.length - 1];
    const cur = cloneGraph(s.graphNodes, s.graphEdges, prev.label);
    const liveIds = new Set(prev.nodes.map(n => n.id));
    set({
      graphNodes: prev.nodes.map(n => ({ ...n })),
      graphEdges: prev.edges.map(e => ({ ...e })),
      graphUndoStack: s.graphUndoStack.slice(0, -1),
      graphRedoStack: [...s.graphRedoStack, cur].slice(-GRAPH_HISTORY_LIMIT),
      selectedNodeId: s.selectedNodeId && liveIds.has(s.selectedNodeId) ? s.selectedNodeId : null,
      graphStatus: `Undo · ${prev.label}`,
    });
    get().persistGraph();
  },

  redoGraph() {
    const s = get();
    if (!s.graphRedoStack.length) return;
    const next = s.graphRedoStack[s.graphRedoStack.length - 1];
    const cur = cloneGraph(s.graphNodes, s.graphEdges, next.label);
    const liveIds = new Set(next.nodes.map(n => n.id));
    set({
      graphNodes: next.nodes.map(n => ({ ...n })),
      graphEdges: next.edges.map(e => ({ ...e })),
      graphRedoStack: s.graphRedoStack.slice(0, -1),
      graphUndoStack: [...s.graphUndoStack, cur].slice(-GRAPH_HISTORY_LIMIT),
      selectedNodeId: s.selectedNodeId && liveIds.has(s.selectedNodeId) ? s.selectedNodeId : null,
      graphStatus: `Redo · ${next.label}`,
    });
    get().persistGraph();
  },

  jumpHistory(steps) {
    const n = Math.abs(steps);
    for (let i = 0; i < n; i++) {
      if (steps < 0) get().undoGraph();
      else get().redoGraph();
    }
  },

  setNodeMode(m) { set({ nodeMode: m }); },

  removeGraphNodes(ids) {
    if (!ids.length) return;
    get().pushGraphHistory(`Delete ${ids.length} node${ids.length === 1 ? '' : 's'}`);
    const idset = new Set(ids);
    set(s => ({
      graphNodes: s.graphNodes.filter(n => !idset.has(n.id)),
      graphEdges: s.graphEdges.filter(e => !idset.has(e.from.node) && !idset.has(e.to.node)),
      selectedNodeId: s.selectedNodeId && idset.has(s.selectedNodeId) ? null : s.selectedNodeId,
      graphStatus: `Removed ${ids.length} node${ids.length === 1 ? '' : 's'}.`,
    }));
    get().persistGraph();
  },

  pasteNodes(payload, at) {
    if (!payload || !payload.nodes.length) return [];
    get().pushGraphHistory('Paste');
    const idmap = new Map<string, string>();
    for (const n of payload.nodes) idmap.set(n.id, graphId('n'));
    const dx = at.x - payload.origin.x;
    const dy = at.y - payload.origin.y;
    const nodes: NodeInstance[] = payload.nodes.map(n => ({
      ...(JSON.parse(JSON.stringify(n)) as NodeInstance),
      id: idmap.get(n.id)!,
      position: { x: n.position.x + dx, y: n.position.y + dy },
      // A paste is a NEW independent node: drop stack + rating; keep params + label colour.
      favorite: undefined, rejected: undefined, stackId: undefined, takeIndex: undefined,
    }));
    const edges: GraphEdge[] = payload.edges.map(e => ({
      id: graphId('e'),
      from: { node: idmap.get(e.from.node)!, param: e.from.param },
      to: { node: idmap.get(e.to.node)!, param: e.to.param },
    }));
    set(s => ({
      graphNodes: [...s.graphNodes, ...nodes],
      graphEdges: [...s.graphEdges, ...edges],
      selectedNodeId: nodes.length === 1 ? nodes[0].id : null,
      graphStatus: `Pasted ${nodes.length} node${nodes.length === 1 ? '' : 's'}.`,
    }));
    get().persistGraph();
    return nodes.map(n => n.id);
  },

  // ---- Take-loop ----
  setNodeFavorite(id, on) {
    get().pushGraphHistory('Favorite');
    set(s => ({
      graphNodes: s.graphNodes.map(n => {
        if (n.id !== id) return n;
        const fav = on === undefined ? !n.favorite : on;
        return { ...n, favorite: fav, rejected: fav ? false : n.rejected };
      }),
      graphStatus: 'Favorite toggled.',
    }));
    get().persistGraph();
  },

  setNodeRejected(id, on) {
    get().pushGraphHistory('Reject');
    set(s => ({
      graphNodes: s.graphNodes.map(n => {
        if (n.id !== id) return n;
        const rej = on === undefined ? !n.rejected : on;
        return { ...n, rejected: rej, favorite: rej ? false : n.favorite };
      }),
      graphStatus: 'Reject toggled.',
    }));
    get().persistGraph();
  },

  setNodeColorLabel(id, label) {
    get().pushGraphHistory('Colour label');
    set(s => ({
      graphNodes: s.graphNodes.map(n => n.id === id ? { ...n, colorLabel: label ?? undefined } : n),
    }));
    get().persistGraph();
  },

  renameNode(id, name) {
    get().pushGraphHistory('Rename');
    set(s => ({ graphNodes: s.graphNodes.map(n => n.id === id ? { ...n, name: name.trim() || undefined } : n) }));
    get().persistGraph();
  },

  duplicateAsTake(id) {
    const s = get();
    const src = s.graphNodes.find(n => n.id === id);
    if (!src) return '';
    get().pushGraphHistory('New take');
    const stackId = src.stackId ?? graphId('stk');
    const maxIdx = s.graphNodes
      .filter(n => n.stackId === stackId)
      .reduce((m, n) => Math.max(m, n.takeIndex ?? 0), src.takeIndex ?? 0);
    const newId = graphId('n');
    const clone: NodeInstance = {
      ...(JSON.parse(JSON.stringify(src)) as NodeInstance),
      id: newId,
      position: { x: src.position.x + 212, y: src.position.y },
      favorite: false, rejected: false,
      stackId, takeIndex: maxIdx + 1,
    };
    set(sx => ({
      graphNodes: [
        ...sx.graphNodes.map(n => n.id === id && n.stackId == null ? { ...n, stackId, takeIndex: 0 } : n),
        clone,
      ],
      selectedNodeId: newId,
      graphStatus: 'New take.',
    }));
    get().persistGraph();
    return newId;
  },

  async runGraph() {
    if (get().graphRunning) return;
    registerBuiltinNodes();
    const nodes = get().graphNodes;
    const edges = get().graphEdges;
    const proj = get().activeProject();
    const projSnap = proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null;
    // Drop to single-flight when a Video node is in play (long poll + cost).
    const hasVideo = nodes.some(n => n.type === 'video' && edges.some(e => e.from.node === n.id || e.to.node === n.id));
    const engine = new GraphEngine();
    activeGraphEngine = engine;
    set({ graphRunning: true, nodeRuntime: {}, error: null, graphStatus: 'Running pipeline…' });
    try {
      await engine.run(nodes, edges, {
        project: projSnap,
        concurrency: hasVideo ? 1 : 2,
        onNodeStatus: (id, patch) => set(s => ({
          nodeRuntime: { ...s.nodeRuntime, [id]: { ...(s.nodeRuntime[id] ?? { status: 'idle' }), ...patch } },
        })),
      });
      const rt = get().nodeRuntime;
      const failed = Object.values(rt).filter(r => r.status === 'error').length;
      set({ graphStatus: failed > 0 ? `Run finished with ${failed} error(s).` : 'Run complete ✓' });
    } catch (e: any) {
      set({ error: e?.message || String(e), graphStatus: `Run failed: ${e?.message || e}` });
    } finally {
      set({ graphRunning: false });
      if (activeGraphEngine === engine) activeGraphEngine = null;
    }
  },

  cancelGraph() {
    activeGraphEngine?.cancel();
    set({ graphStatus: 'Cancelling…' });
  },

  async loadGraphForProject(id, scope) {
    const want: GraphScope = scope ?? get().graphScope;
    if (!id) { set({ graphLoadedFor: null, graphScope: want }); return; }
    // Already holding this project's canvases FOR THIS WORKSPACE — nothing to do.
    // Scope is part of the identity: the same project has a Node board and a
    // SPACE board, and they are different files.
    if (get().graphLoadedFor === id && get().graphScope === want) return;
    // A pending debounced write still belongs to the OUTGOING scope. Flush it
    // synchronously before we swap, or those edits would be written into the
    // incoming workspace's file (or dropped).
    flushGraphPersist(get);
    try {
      const raw = await window.hjen.readGraph({ id, scope: want }) as any;
      let list: Array<{ id: string; name: string }>;
      let data: Record<string, { nodes: NodeInstance[]; edges: GraphEdge[]; clips: TimelineClip[]; plan?: SpacePlan | null }>;
      let active: string;
      if (raw && Array.isArray(raw.canvases) && raw.canvases.length) {
        // Multi-canvas format.
        list = raw.canvases.map((c: any) => {
          const kind = c.kind === 'mind' ? 'mind' as const : 'media' as const;
          const edgeStyle: EdgeStyle = (c.edgeStyle === 'straight' || c.edgeStyle === 'step' || c.edgeStyle === 'curve' || c.edgeStyle === 'hidden')
            ? c.edgeStyle
            // Default: thinking canvases route orthogonally (Anwar's law —
            // wires must not cut across the notes); media keeps the curve.
            : (kind === 'mind' ? 'step' : 'curve');
          return { id: c.id, name: c.name, kind, edgeStyle };
        });
        data = {};
        for (const c of raw.canvases) {
          const g = docToGraph(c);
          data[c.id] = { nodes: g.nodes, edges: g.edges, clips: Array.isArray(c.clips) ? c.clips : [], plan: c.plan ?? null };
        }
        active = raw.activeCanvasId && data[raw.activeCanvasId] ? raw.activeCanvasId : list[0].id;
      } else if (raw) {
        // Legacy single-canvas doc → wrap as "Canvas 1".
        const g = docToGraph(raw);
        const cid = graphId('cv');
        list = [{ id: cid, name: 'Canvas 1' }];
        data = { [cid]: { nodes: g.nodes, edges: g.edges, clips: Array.isArray(raw.clips) ? raw.clips : [] } };
        active = cid;
      } else {
        // First time — one empty "Start creating" canvas.
        const cid = graphId('cv');
        list = [{ id: cid, name: 'Canvas 1' }];
        data = { [cid]: { nodes: [], edges: [], clips: [] } };
        active = cid;
      }
      const a = data[active];
      set({
        canvasList: list, canvasData: data, activeCanvasId: active,
        graphNodes: a.nodes, graphEdges: a.edges, timelineClips: a.clips, spacePlan: a.plan ?? null,
        nodeRuntime: {}, selectedNodeId: null, graphLoadedFor: id, graphScope: want,
        graphUndoStack: [], graphRedoStack: [], graphHistoryCanvasId: active,
        selectedClipId: null, timelinePlayhead: 0, timelinePlaying: false,
      });
    } catch {
      set({ graphLoadedFor: id, graphScope: want });   // don't wipe the canvas on a read error
    }
  },

  persistGraph() {
    const id = get().graphLoadedFor;
    if (!id) return;   // no active project — nothing to persist
    const scope = get().graphScope;
    if (graphPersistTimer) clearTimeout(graphPersistTimer);
    graphPending = { id, scope };
    graphPersistTimer = setTimeout(() => { graphPersistTimer = null; writeGraphNow(get, id, scope); }, 600);
  },

  // ---- HJEN SPACE plan ----
  setSpacePlan(plan) {
    set({ spacePlan: plan });
    get().persistGraph();
  },
  patchPlanStep(pipelineId, stepIndex, patch) {
    const cur = get().spacePlan;
    if (!cur) return;
    set({
      spacePlan: {
        ...cur,
        pipelines: cur.pipelines.map(p => p.id !== pipelineId ? p : {
          ...p,
          steps: p.steps.map((st, i) => i !== stepIndex ? st : { ...st, ...patch }),
        }),
      },
    });
    get().persistGraph();
  },

  // ---- Canvases (multiple per project) ----
  createCanvas(name, kind) {
    const s = get();
    const cid = graphId('cv');
    const nm = name?.trim() || `Canvas ${s.canvasList.length + 1}`;
    const data = s.activeCanvasId
      ? { ...s.canvasData, [s.activeCanvasId]: { nodes: s.graphNodes, edges: s.graphEdges, clips: s.timelineClips, plan: s.spacePlan } }
      : { ...s.canvasData };
    data[cid] = { nodes: [], edges: [], clips: [], plan: null };
    set({
      canvasList: [...s.canvasList, { id: cid, name: nm, kind: kind ?? 'media', edgeStyle: kind === 'mind' ? 'step' as const : 'curve' as const }], canvasData: data, activeCanvasId: cid,
      graphNodes: [], graphEdges: [], timelineClips: [], spacePlan: null, nodeRuntime: {}, selectedNodeId: null,
      graphUndoStack: [], graphRedoStack: [], graphHistoryCanvasId: cid, selectedClipId: null,
    });
    get().persistGraph();
  },

  setCanvasEdgeStyle(id, style) {
    set(s => ({ canvasList: s.canvasList.map(c => c.id === id ? { ...c, edgeStyle: style } : c) }));
    get().persistGraph();
  },

  switchCanvas(id) {
    const s = get();
    if (id === s.activeCanvasId) return;
    const target = s.canvasData[id];
    if (!target) return;
    const data = s.activeCanvasId
      ? { ...s.canvasData, [s.activeCanvasId]: { nodes: s.graphNodes, edges: s.graphEdges, clips: s.timelineClips, plan: s.spacePlan } }
      : s.canvasData;
    set({
      canvasData: data, activeCanvasId: id,
      graphNodes: target.nodes, graphEdges: target.edges, timelineClips: target.clips,
      spacePlan: target.plan ?? null,
      nodeRuntime: {}, selectedNodeId: null,
      graphUndoStack: [], graphRedoStack: [], graphHistoryCanvasId: id, selectedClipId: null,
    });
    get().persistGraph();
  },

  renameCanvas(id, name) {
    set(s => ({ canvasList: s.canvasList.map(c => c.id === id ? { ...c, name: name.trim() || c.name } : c) }));
    get().persistGraph();
  },

  deleteCanvas(id) {
    const s = get();
    if (s.canvasList.length <= 1) return;   // always keep at least one canvas
    const list = s.canvasList.filter(c => c.id !== id);
    const data = { ...s.canvasData }; delete data[id];
    if (s.activeCanvasId === id) {
      const next = list[0]; const t = data[next.id];
      set({ canvasList: list, canvasData: data, activeCanvasId: next.id,
        graphNodes: t.nodes, graphEdges: t.edges, timelineClips: t.clips, nodeRuntime: {}, selectedNodeId: null,
        graphUndoStack: [], graphRedoStack: [], graphHistoryCanvasId: next.id, selectedClipId: null });
    } else {
      set({ canvasList: list, canvasData: data });
    }
    get().persistGraph();
  },

  // ---- Timeline (docked, bottom of the Node canvas) ----
  toggleTimeline() { set(s => ({ timelineOpen: !s.timelineOpen })); },

  addToTimeline(nodeId) {
    const s = get();
    const node = s.graphNodes.find(n => n.id === nodeId);
    if (!node) return;
    const rt = s.nodeRuntime[nodeId];
    const out = rt?.outputs?.out;
    const spec = getNodeSpec(node.type);
    // Decide clip kind + poster from the node's produced output (or its asset).
    let kind: TimelineClip['kind'] = 'image';
    let thumb: string | undefined;
    let src: string | undefined;
    let duration = 3;
    if (out?.type === 'video' && out.path) {
      kind = 'video'; src = out.path;
      thumb = out.posterPath ? `hjen-file://${encodeURI(out.posterPath)}` : undefined;
      duration = typeof out.seconds === 'number' ? out.seconds : 5;
    } else if (out?.type === 'image' && (out.url || out.path)) {
      kind = 'image'; src = out.path;
      thumb = out.url || (out.path ? `hjen-file://${encodeURI(out.path)}` : undefined);
    } else {
      const a = (node.paramValues.asset || node.paramValues.plate) as { path?: string; thumbPath?: string } | undefined;
      const p = a?.path || a?.thumbPath;
      if (!p) { set({ graphStatus: 'Nothing to add — generate this node first.' }); return; }
      src = a?.path; thumb = `hjen-file://${encodeURI(p)}`;
    }
    const track: TimelineTrack = 'V1';   // video/image → V1 (audio tracks land with audio nodes later)
    // Drop the clip at the end of its track.
    const end = s.timelineClips.filter(c => c.track === track).reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    const clip: TimelineClip = {
      id: `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      nodeId, kind, track, start: end, duration,
      label: `${spec?.label ?? 'Clip'} ${nodeId.slice(-3)}`, thumb, src,
    };
    set({ timelineClips: [...s.timelineClips, clip], timelineOpen: true, graphStatus: 'Added to timeline.' });
    get().persistGraph();
  },

  moveClip(id, start, track) {
    const s = get();
    let snapped = Math.max(0, start);
    if (s.timelineSnapping) {
      // Snap the clip start to the nearest neighbouring clip boundary (or 0).
      const self = s.timelineClips.find(c => c.id === id);
      const dur = self?.duration ?? 0;
      const edges = [0];
      for (const c of s.timelineClips) { if (c.id !== id) { edges.push(c.start, c.start + c.duration); } }
      const TH = 0.25;   // seconds
      for (const e of edges) {
        if (Math.abs(snapped - e) < TH) { snapped = e; break; }
        if (Math.abs(snapped + dur - e) < TH) { snapped = Math.max(0, e - dur); break; }
      }
    }
    set(st => ({
      timelineClips: st.timelineClips.map(c => c.id === id
        ? { ...c, start: snapped, track: track ?? c.track }
        : c),
    }));
    get().persistGraph();
  },

  removeClip(id) {
    set(s => ({ timelineClips: s.timelineClips.filter(c => c.id !== id), selectedClipId: s.selectedClipId === id ? null : s.selectedClipId }));
    get().persistGraph();
  },

  // ---- Timeline playback + clip editing (driven by the dock + shortcuts) ----
  setPlayhead(t) { set({ timelinePlayhead: Math.max(0, t) }); },
  setPlaying(on) { set({ timelinePlaying: on }); },
  stepPlayhead(dt) { set(s => ({ timelinePlayhead: Math.max(0, s.timelinePlayhead + dt), timelinePlaying: false })); },
  setTimelineFocused(on) { set({ timelineFocused: on }); },
  toggleSnapping() { set(s => ({ timelineSnapping: !s.timelineSnapping, graphStatus: `Snapping ${s.timelineSnapping ? 'off' : 'on'}.` })); },
  selectClip(id) { set({ selectedClipId: id }); },
  setPlayRate(r) { set({ timelineRate: r }); },
  requestExport() { set(s => ({ exportPing: s.exportPing + 1 })); },

  splitClip(id, atTime) {
    const s = get();
    const c = s.timelineClips.find(x => x.id === id);
    if (!c) return;
    const L = atTime - c.start;
    if (L <= 0.05 || L >= c.duration - 0.05) return;   // playhead must be inside the clip
    const first: TimelineClip = { ...c, duration: L };
    const second: TimelineClip = { ...c, id: clipId(), start: c.start + L, duration: c.duration - L, inPoint: (c.inPoint ?? 0) + L };
    set({ timelineClips: s.timelineClips.flatMap(x => x.id === id ? [first, second] : [x]), selectedClipId: second.id, graphStatus: 'Clip split.' });
    get().persistGraph();
  },

  nudgeClip(id, frames) {
    const dt = frames / 30;   // 30fps timeline
    set(s => ({ timelineClips: s.timelineClips.map(c => c.id === id ? { ...c, start: Math.max(0, c.start + dt) } : c) }));
    get().persistGraph();
  },

  setClipInOut(id, which, atTime) {
    const s = get();
    const c = s.timelineClips.find(x => x.id === id);
    if (!c) return;
    if (which === 'in') {
      const L = atTime - c.start;
      if (L <= 0.05 || L >= c.duration - 0.05) return;
      set({ timelineClips: s.timelineClips.map(x => x.id === id ? { ...x, start: c.start + L, duration: c.duration - L, inPoint: (c.inPoint ?? 0) + L } : x), graphStatus: 'In point set.' });
    } else {
      const newDur = atTime - c.start;
      if (newDur <= 0.05 || newDur >= c.duration - 0.005) return;
      set({ timelineClips: s.timelineClips.map(x => x.id === id ? { ...x, duration: newDur } : x), graphStatus: 'Out point set.' });
    }
    get().persistGraph();
  },

  rippleDeleteClip(id) {
    const s = get();
    const c = s.timelineClips.find(x => x.id === id);
    if (!c) return;
    const gap = c.duration;
    set({
      timelineClips: s.timelineClips
        .filter(x => x.id !== id)
        .map(x => (x.track === c.track && x.start > c.start) ? { ...x, start: Math.max(0, x.start - gap) } : x),
      selectedClipId: null,
      graphStatus: 'Ripple delete.',
    });
    get().persistGraph();
  },

  // ---- Layers ----

  addLayer(asset: LibraryAsset, category?: LibCategory, parentLayerId?: string) {
    const state = get();
    if (state.layers.length >= MAX_LAYERS) {
      set({ error: `Maximum ${MAX_LAYERS} references per frame reached. Remove one to add another.` });
      return;
    }
    const layer: Layer = {
      id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      assetId: asset.id,
      category: category ?? asset.category,
      name: asset.name,
      parentLayerId,
      thumbPath: asset.thumbPath,
      filePath: asset.filePath,
    };
    set({ layers: [...state.layers, layer], error: null });
  },

  setLayerParent(layerId: string, parentLayerId: string | null) {
    set(state => ({
      layers: state.layers.map(l => l.id === layerId
        ? { ...l, parentLayerId: parentLayerId ?? undefined }
        : l),
    }));
  },

  removeLayer(layerId: string) {
    // Cascade: deleting a character must also delete every layer nested
    // under it (wardrobe / props bound via parentLayerId). Without this
    // the children become ORPHANS — invisible in the sidebar (the render
    // filters them out by parentLayerId) but still in the layers array,
    // so they silently leak into the next generation's references.
    set(state => {
      const toRemove = new Set<string>([layerId]);
      // Walk children. A layer is a child if its parentLayerId is in the
      // removal set. Repeat until no new children get queued (handles
      // multi-level nesting if we ever add it later).
      let grew = true;
      while (grew) {
        grew = false;
        for (const l of state.layers) {
          if (l.parentLayerId && toRemove.has(l.parentLayerId) && !toRemove.has(l.id)) {
            toRemove.add(l.id);
            grew = true;
          }
        }
      }
      return { layers: state.layers.filter(l => !toRemove.has(l.id)) };
    });
  },

  reorderLayer(layerId: string, newCategory: LibCategory) {
    set(state => ({
      layers: state.layers.map(l => l.id === layerId ? { ...l, category: newCategory } : l),
    }));
  },

  async renameLayer(layerId: string, newName: string) {
    const state = get();
    const layer = state.layers.find(l => l.id === layerId);
    if (!layer) return;
    const trimmed = newName.trim();

    // Empty input → clear any per-generation override, keep library name.
    if (!trimmed) {
      set(s => ({
        layers: s.layers.map(l => l.id === layerId ? { ...l, customName: undefined } : l),
      }));
      return;
    }

    // Renaming a layer is really renaming the underlying library asset —
    // anything else creates per-generation drift that surprises the user.
    // Push to the library + update every layer + library row that points
    // at the same asset, so the new name shows up in the right sidebar,
    // the central library, AND every future prompt assembled from it.
    try {
      const updated = await window.hjen.renameLibraryAsset({ id: layer.assetId, name: trimmed });
      if (updated) {
        set(s => ({
          layers: s.layers.map(l => l.assetId === layer.assetId
            ? { ...l, name: trimmed, customName: undefined }
            : l),
          library: s.library.map(a => a.id === layer.assetId
            ? { ...a, name: trimmed }
            : a),
        }));
        return;
      }
    } catch (err) {
      console.warn('[renameLayer] library rename failed, falling back to per-layer customName', err);
    }

    // Asset is gone from the library (ghost layer) — keep the new name
    // local to this layer via customName so the prompt still reflects it.
    set(s => ({
      layers: s.layers.map(l => l.id === layerId
        ? { ...l, customName: trimmed }
        : l),
    }));
  },

  setLayerGroup(layerId: string, groupName: string | null) {
    set(state => ({
      layers: state.layers.map(l => l.id === layerId
        ? { ...l, groupName: groupName?.trim() || undefined }
        : l),
    }));
  },

  clearLayers() {
    set({ layers: [] });
  },

  openLibraryFor(category: LibCategory | null, parentLayerId?: string | null) {
    set({
      libraryPickerCategory: category,
      libraryPickerParentId: parentLayerId ?? null,
      activePicker: 'library',
    });
  },

  // Browse mode — load a past generation into the hero canvas + restore
  // selections AND attached reference layers from sidecar.
  async viewPastGeneration(entry: ProjectFileEntry) {
    const { catalog, library, skills } = get();
    const [dataUrl, sidecar] = await Promise.all([
      window.hjen.readImageDataUrl(entry.imgPath),
      window.hjen.readSidecar(entry.jsonPath),
    ]);
    if (!dataUrl) return;
    const result: GenerateResult = {
      url: dataUrl,
      b64: '',
      prompt: sidecar?.prompt ?? '',
      size: sidecar?.size ?? '',
      ts: entry.ts,
      modelLabel: sidecar?.model,
      savedPath: entry.imgPath,
      sidecarPath: entry.jsonPath,
      dir: entry.imgPath.replace(/\/[^/]+$/, ''),
    };
    set({ current: result });

    // Restore selections
    if (catalog && sidecar?.selections) {
      const restored = restoreSelections(catalog, sidecar.selections);
      set({ selections: restored, activeDnaPresetId: null });
    }

    // Restore skill + masterRun chain. If the skill that produced this image
    // still exists in the installed list, re-activate it on the DNA dropdown
    // so a follow-up Generate uses the same skill. Always rebuild lastMasterRun
    // from sidecar so the GenerationPreview lightbox can render the full chain
    // (original prompt → master prompt) for past generations too.
    const chain = sidecar?.promptChain;
    if (chain?.skillId) {
      const stillInstalled = skills.find(s => s.id === chain.skillId);
      set({ activeSkillId: stillInstalled ? chain.skillId : null });
      if (chain.masterPrompt) {
        set({
          lastMasterRun: {
            originalPrompt: chain.originalPrompt ?? '',
            masterPrompt: chain.masterPrompt,
            skillId: chain.skillId,
            skillName: chain.skillName ?? chain.skillId,
            usd: chain.masterUsd ?? 0,
            inputTokens: 0,
            outputTokens: 0,
            model: '',
            ts: entry.ts,
          },
        });
      } else {
        set({ lastMasterRun: null });
      }
    } else {
      set({ activeSkillId: null, lastMasterRun: null });
    }

    // Restore reference layers from sidecar
    if (Array.isArray(sidecar?.references)) {
      const restoredLayers: Layer[] = [];
      for (const rawRef of sidecar.references) {
        // Back-compat: older saves stored references as bare path STRINGS. Normalize
        // a string into the object shape the restore expects (a filePath ghost).
        const ref: any = typeof rawRef === 'string' ? { filePath: rawRef } : rawRef;
        if (!ref) continue;
        // 1. Best case — asset still in library: rebuild from current library entry
        const asset = library.find(a => a.id === ref.assetId);
        if (asset) {
          restoredLayers.push({
            id: ref.id || `layer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            assetId: asset.id,
            category: ref.category || asset.category,
            name: asset.name,
            customName: ref.customName,
            parentLayerId: ref.parentLayerId,
            groupName: ref.groupName,
            thumbPath: asset.thumbPath,
            filePath: asset.filePath,
          });
          continue;
        }
        // 2. Fallback — asset was deleted from library but the original file
        //    path is still on disk: rebuild a "ghost" layer pointing at it.
        //    The full image stands in for the thumbnail.
        if (ref.filePath) {
          restoredLayers.push({
            id: ref.id || `layer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            assetId: ref.assetId ?? '(missing)',
            category: ref.category || 'general',
            name: ref.name || 'Missing asset',
            customName: ref.customName,
            parentLayerId: ref.parentLayerId,
            groupName: ref.groupName,
            thumbPath: ref.filePath,
            filePath: ref.filePath,
          });
        }
      }
      set({ layers: restoredLayers });
    } else {
      // Older generation with no `references` field → clear current layers so
      // we don't carry over stale state from the previous active prompt.
      set({ layers: [] });
    }
  },

  setSelection(key, value) {
    set(state => {
      // Drop the undo/redo affordance only when the user types something
      // that is neither the enhanced nor the original prompt — i.e. a real
      // manual edit. Toggling between the two via undo/redo stays intact.
      const e = state.lastEnhancement;
      const clearEnhance =
        key === 'prompt' && e &&
        value !== e.enhancedPrompt && value !== e.originalPrompt;
      const selections = { ...state.selections, [key]: value };
      // If the DOP is bound to a Node Frame, mirror the edit into that node's
      // `dop` param so the look travels with the node (guarded — Studio path
      // has dopTargetNodeId=null and is untouched).
      const tid = state.dopTargetNodeId;
      const graphNodes = tid
        ? state.graphNodes.map(n => n.id === tid
            ? { ...n, paramValues: { ...n.paramValues, dop: { type: 'selectionSet', selections } } }
            : n)
        : state.graphNodes;
      return {
        selections,
        graphNodes,
        activePicker: null,
        ...(isDnaPresetSetting(key) ? { activeDnaPresetId: null } : {}),
        ...(clearEnhance ? { lastEnhancement: null } : {}),
      };
    });
    if (get().dopTargetNodeId) get().persistGraph();
  },

  openPicker(p) { set({ activePicker: p, error: null }); },
  closePicker() { set({ activePicker: null }); },

  applyHJENDNA() {
    const { catalog, selections, dnaPresets } = get();
    if (!catalog) return;
    const preset = dnaPresets.find(item => item.id === CLAY_BASIL_DNA_PRESET_ID);
    if (!preset) return;
    set({ selections: applyDnaPresetSettings(catalog, selections, preset.settings), activeDnaPresetId: preset.id });
  },

  applyDnaPreset(id) {
    const { catalog, selections, dnaPresets } = get();
    if (!id) {
      set({ selections: clearDnaPresetSettings(selections), activeDnaPresetId: null });
      return;
    }
    if (!catalog) return;
    const preset = dnaPresets.find(item => item.id === id);
    if (!preset) return;
    set({ selections: applyDnaPresetSettings(catalog, selections, preset.settings), activeDnaPresetId: id });
  },

  createDnaPreset(name, description) {
    const cleanName = name.trim();
    if (!cleanName) return '';
    const current = get().selections;
    const id = `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const preset: DnaPreset = {
      id,
      name: cleanName,
      description: description.trim(),
      settings: captureDnaPresetSettings(current),
      createdAt: now,
      updatedAt: now,
    };
    const next = [...get().dnaPresets, preset];
    persistDnaPresets(next);
    set({ dnaPresets: next, activeDnaPresetId: id });
    return id;
  },

  editDnaPreset(id, patch) {
    const cleanName = patch.name.trim();
    if (!cleanName) return;
    const next = get().dnaPresets.map(item => item.id === id ? {
      ...item,
      name: cleanName,
      description: patch.description.trim(),
      settings: patch.captureCurrent ? captureDnaPresetSettings(get().selections) : item.settings,
      updatedAt: Date.now(),
    } : item);
    persistDnaPresets(next);
    set({ dnaPresets: next });
  },

  updateDnaPreset(id) {
    const next = get().dnaPresets.map(item => item.id === id ? {
      ...item,
      settings: captureDnaPresetSettings(get().selections),
      updatedAt: Date.now(),
    } : item);
    persistDnaPresets(next);
    set({ dnaPresets: next, activeDnaPresetId: id });
  },

  deleteDnaPreset(id) {
    const next = get().dnaPresets.filter(item => item.id !== id);
    persistDnaPresets(next);
    set(state => ({
      dnaPresets: next,
      activeDnaPresetId: state.activeDnaPresetId === id ? null : state.activeDnaPresetId,
    }));
  },

  resetSelections() {
    set({ selections: initialSelections, activeDnaPresetId: null });
  },

  promptPreview() {
    return buildPrompt(get().selections, get().layers);
  },

  async generate() {
    // Snapshot the current selections, layers, AND active project so concurrent
    // jobs each carry their own state. If the user switches projects while a
    // generation is in flight, the result still saves to the project that was
    // active when Generate was clicked — not the one currently selected.
    const selections = { ...get().selections };

    // ORPHAN GUARD: defensively strip layers whose parentLayerId points at
    // a layer that no longer exists. A leftover from an earlier cascade
    // failure would otherwise silently get sent to the API as a phantom
    // reference. Belt-and-suspenders on top of removeLayer's cascade.
    const rawLayers = get().layers;
    const liveIds = new Set(rawLayers.map(l => l.id));
    const cleaned = rawLayers.filter(l => !l.parentLayerId || liveIds.has(l.parentLayerId));
    if (cleaned.length !== rawLayers.length) {
      console.warn(`[generate] stripped ${rawLayers.length - cleaned.length} orphan layer(s) before sending`);
      set({ layers: cleaned });
    }
    const layersSnapshot = [...cleaned];
    const projectSnapshot = get().activeProject();
    const titleSource = (selections.prompt || 'Untitled').split(/[.!?\n,]/)[0].trim() || 'Untitled';
    const job: Job = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      promptTitle: titleSource.length > 60 ? titleSource.slice(0, 60) + '…' : titleSource,
      startedAt: Date.now(),
      modelLabel: MODELS[selections.model].label,
      aspect: selections.aspect,
      resolution: selections.resolution,
    };
    set(state => ({
      jobs: [...state.jobs, job],
      generating: true,
      error: null,
    }));

    // Register this make as an app-wide operation (BgJob): a task-tab + status
    // bar entry + LOG row, exactly like a breakdown run. The image API is
    // synchronous (no pollable server id) so a crash mid-request is not
    // server-recoverable — on reboot the BgJob reconciles to `interrupted` and
    // its RESUME = re-apply the same prompt+settings via the pending payload.
    const bgId = get().startJob({
      kind: 'frame-make',
      title: `Frame · ${job.promptTitle}`,
      projectId: projectSnapshot?.id ?? null,
      nav: { view: 'frame', projectId: projectSnapshot?.id ?? null, sub: { pendingId: job.id } },
      stages: [
        { key: 'make', label: 'Make the frame', state: 'pending' },
        { key: 'save', label: 'Save to the project', state: 'pending' },
      ],
      progressText: job.modelLabel,
    });
    job.bgId = bgId;   // link for the auto-surface reconciler (see end of file)

    // Persist a snapshot of this job to disk BEFORE the API call so we
    // can detect an interrupted generation on next launch. The record
    // gets deleted on completion (success or failure).
    const pendingPayload: PendingJobPayload = {
      id: job.id,
      kind: 'image',
      ts: job.startedAt,
      promptTitle: job.promptTitle,
      modelLabel: job.modelLabel,
      aspect: job.aspect,
      resolution: job.resolution,
      selections: serializeSelections(selections),
      layers: layersSnapshot.map(l => ({
        id: l.id,
        assetId: l.assetId,
        category: l.category,
        name: l.name,
        customName: l.customName,
        parentLayerId: l.parentLayerId,
        groupName: l.groupName,
        filePath: l.filePath,
        thumbPath: l.thumbPath,
      })),
      project: projectSnapshot ? { id: projectSnapshot.id, name: projectSnapshot.name, slug: projectSnapshot.slug } : null,
    };
    try { await window.hjen.savePendingJob({ id: job.id, payload: pendingPayload }); } catch {}

    const tStart = performance.now();
    // Compute these OUTSIDE try{} so the catch handler can persist them
    // into the FailedJob record for later debugging.
    const modelSpec = MODELS[selections.model];
    const size = resolveSize(selections.model, selections.aspect, selections.resolution);

    // SKILL STEP — when a skill is active, transform the textarea prompt into
    // a Master Prompt via the Settings-selected Frame Skills model before assembling the image-API payload.
    // The master prompt is what actually hits the image model; the textarea
    // content is untouched. The full chain (original → optional enhanced →
    // master) is persisted in the sidecar so the generation history reads
    // the transformation. Costs the user one text-model call per Generate.
    const activeSkillIdSnap = get().activeSkillId;
    const activeSkill = activeSkillIdSnap ? get().skills.find(s => s.id === activeSkillIdSnap) : null;
    let masterRun: PromptMasterRun | null = null;
    let promptForImage = selections.prompt;

    if (activeSkill && (selections.prompt || '').trim()) {
      const layerNameById = new Map(layersSnapshot.map(layer => [layer.id, layer.customName?.trim() || layer.name]));
      const skillRes = await window.hjen.runSkill({
        skillId: activeSkill.id,
        prompt: selections.prompt,
        references: layersSnapshot.map(layer => ({
          category: layer.category,
          name: layer.name,
          customName: layer.customName,
          parentName: layer.parentLayerId ? layerNameById.get(layer.parentLayerId) : undefined,
          filePath: layer.filePath,
        })),
        settings: {
          aspect: selections.aspect,
          resolution: selections.resolution,
          quality: selections.quality,
          imageModel: modelSpec.apiModelId,
          angle: selections.angle?.description || null,
          style: selections.style_preset === 'MOVIE'
            ? selections.movie?.title || null
            : selections.style_preset === 'PHOTOGRAPHER'
              ? selections.photographer?.name || null
              : null,
          camera: selections.camera?.prompt || selections.camera?.name || null,
          lens: selections.lens?.name || null,
          focalMm: selections.focal_mm,
          apertureF: selections.aperture_f,
          stock: selections.stock?.name || null,
          lighting: selections.lighting?.description || selections.lighting?.name || null,
          movement: selections.movement?.description || selections.movement?.name || null,
          atmosphere: selections.atmosphere || null,
          negative: selections.negative || null,
        },
        projectId: projectSnapshot?.id ?? null,
        projectSlug: projectSnapshot?.slug ?? null,
        projectName: projectSnapshot?.name ?? null,
      });
      if (!skillRes.ok) {
        set(state => {
          const nextJobs = state.jobs.filter(j => j.id !== job.id);
          return {
            error: `Skill "${activeSkill.name}" failed: ${skillRes.message}`,
            jobs: nextJobs,
            generating: nextJobs.length > 0,
          };
        });
        get().finishJob(bgId, { status: 'error', error: `Skill "${activeSkill.name}" failed: ${skillRes.message}` });
        try { await window.hjen.clearPendingJob({ id: job.id }); } catch {}
        return;
      }
      masterRun = {
        originalPrompt: selections.prompt,
        masterPrompt: skillRes.masterPrompt,
        skillId: skillRes.skillId,
        skillName: skillRes.skillName,
        usd: skillRes.usd,
        inputTokens: skillRes.usage.inputTokens,
        outputTokens: skillRes.usage.outputTokens,
        provider: skillRes.provider,
        model: skillRes.model,
        referencesCount: skillRes.referencesCount,
        settingsHash: skillRes.settingsHash,
        contractRepaired: skillRes.contractRepaired,
        ts: Date.now(),
      };
      promptForImage = skillRes.masterPrompt;
      set({ lastMasterRun: masterRun });
    }

    // LAYER STEP — Saudi DNA compiler. When enabled (default) and no Skill
    // is active, the user's raw prompt is culturally compiled: wardrobe/
    // place/era correction, refusal rails, and the Arabic-text law (verbatim
    // ≤6 words in-model, longer → typography overlay). The layer must never
    // block a make: any failure falls back silently to the original prompt.
    let layerRun: LayerRun | null = null;
    if (get().layerEnabled && !activeSkill && (selections.prompt || '').trim()) {
      // Look jurisdiction: any user DOP chip / Movie-Photographer preset /
      // atmosphere text means the user owns the look — the layer restricts
      // itself to cultural correction (no grade/stock/lighting language).
      const lookLocked = !!(
        selections.angle ||
        (selections.style_preset === 'MOVIE' && selections.movie) ||
        (selections.style_preset === 'PHOTOGRAPHER' && selections.photographer) ||
        selections.camera || selections.lens || selections.stock ||
        selections.lighting || selections.movement ||
        selections.focal_mm || selections.aperture_f ||
        (selections.atmosphere || '').trim()
      );
      try {
        layerRun = await runLayer({
          userPrompt: selections.prompt,
          mode: 'image',
          modelId: selections.model,
          lookLocked,
          llm: (a) => window.hjen.claudeJson(a),
        });
      } catch { layerRun = null; }
      if (layerRun) {
        promptForImage = layerRun.compiledPrompt;
        set({ lastLayerRun: layerRun });
      }
    }

    // Build the API prompt from the *effective* selections so all chips
    // (camera/lens/lighting/etc) still apply on top of the master prompt.
    const effectiveSelectionsBase = promptForImage === selections.prompt
      ? selections
      : { ...selections, prompt: promptForImage };
    const gatewayActive = await isGatewayActive();
    const skillRenderMode = masterRun ? detectPromptRenderMode(masterRun.masterPrompt) : null;
    // Compatibility with the currently deployed gateway composer, whose old
    // render gate only understands MOVIE/Animation. The Master Prompt remains
    // the scene source; this sentinel prevents that server from appending its
    // photoreal skin tail until the mirrored server composer is deployed.
    const effectiveSelections: Selections = gatewayActive && skillRenderMode === 'storyboard'
      ? {
          ...effectiveSelectionsBase,
          style_preset: 'MOVIE',
          photographer: null,
          movie: {
            id: 'hjen-frame-skill-storyboard-contract',
            title: 'the exact non-photographic storyboard medium locked in the Master Prompt',
            year: '',
            director: null,
            cinematographer: null,
            filename: '',
            type: 'Animation',
          },
        }
      : effectiveSelectionsBase;
    // In gateway mode the recipe is composed on the server — never build it in the
    // browser (it must not exist in memory, a saved sidecar, or a failed-job payload).
    const assembledPrompt = gatewayActive ? '' : buildPrompt(effectiveSelections, layersSnapshot);
    const q = mapQuality(selections.model, selections.quality);

    try {
      get().updateJob(bgId, { activeStage: 'make' });
      // The provider branch + reference ordering + aspect crop live in the
      // shared runFrameGeneration() so the Studio and the NODE engine's Frame
      // node stay in lockstep. `result` comes back already cropped. onPhase
      // surfaces the server scheduler's queue state so a paced batch reads as
      // "In queue" (not a stall) until its slot frees.
      const { result, apiSize, apiDurationMs } = await runFrameGeneration(effectiveSelections, layersSnapshot, {
        jobId: job.id,
        onPhase: (phase, queued) => get().updateJob(bgId, {
          progressText: phase === 'queued'
            ? (queued && queued > 1 ? `In queue · ${queued} waiting` : 'In queue…')
            : phase === 'rate_limited'
              ? 'Provider busy · retrying this same take…'
              : 'Making…',
        }),
      });
      get().updateJob(bgId, { activeStage: 'save' });

      // Save into the project that was active when Generate was clicked,
      // NOT the one currently selected (the user may have switched mid-flight).
      const proj = projectSnapshot;
      let savedPath: string | undefined;
      let sidecarPath: string | undefined;
      let dir: string | undefined;
      try {
        const slug = slugify(selections.prompt || 'untitled');
        // Build the prompt-chain record that lives in the sidecar so a future
        // viewer of this generation can see the full transformation history.
        const enhSnap = get().lastEnhancement;
        const enhancedActive = enhSnap && enhSnap.enhancedPrompt === selections.prompt;
        const promptChain = (enhancedActive || masterRun || layerRun) ? {
          originalPrompt: enhancedActive ? enhSnap!.originalPrompt
                          : (masterRun ? masterRun.originalPrompt : selections.prompt),
          enhancedPrompt: enhancedActive ? enhSnap!.enhancedPrompt : null,
          masterPrompt: masterRun ? masterRun.masterPrompt : null,
          skillId: masterRun?.skillId ?? null,
          skillName: masterRun?.skillName ?? null,
          masterProvider: masterRun?.provider ?? null,
          masterModel: masterRun?.model ?? null,
          masterReferencesCount: masterRun?.referencesCount ?? null,
          masterSettingsHash: masterRun?.settingsHash ?? null,
          masterContractRepaired: masterRun?.contractRepaired ?? null,
          enhanceUsd: enhancedActive ? enhSnap!.usd : null,
          masterUsd: masterRun?.usd ?? null,
          // Saudi DNA Layer record — what the layer did, with which cards.
          layerPrompt: layerRun?.compiledPrompt ?? null,
          layerNotesAr: layerRun?.notesAr ?? null,
          layerCardIds: layerRun ? layerRun.usedCards.map(c => c.id) : null,
          layerTextPlan: layerRun?.textPlan ?? null,
        } : null;

        // Gateway already persisted the blob server-side (HIGH/large images ship
        // as a token, not 12MB of base64) — reference it, don't re-upload.
        if (result.serverSaved && result.savedPath) {
          savedPath = result.savedPath;
          throw { __alreadySaved: true };
        }
        const saved = await window.hjen.saveGeneration({
          base64: result.b64,
          promptSlug: slug,
          projectSlug: proj?.slug,
          projectId: proj?.id,
          sidecar: {
            captured: new Date().toISOString(),
            project: proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null,
            prompt: result.prompt,
            promptChain,
            size: result.size,
            apiSize: apiSize,
            finalSize: `${size.targetWidth}x${size.targetHeight}`,
            finalMP: size.finalMP,
            sizeNote: size.notes ?? null,
            model: modelSpec.label,
            apiModelId: modelSpec.apiModelId,
            estimatedCost: estimateCost({
              model: selections.model,
              quality: selections.quality,
              apiSize: size.apiSize,
            }),
            durationMs: Math.round(performance.now() - tStart),
            apiDurationMs,
            references: layersSnapshot.map(l => ({
              id: l.id,
              assetId: l.assetId,
              category: l.category,
              name: l.name,
              customName: l.customName,
              parentLayerId: l.parentLayerId,
              groupName: l.groupName,
              filePath: l.filePath,
            })),
            selections: serializeSelections(selections),
          },
        });
        savedPath = saved.imgPath;
        sidecarPath = saved.jsonPath;
        dir = saved.dir;
        // Refresh the project's generationCount
        if (proj) {
          set(state => ({
            projects: state.projects.map(p => p.id === proj.id ? { ...p, generationCount: (p.generationCount || 0) + 1 } : p),
          }));
        }
      } catch (saveErr: any) {
        if (!saveErr?.__alreadySaved) console.warn('Save failed', saveErr);
      }

      const enriched: GenerateResult = { ...result, savedPath, sidecarPath, dir };
      set(state => {
        const nextJobs = state.jobs.filter(j => j.id !== job.id);
        // Dedup by savedPath so a frame the reconciler already surfaced isn't
        // added twice if this poll also completes.
        const priorHist = savedPath ? state.history.filter(h => h.savedPath !== savedPath) : state.history;
        return {
          current: enriched,
          history: [enriched, ...priorHist].slice(0, 50),
          jobs: nextJobs,
          generating: nextJobs.length > 0,
        };
      });
      get().finishJob(bgId, {
        status: 'done',
        nav: { view: 'frame', projectId: proj?.id ?? null, sub: savedPath ? { imgPath: savedPath } : undefined },
      });
      try { await window.hjen.clearPendingJob({ id: job.id }); } catch {}

      // OCR QC — Saudi DNA Layer Arabic-text verification. When the layer
      // planned in-model Arabic text, a vision pass reads the saved frame
      // and compares against the requested string. On garble: ONE automatic
      // retake (guarded by the module flag so the retake itself never
      // retakes). Verdict lands in lastLayerRun for the «الطبقة» panel.
      if (layerRun && layerRun.textPlan.mode === 'in-model' && layerRun.textPlan.content && savedPath) {
        try {
          const wanted = layerRun.textPlan.content;
          const qc = await window.hjen.claudeJson({
            system: 'You verify Arabic text rendering inside images. Return STRICT JSON only, no fences: {"match": true|false, "seen": "the Arabic text actually readable in the image, or empty"}',
            prompt: `Does this image contain exactly this Arabic text, rendered correctly letter-for-letter: «${wanted}»?\nRules: styling/size/color differences are fine. Missing letters, extra invented words, malformed or pseudo-Arabic glyphs mean match=false.`,
            imagePath: savedPath,
            maxTokens: 300,
          });
          if (qc.ok && qc.text) {
            const m = qc.text.match(/\{[\s\S]*\}/);
            const v = m ? JSON.parse(m[0]) : null;
            if (v && typeof v.match === 'boolean') {
              const willRetake = !v.match && !textRetakeInFlight;
              set(state => state.lastLayerRun && state.lastLayerRun.ts === layerRun!.ts
                ? { lastLayerRun: { ...state.lastLayerRun, ocr: { match: v.match, seen: typeof v.seen === 'string' ? v.seen : null, retook: willRetake } } }
                : {});
              if (willRetake) {
                textRetakeInFlight = true;
                try { await get().generate(); }
                finally { textRetakeInFlight = false; }
              }
            }
          }
        } catch { /* QC never blocks the flow */ }
      }
    } catch (e: any) {
      const emsg = e?.message || String(e);
      // A dropped connection / transient blip is NOT a real failure. The server
      // reserves a credit then REFUNDS an undelivered make and SERVER-SAVES a
      // delivered one — so the paid file always exists and reappears on reconnect
      // (see the 'online' handler in init()). Never alarm the user or file it
      // under FAILED for a network drop: keep the pending job so it reconciles /
      // resumes silently. Only genuine errors (safety, bad input) surface.
      const isNet = /fetch failed|failed to fetch|networkerror|network error|\bnetwork\b|socket|econn|etimedout|enotfound|eai_again|epipe|timed? ?out|aborted|offline|load failed|502|503|504|bad gateway|gateway time/i.test(emsg);
      set(state => {
        const nextJobs = state.jobs.filter(j => j.id !== job.id);
        return {
          error: isNet ? null : emsg,
          jobs: nextJobs,
          generating: nextJobs.length > 0,
        };
      });
      get().finishJob(bgId, { status: 'error', error: isNet ? 'Connection lost — your paid frame is safe and will return automatically.' : emsg });
      if (isNet) return; // keep the pending job on disk; no red FAILED entry — recovery handles it

      try { await window.hjen.clearPendingJob({ id: job.id }); } catch {}

      // Persist this failure for the sidebar Failed group. Stores the
      // assembled prompt + size + quality so the user can later open the
      // failed entry and see exactly what was sent to the API.
      const failedPayload: FailedJobPayload = {
        ...pendingPayload,
        errorMessage: emsg,
        assembledPrompt,
        apiSize: size.apiSize,
        quality: q,
      };
      try { await window.hjen.saveFailedJob({ id: job.id, payload: failedPayload }); } catch {}
      set(state => ({ failedJobs: [failedPayload, ...state.failedJobs] }));
    }
  },

  async makeBreakdownShotFrame(args) {
    const { slug, no, prompt, quality, aspect, model, refPaths, appendix, title } = args;
    const clean = (prompt || '').trim();
    if (!clean) return { ok: false, message: 'This shot has no frame prompt to make from.' };
    // The appendix (attachment descriptions) travels with the prompt so the model
    // knows the role of each attached reference.
    const fullPrompt = appendix?.trim() ? `${clean}\n\n${appendix.trim()}` : clean;

    // Snapshot the project active WHEN the make was fired, so a mid-flight
    // project switch still saves the frame to the right library.
    const proj = get().activeProject();

    // A make isolated from the user's live Studio session: start from the
    // canonical defaults (all chips null → buildPrompt passes the fused frame
    // prompt through untouched) and override ONLY the knobs the shotlist
    // controls (model · quality · aspect). The user's `selections` in the store
    // are never read or written here.
    const sel: Selections = { ...initialSelections, prompt: fullPrompt, quality, aspect, model: model ?? initialSelections.model };
    // Attached image references → reference layers (consumed by the OpenAI path;
    // the Gemini path renders text-only, so refs there are provenance only).
    const refLayers: Layer[] = (refPaths || []).filter(Boolean).map((p, i) => ({
      id: `bd-att-${no}-${i}`, assetId: `bd-att-${no}-${i}`,
      category: 'composition' as LibCategory, name: `attached ref ${i + 1}`,
      thumbPath: p, filePath: p,
    }));
    const modelSpec = MODELS[sel.model];
    const jobTitle = `Frame · shot ${no}${title ? ` · ${title}` : ''}`;

    const bgId = get().startJob({
      kind: 'frame-make',
      title: jobTitle,
      projectId: proj?.id ?? null,
      nav: { view: 'frame', projectId: proj?.id ?? null },
      stages: [
        { key: 'make', label: 'Make the frame', state: 'pending' },
        { key: 'save', label: 'Save to the project', state: 'pending' },
      ],
      progressText: `${modelSpec.label} · ${quality} · ${aspect}`,
    });

    const tStart = performance.now();
    try {
      get().updateJob(bgId, { activeStage: 'make' });
      // Same shared core the Studio + NODE engine use; `result` comes back
      // already cropped to the target aspect. Attached refs (if any) ride along.
      const { result, apiSize, apiDurationMs, size } = await runFrameGeneration(sel, refLayers);
      get().updateJob(bgId, { activeStage: 'save' });

      const saved = await window.hjen.saveGeneration({
        base64: result.b64,
        promptSlug: slugify(clean || `shot-${no}`),
        projectSlug: proj?.slug,
        projectId: proj?.id,
        sidecar: {
          captured: new Date().toISOString(),
          project: proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null,
          prompt: result.prompt,
          size: result.size,
          apiSize,
          finalSize: `${size.targetWidth}x${size.targetHeight}`,
          finalMP: size.finalMP,
          model: modelSpec.label,
          apiModelId: modelSpec.apiModelId,
          estimatedCost: estimateCost({ model: sel.model, quality: sel.quality, apiSize: size.apiSize }),
          durationMs: Math.round(performance.now() - tStart),
          apiDurationMs,
          // Save FULL layer objects (not bare paths) so opening this image in
          // Frame restores its reference layers (the restore path reads
          // assetId/filePath/category/name — a path string restores nothing).
          references: refLayers.map(l => ({ id: l.id, assetId: l.assetId, category: l.category, name: l.name, filePath: l.filePath, thumbPath: l.thumbPath })),
          selections: serializeSelections(sel),
          // provenance — this frame was MADE from a breakdown shotlist shot
          breakdownShot: { slug, no },
        },
      });
      const savedPath = saved.imgPath;
      if (proj) {
        set(state => ({
          projects: state.projects.map(p => p.id === proj.id ? { ...p, generationCount: (p.generationCount || 0) + 1 } : p),
        }));
      }
      get().finishJob(bgId, {
        status: 'done',
        nav: { view: 'frame', projectId: proj?.id ?? null, sub: { imgPath: savedPath } },
      });
      return { ok: true, path: savedPath };
    } catch (e: any) {
      const message = e?.message || String(e);
      get().finishJob(bgId, { status: 'error', error: message });
      return { ok: false, message };
    }
  },

  async makeCameraAngleFrame(args) {
    const { angle, refPath, quality, aspect, model, index } = args;
    const clean = (angle || '').trim();
    if (!clean) return { ok: false, message: 'This take has no camera angle to make from.' };
    if (!refPath) return { ok: false, message: 'Add a source scene first — the angle needs a performance to re-shoot.' };

    // THE LAW — the verbatim frames-engine template with ONLY the [CAMERA ANGLE]
    // token swapped. Built here so no caller can reword it.
    const fullPrompt = buildAnglePrompt(clean);

    // Snapshot the project active WHEN the make was fired, so a mid-flight
    // project switch still saves the take to the right library.
    const proj = get().activeProject();

    // Isolated from the user's live Studio session: canonical defaults (all chips
    // null → buildPrompt passes the make prompt through untouched), overriding
    // ONLY the frames-engine make-settings (model · quality · aspect). The user's
    // `selections` are never read or written here.
    const sel: Selections = { ...initialSelections, prompt: fullPrompt, quality, aspect, model };
    // The source scene rides as a COMPOSITION reference — the OpenAI path re-shoots
    // the same performance from it; the Gemini path renders text-only (provenance).
    const refLayers: Layer[] = [{
      id: `angle-src-${index}`, assetId: `angle-src-${index}`,
      category: 'composition' as LibCategory, name: 'source scene',
      thumbPath: refPath, filePath: refPath,
    }];
    const modelSpec = MODELS[sel.model];
    const shortAngle = clean.length > 48 ? clean.slice(0, 48) + '…' : clean;

    const bgId = get().startJob({
      kind: 'frame-make',
      title: `Angle · ${shortAngle}`,
      projectId: proj?.id ?? null,
      nav: { view: 'angles', projectId: proj?.id ?? null },
      stages: [
        { key: 'make', label: 'Make the take', state: 'pending' },
        { key: 'save', label: 'Save to the project', state: 'pending' },
      ],
      progressText: `${modelSpec.label} · ${quality} · ${aspect}`,
    });

    const tStart = performance.now();
    try {
      get().updateJob(bgId, { activeStage: 'make' });
      // The subject is held by the source reference image + the hardened make
      // prompt (subject-locked). No extra fidelity param — gpt-image-2 rejects
      // input_fidelity, and it is the only reference-capable model here.
      const { result, apiSize, apiDurationMs, size } = await runFrameGeneration(sel, refLayers);
      get().updateJob(bgId, { activeStage: 'save' });

      const saved = await window.hjen.saveGeneration({
        base64: result.b64,
        promptSlug: slugify(`angle-${index + 1}-${clean}`),
        projectSlug: proj?.slug,
        projectId: proj?.id,
        sidecar: {
          captured: new Date().toISOString(),
          project: proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null,
          prompt: result.prompt,
          size: result.size,
          apiSize,
          finalSize: `${size.targetWidth}x${size.targetHeight}`,
          finalMP: size.finalMP,
          model: modelSpec.label,
          apiModelId: modelSpec.apiModelId,
          estimatedCost: estimateCost({ model: sel.model, quality: sel.quality, apiSize: size.apiSize }),
          durationMs: Math.round(performance.now() - tStart),
          apiDurationMs,
          references: refLayers.map(l => ({ id: l.id, assetId: l.assetId, category: l.category, name: l.name, filePath: l.filePath, thumbPath: l.thumbPath })),
          selections: serializeSelections(sel),
          // provenance — a take MADE by Camera Angles, with its distinct angle.
          cameraAngle: { angle: clean, index },
        },
      });
      const savedPath = saved.imgPath;
      if (proj) {
        set(state => ({
          projects: state.projects.map(p => p.id === proj.id ? { ...p, generationCount: (p.generationCount || 0) + 1 } : p),
        }));
      }
      get().finishJob(bgId, {
        status: 'done',
        nav: { view: 'angles', projectId: proj?.id ?? null, sub: { imgPath: savedPath } },
      });
      return { ok: true, path: savedPath, jsonPath: saved.jsonPath };
    } catch (e: any) {
      const message = e?.message || String(e);
      get().finishJob(bgId, { status: 'error', error: message });
      return { ok: false, message };
    }
  },

  async makeSwapFrame(args) {
    const { sourcePath, slots, decisions, facePath, quality, aspect, model, index, preserveMode, onRound } = args;
    if (!sourcePath) return { ok: false, message: 'The Swap needs a source frame to re-photograph.' };

    // The view has usually already run the plan pass, so its requirements arrive
    // with tests written and conflicts already shown. Reuse them: a test rewritten
    // at make time would not be the one the owner read before he approved it.
    const requirements = args.requirements?.length ? args.requirements : toRequirements(decisions);
    if (!requirements.length) return { ok: false, message: 'Nothing is being changed — set at least one slot to SWAP.' };

    const proj = get().activeProject();
    const modelSpec = MODELS[model];
    const preserveKeys = [...(preserveMode === 'full' ? preserveSetFull(decisions) : preserveSet(decisions))];

    const bgId = get().startJob({
      kind: 'frame-make',
      title: `Swap · ${requirements.map(r => r.slot).join(' + ')}`,
      projectId: proj?.id ?? null,
      nav: { view: 'swap', projectId: proj?.id ?? null },
      stages: [
        { key: 'plates', label: 'Build the structure plates', state: 'pending' },
        { key: 'make', label: 'Make the take', state: 'pending' },
        { key: 'verify', label: 'Check every change landed', state: 'pending' },
        { key: 'save', label: 'Save to the project', state: 'pending' },
      ],
      progressText: `${modelSpec.label} · ${quality} · ${aspect}`,
    });

    const tStart = performance.now();
    try {
      // The plates are built ONCE, from the true source. Later rounds chain from
      // a take whose geometry is the source's by construction — the whole point
      // of the contract — so rebuilding them per round would pay a torch pass to
      // arrive at the same map.
      get().updateJob(bgId, { activeStage: 'plates' });
      onRound?.({ round: 1, phase: 'plates' });
      const plan = lockPlanFor(decisions);
      const plates = await buildPlates(sourcePath, plan);

      let round: SwapRound = firstRound(sourcePath, requirements);
      let composed = requirements;
      let untestable: string[] = [];
      let verdicts: Verdict[] = [];
      let unresolved: string[] = [];
      let rounds = 0;
      /** Every round's result. The ladder re-asks from the original rather than
       *  chaining, so a later round is not automatically better — the run keeps
       *  them all and ships the one that landed the most. */
      const attempts: Array<{ path: string; jsonPath: string; landed: number; verdicts: Verdict[] }> = [];

      for (;;) {
        rounds = round.round;
        get().updateJob(bgId, { activeStage: 'make', progressText: `${modelSpec.label} · round ${round.round}` });
        onRound?.({ round: round.round, phase: 'compose' });

        // THE ORIGINAL FRAME IS IMAGE 1 IN EVERY ROUND, and so are its plates:
        // they are maps of that same photograph, so they stay true. Nothing this
        // tool ever made is sent back into it — the only images it attaches are
        // the owner's original and the references he chose himself.
        const refs = orderSwapRefs(decisions, plates.plan, round.requirements, {
          sourcePath: round.sourcePath,
          cannyPath: plates.cannyPath,
          depthPath: plates.depthPath,
          facePath: plates.plan.faceAnchor ? facePath : undefined,
        });

        const comp = await swapCompose({
          slots, decisions, requirements: round.requirements, refs, preserveKeys,
          escalate: round.escalate,
          round: round.round,
          subjectOnlyCanny: plates.plan.cannySubjectOnly,
        });
        if (!comp.ok || !comp.prompt) throw new Error(comp.message || 'The change contract could not be written.');
        if (round.round === 1) {
          // The tests are written once and carried down the ladder. A test that
          // drifted between rounds would make the verdict trail meaningless.
          composed = comp.requirements ?? round.requirements;
          untestable = comp.untestable ?? [];
          round = { ...round, requirements: composed };
        }

        const tools = args.frameTools ?? {};
        const sel: Selections = {
          ...initialSelections,
          ...tools,
          prompt: comp.prompt,
          quality,
          aspect,
          model,
        };
        onRound?.({ round: round.round, phase: 'make' });
        const { result, apiSize, size } = await runFrameGeneration(
          sel,
          refsToLayers(refs, `${index}-${round.round}`),
          { jobId: args.recoveryId ? `${args.recoveryId}-round-${round.round}` : undefined },
        );

        get().updateJob(bgId, { activeStage: 'save' });
        const saved = await window.hjen.saveGeneration({
          base64: result.b64,
          promptSlug: slugify(`swap-${index + 1}-r${round.round}-${round.requirements.map(r => r.slot).join('-')}`),
          projectSlug: proj?.slug,
          projectId: proj?.id,
          sidecar: {
            captured: new Date().toISOString(),
            project: proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null,
            // The composed contract, written from what MAIN handed back. On the
            // gateway path runFrameGeneration deliberately returns an empty
            // prompt (the recipe stays on the server) — but a Swap contract is
            // composed in MAIN, on this machine, and the owner has to be able to
            // read exactly what was asked for on his behalf.
            prompt: comp.prompt || result.prompt,
            size: result.size,
            apiSize,
            finalSize: `${size.targetWidth}x${size.targetHeight}`,
            finalMP: size.finalMP,
            model: modelSpec.label,
            apiModelId: modelSpec.apiModelId,
            estimatedCost: estimateCost({ model: sel.model, quality: sel.quality, apiSize: size.apiSize }),
            durationMs: Math.round(performance.now() - tStart),
            references: refs.map((r, i) => ({ image: i + 1, role: r.role, slot: r.slot ?? null, name: r.label, filePath: r.filePath, category: r.category })),
            selections: serializeSelections(sel),
            // provenance — everything needed to explain, months later, what this
            // take was asked for and what the machine said it delivered.
            swap: {
              sourcePath: round.sourcePath, originalSource: sourcePath, round: round.round,
              requirements: round.requirements, escalated: round.escalate ?? [],
              lockKit: plates.plan.kit, lockReason: plates.plan.reason,
              decisions, preserveKeys,
            },
          },
        });
        const takePath = saved.imgPath;
        if (proj) {
          set(state => ({
            projects: state.projects.map(p => p.id === proj.id ? { ...p, generationCount: (p.generationCount || 0) + 1 } : p),
          }));
        }
        // The frame exists on disk NOW. Show it now — the check that follows takes
        // its own vision call, and holding a finished image behind it reads as a
        // tool that stalled. The same event refreshes Files/Frames, which
        // otherwise only lists what was there when it mounted.
        onRound?.({ round: round.round, phase: 'verify', takePath, jsonPath: saved.jsonPath });
        window.dispatchEvent(new CustomEvent('hjen:generation-reload', { detail: { projectId: proj?.id ?? null } }));

        // ── the enforcement half ────────────────────────────────────────────
        get().updateJob(bgId, { activeStage: 'verify' });
        const check = await swapVerify({ takePath, requirements: round.requirements });
        if (!check.ok || !check.verdicts?.length) {
          // A checker that could not answer does NOT get to end the loop by
          // silence, but neither does it get to spend another make on a guess.
          // The take ships and says the check did not run.
          attempts.push({ path: takePath, jsonPath: saved.jsonPath, landed: 0, verdicts: [] });
          unresolved = round.requirements.map(r => r.id);
          verdicts = [];
          break;
        }
        attempts.push({
          path: takePath, jsonPath: saved.jsonPath,
          landed: check.verdicts.filter(v => v.state === 'landed').length,
          verdicts: check.verdicts,
        });
        onRound?.({ round: round.round, phase: 'verify', takePath, jsonPath: saved.jsonPath, verdicts: check.verdicts });

        if (args.generationPolicy === 'single-pass') {
          const stateById = new Map(check.verdicts.map(verdict => [verdict.id, verdict.state]));
          unresolved = round.requirements
            .filter(requirement => stateById.get(requirement.id) !== 'landed')
            .map(requirement => requirement.id);
          onRound?.({
            round: round.round,
            phase: 'verify',
            note: unresolved.length
              ? `${unresolved.join(' · ')} still need attention. This take is shown as made; no automatic retry was purchased.`
              : 'Every requested change landed.',
          });
          break;
        }

        const step = advanceLadder(round, check.verdicts, takePath);
        unresolved = step.unresolved.map(r => r.id);
        onRound?.({ round: round.round, phase: 'verify', note: step.note });
        if (!step.next) break;
        round = step.next;
      }

      // Re-asking from the original means a later round is not automatically the
      // better one — so the run ships the take that satisfied the most
      // requirements, and the earlier rounds stay in the project as they are.
      const best = attempts.reduce((a, b) => (b.landed > a.landed ? b : a), attempts[0]);
      verdicts = best?.verdicts ?? verdicts;
      const missed = new Set(composed.map(r => r.id));
      for (const v of verdicts) if (v.state === 'landed') missed.delete(v.id);
      unresolved = [...missed];

      get().finishJob(bgId, {
        status: 'done',
        nav: { view: 'swap', projectId: proj?.id ?? null, sub: { imgPath: best?.path } },
      });
      return {
        ok: true, path: best?.path, jsonPath: best?.jsonPath,
        requirements: composed, verdicts, unresolved, rounds,
        lockKit: plates.plan.kit, lockReason: plates.plan.reason, untestable,
      };
    } catch (e: any) {
      const message = e?.message || String(e);
      get().finishJob(bgId, { status: 'error', error: message });
      return { ok: false, message };
    }
  },

  async makeCameraAngleFromPack(args) {
    const { platePath, refPath, quality, aspect, model, index, packId, readout } = args;
    // A SINGLE direct make: the geometry anchor is the Film Space frame (plate.png)
    // — a featureless grey clay blocking figure at the pack's exact camera position.
    // The plate is safe to send directly (no nude anatomy), so no outline/depth/pose
    // workaround is needed.
    if (!platePath) return { ok: false, message: 'This angle has no Film Space frame to make from.' };
    if (!refPath) return { ok: false, message: 'Add a source scene first — the geometry needs a real subject to populate it.' };

    // THE LAW — the verbatim FROM-FILM-SPACE template, built here so no caller can
    // reword it. No [CAMERA ANGLE] token: the geometry is carried by the Film Space
    // frame itself.
    const fullPrompt = buildPackAnglePrompt(readout);

    // Snapshot the project active WHEN the make was fired.
    const proj = get().activeProject();

    // Isolated from the user's live Studio session: canonical defaults (all chips
    // null → buildPrompt passes the make prompt through untouched), overriding
    // ONLY the frames-engine make-settings (model · quality · aspect).
    const sel: Selections = { ...initialSelections, prompt: fullPrompt, quality, aspect, model };
    // EXACTLY two references, composition first, source scene last. runFrameGeneration
    // orders composition layers first in array order — so the Film Space frame is
    // Image 1 and the source scene is Image 2, exactly the order the FROM-FILM-SPACE
    // prompt names them. Only the OpenAI path consumes references; the Gemini path
    // renders text-only (provenance).
    const refLayers: Layer[] = [
      { id: `pack-geo-${index}`, assetId: `pack-geo-${index}`, category: 'composition' as LibCategory, name: 'Film Space frame', thumbPath: platePath, filePath: platePath },
      { id: `pack-src-${index}`, assetId: `pack-src-${index}`, category: 'general' as LibCategory, name: 'source scene', thumbPath: refPath, filePath: refPath },
    ];
    const modelSpec = MODELS[sel.model];
    const label = (readout || packId || `pack ${index + 1}`).trim();
    const shortLabel = label.length > 48 ? label.slice(0, 48) + '…' : label;

    const bgId = get().startJob({
      kind: 'frame-make',
      title: `Angle · Film Space · ${shortLabel}`,
      projectId: proj?.id ?? null,
      nav: { view: 'angles', projectId: proj?.id ?? null },
      stages: [
        { key: 'make', label: 'Make the take', state: 'pending' },
        { key: 'save', label: 'Save to the project', state: 'pending' },
      ],
      progressText: `${modelSpec.label} · ${quality} · ${aspect}`,
    });

    const tStart = performance.now();
    try {
      get().updateJob(bgId, { activeStage: 'make' });
      // Geometry held by the plate (Image 1) + subject/environment held by the
      // source (Image 2) + the subject-locked, plate-anchored make prompt. No
      // extra fidelity param — gpt-image-2 rejects input_fidelity.
      const { result, apiSize, apiDurationMs, size } = await runFrameGeneration(sel, refLayers);
      get().updateJob(bgId, { activeStage: 'save' });

      const saved = await window.hjen.saveGeneration({
        base64: result.b64,
        promptSlug: slugify(`angle-fs-${index + 1}-${packId || 'pack'}`),
        projectSlug: proj?.slug,
        projectId: proj?.id,
        sidecar: {
          captured: new Date().toISOString(),
          project: proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null,
          prompt: result.prompt,
          size: result.size,
          apiSize,
          finalSize: `${size.targetWidth}x${size.targetHeight}`,
          finalMP: size.finalMP,
          model: modelSpec.label,
          apiModelId: modelSpec.apiModelId,
          estimatedCost: estimateCost({ model: sel.model, quality: sel.quality, apiSize: size.apiSize }),
          durationMs: Math.round(performance.now() - tStart),
          apiDurationMs,
          references: refLayers.map(l => ({ id: l.id, assetId: l.assetId, category: l.category, name: l.name, filePath: l.filePath, thumbPath: l.thumbPath })),
          selections: serializeSelections(sel),
          // provenance — a take MADE by Camera Angles FROM a Film Space Angle Pack.
          cameraAngle: { fromPack: packId || null, platePath, source: refPath, readout: readout || null, index },
        },
      });
      const savedPath = saved.imgPath;
      if (proj) {
        set(state => ({
          projects: state.projects.map(p => p.id === proj.id ? { ...p, generationCount: (p.generationCount || 0) + 1 } : p),
        }));
      }
      get().finishJob(bgId, {
        status: 'done',
        nav: { view: 'angles', projectId: proj?.id ?? null, sub: { imgPath: savedPath } },
      });
      return { ok: true, path: savedPath, jsonPath: saved.jsonPath };
    } catch (e: any) {
      const message = e?.message || String(e);
      get().finishJob(bgId, { status: 'error', error: message });
      return { ok: false, message };
    }
  },

  async makeBreakdownShotVideo(args) {
    const { slug, no, prompt, imagePath, modelId, resolution, duration, ratio, endImagePath, appendix, title } = args;
    const clean = (prompt || '').trim();
    if (!clean) return { ok: false, message: 'This shot has no video prompt to make from.' };
    if (!imagePath) return { ok: false, message: 'Make the frame first — the video needs its first frame.' };
    // Appendix (attachment descriptions) travels with the prompt.
    const fullPrompt = appendix?.trim() ? `${clean}\n\n${appendix.trim()}` : clean;

    // Resolve the chosen video backend from the registry (Seedance or Kling).
    const { videoModelById } = await import('./lib/video/models');
    const desc = videoModelById(modelId) ?? videoModelById('seedance-2.0')!;

    // Snapshot the project active WHEN the make was fired, so a mid-flight
    // project switch still saves the clip to the right library.
    const proj = get().activeProject();
    const jobTitle = `Video · shot ${no}${title ? ` · ${title}` : ''}`;
    const fps = 24;

    // ISOLATED from the user's live Video session: this make never touches the
    // store's `selections`, `layers`, or `videoJobs` — it drives the chosen
    // backend directly with the shot's fused VIDEO prompt + the MADE frame as its
    // first frame (any video-role image attachment becomes the end-frame anchor).
    // Registered as a BgJob (task tab + status bar + LOG) like the frame make,
    // and lands back on the SHOTLIST when finished.
    const bgId = get().startJob({
      kind: 'video-make',
      title: jobTitle,
      projectId: proj?.id ?? null,
      nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: slug, breakdownPage: 'shotlist' } },
      stages: [
        { key: 'submit', label: 'Submit to the server', state: 'pending' },
        { key: 'render', label: 'Render (server-side)', state: 'pending' },
        { key: 'download', label: 'Download the clip', state: 'pending' },
        { key: 'save', label: 'Save into the project', state: 'pending' },
      ],
      progressText: `${desc.label} · ${resolution} · ${duration}s · ${ratio}`,
    });

    const onStatus = (p: { phase: string; status?: string }) => {
      const stage = p.phase === 'downloading' ? 'download'
        : p.phase === 'saving' ? 'save'
        : (p.phase === 'queued' || p.phase === 'running') ? 'render'
        : 'submit';
      get().updateJob(bgId, { activeStage: stage, progressText: p.status || p.phase });
    };

    try {
      let videoPath: string;
      if (desc.provider === 'kling') {
        const { runKling } = await import('./lib/kling');
        const { slugifyPrompt } = await import('./lib/seedance');
        const mode: 'std' | 'pro' | '4k' = resolution === '4k' ? '4k' : resolution === '1080p' ? 'pro' : 'std';
        const kRatio: '16:9' | '9:16' | '1:1' =
          ratio === '9:16' || ratio === '3:4' || ratio === '2:3' ? '9:16' : ratio === '1:1' ? '1:1' : '16:9';
        const dur = desc.durations.includes(duration) ? duration : desc.durations[0];
        const res = await runKling(
          {
            prompt: fullPrompt, imagePath, endImagePath: endImagePath ?? null,
            modelId: desc.apiModelId, mode, aspectRatio: kRatio, duration: dur,
            sound: false, watermark: false,
          },
          { promptSlug: slugifyPrompt(clean || `shot-${no}`), projectSlug: proj?.slug, projectId: proj?.id },
          onStatus,
          () => { get().updateJob(bgId, { activeStage: 'render' }); },
        );
        videoPath = res.videoPath;
      } else {
        const { runSeedance, slugifyPrompt } = await import('./lib/seedance');
        const sRatio = (['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].includes(ratio) ? ratio : '16:9') as '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
        const sRes = (['480p', '720p', '1080p', '4k'].includes(resolution) ? resolution : '720p') as '480p' | '720p' | '1080p' | '4k';
        const res = await runSeedance(
          {
            prompt: fullPrompt, imagePath, endImagePath: endImagePath ?? null,
            resolution: sRes, duration, ratio: sRatio, fps,
            seed: null, cameraFixed: false, watermark: false, audio: false,
            modelId: desc.apiModelId,
          },
          { promptSlug: slugifyPrompt(clean || `shot-${no}`), projectSlug: proj?.slug, projectId: proj?.id },
          onStatus,
          () => { get().updateJob(bgId, { activeStage: 'render' }); },
        );
        videoPath = res.videoPath;
      }
      if (proj) {
        set(state => ({
          projects: state.projects.map(p => p.id === proj.id ? { ...p, generationCount: (p.generationCount || 0) + 1 } : p),
        }));
      }
      get().finishJob(bgId, {
        status: 'done',
        nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: slug, breakdownPage: 'shotlist' } },
      });
      return { ok: true, path: videoPath };
    } catch (e: any) {
      const message = e?.message || String(e);
      get().finishJob(bgId, { status: 'error', error: message });
      return { ok: false, message };
    }
  },

  async buildEntityReference(args) {
    const { slug, kind, id } = args;

    // Read the FRESHEST breakdown from disk to look up the entity's build prompt.
    let bd0: import('./lib/creativemind/breakdown').AdBreakdown | null = null;
    try {
      const r = await window.hjen.mindBreakdownRead({ slug });
      bd0 = r?.ok ? (r.breakdown as any) : null;
    } catch { /* handled below */ }
    if (!bd0) return { ok: false, message: 'Could not open this breakdown to build from.' };

    const ent = findEntity(bd0, kind, id);
    if (!ent) return { ok: false, message: `No ${kind} ${id} in this breakdown's roster.` };
    // TEXT ONLY — the self-contained build prompt (never the ad's video frame).
    // Fall back to the descriptor for older rosters that carry no prompt. For a
    // PERSON this is the PHYSICAL IDENTITY (age/build/skin/face/hair, no clothing).
    const identity = (ent.prompt || ent.descriptor || '').trim();
    if (!identity) return { ok: false, message: `${id} has no build prompt or descriptor to make from.` };

    const proj = get().activeProject();

    // ONE isolated text-to-image make: canonical defaults (every chip null →
    // buildPrompt passes the text through untouched), overriding ONLY prompt +
    // quality/aspect. NO layers, NO reference images — the provenance frame is
    // never fed in. Registers its own frame-make BgJob + saveGeneration; the
    // `part` (face / sheet) rides in the sidecar provenance. Returns the saved
    // path or throws (caller reports the failure). Never touches live selections.
    const runOneMake = async (promptText: string, aspect: string, part?: 'face' | 'sheet', refImagePath?: string): Promise<string> => {
      const sel: Selections = { ...initialSelections, prompt: promptText, quality: 'MED', aspect, model: initialSelections.model };
      // A MADE reference image (e.g. the person's own face) can steer this make as a
      // CHARACTER reference — this is HJEN's own output, never the source film.
      const refLayers: Layer[] = refImagePath
        ? [{ id: `ref-${id}-${part}`, assetId: `ref-${id}-${part}`, category: 'character' as LibCategory, name: 'face reference', thumbPath: refImagePath, filePath: refImagePath }]
        : [];
      const modelSpec = MODELS[sel.model];
      const partLabel = part ? ` ${part}` : '';
      const bgId = get().startJob({
        kind: 'frame-make',
        title: `Reference · ${id}${partLabel}${bd0!.ad?.title ? ` · ${bd0!.ad.title}` : ''}`,
        projectId: proj?.id ?? null,
        nav: { view: 'frame', projectId: proj?.id ?? null },
        stages: [
          { key: 'make', label: `Make the${partLabel || ' reference'}`.trim(), state: 'pending' },
          { key: 'save', label: 'Save to the project', state: 'pending' },
        ],
        progressText: `${modelSpec.label} · MED · ${aspect}`,
      });
      const tStart = performance.now();
      try {
        get().updateJob(bgId, { activeStage: 'make' });
        const { result, apiSize, apiDurationMs, size } = await runFrameGeneration(sel, refLayers);
        get().updateJob(bgId, { activeStage: 'save' });
        const saved = await window.hjen.saveGeneration({
          base64: result.b64,
          promptSlug: slugify(`ref-${id}${part ? `-${part}` : ''}-${ent.descriptor || kind}`),
          projectSlug: proj?.slug,
          projectId: proj?.id,
          sidecar: {
            captured: new Date().toISOString(),
            project: proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null,
            prompt: result.prompt,
            size: result.size,
            apiSize,
            finalSize: `${size.targetWidth}x${size.targetHeight}`,
            finalMP: size.finalMP,
            model: modelSpec.label,
            apiModelId: modelSpec.apiModelId,
            estimatedCost: estimateCost({ model: sel.model, quality: sel.quality, apiSize: size.apiSize }),
            durationMs: Math.round(performance.now() - tStart),
            apiDurationMs,
            // record the reference layer (e.g. the SHEET's face anchor) so opening
            // this image in Frame restores it — full object, not a bare path.
            references: refLayers.map(l => ({ id: l.id, assetId: l.assetId, category: l.category, name: l.name, filePath: l.filePath, thumbPath: l.thumbPath })),
            selections: serializeSelections(sel),
            // provenance — a clean reference MADE from a roster entity (+ which part)
            breakdownEntity: { id, kind, ...(part ? { part } : {}) },
          },
        });
        if (proj) {
          set(state => ({
            projects: state.projects.map(p => p.id === proj.id ? { ...p, generationCount: (p.generationCount || 0) + 1 } : p),
          }));
        }
        get().finishJob(bgId, {
          status: 'done',
          nav: { view: 'frame', projectId: proj?.id ?? null, sub: { imgPath: saved.imgPath } },
        });
        return saved.imgPath;
      } catch (e: any) {
        get().finishJob(bgId, { status: 'error', error: e?.message || String(e) });
        throw e;
      }
    };

    // Re-read the FRESHEST breakdown (right before the merge so a concurrent
    // shot/entity write during the makes is never clobbered) and return its entity.
    const readFreshEnt = async (): Promise<{ fresh: import('./lib/creativemind/breakdown').AdBreakdown; fEnt: any }> => {
      const r = await window.hjen.mindBreakdownRead({ slug });
      const fresh = (r?.ok ? (r.breakdown as any) : bd0) as import('./lib/creativemind/breakdown').AdBreakdown;
      return { fresh, fEnt: findEntity(fresh, kind, id) as any };
    };

    if (kind === 'person') {
      // A person needs TWO neutral identity references (built from IDENTITY text
      // only): a bare shoulders-up FACE and a 3-angle character SHEET in neutral
      // logo-free clothing. The SHEET (the full-body identity) is the one linked to
      // the person's shots; the FACE stays a pure identity ref (not linked).
      // Reference backgrounds are a FLAT 50% NEUTRAL GRAY (#808080) — the optimal
      // anchor for AI character re-identification (prevents white color-bleed/halos,
      // preserves highlight+shadow contrast, gives the vision encoder a true zero
      // point). Flat even studio light, no dramatic shadows/rim, monochrome clothing.
      const facePrompt = `MAKE a clean close-up reference portrait of ${identity}. Framing: head-and-shoulders, cropped at the shoulders, with BARE shoulders and NO clothing visible at all. The face is sharp, clearly visible, neutral expression, front-facing (passport-style) or a clean three-quarter view. Lighting: flat, even, balanced studio light — NO dramatic shadows, NO rim light — so true facial depth reads. Background: a solid, flat, matte 50% NEUTRAL GRAY (#808080, RGB 128,128,128), no gradient. No logos, no props, no text — a neutral casting/identity reference.`;
      // The SHEET must show the SAME face as the FACE reference — so we build the
      // FACE first, then feed it into the SHEET make as the identity reference
      // (the sheet otherwise drifts to a different face). The face image is HJEN's
      // own output, not the film.
      const sheetPrompt = `MAKE a character-sheet turnaround reference of THIS SAME PERSON. ONE single wide canvas with EXACTLY THREE standing views side by side, left to right: FRONT, THREE-QUARTER, BACK. FRONT is the only headless technical body plate: straight-on and cropped cleanly at the BASE OF THE NECK, with NO face, facial feature, hair or headwear visible. THREE-QUARTER shows the complete head and the face clearly; only this face must match the attached face-reference image exactly — same facial geometry, age, skin, hair and features. BACK shows the complete natural back of the head and outfit, with no over-shoulder face. Physical identity: ${identity}. STATURE LOCK: construct the same underlying adult body in every panel at 7.5 to 8 head-lengths tall. A plus-size or broad build changes width only, never height, torso length or leg length. Crotch just above the standing-height midpoint; knees halfway between crotch and floor; fingertips reach mid-thigh. Each complete figure uses 88–92% of canvas height and no more than 68% of its equal vertical column width. All panels share one invisible crown line, one shoulder line and one feet baseline; FRONT reserves empty head space above its neck crop and is never enlarged or shortened to fill it. Use an orthographic mid-torso-height camera with 85mm-equivalent perspective, level horizon, no high angle, wide-angle foreshortening or perspective shrink. They wear simple SOLID DARK monochrome clothing (a plain dark charcoal t-shirt and plain dark trousers — NO logos, no brand marks, no patterns) so clothing never reads as identity. Lighting: flat, even, balanced studio light. Background: solid flat matte 50% NEUTRAL GRAY (#808080), no gradient. Exactly three views, no fourth view, no short stature unless explicitly stated, no compressed torso or shortened limbs. A technical model-sheet reference.`;
      const at = new Date().toISOString();
      let facePath: string | undefined; let sheetPath: string | undefined; let failMsg: string | undefined;
      try { facePath = await runOneMake(facePrompt, '4:5', 'face'); }
      catch (e: any) { failMsg = `Face build stopped: ${String(e?.message || e)}`; }
      // Feed the built FACE into the SHEET as the identity reference (if it landed).
      try { sheetPath = await runOneMake(sheetPrompt, '16:9', 'sheet', facePath); }
      catch (e: any) { failMsg = failMsg ? `${failMsg}; sheet build stopped too` : `Sheet build stopped: ${String(e?.message || e)}`; }
      if (!facePath && !sheetPath) return { ok: false, message: failMsg || 'Both person references stopped.' };
      try {
        // APPEND to each slot's history (never overwrite) + point active at the new
        // build; migrate any legacy single into the array. Link the ACTIVE SHEET.
        const { fresh, fEnt } = await readFreshEnt();
        const patch: any = {};
        if (facePath) {
          patch.builtFaces = [...foldLegacy(fEnt?.builtFaces, fEnt?.builtFace), { path: facePath, at }];
          patch.activeFaceAt = at; patch.builtFace = undefined;
        }
        if (sheetPath) {
          patch.builtSheets = [...foldLegacy(fEnt?.builtSheets, fEnt?.builtSheet), { path: sheetPath, at }];
          patch.activeSheetAt = at; patch.builtSheet = undefined;
        }
        let merged = patchEntity(fresh, kind, id, patch);
        // The SHEET (full-body identity) links to shots; the FACE stays unlinked.
        if (sheetPath) merged = linkBuiltRefToShots(merged, id, ent.shotNos, sheetPath, 'both', `${id} identity`);
        await window.hjen.mindBreakdownWrite({ slug, breakdown: merged });
        return { ok: true, path: sheetPath || facePath, breakdown: merged, message: failMsg };
      } catch (e: any) {
        return { ok: true, path: sheetPath || facePath, message: `Built, but linking failed: ${String(e?.message || e)}` };
      }
    }

    // PLACE / ASSET — one clean reference APPENDED to the slot's history + set
    // active, linked to the entity's shots (role 'both' for assets, 'frame' for places).
    let savedPath: string;
    try { savedPath = await runOneMake(identity, '16:9'); }
    catch (e: any) { return { ok: false, message: e?.message || String(e) }; }
    try {
      const role: 'both' | 'frame' = kind === 'place' ? 'frame' : 'both';
      const at = new Date().toISOString();
      const { fresh, fEnt } = await readFreshEnt();
      const patch: any = {
        builtRefs: [...foldLegacy(fEnt?.builtRefs, fEnt?.builtRef), { path: savedPath, at }],
        activeRefAt: at, builtRef: undefined,
      };
      let merged = patchEntity(fresh, kind, id, patch);
      merged = linkBuiltRefToShots(merged, id, ent.shotNos, savedPath, role, `${id} reference`);
      await window.hjen.mindBreakdownWrite({ slug, breakdown: merged });
      return { ok: true, path: savedPath, breakdown: merged };
    } catch (e: any) {
      // The image is made + saved; only the link write failed — report the path so
      // the UI still shows the built reference (a re-build re-attempts the link).
      return { ok: true, path: savedPath, message: `Built, but linking failed: ${String(e?.message || e)}` };
    }
  },

  // ── ORPHANED REFERENCES — scan + restore ───────────────────────────────────
  async scanOrphanRefs(args) {
    const { slug } = args;

    // Freshest breakdown — the KNOWN set is derived from its roster's histories.
    let bd0: import('./lib/creativemind/breakdown').AdBreakdown | null = null;
    try {
      const r = await window.hjen.mindBreakdownRead({ slug });
      bd0 = r?.ok ? (r.breakdown as any) : null;
    } catch { /* handled below */ }
    if (!bd0) return [];

    const proj = get().activeProject();
    if (!proj) return [];   // orphans are scoped to the active project's library

    // KNOWN set — EVERY built path across EVERY entity's history (active or not),
    // migrating any legacy single field in too, so a still-pointed image is never
    // mistaken for an orphan.
    const known = new Set<string>();
    const ents = bd0.pipeline?.entities;
    const addList = (list?: import('./lib/creativemind/breakdown').BuiltRef[], legacy?: import('./lib/creativemind/breakdown').BuiltRef) => {
      for (const b of foldLegacy(list, legacy)) if (b?.path) known.add(b.path);
    };
    if (ents) {
      for (const p of ents.persons || []) {
        addList((p as any).builtFaces, (p as any).builtFace);
        addList((p as any).builtSheets, (p as any).builtSheet);
      }
      for (const l of ents.places || []) addList((l as any).builtRefs, (l as any).builtRef);
      for (const a of ents.assets || []) addList((a as any).builtRefs, (a as any).builtRef);
    }
    // Roster ids still present — decides `matched` (an orphan whose id was dropped
    // when the roster was re-run is viewable but not restorable).
    const rosterIds = new Set<string>();
    for (const p of ents?.persons || []) rosterIds.add(p.id);
    for (const l of ents?.places || []) rosterIds.add(l.id);
    for (const a of ents?.assets || []) rosterIds.add(a.id);

    // Every generation on disk, narrowed to THIS project's library first (cheap —
    // the entry already carries projectSlug/projectId), so we only crack open the
    // sidecars that could possibly be ours.
    let all: import('./types/hjen-bridge').GlobalGenerationEntry[] = [];
    try { all = await window.hjen.listAllGenerations(); } catch { return []; }
    const mine = all.filter(e => e.projectSlug === proj.slug || (e.projectId != null && e.projectId === proj.id));

    const out: OrphanRef[] = [];
    for (const e of mine) {
      if (known.has(e.imgPath)) continue;   // still pointed at — not an orphan
      // Provenance rides in the sidecar; read it to learn the target entity.
      let sc: any = null;
      try { sc = await window.hjen.readSidecar(e.jsonPath); } catch { /* skip unreadable */ }
      const be = sc?.breakdownEntity;
      if (!be || !be.id || !be.kind) continue;   // not a BUILD REFERENCE
      out.push({
        imgPath: e.imgPath,
        thumbPath: e.thumbPath,
        id: be.id,
        kind: be.kind,
        part: be.part,
        at: (typeof sc?.captured === 'string' && sc.captured) || (e.captured ?? null) || new Date(e.ts).toISOString(),
        dateFolder: e.dateFolder,
        matched: rosterIds.has(be.id),
      });
    }
    // Newest first — mirrors the library sort.
    out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return out;
  },

  async restoreOrphanRef(args) {
    const { slug, imgPath, id, kind, part, at } = args;

    // Freshest read → merge → write (same discipline as buildEntityReference), so a
    // concurrent roster/shot edit is never clobbered.
    let fresh: import('./lib/creativemind/breakdown').AdBreakdown | null = null;
    try {
      const r = await window.hjen.mindBreakdownRead({ slug });
      fresh = r?.ok ? (r.breakdown as any) : null;
    } catch { /* handled below */ }
    if (!fresh) return { ok: false, message: 'Could not open this breakdown to restore into.' };

    const ent = findEntity(fresh, kind, id) as any;
    if (!ent) return { ok: false, message: `${id} is no longer in this breakdown's roster — nothing to restore into.` };

    // Which slot history does this orphan belong to? A person's FACE part → faces;
    // its SHEET part (or a legacy single-image person build with no part) → sheets;
    // a place/asset → its single refs history.
    const entry: import('./lib/creativemind/breakdown').BuiltRef = { path: imgPath, at };
    const patch: any = {};
    if (kind === 'person' && part === 'face') {
      const list = foldLegacy(ent.builtFaces, ent.builtFace);
      if (list.some(b => b.path === imgPath)) return { ok: true, message: 'Already in this face history.' };
      patch.builtFaces = [...list, entry]; patch.builtFace = undefined;
    } else if (kind === 'person') {
      const list = foldLegacy(ent.builtSheets, ent.builtSheet);
      if (list.some(b => b.path === imgPath)) return { ok: true, message: 'Already in this sheet history.' };
      patch.builtSheets = [...list, entry]; patch.builtSheet = undefined;
    } else {
      const list = foldLegacy(ent.builtRefs, ent.builtRef);
      if (list.some(b => b.path === imgPath)) return { ok: true, message: 'Already in this history.' };
      patch.builtRefs = [...list, entry]; patch.builtRef = undefined;
    }
    // APPEND only — the active pointer is untouched (the user picks it via the
    // history viewer). No shot re-link, no file touched.
    const merged = patchEntity(fresh, kind, id, patch);
    try {
      await window.hjen.mindBreakdownWrite({ slug, breakdown: merged });
      return { ok: true, breakdown: merged };
    } catch (e: any) {
      return { ok: false, message: `Could not save the restore: ${String(e?.message || e)}` };
    }
  },

  async enhancePrompt() {
    const { selections, layers: rawLayers, enhancing } = get();
    if (enhancing) return;

    // Same orphan strip as generate() — otherwise a phantom child layer
    // tells Claude "wardrobe ref: [garment]" when the parent character
    // (and thus the visible UI entry) was already removed.
    const enhLiveIds = new Set(rawLayers.map(l => l.id));
    const layers = rawLayers.filter(l => !l.parentLayerId || enhLiveIds.has(l.parentLayerId));
    if (layers.length !== rawLayers.length) {
      console.warn(`[enhancePrompt] stripped ${rawLayers.length - layers.length} orphan layer(s) before sending`);
      set({ layers });
    }
    const raw = selections.prompt.trim();
    if (!raw) {
      set({ error: 'Write a prompt first, then Enhance.' });
      return;
    }

    // Pass each layer with its parent character's name (if any) so Claude
    // can attach wardrobe / props to the right subject in the prose.
    const parentNameById = new Map<string, string>();
    for (const l of layers) {
      if (l.category === 'character') {
        parentNameById.set(l.id, (l.customName?.trim() || l.name));
      }
    }
    const refs = layers.map(l => ({
      filePath: l.filePath,
      category: l.category,
      name: l.name,
      customName: l.customName,
      parentName: l.parentLayerId ? parentNameById.get(l.parentLayerId) : undefined,
    }));

    // Attribute the cost to the project that was active when Enhance ran,
    // matching how generate() snapshots project context.
    const proj = get().activeProject();

    // Forward the selected chips so Claude can keep its rewrite compatible
    // with the user's framing / lens / film / lighting / style decisions.
    const settings = {
      angle: selections.angle ? { name: selections.angle.name, description: selections.angle.description } : null,
      camera: selections.camera ? { name: selections.camera.name, prompt: selections.camera.prompt } : null,
      lens: selections.lens ? { name: selections.lens.name, note: selections.lens.note } : null,
      stock: selections.stock ? { name: selections.stock.name, usage: selections.stock.usage } : null,
      lighting: selections.lighting ? { name: selections.lighting.name, description: selections.lighting.description } : null,
      movement: selections.movement ? { name: selections.movement.name, description: selections.movement.description } : null,
      focal_mm: selections.focal_mm,
      aperture_f: selections.aperture_f,
      aspect: selections.aspect,
      stylePreset: selections.style_preset,
      movie: selections.movie ? {
        title: selections.movie.title,
        director: selections.movie.director,
        year: selections.movie.year,
        // `type` distinguishes Animation from Live Action — Claude needs this
        // to choose between animation-language vs photoreal rewriting.
        type: selections.movie.type,
      } : null,
      photographer: selections.photographer ? {
        name: selections.photographer.name,
        notes: selections.photographer.notes,
        genre: selections.photographer.genre,
      } : null,
      atmosphere: selections.atmosphere,
    };

    set({ enhancing: true, error: null });
    try {
      const res = await window.hjen.enhancePrompt({
        rawPrompt: raw,
        references: refs,
        settings,
        projectId: proj?.id ?? null,
        projectSlug: proj?.slug ?? null,
        projectName: proj?.name ?? null,
      });
      if (!res.ok) {
        set({ enhancing: false, error: res.message });
        return;
      }
      set(state => ({
        enhancing: false,
        selections: { ...state.selections, prompt: res.enhancedPrompt },
        lastEnhancement: {
          originalPrompt: raw,
          enhancedPrompt: res.enhancedPrompt,
          usd: res.usd,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          model: res.model,
          ts: Date.now(),
        },
      }));
    } catch (e: any) {
      set({ enhancing: false, error: e?.message || 'Enhancement failed.' });
    }
  },

  undoEnhancement() {
    const { lastEnhancement } = get();
    if (!lastEnhancement) return;
    // Keep lastEnhancement so the user can Redo without spending another
    // API call. setSelection only clears it on a real manual edit.
    set(state => ({
      selections: { ...state.selections, prompt: lastEnhancement.originalPrompt },
    }));
  },

  redoEnhancement() {
    const { lastEnhancement } = get();
    if (!lastEnhancement) return;
    set(state => ({
      selections: { ...state.selections, prompt: lastEnhancement.enhancedPrompt },
    }));
  },

  resetScene() {
    set(() => ({
      // Full reset to factory defaults — prompt, atmosphere, negative, AND the
      // entire DOP panel (angle, aspect, style preset, movie/photographer,
      // camera, lens, stock, focal, aperture, lighting, movement) plus the
      // engine settings (model, resolution, quality).
      selections: { ...initialSelections },
      layers: [],
      lastEnhancement: null,
      // Drop the canvas image so the user sees the branded placeholder.
      // History on disk is untouched.
      current: null,
      error: null,
      activeDnaPresetId: null,
    }));
  },

  clearError() {
    set({ error: null });
  },

  setError(message) {
    set({ error: message });
  },

  restoreInterruptedJob(id) {
    const { interruptedJobs, catalog } = get();
    const job = interruptedJobs.find(j => j.id === id);
    if (!job || !catalog) return;
    const { selections, layers, activeProjectId } = rebuildFromPayload(get, job);
    // Land on the Frame workspace — that is where the prompt form lives. The
    // old code sent the user to `studio` (the product hub), which is what
    // "RESTORE kicks me out of the page" was: the form was repopulated on a
    // view that doesn't show it. `frame` keeps the restore visible in place.
    set(state => ({
      selections,
      activeDnaPresetId: null,
      layers,
      activeProjectId,
      activeView: 'frame',
      interruptedJobs: state.interruptedJobs.filter(j => j.id !== id),
    }));
    window.hjen.clearPendingJob({ id }).catch(() => {});
  },

  dismissInterruptedJob(id) {
    set(state => ({
      interruptedJobs: state.interruptedJobs.filter(j => j.id !== id),
    }));
    window.hjen.clearPendingJob({ id }).catch(() => {});
  },

  async loadFailedJobs() {
    try {
      const list = await window.hjen.listFailedJobs();
      set({ failedJobs: Array.isArray(list) ? list : [] });
    } catch (err) {
      console.warn('[failedJobs] load failed', err);
    }
  },

  inspectFailedJob(job) {
    set({ inspectingFailedJob: job });
  },

  async dismissFailedJob(id) {
    // Optimistic: drop from UI first, then ask main to delete the file.
    set(state => ({
      failedJobs: state.failedJobs.filter(j => j.id !== id),
      inspectingFailedJob: state.inspectingFailedJob?.id === id ? null : state.inspectingFailedJob,
    }));
    try { await window.hjen.deleteFailedJob({ id }); } catch {}
  },

  restoreFailedJob(id) {
    const { failedJobs, catalog } = get();
    const job = failedJobs.find(j => j.id === id);
    if (!job || !catalog) return;
    const { selections, layers, activeProjectId } = rebuildFromPayload(get, job);
    // IN PLACE: repopulate the form + refs and set the active project, but do
    // NOT change activeView — the user is already on the Frame view (the failed
    // group only renders there). Keep the failed entry; DISMISS is the delete.
    set({ selections, activeDnaPresetId: null, layers, activeProjectId, error: null });
    if (get().activeView !== 'frame') set({ activeView: 'frame' });
    set({ inspectingFailedJob: null });
  },

  async recoverPendingFrames() {
    // Only the gateway path is server-recoverable (offline/direct makes never
    // charged and keep no server copy → those stay as RESTORE-able interrupted
    // jobs). No gateway → surface every image orphan for manual RESTORE (legacy).
    const gw = await gatewayConf();
    let pending: Array<PendingJobPayload | PendingVideoPayload> = [];
    try { pending = await window.hjen.listPendingJobs(); } catch { return; }
    const images = pending.filter(
      (o): o is PendingJobPayload => (o as any)?.kind !== 'video',
    );
    if (images.length === 0) { set({ interruptedJobs: [] }); return; }
    if (!gw) { set({ interruptedJobs: images }); return; }

    // #2 — recover the whole batch IN PARALLEL (bounded), so 8 interrupted makes
    // come back together in seconds, not one-by-one over a slow serial crawl.
    // #3 — each recovered frame is pushed into `history` so it appears LIVE in the
    // Frame browser with no page refresh (same reactive path a fresh make uses).
    const recoverOne = async (p: PendingJobPayload): Promise<GenerateResult | null> => {
      try {
        const resp = await fetch(`${gw.url}/api/frame/recover?job=${encodeURIComponent(p.id)}`, {
          headers: { authorization: `Bearer ${gw.token}` },
        });
        const j: any = resp.ok ? await resp.json() : null;
        if (!(j?.ok && j.found && j.b64)) return null;
        // A fresh operations job makes the automatic recovery visible on the
        // status bar + LOG — "your paid frame came back", no button needed.
        const bgId = get().startJob({
          kind: 'frame-make',
          title: `Recover · ${p.promptTitle || 'Frame'}`,
          projectId: p.project?.id ?? null,
          nav: { view: 'frame', projectId: p.project?.id ?? null },
          stages: [{ key: 'download', label: 'Retrieve your paid frame', state: 'active' }, { key: 'save', label: 'Save to the project', state: 'pending' }],
          progressText: p.modelLabel || '',
        });
        const promptText = (p.selections as any)?.prompt || p.promptTitle || 'Frame';
        const w = j.targetWidth, h = j.targetHeight;
        const sizeStr = w && h ? `${w}x${h}` : (j.apiSize || '');
        const saved = await window.hjen.saveGeneration({
          base64: j.b64,
          promptSlug: slugify(promptText || 'frame'),
          projectSlug: p.project?.slug,
          projectId: p.project?.id,
          sidecar: {
            captured: new Date().toISOString(),
            project: p.project ?? null,
            prompt: promptText,
            size: sizeStr,
            apiSize: j.apiSize || '',
            finalSize: sizeStr,
            finalMP: j.finalMP,
            model: j.modelLabel || p.modelLabel,
            modelLabel: j.modelLabel || p.modelLabel,
            quality: j.quality,
            aspect: p.aspect,
            resolution: p.resolution,
            references: (p.layers || []).map(l => ({
              id: l.id, assetId: l.assetId, category: l.category, name: l.name,
              customName: l.customName, parentLayerId: l.parentLayerId, groupName: l.groupName, filePath: l.filePath,
            })),
            selections: p.selections,
            recovered: true,
          },
        });
        if (p.project) {
          set(state => ({ projects: state.projects.map(pr => pr.id === p.project!.id ? { ...pr, generationCount: (pr.generationCount || 0) + 1 } : pr) }));
        }
        get().finishJob(bgId, { status: 'done', nav: { view: 'frame', projectId: p.project?.id ?? null, sub: saved?.imgPath ? { imgPath: saved.imgPath } : undefined } });
        try { await window.hjen.clearPendingJob({ id: p.id }); } catch {}
        // The reactive record the Frame browser renders (like a fresh make).
        return {
          url: `data:image/png;base64,${j.b64}`, b64: j.b64, prompt: promptText,
          size: sizeStr, ts: p.ts || Date.now(), modelLabel: j.modelLabel || p.modelLabel,
          savedPath: saved?.imgPath, sidecarPath: saved?.jsonPath, dir: saved?.dir,
        } as GenerateResult;
      } catch { /* network/parse blip → not-yet-recovered; next launch retries */ return null; }
    };

    // Bounded-concurrency map — at most CAP recoveries in flight at once.
    const CAP = 4;
    const queue = [...images];
    const recovered: Array<{ p: PendingJobPayload; result: GenerateResult | null }> = [];
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift()!;
        recovered.push({ p, result: await recoverOne(p) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CAP, images.length) }, worker));

    const results = recovered.filter(r => r.result).map(r => r.result!) as GenerateResult[];
    if (results.length) {
      results.sort((a, b) => (b.ts || 0) - (a.ts || 0)); // newest first
      set(state => ({
        history: [...results, ...state.history].slice(0, 50),
        current: state.current ?? results[0],
      }));
    }
    // Whatever the server couldn't return (never delivered → already refunded,
    // or still unreachable) stays available for a manual RESTORE / re-run.
    set({ interruptedJobs: recovered.filter(r => !r.result).map(r => r.p) });
  },

  async recoverPendingVideos() {
    let pending: Array<PendingJobPayload | PendingVideoPayload> = [];
    try { pending = await window.hjen.listPendingJobs(); } catch { return; }
    const videos = pending.filter(
      (p): p is PendingVideoPayload => (p as any)?.kind === 'video' && !!(p as any)?.taskId,
    );
    if (videos.length === 0) return;
    const { resumeSeedance } = await import('./lib/seedance');
    const { resumeKling } = await import('./lib/kling');
    const { estimateSeedanceCost, estimateKlingCost } = await import('./lib/pricing');

    for (const p of videos) {
      // Register a fresh operations job so the recovery is visible on the tab
      // strip + status bar + LOG — the app-wide "we're re-fetching your paid
      // video" signal. Its nav returns the user to the Video view.
      const bgId = get().startJob({
        kind: 'video-recover',
        title: `Recover · ${p.promptTitle || 'video'}`,
        projectId: p.project?.id ?? null,
        nav: { view: 'video', projectId: p.project?.id ?? null },
        stages: [
          { key: 'poll', label: 'Re-poll the server task', state: 'pending' },
          { key: 'download', label: 'Download the finished clip', state: 'pending' },
          { key: 'save', label: 'Save into the project', state: 'pending' },
        ],
        progressText: `task ${p.taskId.slice(0, 10)}…`,
      });
      // Also surface a placeholder VideoJob so the Video view shows it as running.
      const vjobId = `vrec-${p.id}`;
      get().addVideoJob({
        id: vjobId,
        startedAt: p.ts || Date.now(),
        prompt: p.prompt,
        promptTitle: p.promptTitle,
        sourcePath: p.imagePath ?? null,
        endFramePath: p.endImagePath ?? null,
        resolution: p.resolution as any,
        duration: p.duration,
        ratio: p.ratio as any,
        fps: p.fps,
        seed: p.seed ?? null,
        cameraFixed: !!p.cameraFixed,
        watermark: !!p.watermark,
        audio: !!p.audio,
        modelId: p.modelId || p.model || '',
        phase: 'running',
        status: 'recovering',
        taskId: p.taskId,
      });

      void (async () => {
        try {
          // KLING BRANCH — a Kling pending record carries provider:'kling' +
          // videoType + the params to rebuild KlingParams. Resume via resumeKling
          // (re-polls the existing paid task; never re-submits). The Seedance code
          // below is byte-identical and only runs for non-Kling records.
          if (p.provider === 'kling') {
            const rec = await resumeKling(
              p.taskId,
              p.videoType ?? (p.imagePath ? 'image2video' : 'text2video'),
              p.model || p.modelId || '',
              p.promptFull || p.prompt,
              {
                prompt: p.prompt,
                negativePrompt: p.negativePrompt ?? undefined,
                imagePath: p.imagePath ?? null,
                endImagePath: p.endImagePath ?? null,
                modelId: p.modelId || p.model || '',
                mode: (p.mode ?? 'pro') as 'std' | 'pro' | '4k',
                aspectRatio: (p.ratio ?? '16:9') as '16:9' | '9:16' | '1:1',
                duration: p.duration,
                cfgScale: p.cfgScale ?? null,
                sound: !!p.sound,
                watermark: !!p.watermark,
                videoRefs: p.videoRefs as any,
                rawUserPrompt: p.rawUserPrompt,
                selectionsSnapshot: p.selectionsSnapshot ?? undefined,
              },
              { promptSlug: p.promptSlug, projectSlug: p.project?.slug, projectId: p.project?.id },
              (prog) => {
                const stage = prog.phase === 'downloading' ? 'download'
                  : prog.phase === 'saving' ? 'save' : 'poll';
                get().updateJob(bgId, { activeStage: stage, progressText: prog.status || prog.phase });
                get().updateVideoJob(vjobId, { phase: prog.phase });
              },
            );
            if (rec.kind === 'done') {
              const cost = estimateKlingCost(p.modelId || p.model || '', (p.mode ?? 'pro') as any, p.duration, !!p.sound);
              get().updateVideoJob(vjobId, {
                phase: 'done', taskId: rec.result.taskId, resultPath: rec.result.videoPath,
                finishedAt: Date.now(), estimatedUsd: cost?.usd,
              });
              get().finishJob(bgId, { status: 'done' });
              await window.hjen.clearPendingJob({ id: p.id });
            } else if (rec.kind === 'failed') {
              get().updateVideoJob(vjobId, { phase: 'failed', error: rec.message, finishedAt: Date.now() });
              get().finishJob(bgId, { status: 'error', error: `Server task failed: ${rec.message}` });
              await recordFailedVideo(p, rec.message);
              await window.hjen.clearPendingJob({ id: p.id });
            } else if (rec.kind === 'gone') {
              get().updateVideoJob(vjobId, { phase: 'failed', error: rec.message, finishedAt: Date.now() });
              get().finishJob(bgId, { status: 'interrupted', error: `Server has no record of the task (expired or unreachable): ${rec.message}` });
              await window.hjen.clearPendingJob({ id: p.id });
            } else {
              get().finishJob(bgId, { status: 'interrupted', error: `Still rendering server-side (${rec.status}) — will re-poll on next launch.` });
            }
            return;
          }
          const rec = await resumeSeedance(
            p.taskId,
            p.model || p.modelId || '',
            p.promptFull || p.prompt,
            {
              prompt: p.prompt,
              imagePath: p.imagePath ?? null,
              endImagePath: p.endImagePath ?? null,
              resolution: p.resolution as any,
              duration: p.duration,
              ratio: p.ratio as any,
              fps: p.fps,
              seed: p.seed ?? null,
              cameraFixed: p.cameraFixed,
              watermark: p.watermark,
              audio: p.audio,
              modelId: p.modelId,
              videoRefs: p.videoRefs as any,
              rawUserPrompt: p.rawUserPrompt,
              selectionsSnapshot: p.selectionsSnapshot ?? undefined,
            },
            { promptSlug: p.promptSlug, projectSlug: p.project?.slug, projectId: p.project?.id },
            (prog) => {
              const stage = prog.phase === 'downloading' ? 'download'
                : prog.phase === 'saving' ? 'save' : 'poll';
              get().updateJob(bgId, { activeStage: stage, progressText: prog.status || prog.phase });
              get().updateVideoJob(vjobId, { phase: prog.phase });
            },
          );
          if (rec.kind === 'done') {
            const tokens = rec.result.usage?.completion_tokens ?? null;
            const cost = estimateSeedanceCost(tokens);
            get().updateVideoJob(vjobId, {
              phase: 'done', taskId: rec.result.taskId, resultPath: rec.result.videoPath,
              finishedAt: Date.now(), tokens: tokens ?? undefined, estimatedUsd: cost?.usd,
            });
            get().finishJob(bgId, { status: 'done' });
            await window.hjen.clearPendingJob({ id: p.id });
          } else if (rec.kind === 'failed') {
            get().updateVideoJob(vjobId, { phase: 'failed', error: rec.message, finishedAt: Date.now() });
            get().finishJob(bgId, { status: 'error', error: `Server task failed: ${rec.message}` });
            await recordFailedVideo(p, rec.message);
            await window.hjen.clearPendingJob({ id: p.id });
          } else if (rec.kind === 'gone') {
            get().updateVideoJob(vjobId, { phase: 'failed', error: rec.message, finishedAt: Date.now() });
            get().finishJob(bgId, { status: 'interrupted', error: `Server has no record of the task (expired or unreachable): ${rec.message}` });
            await window.hjen.clearPendingJob({ id: p.id });
          } else {
            // still rendering after our recovery window — leave the pending file
            // so the next launch re-attaches, and mark the op interrupted (honest).
            get().finishJob(bgId, { status: 'interrupted', error: `Still rendering server-side (${rec.status}) — will re-poll on next launch.` });
          }
        } catch (e: any) {
          get().updateVideoJob(vjobId, { phase: 'failed', error: String(e?.message || e), finishedAt: Date.now() });
          get().finishJob(bgId, { status: 'error', error: String(e?.message || e) });
        }
      })();
    }
  },
}));

/** Rebuild Frame selections + layers from a persisted pending/failed payload.
 *  Missing library assets fall back to on-disk filepath ghosts so a restore
 *  survives an asset that was deleted since the job ran. Shared by the
 *  interrupted-restore and failed-restore paths. */
function rebuildFromPayload(get: () => Store, job: PendingJobPayload | FailedJobPayload): {
  selections: Selections; layers: Layer[]; activeProjectId: string | null;
} {
  const { catalog, library, projects, activeProjectId } = get();
  const selections = restoreSelections(catalog!, job.selections);
  const layers: Layer[] = [];
  for (const ref of job.layers) {
    const asset = library.find(a => a.id === ref.assetId);
    const nid = () => ref.id || `layer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (asset) {
      layers.push({
        id: nid(), assetId: asset.id, category: ref.category as LibCategory,
        name: asset.name, customName: ref.customName, parentLayerId: ref.parentLayerId,
        groupName: ref.groupName, thumbPath: asset.thumbPath, filePath: asset.filePath,
      });
    } else if (ref.filePath) {
      layers.push({
        id: nid(), assetId: ref.assetId, category: ref.category as LibCategory,
        name: ref.name || 'Missing asset', customName: ref.customName, parentLayerId: ref.parentLayerId,
        groupName: ref.groupName, thumbPath: ref.thumbPath || ref.filePath, filePath: ref.filePath,
      });
    }
  }
  const proj = job.project && projects.some(p => p.id === job.project!.id) ? job.project.id : activeProjectId;
  return { selections, layers, activeProjectId: proj };
}

/** Persist a recovered-then-failed video into the Failed-videos store so it
 *  shows in the Video sidebar's Failed group with a real reason. */
async function recordFailedVideo(p: PendingVideoPayload, message: string): Promise<void> {
  const fid = `vfail-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const payload: FailedVideoPayload = {
    id: fid, ts: Date.now(), promptTitle: p.promptTitle, errorMessage: message,
    prompt: p.prompt, promptFull: p.promptFull, imagePath: p.imagePath ?? null,
    endImagePath: p.endImagePath ?? null, resolution: p.resolution, duration: p.duration,
    ratio: p.ratio, fps: p.fps, seed: p.seed ?? null, cameraFixed: p.cameraFixed,
    watermark: p.watermark, audio: p.audio, modelId: p.modelId, project: p.project,
  };
  try { await window.hjen.saveFailedVideo({ id: fid, payload }); } catch {}
}

const SIDEBAR_PREF_KEY = 'hjen.sidebarOpen';
const LAYERS_PREF_KEY = 'hjen.layersOpen';
function loadSidebarOpenPref(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_PREF_KEY);
    if (v === null) return true;
    return v === 'true';
  } catch {
    return true;
  }
}
function persistSidebarOpenPref(open: boolean) {
  try { localStorage.setItem(SIDEBAR_PREF_KEY, String(open)); } catch {}
}
function loadLayersOpenPref(): boolean {
  try {
    const v = localStorage.getItem(LAYERS_PREF_KEY);
    if (v === null) return false; // default closed (less surprising on first open)
    return v === 'true';
  } catch {
    return false;
  }
}
// #4 — navigation persistence across reload/relaunch. The renderer is reloaded
// on ⌘R (desktop) and every browser refresh (web); without this the store re-inits
// to the Home tab and the user loses the page they were on. We snapshot the open
// tabs + active view/project to localStorage and restore them on boot.
const NAV_PREF_KEY = 'hjen.nav.v1';
function readNavPref(): { tabs: Tab[]; activeTabId: string; activeView: ActiveView; activeProjectId: string | null } | null {
  try {
    const raw = localStorage.getItem(NAV_PREF_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || !Array.isArray(j.tabs) || j.tabs.length === 0 || !j.activeTabId) return null;
    return j;
  } catch { return null; }
}
function writeNavPref(s: Store) {
  try {
    localStorage.setItem(NAV_PREF_KEY, JSON.stringify({
      tabs: s.tabs.map(t => ({ id: t.id, view: t.view, projectId: t.projectId, sub: t.sub })),
      activeTabId: s.activeTabId,
      activeView: s.activeView,
      activeProjectId: s.activeProjectId,
    }));
  } catch { /* storage full / unavailable — nav persistence is best-effort */ }
}

// Guards the OCR QC's single automatic retake: while the retake generate()
// runs, its own QC failure must not trigger another retake (no loops).
let textRetakeInFlight = false;

// v2 key: Anwar's 2026-07-07 verdict — the layer ships OFF. The v0 compiled
// prompts produced visually weak / inaccurate frames in live use, so the
// layer is strictly opt-in (per-user, from the «الطبقة» panel) until its
// quality passes his eye. The v1 key is abandoned so no stored 'true'
// from the earlier default survives on any machine.
const DNA_LAYER_PREF_KEY = 'hjen.dnaLayerEnabled.v2';
function loadLayerEnabledPref(): boolean {
  try {
    const v = localStorage.getItem(DNA_LAYER_PREF_KEY);
    if (v === null) return false; // OFF by default — opt-in only
    return v === 'true';
  } catch {
    return false;
  }
}
function persistLayerEnabledPref(on: boolean) {
  try { localStorage.setItem(DNA_LAYER_PREF_KEY, String(on)); } catch {}
}
function persistLayersOpenPref(open: boolean) {
  try { localStorage.setItem(LAYERS_PREF_KEY, String(open)); } catch {}
}

function isDnaPresetSetting(key: keyof Selections): boolean {
  return DNA_PRESET_KEYS.has(key);
}

function captureDnaPresetSettings(s: Selections): DnaPresetSettings {
  return {
    angle: s.angle?.id ?? null,
    movie: s.movie?.id ?? null,
    photographer: s.photographer?.id ?? null,
    camera: s.camera?.id ?? null,
    lens: s.lens?.id ?? null,
    stock: s.stock?.id ?? null,
    lighting: s.lighting?.id ?? null,
    movement: s.movement?.id ?? null,
    focal_mm: s.focal_mm,
    aperture_f: s.aperture_f,
    aspect: s.aspect,
    resolution: s.resolution,
    quality: s.quality,
    model: s.model,
    style_preset: s.style_preset,
  };
}

function applyDnaPresetSettings(catalog: Catalog, current: Selections, saved: DnaPresetSettings): Selections {
  const byId = <T extends { id: string }>(items: T[], id: string | null): T | null =>
    id ? items.find(item => item.id === id) ?? null : null;
  return {
    ...current,
    angle: byId(catalog.angles, saved.angle),
    movie: byId(catalog.movies.items, saved.movie),
    photographer: byId(catalog.photographers.items, saved.photographer),
    camera: byId(catalog.cameras.items, saved.camera),
    lens: byId(catalog.lenses.items, saved.lens),
    stock: byId(catalog.stocks.items, saved.stock),
    lighting: byId(catalog.lighting.items, saved.lighting),
    movement: byId(catalog.cameraMovements.items, migrateMovementId(saved.movement)),
    focal_mm: saved.focal_mm,
    aperture_f: saved.aperture_f,
    aspect: saved.aspect,
    resolution: saved.resolution,
    quality: saved.quality,
    model: saved.model,
    style_preset: saved.style_preset,
  };
}

function clearDnaPresetSettings(current: Selections): Selections {
  return {
    ...current,
    angle: initialSelections.angle,
    movie: initialSelections.movie,
    photographer: initialSelections.photographer,
    camera: initialSelections.camera,
    lens: initialSelections.lens,
    stock: initialSelections.stock,
    lighting: initialSelections.lighting,
    movement: initialSelections.movement,
    focal_mm: initialSelections.focal_mm,
    aperture_f: initialSelections.aperture_f,
    aspect: initialSelections.aspect,
    resolution: initialSelections.resolution,
    quality: initialSelections.quality,
    model: initialSelections.model,
    style_preset: initialSelections.style_preset,
  };
}

function clayBasilDnaPreset(): DnaPreset {
  return {
    id: CLAY_BASIL_DNA_PRESET_ID,
    name: 'HJEN DNA · Clay & Basil',
    description: 'Arriflex 35BL · Todd-AO · Kodak 100T · Civil Twilight · 21:9',
    settings: {
      angle: null,
      movie: HJEN_DNA_IDS.movie,
      photographer: null,
      camera: HJEN_DNA_IDS.camera,
      lens: HJEN_DNA_IDS.lens,
      stock: HJEN_DNA_IDS.stock,
      lighting: HJEN_DNA_IDS.lighting,
      movement: HJEN_DNA_IDS.movement,
      focal_mm: 14,
      aperture_f: 1.4,
      aspect: '21:9',
      resolution: '3.7MP',
      quality: 'HIGH',
      model: 'GPT_IMAGE_2',
      style_preset: 'MOVIE',
    },
    createdAt: 0,
    updatedAt: 0,
  };
}

function validDnaPresets(value: unknown): DnaPreset[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is DnaPreset => (
    !!item && typeof item.id === 'string' && typeof item.name === 'string' &&
    typeof item.description === 'string' && !!item.settings &&
    typeof item.settings.aspect === 'string'
  ));
}

function loadDnaPresets(): DnaPreset[] {
  try {
    // v2 is authoritative even when it contains []: that empty array is the
    // persistent tombstone proving the user deliberately deleted every look.
    const saved = localStorage.getItem(DNA_PRESETS_PREF_KEY);
    if (saved !== null) return validDnaPresets(JSON.parse(saved)) ?? [];

    // One-time migration from the old custom-only array. Clay & Basil enters
    // the same catalog once, then never gets synthesized again after deletion.
    const legacyRaw = localStorage.getItem(LEGACY_DNA_PRESETS_PREF_KEY);
    const legacy = legacyRaw === null ? [] : (validDnaPresets(JSON.parse(legacyRaw)) ?? []);
    const migrated = [clayBasilDnaPreset(), ...legacy.filter(item => item.id !== CLAY_BASIL_DNA_PRESET_ID)];
    persistDnaPresets(migrated);
    return migrated;
  } catch {
    return [clayBasilDnaPreset()];
  }
}

function persistDnaPresets(presets: DnaPreset[]) {
  try { localStorage.setItem(DNA_PRESETS_PREF_KEY, JSON.stringify(presets)); } catch {}
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

function restoreSelections(catalog: Catalog, raw: any): Selections {
  const byId = <T extends { id: string }>(arr: T[], id: any) => id ? arr.find(x => x.id === id) ?? null : null;
  return {
    angle: byId(catalog.angles, raw.angle),
    movie: byId(catalog.movies.items, raw.movie),
    photographer: byId(catalog.photographers.items, raw.photographer),
    camera: byId(catalog.cameras.items, raw.camera),
    lens: byId(catalog.lenses.items, raw.lens),
    stock: byId(catalog.stocks.items, raw.stock),
    lighting: byId(catalog.lighting.items, raw.lighting),
    // Migrate legacy movement ids (old 16-item JSON) → the 46-item lib ids so
    // saved projects keep their camera movement.
    movement: byId(catalog.cameraMovements.items, migrateMovementId(raw.movement)),
    focal_mm: typeof raw.focal_mm === 'number' ? raw.focal_mm : null,
    aperture_f: typeof raw.aperture_f === 'number' ? raw.aperture_f : null,
    aspect: typeof raw.aspect === 'string' ? raw.aspect : '21:9',
    resolution: (raw.resolution as Resolution) ?? '3.7MP',
    quality: (raw.quality as Quality) ?? 'HIGH',
    model: (raw.model as ModelId) ?? 'GPT_IMAGE_2',
    style_preset: (raw.style_preset as StylePreset) ?? 'NONE',
    atmosphere: typeof raw.atmosphere === 'string' ? raw.atmosphere : '',
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    negative: typeof raw.negative === 'string' ? raw.negative : '',
  };
}

function serializeSelections(s: Selections) {
  return {
    angle: s.angle?.id ?? null,
    movie: s.movie?.id ?? null,
    photographer: s.photographer?.id ?? null,
    camera: s.camera?.id ?? null,
    lens: s.lens?.id ?? null,
    stock: s.stock?.id ?? null,
    lighting: s.lighting?.id ?? null,
    movement: s.movement?.id ?? null,
    focal_mm: s.focal_mm,
    aperture_f: s.aperture_f,
    aspect: s.aspect,
    resolution: s.resolution,
    quality: s.quality,
    model: s.model,
    style_preset: s.style_preset,
    atmosphere: s.atmosphere,
    prompt: s.prompt,
    negative: s.negative,
  };
}


// Mirror the active project id into localStorage on every change. The web adapter
// reads `hjen_last_project` to tag gateway requests with X-HJEN-Project; without a
// value the server can't persist a generation server-side and instead ships the
// full image as base64 in the poll response — fine for one frame, but several
// HIGH/8.3MP frames finishing at once flood the client with ~12MB payloads each
// and never display. Nothing else wrote this key, so it was always empty. Harmless
// on desktop (the preload host ignores it). Seed from the current state too.
try {
  const _mirrorProject = (id: string | null) => {
    try { if (id) localStorage.setItem('hjen_last_project', id); else localStorage.removeItem('hjen_last_project'); } catch { /* no storage */ }
  };
  _mirrorProject(useStore.getState().activeProjectId);
  useStore.subscribe((s, prev) => { if (s.activeProjectId !== prev.activeProjectId) _mirrorProject(s.activeProjectId); });
} catch { /* best-effort */ }

// ── Auto-surface reconciler ──────────────────────────────────────────────────
// Concurrent per-job poll loops can stall in the browser (background-tab timer
// throttling, connection contention), leaving frames that already rendered AND
// saved server-side invisible until a manual reload. While any frame make is in
// flight, re-list the active project's generations and surface any the polls
// haven't delivered — clearing one in-flight make per surfaced frame. Deduped by
// savedPath so it never conflicts with a poll that does complete. Gateway/web
// only (desktop is local and reliable).
let _reconcileBusy = false;
async function _reconcileGenerations() {
  if (_reconcileBusy) return;
  const st0 = useStore.getState();
  if (!st0.jobs.length) return;                         // nothing making → nothing to do
  _reconcileBusy = true;
  try {
    if (!(await isGatewayActive())) return;             // desktop path is reliable
    const pid = st0.activeProjectId;
    const floor = Math.min(...st0.jobs.map(j => j.startedAt)) - 5000;
    let all: import('./types/hjen-bridge').GlobalGenerationEntry[] = [];
    try { all = await window.hjen.listAllGenerations(); } catch { return; }
    const fresh = all
      .filter(e => e.imgPath && (pid == null || e.projectId === pid) && (e.ts || 0) >= floor)
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));        // oldest-completed first
    if (!fresh.length) return;
    const seen = new Set(useStore.getState().history.map(h => h.savedPath).filter(Boolean) as string[]);
    for (const e of fresh) {
      if (seen.has(e.imgPath)) continue;
      const cur = useStore.getState();
      if (!cur.jobs.length) break;                       // every make accounted for
      seen.add(e.imgPath);
      const entry: GenerateResult = {
        url: `hjen-file://${e.imgPath}`, b64: '', savedPath: e.imgPath, serverSaved: true,
        prompt: '', size: e.finalSize || e.resolution || '', ts: e.ts || Date.now(), modelLabel: e.modelLabel,
      };
      const victim = cur.jobs[0];                         // clear the oldest in-flight make (FIFO)
      useStore.setState(state => {
        const nextJobs = state.jobs.filter(j => j.id !== victim.id);
        const priorHist = state.history.filter(h => h.savedPath !== e.imgPath);
        return { current: entry, history: [entry, ...priorHist].slice(0, 50), jobs: nextJobs, generating: nextJobs.length > 0 };
      });
      try { if (victim.bgId) useStore.getState().finishJob(victim.bgId, { status: 'done' }); } catch { /* log entry is best-effort */ }
    }
  } catch { /* best-effort — never throw into a timer */ } finally { _reconcileBusy = false; }
}
try {
  setInterval(() => { void _reconcileGenerations(); }, 5000);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void _reconcileGenerations(); });
  }
} catch { /* environment without timers */ }

// Dev-only: expose the store for tooling / CDP verification harnesses. Stripped
// from production builds by the import.meta.env.DEV guard. Never referenced by app code.
if (import.meta.env.DEV) { (globalThis as any).__hjenStore = useStore; }
