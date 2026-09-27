// Prompt builders for storyboard panels AND their reference assets (character
// face portraits, turnaround sheets, location plates, continuity elements).
// Ported from the proven Python pipeline (storyboard_to_visual.py +
// generate_character_sheets.py + generate_canonical_portraits.py). The look is
// driven by the selected preset (storyboardPresets.ts) so panels and assets
// share one register.
//
// NOTE: this does NOT go through promptBuilder.ts — that appends a photoreal
// render directive which fights a hand-drawn board. We build the full prompt
// here and call openai.generateWithReferences directly.

import type { StoryboardShot, StoryboardRefSlot } from '../types/storyboard';
import { panelId } from '../types/storyboard';
import type { StoryboardPreset } from './storyboardPresets';
import { shotSizePrompt, anglePrompt, movePrompt, lensPrompt, moveArrow } from './storyboardCamera';

function styleBlock(preset: StoryboardPreset, styleNote?: string): string {
  let s = `Style lock: ${preset.styleLock}`;
  if (styleNote && styleNote.trim()) s += `\nAdditional board-style note: ${styleNote.trim()}`;
  return s;
}

// Safety framing — prepended to every asset/panel prompt. Storyboards routinely
// include children and families; the image model's safety filter can false-flag
// innocent minor portraits. This makes the non-photographic, modest, respectful
// intent explicit so legitimate pre-production art isn't rejected.
const SAFE_FRAMING =
  'This is a hand-drawn, non-photographic storyboard illustration for film pre-production. ' +
  'Every person — including any children — is modest, fully and appropriately clothed in everyday dress, ' +
  'depicted respectfully and entirely non-sexually. No nudity, no suggestive posing, no intimate framing.';

// CINEMATIC STAGING — the "soul of the shot" directive. A storyboard panel is
// not a flat inventory of what's in frame; it is a COMPOSED cinematic image. This
// pushes the artist to stage with depth, light drama and an emotional read while
// staying inside the board's drawn medium — so panels carry the same filmic
// intent as a finished frame, not a diagram.
const CINEMATIC_STAGING =
  'CINEMATIC STAGING — draw this as a real film frame, not a diagram:\n' +
  '• Depth: distinct foreground, midground and background planes; place the subject on a clear depth plane with things nearer and farther, and imply atmospheric fall-off toward the back.\n' +
  '• Composition: deliberate framing — use the rule of thirds or centered symmetry on purpose, strong leading lines, negative space, and a single clear focal point that carries the eye.\n' +
  '• Light as drama: shape the subject with directional key light and shadow (chiaroscuro where it fits the mood); let the light model form and separate planes, not flatten them.\n' +
  '• The moment: capture the peak beat of the action/emotion — a gesture caught mid-motion, an eyeline with intent — so the panel reads as a decisive instant, not a pose.\n' +
  '• Lens feel: honour the shot size and lens above — compress or expand space accordingly, and let depth-of-field imply what is sharp vs soft.';

function deriveShotCode(shot?: string): string {
  if (!shot) return '';
  return shot.split('(')[0].trim() || shot;
}

function arrowSpec(move?: string): string {
  const m = (move ?? '').trim();
  if (!m) return 'render NO movement arrows.';
  // Preferred: the exact arrow instruction for the chosen move.
  const known = moveArrow(m);
  if (known) return `Draw bold, solid black movement notation: ${known}`;
  // Legacy fallback for free-text/glyph values.
  if (m.includes('▣') || /lock|static/i.test(m)) return 'render NO arrows — the camera is locked / static.';
  return (
    `render bold solid-filled arrows OUTSIDE the panel frame for this camera move "${m}": ` +
    `→ right edge, ← left edge, ↑ top, ↓ bottom, push-in as inward corner arrows, pull-out as outward arrows, ` +
    `arc as a curved arrow, dolly as a horizontal arrow. Keep them clean and clearly readable.`
  );
}

function dialogueSpec(dialogue?: string): string {
  const d = (dialogue ?? '').trim();
  if (!d || d === '—' || d === '-') return 'no dialogue — do not render any dialogue text.';
  return (
    `hand-letter the dialogue in quotation marks under the panel frame, smaller than the panel label: "${d}". ` +
    `If Arabic, render the Arabic as-is and below it a smaller English gloss in [square brackets].`
  );
}

function sfxSpec(sfx?: string, music?: string): string {
  const parts: string[] = [];
  if (sfx && sfx.trim() && sfx.trim() !== '—') parts.push(`SFX: ${sfx.trim()}`);
  if (music && music.trim() && music.trim() !== '—') parts.push(`Music: ${music.trim()}`);
  if (!parts.length) return 'no SFX / music cue to render.';
  return `hand-letter a small SFX / music cue below the panel: "${parts.join(' · ')}".`;
}

function anatomySpec(shot: StoryboardShot): string {
  const id = panelId(shot);
  return [
    'PANEL ANATOMY — render every element below ONTO the image, in the same drawing style, as part of the final frame:',
    `1. PANEL FRAME: a clean rectangular border, straight edges, occupying ~80% of the image. Outside the frame is blank ground.`,
    `2. PANEL NUMBER — top-left inner corner, hand-lettered block caps: "${id}". Legible.`,
    `3. SHOT CODE — under the number, smaller: "${deriveShotCode(shot.shot)}".`,
    `4. CAMERA-MOVE ARROWS — ${arrowSpec(shot.move)}`,
    `5. DURATION BADGE — bottom-right inner corner, small: "${(shot.duration ?? '').trim()}".`,
    `6. DIALOGUE CAPTION — ${dialogueSpec(shot.dialogue)}`,
    `7. SFX / MUSIC CUE — ${sfxSpec(shot.sfx, shot.music)}`,
    'All labels are hand-lettered in the board medium — NEVER typeset. Panel ID + shot code largest; the rest smaller.',
  ].join('\n');
}

function identityLock(characters: StoryboardRefSlot[], places: StoryboardRefSlot[], elements: StoryboardRefSlot[]): string {
  const blocks: string[] = [];
  if (characters.length) {
    const names = characters.map(c => c.name || 'character').join(' and ');
    const per = characters.map(c =>
      `- ${c.name || 'character'}: attached references show this exact person${c.note ? ` (${c.note})` : ''} — a face portrait and/or a turnaround sheet. ` +
      `The person rendered as ${c.name || 'this character'} MUST match those: same face shape, skin tone, nose, eyes, hair texture, facial-hair, build, and wardrobe. Identity anchor, not a suggestion.`,
    ).join('\n');
    const mixup = characters.length > 1
      ? '\nCRITICAL: do NOT swap or merge the characters — each reference set is a distinct person; render each strictly against their own references.'
      : '';
    blocks.push(`IDENTITY LOCK — this panel contains ${names}.\n${per}${mixup}`);
  }
  if (places.length) {
    blocks.push(`PLACE LOCK — the setting matches the attached reference(s) for ${places.map(p => p.name || 'place').join(' and ')}; keep architecture, layout, and key furniture consistent.`);
  }
  if (elements.length) {
    blocks.push(`CONTINUITY ELEMENTS — keep these objects identical to their attached reference(s): ${elements.map(e => e.name || 'element').join(', ')}.`);
  }
  return blocks.join('\n\n');
}

/** Build the full panel prompt. characters/places/elements are the slots
 *  ACTUALLY attached to this shot (resolved by the caller). */
export function buildPanelPrompt(
  shot: StoryboardShot,
  characters: StoryboardRefSlot[],
  places: StoryboardRefSlot[],
  elements: StoryboardRefSlot[],
  preset: StoryboardPreset,
  styleNote?: string,
): string {
  // FRAMING is emitted as a hard, explicit block so the shot-size + angle
  // choices actually drive the composition (not just label it).
  const shotP = shotSizePrompt(shot.shot);
  const angleP = anglePrompt(shot.angle);
  const framingLines: string[] = [];
  const lensP = lensPrompt(shot.lens) ?? (shot.lens ? `lens ${shot.lens}` : undefined);
  const moveP = movePrompt(shot.move) ?? (shot.move || undefined);
  if (shotP) framingLines.push(`• Shot size — ${shotP}.`);
  if (angleP) framingLines.push(`• Camera angle — ${angleP}.`);
  if (lensP) framingLines.push(`• Lens — ${lensP}.`);
  if (moveP) framingLines.push(`• Movement — ${moveP}; render as a single still at the start of the move.`);
  const framing = framingLines.length
    ? `FRAMING — compose the panel to MATCH this exactly; it overrides any conflicting habit:\n${framingLines.join('\n')}`
    : '';

  const body: string[] = [];
  if (shot.description) body.push(`Frame brief: ${shot.description}`);
  if (framing) body.push(framing);
  if (shot.character) body.push(`Character state and wardrobe: ${shot.character}`);
  if (shot.blocking) body.push(`Blocking: ${shot.blocking}`);
  if (shot.light) body.push(`Light architecture: ${shot.light}`);
  if (shot.frameFurniture) body.push(`Frame furniture: ${shot.frameFurniture}`);

  const lock = identityLock(characters, places, elements);

  const parts: string[] = [SAFE_FRAMING, ''];
  if (lock) parts.push(lock, '');
  parts.push(body.join('\n\n'), '');
  parts.push(CINEMATIC_STAGING, '');
  parts.push(anatomySpec(shot), '');
  parts.push(styleBlock(preset, styleNote));
  parts.push('', `Reference priority: character face references lock identity (highest), then character sheets lock build/wardrobe, then place references lock the setting, then continuity-element references, then any board-style plate (atmosphere).`);
  parts.push('', `Absolutely avoid: ${preset.negatives}.`);
  return parts.join('\n');
}

// ─── reference assets ─────────────────────────────────────────────

/** When the user supplies a client reference photo, tell the model to base the
 *  design on it (turning the photo into the board's drawing style). */
const fromRefLine = (on?: boolean) => on
  ? 'Base the design closely on the ATTACHED client reference image — match the likeness/look faithfully, then RE-RENDER it in the board drawing style below (do not copy it photographically).'
  : '';

/** Character FACE portrait — single clean head study, identity reference. */
export function buildFacePrompt(c: StoryboardRefSlot, preset: StoryboardPreset, styleNote?: string, fromRef?: boolean): string {
  return [
    SAFE_FRAMING,
    '',
    fromRefLine(fromRef),
    `Character-design head reference for "${c.name || 'character'}"${c.note ? ` — ${c.note}` : ''}.`,
    `A front-view head sketch, shoulders up, calm neutral expression, clearly readable facial features — a consistency ` +
    `reference for the character's look. Front-facing (not in profile). Modest, fully clothed, plain blank ground, no props.`,
    '',
    styleBlock(preset, styleNote),
    '',
    `Absolutely avoid: ${preset.negatives}, multiple faces, several people, scene background.`,
  ].join('\n');
}

/** Character TURNAROUND sheet — head studies + full-body turnaround + props. */
export function buildSheetPrompt(c: StoryboardRefSlot, preset: StoryboardPreset, styleNote?: string, fromRef?: boolean): string {
  return [
    SAFE_FRAMING,
    '',
    fromRefLine(fromRef),
    `Character turnaround SHEET for "${c.name || 'character'}"${c.note ? ` — ${c.note}` : ''}.`,
    `Lay out as an art-department reference page in three rows on a blank ground:`,
    `TOP ROW — five head studies of the SAME face (front · 3/4 · side R · side L · back), labelled.`,
    `MIDDLE ROW — five full-body turnaround views in the character's wardrobe (front · 3/4 front · side · 3/4 back · back), neutral pose.`,
    `BOTTOM ROW — the character in their default pose + a small props inset.`,
    `Same person in every view — one person from many angles, NOT several people. Hand-letter the name as a header.`,
    '',
    styleBlock(preset, styleNote),
    '',
    `Absolutely avoid: ${preset.negatives}, inconsistent faces across views, scene background.`,
  ].join('\n');
}

/** Location/place establishing plate. */
export function buildPlacePrompt(p: StoryboardRefSlot, preset: StoryboardPreset, styleNote?: string, fromRef?: boolean): string {
  return [
    SAFE_FRAMING,
    '',
    fromRefLine(fromRef),
    `Establishing LOCATION plate for "${p.name || 'place'}"${p.note ? ` — ${p.note}` : ''}.`,
    `A wide establishing view that defines the space: its architecture, layout, key furniture, light direction, and the one cultural-truth detail that makes it real. No people in the frame.`,
    '',
    styleBlock(preset, styleNote),
    '',
    `Absolutely avoid: ${preset.negatives}, people, characters, portraits.`,
  ].join('\n');
}

/** Stripped, extra-wholesome fallback for assets — used to auto-retry when the
 *  safety filter false-flags a child/family character. No freeform note, no
 *  body/wardrobe minutiae; just a plain, appropriate character-design sketch. */
export function buildSafeAssetPrompt(name: string, type: 'face' | 'sheet' | 'place' | 'element', preset: StoryboardPreset, styleNote?: string): string {
  const what = type === 'face' ? 'a simple front-view character-design head sketch (head and shoulders), neutral friendly expression'
    : type === 'sheet' ? 'a simple character turnaround sheet — a few modest full-body views in everyday clothes'
    : type === 'place' ? 'an establishing location sketch with NO people'
    : 'a simple object study with NO people';
  return [
    SAFE_FRAMING,
    '',
    `A wholesome, modest, entirely age-appropriate ${what} for "${name}". Keep it simple, friendly, fully clothed; this is innocent pre-production character art.`,
    '',
    styleBlock(preset, styleNote),
    '',
    `Absolutely avoid: ${preset.negatives}, anything suggestive, any skin focus, any intimacy.`,
  ].join('\n');
}

/** Stripped, extra-wholesome fallback for a panel. */
export function buildSafePanelPrompt(shot: StoryboardShot, preset: StoryboardPreset, styleNote?: string): string {
  return [
    SAFE_FRAMING,
    '',
    `A wholesome, modest storyboard panel — everyone fully clothed and depicted respectfully: ${shot.description || 'a simple scene'}.`,
    '',
    anatomySpec(shot),
    '',
    styleBlock(preset, styleNote),
    '',
    `Absolutely avoid: ${preset.negatives}, anything suggestive, any skin focus, any intimacy.`,
  ].join('\n');
}

/** A canonical look-sample so a client can SEE the preset before choosing it.
 *  Same neutral subject for every preset — only the medium changes. */
export function buildPresetSamplePrompt(preset: StoryboardPreset): string {
  return [
    SAFE_FRAMING,
    '',
    `A storyboard sample panel: a lone figure standing in a doorway, seen from a medium-wide angle, ` +
    `one hand on the frame, looking out into the light — a simple, neutral scene whose only job is to SHOW the drawing medium.`,
    'No labels, no panel number, no arrows — just the rendered image inside a simple frame.',
    '',
    styleBlock(preset),
    '',
    `Absolutely avoid: ${preset.negatives}, text, labels, watermarks.`,
  ].join('\n');
}

/** Continuity element / prop plate. */
export function buildElementPrompt(e: StoryboardRefSlot, preset: StoryboardPreset, styleNote?: string, fromRef?: boolean): string {
  return [
    SAFE_FRAMING,
    '',
    fromRefLine(fromRef),
    `Continuity ELEMENT reference for "${e.name || 'object'}"${e.note ? ` — ${e.note}` : ''}.`,
    `A clean, isolated study of the object on a blank ground — multiple angles if useful — so it can stay identical across panels. No scene, no people.`,
    '',
    styleBlock(preset, styleNote),
    '',
    `Absolutely avoid: ${preset.negatives}, people, scene background.`,
  ].join('\n');
}
