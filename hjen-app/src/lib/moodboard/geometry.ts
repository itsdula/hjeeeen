// Mood board geometry — pure math, no React/DOM.
//
// The camera (pan/zoom) is reused verbatim from the node canvas
// (components/node/viewport.ts) so the zoom feel is identical across the app
// and the 0.1–2.2 scale clamp has one definition. Only the bounding box needs
// a twin here: nodesBBox reads `n.position.x` off a NodeInstance, and a
// MoodItem carries x/y/w/h directly.

import type { Box } from '../../components/node/viewport';
import type { MoodItem } from '../../types/moodboard';

export interface Rect { x: number; y: number; w: number; h: number }
export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

export const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'];

/** Smallest a box may get. Below this a picture stops being a reference and
 *  becomes a dot you cannot grab again. */
export const MIN_SIZE = 40;

/** Board-space bbox of the given items — the MoodItem twin of nodesBBox. */
export function itemsBBox(items: MoodItem[]): Box | null {
  if (!items.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of items) {
    x0 = Math.min(x0, i.x);
    y0 = Math.min(y0, i.y);
    x1 = Math.max(x1, i.x + i.w);
    y1 = Math.max(y1, i.y + i.h);
  }
  return { x0, y0, x1, y1 };
}

/** Do two board-space rects overlap? Used by the marquee. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Normalise a drag-drawn rect (either corner may be the anchor). */
export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/**
 * Resize `b` by dragging `handle` through (dx, dy) in board space.
 *
 * Corners on a picture keep the frame's shape — a squashed reference is a lie
 * about the reference. ⇧ opts out by passing aspect as undefined. Edge handles
 * are always free, because cropping the box is a legitimate framing act.
 */
export function resizeRect(b: Rect, handle: Handle, dx: number, dy: number, aspect?: number): Rect {
  let { x, y, w, h } = b;
  if (handle.includes('e')) w = b.w + dx;
  if (handle.includes('w')) { w = b.w - dx; x = b.x + dx; }
  if (handle.includes('s')) h = b.h + dy;
  if (handle.includes('n')) { h = b.h - dy; y = b.y + dy; }

  const corner = handle.length === 2;
  if (corner && aspect && aspect > 0) {
    // Follow the axis the hand actually moved along, so the box tracks the
    // cursor instead of fighting it.
    if (Math.abs(dx) >= Math.abs(dy)) h = w / aspect; else w = h * aspect;
    if (handle.includes('w')) x = b.x + (b.w - w);
    if (handle.includes('n')) y = b.y + (b.h - h);
  }

  if (w < MIN_SIZE) { if (handle.includes('w')) x = b.x + b.w - MIN_SIZE; w = MIN_SIZE; }
  if (h < MIN_SIZE) { if (handle.includes('n')) y = b.y + b.h - MIN_SIZE; h = MIN_SIZE; }
  return { x, y, w, h };
}

/** Where a newly-dropped run of items lands, so a multi-file drop cascades
 *  instead of stacking every picture on one spot. */
export function dropOffset(index: number): { dx: number; dy: number } {
  return { dx: (index % 4) * 28, dy: Math.floor(index / 4) * 28 + (index % 4) * 10 };
}
