// HJEN DNA preset — pre-fills all controls to Clay & Basil Style Bible state.
// See memory/reference_dna_clay_basil.md for the philosophical source.

import type { Catalog, Selections, StylePreset, Quality, Resolution, ModelId } from '../types/catalog';

export const HJEN_DNA_IDS = {
  movie: 'conan_the_barbarian_1982',          // Conan-1982 (the bible pillar)
  camera: 'arriflex-35-bl',                    // Arriflex 35 BL
  lens: 'todd-ao-anamorphic',                  // Todd-AO Anamorphic
  stock: 'eastman_kodak_100t',                 // Eastman Kodak 100T 5254/5247
  lighting: 'civil_twilight',                  // Civil Twilight
  movement: 'static',                          // Static (stills-first)
};

export function applyDNA(catalog: Catalog, current: Selections): Selections {
  // Best-effort match by id, falling back to label-prefix match
  const findById = <T extends { id: string; name?: string; title?: string }>(arr: T[], wantedId: string, fallback?: (item: T) => boolean) =>
    arr.find(it => it.id === wantedId) ?? (fallback ? arr.find(fallback) : null) ?? null;

  return {
    ...current,
    movie: findById(catalog.movies.items, HJEN_DNA_IDS.movie, m => /conan.*barbarian/i.test(m.title) && String(m.year) === '1982'),
    camera: findById(catalog.cameras.items, HJEN_DNA_IDS.camera, c => /arriflex.*35.*bl/i.test(c.name)),
    lens: findById(catalog.lenses.items, HJEN_DNA_IDS.lens, l => /todd.?ao.*anamorphic/i.test(l.name)),
    stock: findById(catalog.stocks.items, HJEN_DNA_IDS.stock, s => /eastman.*kodak.*100t/i.test(s.name)),
    lighting: findById(catalog.lighting.items, HJEN_DNA_IDS.lighting, l => /civil twilight/i.test(l.name)),
    movement: findById(catalog.cameraMovements.items, HJEN_DNA_IDS.movement, m => /^static$/i.test(m.name)),
    focal_mm: 14,
    aperture_f: 1.4,
    aspect: '21:9',
    resolution: '3.7MP' as Resolution,
    quality: 'HIGH' as Quality,
    model: 'GPT_IMAGE_2' as ModelId,
    style_preset: 'MOVIE' as StylePreset,
  };
}
