// Canonical default Selections. Extracted from store.ts so non-store modules
// (e.g. the NODE engine's Frame node) can build a complete Selections base
// without importing the store (which would create a runtime import cycle).

import type { Selections } from '../types/catalog';

export const initialSelections: Selections = {
  angle: null,
  movie: null,
  photographer: null,
  camera: null,
  lens: null,
  stock: null,
  lighting: null,
  movement: null,
  focal_mm: null,
  aperture_f: null,
  aspect: '21:9',
  resolution: '3.7MP',
  quality: 'HIGH',
  model: 'GPT_IMAGE_2',
  style_preset: 'NONE',
  atmosphere: '',
  prompt: '',
  negative: '',
};
