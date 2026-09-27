import type { ModelId } from '../../types/catalog';
import { MODELS } from '../models';
import { MAX_SLOT_REFS } from '../swap/refs';
import { contractReferencePaths } from './types';
import {
  AUTHORITY_RANK,
  type AuthorityValue,
  type ClarificationNode,
  type ContractItem,
  type DeckNode,
  type DriftVerdict,
  type MakeGate,
  type AssetOccurrenceNode,
  type ReferenceProjectGraph,
  type SceneNode,
  type SceneStage,
  type TakeNode,
} from './types';

const isoNow = () => new Date().toISOString();
const nonEmpty = (value?: string) => Boolean(value?.trim());

export function createReferenceGraph(args: {
  projectId: string;
  deck: DeckNode;
  occurrences: AssetOccurrenceNode[];
}): ReferenceProjectGraph {
  const at = isoNow();
  const scenes: SceneNode[] = args.occurrences.map(occurrence => ({
    id: `scene-${occurrence.id}`,
    occurrence,
    stage: 'WAITING_FOR_DIRECTOR',
    settings: {
      model: 'GPT_IMAGE_2',
      quality: 'HIGH',
      aspect: '16:9',
      takes: 2,
      preservationMode: 'REFERENCE_GUIDED',
      dnaTool: { enabled: false, source: 'FRAME_TOOLS', mode: 'CURRENT' },
      dopTool: { enabled: false, source: 'FRAME_TOOLS' },
    },
    takes: [],
    updatedAt: at,
  }));
  return {
    version: 1,
    id: args.projectId,
    deck: args.deck,
    scenes,
    activeSceneId: scenes[0]?.id,
    updatedAt: at,
  };
}

/** Highest-authority value wins. Equal-rank values keep the latest timestamp. */
export function resolveAuthority<T>(values: AuthorityValue<T>[]): AuthorityValue<T> | undefined {
  return [...values].sort((a, b) => {
    const authority = AUTHORITY_RANK[b.authority] - AUTHORITY_RANK[a.authority];
    return authority || b.at.localeCompare(a.at);
  })[0];
}

export function stageFor(scene: SceneNode, _graph: Pick<ReferenceProjectGraph, 'dna' | 'dop'>): SceneStage {
  if (scene.stage === 'MAKING' || scene.stage === 'REVIEW' || scene.stage === 'APPROVED') return scene.stage;
  if (!scene.directorNote || !nonEmpty(scene.directorNote.rawText)) return 'WAITING_FOR_DIRECTOR';
  if (!scene.interpretation?.approvedAt) return scene.clarification && !scene.clarification.resolvedAt
    ? 'CLARIFICATION'
    : 'UNDERSTANDING';
  if (!scene.contract?.signedAt) return 'CONTRACT';
  return 'READY_TO_MAKE';
}

export function refreshGraph(graph: ReferenceProjectGraph): ReferenceProjectGraph {
  const updatedAt = isoNow();
  return {
    ...graph,
    updatedAt,
    scenes: graph.scenes.map(scene => ({
      ...scene,
      settings: {
        ...scene.settings,
        dnaTool: scene.settings.dnaTool ?? { enabled: false, source: 'FRAME_TOOLS', mode: 'CURRENT' },
        dopTool: scene.settings.dopTool ?? { enabled: false, source: 'FRAME_TOOLS' },
      },
      stage: stageFor(scene, graph),
      updatedAt,
    })),
  };
}

/**
 * A renderer promise lives only for the lifetime of the app window. If the app
 * closes after a round has been saved, the project document can legitimately
 * contain a MAKING take with a usable path. Recover that take for drift review
 * instead of presenting an endless spinner or charging for another render.
 *
 * Takes interrupted before any image reached disk are made explicitly FAILED;
 * their scene returns to Make so the owner can retry deliberately.
 */
export function recoverInterruptedReferenceGraph(graph: ReferenceProjectGraph): ReferenceProjectGraph {
  let changed = false;
  const scenes = graph.scenes.map(scene => {
    const interrupted = scene.stage === 'MAKING'
      || scene.takes.some(take => take.status === 'MAKING' || take.status === 'QUEUED');
    if (!interrupted) return scene;

    let hasSavedTake = scene.takes.some(take => Boolean(take.path));
    const takes = scene.takes.map(take => {
      const savedWhileMaking = scene.stage === 'MAKING' && take.status === 'READY' && Boolean(take.path);
      if (take.status !== 'MAKING' && take.status !== 'QUEUED' && !savedWhileMaking) return take;
      changed = true;
      if (take.path) {
        hasSavedTake = true;
        return {
          ...take,
          status: 'QUEUED' as const,
          note: 'Recovered after the app was interrupted. Drift review is resuming.',
        };
      }
      return {
        ...take,
        status: 'FAILED' as const,
        note: 'The app was interrupted before this take was saved. Return to Make to retry it.',
      };
    });

    if (scene.stage !== 'MAKING') return { ...scene, takes };
    changed = true;
    return {
      ...scene,
      takes,
      stage: hasSavedTake ? 'REVIEW' as const : 'READY_TO_MAKE' as const,
    };
  });

  return changed ? { ...graph, scenes, updatedAt: isoNow() } : graph;
}

/**
 * One question maximum. It only exists when the answer changes a visible
 * decision and cannot be recovered from a stronger authority source.
 */
export function clarificationFor(
  scene: SceneNode,
  conflicts: Array<{ question: string; impact: string; resolvableElsewhere?: boolean }>,
): ClarificationNode | undefined {
  if (!scene.directorNote || !nonEmpty(scene.directorNote.rawText)) return undefined;
  const material = conflicts.find(conflict => !conflict.resolvableElsewhere && nonEmpty(conflict.impact));
  if (!material) return undefined;
  return {
    id: `clarification-${scene.id}`,
    question: material.question,
    impact: material.impact,
  };
}

export function validateContract(items: ContractItem[]): string[] {
  const issues: string[] = [];
  if (!items.some(item => item.action === 'KEEP')) issues.push('Name at least one visual invariant to keep.');
  if (!items.some(item => item.action === 'CHANGE')) issues.push('Name at least one visible change.');
  for (const item of items) {
    if (!nonEmpty(item.value)) issues.push(`${item.category} has no visible instruction.`);
    if (item.action === 'CHANGE' && !nonEmpty(item.acceptanceTest)) {
      issues.push(`${item.category} needs an acceptance test before Make.`);
    }
  }
  const referenceCount = items.reduce((count, item) => count + (item.action === 'CHANGE' ? contractReferencePaths(item).length : 0), 0);
  if (referenceCount > MAX_SLOT_REFS) issues.push(`Use no more than ${MAX_SLOT_REFS} CHANGE references in one scene.`);
  return [...new Set(issues)];
}

export function makeGate(_graph: ReferenceProjectGraph, scene: SceneNode): MakeGate {
  const blockers: string[] = [];
  if (!scene.directorNote || !nonEmpty(scene.directorNote.rawText)) blockers.push('The director has not explained this frame.');
  if (!scene.interpretation?.approvedAt) blockers.push('The system understanding is not approved.');
  if (scene.clarification && !scene.clarification.resolvedAt) blockers.push('One material clarification is still open.');
  if (!scene.contract?.signedAt) blockers.push('The KEEP / CHANGE contract is not signed.');
  if (scene.contract) blockers.push(...validateContract(scene.contract.items));
  if (!MODELS[scene.settings.model]) blockers.push('Choose an available image model.');
  if (scene.settings.preservationMode === 'STRICT_SWAP' && !scene.contract?.items.some(item => item.action === 'KEEP')) {
    blockers.push('Strict Swap requires explicit protected elements.');
  }
  return { allowed: blockers.length === 0, blockers: [...new Set(blockers)] };
}

export function modelFit(
  model: ModelId,
  scene: Pick<SceneNode, 'settings' | 'contract'>,
): { score: number; reasons: string[] } {
  const spec = MODELS[model];
  const changes = scene.contract?.items.filter(item => item.action === 'CHANGE') ?? [];
  const identityLocked = scene.contract?.items.some(item => item.category === 'identity' && item.action === 'KEEP');
  const referenceCount = scene.contract?.items.reduce((count, item) => count + (item.action === 'CHANGE' ? contractReferencePaths(item).length : 0), 0) ?? 0;
  let score = 70;
  const reasons: string[] = [];

  if (scene.settings.preservationMode === 'STRICT_SWAP' && model === 'GPT_IMAGE_2') {
    score += 12;
    reasons.push('Strong fit for a single-frame edit contract.');
  }
  if (referenceCount > 4 && model === 'NANO_BANANA_PRO') {
    score += 12;
    reasons.push('Better practical budget for a multi-reference scene.');
  }
  if (identityLocked && model === 'NANO_BANANA_PRO') {
    score += 8;
    reasons.push('Typed character references can support continuity.');
  }
  if (changes.length > 5) {
    score -= 10;
    reasons.push('A wide change radius raises drift risk on every model.');
  }
  if (referenceCount > (spec.refs?.practical ?? 0)) {
    score -= 18;
    reasons.push(`The contract exceeds this model's practical reference budget (${spec.refs?.practical ?? 0}).`);
  }
  if (!reasons.length) reasons.push('Balanced fit for the current contract.');
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export function reviewTake(take: TakeNode, verdicts: DriftVerdict[]): TakeNode {
  const passed = verdicts.every(verdict => verdict.passed);
  return {
    ...take,
    drift: verdicts,
    status: passed ? 'READY' : 'REJECTED',
    note: passed ? undefined : 'Rejected before presentation because a locked axis drifted.',
  };
}

export function sceneReviewState(scene: SceneNode): SceneStage {
  if (scene.takes.some(take => take.status === 'APPROVED')) return 'APPROVED';
  if (scene.takes.some(take => take.status === 'READY' || take.status === 'REJECTED')) return 'REVIEW';
  if (scene.takes.some(take => take.status === 'MAKING' || take.status === 'QUEUED')) return 'MAKING';
  return scene.stage;
}

export function parseReferenceGraph(raw: string): ReferenceProjectGraph | null {
  try {
    const parsed = JSON.parse(raw) as ReferenceProjectGraph;
    if (parsed?.version !== 1 || !parsed.deck || !Array.isArray(parsed.scenes)) return null;
    return refreshGraph(recoverInterruptedReferenceGraph(parsed));
  } catch {
    return null;
  }
}

export function serializeReferenceGraph(graph: ReferenceProjectGraph): string {
  return JSON.stringify(refreshGraph(graph), null, 2);
}
