// Schema for the public options catalog

export interface Angle {
  id: string;
  name: string;
  filename: string;
  description: string;
}

export interface Photographer {
  id: string;
  name: string;
  filename: string;
  genre: string;
  notes: string;
}

export interface Movie {
  id: string;
  title: string;
  year: string | number;
  director?: string | null;
  cinematographer?: string | null;
  filename: string;
  type: 'Generic styles' | 'Live Action Movies' | 'Animation';
  examples?: string[];
}

export interface Camera {
  id: string;
  name: string;
  prompt: string;
  format: string;
  usage: string;
  aesthetic: string;
  year_first_built: number;
  pick: boolean;
  filename: string;          // /cameras/X.png (icon)
  sample_filename: string;   // /camera_samples/X.jpg (scene sample)
}

export interface Lens {
  id: string;
  name: string;
  type: string;
  pick: boolean;
  filename: string;
  sample_filename: string;
  note: string;
  year: number;
}

export interface Stock {
  id: string;
  name: string;
  usage: string;
  filename: string;
  sample_filename: string;
}

export interface Lighting {
  id: string;
  name: string;
  category: string;
  filename: string;
  description: string;
}

export interface CameraMovement {
  id: string;
  name: string;
  filename: string;            // .mp4 preview clip
  stand_in_filename: string;
  category: string;
  description: string;
  pick: boolean;
  /** Exact AI-video trigger phrase (from lib/cameraMovements.ts). Fed to the
   *  Video engine's "Camera movement: …" prompt line for Seedance / Kling. */
  promptKeyword?: string;
}

export interface Catalog {
  angles: Angle[];
  photographers: { items: Photographer[]; categories: any[] };
  movies: { items: Movie[]; categories: any[]; sorts: any[] };
  cameras: { items: Camera[]; categories: any[]; sorts: any[] };
  lenses: { items: Lens[]; categories: any[]; sorts: any[] };
  stocks: { items: Stock[]; categories: any[] };
  lighting: { items: Lighting[]; categories: any[] };
  cameraMovements: { items: CameraMovement[]; categories: any[]; sorts: any[] };
}

export type StylePreset = 'NONE' | 'MOVIE' | 'PHOTOGRAPHER';
export type Quality = 'LOW' | 'MED' | 'HIGH';
export type Resolution = '1MP' | '3.7MP' | '8.3MP';
export type ModelId = 'GPT_IMAGE_2' | 'NANO_BANANA_PRO';

export interface Selections {
  angle: Angle | null;
  movie: Movie | null;
  photographer: Photographer | null;
  camera: Camera | null;
  lens: Lens | null;
  stock: Stock | null;
  lighting: Lighting | null;
  movement: CameraMovement | null;
  focal_mm: number | null;
  aperture_f: number | null;
  aspect: string;
  resolution: Resolution;
  quality: Quality;
  model: ModelId;
  style_preset: StylePreset;
  atmosphere: string;
  prompt: string;
  /** Hard exclusion list. Stored separately from `prompt` so it never
   *  contaminates the scene description; assembled as an isolated tail
   *  clause in buildPrompt (gpt-image-2 has no native negative_prompt param). */
  negative: string;
}
