// Edge routing — the wire's SHAPE, chosen per canvas (Anwar 2026-07-11:
// «أترك للمستخدم أكثر من خيار في شكل الـ Wire… أقترح أن تكون بشكل مستقيم
// بزوايا تسعين درجة… بدون المرور على النوتس»).
//
// Three styles:
//   curve    — the classic bezier (media canvases keep this look).
//   straight — a direct line, socket to socket.
//   step     — orthogonal, 90° corners, and it ROUTES AROUND node boxes:
//              candidate channels are scored by how many inflated node rects
//              each segment crosses; the cleanest, shortest channel wins.
//              Heuristic, not a maze solver — fast enough to run per frame.
//
// Pure geometry: no React, no store. NodeView passes node boxes as obstacles.

export type EdgeStyle = 'curve' | 'straight' | 'step' | 'hidden';

export const EDGE_STYLES: Array<{ value: EdgeStyle; label: string }> = [
  { value: 'step', label: 'Steps' },
  { value: 'curve', label: 'Curve' },
  { value: 'straight', label: 'Straight' },
  { value: 'hidden', label: 'Hidden' },
];

export interface Rect { x: number; y: number; w: number; h: number }
interface Pt { x: number; y: number }

const STUB = 18;      // clearance leaving/entering a socket
const MARGIN = 10;    // obstacle inflation — wires keep this far from cards
const CORNER = 8;     // rounded-corner radius on step wires

// ---- segment ↔ rect crossing (segments are axis-aligned) -------------------

function hCross(y: number, x0: number, x1: number, r: Rect): boolean {
  const a = Math.min(x0, x1), b = Math.max(x0, x1);
  return y > r.y - MARGIN && y < r.y + r.h + MARGIN && b > r.x - MARGIN && a < r.x + r.w + MARGIN;
}
function vCross(x: number, y0: number, y1: number, r: Rect): boolean {
  const a = Math.min(y0, y1), b = Math.max(y0, y1);
  return x > r.x - MARGIN && x < r.x + r.w + MARGIN && b > r.y - MARGIN && a < r.y + r.h + MARGIN;
}

/** How many obstacle rects a polyline of axis-aligned segments crosses. */
function crossings(pts: Pt[], obstacles: Rect[]): number {
  let n = 0;
  for (const r of obstacles) {
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      if (p.y === q.y ? hCross(p.y, p.x, q.x, r) : vCross(p.x, p.y, q.y, r)) { n++; break; }
    }
  }
  return n;
}

function length(pts: Pt[]): number {
  let d = 0;
  for (let i = 0; i < pts.length - 1; i++) d += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
  return d;
}

// ---- orthogonal candidates --------------------------------------------------

/** Forward routes (target right of source): H → V → H through channel cx. */
function viaChannelX(sx: number, sy: number, tx: number, ty: number, cx: number): Pt[] {
  return [{ x: sx, y: sy }, { x: cx, y: sy }, { x: cx, y: ty }, { x: tx, y: ty }];
}
/** Detour routes (any direction): out → over/under at cy → back in. */
function viaChannelY(sx: number, sy: number, tx: number, ty: number, cy: number): Pt[] {
  const ax = sx + STUB, bx = tx - STUB;
  return [
    { x: sx, y: sy }, { x: ax, y: sy }, { x: ax, y: cy },
    { x: bx, y: cy }, { x: bx, y: ty }, { x: tx, y: ty },
  ];
}

/** Dedupe consecutive collinear/duplicate points so corners render cleanly. */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const a = out[out.length - 2], b = out[out.length - 1];
    if (b && b.x === p.x && b.y === p.y) continue;
    if (a && b && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

/** Emit an SVG path with rounded 90° corners. */
function toPath(pts: Pt[]): string {
  const p = simplify(pts);
  if (p.length < 2) return '';
  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const prev = p[i - 1], cur = p[i], next = p[i + 1];
    const r = Math.min(
      CORNER,
      Math.max(1, (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y)) / 2),
      Math.max(1, (Math.abs(next.x - cur.x) + Math.abs(next.y - cur.y)) / 2),
    );
    const inX = Math.sign(cur.x - prev.x), inY = Math.sign(cur.y - prev.y);
    const outX = Math.sign(next.x - cur.x), outY = Math.sign(next.y - cur.y);
    d += ` L ${cur.x - inX * r} ${cur.y - inY * r}`;
    d += ` Q ${cur.x} ${cur.y} ${cur.x + outX * r} ${cur.y + outY * r}`;
  }
  d += ` L ${p[p.length - 1].x} ${p[p.length - 1].y}`;
  return d;
}

function stepRoute(sx: number, sy: number, tx: number, ty: number, obstacles: Rect[]): string {
  const candidates: Pt[][] = [];

  if (tx - sx >= STUB * 2) {
    // Vertical channels between the stubs: midpoint + a slot beside each
    // obstacle edge that sits in the corridor.
    const lo = sx + STUB, hi = tx - STUB;
    const xs = new Set<number>([Math.round((sx + tx) / 2), lo, hi]);
    const yLo = Math.min(sy, ty) - MARGIN, yHi = Math.max(sy, ty) + MARGIN;
    for (const r of obstacles) {
      if (r.y + r.h < yLo || r.y > yHi) continue;
      const left = r.x - MARGIN - 4, right = r.x + r.w + MARGIN + 4;
      if (left > lo && left < hi) xs.add(Math.round(left));
      if (right > lo && right < hi) xs.add(Math.round(right));
    }
    for (const cx of xs) candidates.push(viaChannelX(sx, sy, tx, ty, cx));
  }

  // Detour channels (needed when the target sits LEFT of the source, and as
  // a fallback when every vertical channel crosses something).
  const ys = new Set<number>([Math.round((sy + ty) / 2)]);
  const xLo = Math.min(sx, tx) - MARGIN, xHi = Math.max(sx, tx) + MARGIN;
  let top = Math.min(sy, ty), bottom = Math.max(sy, ty);
  for (const r of obstacles) {
    if (r.x + r.w < xLo || r.x > xHi) continue;
    top = Math.min(top, r.y); bottom = Math.max(bottom, r.y + r.h);
    ys.add(Math.round(r.y - MARGIN - 4));
    ys.add(Math.round(r.y + r.h + MARGIN + 4));
  }
  ys.add(Math.round(top - MARGIN - 12));
  ys.add(Math.round(bottom + MARGIN + 12));
  for (const cy of ys) candidates.push(viaChannelY(sx, sy, tx, ty, cy));

  let best: Pt[] = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const score = crossings(c, obstacles) * 10000 + length(c);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return toPath(best);
}

/** The wire. `obstacles` should EXCLUDE the two endpoint nodes' own boxes. */
export function routeEdge(
  style: EdgeStyle,
  sx: number, sy: number, tx: number, ty: number,
  obstacles: Rect[] = [],
): string {
  if (style === 'hidden') return '';   // callers skip rendering; empty path is the safety net
  if (style === 'straight') return `M ${sx} ${sy} L ${tx} ${ty}`;
  if (style === 'step') return stepRoute(sx, sy, tx, ty, obstacles);
  const dx = Math.max(40, Math.abs(tx - sx) * 0.5);
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
}
