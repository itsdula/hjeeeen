import type { ModelId, Quality } from '../../types/catalog';
import type { EyeRead } from '../eye/types';
import type { FrameSlots, SlotKey } from '../swap/types';

/**
 * Reference Maker is a director-led graph. The system may interpret and test,
 * but it never outranks the director's raw note or silently authors intent.
 */
export type AuthorityKind =
  | 'director-note'
  | 'attached-reference'
  | 'signed-decision'
  | 'deck-context'
  | 'visual-observation'
  | 'default';

export const AUTHORITY_RANK: Record<AuthorityKind, number> = {
  'director-note': 600,
  'attached-reference': 500,
  'signed-decision': 400,
  'deck-context': 300,
  'visual-observation': 200,
  default: 100,
};

export interface AuthorityValue<T> {
  value: T;
  authority: AuthorityKind;
  sourceId?: string;
  at: string;
}

export type SceneStage =
  | 'WAITING_FOR_DIRECTOR'
  | 'UNDERSTANDING'
  | 'CLARIFICATION'
  | 'CONTRACT'
  | 'READY_TO_MAKE'
  | 'MAKING'
  | 'REVIEW'
  | 'APPROVED';

export interface DeckNode {
  id: string;
  title: string;
  sourcePath: string;
  pageCount: number;
  importedAt: string;
  originalSourcePath?: string;
  manifestPath?: string;
  assetCount?: number;
  occurrenceCount?: number;
}

export interface AssetOccurrenceNode {
  id: string;
  deckId: string;
  imagePath: string;
  sourceKind?: 'pdf' | 'reference' | 'generation' | 'device';
  sourceId?: string;
  page: number;
  order: number;
  sectionTitle?: string;
  sceneTitle?: string;
  bbox?: number[];
  pageSize?: number[];
  sourceSize?: number[];
  extractionMode?: 'embedded-original' | 'embedded-pixmap' | 'page-render';
  assetHash?: string;
  fallbackPage?: boolean;
}

export interface DirectorNoteNode {
  id: string;
  rawText: string;
  createdAt: string;
  updatedAt: string;
}

/** Extra visual evidence supplied with the director's words. It helps explain
 * intent, but never replaces the scene source or outranks the written note. */
export interface DirectionReferenceNode {
  id: string;
  imagePath: string;
  label: string;
  sourceKind: 'reference' | 'generation' | 'device';
  sourceId?: string;
  assetHash?: string;
  sourceSize?: number[];
  addedAt: string;
}

/** A director's next-pass note, written while looking at a specific take.
 * Attachments stay here until the contract editor assigns each one to the
 * relevant CHANGE item; the user never has to wire images into slots manually. */
export interface ReviewRequestNode {
  rawText: string;
  references: DirectionReferenceNode[];
  updatedAt: string;
  appliedAt?: string;
  summary?: string;
}

export interface InterpretationNode {
  id: string;
  restatement: string;
  sceneRole: string;
  intendedFeeling: string;
  storyPosition?: string;
  place?: string;
  timeState?: string;
  characters?: string;
  approvedAt?: string;
}

export interface ClarificationNode {
  id: string;
  question: string;
  impact: string;
  answer?: string;
  resolvedAt?: string;
}

export interface VisualDnaValues {
  palette: string;
  exposure: string;
  contrast: string;
  highlightResponse: string;
  blacks: string;
  texture: string;
  colourSeparation: string;
  mood: string;
  visualRefusals: string[];
}

export interface VisualDnaNode {
  id: string;
  values: VisualDnaValues;
  sourceReferenceIds: string[];
  signedAt?: string;
  version: number;
}

export interface DopValues {
  cameraLanguage: string;
  captureMedium: string;
  lensFeel: string;
  focalLength?: string;
  aperture?: string;
  shutterBehaviour: string;
  depthBand: string;
  lightArchitecture: string;
  movement: string;
  composition: string;
  aspectRatio: string;
}

export interface DopNode {
  id: string;
  values: DopValues;
  sourceReferenceIds: string[];
  signedAt?: string;
  version: number;
}

export type ContractAction = 'KEEP' | 'CHANGE';
export type ContractCategory =
  | 'composition'
  | 'camera'
  | 'light'
  | 'colour'
  | 'texture'
  | 'identity'
  | 'performance'
  | 'wardrobe'
  | 'place'
  | 'time'
  | 'objects'
  | 'environment';

export interface ContractItem {
  id: string;
  slot?: SlotKey;
  category: ContractCategory;
  action: ContractAction;
  value: string;
  authority: AuthorityKind;
  /** The visual references attached to this exact CHANGE. Multiple images are
   *  intentional: a face, garment or place is often only legible as a small
   *  reference set. */
  referencePaths?: string[];
  /** Legacy single-reference documents are still readable. New edits write the
   *  array above. */
  referencePath?: string;
  acceptanceTest?: string;
}

export function contractReferencePaths(item: Pick<ContractItem, 'referencePaths' | 'referencePath'>): string[] {
  return [...new Set([
    ...(Array.isArray(item.referencePaths) ? item.referencePaths : []),
    ...(item.referencePath ? [item.referencePath] : []),
  ].map(path => path.trim()).filter(Boolean))];
}

export interface ReferenceContractNode {
  id: string;
  items: ContractItem[];
  signedAt?: string;
  version: number;
}

export type PreservationMode = 'REBUILD' | 'REFERENCE_GUIDED' | 'STRICT_SWAP';

export interface MakeSettings {
  model: ModelId;
  quality: Quality;
  aspect: string;
  takes: 1 | 2 | 4;
  preservationMode: PreservationMode;
  /** Optional controls borrowed from Frame Tools; they are never workflow gates. */
  dnaTool: {
    enabled: boolean;
    source: 'FRAME_TOOLS';
    mode: 'CURRENT' | 'HJEN_PRESET';
  };
  dopTool: {
    enabled: boolean;
    source: 'FRAME_TOOLS';
  };
}

export type DriftAxis =
  | 'composition'
  | 'palette'
  | 'exposure'
  | 'lighting'
  | 'lens'
  | 'texture'
  | 'identity'
  | 'locked-content';

export interface DriftVerdict {
  axis: DriftAxis;
  score: number;
  threshold: number;
  passed: boolean;
  evidence: string;
}

export interface TakeNode {
  id: string;
  path?: string;
  status: 'QUEUED' | 'MAKING' | 'READY' | 'REJECTED' | 'APPROVED' | 'FAILED';
  model: ModelId;
  madeAt?: string;
  drift: DriftVerdict[];
  note?: string;
  changes?: Array<{ id: string; state: 'landed' | 'partial' | 'missed'; evidence: string }>;
}

export interface SceneNode {
  id: string;
  occurrence: AssetOccurrenceNode;
  stage: SceneStage;
  directorNote?: DirectorNoteNode;
  intentReferences?: DirectionReferenceNode[];
  interpretation?: InterpretationNode;
  clarification?: ClarificationNode;
  contract?: ReferenceContractNode;
  sourceRead?: EyeRead;
  slots?: FrameSlots;
  thin?: SlotKey[];
  settings: MakeSettings;
  takes: TakeNode[];
  /** Records what the director actually approved. SOURCE means the original
   * scene was accepted unchanged; no take is required or implied. */
  approval?: {
    kind: 'SOURCE' | 'TAKE';
    approvedAt: string;
    takeId?: string;
  };
  reviewRequest?: ReviewRequestNode;
  updatedAt: string;
}

export interface ReferenceProjectGraph {
  version: 1;
  id: string;
  deck: DeckNode;
  /** Optional snapshots of the Frame Tools controls used for a Make. */
  dna?: VisualDnaNode;
  dop?: DopNode;
  scenes: SceneNode[];
  activeSceneId?: string;
  updatedAt: string;
}

export interface MakeGate {
  allowed: boolean;
  blockers: string[];
}
