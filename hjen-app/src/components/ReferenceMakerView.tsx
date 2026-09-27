import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import type { ModelId, Quality } from '../types/catalog';
import { createReferenceGraph, makeGate, modelFit, validateContract } from '../lib/reference-maker/graph';
import { loadReferenceGraph, saveReferenceGraph } from '../lib/reference-maker/doc';
import { makeReferenceTakes, reviewReferenceTake, reviseReferenceContract, understandReferenceScene } from '../lib/reference-maker/engine';
import { MAX_SLOT_REFS } from '../lib/swap/refs';
import { contractReferencePaths } from '../lib/reference-maker/types';
import type {
  AssetOccurrenceNode,
  ContractAction,
  ContractCategory,
  ContractItem,
  DeckNode,
  DirectionReferenceNode,
  ReferenceProjectGraph,
  SceneNode,
  TakeNode,
} from '../lib/reference-maker/types';
import type { ReferencesData } from '../types/preprod';
import { hjenFileUrl } from '../lib/theme/apply';
import ref01 from '../assets/reference-maker/snd96/R01_P01_01_x6.png';
import ref02 from '../assets/reference-maker/snd96/R02_P01_02_x9.png';
import ref03 from '../assets/reference-maker/snd96/R03_P01_03_x10.png';
import { ImagePreviewDialog, type ImagePreviewItem } from './ImagePreviewDialog';
import '../styles/reference-maker.css';

type Step = 'Direction' | 'Understanding' | 'Contract' | 'Make' | 'Review';
type ImportState = 'loading' | 'idle' | 'extracting' | 'materializing-sample' | 'ready' | 'error';
type Manifest = { deck: DeckNode; occurrences: AssetOccurrenceNode[] };
type SceneTaskKind = 'understanding' | 'making' | 'reviewing' | 'revising';
type SceneTask = { kind: SceneTaskKind; completed: number; total: number; completedIds?: string[] };
type SourceKind = 'references' | 'generations' | 'device';
type SourceChoice = {
  path: string;
  thumb?: string;
  label: string;
  source: SourceKind;
  sourceId?: string;
  assetHash?: string;
  sourceSize?: number[];
};
type PickerTarget = { kind: 'scene' } | { kind: 'direction'; sceneId: string } | { kind: 'contract'; sceneId: string; itemId: string } | { kind: 'review'; sceneId: string };
type PickerResult = { message?: string; completedPaths: string[] };

const STEPS: Step[] = ['Direction', 'Understanding', 'Contract', 'Make', 'Review'];
const AUTHORITY = ['Your raw note', 'Attached references', 'Signed decisions', 'Deck title + placement', 'Visual observation', 'HJEN defaults'];
const CATEGORIES: ContractCategory[] = ['composition', 'camera', 'light', 'colour', 'texture', 'identity', 'performance', 'wardrobe', 'place', 'time', 'objects', 'environment'];
const MODELS: Array<{ id: ModelId; name: string; provider: string; fit: string; cues: string }> = [
  { id: 'GPT_IMAGE_2', name: 'GPT Image 2', provider: 'OpenAI', fit: 'Precision edit', cues: 'Multi-reference · local change · strong source hold' },
  { id: 'NANO_BANANA_PRO', name: 'Nano Banana Pro', provider: 'Google', fit: 'Reference synthesis', cues: 'Fast visual read · context fusion · broad rework' },
];

const isoNow = () => new Date().toISOString();

function imageUrl(path?: string): string {
  if (!path) return '';
  if (/^(data:|blob:|https?:)/.test(path) || path.startsWith('/assets/') || path.startsWith('/src/')) return path;
  return hjenFileUrl(path);
}

function sceneNumber(index: number): string {
  return String(index + 1).padStart(2, '0');
}

function sceneTitle(scene: SceneNode, index: number): string {
  return scene.occurrence.sceneTitle?.trim() || scene.occurrence.sectionTitle?.trim() || `Scene ${sceneNumber(index)}`;
}

function sceneOrigin(scene: SceneNode): string {
  if (scene.occurrence.page > 0) return 'PDF';
  const origin = scene.occurrence.sectionTitle?.trim();
  if (origin && /^generations?$/i.test(origin)) return 'MADE IMAGE';
  return origin || 'REFERENCE';
}

function sourceKindCopy(source: SourceKind | DirectionReferenceNode['sourceKind']): string {
  if (source === 'generation' || source === 'generations') return 'made image';
  if (source === 'reference' || source === 'references') return 'reference';
  return 'device';
}

function sceneLocator(scene: SceneNode): string {
  return scene.occurrence.page > 0
    ? `Page ${scene.occurrence.page} · image ${scene.occurrence.order}`
    : `${sceneOrigin(scene)} · added scene`;
}

function taskLabel(task: SceneTask): string {
  if (task.kind === 'understanding') return 'Reading';
  if (task.kind === 'revising') return 'Revising contract';
  if (task.kind === 'reviewing') return task.total > 1 ? `Reviewing ${task.completed}/${task.total}` : 'Reviewing';
  return task.total > 1 ? `Making ${task.completed}/${task.total}` : 'Making';
}

function sceneStatus(scene: SceneNode, task?: SceneTask, hasError = false): string {
  if (hasError) return 'Needs attention';
  if (task) return taskLabel(task);
  if (scene.stage === 'APPROVED') return 'Approved';
  if (scene.stage === 'REVIEW') {
    if (scene.takes.some(take => take.status === 'READY' || take.status === 'APPROVED')) return 'Takes ready';
    return scene.takes.some(take => take.status === 'FAILED') ? 'Make failed' : 'Needs attention';
  }
  if (scene.stage === 'MAKING') return 'Make interrupted';
  if (scene.stage === 'READY_TO_MAKE') return 'Ready to make';
  if (scene.stage === 'CONTRACT') return 'Contract';
  if (scene.stage === 'CLARIFICATION') return 'Needs answer';
  if (scene.stage === 'UNDERSTANDING') return 'Understanding';
  return scene.directorNote?.rawText.trim() ? 'Direction saved' : 'Needs direction';
}

type SceneReelState = 'untouched' | 'working' | 'ready' | 'action' | 'complete' | 'error';

/** The reel is a return-to-work surface, not just an index. A scene becomes
 * coloured the moment the director has touched it; idle pipeline stages then
 * read as ACTION because they are waiting for the next human decision. */
function sceneReelState(scene: SceneNode, task?: SceneTask, hasError = false): SceneReelState {
  if (hasError) return 'error';
  if (task) return 'working';
  if (scene.stage === 'APPROVED' || scene.takes.some(take => take.status === 'APPROVED')) return 'complete';
  if (scene.stage === 'REVIEW') {
    return scene.takes.some(take => take.status === 'READY' || take.status === 'APPROVED') ? 'ready' : 'error';
  }
  const touched = Boolean(
    scene.directorNote?.rawText.trim()
    || scene.intentReferences?.length
    || scene.interpretation
    || scene.clarification
    || scene.contract
    || scene.takes.length
    || scene.stage !== 'WAITING_FOR_DIRECTOR',
  );
  return touched ? 'action' : 'untouched';
}

function maxStep(scene: SceneNode): number {
  if (scene.stage === 'APPROVED' || scene.stage === 'REVIEW') return 4;
  if (scene.stage === 'MAKING' || scene.stage === 'READY_TO_MAKE') return 3;
  if (scene.stage === 'CONTRACT') return 2;
  if (scene.stage === 'UNDERSTANDING' || scene.stage === 'CLARIFICATION') return 1;
  return 0;
}

function originalIsApproved(scene: Pick<SceneNode, 'stage' | 'approval'>): boolean {
  return scene.stage === 'APPROVED' && scene.approval?.kind === 'SOURCE';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const parts: string[] = [];
  const chunkSize = 32768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return btoa(parts.join(''));
}

function sampleManifest(localPaths: string[]): Manifest {
  const importedAt = isoNow();
  const deck: DeckNode = {
    id: 'deck-snd96-sample',
    title: 'SND96 sample deck',
    sourcePath: 'Built-in sample',
    pageCount: 1,
    assetCount: 3,
    occurrenceCount: 3,
    importedAt,
  };
  return {
    deck,
    occurrences: localPaths.map((imagePath, index) => ({
      id: `snd96-sample-${index + 1}`,
      deckId: deck.id,
      imagePath,
      page: 1,
      order: index + 1,
      sectionTitle: 'SND96 SAMPLE',
      sceneTitle: ['Boarding', 'Departure angle', 'Business Class'][index],
    })),
  };
}

async function reviewRecoveredScene(graph: ReferenceProjectGraph, scene: SceneNode): Promise<SceneNode> {
  if (!scene.contract) {
    return {
      ...scene,
      stage: 'READY_TO_MAKE',
      takes: scene.takes.map(take => take.status === 'QUEUED'
        ? { ...take, status: 'FAILED', note: 'The saved take could not be reviewed because its contract is missing.' }
        : take),
      updatedAt: isoNow(),
    };
  }
  const takes = await Promise.all(scene.takes.map(async take => {
    if (take.status !== 'QUEUED' || !take.path) return take;
    try {
      return await reviewReferenceTake({
        sourcePath: scene.occurrence.imagePath,
        take,
        contract: scene.contract!,
        dna: graph.dna,
        dop: graph.dop,
      });
    } catch (cause) {
      return {
        ...take,
        status: 'REJECTED' as const,
        note: cause instanceof Error
          ? `The saved image was recovered, but drift review could not finish: ${cause.message}`
          : 'The saved image was recovered, but drift review could not finish.',
      };
    }
  }));
  return { ...scene, stage: 'REVIEW', takes, updatedAt: isoNow() };
}

export function ReferenceMakerView() {
  const setActiveView = useStore(s => s.setActiveView);
  const activeProjectId = useStore(s => s.activeProjectId);
  const applyHjenDna = useStore(s => s.applyHJENDNA);
  const setDopOpen = useStore(s => s.setDopOpen);
  const [graph, setGraph] = useState<ReferenceProjectGraph | null>(null);
  const [importState, setImportState] = useState<ImportState>('loading');
  const [error, setError] = useState('');
  const [sceneIndex, setSceneIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [sceneTasks, setSceneTasks] = useState<Record<string, SceneTask>>({});
  const [sceneErrors, setSceneErrors] = useState<Record<string, string>>({});
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreviewItem | null>(null);
  const [deleteSceneId, setDeleteSceneId] = useState<string | null>(null);
  const activeSceneIdRef = useRef<string | null>(null);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setSceneIndex(0);
    setStepIndex(0);
    setError('');
    setSceneTasks({});
    setSceneErrors({});
    setPickerTarget(null);
    setImagePreview(null);
    setDeleteSceneId(null);
    if (!activeProjectId) {
      setImportState('idle');
      return () => { cancelled = true; };
    }
    setImportState('loading');
    void loadReferenceGraph(activeProjectId).then(saved => {
      if (cancelled) return;
      setGraph(saved);
      setImportState(saved ? 'ready' : 'idle');
      if (saved?.activeSceneId) {
        const index = saved.scenes.findIndex(scene => scene.id === saved.activeSceneId);
        if (index >= 0) {
          setSceneIndex(index);
          setStepIndex(maxStep(saved.scenes[index]));
          activeSceneIdRef.current = saved.scenes[index].id;
        }
      } else {
        activeSceneIdRef.current = saved?.scenes[0]?.id ?? null;
      }
      if (!saved) return;

      const interruptedScenes = saved.scenes.filter(scene =>
        !originalIsApproved(scene) && scene.takes.some(take => take.status === 'QUEUED' && Boolean(take.path)),
      );
      const normalizedAnInterruption = saved.scenes.some(scene => scene.takes.some(take =>
        take.note?.startsWith('The app was interrupted')
        || take.note?.startsWith('Recovered after the app was interrupted'),
      ));
      if (!interruptedScenes.length) {
        if (normalizedAnInterruption) void saveReferenceGraph(activeProjectId, saved);
        return;
      }

      const recoveringIds = new Set(interruptedScenes.map(scene => scene.id));
      setSceneTasks(current => ({
        ...current,
        ...Object.fromEntries(interruptedScenes.map(scene => {
          const total = scene.takes.filter(take => take.status === 'QUEUED' && take.path).length;
          return [scene.id, { kind: 'reviewing' as const, completed: 0, total: Math.max(1, total), completedIds: [] }];
        })),
      }));

      void Promise.all(interruptedScenes.map(scene => reviewRecoveredScene(saved, scene))).then(recovered => {
        if (cancelled) return;
        const byId = new Map(recovered.map(scene => [scene.id, scene]));
        setGraph(current => {
          if (!current) return current;
          const next: ReferenceProjectGraph = {
            ...current,
            scenes: current.scenes.map(scene => {
              if (originalIsApproved(scene)) return scene;
              const result = byId.get(scene.id);
              return result ? { ...scene, stage: result.stage, takes: result.takes, updatedAt: result.updatedAt } : scene;
            }),
            updatedAt: isoNow(),
          };
          void saveReferenceGraph(activeProjectId, next);
          return next;
        });
        setSceneTasks(current => {
          const next = { ...current };
          recoveringIds.forEach(id => { delete next[id]; });
          return next;
        });
      });
    });
    return () => { cancelled = true; };
  }, [activeProjectId]);

  useEffect(() => {
    if (!deleteSceneId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDeleteSceneId(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [deleteSceneId]);

  const persist = (next: ReferenceProjectGraph) => {
    if (!activeProjectId) return;
    const projectId = activeProjectId;
    persistQueueRef.current = persistQueueRef.current
      .then(async () => { await saveReferenceGraph(projectId, next); })
      .catch(() => undefined);
  };

  const updateGraph = (change: (current: ReferenceProjectGraph) => ReferenceProjectGraph) => {
    setGraph(current => {
      if (!current) return current;
      const next = { ...change(current), updatedAt: isoNow() };
      persist(next);
      return next;
    });
  };

  const updateScene = (sceneId: string, change: (scene: SceneNode) => SceneNode) => {
    updateGraph(current => ({
      ...current,
      scenes: current.scenes.map(scene => scene.id === sceneId ? { ...change(scene), updatedAt: isoNow() } : scene),
    }));
  };

  const setSceneTask = (sceneId: string, task: SceneTask | null) => setSceneTasks(current => {
    const next = { ...current };
    if (task) next[sceneId] = task;
    else delete next[sceneId];
    return next;
  });

  const setSceneError = (sceneId: string, message: string) => setSceneErrors(current => {
    const next = { ...current };
    if (message) next[sceneId] = message;
    else delete next[sceneId];
    return next;
  });

  const installManifest = (manifest: Manifest, projectId: string) => {
    const next = createReferenceGraph({ projectId, deck: manifest.deck, occurrences: manifest.occurrences });
    setGraph(next);
    setImportState('ready');
    setSceneIndex(0);
    setStepIndex(0);
    setSelectedTakeId(null);
    setError('');
    activeSceneIdRef.current = next.scenes[0]?.id ?? null;
    if (activeProjectId) void saveReferenceGraph(activeProjectId, next);
  };

  const openPdf = async () => {
    if (!activeProjectId) {
      setError('Open a project first, then bring its reference deck here.');
      setImportState('error');
      return;
    }
    setImportState('extracting');
    setError('');
    try {
      const response = await window.hjen.referenceDeckImport({ projectId: activeProjectId });
      if (!response.ok || !response.manifest) {
        if (response.reason === 'cancelled') {
          setImportState(graph ? 'ready' : 'idle');
          return;
        }
        throw new Error(response.message || 'The deck could not be extracted.');
      }
      installManifest(response.manifest, activeProjectId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The deck could not be extracted.');
      setImportState('error');
    }
  };

  const openSample = async () => {
    setImportState('materializing-sample');
    setError('');
    try {
      const localPaths = await Promise.all([ref01, ref02, ref03].map(async (url, index) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Sample frame ${index + 1} could not be opened.`);
        const base64 = arrayBufferToBase64(await response.arrayBuffer());
        const saved = await window.hjen.saveImageBase64({
          base64,
          fileName: `snd96_sample_${index + 1}`,
          subfolder: '_reference_maker/sample',
        });
        if (!saved.ok) throw new Error(saved.message || `Sample frame ${index + 1} could not be saved.`);
        return saved.path;
      }));
      installManifest(sampleManifest(localPaths), activeProjectId ?? 'reference-maker-sample');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The sample reel could not be prepared.');
      setImportState('error');
    }
  };

  if (!graph || graph.scenes.length === 0 || importState !== 'ready') {
    return (
      <ImportShell
        state={importState}
        error={error}
        projectReady={Boolean(activeProjectId)}
        emptyDeck={Boolean(graph && graph.scenes.length === 0)}
        onBack={() => setActiveView('studio')}
        onOpen={() => void openPdf()}
        onSample={() => void openSample()}
      />
    );
  }

  const safeIndex = Math.min(sceneIndex, graph.scenes.length - 1);
  const scene = graph.scenes[safeIndex];
  const activeTask = sceneTasks[scene.id];
  const busy = activeTask?.kind ?? null;
  const sceneError = sceneErrors[scene.id] ?? '';
  const step = STEPS[Math.min(stepIndex, maxStep(scene))];
  const title = sceneTitle(scene, safeIndex);
  const selectedModel = MODELS.find(model => model.id === scene.settings.model) ?? MODELS[0];
  const gate = makeGate(graph, scene);
  const modelFits = {
    GPT_IMAGE_2: modelFit('GPT_IMAGE_2', scene),
    NANO_BANANA_PRO: modelFit('NANO_BANANA_PRO', scene),
  };
  const sourceApproved = originalIsApproved(scene);
  const selectedTake = sourceApproved
    ? undefined
    : scene.takes.find(take => take.id === selectedTakeId) ?? scene.takes.find(take => take.status === 'READY') ?? scene.takes[0];
  const completedScenes = graph.scenes.filter(item => item.stage === 'APPROVED').length;
  const runningScenes = Object.keys(sceneTasks).length;

  const setNote = (rawText: string) => updateScene(scene.id, current => ({
    ...current,
    directorNote: current.directorNote
      ? { ...current.directorNote, rawText, updatedAt: isoNow() }
      : { id: `note-${current.id}`, rawText, createdAt: isoNow(), updatedAt: isoNow() },
  }));

  const selectScene = (index: number) => {
    const next = graph.scenes[index];
    activeSceneIdRef.current = next.id;
    setSceneIndex(index);
    setStepIndex(maxStep(next));
    setSelectedTakeId(null);
    updateGraph(current => ({ ...current, activeSceneId: next.id }));
  };

  const addScenes = (choices: SourceChoice[]) => {
    const existing = new Set(graph.scenes.map(item => item.occurrence.imagePath));
    const fresh = choices.filter(choice => !existing.has(choice.path));
    if (!fresh.length) return;
    const stamp = Date.now().toString(36);
    const occurrences: AssetOccurrenceNode[] = fresh.map((choice, index) => ({
      id: `added-${stamp}-${index + 1}`,
      deckId: graph.deck.id,
      imagePath: choice.path,
      sourceKind: choice.source === 'references' ? 'reference' : choice.source === 'generations' ? 'generation' : 'device',
      sourceId: choice.sourceId,
      page: 0,
      order: graph.scenes.length + index + 1,
      sectionTitle: sourceKindCopy(choice.source).toUpperCase(),
      sceneTitle: choice.label,
      assetHash: choice.assetHash,
      sourceSize: choice.sourceSize,
    }));
    const additions = createReferenceGraph({ projectId: graph.id, deck: graph.deck, occurrences }).scenes;
    updateGraph(current => ({
      ...current,
      deck: {
        ...current.deck,
        assetCount: (current.deck.assetCount ?? current.scenes.length) + additions.length,
        occurrenceCount: current.scenes.length + additions.length,
      },
      scenes: [...current.scenes, ...additions],
    }));
  };

  const acceptSources = async (choices: SourceChoice[]): Promise<PickerResult> => {
    const target = pickerTarget;
    if (!target || choices.length === 0) return { completedPaths: [] };
    if (!activeProjectId) {
      return { message: 'Open a project before importing a durable scene source.', completedPaths: [] };
    }
    const imported = await Promise.all(choices.map(async choice => {
      try {
        const result = await window.hjen.referenceSceneImport({
          projectId: activeProjectId,
          sourcePath: choice.path,
          sourceKind: choice.source === 'references' ? 'reference' : choice.source === 'generations' ? 'generation' : 'device',
          sourceId: choice.sourceId,
          name: choice.label,
        });
        if (!result.ok || !result.asset) return { choice, message: result.message || 'The source could not be copied.' };
        return {
          choice,
          durable: {
            ...choice,
            path: result.asset.imagePath,
            label: result.asset.sourceName || choice.label,
            sourceId: result.asset.sourceId || choice.sourceId,
            assetHash: result.asset.assetHash,
            sourceSize: result.asset.sourceSize,
          } satisfies SourceChoice,
        };
      } catch (cause) {
        return { choice, message: cause instanceof Error ? cause.message : 'The source could not be copied.' };
      }
    }));
    const durable = imported.flatMap(item => item.durable ? [item.durable] : []);
    const completedPaths = imported.flatMap(item => item.durable ? [item.choice.path] : []);
    const failures = imported.filter(item => !item.durable);
    if (target.kind === 'scene') {
      if (durable.length) addScenes(durable);
    } else if (target.kind === 'direction' && durable.length) {
      updateScene(target.sceneId, current => {
        const existing = current.intentReferences ?? [];
        const existingPaths = new Set(existing.map(reference => reference.imagePath));
        const additions: DirectionReferenceNode[] = durable
          .filter(choice => !existingPaths.has(choice.path))
          .map((choice, index) => ({
            id: `intent-${Date.now().toString(36)}-${index + 1}`,
            imagePath: choice.path,
            label: choice.label,
            sourceKind: choice.source === 'references' ? 'reference' : choice.source === 'generations' ? 'generation' : 'device',
            sourceId: choice.sourceId,
            assetHash: choice.assetHash,
            sourceSize: choice.sourceSize,
            addedAt: isoNow(),
          }));
        return { ...current, intentReferences: [...existing, ...additions] };
      });
    } else if (target.kind === 'contract' && durable.length) {
      updateScene(target.sceneId, current => ({
        ...current,
        contract: current.contract ? {
          ...current.contract,
          signedAt: undefined,
          items: current.contract.items.map(item => {
            if (item.id !== target.itemId) return item;
            const referencePaths = [...new Set([...contractReferencePaths(item), ...durable.map(choice => choice.path)])];
            return { ...item, referencePaths, referencePath: undefined };
          }),
        } : current.contract,
      }));
    } else if (target.kind === 'review' && durable.length) {
      updateScene(target.sceneId, current => {
        const request = current.reviewRequest ?? { rawText: '', references: [], updatedAt: isoNow() };
        const existingPaths = new Set(request.references.map(reference => reference.imagePath));
        const additions: DirectionReferenceNode[] = durable
          .filter(choice => !existingPaths.has(choice.path))
          .map((choice, index) => ({
            id: `review-ref-${Date.now().toString(36)}-${index + 1}`,
            imagePath: choice.path,
            label: choice.label,
            sourceKind: choice.source === 'references' ? 'reference' : choice.source === 'generations' ? 'generation' : 'device',
            sourceId: choice.sourceId,
            assetHash: choice.assetHash,
            sourceSize: choice.sourceSize,
            addedAt: isoNow(),
          }));
        return {
          ...current,
          reviewRequest: { ...request, references: [...request.references, ...additions], updatedAt: isoNow(), appliedAt: undefined, summary: undefined },
        };
      });
    }
    if (failures.length) {
      const message = durable.length
        ? `${durable.length} source${durable.length === 1 ? '' : 's'} imported. ${failures.length} could not be copied into Reference Maker.`
        : failures[0].message || 'The selected source could not be copied into Reference Maker.';
      setSceneError(target.kind === 'scene' ? scene.id : target.sceneId, message);
      return { message, completedPaths };
    }
    setSceneError(target.kind === 'scene' ? scene.id : target.sceneId, '');
    setPickerTarget(null);
    return { completedPaths };
  };

  const buildUnderstanding = async () => {
    const rawText = scene.directorNote?.rawText.trim() ?? '';
    if (!rawText) return;
    const sceneId = scene.id;
    setSceneTask(sceneId, { kind: 'understanding', completed: 0, total: 1 });
    setSceneError(sceneId, '');
    updateScene(scene.id, current => ({ ...current, stage: 'UNDERSTANDING' }));
    try {
      const result = await understandReferenceScene({
        sceneId,
        rawText,
        imagePath: scene.occurrence.imagePath,
        intentReferences: (scene.intentReferences ?? []).map(reference => ({
          imagePath: reference.imagePath,
          label: reference.label,
          sourceKind: reference.sourceKind,
        })),
        page: scene.occurrence.page,
        sceneTitle: title,
      });
      if (!result.ok) {
        setSceneError(sceneId, result.message);
        updateScene(sceneId, current => ({ ...current, stage: 'WAITING_FOR_DIRECTOR' }));
        return;
      }
      updateScene(sceneId, current => ({
        ...current,
        stage: result.result.clarification ? 'CLARIFICATION' : 'UNDERSTANDING',
        interpretation: result.result.interpretation,
        clarification: result.result.clarification,
        contract: result.result.contract,
        sourceRead: result.result.sourceRead,
        slots: result.result.slots,
        thin: result.result.thin,
        settings: { ...current.settings, preservationMode: result.result.preservationMode },
      }));
      if (activeSceneIdRef.current === sceneId) setStepIndex(1);
    } catch (cause) {
      setSceneError(sceneId, cause instanceof Error ? cause.message : 'The scene could not be understood.');
      updateScene(sceneId, current => ({ ...current, stage: 'WAITING_FOR_DIRECTOR' }));
    } finally {
      setSceneTask(sceneId, null);
    }
  };

  const approveUnderstanding = () => {
    if (!scene.interpretation || (scene.clarification && !scene.clarification.answer?.trim())) return;
    updateScene(scene.id, current => ({
      ...current,
      stage: 'CONTRACT',
      interpretation: current.interpretation ? { ...current.interpretation, approvedAt: isoNow() } : current.interpretation,
      clarification: current.clarification ? { ...current.clarification, resolvedAt: isoNow() } : current.clarification,
    }));
    setStepIndex(2);
  };

  const editContract = (itemId: string, patch: Partial<ContractItem>) => updateScene(scene.id, current => ({
    ...current,
    contract: current.contract ? {
      ...current.contract,
      signedAt: undefined,
      items: current.contract.items.map(item => item.id === itemId ? { ...item, ...patch } : item),
    } : current.contract,
  }));

  const addContractItem = (action: ContractAction) => updateScene(scene.id, current => ({
    ...current,
    contract: current.contract ? {
      ...current.contract,
      signedAt: undefined,
      items: [...current.contract.items, {
        id: `${action === 'KEEP' ? 'K' : 'C'}-${Date.now().toString(36)}`,
        category: 'composition',
        action,
        value: '',
        authority: 'director-note',
        ...(action === 'CHANGE' ? { acceptanceTest: '' } : {}),
      }],
    } : current.contract,
  }));

  const removeContractItem = (itemId: string) => updateScene(scene.id, current => ({
    ...current,
    contract: current.contract ? { ...current.contract, signedAt: undefined, items: current.contract.items.filter(item => item.id !== itemId) } : current.contract,
  }));

  const signContract = () => {
    if (!scene.contract) return;
    const issues = validateContract(scene.contract.items);
    if (issues.length) {
      setSceneError(scene.id, issues[0]);
      return;
    }
    setSceneError(scene.id, '');
    updateScene(scene.id, current => ({
      ...current,
      stage: 'READY_TO_MAKE',
      contract: current.contract ? { ...current.contract, signedAt: isoNow(), version: current.contract.version + 1 } : current.contract,
    }));
    setStepIndex(3);
  };

  const makeTakes = async () => {
    if (!scene.contract || !scene.slots || !gate.allowed) return;
    const sceneId = scene.id;
    const sceneSnapshot = scene;
    const total = scene.settings.takes;
    setSceneTask(sceneId, { kind: 'making', completed: 0, total, completedIds: [] });
    setSceneError(sceneId, '');
    updateScene(sceneId, current => ({ ...current, stage: 'MAKING', takes: [] }));
    try {
      const takes = await makeReferenceTakes({
        sceneId,
        sourcePath: sceneSnapshot.occurrence.imagePath,
        slots: sceneSnapshot.slots!,
        contract: sceneSnapshot.contract!,
        settings: sceneSnapshot.settings,
        onTake: take => {
          updateScene(sceneId, current => originalIsApproved(current) ? current : {
            ...current,
            takes: [...current.takes.filter(item => item.id !== take.id), take],
          });
          if (take.status === 'READY' || take.status === 'FAILED') {
            setSceneTasks(current => {
              const task = current[sceneId];
              if (!task || task.completedIds?.includes(take.id)) return current;
              const completedIds = [...(task.completedIds ?? []), take.id];
              return { ...current, [sceneId]: { ...task, completed: completedIds.length, completedIds } };
            });
          }
        },
      });
      const reviewable = takes.filter(take => take.status === 'READY');
      // A finished image belongs in Review immediately. Drift audit is useful
      // metadata, not a curtain that may hide a paid result for another minute
      // (or forever when the checker loses its connection).
      const checking = takes.map(take => take.status === 'READY'
        ? { ...take, status: 'QUEUED' as const, note: 'Image saved. Contract review is running in the background.' }
        : take);
      updateScene(sceneId, current => originalIsApproved(current) ? current : { ...current, stage: 'REVIEW', takes: checking });
      if (activeSceneIdRef.current === sceneId) {
        setSelectedTakeId(checking.find(take => take.path)?.id ?? checking[0]?.id ?? null);
        setStepIndex(4);
      }
      setSceneTask(sceneId, { kind: 'reviewing', completed: 0, total: Math.max(reviewable.length, 1), completedIds: [] });
      const reviewed = await Promise.all(takes.map(async take => {
        if (take.status !== 'READY') return take;
        const result = await reviewReferenceTake({ sourcePath: sceneSnapshot.occurrence.imagePath, take, contract: sceneSnapshot.contract!, dna: graph.dna, dop: graph.dop });
        setSceneTasks(current => {
          const task = current[sceneId];
          if (!task || task.completedIds?.includes(take.id)) return current;
          const completedIds = [...(task.completedIds ?? []), take.id];
          return { ...current, [sceneId]: { ...task, completed: completedIds.length, completedIds } };
        });
        return result;
      }));
      updateScene(sceneId, current => originalIsApproved(current) ? current : { ...current, stage: 'REVIEW', takes: reviewed });
      if (activeSceneIdRef.current === sceneId) {
        setSelectedTakeId(reviewed.find(take => take.status === 'READY')?.id ?? reviewed[0]?.id ?? null);
        setStepIndex(4);
      }
    } catch (cause) {
      setSceneError(sceneId, cause instanceof Error ? cause.message : 'The take could not be made.');
      updateScene(sceneId, current => originalIsApproved(current) ? current : { ...current, stage: 'READY_TO_MAKE' });
    } finally {
      setSceneTask(sceneId, null);
    }
  };

  const reviseContractFromReview = async () => {
    const reviewNote = scene.reviewRequest?.rawText.trim() ?? '';
    if (!reviewNote || !scene.contract) return;
    const sceneId = scene.id;
    const snapshot = scene;
    setSceneTask(sceneId, { kind: 'revising', completed: 0, total: 1 });
    setSceneError(sceneId, '');
    try {
      const result = await reviseReferenceContract({
        sceneId,
        directorNote: snapshot.directorNote?.rawText ?? '',
        reviewNote,
        sourcePath: snapshot.occurrence.imagePath,
        take: selectedTake,
        contract: snapshot.contract!,
        reviewReferences: snapshot.reviewRequest?.references ?? [],
        intentReferences: snapshot.intentReferences ?? [],
      });
      if (!result.ok) {
        setSceneError(sceneId, result.message);
        return;
      }
      updateScene(sceneId, current => ({
        ...current,
        stage: 'CONTRACT',
        contract: result.contract,
        settings: result.preservationMode
          ? { ...current.settings, preservationMode: result.preservationMode }
          : current.settings,
        reviewRequest: current.reviewRequest ? {
          ...current.reviewRequest,
          appliedAt: isoNow(),
          summary: result.summary,
          updatedAt: isoNow(),
        } : current.reviewRequest,
      }));
      if (activeSceneIdRef.current === sceneId) setStepIndex(2);
    } catch (cause) {
      setSceneError(sceneId, cause instanceof Error ? cause.message : 'The contract could not be revised.');
    } finally {
      setSceneTask(sceneId, null);
    }
  };

  const approveTake = () => {
    if (!selectedTake?.path || (selectedTake.status !== 'READY' && selectedTake.status !== 'REJECTED' && selectedTake.status !== 'APPROVED')) return;
    updateScene(scene.id, current => ({
      ...current,
      stage: 'APPROVED',
      approval: { kind: 'TAKE', takeId: selectedTake.id, approvedAt: isoNow() },
      takes: current.takes.map(take => {
        if (take.id === selectedTake.id) return { ...take, status: 'APPROVED' };
        if (take.status !== 'APPROVED') return take;
        const rejected = take.changes?.some(change => change.state !== 'landed') || take.drift.some(verdict => !verdict.passed);
        return { ...take, status: rejected ? 'REJECTED' : 'READY' };
      }),
    }));
    if (safeIndex < graph.scenes.length - 1) selectScene(safeIndex + 1);
  };

  const approveOriginal = () => {
    if (busy !== null || sourceApproved) return;
    const sceneId = scene.id;
    updateScene(sceneId, current => ({
      ...current,
      stage: 'APPROVED',
      approval: { kind: 'SOURCE', approvedAt: isoNow() },
      takes: current.takes.map(take => {
        if (take.status === 'MAKING' || take.status === 'QUEUED') {
          return { ...take, status: 'FAILED', note: 'Take closed because the original source was approved.' };
        }
        if (take.status !== 'APPROVED') return take;
        const rejected = take.changes?.some(change => change.state !== 'landed') || take.drift.some(verdict => !verdict.passed);
        return { ...take, status: rejected ? 'REJECTED' : 'READY' };
      }),
    }));
    setSelectedTakeId(null);
    if (safeIndex < graph.scenes.length - 1) selectScene(safeIndex + 1);
    else setStepIndex(4);
  };

  const removeScene = (sceneId: string) => {
    if (sceneTasks[sceneId]) return;
    const removedIndex = graph.scenes.findIndex(item => item.id === sceneId);
    if (removedIndex < 0) return;

    const scenes = graph.scenes.filter(item => item.id !== sceneId);
    const previousActiveId = activeSceneIdRef.current ?? graph.activeSceneId;
    const nextActive = previousActiveId && previousActiveId !== sceneId
      ? scenes.find(item => item.id === previousActiveId)
      : scenes[Math.min(removedIndex, Math.max(0, scenes.length - 1))];
    const nextIndex = nextActive ? scenes.findIndex(item => item.id === nextActive.id) : 0;
    const next: ReferenceProjectGraph = {
      ...graph,
      deck: {
        ...graph.deck,
        occurrenceCount: scenes.length,
        assetCount: new Set(scenes.map(item => item.occurrence.assetHash || item.occurrence.imagePath)).size,
      },
      scenes,
      activeSceneId: nextActive?.id,
      updatedAt: isoNow(),
    };

    setGraph(next);
    persist(next);
    activeSceneIdRef.current = nextActive?.id ?? null;
    setSceneIndex(nextIndex);
    setStepIndex(nextActive ? maxStep(nextActive) : 0);
    setSelectedTakeId(null);
    setPickerTarget(null);
    setImagePreview(null);
    setDeleteSceneId(null);
    setSceneTasks(current => {
      const updated = { ...current };
      delete updated[sceneId];
      return updated;
    });
    setSceneErrors(current => {
      const updated = { ...current };
      delete updated[sceneId];
      return updated;
    });
  };

  const deleteScene = deleteSceneId ? graph.scenes.find(item => item.id === deleteSceneId) : undefined;
  const deleteSceneIndex = deleteScene ? graph.scenes.findIndex(item => item.id === deleteScene.id) : -1;

  return (
    <div className="rm copyable-surface">
      <header className="rm-bar">
        <button className="rm-back" onClick={() => setActiveView('studio')}>‹ Studio</button>
        <div className="rm-bar__title"><span className="mono-label">REFERENCE MAKER</span><strong>{graph.deck.title}</strong></div>
        <div className="rm-bar__status"><span>{completedScenes} / {graph.scenes.length} approved</span><i aria-hidden="true" /><span>{runningScenes ? `${runningScenes} scene${runningScenes === 1 ? '' : 's'} working` : activeProjectId ? 'Project ledger synced' : 'Sample session'}</span></div>
      </header>

      <nav className="rm-steps" aria-label="Reference journey">
        {STEPS.map((item, index) => (
          <button key={item} className={index === stepIndex ? 'is-active' : index < stepIndex ? 'is-done' : ''} disabled={index > maxStep(scene) || busy !== null} onClick={() => setStepIndex(index)}>
            <span>{String(index + 1).padStart(2, '0')}</span>{item}
          </button>
        ))}
      </nav>

      <div className="rm-workspace">
        <SceneReel graph={graph} active={safeIndex} tasks={sceneTasks} errors={sceneErrors} onSelect={selectScene} onPreview={setImagePreview} onAdd={() => activeProjectId ? setPickerTarget({ kind: 'scene' }) : setSceneError(scene.id, 'Open a project before adding durable scene sources.')} onOpen={() => void openPdf()} />

        <main className="rm-stage">
          <StageHeader scene={scene} index={safeIndex} step={step} removeDisabled={busy !== null} onRemove={() => setDeleteSceneId(scene.id)} />
          {sceneError && <div className="rm-inline-error" role="alert"><span>{sceneError}</span><button onClick={() => setSceneError(scene.id, '')}>Dismiss</button></div>}
          {step === 'Direction' && <SourceFrame scene={scene} index={safeIndex} onPreview={setImagePreview} />}
          {step === 'Understanding' && (
            <div className="rm-understanding">
              <SourceFrame scene={scene} index={safeIndex} compact onPreview={setImagePreview} />
              <article className="rm-restatement">
                <span className="mono-label">HJEN RESTATEMENT</span>
                <p>{scene.interpretation?.restatement || 'Reading the scene against your direction…'}</p>
                <dl className="rm-understanding__facts">
                  {scene.interpretation?.sceneRole && <div><dt>ROLE</dt><dd>{scene.interpretation.sceneRole}</dd></div>}
                  {scene.interpretation?.intendedFeeling && <div><dt>FEELING</dt><dd>{scene.interpretation.intendedFeeling}</dd></div>}
                  {scene.interpretation?.place && <div><dt>PLACE</dt><dd>{scene.interpretation.place}</dd></div>}
                  {scene.interpretation?.timeState && <div><dt>TIME</dt><dd>{scene.interpretation.timeState}</dd></div>}
                </dl>
              </article>
            </div>
          )}
          {step === 'Contract' && <SourceFrame scene={scene} index={safeIndex} contract onPreview={setImagePreview} />}
          {step === 'Make' && (
            <div className="rm-make">
              <div className="rm-make__summary">
                <span className="mono-label">SIGNED INPUT</span>
                <h2>{busy === 'making' ? 'Making the selected takes.' : 'The scene is bounded by its contract.'}</h2>
                <p>The raw note stays first in authority. The source, signed decisions and chosen controls travel together. DNA and DOP enter only when you choose them.</p>
                <dl>
                  <div><dt>KEEP</dt><dd>{scene.contract?.items.filter(item => item.action === 'KEEP').length ?? 0} locks</dd></div>
                  <div><dt>CHANGE</dt><dd>{scene.contract?.items.filter(item => item.action === 'CHANGE').length ?? 0} moves</dd></div>
                  <div><dt>MODEL</dt><dd>{selectedModel.name}</dd></div>
                </dl>
                {activeTask && <SceneProgress task={activeTask} />}
              </div>
              <SourceFrame scene={scene} index={safeIndex} compact onPreview={setImagePreview} />
            </div>
          )}
          {step === 'Review' && <TakeCompare scene={scene} selected={selectedTake} onSelect={setSelectedTakeId} onPreview={setImagePreview} />}
        </main>

        <aside className="rm-inspector">
          {step === 'Direction' ? (
            <DirectionInspector
              note={scene.directorNote?.rawText ?? ''}
              references={scene.intentReferences ?? []}
              busy={busy === 'understanding'}
              onChange={setNote}
              onAdd={() => activeProjectId ? setPickerTarget({ kind: 'direction', sceneId: scene.id }) : setSceneError(scene.id, 'Open a project before attaching visual intent references.')}
              onRemove={referenceId => updateScene(scene.id, current => ({ ...current, intentReferences: (current.intentReferences ?? []).filter(reference => reference.id !== referenceId) }))}
              onPreview={setImagePreview}
            />
          ) : (
            <>
              <RawNote note={scene.directorNote?.rawText ?? ''} />
              {step === 'Understanding' && <UnderstandingInspector scene={scene} onAnswer={answer => updateScene(scene.id, current => ({ ...current, clarification: current.clarification ? { ...current.clarification, answer, resolvedAt: undefined } : current.clarification }))} />}
              {step === 'Contract' && <ContractInspector scene={scene} onEdit={editContract} onAdd={addContractItem} onRemove={removeContractItem} onPickSource={itemId => activeProjectId ? setPickerTarget({ kind: 'contract', sceneId: scene.id, itemId }) : setSceneError(scene.id, 'Open a project before attaching durable change references.')} onPreview={setImagePreview} />}
              {step === 'Make' && <ModelInspector
                selected={scene.settings.model}
                fits={modelFits}
                gate={gate}
                settings={scene.settings}
                onSettings={patch => updateScene(scene.id, current => ({ ...current, settings: { ...current.settings, ...patch } }))}
                onDna={() => { applyHjenDna(); updateScene(scene.id, current => ({ ...current, settings: { ...current.settings, dnaTool: { ...current.settings.dnaTool, enabled: true } } })); }}
                onClearDna={() => updateScene(scene.id, current => ({ ...current, settings: { ...current.settings, dnaTool: { ...current.settings.dnaTool, enabled: false } } }))}
                onDop={() => { updateScene(scene.id, current => ({ ...current, settings: { ...current.settings, dopTool: { ...current.settings.dopTool, enabled: true } } })); setDopOpen(true); }}
                onClearDop={() => updateScene(scene.id, current => ({ ...current, settings: { ...current.settings, dopTool: { ...current.settings.dopTool, enabled: false } } }))}
              />}
              {step === 'Review' && <ReviewInspector
                take={selectedTake}
                sourceApproved={sourceApproved}
                request={scene.reviewRequest}
                busy={busy === 'revising'}
                onChange={rawText => updateScene(scene.id, current => ({
                  ...current,
                  reviewRequest: {
                    ...(current.reviewRequest ?? { references: [] }),
                    rawText,
                    updatedAt: isoNow(),
                    appliedAt: undefined,
                    summary: undefined,
                  },
                }))}
                onAdd={() => activeProjectId ? setPickerTarget({ kind: 'review', sceneId: scene.id }) : setSceneError(scene.id, 'Open a project before attaching review references.')}
                onRemove={referenceId => updateScene(scene.id, current => ({
                  ...current,
                  reviewRequest: current.reviewRequest ? {
                    ...current.reviewRequest,
                    references: current.reviewRequest.references.filter(reference => reference.id !== referenceId),
                    updatedAt: isoNow(),
                    appliedAt: undefined,
                    summary: undefined,
                  } : current.reviewRequest,
                }))}
                onPreview={setImagePreview}
                onRevise={() => void reviseContractFromReview()}
              />}
            </>
          )}
        </aside>
      </div>

      <footer className="rm-footer">
        <div><span>Scene {sceneNumber(safeIndex)} · {title}</span><i aria-hidden="true" /><span>{sourceApproved ? 'Approved original' : step}</span></div>
        <div>
          <button className="rm-btn rm-btn--ghost rm-btn--approve-source" disabled={busy !== null || sourceApproved} title="Approve this scene exactly as sourced. No take will be made or selected." onClick={approveOriginal}>{sourceApproved ? 'Original approved' : 'Approve original'}</button>
          <button className="rm-btn rm-btn--ghost" disabled={stepIndex === 0 || busy !== null} onClick={() => setStepIndex(stepIndex - 1)}>Back</button>
          {step === 'Direction' && <button className="rm-btn rm-btn--accent" disabled={!scene.directorNote?.rawText.trim() || busy !== null} onClick={() => void buildUnderstanding()}>{busy === 'understanding' ? 'Reading scene…' : 'Build understanding'}</button>}
          {step === 'Understanding' && <button className="rm-btn rm-btn--accent" disabled={!scene.interpretation || Boolean(scene.clarification && !scene.clarification.answer?.trim())} onClick={approveUnderstanding}>Approve understanding</button>}
          {step === 'Contract' && <button className="rm-btn rm-btn--accent" disabled={!scene.contract} onClick={signContract}>Sign contract</button>}
          {step === 'Make' && <button className="rm-btn rm-btn--accent" disabled={!gate.allowed || busy !== null || !scene.slots} onClick={() => void makeTakes()}>{busy ? taskLabel(activeTask!) : 'Make takes'}</button>}
          {step === 'Review' && !sourceApproved && <button className="rm-btn rm-btn--accent" disabled={!selectedTake?.path || !['READY', 'REJECTED', 'APPROVED'].includes(selectedTake.status)} onClick={approveTake}>{selectedTake?.status === 'REJECTED' ? 'Approve rejected take' : safeIndex < graph.scenes.length - 1 ? 'Approve · next scene' : 'Approve take'}</button>}
        </div>
      </footer>
      {pickerTarget && <ReferenceSourcePicker
        projectId={activeProjectId}
        multiple
        maxSelected={pickerTarget.kind === 'direction'
          ? Math.max(0, 8 - (scene.intentReferences?.length ?? 0))
          : pickerTarget.kind === 'contract'
            ? Math.max(0, MAX_SLOT_REFS - (scene.contract?.items.reduce((count, item) => count + (item.action === 'CHANGE' ? contractReferencePaths(item).length : 0), 0) ?? 0))
            : pickerTarget.kind === 'review'
              ? Math.max(0, 8 - (scene.reviewRequest?.references.length ?? 0))
            : undefined}
        title={pickerTarget.kind === 'scene' ? 'Add scenes to the reel' : pickerTarget.kind === 'direction' ? 'Add visual intent references' : pickerTarget.kind === 'review' ? 'Explain the next revision with images' : 'Attach change references'}
        actionLabel={pickerTarget.kind === 'direction' ? 'Add to direction' : pickerTarget.kind === 'contract' ? 'Add to change' : pickerTarget.kind === 'review' ? 'Add to review note' : undefined}
        onClose={() => setPickerTarget(null)}
        onChoose={acceptSources}
      />}
      <ImagePreviewDialog item={imagePreview} onClose={() => setImagePreview(null)} />
      {deleteScene && <div className="modal-backdrop rm-delete-backdrop copyable-surface" onClick={() => setDeleteSceneId(null)}>
        <section className="modal modal--narrow rm-delete" role="alertdialog" aria-modal="true" aria-labelledby="rm-delete-title" aria-describedby="rm-delete-copy" onClick={event => event.stopPropagation()}>
          <div className="rm-delete__body">
            <span className="mono-label">REMOVE SCENE</span>
            <h2 id="rm-delete-title">Remove Scene {sceneNumber(deleteSceneIndex)}?</h2>
            <p id="rm-delete-copy">Its direction, contract and saved takes leave this Reference Maker reel. The source file stays on disk. This cannot be undone.</p>
          </div>
          <footer className="rm-delete__foot">
            <button className="rm-btn rm-btn--ghost" autoFocus onClick={() => setDeleteSceneId(null)}>Cancel</button>
            <button className="rm-btn rm-btn--danger" onClick={() => removeScene(deleteScene.id)}>Remove scene</button>
          </footer>
        </section>
      </div>}
    </div>
  );
}

function ImportShell({ state, error, projectReady, emptyDeck, onBack, onOpen, onSample }: {
  state: ImportState; error: string; projectReady: boolean; emptyDeck: boolean;
  onBack: () => void; onOpen: () => void; onSample: () => void;
}) {
  return (
    <div className="rm rm--import copyable-surface">
      <header className="rm-bar">
        <button className="rm-back" onClick={onBack}>‹ Studio</button>
        <div className="rm-bar__title"><span className="mono-label">REFERENCE MAKER</span><strong>Turn a reference deck into directed scenes</strong></div>
      </header>
      <main className="rm-import">
        <section className={`rm-import__card${state === 'error' ? ' has-error' : ''}`}>
          <div className="rm-import__mark" aria-hidden="true"><span /><span /><span /></div>
          {state === 'loading' && <><span className="mono-label">PROJECT LEDGER</span><h1>Opening the scene reel.</h1><WorkingState label="Reading saved reference work" /></>}
          {state === 'extracting' && <>
            <span className="mono-label">PDF EXTRACTION</span><h1>Separating the deck into scenes.</h1>
            <p>Page order, repeated placements and source paths stay attached to every occurrence.</p>
            <div className="rm-import__progress">
              <div className="is-active"><i /><span><strong>Reading pages</strong><small>Keeping the deck’s sequence intact</small></span></div>
              <div><i /><span><strong>Separating image occurrences</strong><small>One scene node per placement</small></span></div>
              <div><i /><span><strong>Building the reel</strong><small>Nothing is interpreted before your note</small></span></div>
            </div>
          </>}
          {state === 'materializing-sample' && <>
            <span className="mono-label">SND96 SAMPLE</span><h1>Preparing real local source frames.</h1>
            <p>The bundled sample is being copied into HJEN’s local workspace so scene reading and Make receive the same kind of source path as a PDF import.</p>
            <div className="rm-import__progress">
              <div className="is-active"><i /><span><strong>Opening bundled frames</strong><small>Reading the three sample assets</small></span></div>
              <div><i /><span><strong>Writing local source files</strong><small>Materializing paths the engine can read</small></span></div>
              <div><i /><span><strong>Building the sample reel</strong><small>Director notes remain blank</small></span></div>
            </div>
          </>}
          {(state === 'idle' || (state === 'ready' && emptyDeck)) && <>
            <span className="mono-label">PDF → SCENE REEL</span>
            <h1>{emptyDeck ? 'No visual scenes were found.' : 'Start with the deck, not a blank prompt.'}</h1>
            <p>{emptyDeck ? 'Try another PDF, or open the sample reel to inspect the full workflow.' : 'Reference Maker extracts every image occurrence in page order. Your direction begins blank; the system waits for what the image means to you.'}</p>
            <div className="rm-import__actions">
              <button className="rm-btn rm-btn--accent" disabled={!projectReady} onClick={onOpen}>Open PDF</button>
              <button className="rm-btn rm-btn--ghost" onClick={onSample}>Open SND96 sample</button>
            </div>
            {!projectReady && <small>Open or create a project to import a new PDF. The sample can be explored without one.</small>}
          </>}
          {state === 'error' && <>
            <span className="mono-label">IMPORT INTERRUPTED</span><h1>The deck did not become a scene reel.</h1>
            <p role="alert">{error || 'The PDF could not be read.'}</p>
            <div className="rm-import__actions"><button className="rm-btn rm-btn--accent" disabled={!projectReady} onClick={onOpen}>Retry PDF</button><button className="rm-btn rm-btn--ghost" onClick={onSample}>Open SND96 sample</button></div>
          </>}
        </section>
      </main>
    </div>
  );
}

function WorkingState({ label }: { label: string }) {
  return <div className="rm-working" role="status"><i /><span>{label}</span></div>;
}

function SceneProgress({ task, compact = false }: { task: SceneTask; compact?: boolean }) {
  const value = task.kind === 'understanding' ? undefined : task.completed;
  return <div className={`rm-scene-progress${compact ? ' rm-scene-progress--compact' : ''}`} role="status">
    <span><i aria-hidden="true" />{taskLabel(task)}</span>
    <progress max={task.total} value={value} aria-label={taskLabel(task)} />
  </div>;
}

function SceneReel({ graph, active, tasks, errors, onSelect, onPreview, onAdd, onOpen }: {
  graph: ReferenceProjectGraph;
  active: number;
  tasks: Record<string, SceneTask>;
  errors: Record<string, string>;
  onSelect: (index: number) => void;
  onPreview: (item: ImagePreviewItem) => void;
  onAdd: () => void;
  onOpen: () => void;
}) {
  const reelRef = useRef<HTMLElement>(null);
  const sceneRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pages = new Set(graph.scenes.map(scene => scene.occurrence.page)).size;
  const assets = new Set(graph.scenes.map(scene => scene.occurrence.assetHash || scene.occurrence.imagePath)).size;
  const reelStates = graph.scenes.map(scene => sceneReelState(scene, tasks[scene.id], Boolean(errors[scene.id])));
  const workingCount = reelStates.filter(state => state === 'working').length;
  const actionCount = reelStates.filter(state => state === 'ready' || state === 'action' || state === 'error').length;
  const completeCount = reelStates.filter(state => state === 'complete').length;

  useEffect(() => {
    if (reelRef.current) reelRef.current.scrollTop = 0;
  }, [graph.deck.id]);

  useEffect(() => {
    const reel = reelRef.current;
    const button = sceneRefs.current[active];
    if (!reel || !button) return;
    const reelBounds = reel.getBoundingClientRect();
    const buttonBounds = button.getBoundingClientRect();
    if (buttonBounds.top < reelBounds.top) reel.scrollTop += buttonBounds.top - reelBounds.top;
    else if (buttonBounds.bottom > reelBounds.bottom) reel.scrollTop += buttonBounds.bottom - reelBounds.bottom;
  }, [active, graph.deck.id]);

  return (
    <aside className="rm-scenes" ref={reelRef}>
      <div className="rm-scenes__head"><div><span className="mono-label">SCENE REEL</span><b>{graph.scenes.length} scenes</b></div><button onClick={onAdd}>+ Add scene</button></div>
      <div className="rm-scenes__signals" aria-label="Scene activity summary">
        <span className="is-working"><i aria-hidden="true" />{workingCount} working</span>
        <span className="needs-action"><i aria-hidden="true" />{actionCount} action</span>
        <span className="is-complete"><i aria-hidden="true" />{completeCount} done</span>
      </div>
      <div className="rm-deck-summary"><div><span>Pages</span><strong>{graph.deck.pageCount || pages}</strong></div><div><span>Scenes</span><strong>{graph.scenes.length}</strong></div><div><span>Assets</span><strong>{graph.deck.assetCount || assets}</strong></div></div>
      <div className="rm-scenes__list">
        {graph.scenes.map((scene, index) => {
          const task = tasks[scene.id];
          const hasError = Boolean(errors[scene.id]);
          const reelState = reelStates[index];
          return <button key={scene.id} ref={element => { sceneRefs.current[index] = element; }} className={`${index === active ? 'is-active ' : ''}is-${reelState}`} onClick={() => onSelect(index)}>
            <img
              src={imageUrl(scene.occurrence.imagePath)}
              alt={`${sceneTitle(scene, index)} preview`}
              title="Click image to preview"
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onPreview({ src: imageUrl(scene.occurrence.imagePath), title: sceneTitle(scene, index), detail: sceneLocator(scene) });
              }}
            />
            <div className="rm-scenes__copy"><strong>{sceneNumber(index)} · {sceneTitle(scene, index)}</strong><small>{sceneLocator(scene)}</small><em>{sceneStatus(scene, task, hasError)}</em>{task && <SceneProgress task={task} compact />}</div>
            <i className={`rm-scenes__state-dot is-${reelState}`} aria-hidden="true" />
          </button>;
        })}
      </div>
      <div className="rm-scenes__foot"><span className="mono-label">SOURCE DECK</span><strong>{graph.deck.title}</strong><small>Deck order held. Added scenes join without replacing it.</small><button className="rm-scenes__replace" disabled={Object.keys(tasks).length > 0} title={Object.keys(tasks).length ? 'Wait for active scene work before replacing the deck.' : undefined} onClick={onOpen}>Open another PDF</button></div>
    </aside>
  );
}

function StageHeader({ scene, index, step, removeDisabled, onRemove }: { scene: SceneNode; index: number; step: Step; removeDisabled: boolean; onRemove: () => void }) {
  const titles: Record<Step, [string, string]> = {
    Direction: ['Explain this image first', 'HJEN waits for your meaning before it reads the frame creatively.'],
    Understanding: ['What HJEN understood', 'Your original words remain separate, visible and first in authority.'],
    Contract: ['KEEP / CHANGE contract', 'Only named changes may move. Everything else is held against the source.'],
    Make: ['Ready to make', 'Choose the model and optional Frame DNA / DOP tools, then send the signed scene.'],
    Review: ['Review against the contract', 'A polished take can still fail. Change success and preservation are judged separately.'],
  };
  const copy = step === 'Review' && originalIsApproved(scene)
    ? ['Original approved', 'The source is the final scene decision. No take was required or selected.']
    : titles[step];
  return <header className="rm-stage__head"><div><span className="mono-label">{sceneLocator(scene).toUpperCase()}</span><h1>{copy[0]}</h1></div><div className="rm-stage__meta"><p>{copy[1]}</p><button className="rm-stage__remove" disabled={removeDisabled} title={removeDisabled ? 'Wait for this scene to finish working before removing it.' : `Remove Scene ${sceneNumber(index)}`} onClick={onRemove}>Remove scene</button></div></header>;
}

function SourceFrame({ scene, index, compact = false, contract = false, onPreview }: {
  scene: SceneNode;
  index: number;
  compact?: boolean;
  contract?: boolean;
  onPreview: (item: ImagePreviewItem) => void;
}) {
  const open = () => onPreview({ src: imageUrl(scene.occurrence.imagePath), title: sceneTitle(scene, index), detail: sceneLocator(scene) });
  return <figure className={`rm-source rm-image-open${compact ? ' rm-source--compact' : ''}${contract ? ' rm-source--contract' : ''}`} role="button" tabIndex={0} title="Click image to preview" onClick={open} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }}><img src={imageUrl(scene.occurrence.imagePath)} alt={`Source reference for ${sceneTitle(scene, index)}`} /><figcaption><span>R{sceneNumber(index)} · FROM {sceneOrigin(scene)}</span><strong>{scene.settings.preservationMode.replaceAll('_', ' ')}</strong></figcaption></figure>;
}

function DirectionInspector({ note, references, busy, onChange, onAdd, onRemove, onPreview }: {
  note: string;
  references: DirectionReferenceNode[];
  busy: boolean;
  onChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (referenceId: string) => void;
  onPreview: (item: ImagePreviewItem) => void;
}) {
  return <section className="rm-inspector__section rm-direction">
    <span className="mono-label">YOUR WORDS · PRESERVED</span>
    <h2>Why did you choose this image?</h2>
    <p>Say what matters, what should change, and what must survive.</p>
    <textarea dir="auto" value={note} disabled={busy} onChange={event => onChange(event.target.value)} placeholder="Direct the scene in your own words…" aria-label="Your direction for this image" />
    <div className="rm-direction__refs">
      <div className="rm-direction__refs-head">
        <div><span className="mono-label">VISUAL INTENT</span><small>Optional · clarifies your words</small></div>
        <button disabled={busy || references.length >= 8} onClick={onAdd}>{references.length >= 8 ? '8 attached' : '+ Add images'}</button>
      </div>
      {references.length > 0 ? <div className="rm-direction__refs-grid">
        {references.map(reference => <article key={reference.id}>
          <button className="rm-direction__ref-image" disabled={busy} title="Preview intent reference" onClick={() => onPreview({ src: imageUrl(reference.imagePath), title: reference.label, detail: `${sourceKindCopy(reference.sourceKind)} · visual intent` })}>
            <img src={imageUrl(reference.imagePath)} alt={`${reference.label} intent reference`} />
          </button>
          <div><strong title={reference.label}>{reference.label}</strong><small>{sourceKindCopy(reference.sourceKind)}</small></div>
          <button className="rm-direction__ref-remove" disabled={busy} aria-label={`Remove ${reference.label}`} onClick={() => onRemove(reference.id)}>×</button>
        </article>)}
      </div> : <button className="rm-direction__refs-empty" disabled={busy} onClick={onAdd}><strong>Add images to explain the intent</strong><span>From projects · past makes · device</span></button>}
    </div>
    <small>Your note stays first in authority. Attached images explain it; they do not replace the scene.</small>
  </section>;
}

function RawNote({ note }: { note: string }) {
  return <section className="rm-inspector__section rm-raw"><span className="mono-label">YOUR RAW NOTE · AUTHORITY 01</span><p dir="auto" className="selectable">{note}</p></section>;
}

function UnderstandingInspector({ scene, onAnswer }: { scene: SceneNode; onAnswer: (value: string) => void }) {
  return <>
    {scene.clarification && <section className="rm-inspector__section rm-question"><span className="mono-label">ONE MATERIAL CLARIFICATION</span><h3>{scene.clarification.question}</h3><p>{scene.clarification.impact}</p><textarea dir="auto" value={scene.clarification.answer ?? ''} onChange={event => onAnswer(event.target.value)} placeholder="Your decision…" /></section>}
    <section className="rm-inspector__section rm-authority"><span className="mono-label">AUTHORITY RECEIPT</span><ol>{AUTHORITY.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, '0')}</span>{item}</li>)}</ol><small>Later sources may fill gaps. They cannot quietly override an earlier one.</small></section>
  </>;
}

function ContractInspector({ scene, onEdit, onAdd, onRemove, onPickSource, onPreview }: {
  scene: SceneNode;
  onEdit: (id: string, patch: Partial<ContractItem>) => void;
  onAdd: (action: ContractAction) => void;
  onRemove: (id: string) => void;
  onPickSource: (id: string) => void;
  onPreview: (item: ImagePreviewItem) => void;
}) {
  const items = scene.contract?.items ?? [];
  return <section className="rm-inspector__section rm-contract">
    <div className="rm-contract__status"><span>PRESERVATION CONTRACT</span><b>{scene.contract?.signedAt ? 'SIGNED' : 'EDITING'}</b></div>
    {scene.reviewRequest?.appliedAt && scene.reviewRequest.summary && <div className="rm-contract__revision-receipt">
      <span className="mono-label">REVIEW APPLIED</span>
      <p>{scene.reviewRequest.summary}</p>
      <small>Check the revised CHANGE items and their assigned references, then sign before making again.</small>
    </div>}
    {(['KEEP', 'CHANGE'] as ContractAction[]).map(action => <div className="rm-contract__group" key={action}>
      <div className="rm-contract__group-head"><h3>{action}</h3><button onClick={() => onAdd(action)}>+ Add</button></div>
      {items.filter(item => item.action === action).map(item => {
        const referencePaths = contractReferencePaths(item);
        return <div className="rm-contract__edit" key={item.id}>
          <div><select value={item.category} onChange={event => onEdit(item.id, { category: event.target.value as ContractCategory, slot: undefined })}>{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select><button aria-label={`Remove ${item.id}`} onClick={() => onRemove(item.id)}>×</button></div>
          <textarea value={item.value} onChange={event => onEdit(item.id, { value: event.target.value })} aria-label={`${action} instruction`} />
          {action === 'CHANGE' && <>
            <input value={item.acceptanceTest ?? ''} onChange={event => onEdit(item.id, { acceptanceTest: event.target.value })} placeholder="Visible acceptance test" />
            <div className="rm-contract__refs">
              <button className="rm-contract__source" onClick={() => onPickSource(item.id)}>
                <span>{referencePaths.length ? '+ Add references' : 'Choose references'}</span>
                <small>{referencePaths.length ? `${referencePaths.length} attached` : 'References · Makes · Device'}</small>
              </button>
            </div>
            {referencePaths.length > 0 && <div className="rm-contract__attachments">
              {referencePaths.map((path, index) => <article key={path}>
                <button className="rm-contract__attachment-image" title="Preview change reference" onClick={() => onPreview({ src: imageUrl(path), title: path.split('/').pop() || `Reference ${index + 1}`, detail: `${item.id} · reference ${index + 1}/${referencePaths.length}` })}>
                  <img src={imageUrl(path)} alt={`${item.id} reference ${index + 1}`} />
                </button>
                <strong title={path}>{path.split('/').pop()}</strong>
                <button className="rm-contract__attachment-remove" aria-label={`Remove reference ${index + 1}`} onClick={() => onEdit(item.id, { referencePaths: referencePaths.filter(reference => reference !== path), referencePath: undefined })}>×</button>
              </article>)}
            </div>}
          </>}
        </div>;
      })}
    </div>)}
  </section>;
}

function ReferenceSourcePicker({ projectId, multiple, maxSelected, title, actionLabel, onClose, onChoose }: {
  projectId: string | null;
  multiple: boolean;
  maxSelected?: number;
  title: string;
  actionLabel?: string;
  onClose: () => void;
  onChoose: (choices: SourceChoice[]) => Promise<PickerResult>;
}) {
  const projects = useStore(state => state.projects);
  const [tab, setTab] = useState<SourceKind>('references');
  const [sourceProjectId, setSourceProjectId] = useState<string | null>(projectId ?? projects[0]?.id ?? null);
  const [items, setItems] = useState<Record<SourceKind, SourceChoice[]>>({ references: [], generations: [], device: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ImagePreviewItem | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError('');
    void Promise.all([
      sourceProjectId ? window.hjen.readStageData({ id: sourceProjectId, stage: 2 }) : Promise.resolve(null),
      window.hjen.listAllGenerations(),
    ]).then(([referenceData, generations]) => {
      if (!live) return;
      const refs = ((referenceData as ReferencesData | null)?.refs ?? []).flatMap(ref => ref.imagePath ? [{
        path: ref.imagePath,
        thumb: ref.imagePath,
        label: ref.tag || ref.sourceName || 'Project reference',
        source: 'references' as const,
        sourceId: ref.id,
      }] : []);
      const makes = generations.filter(item => !sourceProjectId || item.projectId === sourceProjectId).map(item => ({
        path: item.imgPath,
        thumb: item.thumbPath,
        label: item.promptTitle || item.baseName,
        source: 'generations' as const,
        sourceId: item.jsonPath || item.imgPath,
      }));
      setItems(current => ({ ...current, references: refs, generations: makes }));
    }).catch(() => {
      if (live) setLoadError('Project sources could not be read. Device files are still available.');
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [sourceProjectId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !importing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [importing, onClose]);

  const chooseDevice = async () => {
    if (importing) return;
    const paths = await window.hjen.pickImageFiles();
    if (!paths?.length) return;
    const additions = paths.map(path => ({ path, thumb: path, label: path.split('/').pop() || 'Device image', source: 'device' as const }));
    setItems(current => {
      const seen = new Set(current.device.map(item => item.path));
      return { ...current, device: [...current.device, ...additions.filter(item => !seen.has(item.path))] };
    });
    setSelected(current => {
      const next = multiple ? new Set(current) : new Set<string>();
      if (multiple) additions.forEach(item => { if (maxSelected === undefined || next.size < maxSelected) next.add(item.path); });
      else if (additions[0]) next.add(additions[0].path);
      return next;
    });
  };

  const toggle = (path: string) => setSelected(current => {
    const next = multiple ? new Set(current) : new Set<string>();
    if (multiple && next.has(path)) next.delete(path);
    else if (maxSelected === undefined || next.size < maxSelected) next.add(path);
    return next;
  });

  const visible = items[tab];
  const picked = [...new Map(Object.values(items).flat().filter(item => selected.has(item.path)).map(item => [item.path, item])).values()];
  const tabs: Array<{ id: SourceKind; label: string }> = [
    { id: 'references', label: 'References' },
    { id: 'generations', label: 'Makes' },
    { id: 'device', label: 'Device' },
  ];
  const tabLabel = tabs.find(source => source.id === tab)?.label.toLowerCase() ?? 'sources';

  const importPicked = async () => {
    if (!picked.length || importing) return;
    setImporting(true);
    setActionError('');
    const result = await onChoose(picked);
    if (result.message) {
      setActionError(result.message);
      setSelected(current => {
        const next = new Set(current);
        result.completedPaths.forEach(path => next.delete(path));
        return next;
      });
      setImporting(false);
    }
  };

  return <><div className="modal-backdrop rm-picker-backdrop copyable-surface" onClick={importing ? undefined : onClose}>
    <section className={`modal rm-picker${importing ? ' is-importing' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
      <header className="rm-picker__head"><div><span className="mono-label">SOURCE PICKER</span><h2>{title}</h2></div><button disabled={importing} onClick={onClose}>Close</button></header>
      <nav className="rm-picker__tabs" aria-label="Source type">
        {tabs.map(source => <button key={source.id} className={tab === source.id ? 'is-active' : ''} disabled={importing} onClick={() => setTab(source.id)}><span>{source.label}</span><b>{items[source.id].length}</b></button>)}
      </nav>
      <div className="rm-picker__scope">
        {tab !== 'device' ? <>
          <label><span>Project</span><select value={sourceProjectId ?? ''} disabled={importing} onChange={event => setSourceProjectId(event.target.value || null)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.id === projectId ? ' · open' : ''}</option>)}</select></label>
          <small>Browse references and previous makes from any project.</small>
        </> : <small>Choose one or more images directly from this device.</small>}
      </div>
      <div className="rm-picker__body">
        {tab === 'device' && <button className="rm-picker__device" disabled={importing} onClick={() => void chooseDevice()}><strong>Choose from device</strong><span>{items.device.length ? 'Add more local frames' : 'Open image files without changing the project library'}</span></button>}
        {loading && tab !== 'device' ? <WorkingState label={`Reading ${tabLabel}`} />
          : visible.length === 0 ? <div className="rm-picker__empty"><strong>No {tabLabel} available</strong><span>{tab === 'device' ? 'Choose an image to bring it into this decision.' : `This project has no ${tabLabel} yet.`}</span></div>
            : <div className="rm-picker__grid">{visible.map(item => <button key={item.path} className={selected.has(item.path) ? 'is-selected' : ''} disabled={importing} onClick={() => toggle(item.path)} title={`${item.label} · click image to preview, card to select`}><img src={imageUrl(item.thumb || item.path)} alt={`${item.label} preview`} loading="lazy" onClick={event => { event.preventDefault(); event.stopPropagation(); setPreview({ src: imageUrl(item.path), title: item.label, detail: `${sourceKindCopy(item.source)} · ${item.path.split('/').pop()}` }); }} /><span><strong>{item.label}</strong><small>{sourceKindCopy(item.source)}</small></span><i aria-hidden="true">{selected.has(item.path) ? '✓' : ''}</i></button>)}</div>}
        {loadError && <p className="rm-picker__error" role="alert">{loadError}</p>}
        {actionError && <p className="rm-picker__error" role="alert">{actionError}</p>}
      </div>
      <footer className="rm-picker__foot"><span>{importing ? 'Copying into Reference Maker…' : `${picked.length} selected${maxSelected !== undefined ? ` · ${maxSelected} available` : ''}`}</span><div><button className="rm-btn rm-btn--ghost" disabled={importing} onClick={onClose}>Cancel</button><button className="rm-btn rm-btn--accent" disabled={picked.length === 0 || importing} onClick={() => void importPicked()}>{importing ? 'Importing…' : actionLabel ?? (multiple ? `Add ${picked.length || ''} scene${picked.length === 1 ? '' : 's'}` : 'Attach source')}</button></div></footer>
    </section>
  </div><ImagePreviewDialog item={preview} onClose={() => setPreview(null)} /></>;
}

function ModelInspector({ selected, fits, gate, settings, onSettings, onDna, onClearDna, onDop, onClearDop }: {
  selected: ModelId; fits: Record<ModelId, { score: number; reasons: string[] }>; gate: { allowed: boolean; blockers: string[] };
  settings: SceneNode['settings']; onSettings: (settings: Partial<SceneNode['settings']>) => void;
  onDna: () => void; onClearDna: () => void; onDop: () => void; onClearDop: () => void;
}) {
  return <section className="rm-inspector__section rm-models">
    <span className="mono-label">IMAGE MODEL · THIS SCENE</span><h2>Choose by the job.</h2><p>Model choice is recorded with the take and can differ scene by scene.</p>
    {MODELS.map(model => <button key={model.id} className={selected === model.id ? 'is-selected' : ''} onClick={() => onSettings({ model: model.id })}><span><strong>{model.name}</strong><small>{model.provider}</small></span><b>{model.fit} · {fits[model.id].score}</b><em>{model.cues} · {fits[model.id].reasons[0]}</em></button>)}
    <div className="rm-make-controls">
      <label><span>Aspect</span><select value={settings.aspect} onChange={event => onSettings({ aspect: event.target.value })}>{['16:9', '4:5', '1:1', '9:16', '21:9'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label><span>Quality</span><select value={settings.quality} onChange={event => onSettings({ quality: event.target.value as Quality })}>{(['LOW', 'MED', 'HIGH'] as Quality[]).map(value => <option key={value}>{value}</option>)}</select></label>
      <label><span>Takes</span><select value={settings.takes} onChange={event => onSettings({ takes: Number(event.target.value) as 1 | 2 | 4 })}>{[1, 2, 4].map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <div className="rm-frame-tools"><span className="mono-label">OPTIONAL FRAME TOOLS</span>
      <div className="rm-frame-tools__row"><button className={settings.dnaTool.enabled ? 'is-selected' : ''} onClick={onDna}><span><strong>HJEN DNA</strong><small>{settings.dnaTool.enabled ? 'Current DNA included in this Make' : 'Unset · model leads the look'}</small></span><b>{settings.dnaTool.enabled ? 'REAPPLY' : 'USE DNA'}</b></button>{settings.dnaTool.enabled && <button className="rm-frame-tools__clear" onClick={onClearDna}>Clear</button>}</div>
      <div className="rm-frame-tools__row"><button className={settings.dopTool.enabled ? 'is-selected' : ''} onClick={onDop}><span><strong>DOP</strong><small>{settings.dopTool.enabled ? 'Current Frame controls included' : 'Unset · no camera override'}</small></span><b>{settings.dopTool.enabled ? 'EDIT DOP' : 'USE DOP'}</b></button>{settings.dopTool.enabled && <button className="rm-frame-tools__clear" onClick={onClearDop}>Clear</button>}</div>
    </div>
    <div className={`rm-models__gate${gate.allowed ? ' is-ready' : ''}`}><span>{gate.allowed ? 'MAKE GATE READY' : 'MAKE GATE BLOCKED'}</span><p>{gate.allowed ? 'Note, understanding and KEEP / CHANGE contract are signed.' : gate.blockers[0]}</p></div>
    <small>Capability cues describe contract fit, not a quality ranking.</small>
  </section>;
}

function TakeCompare({ scene, selected, onSelect, onPreview }: { scene: SceneNode; selected?: TakeNode; onSelect: (id: string) => void; onPreview: (item: ImagePreviewItem) => void }) {
  const sourceApproved = originalIsApproved(scene);
  const selectedSrc = selected?.path ? imageUrl(selected.path) : undefined;
  const sourceSrc = imageUrl(scene.occurrence.imagePath);
  return <div className="rm-review-stage">
    <div className="rm-compare"><CompareCard label="Source" status="LOCKED" src={sourceSrc} foot="The source stays available and is never overwritten." onPreview={() => onPreview({ src: sourceSrc, title: 'Source reference', detail: sceneTitle(scene, 0) })} /><CompareCard label={sourceApproved ? 'Approved original' : 'Selected take'} status={sourceApproved ? 'APPROVED' : selected?.status ?? 'NO TAKE'} src={sourceApproved ? sourceSrc : selectedSrc} drift={!sourceApproved && selected?.status === 'REJECTED'} foot={sourceApproved ? 'Approved unchanged. No take was made or selected for this decision.' : selected?.note} onPreview={sourceApproved ? () => onPreview({ src: sourceSrc, title: 'Approved original', detail: 'Source approved unchanged' }) : selectedSrc ? () => onPreview({ src: selectedSrc, title: 'Selected made take', detail: selected?.note }) : undefined} /></div>
    <section className="rm-take-gallery" aria-label="All made takes for this scene">
      <header><div><span className="mono-label">ALL MADE TAKES</span><strong>{scene.takes.length} option{scene.takes.length === 1 ? '' : 's'}</strong></div><small>{sourceApproved ? 'The original is approved; saved takes remain available as history.' : 'Select any saved image, including a rejected take.'}</small></header>
      <div className="rm-take-gallery__rail">
        {scene.takes.length === 0 ? <div className="rm-take-gallery__none"><strong>No takes made</strong><span>The source was approved without making another image.</span></div> : scene.takes.map((take, index) => {
          const src = take.path ? imageUrl(take.path) : undefined;
          const active = take.id === selected?.id;
          return <article key={take.id} className={`${active ? 'is-selected ' : ''}is-${take.status.toLowerCase()}`}>
            {src ? <button className="rm-take-gallery__image" title="Select and preview this take" onClick={() => { onSelect(take.id); onPreview({ src, title: `Take ${String(index + 1).padStart(2, '0')}`, detail: take.note || take.status }); }}><img src={src} alt={`Made take ${index + 1}`} /></button> : <div className="rm-take-gallery__empty"><span>No image returned</span></div>}
            <button className="rm-take-gallery__choose" disabled={!src} onClick={() => onSelect(take.id)}><span><strong>TAKE {String(index + 1).padStart(2, '0')}</strong><small>{take.status}</small></span><b>{active ? 'SELECTED' : src ? 'CHOOSE' : 'UNAVAILABLE'}</b></button>
          </article>;
        })}
      </div>
    </section>
  </div>;
}

function CompareCard({ label, status, src, drift = false, foot, onPreview }: { label: string; status: string; src?: string; drift?: boolean; foot?: string; onPreview?: () => void }) {
  return <article className={`rm-compare__card${drift ? ' has-drift' : ''}`}><header><strong>{label}</strong><span>{status}</span></header>{src ? <div className="rm-image-open" role="button" tabIndex={0} title="Click image to preview" onClick={onPreview} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && onPreview) { event.preventDefault(); onPreview(); } }}><img src={src} alt={label} />{drift && <i aria-hidden="true" />}</div> : <div className="rm-compare__empty"><span>No made image was returned.</span></div>}<footer>{foot ?? (drift ? 'Requested changes or protected source decisions did not hold.' : 'No unrequested change was found in the visible contract.')}</footer></article>;
}

function ReviewInspector({ take, sourceApproved, request, busy, onChange, onAdd, onRemove, onPreview, onRevise }: {
  take?: TakeNode;
  sourceApproved: boolean;
  request?: SceneNode['reviewRequest'];
  busy: boolean;
  onChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onPreview: (item: ImagePreviewItem) => void;
  onRevise: () => void;
}) {
  if (sourceApproved) return <section className="rm-inspector__section rm-source-approved">
    <span className="mono-label">SCENE DECISION</span>
    <h2>Original approved.</h2>
    <p>The source image is the final scene decision. No take was required, and the direction and contract remain in the ledger.</p>
    <div><i aria-hidden="true" /><span><strong>APPROVED</strong><small>Source held unchanged</small></span></div>
  </section>;
  return <section className="rm-inspector__section rm-review">
    <div className="rm-review-response">
      <span className="mono-label">YOUR NEXT CHANGE</span>
      <h2>Respond to this take.</h2>
      <p>Write what should change. HJEN will revise the contract and assign your images to the right CHANGE items.</p>
      <textarea dir="auto" value={request?.rawText ?? ''} disabled={busy} onChange={event => onChange(event.target.value)} placeholder="What should be different in the next take?" aria-label="Review response" />
      <div className="rm-review-response__head"><span>{request?.references.length ?? 0} reference{request?.references.length === 1 ? '' : 's'}</span><button disabled={busy || (request?.references.length ?? 0) >= 8} onClick={onAdd}>+ Add images</button></div>
      {(request?.references.length ?? 0) > 0 && <div className="rm-review-response__refs">
        {request!.references.map(reference => <article key={reference.id}>
          <button className="rm-review-response__image" disabled={busy} onClick={() => onPreview({ src: imageUrl(reference.imagePath), title: reference.label, detail: `${sourceKindCopy(reference.sourceKind)} · review reference` })}><img src={imageUrl(reference.imagePath)} alt={reference.label} /></button>
          <strong title={reference.label}>{reference.label}</strong>
          <button className="rm-review-response__remove" disabled={busy} aria-label={`Remove ${reference.label}`} onClick={() => onRemove(reference.id)}>×</button>
        </article>)}
      </div>}
      {request?.summary && <small className="rm-review-response__receipt">{request.summary}</small>}
      <button className="rm-btn rm-btn--accent rm-review-response__apply" disabled={busy || !request?.rawText.trim()} onClick={onRevise}>{busy ? 'Revising contract…' : 'Update contract'}</button>
    </div>
    <div className="rm-review__audit">
      <span className="mono-label">DRIFT AUDIT</span><h2>{!take ? 'No take returned' : take.status === 'READY' || take.status === 'APPROVED' ? 'Take ready' : take.status === 'FAILED' ? 'Take failed' : 'Take held back'}</h2><p>{take?.note || 'Change success and source preservation were checked independently.'}</p>
      {take && <div className="rm-review__list">
        {take.changes?.map(change => <div key={`change-${change.id}`} className={`is-${change.state === 'landed' ? 'landed' : 'drift'}`}><i aria-hidden="true" /><span><strong>Change · {change.id}</strong><small>{change.evidence}</small></span><b>{change.state.toUpperCase()}</b></div>)}
        {take.drift.map(verdict => <div key={verdict.axis} className={verdict.passed ? 'is-held' : 'is-drift'}><i aria-hidden="true" /><span><strong>{verdict.axis}</strong><small>{verdict.evidence}</small></span><b>{verdict.passed ? 'HELD' : `${verdict.score}/${verdict.threshold}`}</b></div>)}
      </div>}
      <small>{take?.status === 'READY' ? 'Approval locks this take to the scene ledger.' : 'Only a take that lands every change and holds every locked axis can be approved.'}</small>
    </div>
  </section>;
}
