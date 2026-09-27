/** Project Creative Graph — the shared reasoning contract behind HJEN Creative.
 * UI surfaces are projections of this graph; no surface owns the idea alone. */

export type CreativeNodeKind =
  | 'source' | 'insight' | 'idea' | 'decision' | 'craft' | 'evidence'
  | 'critic' | 'artifact' | 'projection';

export type CreativeNodeStatus =
  | 'empty' | 'draft' | 'under-review' | 'rejected' | 'approved'
  | 'signed' | 'stale' | 'blocked';

export type CreativeEdgeKind =
  | 'derived-from' | 'constrained-by' | 'proves' | 'contradicts'
  | 'refuses' | 'requires' | 'appears-in' | 'approved-by'
  | 'invalidates' | 'exports-to';

export interface CreativeNode<T = unknown> {
  id: string;
  kind: CreativeNodeKind;
  label: string;
  status: CreativeNodeStatus;
  version: number;
  fingerprint: string;
  payload: T;
  provenance: Array<{
    surface: string;
    stage?: number;
    sourceNodeIds?: string[];
    at: string;
    by?: 'user' | 'graph' | 'migration';
  }>;
  previousFingerprints: string[];
  createdAt: string;
  updatedAt: string;
  signedAt?: string;
}

export interface CreativeEdge {
  id: string;
  from: string;
  to: string;
  kind: CreativeEdgeKind;
  label?: string;
  createdAt: string;
}

export interface CreativeGraphTrace {
  id: string;
  graphRevision: number;
  surface: string;
  action: string;
  nodeIds: string[];
  startedAt: string;
  finishedAt: string;
  costUsd?: number;
  notes?: string[];
}

export interface ProjectCreativeGraph {
  schemaVersion: 1;
  projectId: string;
  revision: number;
  nodes: CreativeNode[];
  edges: CreativeEdge[];
  traces: CreativeGraphTrace[];
  createdAt: string;
  updatedAt: string;
}

export function emptyProjectCreativeGraph(projectId: string): ProjectCreativeGraph {
  const now = new Date().toISOString();
  return { schemaVersion: 1, projectId, revision: 0, nodes: [], edges: [], traces: [], createdAt: now, updatedAt: now };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !['updatedAt', 'createdAt', 'syncedAt'].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function graphFingerprint(payload: unknown): string {
  const input = stable(payload);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `cg-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export interface UpsertNodeInput<T = unknown> {
  id: string; kind: CreativeNodeKind; label: string; payload: T;
  status?: CreativeNodeStatus;
  provenance: CreativeNode['provenance'][number];
}

/** Upsert one semantic node. A content change versions it and marks every
 * downstream consumer stale until that consumer is explicitly rebuilt. */
export function upsertCreativeNode<T>(graph: ProjectCreativeGraph, input: UpsertNodeInput<T>): { graph: ProjectCreativeGraph; changed: boolean } {
  const now = new Date().toISOString();
  const fingerprint = graphFingerprint(input.payload);
  const current = graph.nodes.find(node => node.id === input.id);
  if (current?.fingerprint === fingerprint) return { graph, changed: false };

  const next: ProjectCreativeGraph = structuredClone(graph);
  const index = next.nodes.findIndex(node => node.id === input.id);
  const node: CreativeNode<T> = current ? {
    ...current, kind: input.kind, label: input.label, payload: input.payload,
    fingerprint, version: current.version + 1,
    // A rebuilt projection is no longer stale. Signed contracts, however,
    // must return to review when their content changes.
    status: current.status === 'signed'
      ? 'under-review'
      : current.status === 'stale' && input.status
        ? input.status
        : (input.status ?? current.status),
    previousFingerprints: [...current.previousFingerprints, current.fingerprint].slice(-12),
    provenance: [...current.provenance, input.provenance].slice(-24), updatedAt: now,
    signedAt: undefined,
  } : {
    id: input.id, kind: input.kind, label: input.label, payload: input.payload,
    status: input.status ?? 'draft', version: 1, fingerprint,
    provenance: [input.provenance], previousFingerprints: [], createdAt: now, updatedAt: now,
  };
  if (index >= 0) next.nodes[index] = node as CreativeNode;
  else next.nodes.push(node as CreativeNode);
  markDownstreamStale(next, input.id);
  next.revision += 1;
  next.updatedAt = now;
  return { graph: next, changed: true };
}

export function connectCreativeNodes(
  graph: ProjectCreativeGraph, from: string, to: string, kind: CreativeEdgeKind, label?: string,
): ProjectCreativeGraph {
  const id = `${from}::${kind}::${to}`;
  if (graph.edges.some(edge => edge.id === id)) return graph;
  const next = structuredClone(graph);
  next.edges.push({ id, from, to, kind, label, createdAt: new Date().toISOString() });
  next.revision += 1;
  next.updatedAt = new Date().toISOString();
  return next;
}

function markDownstreamStale(graph: ProjectCreativeGraph, sourceId: string): void {
  const queue = [sourceId];
  const seen = new Set(queue);
  while (queue.length) {
    const from = queue.shift()!;
    for (const edge of graph.edges.filter(item => item.from === from)) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to); queue.push(edge.to);
      const target = graph.nodes.find(node => node.id === edge.to);
      if (target && !['empty', 'rejected', 'blocked'].includes(target.status)) {
        target.status = 'stale';
        target.updatedAt = new Date().toISOString();
      }
    }
  }
}

export function signCreativeNode(graph: ProjectCreativeGraph, nodeId: string): ProjectCreativeGraph {
  const next = structuredClone(graph);
  const node = next.nodes.find(item => item.id === nodeId);
  if (!node) return graph;
  node.status = 'signed'; node.signedAt = new Date().toISOString(); node.updatedAt = node.signedAt;
  next.revision += 1; next.updatedAt = node.signedAt;
  return next;
}

export function setCreativeNodeStatus(
  graph: ProjectCreativeGraph, nodeId: string, status: CreativeNodeStatus, signedAt?: string,
): ProjectCreativeGraph {
  const current = graph.nodes.find(item => item.id === nodeId);
  if (!current || (current.status === status && current.signedAt === signedAt)) return graph;
  const next = structuredClone(graph);
  const node = next.nodes.find(item => item.id === nodeId)!;
  node.status = status; node.signedAt = status === 'signed' ? (signedAt ?? new Date().toISOString()) : undefined;
  node.updatedAt = new Date().toISOString(); next.revision += 1; next.updatedAt = node.updatedAt;
  return next;
}

export function nodeOf<T>(graph: ProjectCreativeGraph, id: string): CreativeNode<T> | undefined {
  return graph.nodes.find(node => node.id === id) as CreativeNode<T> | undefined;
}

export function appendCreativeTrace(
  graph: ProjectCreativeGraph,
  input: Omit<CreativeGraphTrace, 'id' | 'graphRevision' | 'startedAt' | 'finishedAt'> & {
    startedAt?: string; finishedAt?: string;
  },
): ProjectCreativeGraph {
  const now = new Date().toISOString();
  const next = structuredClone(graph);
  next.traces.push({
    id: `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    graphRevision: graph.revision,
    surface: input.surface,
    action: input.action,
    nodeIds: input.nodeIds,
    startedAt: input.startedAt ?? now,
    finishedAt: input.finishedAt ?? now,
    costUsd: input.costUsd,
    notes: input.notes,
  });
  next.traces = next.traces.slice(-200);
  next.revision += 1;
  next.updatedAt = now;
  return next;
}
