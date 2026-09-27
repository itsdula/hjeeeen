// Arrange — the one-click tidy (Anwar 2026-07-11: «زر ترتيب يرتب كل شيء؛
// ولو كان المستخدم محدداً عناصر معينة يرتب المحدد فقط»).
//
// Mind nodes arrange into LINEAGE COLUMNS (brief → analysis → seeds →
// collisions grouped under their parent seed → territories), reading the
// actual edges so ancestry stays readable. Everything else (media nodes,
// free text, notes/answers) tidies into a clean grid below/beside the flow.
// Selection mode applies the same logic to the selected set only, anchored
// at the selection's own top-left — the rest of the board never moves.

import type { NodeInstance, GraphEdge } from '../node-engine/types';
import { sizeOfNode } from './sizes';

const GX = 120;   // horizontal gutter between columns
const GY = 28;    // vertical gutter between cards in a column

type Col = NodeInstance[];

const RANK: Record<string, number> = {
  'mind.brief': 0,
  'mind.answer': 0,
  'mind.note': 0,
  'mind.proposition': 1,
  'mind.persona': 1,
  'mind.gaps': 1,
  'mind.seed': 2,
  'mind.collision': 3,
  'mind.territory': 4,
};

function colWidth(col: Col): number {
  return col.reduce((w, n) => Math.max(w, sizeOfNode(n).w), 0);
}

/** Stack a column downward from y0; returns positions + total height. */
function stack(col: Col, x: number, y0: number): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  let y = y0;
  for (const n of col) {
    out.set(n.id, { x, y });
    y += sizeOfNode(n).h + GY;
  }
  return out;
}

/** Order collisions so each seed's children sit together, kept first. */
function orderCollisions(collisions: NodeInstance[], edges: GraphEdge[], seedOrder: string[]): NodeInstance[] {
  const parentOf = new Map<string, string>();
  for (const e of edges) {
    if (collisions.some(c => c.id === e.to.node)) parentOf.set(e.to.node, e.from.node);
  }
  const rank = new Map(seedOrder.map((id, i) => [id, i]));
  return [...collisions].sort((a, b) => {
    const pa = rank.get(parentOf.get(a.id) ?? '') ?? 99;
    const pb = rank.get(parentOf.get(b.id) ?? '') ?? 99;
    if (pa !== pb) return pa - pb;
    const ka = a.paramValues?.kept ? 0 : 1;
    const kb = b.paramValues?.kept ? 0 : 1;
    return ka - kb;
  });
}

/** Compute tidy positions for `targets` (all nodes, or the selection, or a
 *  group frame's members). Returns ONLY the nodes whose position changes.
 *  `anchor` pins the arranged block's top-left (a group arranges INSIDE its
 *  own frame); omitted → the set keeps its own top-left. */
export function arrangeNodes(
  targets: NodeInstance[],
  edges: GraphEdge[],
  anchor?: { x: number; y: number },
): Array<{ id: string; position: { x: number; y: number } }> {
  // Breakdown 360 nodes hold a deliberate ring/spine geometry — Arrange
  // leaves them exactly where they are (they'd otherwise be dumped into the
  // unranked 3-per-row rest grid and the ring would be destroyed).
  targets = targets.filter(n => !n.type.startsWith('mind.bd') && n.type !== 'mind.myMind');
  if (targets.length === 0) return [];

  const ax = anchor?.x ?? Math.min(...targets.map(n => n.position.x));
  const ay = anchor?.y ?? Math.min(...targets.map(n => n.position.y));

  const byRank = new Map<number, Col>();
  const rest: Col = [];
  for (const n of targets) {
    const r = RANK[n.type];
    if (r === undefined) { rest.push(n); continue; }
    const col = byRank.get(r) ?? [];
    col.push(n);
    byRank.set(r, col);
  }

  // stable vertical order inside each column: current y, then type
  for (const col of byRank.values()) {
    col.sort((a, b) => (a.position.y - b.position.y) || a.type.localeCompare(b.type));
  }

  // collisions: group under their parent seed, kept first
  const seeds = byRank.get(2) ?? [];
  const collisions = byRank.get(3);
  if (collisions) byRank.set(3, orderCollisions(collisions, edges, seeds.map(s => s.id)));

  const placed = new Map<string, { x: number; y: number }>();
  let x = ax;
  for (const r of [...byRank.keys()].sort((a, b) => a - b)) {
    const col = byRank.get(r)!;
    for (const [id, pos] of stack(col, x, ay)) placed.set(id, pos);
    x += colWidth(col) + GX;
  }

  // the rest (media / free text / anything unranked): grid to the right of
  // the flow — 3 per row, sized by the widest member
  if (rest.length) {
    rest.sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x));
    const cellW = Math.max(...rest.map(n => sizeOfNode(n).w)) + 40;
    const cellH = Math.max(...rest.map(n => sizeOfNode(n).h)) + 40;
    rest.forEach((n, i) => {
      placed.set(n.id, { x: x + (i % 3) * cellW, y: ay + Math.floor(i / 3) * cellH });
    });
  }

  return targets
    .filter(n => {
      const p = placed.get(n.id);
      return p && (p.x !== n.position.x || p.y !== n.position.y);
    })
    .map(n => ({ id: n.id, position: placed.get(n.id)! }));
}
