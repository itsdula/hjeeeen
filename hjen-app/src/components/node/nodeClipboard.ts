// In-memory clipboard for Node canvas copy/cut/paste. Module-level (NOT the OS
// clipboard) — holds a deep snapshot of the copied nodes, the edges internal to
// that set, and the selection's top-left origin so paste can offset relative to
// the cursor while preserving the group's relative layout.

import type { NodeInstance, GraphEdge } from '../../lib/node-engine/types';

export interface ClipPayload {
  nodes: NodeInstance[];
  edges: GraphEdge[];
  origin: { x: number; y: number };
}

let CLIP: ClipPayload | null = null;

/** Build a payload from a selection without touching the clipboard — used by
 *  duplicate (⌘D / ⇧⌘D), which clones in place rather than via copy/paste. */
export function makeClipPayload(all: NodeInstance[], allEdges: GraphEdge[], ids: string[]): ClipPayload | null {
  return snapshot(all, allEdges, ids);
}

function snapshot(all: NodeInstance[], allEdges: GraphEdge[], ids: string[]): ClipPayload | null {
  const idset = new Set(ids);
  const picked = all.filter(n => idset.has(n.id));
  if (!picked.length) return null;
  const origin = {
    x: Math.min(...picked.map(n => n.position.x)),
    y: Math.min(...picked.map(n => n.position.y)),
  };
  // Only edges whose BOTH endpoints are in the selection travel with the copy.
  const edges = allEdges.filter(e => idset.has(e.from.node) && idset.has(e.to.node));
  return {
    nodes: JSON.parse(JSON.stringify(picked)) as NodeInstance[],
    edges: JSON.parse(JSON.stringify(edges)) as GraphEdge[],
    origin,
  };
}

export const nodeClipboard = {
  copy(all: NodeInstance[], allEdges: GraphEdge[], ids: string[]): boolean {
    const p = snapshot(all, allEdges, ids);
    if (p) CLIP = p;
    return !!p;
  },
  get(): ClipPayload | null { return CLIP; },
  has(): boolean { return !!CLIP; },
};
