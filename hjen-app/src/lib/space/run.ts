// RUNNING ONE STEP — the other half of Anwar's contract.
//
// "الوكيل ينفّذها في مكانها" — a pressed step executes inside SPACE and leaves a
// node on the board. The user never leaves to get work done. Where a tool
// genuinely needs its own room we OPEN it and say so, rather than claiming a
// run we did not perform.
//
// Nothing here starts on its own. Every function in this file is reached by a
// press. That is the WAIT half of the contract, enforced by there being no
// scheduler anywhere in the module.

import { useStore } from '../../store';
import { llmForTask } from '../models/registry';
import { openStudioProduct } from '../../components/ProductHub';
import { nodeTypeFor, imageInputOf, type PlanStep, type Pipeline, type SpacePlan } from './plan';
import { GraphEngine } from '../node-engine/engine';
import { registerBuiltinNodes } from '../node-engine/nodes';
import { getNodeSpec } from '../node-engine/registry';

/** Where the next node lands. Steps stack left-to-right in a loose row per
 *  pipeline so a plan reads on the board the way it reads in the rail. */
function dropPoint(index: number, row: number): { x: number; y: number } {
  return { x: 80 + index * 232, y: 120 + row * 300 };
}

/** Put a node on the board for this step and return its id. */
function placeNode(type: string, at: { x: number; y: number }, params: Record<string, unknown>): string | null {
  registerBuiltinNodes();
  if (!getNodeSpec(type)) return null;
  const st = useStore.getState();
  const before = new Set(st.graphNodes.map(n => n.id));
  st.addGraphNode(type, at);
  const made = useStore.getState().graphNodes.find(n => !before.has(n.id));
  if (!made) return null;
  for (const [k, v] of Object.entries(params)) useStore.getState().setNodeParam(made.id, k, v);
  return made.id;
}

/** Run ONE node through the engine — the same machinery Run uses, pointed at a
 *  single node instead of the whole graph. This is what "in place" means: not a
 *  second code path, the real one. */
async function runOneNode(nodeId: string, onStatus: (text: string) => void): Promise<{ ok: boolean; message?: string }> {
  const st = useStore.getState();
  const node = st.graphNodes.find(n => n.id === nodeId);
  if (!node) return { ok: false, message: 'The node went missing.' };
  // Feed the node its wired inputs too, so a step that follows another step
  // gets the earlier one's output exactly as a full Run would hand it over.
  const edges = st.graphEdges.filter(e => e.to.node === nodeId);
  const upstream = st.graphNodes.filter(n => edges.some(e => e.from.node === n.id));
  const proj = st.activeProject();
  const engine = new GraphEngine();
  try {
    await engine.run([...upstream, node], edges, {
      project: proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null,
      concurrency: 1,
      onNodeStatus: (id, patch) => {
        useStore.setState(s => ({ nodeRuntime: { ...s.nodeRuntime, [id]: { ...(s.nodeRuntime[id] ?? { status: 'idle' }), ...patch } } }));
        if (id === nodeId && patch.statusText) onStatus(patch.statusText);
      },
    });
    const rt = useStore.getState().nodeRuntime[nodeId];
    if (rt?.status === 'error') return { ok: false, message: rt.statusText || 'The step failed.' };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
}

export interface StepContext {
  plan: SpacePlan;
  pipeline: Pipeline;
  step: PlanStep;
  /** Index of this step's pipeline in the plan, and of the step in the pipeline
   *  — together they decide where the node lands. */
  row: number;
  index: number;
  /** Node the previous step in this pipeline left behind, if any — a make-step
   *  wires itself to it so the pipeline is a real chain, not a row of orphans. */
  prevNodeId?: string;
  /** Report progress back to the rail. */
  patch: (p: Partial<PlanStep>) => void;
}

export async function runStep(ctx: StepContext): Promise<void> {
  const { step, pipeline, plan, patch } = ctx;
  if (step.state === 'running') return;

  // Already made its node — press again to find it, not to duplicate it.
  if (step.nodeId && useStore.getState().graphNodes.some(n => n.id === step.nodeId)) {
    useStore.getState().selectGraphNode(step.nodeId);
    return;
  }

  if (step.kind === 'open') {
    // We are NOT claiming to have run this. The tool's room opens; the step is
    // marked open and only the user can call it done.
    patch({ state: 'open', note: 'opened' });
    openStudioProduct(step.tool);
    return;
  }

  patch({ state: 'running', note: 'starting…' });

  if (step.kind === 'make') {
    const type = nodeTypeFor(step.tool)!;
    // Frame takes its direction from the step's own line; Enhancer has no
    // prompt at all. Setting a param a spec doesn't declare is a silent no-op,
    // so only send what the node actually reads.
    const params: Record<string, unknown> = (type === 'frame' || type === 'video')
      ? { prompt: `${step.label}. ${plan.ask}` } : {};
    const id = placeNode(type, dropPoint(ctx.index, ctx.row), params);
    if (!id) { patch({ state: 'failed', note: 'no node for this tool' }); return; }
    patch({ nodeId: id });

    // Chain it to the step before it. Without this a pipeline is three orphan
    // nodes standing in a row — the wire is what makes it a pipeline.
    const prev = ctx.prevNodeId;
    const inParam = imageInputOf(type);
    if (prev && inParam && useStore.getState().graphNodes.some(n => n.id === prev)) {
      useStore.getState().addGraphEdge({ node: prev, param: 'out' }, { node: id, param: inParam });
    }

    const res = await runOneNode(id, t => patch({ note: t }));
    patch(res.ok ? { state: 'done', note: '' } : { state: 'failed', note: res.message?.slice(0, 60) });
    return;
  }

  // 'write' — the deliverable IS the text. One call, and it lands as a text
  // node so the work is on the board like everything else.
  const res = await llmForTask('space-write', {
    system: 'You execute one step of a laid-out production and return ONLY {"text":"…","note":"…"}. No preamble.',
    promptId: 'space.write',
    vars: { ask: plan.ask, pipeline: pipeline.name, step: step.label, tool: step.tool },
    prompt: `THE ASK\n${plan.ask}\n\nPIPELINE\n${pipeline.name} — ${pipeline.sub}\n\nTHIS STEP\n${step.label}  (tool: ${step.tool})`,
    maxTokens: 900,
  });
  if (!res.ok || !res.text) { patch({ state: 'failed', note: (res.message || 'no answer').slice(0, 60) }); return; }

  let text = res.text.trim(), note = '';
  try {
    const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    const parsed = JSON.parse((m ? m[1] : text).trim());
    if (typeof parsed?.text === 'string') text = parsed.text;
    if (typeof parsed?.note === 'string') note = parsed.note;
  } catch { /* not JSON — the prose itself is the deliverable */ }

  // The text node holds only `text`, so the step's own line becomes its heading.
  const id = placeNode('text', dropPoint(ctx.index, ctx.row), { text: `${step.label}\n\n${text}` });
  patch({ state: 'done', note: note.slice(0, 40), nodeId: id ?? undefined });
}
