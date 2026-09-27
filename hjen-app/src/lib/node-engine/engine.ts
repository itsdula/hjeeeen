// GraphEngine — the execution layer. Data-flow scheduling (a node runs once all
// its connected, non-optional inputs have values) over a topological order,
// with bounded concurrency and a single shared AbortController for cancellation.
//
// Griptape's DataNode-vs-ControlNode split collapses here: both run as async
// functions on the event loop. DataNodes resolve fast (no I/O); ControlNodes
// await network/generation. No worker thread needed in a single-renderer app.

import type { NodeInstance, GraphEdge, NodeRuntime, DataValue, NodeProcessResult } from './types';
import { getNodeSpec, paramsByKind } from './registry';
import { isAssignable } from './values';

export interface EngineCallbacks {
  /** Called on every per-node status transition so the store can mirror it. */
  onNodeStatus: (nodeId: string, patch: Partial<NodeRuntime>) => void;
  project: { id: string; name: string; slug: string } | null;
  /** Max nodes running at once. Default 2. */
  concurrency?: number;
}

/** Validate the graph: type-checks edges, detects cycles, verifies required
 *  inputs are satisfied (by an edge, an override, or a default). Throws. */
export function validateGraph(nodes: NodeInstance[], edges: GraphEdge[]): void {
  const byId = new Map(nodes.map(n => [n.id, n]));

  // Edge type compatibility.
  for (const e of edges) {
    const fromN = byId.get(e.from.node);
    const toN = byId.get(e.to.node);
    if (!fromN || !toN) continue; // tolerate dangling — they simply carry no value
    const fs = getNodeSpec(fromN.type);
    const ts = getNodeSpec(toN.type);
    const op = fs?.params.find(p => p.name === e.from.param && p.kind === 'output');
    const ip = ts?.params.find(p => p.name === e.to.param && p.kind === 'input');
    if (op && ip && !isAssignable(op.dataType, ip.dataType)) {
      throw new Error(
        `Type mismatch: ${fromN.type}.${e.from.param} (${op.dataType}) → ${toN.type}.${e.to.param} (${ip.dataType})`,
      );
    }
  }

  // Cycle detection (DFS with white/gray/black colors).
  const adj = new Map<string, string[]>();
  nodes.forEach(n => adj.set(n.id, []));
  edges.forEach(e => { if (adj.has(e.from.node)) adj.get(e.from.node)!.push(e.to.node); });
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (u: string): void => {
    color.set(u, 1);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? 0;
      if (c === 1) throw new Error('Graph has a cycle — pipelines must be acyclic.');
      if (c === 0) visit(v);
    }
    color.set(u, 2);
  };
  for (const n of nodes) if ((color.get(n.id) ?? 0) === 0) visit(n.id);

  // Required inputs.
  for (const n of nodes) {
    const spec = getNodeSpec(n.type);
    if (!spec) throw new Error(`Unknown node type "${n.type}".`);
    for (const p of spec.params.filter(p => p.kind === 'input' && !p.optional)) {
      const hasEdge = edges.some(e => e.to.node === n.id && e.to.param === p.name);
      const hasVal = n.paramValues[p.name] !== undefined || p.default !== undefined;
      if (!hasEdge && !hasVal) {
        throw new Error(`${spec.label} node is missing required input "${p.label}".`);
      }
    }
  }
}

export class GraphEngine {
  private abort = new AbortController();

  cancel(): void { this.abort.abort(); }
  get aborted(): boolean { return this.abort.signal.aborted; }

  /** Run the graph. Resolves when every reachable node has settled (or the run
   *  was cancelled / failed-fast). Returns the final per-node runtimes. */
  async run(nodes: NodeInstance[], edges: GraphEdge[], cb: EngineCallbacks): Promise<Map<string, NodeRuntime>> {
    const runtimes = new Map<string, NodeRuntime>();
    const setRt = (id: string, patch: Partial<NodeRuntime>) => {
      const cur = runtimes.get(id) ?? { status: 'idle' as const };
      runtimes.set(id, { ...cur, ...patch });
      cb.onNodeStatus(id, patch);
    };

    // Only execute nodes that participate in the graph. An isolated node (no
    // edges) sitting on the board is skipped — you wire a node to include it in
    // a run. Exception: a graph with NO edges at all runs every node (so a
    // single dropped node still executes).
    const hasAnyEdge = edges.length > 0;
    const connected = new Set<string>();
    edges.forEach(e => { connected.add(e.from.node); connected.add(e.to.node); });
    const activeNodes = hasAnyEdge ? nodes.filter(n => connected.has(n.id)) : nodes;

    validateGraph(activeNodes, edges);

    const nodeById = new Map(activeNodes.map(n => [n.id, n]));
    const outEdges = new Map<string, GraphEdge[]>();
    const inEdges = new Map<string, GraphEdge[]>();
    activeNodes.forEach(n => { outEdges.set(n.id, []); inEdges.set(n.id, []); });
    edges.forEach(e => {
      outEdges.get(e.from.node)?.push(e);
      inEdges.get(e.to.node)?.push(e);
    });

    const valuesByEdge = new Map<string, DataValue | undefined>();
    const remaining = new Map<string, number>();
    activeNodes.forEach(n => remaining.set(n.id, (inEdges.get(n.id) ?? []).length));
    activeNodes.forEach(n => setRt(n.id, { status: 'queued' }));

    const ready: string[] = activeNodes.filter(n => (remaining.get(n.id) ?? 0) === 0).map(n => n.id);
    const started = new Set<string>();
    const concurrency = Math.max(1, cb.concurrency ?? 2);
    const active = new Set<Promise<void>>();

    const launch = (id: string) => {
      started.add(id);
      const node = nodeById.get(id)!;
      const p = this.executeNode(node, inEdges, outEdges, valuesByEdge, setRt, cb)
        .then(() => {
          // Fan out: decrement successors' pending-input count; enqueue ready ones.
          for (const e of outEdges.get(id) ?? []) {
            const left = (remaining.get(e.to.node) ?? 0) - 1;
            remaining.set(e.to.node, left);
            if (left <= 0 && !started.has(e.to.node)) ready.push(e.to.node);
          }
        })
        .finally(() => { active.delete(p); });
      active.add(p);
    };

    while (ready.length || active.size) {
      if (this.abort.signal.aborted) break;
      while (ready.length && active.size < concurrency) launch(ready.shift()!);
      if (active.size) await Promise.race(active);
    }
    await Promise.allSettled(active);
    return runtimes;
  }

  private async executeNode(
    node: NodeInstance,
    inEdges: Map<string, GraphEdge[]>,
    outEdges: Map<string, GraphEdge[]>,
    valuesByEdge: Map<string, DataValue | undefined>,
    setRt: (id: string, patch: Partial<NodeRuntime>) => void,
    cb: EngineCallbacks,
  ): Promise<void> {
    const id = node.id;
    if (this.abort.signal.aborted) { setRt(id, { status: 'idle' }); return; }

    const spec = getNodeSpec(node.type);
    if (!spec) { setRt(id, { status: 'error', error: `Unknown node type "${node.type}"` }); this.abort.abort(); return; }

    // Resolve inputs: connected edge value, else paramValues override, else default.
    const inputs: Record<string, DataValue | undefined> = {};
    for (const p of paramsByKind(spec, 'input')) {
      const edge = (inEdges.get(id) ?? []).find(e => e.to.param === p.name);
      if (edge) inputs[p.name] = valuesByEdge.get(edge.id);
      else if (node.paramValues[p.name] !== undefined) inputs[p.name] = node.paramValues[p.name] as DataValue;
      else if (p.default !== undefined) inputs[p.name] = p.default as DataValue;
    }

    setRt(id, { status: 'running', startedAt: Date.now(), error: undefined });
    try {
      const out: NodeProcessResult = await spec.process({
        inputs,
        props: node.paramValues,
        signal: this.abort.signal,
        report: (status) => setRt(id, { statusText: status }),
        project: cb.project,
      });
      if (this.abort.signal.aborted) { setRt(id, { status: 'idle' }); return; }
      // Push each output value onto every edge leaving this node.
      for (const e of outEdges.get(id) ?? []) {
        valuesByEdge.set(e.id, out[e.from.param]);
      }
      setRt(id, { status: 'done', outputs: out, finishedAt: Date.now() });
    } catch (err: any) {
      if (this.abort.signal.aborted || err?.name === 'AbortError') {
        setRt(id, { status: 'idle' });
      } else {
        setRt(id, { status: 'error', error: err?.message || String(err), finishedAt: Date.now() });
        this.abort.abort(); // fail-fast (v1)
      }
    }
  }
}
