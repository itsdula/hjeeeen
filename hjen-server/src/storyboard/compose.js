// HJEN Storyboard recipe — SERVER-SIDE prompt composition.
//
// Faithful port of the client's storyboardPrompt.ts + storyboardCamera.ts +
// storyboardPresets.ts, moved off the client so the board recipe (style locks,
// negatives, cinematic-staging, panel anatomy, identity locks) never ships in
// the browser bundle or crosses the wire. Keep in lock-step with the client
// (offline path). LAW: the recipe lives on the server.

// ── camera vocabulary (port of storyboardCamera.ts) ──────────────────────────
const SHOT_SIZES = [
  { code: 'ECU', prompt: 'EXTREME CLOSE-UP: the frame is filled by a single detail (eyes, mouth, hands, or one object); the face is cropped top and bottom; no headroom; maximum intimacy' },
  { code: 'CU', prompt: 'CLOSE-UP: head and the very top of the shoulders fill the frame; the expression dominates; background heavily out of focus' },
  { code: 'MCU', prompt: 'MEDIUM CLOSE-UP: framed from mid-chest up; head-and-shoulders, expression clearly readable, a little of the setting visible' },
  { code: 'MS', prompt: 'MEDIUM SHOT: framed from the waist up; gesture, hands and posture visible with the setting around the subject' },
  { code: 'MLS', prompt: 'MEDIUM LONG (COWBOY) SHOT: framed from mid-thigh up; full body language reads, the figure shares the frame with the environment' },
  { code: 'LS', prompt: 'LONG SHOT: the full figure head-to-toe stands within the environment; person and place balanced' },
  { code: 'WS', prompt: 'WIDE SHOT: the figure is small within a broad view of the location; the environment dominates the frame' },
  { code: 'EWS', prompt: 'EXTREME WIDE / ESTABLISHING SHOT: a vast view of the location; any figure is tiny; the place itself is the subject' },
  { code: '2S', prompt: 'TWO-SHOT: two people framed together so the relationship and space between them reads clearly' },
  { code: 'OTS', prompt: 'OVER-THE-SHOULDER: framed from behind the near person\'s shoulder (shoulder + back of head soft in the foreground) onto the far subject in focus' },
  { code: 'POV', prompt: 'POINT-OF-VIEW: the camera IS the character\'s eyes — we see exactly what they see, no part of them in frame' },
  { code: 'INS', prompt: 'INSERT / CUTAWAY: a tight isolated detail of an object or action (a hand, a phone, a key) — no face needed' },
];

const ANGLES = [
  { code: 'EL', prompt: 'EYE-LEVEL: camera at the subject\'s eye height, neutral and even' },
  { code: 'HA', prompt: 'HIGH ANGLE: the camera looks DOWN on the subject from above, making them feel smaller or vulnerable' },
  { code: 'LA', prompt: 'LOW ANGLE: the camera looks UP at the subject from below, making them feel tall, dominant or heroic' },
  { code: 'OH', prompt: 'OVERHEAD / TOP-DOWN (god\'s-eye): the camera is directly above looking straight down on the scene' },
  { code: 'WE', prompt: 'WORM\'S-EYE: extreme low angle, camera near the ground looking sharply upward' },
  { code: 'DUT', prompt: 'DUTCH / CANTED ANGLE: the horizon is deliberately tilted, the whole frame off-kilter for tension or unease' },
];

const MOVES = [
  { code: '▣ static', prompt: 'STATIC, locked-off camera — a perfectly still, composed frame, no motion', arrow: 'NO movement arrows (the camera is locked).' },
  { code: '← pan left', prompt: 'PAN LEFT — the camera pivots horizontally to the left; compose with lead room on the left', arrow: 'one bold straight arrow OUTSIDE the top edge pointing LEFT (←), labelled "PAN".' },
  { code: '→ pan right', prompt: 'PAN RIGHT — the camera pivots horizontally to the right; lead room on the right', arrow: 'one bold straight arrow OUTSIDE the top edge pointing RIGHT (→), labelled "PAN".' },
  { code: '↑ tilt up', prompt: 'TILT UP — the camera pivots vertically upward; emphasis rising through the frame', arrow: 'one bold straight arrow OUTSIDE the right edge pointing UP (↑), labelled "TILT".' },
  { code: '↓ tilt down', prompt: 'TILT DOWN — the camera pivots vertically downward; emphasis settling lower', arrow: 'one bold straight arrow OUTSIDE the right edge pointing DOWN (↓), labelled "TILT".' },
  { code: '⊙→ push in', prompt: 'SLOW PUSH-IN — the camera moves toward the subject; compose tighter, drawing the viewer in', arrow: 'four short arrows just OUTSIDE the four corners all pointing INWARD toward the centre, labelled "PUSH IN".' },
  { code: '⊙← pull out', prompt: 'PULL-OUT — the camera moves away; compose slightly wider, subject receding into context', arrow: 'four short arrows at the centre pointing OUTWARD to the four corners, labelled "PULL OUT".' },
  { code: '⇠ track left', prompt: 'TRACKING LEFT — the whole camera slides left alongside the subject; sideways momentum', arrow: 'a long horizontal arrow OUTSIDE the bottom edge pointing LEFT (←), labelled "DOLLY".' },
  { code: '⇢ track right', prompt: 'TRACKING RIGHT — the whole camera slides right; sideways momentum', arrow: 'a long horizontal arrow OUTSIDE the bottom edge pointing RIGHT (→), labelled "DOLLY".' },
  { code: '⇡ crane up', prompt: 'CRANE UP — the camera rises on a boom, lifting above the subject', arrow: 'a tall vertical arrow OUTSIDE the left edge pointing UP, labelled "CRANE".' },
  { code: '⇣ crane down', prompt: 'CRANE DOWN — the camera descends on a boom toward the subject', arrow: 'a tall vertical arrow OUTSIDE the left edge pointing DOWN, labelled "CRANE".' },
  { code: '⟲ arc left', prompt: 'ARC LEFT — the camera curves counter-clockwise around the subject', arrow: 'a CURVED arrow wrapping around the bottom of the frame, arrowhead pointing LEFT, labelled "ARC".' },
  { code: '⟳ arc right', prompt: 'ARC RIGHT — the camera curves clockwise around the subject', arrow: 'a CURVED arrow wrapping around the bottom of the frame, arrowhead pointing RIGHT, labelled "ARC".' },
  { code: 'Z+ zoom in', prompt: 'ZOOM IN — the lens zooms tighter; flattened perspective on the subject', arrow: 'a small rectangle drawn inside near the centre with inward arrows at its corners, labelled "ZOOM IN".' },
  { code: 'Z− zoom out', prompt: 'ZOOM OUT — the lens zooms wider, revealing surroundings', arrow: 'outward arrows from the centre toward the corners, labelled "ZOOM OUT".' },
  { code: 'RF→ rack focus', prompt: 'RACK FOCUS — focus shifts between planes; one plane sharp, the other soft', arrow: 'a small double-headed arrow between a foreground mark and a background mark, labelled "RACK FOCUS" (no camera-move arrows).' },
  { code: '∞ handheld', prompt: 'HANDHELD — loose, slightly unstable, energetic documentary framing', arrow: 'a small wavy/jitter mark in a corner labelled "HANDHELD" (no directional arrow).' },
  { code: 'STDCM steadicam', prompt: 'STEADICAM — a smooth floating following move', arrow: 'a smooth horizontal arrow OUTSIDE the bottom edge labelled "STEADICAM".' },
  { code: 'WP whip pan', prompt: 'WHIP PAN — a very fast pan with directional motion-blur streaks', arrow: 'a long bold arrow across the top edge with speed-lines/streaks, labelled "WHIP".' },
  { code: 'SNAP snap-zoom', prompt: 'SNAP ZOOM — a sudden fast punch-in to a tighter framing', arrow: 'bold inward arrows at the corners with speed-lines, labelled "SNAP ZOOM".' },
];

const LENSES = [
  { code: '8mm fisheye', prompt: '8mm FISHEYE ULTRA-WIDE: extreme barrel distortion, strongly curved horizon, bulging near-180° field, everything in deep focus' },
  { code: '14mm ultra-wide', prompt: '14mm ULTRA-WIDE: expansive sweeping view, strong perspective, slight edge distortion, very deep focus' },
  { code: '24mm wide', prompt: '24mm WIDE: broad context, mild perspective exaggeration, deep depth of field' },
  { code: '35mm', prompt: '35mm: natural reportage feel, balanced perspective, moderate depth' },
  { code: '50mm normal', prompt: '50mm NORMAL: human-eye perspective, neutral, no distortion' },
  { code: '85mm portrait', prompt: '85mm SHORT TELEPHOTO: flattering compression, shallow depth of field, soft melting background' },
  { code: '100mm', prompt: '100mm TELEPHOTO: clear compression, shallow focus, background pushed out' },
  { code: '135mm tele', prompt: '135mm LONG TELEPHOTO: strong compression, very shallow focus, background collapsed and creamy' },
  { code: '200mm long', prompt: '200mm VERY LONG: extreme compression, subject isolated, background flattened to a wash' },
  { code: 'anamorphic', prompt: 'ANAMORPHIC: wide 2.39 cinematic feel, oval bokeh, subtle horizontal flares, gentle edge stretch' },
  { code: 'macro', prompt: 'MACRO: extreme close focus on a tiny detail, razor-thin depth of field' },
  { code: 'fisheye', prompt: 'FISHEYE: extreme barrel distortion, strongly curved horizon, bulging perspective' },
];

function normalize(code) {
  if (!code) return '';
  return code.split('(')[0].trim().toUpperCase();
}
function movePrompt(code) { const c = (code ?? '').trim().toLowerCase(); return MOVES.find((m) => m.code.toLowerCase() === c)?.prompt; }
function moveArrow(code) { const c = (code ?? '').trim().toLowerCase(); return MOVES.find((m) => m.code.toLowerCase() === c)?.arrow; }
function lensPrompt(code) { const c = (code ?? '').trim().toLowerCase(); return LENSES.find((l) => l.code.toLowerCase() === c)?.prompt; }
function shotSizePrompt(code) { const c = normalize(code); return SHOT_SIZES.find((s) => s.code === c)?.prompt; }
function anglePrompt(code) { const c = normalize(code); return ANGLES.find((a) => a.code === c)?.prompt; }

// ── presets (port of storyboardPresets.ts) ───────────────────────────────────
const MONO_NEG = 'color of any kind, cream background, ivory background, warm paper tone, sepia wash, '
  + 'photo-realistic rendering, 3D render, CGI, digital photo, airbrushed gradients, Instagram-flattened look, '
  + 'AI-generated sheen, vector art, typeset printed labels';
const COLOR_NEG = 'photo-realistic rendering, 3D render, CGI, photograph, airbrushed plastic skin, Instagram-flattened look, '
  + 'AI-generated sheen, vector art, typeset printed labels';

export const STORYBOARD_PRESETS = [
  { id: 'graphite', label: 'Graphite Pencil', note: 'Classic feature-film board, soft pencil on white', styleLock: 'Hand-drawn professional feature-film storyboard panel, graphite pencil on PURE WHITE paper. Cross-hatching and parallel-line hatching for shading, layered pencil weights 2B–6B, monochrome only. Black ink for the panel border, labels, and bold camera-move arrows. The crisp page of a feature-film board artist.', negatives: MONO_NEG },
  { id: 'blue', label: 'Non-Photo Blue', note: 'Animation rough boards, col-erase blue pencil', styleLock: 'Animation rough storyboard in NON-PHOTO BLUE col-erase pencil on white paper — the industry rough-board look. Loose confident blue-pencil construction lines, light blue tonal hatching, occasional red-pencil accents for emphasis. Gestural, energetic, clearly a rough animation board, not a finished drawing.', negatives: 'full colour palette, photo-realistic rendering, 3D render, CGI, photograph, airbrushed gradients, AI sheen, typeset labels' },
  { id: 'marker', label: 'Grey Marker', note: 'Agency commercial boards, Copic grey tones', styleLock: 'Advertising/commercial storyboard rendered in GREY markers (Copic/ProMarker), the agency board-room standard. Clean ink line over layered warm-and-cool grey marker tones, confident flat fills, soft streak texture of marker on marker paper, a few white-gel highlights. Monochrome grey, professional and quick.', negatives: 'full saturated colour, photo-realistic rendering, 3D render, CGI, photograph, AI sheen, typeset printed labels' },
  { id: 'ink', label: 'Clean Ink Line', note: 'High-clarity black ink line art', styleLock: 'Clean black-ink storyboard line art on white — high-clarity clear-line drawing. Confident uniform-weight ink contours, minimal hatching only where shadow is essential, lots of white space. Reads instantly, like a clear-line bande-dessinée panel in monochrome.', negatives: MONO_NEG + ', pencil texture, marker bleed, watercolor' },
  { id: 'charcoal', label: 'Charcoal Noir', note: 'Dramatic chiaroscuro, conté + charcoal', styleLock: 'Dramatic charcoal-and-conté storyboard on toned white — heavy chiaroscuro, deep velvety blacks, smudged tonal masses, bold light-and-shadow blocking. Film-noir mood-board register; expressive, smoky, high-contrast monochrome.', negatives: MONO_NEG + ', clean thin line art, flat even lighting' },
  { id: 'digital', label: 'Storyboard Pro', note: 'Clean digital line + flat greys (Toon Boom)', styleLock: 'Digital storyboard in the Toon Boom Storyboard Pro register — crisp uniform digital ink line with flat grey tonal fills, clean shape blocking, even values. Tidy, modern, production-pipeline board look.', negatives: MONO_NEG + ', pencil grain, paper texture, marker streaks, painterly brushwork' },
  { id: 'colormarker', label: 'Colour Marker', note: 'Full-colour marker production board', styleLock: 'Full-COLOUR marker production storyboard — ink line over vibrant Copic-marker colour fills, confident streaky marker texture, white-gel highlights. High-end commercial/film colour board: lively, illustrative, clearly hand-rendered marker art.', negatives: COLOR_NEG + ', flat vector fills, monochrome' },
  { id: 'watercolor', label: 'Watercolour Concept', note: 'Loose painted production board (McQuarrie-style)', styleLock: 'Watercolour-and-gouache concept/production board in the lineage of classic film concept illustration (à la Ralph McQuarrie). Loose washes, soft edges, atmospheric colour, gentle pencil under-drawing showing through. Painterly, evocative, full colour.', negatives: COLOR_NEG + ', hard vector line, flat marker fills, clinical digital line' },
  { id: 'bd', label: 'Comic / BD', note: 'Clear-line ink + flat colour panel', styleLock: 'Franco-Belgian bande-dessinée storyboard panel — clean clear-line black ink contours with flat bright colour fills (ligne claire). Crisp, graphic, comic-album register; confident outlines, simple cel-flat colour, no gradients.', negatives: COLOR_NEG + ', painterly brushwork, photographic shading, heavy gradients' },
  { id: 'previs', label: 'Cinematic Greyscale', note: 'Monochrome digital painting (previs concept)', styleLock: 'Cinematic greyscale previs concept frame — monochrome digital painting with a photographic value range, soft atmospheric depth, realistic light falloff and lens-like framing, but rendered as a painted greyscale board (not a photo). Moody, filmic, value-driven.', negatives: 'saturated colour, hard cartoon outline, flat marker fills, typeset printed labels, AI sheen' },
];

export function presetById(id) {
  return STORYBOARD_PRESETS.find((p) => p.id === id) ?? STORYBOARD_PRESETS[0];
}

const panelId = (shot) => `${shot.scene}${shot.letter}`;

// ── prompt building (port of storyboardPrompt.ts) ────────────────────────────
function styleBlock(preset, styleNote) {
  let s = `Style lock: ${preset.styleLock}`;
  if (styleNote && styleNote.trim()) s += `\nAdditional board-style note: ${styleNote.trim()}`;
  return s;
}

const SAFE_FRAMING =
  'This is a hand-drawn, non-photographic storyboard illustration for film pre-production. '
  + 'Every person — including any children — is modest, fully and appropriately clothed in everyday dress, '
  + 'depicted respectfully and entirely non-sexually. No nudity, no suggestive posing, no intimate framing.';

const CINEMATIC_STAGING =
  'CINEMATIC STAGING — draw this as a real film frame, not a diagram:\n'
  + '• Depth: distinct foreground, midground and background planes; place the subject on a clear depth plane with things nearer and farther, and imply atmospheric fall-off toward the back.\n'
  + '• Composition: deliberate framing — use the rule of thirds or centered symmetry on purpose, strong leading lines, negative space, and a single clear focal point that carries the eye.\n'
  + '• Light as drama: shape the subject with directional key light and shadow (chiaroscuro where it fits the mood); let the light model form and separate planes, not flatten them.\n'
  + '• The moment: capture the peak beat of the action/emotion — a gesture caught mid-motion, an eyeline with intent — so the panel reads as a decisive instant, not a pose.\n'
  + '• Lens feel: honour the shot size and lens above — compress or expand space accordingly, and let depth-of-field imply what is sharp vs soft.';

function deriveShotCode(shot) {
  if (!shot) return '';
  return shot.split('(')[0].trim() || shot;
}

function arrowSpec(move) {
  const m = (move ?? '').trim();
  if (!m) return 'render NO movement arrows.';
  const known = moveArrow(m);
  if (known) return `Draw bold, solid black movement notation: ${known}`;
  if (m.includes('▣') || /lock|static/i.test(m)) return 'render NO arrows — the camera is locked / static.';
  return (
    `render bold solid-filled arrows OUTSIDE the panel frame for this camera move "${m}": `
    + `→ right edge, ← left edge, ↑ top, ↓ bottom, push-in as inward corner arrows, pull-out as outward arrows, `
    + `arc as a curved arrow, dolly as a horizontal arrow. Keep them clean and clearly readable.`
  );
}

function dialogueSpec(dialogue) {
  const d = (dialogue ?? '').trim();
  if (!d || d === '—' || d === '-') return 'no dialogue — do not render any dialogue text.';
  return (
    `hand-letter the dialogue in quotation marks under the panel frame, smaller than the panel label: "${d}". `
    + `If Arabic, render the Arabic as-is and below it a smaller English gloss in [square brackets].`
  );
}

function sfxSpec(sfx, music) {
  const parts = [];
  if (sfx && sfx.trim() && sfx.trim() !== '—') parts.push(`SFX: ${sfx.trim()}`);
  if (music && music.trim() && music.trim() !== '—') parts.push(`Music: ${music.trim()}`);
  if (!parts.length) return 'no SFX / music cue to render.';
  return `hand-letter a small SFX / music cue below the panel: "${parts.join(' · ')}".`;
}

function anatomySpec(shot) {
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

function identityLock(characters, places, elements) {
  const blocks = [];
  if (characters.length) {
    const names = characters.map((c) => c.name || 'character').join(' and ');
    const per = characters.map((c) =>
      `- ${c.name || 'character'}: attached references show this exact person${c.note ? ` (${c.note})` : ''} — a face portrait and/or a turnaround sheet. `
      + `The person rendered as ${c.name || 'this character'} MUST match those: same face shape, skin tone, nose, eyes, hair texture, facial-hair, build, and wardrobe. Identity anchor, not a suggestion.`,
    ).join('\n');
    const mixup = characters.length > 1
      ? '\nCRITICAL: do NOT swap or merge the characters — each reference set is a distinct person; render each strictly against their own references.'
      : '';
    blocks.push(`IDENTITY LOCK — this panel contains ${names}.\n${per}${mixup}`);
  }
  if (places.length) {
    blocks.push(`PLACE LOCK — the setting matches the attached reference(s) for ${places.map((p) => p.name || 'place').join(' and ')}; keep architecture, layout, and key furniture consistent.`);
  }
  if (elements.length) {
    blocks.push(`CONTINUITY ELEMENTS — keep these objects identical to their attached reference(s): ${elements.map((e) => e.name || 'element').join(', ')}.`);
  }
  return blocks.join('\n\n');
}

export function buildPanelPrompt(shot, characters, places, elements, preset, styleNote) {
  const shotP = shotSizePrompt(shot.shot);
  const angleP = anglePrompt(shot.angle);
  const framingLines = [];
  const lensP = lensPrompt(shot.lens) ?? (shot.lens ? `lens ${shot.lens}` : undefined);
  const moveP = movePrompt(shot.move) ?? (shot.move || undefined);
  if (shotP) framingLines.push(`• Shot size — ${shotP}.`);
  if (angleP) framingLines.push(`• Camera angle — ${angleP}.`);
  if (lensP) framingLines.push(`• Lens — ${lensP}.`);
  if (moveP) framingLines.push(`• Movement — ${moveP}; render as a single still at the start of the move.`);
  const framing = framingLines.length
    ? `FRAMING — compose the panel to MATCH this exactly; it overrides any conflicting habit:\n${framingLines.join('\n')}`
    : '';

  const body = [];
  if (shot.description) body.push(`Frame brief: ${shot.description}`);
  if (framing) body.push(framing);
  if (shot.character) body.push(`Character state and wardrobe: ${shot.character}`);
  if (shot.blocking) body.push(`Blocking: ${shot.blocking}`);
  if (shot.light) body.push(`Light architecture: ${shot.light}`);
  if (shot.frameFurniture) body.push(`Frame furniture: ${shot.frameFurniture}`);

  const lock = identityLock(characters, places, elements);

  const parts = [SAFE_FRAMING, ''];
  if (lock) parts.push(lock, '');
  parts.push(body.join('\n\n'), '');
  parts.push(CINEMATIC_STAGING, '');
  parts.push(anatomySpec(shot), '');
  parts.push(styleBlock(preset, styleNote));
  parts.push('', `Reference priority: character face references lock identity (highest), then character sheets lock build/wardrobe, then place references lock the setting, then continuity-element references, then any board-style plate (atmosphere).`);
  parts.push('', `Absolutely avoid: ${preset.negatives}.`);
  return parts.join('\n');
}

const fromRefLine = (on) => on
  ? 'Base the design closely on the ATTACHED client reference image — match the likeness/look faithfully, then RE-RENDER it in the board drawing style below (do not copy it photographically).'
  : '';

export function buildFacePrompt(c, preset, styleNote, fromRef) {
  return [
    SAFE_FRAMING, '',
    fromRefLine(fromRef),
    `Character-design head reference for "${c.name || 'character'}"${c.note ? ` — ${c.note}` : ''}.`,
    `A front-view head sketch, shoulders up, calm neutral expression, clearly readable facial features — a consistency `
    + `reference for the character's look. Front-facing (not in profile). Modest, fully clothed, plain blank ground, no props.`,
    '',
    styleBlock(preset, styleNote), '',
    `Absolutely avoid: ${preset.negatives}, multiple faces, several people, scene background.`,
  ].join('\n');
}

export function buildSheetPrompt(c, preset, styleNote, fromRef) {
  return [
    SAFE_FRAMING, '',
    fromRefLine(fromRef),
    `Character turnaround SHEET for "${c.name || 'character'}"${c.note ? ` — ${c.note}` : ''}.`,
    `Lay out as an art-department reference page in three rows on a blank ground:`,
    `TOP ROW — five head studies of the SAME face (front · 3/4 · side R · side L · back), labelled.`,
    `MIDDLE ROW — five full-body turnaround views in the character's wardrobe (front · 3/4 front · side · 3/4 back · back), neutral pose.`,
    `BOTTOM ROW — the character in their default pose + a small props inset.`,
    `Same person in every view — one person from many angles, NOT several people. Hand-letter the name as a header.`,
    '',
    styleBlock(preset, styleNote), '',
    `Absolutely avoid: ${preset.negatives}, inconsistent faces across views, scene background.`,
  ].join('\n');
}

export function buildPlacePrompt(p, preset, styleNote, fromRef) {
  return [
    SAFE_FRAMING, '',
    fromRefLine(fromRef),
    `Establishing LOCATION plate for "${p.name || 'place'}"${p.note ? ` — ${p.note}` : ''}.`,
    `A wide establishing view that defines the space: its architecture, layout, key furniture, light direction, and the one cultural-truth detail that makes it real. No people in the frame.`,
    '',
    styleBlock(preset, styleNote), '',
    `Absolutely avoid: ${preset.negatives}, people, characters, portraits.`,
  ].join('\n');
}

export function buildSafeAssetPrompt(name, type, preset, styleNote) {
  const what = type === 'face' ? 'a simple front-view character-design head sketch (head and shoulders), neutral friendly expression'
    : type === 'sheet' ? 'a simple character turnaround sheet — a few modest full-body views in everyday clothes'
      : type === 'place' ? 'an establishing location sketch with NO people'
        : 'a simple object study with NO people';
  return [
    SAFE_FRAMING, '',
    `A wholesome, modest, entirely age-appropriate ${what} for "${name}". Keep it simple, friendly, fully clothed; this is innocent pre-production character art.`,
    '',
    styleBlock(preset, styleNote), '',
    `Absolutely avoid: ${preset.negatives}, anything suggestive, any skin focus, any intimacy.`,
  ].join('\n');
}

export function buildSafePanelPrompt(shot, preset, styleNote) {
  return [
    SAFE_FRAMING, '',
    `A wholesome, modest storyboard panel — everyone fully clothed and depicted respectfully: ${shot.description || 'a simple scene'}.`,
    '',
    anatomySpec(shot), '',
    styleBlock(preset, styleNote), '',
    `Absolutely avoid: ${preset.negatives}, anything suggestive, any skin focus, any intimacy.`,
  ].join('\n');
}

export function buildPresetSamplePrompt(preset) {
  return [
    SAFE_FRAMING, '',
    `A storyboard sample panel: a lone figure standing in a doorway, seen from a medium-wide angle, `
    + `one hand on the frame, looking out into the light — a simple, neutral scene whose only job is to SHOW the drawing medium.`,
    'No labels, no panel number, no arrows — just the rendered image inside a simple frame.',
    '',
    styleBlock(preset), '',
    `Absolutely avoid: ${preset.negatives}, text, labels, watermarks.`,
  ].join('\n');
}

export function buildElementPrompt(e, preset, styleNote, fromRef) {
  return [
    SAFE_FRAMING, '',
    fromRefLine(fromRef),
    `Continuity ELEMENT reference for "${e.name || 'object'}"${e.note ? ` — ${e.note}` : ''}.`,
    `A clean, isolated study of the object on a blank ground — multiple angles if useful — so it can stay identical across panels. No scene, no people.`,
    '',
    styleBlock(preset, styleNote), '',
    `Absolutely avoid: ${preset.negatives}, people, scene background.`,
  ].join('\n');
}

// ── dispatcher: build primary + safe-fallback prompt for a request ───────────
/**
 * @param {object} req { kind, shot?, slot?, characters?, places?, elements?,
 *   presetId?, preset?(custom), styleNote?, fromRef?, name? }
 * @returns {{prompt:string, fallbackPrompt?:string}}
 */
export function buildStoryboardPrompt(req) {
  const preset = req.preset && req.preset.styleLock ? req.preset : presetById(req.presetId);
  const note = req.styleNote;
  switch (req.kind) {
    case 'panel':
      return {
        prompt: buildPanelPrompt(req.shot, req.characters || [], req.places || [], req.elements || [], preset, note),
        fallbackPrompt: buildSafePanelPrompt(req.shot, preset, note),
      };
    case 'face':
      return { prompt: buildFacePrompt(req.slot, preset, note, req.fromRef), fallbackPrompt: buildSafeAssetPrompt(req.slot?.name, 'face', preset, note) };
    case 'sheet':
      return { prompt: buildSheetPrompt(req.slot, preset, note, req.fromRef), fallbackPrompt: buildSafeAssetPrompt(req.slot?.name, 'sheet', preset, note) };
    case 'place':
      return { prompt: buildPlacePrompt(req.slot, preset, note, req.fromRef), fallbackPrompt: buildSafeAssetPrompt(req.slot?.name, 'place', preset, note) };
    case 'element':
      return { prompt: buildElementPrompt(req.slot, preset, note, req.fromRef), fallbackPrompt: buildSafeAssetPrompt(req.slot?.name, 'element', preset, note) };
    case 'sample':
      return { prompt: buildPresetSamplePrompt(preset) };
    default:
      throw new Error(`unknown storyboard kind: ${req.kind}`);
  }
}
