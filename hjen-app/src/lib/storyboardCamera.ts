// Shot-size + angle vocabulary. The `code` is what the user picks and what we
// store; the `prompt` is a forceful framing instruction so the choice actually
// drives the rendered panel (not just a label).

export interface CamOption { code: string; label: string; prompt: string; arrow?: string }

export const SHOT_SIZES: CamOption[] = [
  { code: 'ECU', label: 'ECU · extreme close-up', prompt: 'EXTREME CLOSE-UP: the frame is filled by a single detail (eyes, mouth, hands, or one object); the face is cropped top and bottom; no headroom; maximum intimacy' },
  { code: 'CU',  label: 'CU · close-up',          prompt: 'CLOSE-UP: head and the very top of the shoulders fill the frame; the expression dominates; background heavily out of focus' },
  { code: 'MCU', label: 'MCU · medium close-up',  prompt: 'MEDIUM CLOSE-UP: framed from mid-chest up; head-and-shoulders, expression clearly readable, a little of the setting visible' },
  { code: 'MS',  label: 'MS · medium shot',       prompt: 'MEDIUM SHOT: framed from the waist up; gesture, hands and posture visible with the setting around the subject' },
  { code: 'MLS', label: 'MLS · medium long / cowboy', prompt: 'MEDIUM LONG (COWBOY) SHOT: framed from mid-thigh up; full body language reads, the figure shares the frame with the environment' },
  { code: 'LS',  label: 'LS · long / wide',       prompt: 'LONG SHOT: the full figure head-to-toe stands within the environment; person and place balanced' },
  { code: 'WS',  label: 'WS · wide shot',         prompt: 'WIDE SHOT: the figure is small within a broad view of the location; the environment dominates the frame' },
  { code: 'EWS', label: 'EWS · extreme wide / establishing', prompt: 'EXTREME WIDE / ESTABLISHING SHOT: a vast view of the location; any figure is tiny; the place itself is the subject' },
  { code: '2S',  label: '2S · two-shot',          prompt: 'TWO-SHOT: two people framed together so the relationship and space between them reads clearly' },
  { code: 'OTS', label: 'OTS · over-the-shoulder', prompt: 'OVER-THE-SHOULDER: framed from behind the near person\'s shoulder (shoulder + back of head soft in the foreground) onto the far subject in focus' },
  { code: 'POV', label: 'POV · point of view',    prompt: 'POINT-OF-VIEW: the camera IS the character\'s eyes — we see exactly what they see, no part of them in frame' },
  { code: 'INS', label: 'INS · insert / cutaway', prompt: 'INSERT / CUTAWAY: a tight isolated detail of an object or action (a hand, a phone, a key) — no face needed' },
];

export const ANGLES: CamOption[] = [
  { code: 'EL',  label: 'EL · eye-level',         prompt: 'EYE-LEVEL: camera at the subject\'s eye height, neutral and even' },
  { code: 'HA',  label: 'HA · high angle',        prompt: 'HIGH ANGLE: the camera looks DOWN on the subject from above, making them feel smaller or vulnerable' },
  { code: 'LA',  label: 'LA · low angle',         prompt: 'LOW ANGLE: the camera looks UP at the subject from below, making them feel tall, dominant or heroic' },
  { code: 'OH',  label: 'OH · overhead / top-down', prompt: 'OVERHEAD / TOP-DOWN (god\'s-eye): the camera is directly above looking straight down on the scene' },
  { code: 'WE',  label: 'WE · worm\'s-eye',       prompt: 'WORM\'S-EYE: extreme low angle, camera near the ground looking sharply upward' },
  { code: 'DUT', label: 'DUT · dutch / canted',   prompt: 'DUTCH / CANTED ANGLE: the horizon is deliberately tilted, the whole frame off-kilter for tension or unease' },
];

// Camera MOVES — the `code` keeps the storyboard glyph so the panel's arrows
// still render; the `prompt` tells the model how to bias the (still) frame.
export const MOVES: CamOption[] = [
  { code: '▣ static',        label: '▣ Static / locked',     prompt: 'STATIC, locked-off camera — a perfectly still, composed frame, no motion', arrow: 'NO movement arrows (the camera is locked).' },
  { code: '← pan left',      label: '← Pan left',            prompt: 'PAN LEFT — the camera pivots horizontally to the left; compose with lead room on the left', arrow: 'one bold straight arrow OUTSIDE the top edge pointing LEFT (←), labelled "PAN".' },
  { code: '→ pan right',     label: '→ Pan right',           prompt: 'PAN RIGHT — the camera pivots horizontally to the right; lead room on the right', arrow: 'one bold straight arrow OUTSIDE the top edge pointing RIGHT (→), labelled "PAN".' },
  { code: '↑ tilt up',       label: '↑ Tilt up',             prompt: 'TILT UP — the camera pivots vertically upward; emphasis rising through the frame', arrow: 'one bold straight arrow OUTSIDE the right edge pointing UP (↑), labelled "TILT".' },
  { code: '↓ tilt down',     label: '↓ Tilt down',           prompt: 'TILT DOWN — the camera pivots vertically downward; emphasis settling lower', arrow: 'one bold straight arrow OUTSIDE the right edge pointing DOWN (↓), labelled "TILT".' },
  { code: '⊙→ push in',      label: '⊙→ Push in (dolly-in)', prompt: 'SLOW PUSH-IN — the camera moves toward the subject; compose tighter, drawing the viewer in', arrow: 'four short arrows just OUTSIDE the four corners all pointing INWARD toward the centre, labelled "PUSH IN".' },
  { code: '⊙← pull out',     label: '⊙← Pull out (dolly-out)', prompt: 'PULL-OUT — the camera moves away; compose slightly wider, subject receding into context', arrow: 'four short arrows at the centre pointing OUTWARD to the four corners, labelled "PULL OUT".' },
  { code: '⇠ track left',    label: '⇠ Track / dolly left',  prompt: 'TRACKING LEFT — the whole camera slides left alongside the subject; sideways momentum', arrow: 'a long horizontal arrow OUTSIDE the bottom edge pointing LEFT (←), labelled "DOLLY".' },
  { code: '⇢ track right',   label: '⇢ Track / dolly right', prompt: 'TRACKING RIGHT — the whole camera slides right; sideways momentum', arrow: 'a long horizontal arrow OUTSIDE the bottom edge pointing RIGHT (→), labelled "DOLLY".' },
  { code: '⇡ crane up',      label: '⇡ Crane / boom up',     prompt: 'CRANE UP — the camera rises on a boom, lifting above the subject', arrow: 'a tall vertical arrow OUTSIDE the left edge pointing UP, labelled "CRANE".' },
  { code: '⇣ crane down',    label: '⇣ Crane / boom down',   prompt: 'CRANE DOWN — the camera descends on a boom toward the subject', arrow: 'a tall vertical arrow OUTSIDE the left edge pointing DOWN, labelled "CRANE".' },
  { code: '⟲ arc left',      label: '⟲ Arc left (CCW)',      prompt: 'ARC LEFT — the camera curves counter-clockwise around the subject', arrow: 'a CURVED arrow wrapping around the bottom of the frame, arrowhead pointing LEFT, labelled "ARC".' },
  { code: '⟳ arc right',     label: '⟳ Arc right (CW)',      prompt: 'ARC RIGHT — the camera curves clockwise around the subject', arrow: 'a CURVED arrow wrapping around the bottom of the frame, arrowhead pointing RIGHT, labelled "ARC".' },
  { code: 'Z+ zoom in',      label: 'Z+ Zoom in',            prompt: 'ZOOM IN — the lens zooms tighter; flattened perspective on the subject', arrow: 'a small rectangle drawn inside near the centre with inward arrows at its corners, labelled "ZOOM IN".' },
  { code: 'Z− zoom out',     label: 'Z− Zoom out',           prompt: 'ZOOM OUT — the lens zooms wider, revealing surroundings', arrow: 'outward arrows from the centre toward the corners, labelled "ZOOM OUT".' },
  { code: 'RF→ rack focus',  label: 'RF→ Rack focus',        prompt: 'RACK FOCUS — focus shifts between planes; one plane sharp, the other soft', arrow: 'a small double-headed arrow between a foreground mark and a background mark, labelled "RACK FOCUS" (no camera-move arrows).' },
  { code: '∞ handheld',      label: '∞ Handheld',            prompt: 'HANDHELD — loose, slightly unstable, energetic documentary framing', arrow: 'a small wavy/jitter mark in a corner labelled "HANDHELD" (no directional arrow).' },
  { code: 'STDCM steadicam', label: 'STDCM Steadicam',       prompt: 'STEADICAM — a smooth floating following move', arrow: 'a smooth horizontal arrow OUTSIDE the bottom edge labelled "STEADICAM".' },
  { code: 'WP whip pan',     label: 'WP Whip pan',           prompt: 'WHIP PAN — a very fast pan with directional motion-blur streaks', arrow: 'a long bold arrow across the top edge with speed-lines/streaks, labelled "WHIP".' },
  { code: 'SNAP snap-zoom',  label: 'SNAP Snap-zoom',        prompt: 'SNAP ZOOM — a sudden fast punch-in to a tighter framing', arrow: 'bold inward arrows at the corners with speed-lines, labelled "SNAP ZOOM".' },
];

// LENSES — the `prompt` carries the optical character that actually changes the look.
export const LENSES: CamOption[] = [
  { code: '8mm fisheye',      label: '8mm — fisheye ultra-wide', prompt: '8mm FISHEYE ULTRA-WIDE: extreme barrel distortion, strongly curved horizon, bulging near-180° field, everything in deep focus' },
  { code: '14mm ultra-wide',  label: '14mm — ultra-wide',      prompt: '14mm ULTRA-WIDE: expansive sweeping view, strong perspective, slight edge distortion, very deep focus' },
  { code: '24mm wide',        label: '24mm — wide',            prompt: '24mm WIDE: broad context, mild perspective exaggeration, deep depth of field' },
  { code: '35mm',             label: '35mm — moderate wide',   prompt: '35mm: natural reportage feel, balanced perspective, moderate depth' },
  { code: '50mm normal',      label: '50mm — normal',          prompt: '50mm NORMAL: human-eye perspective, neutral, no distortion' },
  { code: '85mm portrait',    label: '85mm — portrait',        prompt: '85mm SHORT TELEPHOTO: flattering compression, shallow depth of field, soft melting background' },
  { code: '100mm',            label: '100mm — telephoto',      prompt: '100mm TELEPHOTO: clear compression, shallow focus, background pushed out' },
  { code: '135mm tele',       label: '135mm — long telephoto', prompt: '135mm LONG TELEPHOTO: strong compression, very shallow focus, background collapsed and creamy' },
  { code: '200mm long',       label: '200mm — very long',      prompt: '200mm VERY LONG: extreme compression, subject isolated, background flattened to a wash' },
  { code: 'anamorphic',       label: 'Anamorphic',             prompt: 'ANAMORPHIC: wide 2.39 cinematic feel, oval bokeh, subtle horizontal flares, gentle edge stretch' },
  { code: 'macro',            label: 'Macro',                  prompt: 'MACRO: extreme close focus on a tiny detail, razor-thin depth of field' },
  { code: 'fisheye',          label: 'Fisheye',                prompt: 'FISHEYE: extreme barrel distortion, strongly curved horizon, bulging perspective' },
];

function normalize(code?: string): string {
  if (!code) return '';
  return code.split('(')[0].trim().toUpperCase();
}

export function movePrompt(code?: string): string | undefined {
  const c = (code ?? '').trim().toLowerCase();
  return MOVES.find(m => m.code.toLowerCase() === c)?.prompt;
}

/** Explicit arrow-drawing instruction for the panel, from the chosen move. */
export function moveArrow(code?: string): string | undefined {
  const c = (code ?? '').trim().toLowerCase();
  return MOVES.find(m => m.code.toLowerCase() === c)?.arrow;
}

export function lensPrompt(code?: string): string | undefined {
  const c = (code ?? '').trim().toLowerCase();
  return LENSES.find(l => l.code.toLowerCase() === c)?.prompt;
}

export function shotSizePrompt(code?: string): string | undefined {
  const c = normalize(code);
  return SHOT_SIZES.find(s => s.code === c)?.prompt;
}

export function anglePrompt(code?: string): string | undefined {
  const c = normalize(code);
  return ANGLES.find(a => a.code === c)?.prompt;
}
