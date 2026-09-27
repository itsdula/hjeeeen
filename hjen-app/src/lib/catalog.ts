import type { Catalog } from '../types/catalog';
import { toCatalogMovements, MOVEMENT_CATEGORIES } from './cameraMovements';

const FILES = {
  // Relative paths so they resolve correctly under both dev (http://localhost/...)
  // AND production (file:///path/to/app/dist/index.html). A leading slash would
  // route to the filesystem root in production.
  angles: 'catalog/05_framing_perspective_library.json',
  movies: 'catalog/06_movie_references.json',
  photographers: 'catalog/07_photographers.json',
  cameras: 'catalog/08_camera_body.json',
  lenses: 'catalog/09_lens.json',
  stocks: 'catalog/10_film_stock.json',
  lighting: 'catalog/11_lighting.json',
  cameraMovements: 'catalog/14_camera_movements.json',
} as const;

const wrapList = (raw: any) => Array.isArray(raw.items) ? raw : { items: raw.items ?? [] };

export async function loadCatalog(): Promise<Catalog> {
  const [angles, movies, photographers, cameras, lenses, stocks, lighting] =
    await Promise.all([FILES.angles, FILES.movies, FILES.photographers, FILES.cameras,
      FILES.lenses, FILES.stocks, FILES.lighting].map(p => fetch(p).then(r => r.json())));

  // Camera movements come from the single-source lib (lib/cameraMovements.ts) —
  // the 46-item, 7-category superset — NOT the legacy 16-item JSON. Frame + Video
  // + the shared DOP picker all read this, so there is exactly one source of truth.
  const cameraMovements = { items: toCatalogMovements(), categories: MOVEMENT_CATEGORIES.map(c => ({ id: c, name: c })), sorts: [] };

  return {
    angles: angles.items ?? angles,
    movies: { items: movies.items ?? [], categories: movies.categories ?? [], sorts: movies.sorts ?? [] },
    photographers: { items: photographers.items ?? [], categories: photographers.categories ?? [] },
    cameras: { items: cameras.items ?? [], categories: cameras.categories ?? [], sorts: cameras.sorts ?? [] },
    lenses: { items: lenses.items ?? [], categories: lenses.categories ?? [], sorts: lenses.sorts ?? [] },
    stocks: { items: stocks.items ?? [], categories: stocks.categories ?? [] },
    lighting: { items: lighting.items ?? [], categories: lighting.categories ?? [] },
    cameraMovements,
  };
}

// Asset URL helpers
export const angleThumb = (filename: string) => `thumbs/perspective_thumbs/${filename}`;
export const movieThumb = (filename: string) => `thumbs/movie_thumbs/${filename}`;
export const photographerThumb = (filename: string) => `thumbs/photographer_thumbs/${filename}`;
export const cameraIcon = (filename: string) => `icons/camera_icons/${filename}`;
export const cameraSample = (filename: string) => `thumbs/camera_thumbs/${filename}`;
export const lensIcon = (filename: string) => `icons/lens_icons/${filename}`;
export const lensSample = (filename: string) => `thumbs/lens_thumbs/${filename}`;
export const stockIcon = (filename: string) => `icons/filmstock_icons/${filename}`;
export const stockSample = (filename: string) => `thumbs/filmstock_thumbs/${filename}`;
export const lightingThumb = (filename: string) => `thumbs/lighting_thumbs/${filename}`;
export const movementClip = (filename: string) => `thumbs/movement_clips/${filename}`;
export const movementStandin = (filename: string) => `thumbs/movement_standins/${filename}`;
