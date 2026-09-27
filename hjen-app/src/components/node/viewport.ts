// Node canvas viewport geometry — pure math, no React/DOM.
//
// The board renders nodes at board-space (x,y) and displays them under a
// transform `translate(pan) scale(scale)`. These helpers compute the pan/scale
// needed to fit or centre a set of nodes, and the anchored-zoom used by the
// wheel handler and ⌘± / cursor zoom.

import type { NodeInstance } from '../../lib/node-engine/types';

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Viewport { w: number; h: number }
export interface Transform { pan: { x: number; y: number }; scale: number }

// 10% floor — a big thinking board must shrink far enough to be seen whole
// (Anwar 2026-07-11: «يمكن للتصغير أكثر من ٣٥٪»).
const SCALE_MIN = 0.1;
const SCALE_MAX = 2.2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Board-space bounding box of the given nodes (null when empty). */
export function nodesBBox(
  nodes: NodeInstance[],
  sizeOf: (n: NodeInstance) => { w: number; h: number },
): Box | null {
  if (!nodes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    const { w, h } = sizeOf(n);
    x0 = Math.min(x0, n.position.x);
    y0 = Math.min(y0, n.position.y);
    x1 = Math.max(x1, n.position.x + w);
    y1 = Math.max(y1, n.position.y + h);
  }
  return { x0, y0, x1, y1 };
}

/** Pan+scale that fits `box` inside `viewport` with `pad` px of margin. */
export function fitTransform(box: Box, viewport: Viewport, pad = 48): Transform {
  const bw = Math.max(1, box.x1 - box.x0);
  const bh = Math.max(1, box.y1 - box.y0);
  const scale = clamp(Math.min((viewport.w - pad * 2) / bw, (viewport.h - pad * 2) / bh), SCALE_MIN, SCALE_MAX);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  return { scale, pan: { x: viewport.w / 2 - cx * scale, y: viewport.h / 2 - cy * scale } };
}

/** Pan that centres `box` in `viewport` at the current scale (scale unchanged). */
export function centerTransform(box: Box, viewport: Viewport, scale: number): { x: number; y: number } {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  return { x: viewport.w / 2 - cx * scale, y: viewport.h / 2 - cy * scale };
}

/** Zoom by `factor` while keeping the point (px,py) — in viewport pixels —
 *  pinned under the cursor. Used by the wheel handler, ⌘±, and the Z zoom tool. */
export function zoomAtPoint(prev: Transform, factor: number, px: number, py: number): Transform {
  const scale = clamp(prev.scale * factor, SCALE_MIN, SCALE_MAX);
  return {
    scale,
    pan: {
      x: px - ((px - prev.pan.x) / prev.scale) * scale,
      y: py - ((py - prev.pan.y) / prev.scale) * scale,
    },
  };
}

export const SCALE_BOUNDS = { min: SCALE_MIN, max: SCALE_MAX };
