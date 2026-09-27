// Storyboard product data model. Persisted per-project to
// {projectSlug}/_storyboard/storyboard.json via window.hjen.readStoryboard /
// writeStoryboard. Mirrors the proven Python pipeline in
// BUILD/SYSTEMs/Director Role (script → shots → refs → panels → PDF), but
// reimplemented for HJEN Studio.

/** A panel's lifecycle. "made" / "approved" — never "generated" (house vocab). */
export type ShotStatus = 'pending' | 'making' | 'made' | 'approved' | 'failed';

/** Asset (reference) lifecycle — same vocabulary. */
export type AssetStatus = 'pending' | 'making' | 'made' | 'failed';

/** One storyboard panel. Numbered scene+letter ("14A"). The §6.1 stack drives
 *  both the panel image prompt and the PDF caption strips. */
export interface StoryboardShot {
  id: string;              // stable uuid
  scene: number;           // 14
  letter: string;          // 'A' → panel id "14A"
  description: string;     // the board-artist / image-model brief (FRAME one-liner)

  // §6.1 technical stack (all optional — filled by breakdown or by hand)
  shot?: string;           // SHOT code: MCU/CU/WS…
  angle?: string;          // EL, LA, OH…
  lens?: string;           // "40mm, T2.0"
  move?: string;           // glyph string "⊙→ slow push 2.5s"
  duration?: string;       // "2.5s"
  dialogue?: string;       // ≤12 words, may be Arabic + [gloss]
  sfx?: string;
  music?: string;
  transition?: string;     // "MC → 14B"
  priority?: 'A' | 'B' | 'C';

  // §6.1 DESCRIPTION bullets (drive the prompt body)
  character?: string;
  blocking?: string;
  light?: string;
  frameFurniture?: string;

  // resolved refs
  characterIds?: string[]; // → StoryboardCharacter.id
  placeIds?: string[];     // → StoryboardPlace.id
  elementIds?: string[];   // → StoryboardElement.id

  // make output — the CURRENT (approved) take
  generatedImagePath?: string;  // absolute path returned by saveGeneration
  generatedJsonPath?: string;   // sidecar path (for the lightbox)
  thumbPath?: string;
  /** Every take ever made for this shot (Refine keeps the old ones). The
   *  approved one is whichever matches generatedImagePath. */
  takes?: StoryboardTake[];
  status: ShotStatus;
  error?: string;
}

export interface StoryboardTake {
  imgPath: string;
  thumbPath?: string;
  jsonPath?: string;
  ts: number;
}

/** A reusable reference slot — one character, place, or continuity element.
 *  The reference image (user-attached OR program-made) keeps it consistent
 *  across panels. Characters additionally carry a face portrait + a turnaround
 *  sheet (identity + build), mirroring the Python asset pipeline. */
export interface StoryboardRefSlot {
  id: string;
  name: string;            // "MUBARAK" / "Bedroom" / "Brass dallah"
  note?: string;           // short description / wardrobe note
  detectRegex?: string;    // optional, for auto-attach to shots
  refImagePath?: string;   // primary reference (place/element, or character fallback)
  thumbPath?: string;
  // client-provided SOURCE reference — when set, the asset is generated FROM it
  sourceRefPath?: string;
  sourceRefThumb?: string;
  // character-only assets
  faceImagePath?: string;
  faceThumbPath?: string;
  sheetImagePath?: string;
  sheetThumbPath?: string;
  // asset-make lifecycle
  assetStatus?: AssetStatus;
  assetError?: string;
  /** Every version ever made for this asset (Refine keeps the old ones). The
   *  approved one is whichever matches the current face/sheet/ref paths. */
  takes?: StoryboardAssetTake[];
}

/** One asset version. Characters carry a face+sheet pair; places/elements a
 *  single ref image. */
export interface StoryboardAssetTake {
  faceImagePath?: string;
  faceThumbPath?: string;
  sheetImagePath?: string;
  sheetThumbPath?: string;
  refImagePath?: string;
  thumbPath?: string;
  ts: number;
}

export type StoryboardCharacter = StoryboardRefSlot;
export type StoryboardPlace = StoryboardRefSlot;
export type StoryboardElement = StoryboardRefSlot;

export type StoryboardStep = 1 | 2 | 3 | 4;

export type SbModel = 'GPT_IMAGE_2' | 'NANO_BANANA_PRO';
export type SbQuality = 'LOW' | 'MED' | 'HIGH';

/** Project + client identity for the PDF export. */
export interface StoryboardClient {
  client?: string;
  agency?: string;
  brand?: string;
  clientLogoPath?: string;
  agencyLogoPath?: string;
  brandLogoPath?: string;
}

/** A user-defined board look. The user can keep several. `id` doubles as the
 *  active `presetId` and the key into `presetSamples` for its made sample. */
export interface CustomBoard {
  id: string;          // 'custom', 'custom-2', … — also used as presetId
  name?: string;       // editable board name
  note?: string;       // free-text style description (50–100 chars when auto-described)
  refs?: string[];     // one or more uploaded style references
}

export interface StoryboardData {
  version: 1;
  /** The project this data belongs to. Stamped on open + every save so a file
   *  can never be mistaken for another project's board (cross-project guard). */
  projectId?: string;
  scriptText: string;
  title?: string;
  shots: StoryboardShot[];
  characters: StoryboardCharacter[];
  places: StoryboardPlace[];
  elements: StoryboardElement[];      // continuity props/objects
  styleRefImagePath?: string;         // optional user-supplied style plate (project-level)
  styleRefThumbPath?: string;
  styleNote?: string;                 // free-text style intent fed into every panel
  // make settings (chosen in the Frames panel)
  presetId?: string;                  // active look id — a bundled preset id, or a custom board id
  customBoards?: CustomBoard[];       // the user's own board looks (0…N)
  // — legacy single-custom fields (migrated into customBoards on open) —
  customLookName?: string;
  customLookNote?: string;
  customLookRefs?: string[];
  presetSamples?: Record<string, string>;   // presetId → remade sample image path (overrides bundled)
  presetStyleRefs?: Record<string, string>; // presetId → user-uploaded style reference (display + drives generation)
  model?: SbModel;
  quality?: SbQuality;
  aspect?: string;                    // e.g. '16:9'
  // project + client identity (PDF)
  client?: StoryboardClient;
  // export prefs
  exportTemplateId?: string;
  exportIncludeAssets?: boolean;
  step: StoryboardStep;               // which pipeline step the user is on
  updatedAt: string;
}

export function emptyStoryboard(): StoryboardData {
  return {
    version: 1,
    scriptText: '',
    shots: [],
    characters: [],
    places: [],
    elements: [],
    presetId: 'graphite',
    model: 'GPT_IMAGE_2',
    quality: 'MED',          // Standard by default — a good speed/quality balance
    aspect: '16:9',
    client: {},
    step: 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Panel id "14A" from scene+letter. */
export function panelId(shot: Pick<StoryboardShot, 'scene' | 'letter'>): string {
  return `${shot.scene}${shot.letter}`;
}
