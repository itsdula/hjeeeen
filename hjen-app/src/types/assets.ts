// The Asset spine — the project's people, places, objects and clothes, held
// once and recalled into every make.
//
// WHY THIS EXISTS: neither image door gives us a seed. gpt-image-2's documented
// parameters contain none, and Gemini image generation exposes none. Reference
// images are therefore the ONLY reproducibility mechanism we have — which makes
// an asset library not a convenience feature but the entire consistency story.
// Everything below is bookkeeping in service of that one fact.
//
// Five asset-shaped systems already exist (storyboard ref slots, the shared
// Library, Cast cards, Breakdown entities, and this reserved stage-6 slot).
// This is the sixth and the one they all import INTO — see lib/assets/bridges.
// Nothing existing is rewritten.

/** The four factories. Each has its own view, its own spec schema, its own
 *  plate roles and its own OUTPUT SHAPE — which is why they are four tools and
 *  not one screen with a mode switch. */
export type AssetKind = 'character' | 'location' | 'prop' | 'wardrobe';

export const ASSET_KINDS: AssetKind[] = ['character', 'location', 'prop', 'wardrobe'];

/** Plate roles, per kind.
 *
 *  The role IS the conditioning contract. It decides slot priority in the
 *  payload, which bucket the plate lands in on the Gemini door (which has
 *  SEPARATE character/object budgets, unlike OpenAI's flat array), and the
 *  prose clause that names it to the model. Role assignment in prose is the
 *  only conditioning mechanism that exists across every vendor — there is no
 *  role field on any image API — so it must be explicit DATA here, never
 *  inferred from array order. */
export type CharacterRole = 'face' | 'sheet' | 'video-anchor';
export type LocationRole = 'wide' | 'reverse' | 'working' | 'detail';
export type PropRole = 'turnaround' | 'insert';
export type WardrobeRole = 'flat' | 'ghost' | 'on-body' | 'swatch';
export type PlateRole = CharacterRole | LocationRole | PropRole | WardrobeRole;

export const ROLES_BY_KIND: Record<AssetKind, PlateRole[]> = {
  character: ['face', 'sheet', 'video-anchor'],
  location: ['wide', 'reverse', 'working', 'detail'],
  prop: ['turnaround', 'insert'],
  wardrobe: ['flat', 'ghost', 'on-body', 'swatch'],
};

/** Human labels for the role chips + the prose clause. */
export const ROLE_LABEL: Record<PlateRole, string> = {
  'face': 'Face',
  'sheet': '3-view character sheet',
  'video-anchor': 'Video anchor',
  'wide': 'Establishing wide',
  'reverse': 'Reverse',
  'working': 'Medium working',
  'detail': 'Detail insert',
  'turnaround': 'Turnaround',
  'insert': 'Detail insert',
  'flat': 'Flat-lay',
  'ghost': 'Ghost-mannequin',
  'on-body': 'On body',
  'swatch': 'Swatch',
};

/** Roles a kind may hold MORE THAN ONE of. Everything else is single-slot:
 *  a character has one active face, a location one active wide. Props carry
 *  N detail inserts (engravings, attachments and texture drift first when the
 *  model only ever sees a wide view) and wardrobe carries one plate per piece. */
export const MULTI_ROLES: PlateRole[] = ['insert', 'detail', 'swatch'];

export type AssetStatus = 'draft' | 'making' | 'built' | 'failed';

/** One made-or-imported image with a declared role.
 *
 *  Plates are APPEND-ONLY. A rebuild pushes a new plate and moves the `active`
 *  pointer; it never overwrites, so a build you liked is always recoverable.
 *  Lifted from BreakdownPerson.builtFaces[]/activeFaceAt — the one existing
 *  model in this codebase that already gets versioning right. */
export interface AssetPlate {
  id: string;
  role: PlateRole;
  path: string;
  thumbPath?: string;
  /** ISO timestamp — also the version key shown in the takes rail. */
  at: string;
  source: 'made' | 'imported';
  /** Plate ids fed in as references when this one was made — the cascade.
   *  Character sheets and video anchors carry the FACE here;
   *  location reverse/working/detail carry the WIDE. */
  builtFrom?: string[];
  /** Which model made it. Recorded because the two doors disagree about what
   *  a reference is, so "which model built this plate" is diagnostic. */
  model?: string;
  /** Free label — the piece name on a wardrobe plate, the part on an insert. */
  note?: string;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  /** The @tag. Unique within the project — this is the name the prompt uses,
   *  the name MentionTextarea offers, and the name the model is told to match. */
  name: string;
  /** The kind's structured profile. Character reuses Cast's 37 anchors
   *  verbatim; the other three have their own small schemas. Kept for humans
   *  and for text-only builds — NOT dumped into a prompt that has references. */
  spec: Record<string, string>;
  /** Explicit refusals. The house wardrobe law's negatives, a location's
   *  forbidden-drift list. Positive-phrased locks go in the recipe; these are
   *  the hard exclusions. */
  negatives: string[];
  /** ≤ ~25 words. What actually rides into the prompt alongside the plates.
   *
   *  DELIBERATELY SHORT. Long appearance text fights the reference image and
   *  degrades it — the opposite of what Cast's characterPrompt() does today.
   *  Critical details that a model tends to drop (small text, logos, an exact
   *  colour) belong here even though they are visible on the plate. */
  anchor: string;
  plates: AssetPlate[];
  /** role → plate id. A POINTER. Moving it never rewrites history. */
  active: Partial<Record<PlateRole, string>>;
  /** Client / street-cast photos this asset was built FROM (not outputs). */
  sourceRefs: string[];
  /** CHARACTER ONLY — clothing/look references for the body sheet.
   *
   * Kept separate from sourceRefs on purpose: identity portraits steer the
   * FACE plate, then that one face plate anchors the three-view sheet. Wardrobe
   * images lock the clothes without being mistaken for the character's face. */
  wardrobeRefs?: string[];
  /** Wardrobe → character. The costumeId pattern: on recall this becomes the
   *  layer's parentLayerId, so Frame nests the garment under its subject and
   *  one person's clothes can never mix with another's. */
  parentId?: string;
  /** LOCATION ONLY — how hard the plate binds.
   *  'hard'  → recalls as a `composition` layer and fires the COMPOSITION LOCK;
   *            the frame's geometry is pinned to the plate.
   *  'style' → recalls as `location`: "style reference only, not a fixed
   *            keyframe — the model extends the world, never pinned 1:1."
   *  Getting this wrong in either direction is a visible failure, so it is a
   *  decision the scout makes per location, not a global default. */
  binding?: 'hard' | 'style';
  /** WARDROBE ONLY — how the garment was photographed/made. Input TYPE
   *  measurably changes the result: flat-lay wins on print/logo/text fidelity,
   *  on-body imports pose artefacts from the reference figure, and for a thobe
   *  or abaya flat-lay destroys the drape that IS the garment. */
  photoType?: 'flat' | 'ghost' | 'on-body';
  status: AssetStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** The stage-6 document. Written through the existing readStageData /
 *  writeStageData with { stage: 6 } → {slug}/_project/06_assets/manifest.json.
 *  No electron/main change is needed: write-stage-data already mkdir -p's the
 *  06_assets/ subfolder, and rewriteProjectPaths() fixes the absolute plate
 *  paths for free when a project is renamed. */
export interface AssetsData {
  version: 1;
  assets: Asset[];
  updatedAt: string;
}

export function emptyAssets(): AssetsData {
  return { version: 1, assets: [], updatedAt: new Date().toISOString() };
}

/** The `tool` tag written into each plate's generation sidecar. Drives the
 *  per-kind folders in the Files browser, and buys the generation log, cost
 *  tracking and crash recovery in the same move. */
export function toolTag(kind: AssetKind): string {
  return `asset-${kind}`;
}

/** The active plate for a role, or undefined. */
export function activePlate(asset: Asset, role: PlateRole): AssetPlate | undefined {
  const id = asset.active[role];
  return id ? asset.plates.find(p => p.id === id) : undefined;
}

/** Every plate for a role, oldest first — the takes rail. */
export function platesFor(asset: Asset, role: PlateRole): AssetPlate[] {
  return asset.plates.filter(p => p.role === role);
}

/** The plates this asset contributes to a make, in slot-priority order.
 *  Multi-roles (inserts, swatches) come last: they are the first thing the
 *  payload compiler drops when it hits the model's budget. */
export function recallPlates(asset: Asset): AssetPlate[] {
  const order = ROLES_BY_KIND[asset.kind];
  const out: AssetPlate[] = [];
  for (const role of order) {
    if (MULTI_ROLES.includes(role)) continue;
    const p = activePlate(asset, role);
    if (p) out.push(p);
  }
  for (const role of order) {
    if (!MULTI_ROLES.includes(role)) continue;
    out.push(...platesFor(asset, role));
  }
  return out;
}

/** True once the asset has anything worth recalling. */
export function isBuilt(asset: Asset): boolean {
  return asset.plates.length > 0;
}
