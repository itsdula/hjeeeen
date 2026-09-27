// لوحة التفكير — sync layer. Stage 1 is the single source of truth; the mind
// canvas is a spatial PROJECTION of it. This module renders MindData into
// nodes+edges (materialize — preserving the user's positions for entities
// that already sit on the canvas) and folds node edits back into stage 1
// with the same read-merge-write discipline the three existing writers use.

import type { NodeInstance, GraphEdge } from '../node-engine/types';
import type { MindData } from '../creativemind/engine';
import { EMPTY_MIND, entityId, renderMindMarkdown } from '../creativemind/engine';
import { ALL_CARDS } from '../compiler';

// ─── entity refs ─────────────────────────────────────────────────────────────

export type MindEntityKind =
  | 'brief' | 'proposition' | 'persona' | 'gaps'
  | 'seed' | 'collision' | 'territory' | 'note' | 'answer';

export const entityRef = (kind: MindEntityKind, id = ''): string => id ? `${kind}:${id}` : kind;

export function parseEntity(ref: unknown): { kind: MindEntityKind; id: string } | null {
  if (typeof ref !== 'string' || !ref) return null;
  const i = ref.indexOf(':');
  const kind = (i === -1 ? ref : ref.slice(0, i)) as MindEntityKind;
  return { kind, id: i === -1 ? '' : ref.slice(i + 1) };
}

// ─── layout (deterministic columns; the user re-arranges freely after) ──────

const L = {
  brief: { x: 60, y: 260 },
  analysis: (i: number) => ({ x: 480, y: 80 + i * 210 }),          // proposition/persona/gaps
  seed: (i: number) => ({ x: 860, y: 60 + i * 214 }),
  collision: (j: number) => ({ x: 1230 + Math.floor(j / 8) * 320, y: 60 + (j % 8) * 186 }),
  territory: (i: number) => ({ x: 1680, y: 80 + i * 392 }),
  note: (i: number) => ({ x: 60, y: 640 + i * 166 }),
  answer: (i: number) => ({ x: 60, y: 640 + i * 186 }),
};

let seq = 0;
const nid = () => `mn_${Date.now().toString(36)}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// ─── materialize: MindData → nodes + edges ──────────────────────────────────

/** Ensure every collision/territory carries a stable id (legacy data).
 *  Returns true if anything was assigned (caller persists stage 1). */
export function ensureEntityIds(data: MindData): boolean {
  let changed = false;
  for (const c of data.collisions ?? []) {
    if (!c.id) { c.id = entityId('col'); changed = true; }
  }
  for (const t of data.territories ?? []) {
    if (!t.id) { t.id = entityId('ter'); changed = true; }
  }
  return changed;
}

export interface Materialized { nodes: NodeInstance[]; edges: GraphEdge[] }

/** Project MindData onto the canvas. `existing` nodes keep their id+position
 *  (matched by entity ref); missing entities get new nodes at deterministic
 *  spots; user-added non-mind nodes are left untouched by the caller (we only
 *  return the mind set — merge is the caller's job). */
export function materializeMind(data: MindData, existing: NodeInstance[]): Materialized {
  const byRef = new Map<string, NodeInstance>();
  for (const n of existing) {
    const ref = typeof n.paramValues?.entity === 'string' ? (n.paramValues.entity as string) : '';
    if (ref) byRef.set(ref, n);
  }

  const nodes: NodeInstance[] = [];
  const edges: GraphEdge[] = [];
  const idOf = new Map<string, string>();   // entity ref → node id

  const put = (
    type: string, ref: string, pos: { x: number; y: number },
    params: Record<string, unknown>,
  ): string => {
    const prev = byRef.get(ref);
    const node: NodeInstance = {
      id: prev?.id ?? nid(),
      type,
      position: prev?.position ?? pos,
      paramValues: { ...prev?.paramValues, ...params, entity: ref },
      name: prev?.name,
      favorite: prev?.favorite,
      colorLabel: prev?.colorLabel,
    };
    nodes.push(node);
    idOf.set(ref, node.id);
    return node.id;
  };

  const wire = (fromRef: string, toRef: string) => {
    const from = idOf.get(fromRef);
    const to = idOf.get(toRef);
    if (!from || !to) return;
    edges.push({ id: nid(), from: { node: from, param: 'out' }, to: { node: to, param: 'in' } });
  };

  // brief
  put('mind.brief', 'brief', L.brief, { rawBrief: data.rawBrief ?? '' });

  // analysis row
  if ((data.proposition ?? '').trim() || byRef.has('proposition')) {
    put('mind.proposition', 'proposition', L.analysis(0), { text: data.proposition ?? '' });
    wire('brief', 'proposition');
  }
  if ((data.persona ?? '').trim() || byRef.has('persona')) {
    put('mind.persona', 'persona', L.analysis(1), { text: data.persona ?? '' });
    wire('brief', 'persona');
  }
  if ((data.gaps ?? []).length || byRef.has('gaps')) {
    put('mind.gaps', 'gaps', L.analysis(2), { text: (data.gaps ?? []).join('\n') });
    wire('brief', 'gaps');
  }

  // seeds
  const cardById = new Map(ALL_CARDS.map(c => [c.id, c]));
  (data.drawnCardIds ?? []).forEach((cardId, i) => {
    const card = cardById.get(cardId);
    const ref = entityRef('seed', cardId);
    put('mind.seed', ref, L.seed(i), {
      cardId,
      dimension: card?.dimension ?? '',
      ar: card?.ar ?? '',
      en: card?.en ?? '',
    });
    wire('proposition', ref);
  });

  // collisions — wired from their seed when it sits on the canvas
  (data.collisions ?? []).forEach((c, j) => {
    const ref = entityRef('collision', c.id ?? `idx${j}`);
    put('mind.collision', ref, L.collision(j), {
      machine: c.machine, idea: c.idea, kept: !!c.kept, seedRef: c.seed,
    });
    const seedRef = entityRef('seed', c.seed);
    if (idOf.has(seedRef)) wire(seedRef, ref);
    else if (idOf.has('proposition')) wire('proposition', ref);
  });

  // territories — lineage from the kept survivors (they pressed together)
  const keptRefs = (data.collisions ?? [])
    .map((c, j) => ({ c, ref: entityRef('collision', c.id ?? `idx${j}`) }))
    .filter(x => x.c.kept)
    .map(x => x.ref);
  (data.territories ?? []).forEach((t, i) => {
    const ref = entityRef('territory', t.id ?? `idx${i}`);
    put('mind.territory', ref, L.territory(i), {
      name: t.name, hook: t.hook, insight: t.insight, culturalTruth: t.culturalTruth,
      big: !!t.name && data.bigIdea?.territory === t.name,
    });
    for (const k of keptRefs) wire(k, ref);
  });

  // Creative Mind visual answers — context column under the brief. The board
  // images the answer stood on ride along as newline-joined paths, so the
  // canvas SHOWS the pictures, not just the words (Anwar's law: the reference
  // frames are part of the visual arrangement).
  (data.visualWorld ?? []).forEach((a, i) => {
    const ref = entityRef('answer', `${a.questionId}`);
    put('mind.answer', ref, L.answer(i), {
      q: a.q ?? a.questionId, a: a.a ?? a.optionId, tags: a.tags.join(', '),
      refs: (a.refPaths ?? []).slice(0, 4).join('\n'),
    });
    wire('answer:' + a.questionId, 'brief');
  });

  return { nodes, edges };
}

/** Positions for nodes spawned OUTSIDE materialize (notes import). */
export const noteSpot = L.note;

/** Legacy answers stored only frame IDS — resolve them to on-disk paths once
 *  (via the boards folder) and persist, so the canvas can show the pictures. */
export async function resolveAnswerRefPaths(
  projectId: string, projectName: string | undefined, data: MindData,
): Promise<void> {
  const missing = (data.visualWorld ?? []).filter(
    a => (!a.refPaths || a.refPaths.length === 0) && (a.refIds?.length ?? 0) > 0,
  );
  if (!missing.length) return;
  try {
    const res = await window.hjen.mindBoardPaths({ ids: missing.flatMap(a => a.refIds) });
    if (!res?.ok) return;
    const byKey = new Map<string, string[]>();
    for (const a of missing) {
      const paths = (a.refIds ?? []).map(id => res.paths[id]).filter(Boolean);
      if (paths.length) {
        a.refPaths = paths;   // in-memory for this materialization
        byKey.set(`${a.questionId}:${a.optionId}`, paths);
      }
    }
    if (byKey.size) {
      queueStageWrite(projectId, projectName, (d) => {
        for (const a of d.visualWorld ?? []) {
          const hit = byKey.get(`${a.questionId}:${a.optionId}`);
          if (hit && (!a.refPaths || a.refPaths.length === 0)) a.refPaths = hit;
        }
      });
    }
  } catch { /* answers render without pictures; resolution retries next open */ }
}

// ─── node edits → stage 1 (read-merge-write, debounced per project) ─────────

export type MindPatch = Partial<Pick<MindData,
  'rawBrief' | 'proposition' | 'persona' | 'gaps' | 'collisions' | 'territories' | 'bigIdea' | 'drawnCardIds'>>;

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingProject: string | null = null;
let pendingPatches: Array<(d: MindData) => void> = [];

/** Queue a mutation of stage-1 data; flushed debounced (600ms) with a fresh
 *  read so concurrent writers (cards view, composer) are never clobbered. */
export function queueStageWrite(projectId: string, projectName: string | undefined, mutate: (d: MindData) => void): void {
  if (pendingProject && pendingProject !== projectId) void flushStageWrites(projectName);
  pendingProject = projectId;
  pendingPatches.push(mutate);
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => { void flushStageWrites(projectName); }, 600);
}

export async function flushStageWrites(projectName?: string): Promise<void> {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  const projectId = pendingProject;
  const patches = pendingPatches;
  pendingProject = null;
  pendingPatches = [];
  if (!projectId || patches.length === 0) return;
  try {
    const disk = await window.hjen.readStageData({ id: projectId, stage: 1 });
    const data: MindData = { ...EMPTY_MIND, ...(disk && typeof disk === 'object' ? disk as Partial<MindData> : {}) };
    for (const p of patches) p(data);
    await window.hjen.writeStageData({
      id: projectId, stage: 1,
      data: { ...data, updatedAt: new Date().toISOString() },
      markdown: renderMindMarkdown(data, projectName),
    });
  } catch { /* the canvas keeps its state; next edit retries */ }
}

/** Read stage 1 fresh (canvas entry / actions). */
export async function readMind(projectId: string): Promise<MindData> {
  try {
    const disk = await window.hjen.readStageData({ id: projectId, stage: 1 });
    return { ...EMPTY_MIND, ...(disk && typeof disk === 'object' ? disk as Partial<MindData> : {}) };
  } catch {
    return { ...EMPTY_MIND };
  }
}

/** Fold ONE node param edit into stage 1 (queued). */
export function applyNodeEdit(
  projectId: string, projectName: string | undefined,
  ref: { kind: MindEntityKind; id: string }, param: string, value: unknown,
): void {
  const v = value;
  queueStageWrite(projectId, projectName, (d) => {
    switch (ref.kind) {
      case 'brief':
        if (param === 'rawBrief') d.rawBrief = String(v ?? '');
        break;
      case 'proposition':
        if (param === 'text') d.proposition = String(v ?? '');
        break;
      case 'persona':
        if (param === 'text') d.persona = String(v ?? '');
        break;
      case 'gaps':
        if (param === 'text') d.gaps = String(v ?? '').split('\n').map(x => x.trim()).filter(Boolean);
        break;
      case 'collision': {
        const c = (d.collisions ?? []).find(x => x.id === ref.id);
        if (!c) break;
        if (param === 'idea') c.idea = String(v ?? '');
        if (param === 'kept') c.kept = !!v;
        break;
      }
      case 'territory': {
        const t = (d.territories ?? []).find(x => x.id === ref.id);
        if (!t) break;
        const prevName = t.name;
        if (param === 'name') t.name = String(v ?? '');
        if (param === 'hook') t.hook = String(v ?? '');
        if (param === 'insight') t.insight = String(v ?? '');
        if (param === 'culturalTruth') t.culturalTruth = String(v ?? '');
        if (param === 'big' && v) d.bigIdea = { territory: t.name, why: d.bigIdea?.why ?? '' };
        if (param === 'name' && d.bigIdea?.territory === prevName) {
          d.bigIdea = { territory: t.name, why: d.bigIdea?.why ?? '' };
        }
        break;
      }
      default:
        break;   // seed/note/answer bodies are read-only toward stage 1 in v1
    }
  });
}
