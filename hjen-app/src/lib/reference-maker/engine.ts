import type { Selections } from '../../types/catalog';
import { useStore } from '../../store';
import { applyDNA } from '../dna';
import { eyeRead } from '../eye/engine';
import { swapConsequence, swapPlan, swapSlots } from '../swap/engine';
import { resolveFollows } from '../swap/deps';
import { emptyDecisions, SLOT_KEYS, type FrameSlots, type Requirement, type SlotDecisions, type SlotKey } from '../swap/types';
import { contractReferencePaths } from './types';
import { refundedImageRecoveryModel } from './providerRecovery';
import type {
  AuthorityKind,
  ClarificationNode,
  ContractCategory,
  ContractItem,
  DriftAxis,
  DriftVerdict,
  InterpretationNode,
  MakeSettings,
  ReferenceContractNode,
  DirectionReferenceNode,
  TakeNode,
} from './types';

const isoNow = () => new Date().toISOString();
const SLOT_SET = new Set<string>(SLOT_KEYS);
const CATEGORY_SET = new Set<ContractCategory>([
  'composition', 'camera', 'light', 'colour', 'texture', 'identity',
  'performance', 'wardrobe', 'place', 'time', 'objects', 'environment',
]);
const AUTHORITY_SET = new Set<AuthorityKind>([
  'director-note', 'attached-reference', 'signed-decision',
  'deck-context', 'visual-observation', 'default',
]);
const CATEGORY_SLOT: Record<ContractCategory, SlotKey> = {
  composition: 'camera', camera: 'camera', light: 'light', colour: 'colour',
  texture: 'medium', identity: 'identity', performance: 'action', wardrobe: 'wardrobe',
  place: 'place', time: 'time', objects: 'objects', environment: 'place',
};

export interface UnderstandingResult {
  interpretation: InterpretationNode;
  clarification?: ClarificationNode;
  contract: ReferenceContractNode;
  preservationMode: MakeSettings['preservationMode'];
  sourceRead: Awaited<ReturnType<typeof eyeRead>>['read'];
  slots: FrameSlots;
  thin: SlotKey[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeContract(raw: any[], imagePaths = new Map<number, string>()): ContractItem[] {
  const out: ContractItem[] = [];
  for (const [index, item] of raw.entries()) {
    const action = item?.action === 'CHANGE' ? 'CHANGE' : item?.action === 'KEEP' ? 'KEEP' : null;
    const category = CATEGORY_SET.has(item?.category) ? item.category as ContractCategory : null;
    const slot = SLOT_SET.has(item?.slot) ? item.slot as SlotKey : (category ? CATEGORY_SLOT[category] : undefined);
    const value = text(item?.value);
    if (!action || !category || !slot || !value) continue;
    const authority = AUTHORITY_SET.has(item?.authority) ? item.authority as AuthorityKind : 'director-note';
    const referencePaths = [...new Set([
      ...(Array.isArray(item?.referencePaths) ? item.referencePaths.map(text) : []),
      text(item?.referencePath),
      ...(Array.isArray(item?.referenceImages)
        ? item.referenceImages.map((value: unknown) => imagePaths.get(Number(value)) || '')
        : []),
    ].filter(Boolean))];
    out.push({
      id: text(item?.id) || `${action === 'KEEP' ? 'K' : 'C'}${index + 1}`,
      slot, category, action, value, authority,
      ...(referencePaths.length ? { referencePaths } : {}),
      ...(text(item?.acceptanceTest) ? { acceptanceTest: text(item.acceptanceTest) } : {}),
    });
  }
  return out;
}

export async function understandReferenceScene(args: {
  sceneId: string;
  rawText: string;
  imagePath: string;
  intentReferences?: Array<{ imagePath: string; label: string; sourceKind: 'reference' | 'generation' | 'device' }>;
  page?: number;
  sceneTitle?: string;
}): Promise<{ ok: true; result: UnderstandingResult } | { ok: false; message: string }> {
  const eye = await eyeRead({ imagePath: args.imagePath, note: args.rawText });
  if (!eye.ok || !eye.read) return { ok: false, message: eye.message || 'The source frame could not be read.' };
  const split = await swapSlots({ imagePath: args.imagePath, read: eye.read });
  if (!split.ok || !split.slots) return { ok: false, message: split.message || 'The frame could not be separated into editable decisions.' };
  const response = await window.hjen.referenceSceneUnderstand({
    rawText: args.rawText,
    imagePath: args.imagePath,
    intentReferences: args.intentReferences,
    page: args.page,
    sceneTitle: args.sceneTitle,
    visualRead: eye.read,
    slots: split.slots,
  });
  if (!response.ok || !response.data) return { ok: false, message: response.message || 'The scene could not be understood.' };
  const raw = response.data as any;
  const intentImagePaths = new Map<number, string>((args.intentReferences ?? []).map((reference, index) => [index + 2, reference.imagePath]));
  const items = normalizeContract(Array.isArray(raw.contract) ? raw.contract : [], intentImagePaths);
  if (!items.some(item => item.action === 'KEEP') || !items.some(item => item.action === 'CHANGE')) {
    return { ok: false, message: 'The understanding must name both what survives and what visibly changes.' };
  }
  const interpretation: InterpretationNode = {
    id: `interpretation-${args.sceneId}`,
    restatement: text(raw.interpretation?.restatement),
    sceneRole: text(raw.interpretation?.sceneRole),
    intendedFeeling: text(raw.interpretation?.intendedFeeling),
    storyPosition: text(raw.interpretation?.storyPosition) || undefined,
    place: text(raw.interpretation?.place) || undefined,
    timeState: text(raw.interpretation?.timeState) || undefined,
    characters: text(raw.interpretation?.characters) || undefined,
  };
  const clarification = raw.clarification && text(raw.clarification.question) ? {
    id: `clarification-${args.sceneId}`,
    question: text(raw.clarification.question),
    impact: text(raw.clarification.impact),
  } satisfies ClarificationNode : undefined;
  const preservationMode = raw.preservationMode === 'REBUILD' || raw.preservationMode === 'REFERENCE_GUIDED'
    ? raw.preservationMode : 'STRICT_SWAP';
  return {
    ok: true,
    result: {
      interpretation,
      clarification,
      contract: { id: `contract-${args.sceneId}`, items, version: 1 },
      preservationMode,
      sourceRead: eye.read,
      slots: split.slots,
      thin: split.thin ?? [],
    },
  };
}

export async function reviseReferenceContract(args: {
  sceneId: string;
  directorNote: string;
  reviewNote: string;
  sourcePath: string;
  take?: TakeNode;
  contract: ReferenceContractNode;
  reviewReferences?: DirectionReferenceNode[];
  intentReferences?: DirectionReferenceNode[];
}): Promise<
  | { ok: true; contract: ReferenceContractNode; summary: string; preservationMode?: MakeSettings['preservationMode'] }
  | { ok: false; message: string }
> {
  const support = [...(args.reviewReferences ?? []), ...(args.intentReferences ?? [])]
    .filter((reference, index, all) => all.findIndex(item => item.imagePath === reference.imagePath) === index)
    .slice(0, 8);
  const response = await window.hjen.referenceSceneReviseContract({
    directorNote: args.directorNote,
    reviewNote: args.reviewNote,
    sourcePath: args.sourcePath,
    takePath: args.take?.path,
    currentContract: args.contract,
    drift: args.take ? { changes: args.take.changes ?? [], drift: args.take.drift ?? [], note: args.take.note } : null,
    references: support.map(reference => ({
      imagePath: reference.imagePath,
      label: reference.label,
      sourceKind: reference.sourceKind,
    })),
  });
  if (!response.ok || !response.data) return { ok: false, message: response.message || 'The contract could not be revised.' };
  const raw = response.data as any;
  let firstReferenceImage = args.take?.path ? 3 : 2;
  const imagePaths = new Map<number, string>();
  for (const reference of support) imagePaths.set(firstReferenceImage++, reference.imagePath);
  let items = normalizeContract(Array.isArray(raw.contract) ? raw.contract : [], imagePaths);
  const existingById = new Map(args.contract.items.map(item => [item.id, item]));
  items = items.map(item => {
    if (item.action !== 'CHANGE') return item;
    const existing = existingById.get(item.id);
    const referencePaths = [...new Set([
      ...(existing ? contractReferencePaths(existing) : []),
      ...contractReferencePaths(item),
    ])];
    return referencePaths.length ? { ...item, referencePaths, referencePath: undefined } : item;
  });
  if (!items.some(item => item.action === 'KEEP') || !items.some(item => item.action === 'CHANGE')) {
    return { ok: false, message: 'The revised contract must keep at least one protected decision and one visible change.' };
  }
  const preservationMode = raw.preservationMode === 'REBUILD' || raw.preservationMode === 'REFERENCE_GUIDED' || raw.preservationMode === 'STRICT_SWAP'
    ? raw.preservationMode as MakeSettings['preservationMode']
    : undefined;
  return {
    ok: true,
    contract: { ...args.contract, items, signedAt: undefined, version: args.contract.version + 1 },
    summary: text(raw.summary) || 'The review note was applied to the contract.',
    preservationMode,
  };
}

function decisionsFor(items: ContractItem[]): SlotDecisions {
  const decisions = emptyDecisions();
  for (const item of items) {
    if (item.action !== 'CHANGE') continue;
    const slot = item.slot ?? CATEGORY_SLOT[item.category];
    const refPaths = contractReferencePaths(item);
    decisions[slot] = {
      state: 'swap', value: item.value,
      ...(refPaths.length ? { refPaths, refPath: refPaths[0] } : {}),
    };
  }
  return resolveFollows(decisions);
}

async function plannedContract(slots: FrameSlots, items: ContractItem[]): Promise<{
  decisions: SlotDecisions; requirements: Requirement[];
}> {
  let decisions = decisionsFor(items);
  const consequences = await swapConsequence({ slots, decisions });
  if (consequences.ok && consequences.follows) {
    decisions = { ...decisions };
    for (const [rawSlot, proposal] of Object.entries(consequences.follows)) {
      const slot = rawSlot as SlotKey;
      if (decisions[slot]?.state === 'follow') decisions[slot] = { ...decisions[slot], proposed: proposal };
    }
  }
  let requirements: Requirement[] = items.filter(item => item.action === 'CHANGE').map((item, priority) => {
    const refPaths = contractReferencePaths(item);
    return {
      id: item.id,
      slot: item.slot ?? CATEGORY_SLOT[item.category],
      value: item.value,
      ...(refPaths.length ? { refPaths, refPath: refPaths[0] } : {}),
      test: item.acceptanceTest || '',
      priority,
    };
  });
  if (requirements.some(requirement => !requirement.test)) {
    const plan = await swapPlan({ slots, requirements });
    if (plan.ok) requirements = requirements.map(requirement => ({
      ...requirement,
      test: requirement.test || plan.tests[requirement.id] || '',
    }));
  }
  return { decisions, requirements };
}

function frameTools(settings: MakeSettings): Partial<Selections> | undefined {
  if (!settings.dnaTool.enabled && !settings.dopTool.enabled) return undefined;
  const state = useStore.getState();
  const selected = settings.dnaTool.enabled && settings.dnaTool.mode === 'HJEN_PRESET' && state.catalog
    ? applyDNA(state.catalog, state.selections)
    : state.selections;
  // Make owns these five values. The snapshot contributes only the Frame Tools
  // photographic choices; a stale Frame prompt can never enter this contract.
  const { prompt: _prompt, negative: _negative, model: _model, quality: _quality, aspect: _aspect, ...tools } = selected;
  return tools;
}

export async function makeReferenceTakes(args: {
  sceneId: string;
  sourcePath: string;
  slots: FrameSlots;
  contract: ReferenceContractNode;
  settings: MakeSettings;
  onTake?: (take: TakeNode, index: number) => void;
}): Promise<TakeNode[]> {
  const { decisions, requirements } = await plannedContract(args.slots, args.contract.items);
  if (!requirements.length) throw new Error('The contract has no visible CHANGE to make.');
  const tools = frameTools(args.settings);
  const count = args.settings.takes;
  const takes: TakeNode[] = [];
  // Once OpenAI explicitly refunds an unavailable-provider failure, keep the
  // rest of this user-requested batch on the recovered provider. Otherwise a
  // 2/4-take batch wastes ~30 seconds rediscovering the same outage per take.
  let batchModel = args.settings.model;
  // Send one take at a time. Each request can carry several visual references;
  // parallel base64 uploads used to saturate the renderer/network process and
  // leave both takes at MAKING 0/N even though neither reached the server.
  for (let index = 0; index < count; index++) {
    let take: TakeNode = {
      id: `${args.sceneId}-take-${Date.now().toString(36)}-${index + 1}`,
      status: 'MAKING', model: batchModel, drift: [],
    };
    args.onTake?.(take, index);
    const runTake = (model: MakeSettings['model'], recoveryId: string) => useStore.getState().makeSwapFrame({
      recoveryId,
      generationPolicy: 'single-pass',
      sourcePath: args.sourcePath,
      slots: args.slots,
      decisions,
      requirements,
      quality: args.settings.quality,
      aspect: args.settings.aspect,
      model,
      index,
      preserveMode: args.settings.preservationMode === 'STRICT_SWAP' ? 'full' : 'neighbourhood',
      frameTools: tools,
      onRound: info => {
        if (!info.takePath) return;
        take = { ...take, path: info.takePath, note: info.note };
        args.onTake?.(take, index);
      },
    });

    let result = await runTake(batchModel, take.id);
    const recoveryModel = !result.ok ? refundedImageRecoveryModel(batchModel, result.message) : null;
    if (recoveryModel) {
      // The OpenAI door explicitly confirmed: no image, no charge. Keep the same
      // Take node and requested count, but recover it through Google's independent
      // image provider. The model recorded on the take remains honest provenance.
      take = { ...take, model: recoveryModel, note: 'OpenAI was unavailable and refunded. Recovering this same take with Nano Banana Pro…' };
      args.onTake?.(take, index);
      batchModel = recoveryModel;
      const firstFailure = result.message;
      result = await runTake(recoveryModel, `${take.id}-nano-recovery`);
      if (!result.ok) result = { ...result, message: `OpenAI was refunded (${firstFailure}) Nano Banana Pro also failed: ${result.message || 'unknown provider error'}` };
    }
    take = result.ok && result.path
      ? { ...take, path: result.path, status: 'READY', madeAt: isoNow(), note: result.unresolved?.length ? `${result.unresolved.length} change(s) still need attention.` : undefined }
      : { ...take, status: 'FAILED', note: result.message || 'Make failed.' };
    args.onTake?.(take, index);
    takes.push(take);
  }
  return takes;
}

const DRIFT_AXES = new Set<DriftAxis>([
  'composition', 'palette', 'exposure', 'lighting', 'lens', 'texture', 'identity', 'locked-content',
]);

function requiredDriftAxes(items: ContractItem[]): Set<DriftAxis> {
  const axes = new Set<DriftAxis>();
  for (const item of items) {
    if (item.action !== 'KEEP') continue;
    if (item.category === 'composition') axes.add('composition');
    else if (item.category === 'camera') { axes.add('composition'); axes.add('lens'); }
    else if (item.category === 'light') axes.add('lighting');
    else if (item.category === 'colour') axes.add('palette');
    else if (item.category === 'texture') axes.add('texture');
    else if (item.category === 'identity') axes.add('identity');
    else axes.add('locked-content');
  }
  return axes;
}

export async function reviewReferenceTake(args: {
  sourcePath: string;
  take: TakeNode;
  contract: ReferenceContractNode;
  dna?: unknown;
  dop?: unknown;
}): Promise<TakeNode> {
  if (!args.take.path) return { ...args.take, status: 'FAILED', note: 'The take has no saved image.' };
  const response = await window.hjen.referenceSceneDrift({
    sourcePath: args.sourcePath,
    takePath: args.take.path,
    keepItems: args.contract.items.filter(item => item.action === 'KEEP'),
    changeItems: args.contract.items.filter(item => item.action === 'CHANGE'),
    dna: args.dna,
    dop: args.dop,
  });
  if (!response.ok || !response.data) {
    return { ...args.take, status: 'REJECTED', note: response.message || 'Drift review did not run; the take was not auto-approved.' };
  }
  const raw = response.data as any;
  const drift: DriftVerdict[] = (Array.isArray(raw.drift) ? raw.drift : []).flatMap((item: any) => {
    if (!DRIFT_AXES.has(item?.axis)) return [];
    const score = Math.max(0, Math.min(100, Number(item.score) || 0));
    const threshold = Math.max(0, Math.min(100, Number(item.threshold) || 85));
    return [{ axis: item.axis, score, threshold, passed: Boolean(item.passed) && score >= threshold, evidence: text(item.evidence) }];
  });
  const changes = (Array.isArray(raw.changes) ? raw.changes : []).flatMap((item: any) => {
    const state = item?.state === 'landed' || item?.state === 'partial' || item?.state === 'missed' ? item.state : null;
    return state ? [{ id: text(item.id), state, evidence: text(item.evidence) }] : [];
  });
  // A sparse judge response must never auto-approve a take. Every protected
  // axis and every requested change needs an explicit verdict; otherwise the
  // review is incomplete and the safe state is REJECTED.
  const requiredAxes = requiredDriftAxes(args.contract.items);
  const passedAxes = new Set(drift.filter(item => item.passed).map(item => item.axis));
  const expectedChanges = new Set(args.contract.items.filter(item => item.action === 'CHANGE').map(item => item.id));
  const landedChanges = new Set(changes.filter((item: any) => item.state === 'landed').map((item: any) => item.id));
  const ready = requiredAxes.size > 0
    && [...requiredAxes].every(axis => passedAxes.has(axis))
    && expectedChanges.size > 0
    && [...expectedChanges].every(id => landedChanges.has(id));
  return {
    ...args.take,
    drift,
    changes,
    status: ready ? 'READY' : 'REJECTED',
    note: ready ? undefined : 'Held back because a requested change missed or a locked visual axis drifted.',
  };
}
