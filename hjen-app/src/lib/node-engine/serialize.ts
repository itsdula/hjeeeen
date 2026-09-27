// Graph (de)serialization. Runtime/outputs are never serialized — they are
// recomputed on Run. Used for per-project persistence and portable .json export.

import type { GraphDoc, NodeInstance, GraphEdge } from './types';
import { getNodeSpec } from './registry';

export function graphToDoc(
  nodes: NodeInstance[],
  edges: GraphEdge[],
  meta: { id: string; name: string; createdAt?: string },
): GraphDoc {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id: meta.id,
    name: meta.name,
    nodes: nodes.map(n => ({ ...n, paramValues: { ...n.paramValues } })),
    edges: edges.map(e => ({ ...e })),
    matrices: [],
    createdAt: meta.createdAt ?? now,
    updatedAt: now,
  };
}

/** Rehydrate a doc into live nodes/edges. Drops edges whose endpoints/params no
 *  longer exist in the registry (forward-compat when a node type changes). */
export function docToGraph(raw: unknown): { nodes: NodeInstance[]; edges: GraphEdge[]; matrices: GraphDoc['matrices'] } {
  const doc = migrateGraphDoc(raw);
  const liveIds = new Set(doc.nodes.map(n => n.id));
  const edges = doc.edges.filter(e => {
    if (!liveIds.has(e.from.node) || !liveIds.has(e.to.node)) return false;
    const fromN = doc.nodes.find(n => n.id === e.from.node)!;
    const toN = doc.nodes.find(n => n.id === e.to.node)!;
    const fs = getNodeSpec(fromN.type);
    const ts = getNodeSpec(toN.type);
    const hasFrom = fs?.params.some(p => p.name === e.from.param && p.kind === 'output');
    const hasTo = ts?.params.some(p => p.name === e.to.param && p.kind === 'input');
    return !!hasFrom && !!hasTo;
  });
  return { nodes: doc.nodes, edges, matrices: doc.matrices ?? [] };
}

/** Migration ladder. v1 (legacy node-to-node edges) → v2 (param-aware edges). */
export function migrateGraphDoc(raw: any): GraphDoc {
  if (!raw || typeof raw !== 'object') {
    const now = new Date().toISOString();
    return { schemaVersion: 2, id: 'graph', name: 'Graph', nodes: [], edges: [], matrices: [], createdAt: now, updatedAt: now };
  }
  // v1 → v2: edges were { id, from: nodeId, to: nodeId }. Map to the single
  // output/input param of each endpoint.
  if (raw.schemaVersion !== 2 && Array.isArray(raw.edges)) {
    const nodes: NodeInstance[] = (raw.nodes ?? []).map((n: any) => ({
      id: n.id,
      type: n.type ?? n.kind,
      position: n.position ?? { x: n.x ?? 0, y: n.y ?? 0 },
      paramValues: n.paramValues ?? {},
    }));
    const edges: GraphEdge[] = (raw.edges ?? []).map((e: any, i: number) => {
      if (e.from && typeof e.from === 'object') return e as GraphEdge; // already v2-shaped
      const fromN = nodes.find(n => n.id === e.from);
      const toN = nodes.find(n => n.id === e.to);
      const fs = fromN ? getNodeSpec(fromN.type) : undefined;
      const ts = toN ? getNodeSpec(toN.type) : undefined;
      const outParam = fs?.params.find(p => p.kind === 'output')?.name ?? 'out';
      const inParam = ts?.params.find(p => p.kind === 'input')?.name ?? 'asset';
      return { id: e.id ?? `e${i}`, from: { node: e.from, param: outParam }, to: { node: e.to, param: inParam } };
    });
    const now = new Date().toISOString();
    return { schemaVersion: 2, id: raw.id ?? 'graph', name: raw.name ?? 'Graph', nodes, edges, matrices: raw.matrices ?? [], view: raw.view, createdAt: raw.createdAt ?? now, updatedAt: now };
  }
  return raw as GraphDoc;
}
