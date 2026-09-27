// The eye's RANKER — renderer-side client. A dumb terminal by design.
//
// Frameset (and every image search) ranks by TEXT. It cannot rank by how a frame
// FEELS, because that is not in the text. This asks the server to reorder a set
// of candidates by the feeling the caller is after.
//
// Everything that decides the order — the concept vectors, the fusion constant,
// which registers the eye is allowed to override the source on — lives in
// server/src/eye/rank.js. This file sends a register and a list of URLs and gets
// back an order. House law: the recipe never ships to the client.
//
// It is also deliberately un-critical: `rankByFeeling` returns null on ANY
// failure (no server, no model, unknown register, network) and every caller
// falls back to what it did before. A board that loads the old way beats a board
// that does not load.

import { gatewayPost } from '../gateway';
import type { Register } from './types';

export interface RankCandidate { id: string; url: string }

export interface RankedItem {
  id: string;
  feeling: number;      // 0-1, this candidate's probability for the target register
  eyeRank: number;      // its position once ranked by feeling alone
  sourceRank: number | null;  // where the source (e.g. Frameset) had put it
}

export interface RankResult {
  ok: boolean;
  mode?: 'eye' | 'fuse';
  why?: string;
  order?: string[];
  scored?: RankedItem[];
  read?: number;
  of?: number;
  reason?: string;
}

/**
 * Reorder candidates by feeling. Returns null when the eye is unavailable —
 * callers MUST treat null as "keep your existing order", never as an error.
 *
 * `candidates` must arrive in the SOURCE's own order: that order is half the
 * signal. On the four registers where the eye did not beat the source in blind
 * testing, the server fuses the two instead of overriding.
 */
export async function rankByFeeling(
  register: Register | null | undefined,
  candidates: RankCandidate[],
): Promise<RankResult | null> {
  if (!register || candidates.length === 0) return null;
  try {
    const res = await gatewayPost<RankResult>('/v1/eye/rank', {
      state: { register },
      candidates: candidates.slice(0, 200).map(c => ({ id: c.id, url: c.url })),
    });
    return res && res.ok && Array.isArray(res.order) ? res : null;
  } catch {
    return null;
  }
}

/** Apply a returned order to the caller's own objects, keeping anything the eye
 *  could not read at the back rather than dropping it. */
export function applyOrder<T>(items: T[], idOf: (x: T) => string, order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(idOf(a)) ?? 1e9) - (rank.get(idOf(b)) ?? 1e9));
}
