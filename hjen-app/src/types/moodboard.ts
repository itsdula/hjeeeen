// Mood Board — لوحة الإلهام. A free canvas of pictures per project.
//
// Deliberately NOT a node graph: no ports, no edges, no execution. Boxes on a
// plane, which is what a mood board is. Geometry is BOARD-SPACE pixels at
// scale 1 — the same space NodeView calls board space — never viewport pixels,
// so a board laid out on a 4K display is the same board on a laptop.

import type { PanelDocBase } from '../lib/dock/usePanelDoc';

export type MoodItemKind = 'image' | 'gif' | 'video' | 'note';

export interface MoodItem {
  id: string;
  kind: MoodItemKind;
  /** Absolute local path, rendered through hjenFileUrl(). Empty for a note. */
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Paint order. Grabbing an item raises it to maxZ + 1. */
  z: number;
  /** Intrinsic w/h, learned from <img>.naturalWidth on first paint. Corner
   *  resize preserves it; edge resize is free. */
  aspect?: number;
  /** A note's body, or a caption under a picture. */
  caption?: string;
  /** Where this came off the References grid — kept so a board can point back
   *  at the frame's why/take/leave even after the grid is re-curated. */
  refId?: string;
  tag?: string;
  createdAt: string;
}

export interface MoodBoard extends PanelDocBase {
  version: 1;
  items: MoodItem[];
  /** Where the camera was left, so re-opening lands where you left off. */
  view?: { pan: { x: number; y: number }; scale: number };
  createdAt: string;
}

/** The blank a new board starts from. Built in the RENDERER — main only stamps
 *  identity — so the model has exactly one definition. */
export function blankMoodBoard(): Partial<MoodBoard> {
  return { version: 1, items: [] };
}

const IMAGE_EXT = /\.(jpe?g|png|webp|tiff?|heic|avif|bmp)$/i;
const GIF_EXT = /\.gif$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

/** What kind of box a dropped path becomes. Anything unrecognised is refused
 *  rather than shown as a broken picture. */
export function moodKindForPath(p: string): MoodItemKind | null {
  if (GIF_EXT.test(p)) return 'gif';
  if (IMAGE_EXT.test(p)) return 'image';
  if (VIDEO_EXT.test(p)) return 'video';
  return null;
}
