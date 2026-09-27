// Minimal read-shapes the MCP relies on. Deliberately permissive — stage data
// and sidecars vary by tool version, so anything the MCP only forwards stays
// `unknown`. These MIRROR the desktop app's types (app/src/types/*, store.ts,
// hjen-bridge.d.ts); when the app's shapes change, update here.

export type StageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const STAGE_NUMBERS: StageNumber[] = [1, 2, 3, 4, 5, 6, 7, 8];

export const STAGE_NAMES: Record<StageNumber, string> = {
  1: 'Brief',
  2: 'References',
  3: 'Recast',
  4: 'Treatment',
  5: 'Screenplay',
  6: 'Assets',
  7: 'Frames',
  8: 'Videos',
};

export type StageStatus = 'draft' | 'signed';

export interface ProjectMeta {
  id: string;
  name: string;
  slug: string;
  created: string;
  generationCount: number;
  coverImagePath?: string;
  currentStage?: StageNumber;
  /** The Projects-list mirror. RUNTIME stores this as bare status strings
   *  (`{ "1": "draft" }`); older/other writers may use `{ status }` objects.
   *  Either form is accepted — state.json is the real source of truth. */
  stagesState?: Partial<Record<StageNumber, StageStatus | { status: StageStatus; signedAt?: string }>>;
}

export interface ProjectLedgerEntry {
  id?: string;
  kind?: string;
  body?: string;
  at?: string;
  [k: string]: unknown;
}

export interface ProjectState {
  version: 1;
  currentStage: StageNumber;
  stages: Record<StageNumber, { status: StageStatus; signedAt?: string }>;
  ledger: ProjectLedgerEntry[];
}

export interface GenerationLogEntry {
  ts: number;
  imgPath: string;
  thumbPath?: string;
  jsonPath: string;
  dateFolder: string;
  baseName: string;
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
}
