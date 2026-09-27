// Entity EDIT + LINK helpers — pure, immutable merges over a breakdown's roster.
//
// Shared by the component (prompt editing) and the store's buildEntityReference
// action (persisting builtRef + linking the built reference onto its shots), so
// the mutation shape lives in ONE place. entityResolver.ts owns RESOLUTION; this
// owns EDITS to an already-resolved roster. Every function is a fresh-object
// merge (never mutates its input) so callers can apply the freshest-read
// discipline (read the latest breakdown, merge, write) without clobbering.

import type {
  AdBreakdown, BreakdownEntities, BreakdownPerson, BreakdownPlace, BreakdownAsset,
  BreakdownShotRow, ShotAttachment, BuiltRef,
} from '../creativemind/breakdown';

export type EntityKind = 'person' | 'place' | 'asset';
export type AnyEntity = BreakdownPerson | BreakdownPlace | BreakdownAsset;

// ─── built-reference HISTORY — append-only, with an active pointer ───────────
// Each built-reference SLOT (place/asset builtRefs · person builtFaces/builtSheets)
// is an append-only array; a build APPENDS + points active at the new `at`, never
// overwrites. Reads resolve the active entry (falling back to the newest).

/** The active entry of a history — the one whose `at` matches `activeAt`, else the
 *  newest (last). Undefined for an empty/absent history. */
export function activeOf(list: BuiltRef[] | undefined, activeAt: string | undefined): BuiltRef | undefined {
  if (!list || !list.length) return undefined;
  return list.find(b => b.at === activeAt) ?? list[list.length - 1];
}

/** Fold a possibly-legacy single BuiltRef into a history array — old breakdowns
 *  carried a single `builtRef`/`builtFace`/`builtSheet`; treat it as one element.
 *  A real history (length ≥ 1) always wins over the legacy single. */
export function foldLegacy(list: BuiltRef[] | undefined, legacy: BuiltRef | undefined): BuiltRef[] {
  if (list && list.length) return list;
  return legacy ? [legacy] : [];
}

/** The stable attachment id a built reference claims on every shot it links to —
 *  so BUILD AGAIN REPLACES the old link (never double-adds) and de-dupe is by id. */
export const entRefAttId = (entId: string) => `bd-entref-${entId}`;

/** Find one entity by kind + id across the roster (undefined if absent). */
export function findEntity(bd: AdBreakdown, kind: EntityKind, id: string): AnyEntity | undefined {
  const ents = bd.pipeline?.entities;
  if (!ents) return undefined;
  const arr: AnyEntity[] = kind === 'person' ? ents.persons
    : kind === 'place' ? ents.places
    : (ents.assets || []);
  return arr.find(e => e.id === id);
}

/** Merge a patch onto ONE entity (by kind + id), returning a new breakdown. Used
 *  for prompt edits and for stamping builtRef. No-op (returns input) if absent. */
export function patchEntity(
  bd: AdBreakdown, kind: EntityKind, id: string,
  patch: Partial<BreakdownPerson & BreakdownPlace & BreakdownAsset>,
): AdBreakdown {
  const ents = bd.pipeline?.entities;
  if (!ents) return bd;
  const map = <T extends { id: string }>(arr: T[]) => arr.map(e => (e.id === id ? { ...e, ...patch } : e));
  const next: BreakdownEntities = {
    persons: kind === 'person' ? map(ents.persons) : ents.persons,
    places: kind === 'place' ? map(ents.places) : ents.places,
    assets: kind === 'asset' ? map(ents.assets || []) : ents.assets,
  };
  return { ...bd, pipeline: { ...bd.pipeline, entities: next } };
}

/** LINK a built reference image onto every shot the entity appears in — appended
 *  as an image ATTACHMENT so each shot's makes reuse the ONE built reference.
 *  De-dupes by the entity's stable attachment id (BUILD AGAIN replaces the link,
 *  never stacks). `role` decides which make(s) it feeds: 'both' for persons/props,
 *  'frame' for places. Returns a new breakdown; no-op if there is no shotlist. */
export function linkBuiltRefToShots(
  bd: AdBreakdown, entId: string, shotNos: number[], path: string,
  role: ShotAttachment['role'], note: string,
): AdBreakdown {
  const sl: any = (bd.pipeline as any)?.shotlist;
  if (!sl?.rows || !Array.isArray(sl.rows) || !shotNos.length) return bd;
  const attId = entRefAttId(entId);
  const want = new Set(shotNos);
  const rows = (sl.rows as BreakdownShotRow[]).map(r => {
    if (!want.has(r.no)) return r;
    const kept = (r.attachments || []).filter(a => a.id !== attId);
    const att: ShotAttachment = { id: attId, path, kind: 'image', role, note };
    return { ...r, attachments: [...kept, att] };
  });
  return { ...bd, pipeline: { ...bd.pipeline, shotlist: { ...sl, rows } } };
}
