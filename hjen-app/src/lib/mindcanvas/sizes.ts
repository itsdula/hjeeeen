// Node sizes for the mind canvas — shared by the body renderer (NodeView /
// mindBodies) and the arrange engine, so layout math and pixels never drift.
// A node's own `size` (corner-drag resize) always wins over the type default.

import type { NodeInstance } from '../node-engine/types';

export const MIND_NODE_SIZE: Record<string, { w: number; h: number }> = {
  'mind.brief': { w: 320, h: 264 },
  'mind.proposition': { w: 260, h: 150 },
  'mind.persona': { w: 260, h: 150 },
  'mind.gaps': { w: 260, h: 168 },
  'mind.seed': { w: 240, h: 182 },
  'mind.collision': { w: 260, h: 154 },
  'mind.territory': { w: 300, h: 348 },
  'mind.note': { w: 260, h: 134 },
  'mind.answer': { w: 260, h: 154 },
  // Ad Breakdown 360 — تشريح الإعلان
  'mind.bdHeader': { w: 340, h: 252 },
  'mind.bdAxis': { w: 280, h: 236 },
  'mind.bdElement': { w: 248, h: 178 },
  'mind.myMind': { w: 640, h: 440 },
  'group': { w: 560, h: 380 },
  'file': { w: 236, h: 92 },
};

/** An answer that carries reference images grows to hold its thumb row. */
const ANSWER_WITH_REFS = { w: 280, h: 286 };

/** Media node footprint (NODE_W × estimated height) — used only by arrange. */
export const MEDIA_SIZE = { w: 188, h: 150 };

/** Resize floor per family — the corner drag can't collapse a card. */
export function minSizeOfType(type: string): { w: number; h: number } {
  if (type === 'group') return { w: 240, h: 160 };
  if (type === 'source' || type === 'frame' || type === 'video') return { w: 96, h: 72 };
  if (type === 'file') return { w: 180, h: 72 };
  const d = MIND_NODE_SIZE[type];
  return d ? { w: Math.round(d.w * 0.75), h: Math.round(d.h * 0.6) } : { w: 120, h: 80 };
}

export function sizeOfType(type: string): { w: number; h: number } {
  return MIND_NODE_SIZE[type] ?? MEDIA_SIZE;
}

/** The one true size of a node on the board: user resize → type default
 *  (answers with reference images get the taller default). */
export function sizeOfNode(n: Pick<NodeInstance, 'type' | 'size' | 'paramValues'>): { w: number; h: number } {
  if (n.size && n.size.w > 0 && n.size.h > 0) return n.size;
  if (n.type === 'mind.answer' && String(n.paramValues?.refs ?? '').trim()) return ANSWER_WITH_REFS;
  return sizeOfType(n.type);
}
