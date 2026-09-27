// BRIDGES — pull what the project already knows INTO the asset book.
//
// Five asset-shaped systems existed before this one: storyboard ref slots, the
// shared Library, Cast cards, Breakdown entities, and the reserved stage-6 slot.
// Nothing here rewrites any of them. These are ONE-WAY importers: read the other
// system, create assets, copy the plates in as `imported`. The source keeps
// working exactly as it did, and re-importing is safe — an asset whose name
// already exists is skipped rather than duplicated.
//
// Why import at all, rather than teach every tool to read stage 6: those tools
// ship and work. The asset book earns its place by being where things LAND, not
// by forcing a migration through three shipped surfaces.

import type { Asset, AssetKind, PlateRole } from '../../types/assets';
import { useAssets } from '../../store/assetsStore';
import { buildData, type Profile } from '../castSchema';

export interface ImportResult {
  imported: number;
  skipped: number;
  /** Names that already existed — skipped, not overwritten. */
  skippedNames: string[];
}

const empty = (): ImportResult => ({ imported: 0, skipped: 0, skippedNames: [] });

/** Create one asset with its plates already attached. Returns false when an
 *  asset of that name+kind is already in the book. */
function landAsset(
  kind: AssetKind,
  name: string,
  plates: Array<{ role: PlateRole; path: string; thumbPath?: string; note?: string }>,
  seed: Partial<Asset> = {},
): boolean {
  const A = useAssets.getState();
  const existing = (A.data?.assets ?? []).find(
    a => a.kind === kind && a.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (existing) return false;

  const asset = A.addAsset(kind, name, seed);
  if (!asset) return false;
  for (const p of plates) {
    if (!p.path) continue;
    useAssets.getState().addPlate(asset.id, {
      role: p.role,
      path: p.path,
      thumbPath: p.thumbPath || p.path,
      at: new Date().toISOString(),
      source: 'imported',
      note: p.note,
    });
  }
  return true;
}

/** A short identity line from a Cast profile. The full 37 anchors ride in
 *  `spec`; the ANCHOR stays short because under a reference image the text has
 *  to shrink, not expand. */
function anchorFromProfile(name: string, values: Profile): string {
  const d = buildData(values);
  const bits = [
    d.age && d.sex ? `${d.age} ${d.sex}` : (d.age || d.sex),
    d.heritage,
    d.facialHair && d.facialHair !== 'None' ? d.facialHair.toLowerCase() : '',
    d.build && `${d.build.toLowerCase()} build`,
  ].filter(Boolean).join(', ');
  return bits
    ? `${name} — ${bits}. Identity 100% matches the attached reference; wardrobe is its own asset.`
    : `${name}. Identity 100% matches the attached reference.`;
}

// ─── 1 · Cast cards (global library) → characters ────────────────────────────

/** A Cast card is a portrait + extra reference photos + the 37-anchor profile.
 *  The portrait becomes the FACE plate; the extras become source references,
 *  not plates — they are what the identity was read FROM, not outputs. */
export async function importCastCards(): Promise<ImportResult> {
  const out = empty();
  let cards: Awaited<ReturnType<typeof window.hjen.listCharacterCards>> = [];
  try { cards = await window.hjen.listCharacterCards(); } catch { return out; }

  for (const c of cards) {
    const name = c.name || 'Character';
    const landed = landAsset('character', name,
      c.mainAsset?.filePath
        ? [{ role: 'face' as PlateRole, path: c.mainAsset.filePath, thumbPath: c.mainAsset.thumbPath }]
        : [],
      {
        spec: c.profile || {},
        anchor: anchorFromProfile(name, (c.profile || {}) as Profile),
        sourceRefs: (c.references || []).map(r => r.filePath).filter(Boolean),
      });
    if (landed) out.imported++; else { out.skipped++; out.skippedNames.push(name); }
  }
  return out;
}

// ─── 2 · Storyboard slots → characters / locations / props ───────────────────

/** The storyboard's characters/places/elements already carry made plates —
 *  a character has face + sheet, a place or element a single reference. Those
 *  map onto the same roles this book uses, so the import is nearly 1:1. */
export async function importStoryboard(projectId: string): Promise<ImportResult> {
  const out = empty();
  let sb: any = null;
  try { sb = await window.hjen.readStoryboard({ id: projectId }); } catch { return out; }
  if (!sb) return out;

  for (const c of (sb.characters ?? [])) {
    const plates: Array<{ role: PlateRole; path: string; thumbPath?: string }> = [];
    if (c.faceImagePath) plates.push({ role: 'face', path: c.faceImagePath, thumbPath: c.faceThumbPath });
    if (c.sheetImagePath) plates.push({ role: 'sheet', path: c.sheetImagePath, thumbPath: c.sheetThumbPath });
    const name = c.name || 'Character';
    const landed = landAsset('character', name, plates, {
      spec: c.note ? { note: c.note } : {},
      anchor: c.note ? `${name} — ${c.note}. Identity matches the attached reference.` : `${name}. Identity matches the attached reference.`,
      sourceRefs: c.sourceRefPath ? [c.sourceRefPath] : [],
    });
    if (landed) out.imported++; else { out.skipped++; out.skippedNames.push(name); }
  }

  for (const p of (sb.places ?? [])) {
    const name = p.name || 'Location';
    const landed = landAsset('location', name,
      p.refImagePath ? [{ role: 'wide' as PlateRole, path: p.refImagePath, thumbPath: p.thumbPath }] : [],
      {
        spec: p.note ? { note: p.note } : {},
        // A board plate was made as atmosphere, not as a framing template —
        // importing it as a hard lock would silently pin every future frame.
        binding: 'style',
        anchor: p.note ? `${name} — ${p.note}. Style reference; the model extends the world.` : `${name}. Style reference; the model extends the world.`,
        sourceRefs: p.sourceRefPath ? [p.sourceRefPath] : [],
      });
    if (landed) out.imported++; else { out.skipped++; out.skippedNames.push(name); }
  }

  for (const e of (sb.elements ?? [])) {
    const name = e.name || 'Prop';
    const landed = landAsset('prop', name,
      e.refImagePath ? [{ role: 'turnaround' as PlateRole, path: e.refImagePath, thumbPath: e.thumbPath }] : [],
      {
        spec: e.note ? { note: e.note } : {},
        anchor: e.note ? `${name} — ${e.note}. Matches the attached reference.` : `${name}. Matches the attached reference.`,
        sourceRefs: e.sourceRefPath ? [e.sourceRefPath] : [],
      });
    if (landed) out.imported++; else { out.skipped++; out.skippedNames.push(name); }
  }

  return out;
}

// ─── 3 · Breakdown roster → all four kinds ───────────────────────────────────

/** The closest existing model to this one: BreakdownPerson already keeps
 *  wardrobe OUT of the identity refs, and BreakdownAsset.kind is literally
 *  'prop' | 'wardrobe'. It also uses the same append-only history with an
 *  active pointer, so only the ACTIVE build is imported. */
export async function importBreakdown(slug: string): Promise<ImportResult> {
  const out = empty();
  let bd: any = null;
  try {
    const r = await window.hjen.mindBreakdownRead({ slug });
    bd = r?.ok ? r.breakdown : null;
  } catch { return out; }
  if (!bd?.entities) return out;

  const pickActive = (list: any[] | undefined, activeAt: string | undefined): string | undefined => {
    if (!Array.isArray(list) || !list.length) return undefined;
    const hit = activeAt ? list.find(b => b?.at === activeAt) : undefined;
    return (hit ?? list[list.length - 1])?.path;
  };

  for (const p of (bd.entities.persons ?? [])) {
    const plates: Array<{ role: PlateRole; path: string }> = [];
    const face = pickActive(p.builtFaces, p.activeFaceAt);
    const sheet = pickActive(p.builtSheets, p.activeSheetAt);
    if (face) plates.push({ role: 'face', path: face });
    if (sheet) plates.push({ role: 'sheet', path: sheet });
    const name = p.descriptor ? String(p.descriptor).slice(0, 48) : (p.id || 'Person');
    const landed = landAsset('character', name, plates, {
      spec: { note: p.descriptor || '' },
      anchor: `${name}. Identity 100% matches the attached reference; wardrobe is its own asset.`,
    });
    if (landed) out.imported++; else { out.skipped++; out.skippedNames.push(name); }

    // The roster keeps the ad's kit as its own field precisely so it never gets
    // baked into the identity plates — so it lands here as its own asset, bound
    // to the person who wears it.
    if (p.wardrobe) {
      const wName = `${name} · wardrobe`;
      const parent = (useAssets.getState().data?.assets ?? [])
        .find(a => a.kind === 'character' && a.name === name);
      const w = landAsset('wardrobe', wName, [], {
        spec: { pieces: String(p.wardrobe).split(/[,;]\s*/).filter(Boolean).join('\n') },
        parentId: parent?.id,
        photoType: 'ghost',
        anchor: `${name}'s wardrobe. Matches the attached reference.`,
      });
      if (w) out.imported++; else { out.skipped++; out.skippedNames.push(wName); }
    }
  }

  for (const pl of (bd.entities.places ?? [])) {
    const ref = pickActive(pl.builtRefs, pl.activeRefAt);
    const name = pl.descriptor ? String(pl.descriptor).slice(0, 48) : (pl.id || 'Place');
    const landed = landAsset('location', name,
      ref ? [{ role: 'wide' as PlateRole, path: ref }] : [],
      { spec: { note: pl.descriptor || '' }, binding: 'style', anchor: `${name}. Style reference; the model extends the world.` });
    if (landed) out.imported++; else { out.skipped++; out.skippedNames.push(name); }
  }

  for (const a of (bd.entities.assets ?? [])) {
    const ref = pickActive(a.builtRefs, a.activeRefAt);
    const name = a.descriptor ? String(a.descriptor).slice(0, 48) : (a.id || 'Asset');
    const kind: AssetKind = a.kind === 'wardrobe' ? 'wardrobe' : 'prop';
    const role: PlateRole = kind === 'wardrobe' ? 'ghost' : 'turnaround';
    const landed = landAsset(kind, name,
      ref ? [{ role, path: ref }] : [],
      {
        spec: { note: a.descriptor || '' },
        ...(kind === 'wardrobe' ? { photoType: 'ghost' as const } : {}),
        anchor: `${name}. Matches the attached reference.`,
      });
    if (landed) out.imported++; else { out.skipped++; out.skippedNames.push(name); }
  }

  return out;
}

// ─── 4 · Shared library → any kind ───────────────────────────────────────────

/** The flat shelf already sorts by category, and its four asset-shaped bins map
 *  straight onto the four factories. One library image becomes one asset with
 *  one imported plate — enough to recall, and a starting point to re-make from. */
export async function importLibrary(kinds: AssetKind[] = ['character', 'location', 'prop', 'wardrobe']): Promise<ImportResult> {
  const out = empty();
  let lib: Awaited<ReturnType<typeof window.hjen.listLibrary>> = [];
  try { lib = await window.hjen.listLibrary(); } catch { return out; }

  const ROLE: Record<AssetKind, PlateRole> = {
    character: 'face', location: 'wide', prop: 'turnaround', wardrobe: 'ghost',
  };

  for (const a of lib) {
    const kind = a.category as AssetKind;
    if (!kinds.includes(kind)) continue;
    const landed = landAsset(kind, a.name || a.filename,
      [{ role: ROLE[kind], path: a.filePath, thumbPath: a.thumbPath }],
      {
        anchor: `${a.name || a.filename}. Matches the attached reference.`,
        ...(kind === 'location' ? { binding: 'style' as const } : {}),
        ...(kind === 'wardrobe' ? { photoType: 'ghost' as const } : {}),
      });
    if (landed) out.imported++; else { out.skipped++; out.skippedNames.push(a.name || a.filename); }
  }
  return out;
}

/** One line the floors can show after any import. */
export function summarize(r: ImportResult): string {
  if (!r.imported && !r.skipped) return 'Nothing to import.';
  const parts = [`${r.imported} imported`];
  if (r.skipped) parts.push(`${r.skipped} already here`);
  return parts.join(' · ');
}
