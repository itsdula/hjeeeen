// ============================================================================
// cameraMovements.ts — THE single source of truth for camera movements.
//
// Imported by BOTH Film Space (to ANIMATE the stage + export move paths) and the
// Video engine (to feed Seedance / Kling the matching movement prompt). Do NOT
// duplicate this list anywhere — Anwar's law: verified specs live in one module.
// It supersedes the old 16-item movement JSON for the shared picker;
// storyboardCamera.ts MOVES stays intact for back-compat, but this is the richer
// 46-item superset grouped into 7 categories.
//
// Descriptions here are OUR OWN re-authored text. Every preset's preview is
// rendered from OUR OWN Film Space stage — never scraped or downloaded.
// ============================================================================

export type MovementCategory =
  | 'Pan / Tilt' | 'Zoom / Lens' | 'Dolly / Track' | 'Drone / Crane'
  | 'Physical Moves' | 'Human Camera' | 'Specials';

export const MOVEMENT_CATEGORIES: MovementCategory[] = [
  'Pan / Tilt', 'Zoom / Lens', 'Dolly / Track', 'Drone / Crane',
  'Physical Moves', 'Human Camera', 'Specials',
];

/** What the 3D stage should animate to realise the move. `kind` selects the
 *  interpreter; `dir` / `speed` / `params` bias it. Film Space reads this to
 *  drive both the preview animation AND the exported `move.path[]`. */
export type MotionKind =
  | 'static' | 'pan' | 'tilt' | 'whip-pan' | 'zoom' | 'crash-zoom' | 'dolly'
  | 'track' | 'follow' | 'reverse-track' | 'side-track' | 'low-track'
  | 'vehicle-track' | 'chase' | 'crane' | 'drone' | 'helicopter' | 'truck'
  | 'pedestal' | 'slider' | 'push-past' | 'arc' | 'orbit' | 'handheld'
  | 'snorricam' | 'fpv' | 'tilt-shift' | 'infinite-zoom' | 'earth-zoom'
  | 'timelapse' | 'pass-through';

export interface Motion {
  // ALWAYS 'camera' — the shared library moves the CAMERA relative to a STATIC
  // character. Subject / object motion is authored only on the manual timeline in
  // Film Space, never baked into a preset. (Field kept for schema stability.)
  target: 'camera';
  kind: MotionKind;
  dir?: 'in' | 'out' | 'left' | 'right' | 'up' | 'down' | 'cw' | 'ccw';
  speed?: 'slow' | 'normal' | 'fast' | 'crash';
  params?: Record<string, number | string | boolean>;
}

export interface MovementPreset {
  id: string;                 // kebab-case, stable
  name: string;
  category: MovementCategory;
  description: string;        // one line, our own text
  promptKeyword: string;      // exact AI-video trigger phrase
  motion: Motion;
}

export const MOVEMENTS: MovementPreset[] = [
  // ── Pan / Tilt (7) ──────────────────────────────────────────────────────
  { id: 'static-shot', name: 'Static shot', category: 'Pan / Tilt',
    description: 'Hold one fixed camera position for the full clip.',
    promptKeyword: 'locked-off static shot', motion: { target: 'camera', kind: 'static' } },
  { id: 'pan-right', name: 'Pan right', category: 'Pan / Tilt',
    description: 'Rotate horizontally left to right.',
    promptKeyword: 'pan right', motion: { target: 'camera', kind: 'pan', dir: 'right', speed: 'normal' } },
  { id: 'pan-left', name: 'Pan left', category: 'Pan / Tilt',
    description: 'Rotate horizontally right to left.',
    promptKeyword: 'pan left', motion: { target: 'camera', kind: 'pan', dir: 'left', speed: 'normal' } },
  { id: 'whip-pan-right', name: 'Whip pan right', category: 'Pan / Tilt',
    description: 'Rotate rapidly toward a new target on the right.',
    promptKeyword: 'whip pan right', motion: { target: 'camera', kind: 'whip-pan', dir: 'right', speed: 'fast' } },
  { id: 'whip-pan-left', name: 'Whip pan left', category: 'Pan / Tilt',
    description: 'Rotate rapidly toward the left.',
    promptKeyword: 'whip pan left', motion: { target: 'camera', kind: 'whip-pan', dir: 'left', speed: 'fast' } },
  { id: 'tilt-up', name: 'Tilt up', category: 'Pan / Tilt',
    description: 'Rotate upward from one fixed point.',
    promptKeyword: 'tilt up', motion: { target: 'camera', kind: 'tilt', dir: 'up', speed: 'normal' } },
  { id: 'tilt-down', name: 'Tilt down', category: 'Pan / Tilt',
    description: 'Rotate downward from one fixed point.',
    promptKeyword: 'tilt down', motion: { target: 'camera', kind: 'tilt', dir: 'down', speed: 'normal' } },

  // ── Zoom / Lens (6) ─────────────────────────────────────────────────────
  { id: 'slow-zoom-in', name: 'Slow zoom in', category: 'Zoom / Lens',
    description: 'Slowly increase focal length to a tighter frame.',
    promptKeyword: 'slow zoom in', motion: { target: 'camera', kind: 'zoom', dir: 'in', speed: 'slow' } },
  { id: 'slow-zoom-out', name: 'Slow zoom out', category: 'Zoom / Lens',
    description: 'Slowly decrease focal length to a wider frame.',
    promptKeyword: 'slow zoom out', motion: { target: 'camera', kind: 'zoom', dir: 'out', speed: 'slow' } },
  { id: 'fast-zoom-in', name: 'Fast zoom in', category: 'Zoom / Lens',
    description: 'Quickly tighten the frame toward the target.',
    promptKeyword: 'fast zoom in', motion: { target: 'camera', kind: 'zoom', dir: 'in', speed: 'fast' } },
  { id: 'fast-zoom-out', name: 'Fast zoom out', category: 'Zoom / Lens',
    description: 'Quickly widen the frame away from the target.',
    promptKeyword: 'fast zoom out', motion: { target: 'camera', kind: 'zoom', dir: 'out', speed: 'fast' } },
  { id: 'crash-zoom-in', name: 'Crash zoom in', category: 'Zoom / Lens',
    description: 'Snap the lens rapidly toward the target.',
    promptKeyword: 'crash zoom in', motion: { target: 'camera', kind: 'crash-zoom', dir: 'in', speed: 'crash' } },
  { id: 'crash-zoom-out', name: 'Crash zoom out', category: 'Zoom / Lens',
    description: 'Snap the lens rapidly away from the target.',
    promptKeyword: 'crash zoom out', motion: { target: 'camera', kind: 'crash-zoom', dir: 'out', speed: 'crash' } },

  // ── Dolly / Track (9) ───────────────────────────────────────────────────
  { id: 'dolly-in', name: 'Dolly in', category: 'Dolly / Track',
    description: 'Move physically forward toward the subject.',
    promptKeyword: 'dolly in', motion: { target: 'camera', kind: 'dolly', dir: 'in', speed: 'normal' } },
  { id: 'dolly-out', name: 'Dolly out', category: 'Dolly / Track',
    description: 'Move physically backward away from the subject.',
    promptKeyword: 'dolly out', motion: { target: 'camera', kind: 'dolly', dir: 'out', speed: 'normal' } },
  { id: 'tracking-shot', name: 'Tracking shot', category: 'Dolly / Track',
    description: 'Move through the scene alongside the subject.',
    promptKeyword: 'tracking shot', motion: { target: 'camera', kind: 'track', dir: 'left', speed: 'normal' } },
  { id: 'follow-shot', name: 'Follow shot / Over-the-shoulder', category: 'Dolly / Track',
    description: 'Move behind the subject at shoulder height.',
    promptKeyword: 'follow shot from behind', motion: { target: 'camera', kind: 'follow', dir: 'in', speed: 'normal' } },
  { id: 'reverse-tracking', name: 'Reverse tracking / Walk-and-talk', category: 'Dolly / Track',
    description: 'Move backward in front of the walking subject.',
    promptKeyword: 'reverse tracking shot', motion: { target: 'camera', kind: 'reverse-track', dir: 'out', speed: 'normal' } },
  { id: 'side-tracking', name: 'Side tracking', category: 'Dolly / Track',
    description: 'Move parallel beside the subject.',
    promptKeyword: 'side tracking shot', motion: { target: 'camera', kind: 'side-track', dir: 'right', speed: 'normal' } },
  { id: 'low-tracking', name: 'Low tracking', category: 'Dolly / Track',
    description: 'Move at ground or below-waist height alongside the subject.',
    promptKeyword: 'low tracking shot', motion: { target: 'camera', kind: 'low-track', dir: 'right', speed: 'normal' } },
  { id: 'vehicle-tracking', name: 'Vehicle tracking', category: 'Dolly / Track',
    description: 'Move together with the vehicle.',
    promptKeyword: 'vehicle tracking shot', motion: { target: 'camera', kind: 'vehicle-track', dir: 'right', speed: 'normal' } },
  { id: 'chase-shot', name: 'Chase shot', category: 'Dolly / Track',
    description: 'Follow a moving subject quickly.',
    promptKeyword: 'chase shot', motion: { target: 'camera', kind: 'chase', dir: 'in', speed: 'fast' } },

  // ── Drone / Crane (5) ───────────────────────────────────────────────────
  { id: 'crane-up', name: 'Crane up', category: 'Drone / Crane',
    description: 'Travel smoothly upward through open space.',
    promptKeyword: 'crane up', motion: { target: 'camera', kind: 'crane', dir: 'up', speed: 'slow' } },
  { id: 'crane-down', name: 'Crane down', category: 'Drone / Crane',
    description: 'Travel smoothly downward through open space.',
    promptKeyword: 'crane down', motion: { target: 'camera', kind: 'crane', dir: 'down', speed: 'slow' } },
  { id: 'drone-push-in', name: 'Drone push in', category: 'Drone / Crane',
    description: 'Fly forward toward the subject.',
    promptKeyword: 'drone push in', motion: { target: 'camera', kind: 'drone', dir: 'in', speed: 'normal' } },
  { id: 'drone-pull-back', name: 'Drone pull back', category: 'Drone / Crane',
    description: 'Fly backward away from the subject.',
    promptKeyword: 'drone pull back', motion: { target: 'camera', kind: 'drone', dir: 'out', speed: 'normal' } },
  { id: 'helicopter-shot', name: 'Helicopter shot', category: 'Drone / Crane',
    description: 'High-altitude broad gradual flight path.',
    promptKeyword: 'helicopter-style aerial shot', motion: { target: 'camera', kind: 'helicopter', dir: 'left', speed: 'slow' } },

  // ── Physical Moves (11) ─────────────────────────────────────────────────
  { id: 'truck-right', name: 'Truck right', category: 'Physical Moves',
    description: 'Move physically right on a straight horizontal path.',
    promptKeyword: 'truck right', motion: { target: 'camera', kind: 'truck', dir: 'right', speed: 'normal' } },
  { id: 'truck-left', name: 'Truck left', category: 'Physical Moves',
    description: 'Move physically left on a straight horizontal path.',
    promptKeyword: 'truck left', motion: { target: 'camera', kind: 'truck', dir: 'left', speed: 'normal' } },
  { id: 'pedestal-up', name: 'Pedestal up', category: 'Physical Moves',
    description: 'Raise the whole camera vertically in a straight line.',
    promptKeyword: 'pedestal up', motion: { target: 'camera', kind: 'pedestal', dir: 'up', speed: 'normal' } },
  { id: 'pedestal-down', name: 'Pedestal down', category: 'Physical Moves',
    description: 'Lower the whole camera vertically in a straight line.',
    promptKeyword: 'pedestal down', motion: { target: 'camera', kind: 'pedestal', dir: 'down', speed: 'normal' } },
  { id: 'slider-right', name: 'Slider right', category: 'Physical Moves',
    description: 'Slide a small distance to the right.',
    promptKeyword: 'slider right', motion: { target: 'camera', kind: 'slider', dir: 'right', speed: 'slow' } },
  { id: 'slider-left', name: 'Slider left', category: 'Physical Moves',
    description: 'Slide a small distance to the left.',
    promptKeyword: 'slider left', motion: { target: 'camera', kind: 'slider', dir: 'left', speed: 'slow' } },
  { id: 'push-past', name: 'Push past / Pass-by', category: 'Physical Moves',
    description: 'Move forward past a visible foreground object, edge or opening.',
    promptKeyword: 'push past', motion: { target: 'camera', kind: 'push-past', dir: 'in', speed: 'normal', params: { foreground: true } } },
  { id: 'arc-right', name: 'Arc right', category: 'Physical Moves',
    description: 'Curve on a shallow path around the subject to the right.',
    promptKeyword: 'arc right', motion: { target: 'camera', kind: 'arc', dir: 'right', speed: 'normal' } },
  { id: 'arc-left', name: 'Arc left', category: 'Physical Moves',
    description: 'Curve on a shallow path around the subject to the left.',
    promptKeyword: 'arc left', motion: { target: 'camera', kind: 'arc', dir: 'left', speed: 'normal' } },
  { id: 'orbit-clockwise', name: 'Orbit clockwise', category: 'Physical Moves',
    description: 'Circle clockwise around the subject at a constant radius.',
    promptKeyword: 'clockwise orbit', motion: { target: 'camera', kind: 'orbit', dir: 'cw', speed: 'normal' } },
  { id: 'orbit-counterclockwise', name: 'Orbit counterclockwise', category: 'Physical Moves',
    description: 'Circle counterclockwise around the subject at a constant radius.',
    promptKeyword: 'counterclockwise orbit', motion: { target: 'camera', kind: 'orbit', dir: 'ccw', speed: 'normal' } },

  // ── Human Camera (2) ────────────────────────────────────────────────────
  { id: 'handheld-shot', name: 'Handheld shot', category: 'Human Camera',
    description: 'Camera at operator height with natural body movement.',
    promptKeyword: 'handheld shot', motion: { target: 'camera', kind: 'handheld', speed: 'normal' } },
  { id: 'snorricam', name: 'Body-mounted / Snorricam', category: 'Human Camera',
    description: "Camera fixed relative to the subject's torso while they move.",
    promptKeyword: 'body-mounted Snorricam', motion: { target: 'camera', kind: 'snorricam', speed: 'normal' } },

  // ── Specials (6) ────────────────────────────────────────────────────────
  { id: 'first-person-view', name: 'First-person view', category: 'Specials',
    description: "Move forward at eye height from the character's point of view.",
    promptKeyword: 'first-person view', motion: { target: 'camera', kind: 'fpv', dir: 'in', speed: 'normal' } },
  { id: 'tilt-shift', name: 'Tilt-shift', category: 'Specials',
    description: 'High angled view with a narrow band of sharp focus.',
    promptKeyword: 'tilt-shift miniature view', motion: { target: 'camera', kind: 'tilt-shift', speed: 'slow' } },
  { id: 'infinite-zoom', name: 'Infinite zoom', category: 'Specials',
    description: 'Zoom continuously inward toward the center target.',
    promptKeyword: 'infinite zoom', motion: { target: 'camera', kind: 'infinite-zoom', dir: 'in', speed: 'normal' } },
  { id: 'earth-zoom-out', name: 'Earth zoom out', category: 'Specials',
    description: 'Pull up through street, city, landscape and planet.',
    promptKeyword: 'earth zoom out', motion: { target: 'camera', kind: 'earth-zoom', dir: 'out', speed: 'fast' } },
  { id: 'time-lapse', name: 'Time-lapse', category: 'Specials',
    description: 'Hold one fixed position while time moves rapidly.',
    promptKeyword: 'locked-camera time-lapse', motion: { target: 'camera', kind: 'timelapse' } },
  { id: 'pass-through', name: 'Pass-through objects', category: 'Specials',
    description: 'Move forward toward an object and continue into the space beyond.',
    promptKeyword: 'pass-through movement', motion: { target: 'camera', kind: 'pass-through', dir: 'in', speed: 'normal', params: { foreground: true } } },
];

/** Legacy 16-item movement ids (old 14_camera_movements.json) → new preset ids,
 *  so saved projects with a stored `movement` selection don't break. */
export const LEGACY_MOVEMENT_ID_MAP: Record<string, string> = {
  'static': 'static-shot',
  'handheld': 'handheld-shot',
  'camera-follows': 'follow-shot',
  'dolly-in': 'dolly-in',
  'dolly-out': 'dolly-out',
  'zoom-in': 'slow-zoom-in',
  'zoom-out': 'slow-zoom-out',
  'pan-left': 'pan-left',
  'pan-right': 'pan-right',
  'tilt-up': 'tilt-up',
  'tilt-down': 'tilt-down',
  'jib-up': 'crane-up',
  'jib-down': 'crane-down',
  'orbit-around': 'orbit-clockwise',
  'orbit-360': 'orbit-clockwise',
  'drone': 'drone-push-in',
};

const BY_ID: Record<string, MovementPreset> = Object.fromEntries(MOVEMENTS.map(m => [m.id, m]));

/** Resolve a preset by id, transparently migrating a legacy id if needed. */
export function getMovement(id: string | null | undefined): MovementPreset | undefined {
  if (!id) return undefined;
  return BY_ID[id] || BY_ID[LEGACY_MOVEMENT_ID_MAP[id] ?? ''];
}

/** Map a possibly-legacy id to the current preset id (or itself if unknown). */
export function migrateMovementId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (BY_ID[id]) return id;
  return LEGACY_MOVEMENT_ID_MAP[id] ?? id;
}

/** The 46 grouped by their 7 categories, in canonical category order. */
export function movementsByCategory(): { category: MovementCategory; items: MovementPreset[] }[] {
  return MOVEMENT_CATEGORIES.map(category => ({
    category,
    items: MOVEMENTS.filter(m => m.category === category),
  }));
}

/** Shape the presets into the app catalog's `CameraMovement` records so the
 *  shared DOP picker (Frame + Video) renders all 46 grouped by category. The
 *  stand-in is the existing generic thumbnail; the .mp4 field is unused by the
 *  picker (it renders `stand_in_filename` only). */
export function toCatalogMovements(): {
  id: string; name: string; filename: string; stand_in_filename: string;
  category: string; description: string; pick: boolean; promptKeyword: string;
}[] {
  return MOVEMENTS.map(m => ({
    id: m.id,
    name: m.name,
    filename: '',
    stand_in_filename: 'stand-in.jpg',
    category: m.category,
    description: m.description,
    pick: false,
    promptKeyword: m.promptKeyword,
  }));
}
