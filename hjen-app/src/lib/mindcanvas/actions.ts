// لوحة التفكير — generative actions. The thinking machines fired FROM the
// canvas: analyze from the brief node, draw seeds, collide, press — each call
// runs the SHARED Brief-Mind engine (one brain, three surfaces), writes stage 1
// (source of truth), then re-materializes the canvas so new thoughts land as
// nodes wired to their ancestry. GraphEngine is never involved — mind canvases
// don't run; they think.

import { create } from 'zustand';
import { useStore } from '../../store';
import type { NodeInstance } from '../node-engine/types';
import type { BriefCollision, BriefTerritory } from '../../types/preprod';
import {
  MACHINES, entityId, drawSeedCards, asList,
  runAnalyze, runCollide, runPress,
} from '../creativemind/engine';
import { ALL_CARDS } from '../compiler';
import {
  materializeMind, ensureEntityIds, readMind, queueStageWrite, flushStageWrites,
  entityRef, noteSpot, resolveAnswerRefPaths,
} from './sync';
import { loadNotes } from '../creativemind/zettel';

// ─── tiny UI-state store (busy per action + last error) ─────────────────────

interface MindCanvasUi {
  busy: string | null;            // 'analyze' | 'collide' | 'press' | null
  error: string | null;
  setBusy: (b: string | null) => void;
  setError: (e: string | null) => void;
}
export const useMindCanvas = create<MindCanvasUi>((set) => ({
  busy: null,
  error: null,
  setBusy: (busy) => set({ busy, ...(busy ? { error: null } : {}) }),
  setError: (error) => set({ error, busy: null }),
}));

// ─── canvas plumbing ─────────────────────────────────────────────────────────

function activeProject(): { id: string; name?: string } | null {
  const s = useStore.getState();
  const id = s.activeProjectId;
  if (!id) return null;
  const p = s.projects.find(x => x.id === id);
  return { id, name: p?.name };
}

/** Replace the mind projection on the current canvas, preserving positions of
 *  surviving entities and keeping any non-mind nodes the user added. */
async function rematerialize(): Promise<void> {
  const proj = activeProject();
  if (!proj) return;
  await flushStageWrites(proj.name);         // fold pending edits first
  const data = await readMind(proj.id);
  await resolveAnswerRefPaths(proj.id, proj.name, data);   // pictures for legacy answers
  if (ensureEntityIds(data)) {
    // persist the freshly assigned ids by position, so the canvas refs hold
    const colIds = (data.collisions ?? []).map(c => c.id);
    const terIds = (data.territories ?? []).map(t => t.id);
    queueStageWrite(proj.id, proj.name, (d) => {
      (d.collisions ?? []).forEach((c, i) => { if (!c.id && colIds[i]) c.id = colIds[i]; });
      (d.territories ?? []).forEach((t, i) => { if (!t.id && terIds[i]) t.id = terIds[i]; });
    });
    await flushStageWrites(proj.name);
  }
  const s = useStore.getState();
  // Breakdown / My-Mind nodes are NOT stage-1 projections — materializeMind
  // never re-produces them, so they must survive this partition or the first
  // Collide/Press wipes the breakdown off the canvas.
  const isStage1Node = (n: NodeInstance) =>
    n.type.startsWith('mind.') && !n.type.startsWith('mind.bd') && n.type !== 'mind.myMind';
  const mindNodes = s.graphNodes.filter(isStage1Node);
  const keepNodes = s.graphNodes.filter(n => !isStage1Node(n));
  const keepIds = new Set(keepNodes.map(n => n.id));
  const keepEdges = s.graphEdges.filter(e => keepIds.has(e.from.node) && keepIds.has(e.to.node));
  const m = materializeMind(data, mindNodes);
  useStore.setState({
    graphNodes: [...keepNodes, ...m.nodes],
    graphEdges: [...keepEdges, ...m.edges],
  });
  s.persistGraph();
}

/** Open (or create) this project's mind canvas inside the NODE view and
 *  project stage-1 data onto it. The entry point of the Cards→Canvas toggle. */
export async function openMindCanvas(): Promise<void> {
  const s = useStore.getState();
  const proj = activeProject();
  if (!proj) return;
  await s.loadGraphForProject(proj.id);
  const after = useStore.getState();
  const mind = after.canvasList.find(c => c.kind === 'mind');
  if (mind) {
    if (after.activeCanvasId !== mind.id) after.switchCanvas(mind.id);
  } else {
    after.createCanvas('Brief Mind', 'mind');
  }
  await rematerialize();
  useStore.getState().setActiveView('node');
}

// ─── generative actions ──────────────────────────────────────────────────────

function ledger(body: string): void {
  void useStore.getState().addLedgerEntry({ kind: 'note', body });
}

/** Read the brief — fired from the mind.brief node. */
export async function analyzeFromCanvas(briefNode: NodeInstance): Promise<void> {
  const proj = activeProject();
  const raw = String(briefNode.paramValues.rawBrief ?? '').trim();
  if (!proj || !raw || useMindCanvas.getState().busy) return;
  useMindCanvas.getState().setBusy('analyze');
  const res = await runAnalyze(raw);
  if (!res.ok) { useMindCanvas.getState().setError(res.message); return; }
  const j = res.json;
  const species = (['strategy', 'project-management', 'production-task'] as const)
    .find(x => x === j.species);
  queueStageWrite(proj.id, proj.name, (d) => {
    d.rawBrief = raw;
    d.species = species;
    d.proposition = (j.proposition ?? '').trim();
    d.persona = (j.persona ?? '').trim();
    d.gaps = asList(j.gaps);
    d.questionsLog = asList(j.questionsLog);
    d.restatement = (j.restatement ?? '').trim() || d.restatement;
  });
  ledger(`Brief Mind: brief analyzed — ${species ?? 'unclassified'}, ${asList(j.gaps).length} gaps flagged.`);
  await rematerialize();
  useMindCanvas.getState().setBusy(null);
}

/** Draw 4–6 dimension-diverse DNA seeds onto the canvas. */
export async function drawSeedsOnCanvas(): Promise<void> {
  const proj = activeProject();
  if (!proj || useMindCanvas.getState().busy) return;
  const data = await readMind(proj.id);
  const seedText = `${data.proposition ?? ''} ${data.rawBrief ?? ''}`.trim();
  const cards = drawSeedCards(seedText);
  queueStageWrite(proj.id, proj.name, (d) => { d.drawnCardIds = cards.map(c => c.id); });
  ledger(`Brief Mind: ${cards.length} cards drawn — boring is good.`);
  await rematerialize();
}

/** Re-draw ONE seed node's card. */
export async function rerollSeedOnCanvas(seedNode: NodeInstance): Promise<void> {
  const proj = activeProject();
  if (!proj) return;
  const currentCard = String(seedNode.paramValues.cardId ?? '');
  const data = await readMind(proj.id);
  const drawn = data.drawnCardIds ?? [];
  const pool = ALL_CARDS.filter(c => !c.always && !drawn.includes(c.id));
  if (pool.length === 0) return;
  const next = pool[Math.floor(Math.random() * pool.length)];
  queueStageWrite(proj.id, proj.name, (d) => {
    d.drawnCardIds = (d.drawnCardIds ?? []).map(id => id === currentCard ? next.id : id);
  });
  await rematerialize();
}

/** Collide ×10 — the machines run on every seed on the canvas. */
export async function collideOnCanvas(): Promise<void> {
  const proj = activeProject();
  if (!proj || useMindCanvas.getState().busy) return;
  const data = await readMind(proj.id);
  const cardById = new Map(ALL_CARDS.map(c => [c.id, c]));
  const cards = (data.drawnCardIds ?? [])
    .map(id => cardById.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map(c => ({ id: c.id, dimension: c.dimension, ar: c.ar, en: c.en }));
  if (cards.length === 0) return;
  useMindCanvas.getState().setBusy('collide');
  const res = await runCollide({
    proposition: data.proposition ?? '',
    persona: data.persona ?? '',
    cards,
    visualWorld: data.visualWorld,
  });
  if (!res.ok) { useMindCanvas.getState().setError(res.message); return; }
  const list: BriefCollision[] = (res.json.collisions ?? [])
    .map(c => ({
      id: entityId('col'),
      seed: String(c.seed ?? '').trim() || 'unseeded',
      machine: MACHINES.find(m => m === c.machine) ?? 'collision' as const,
      idea: String(c.idea ?? '').trim(),
      kept: false,
    }))
    .filter(c => c.idea);
  if (list.length === 0) { useMindCanvas.getState().setError('The collider came back empty — try again.'); return; }
  queueStageWrite(proj.id, proj.name, (d) => { d.collisions = list; });
  ledger(`Brief Mind: ${list.length} collisions logged — kill-gate open.`);
  await rematerialize();
  useMindCanvas.getState().setBusy(null);
}

/** Press the kept survivors into exactly three territories + a Big Idea. */
export async function pressOnCanvas(): Promise<void> {
  const proj = activeProject();
  if (!proj || useMindCanvas.getState().busy) return;
  const data = await readMind(proj.id);
  const survivors = (data.collisions ?? []).filter(c => c.kept)
    .map(({ seed, machine, idea }) => ({ seed, machine, idea }));
  if (survivors.length === 0) {
    useMindCanvas.getState().setError('Keep at least one collision — the press only takes survivors.');
    return;
  }
  useMindCanvas.getState().setBusy('press');
  const res = await runPress({
    proposition: data.proposition ?? '',
    persona: data.persona ?? '',
    survivors,
    visualWorld: data.visualWorld,
  });
  if (!res.ok) { useMindCanvas.getState().setError(res.message); return; }
  const terrs: BriefTerritory[] = (res.json.territories ?? []).slice(0, 3).map(t => ({
    id: entityId('ter'),
    name: String(t.name ?? '').trim(),
    hook: String(t.hook ?? '').trim(),
    insight: String(t.insight ?? '').trim(),
    firstFrameHint: String(t.firstFrameHint ?? '').trim(),
    culturalTruth: String(t.culturalTruth ?? '').trim(),
  })).filter(t => t.name);
  if (terrs.length === 0) { useMindCanvas.getState().setError('No territories survived the press — kill-gate again, then retry.'); return; }
  const big = res.json.bigIdea;
  const bigTerritory = String(big?.territory ?? '').trim();
  const bigIdea = terrs.some(t => t.name === bigTerritory)
    ? { territory: bigTerritory, why: String(big?.why ?? '').trim() }
    : { territory: terrs[0].name, why: String(big?.why ?? '').trim() };
  queueStageWrite(proj.id, proj.name, (d) => { d.territories = terrs; d.bigIdea = bigIdea; });
  ledger(`Brief Mind: ${terrs.length} territories pressed — big idea "${bigIdea.territory}".`);
  await rematerialize();
  useMindCanvas.getState().setBusy(null);
}

/** Import Zettel notes as free-floating thought nodes (canvas-only; the notes
 *  file stays the source — these nodes are references, not copies to sync). */
export async function importNotesOnCanvas(): Promise<void> {
  const notes = await loadNotes();
  if (notes.length === 0) return;
  const s = useStore.getState();
  const have = new Set(
    s.graphNodes
      .filter(n => n.type === 'mind.note')
      .map(n => String(n.paramValues.entity ?? '')),
  );
  const fresh = notes.filter(n => !have.has(entityRef('note', n.id)));
  const startIdx = have.size;
  const newNodes: NodeInstance[] = fresh.map((n, i) => ({
    id: `mn_note_${n.id}`,
    type: 'mind.note',
    position: noteSpot(startIdx + i),
    paramValues: {
      text: n.text,
      dimension: n.dimension ?? '',
      entity: entityRef('note', n.id),
    },
  }));
  if (newNodes.length === 0) return;
  useStore.setState({ graphNodes: [...s.graphNodes, ...newNodes] });
  s.persistGraph();
}

export { rematerialize as rematerializeMindCanvas };
