// Camera Angles — read ONE reference still, propose N genuinely-distinct camera
// angles (one per shot, grounded in the actual scene), and hand each angle to
// the existing Frames engine as a verbatim make prompt.
//
// TWO things live here and nowhere else (house law: one module owns the spec):
//   1. ANGLE_PROMPT_TEMPLATE — the EXACT frames-engine prompt. The ONLY runtime
//      substitution is the [CAMERA ANGLE] token. Nothing else is ever reworded.
//   2. proposeAngles() — the TASK-named ('camera-angles') vision call that reads
//      the reference image and returns the distinct [CAMERA ANGLE] strings.

import { llmForTask } from './models/registry';
import { shotSizePrompt, anglePrompt as angleVocabPrompt } from './storyboardCamera';

/**
 * The make prompt sent to the frames engine. Same subject, same place — only the
 * camera position changes. Because the camera has PHYSICALLY moved, the framing
 * and the visible background must change with it (a real camera move, not a
 * paper-doll rotate-in-place on the same backdrop). Eyeline stays locked in world
 * space so the subject reads off-lens from the new position.
 * The one and only runtime substitution is the [CAMERA ANGLE] token.
 */
export const ANGLE_PROMPT_TEMPLATE = `Use the reference image as the source. Keep the subject — their body, pose, hands, expression, wardrobe, and eyeline — exactly as in the original, and keep the same physical location and everything in it. Change only the camera position.

Replace the original camera with [CAMERA ANGLE]. This is a genuinely new viewpoint of the SAME place, seen from a new physical camera position — not a variation of the original framing and never a return to it. Because the camera has physically moved to a new position in the space, the visible framing and the background MUST change with it: show the parts of this same location that the new camera position would actually see — the walls, floor, sky, and space behind, beside, and around the subject — inventing them plausibly and keeping them physically continuous with the place. Do NOT keep the original background and simply rotate or turn the subject to a new side; the subject stays fixed where they are in the space, and the camera moves around them, so a different part of the environment is now behind them.

This camera is purely observational — the subject is unaware of it and does not look at or acknowledge it. Preserve the original eyeline: the subject keeps looking at the same real point they looked at in the reference, so from this new position they appear off-lens — in profile, three-quarter, or from behind — never turned toward this new camera.

Maintain realistic perspective, lens behaviour, parallax, and depth consistent with the new camera placement. Only the camera position changes; the location, the subject, and the subject's gaze do not.`;

/** The ONLY runtime substitution — swap the [CAMERA ANGLE] token, nothing else. */
export function buildAnglePrompt(angle: string): string {
  return ANGLE_PROMPT_TEMPLATE.replace('[CAMERA ANGLE]', angle.trim());
}

/**
 * FROM FILM SPACE — the two-reference make prompt. The geometry anchor is the
 * Film Space Angle Pack's rendered frame (plate.png): a featureless grey clay
 * blocking figure at the pack's exact camera position. gpt-image-2 refuses a
 * hallucinated rear or overhead view, but HANDED that grey blocking frame as a
 * visual anchor it can reproduce the geometry. No [CAMERA ANGLE] token here — the
 * geometry lives in the frame image, so there is nothing to substitute.
 *
 * The engine receives references composition-first, in array order, so the caller
 * passes the Film Space frame first and the SOURCE second — exactly two, nothing
 * else:
 *   Image 1 = the Film Space frame / plate — CAMERA GEOMETRY ONLY (position /
 *             angle / height / distance / framing). NOT the subject's pose.
 *   Image 2 = the real source scene — the subject AND their exact performance
 *             (identity, wardrobe, pose, hands, mouth, expression, gaze) + location
 * INTENTIONALLY not run through the front-hemisphere guard — a behind/overhead
 * viewpoint is the entire point.
 *
 * POSE LAW (Anwar): a camera angle is a hidden second camera catching the SAME
 * frozen instant from a new viewpoint — the actor's performance never changes.
 * The grey figure's own pose is generic and must be IGNORED; the subject's full
 * pose/performance is taken from the source (Image 2) and preserved exactly.
 */
export const PACK_ANGLE_PROMPT = `You are given TWO reference images with DIFFERENT jobs. Image 1 is a grey, untextured 3D blocking figure — it IS THE CAMERA: it shows the exact viewpoint, angle, height, distance and frame/crop the output must be shot from. Image 2 is a photograph of the real subject taken from a COMPLETELY DIFFERENT camera — use it ONLY for who the subject is and what they are doing, NEVER for where the camera is.

CAMERA — defined ONLY by Image 1 (this is the whole point; obey it above all else): reproduce Image 1's exact viewpoint, angle, height, distance and CROP. If Image 1 is a tight close-up from below, the output is a tight close-up from below; if it looks from the side, from above, or from behind, so does the output; whatever falls outside Image 1's frame is out of frame. When Image 1 and your output are overlaid they must MATCH — same viewpoint, same angle, same distance, same shot size, same placement and scale of the figure, same crop, headroom and lead room. DISCARD Image 2's camera completely: do NOT copy the source photograph's framing, distance, shot size or viewpoint, and never fall back to it — the source was shot from a different place and its framing is irrelevant. Take nothing else from Image 1 either — not its colour, not its blank studio background, not its grey surfaces, and NOT the grey figure's pose, stance or gesture (that pose is generic scaffolding — ignore it entirely).

SUBJECT & PERFORMANCE — from Image 2, preserved EXACTLY: this is a hidden second camera catching the SAME frozen instant, so the person does not change. Keep the subject's identity, face and wardrobe, AND their complete pose and performance from Image 2 exactly: the attitude of the head, torso and every limb; BOTH hands and precisely what each is doing (raised, extended, reaching, holding); the arms; the gesture; the open or closed mouth; the facial expression; and the eyeline. If the mouth is open and one hand is raised and the other extended in Image 2, they stay open, raised and extended. Do NOT re-pose, relax, lower or drop the hands, close the mouth, neutralise the expression, straighten the stance, or substitute the grey figure's pose. The subject is frozen mid-action; only the camera has moved. Show that same subject and pose FROM IMAGE 1'S VIEWPOINT and cropped to Image 1's frame — if Image 1's shot is tight, parts of the body (an extended arm, the legs) simply fall outside the frame; do not widen the shot to fit them in. The real location, its materials, light and colour also come from Image 2.

This camera is purely observational — the subject is unaware of it. Preserve the world-space eyeline: they keep looking at the same real point they looked at in the source, so from this viewpoint they appear off-lens — in profile, three-quarter, or from behind — and never turn toward, face, or acknowledge the camera.

Render the parts of the source location this viewpoint would actually see — the walls, floor, sky and the space behind, beside and around the subject — inventing them plausibly from Image 2's world and keeping them physically continuous with that same place. Maintain realistic perspective, parallax, lens behaviour and depth consistent with this camera placement.`;

/** Parse a pack readout ("CU · LA · 50mm" → shot / angle / lens codes). Tolerant
 *  of missing parts and the middot / hyphen separators the UI uses. */
function parseReadout(readout?: string): { shot?: string; angle?: string; lens?: string } {
  if (!readout) return {};
  const parts = readout.split(/[·|]/).map(s => s.trim()).filter(Boolean);
  return { shot: parts[0], angle: parts[1], lens: parts[2] };
}

/** The FROM-FILM-SPACE make prompt. The camera geometry is carried by the grey
 *  figure image (Image 1), but that grey plate is a WEAK signal against a rich
 *  photographic source — so when the pack's readout is known we ALSO state the
 *  chosen shot size + angle + lens in words, as a forceful reinforcement that the
 *  output must obey Image 1's camera, not the source photo's. House law: one
 *  module owns the spec, so the wording is built here and nowhere else. */
export function buildPackAnglePrompt(readout?: string): string {
  const { shot, angle, lens } = parseReadout(readout);
  const lines: string[] = [];
  const s = shotSizePrompt(shot);
  const a = angleVocabPrompt(angle);
  if (s) lines.push(`- ${s}`);
  if (a) lines.push(`- ${a}`);
  if (lens) lines.push(`- Lens: ${lens}.`);
  if (!lines.length) return PACK_ANGLE_PROMPT;
  return `${PACK_ANGLE_PROMPT}

CAMERA SPEC — this describes Image 1's camera, stated in words so it cannot be missed; it OVERRIDES any framing implied by the source photograph. Compose the output to EXACTLY this shot size, angle and distance:
${lines.join('\n')}`;
}

/** Cap enforced everywhere — the tool never makes more than six angles. */
export const MAX_ANGLES = 6;

const SYSTEM = `You are a master cinematographer and camera-blocking mind. You are given ONE still frame. Your job is to propose NEW camera POSITIONS from which the same moment could be re-shot — genuinely different physical places a camera could stand in this same space.

Describe ONLY the camera. Each angle is pure camera geometry: its position in the space, its height, its distance from the subject, which side it is on, its tilt, and its lens (wide / normal / long). Nothing else.

FRONT-HEMISPHERE LAW (the hard boundary on every angle you propose):
- Every camera position MUST sit in the FRONT HEMISPHERE — the half of the space the subject faces. Picture the axis running from the subject out through the original camera (the direction the subject is looking); every angle you give must stay within roughly ±90° of that axis, so the new camera always sees the FRONT of the subject.
- ALLOWED: lateral cameras hard left or hard right at the front (out to a full side / profile), a front three-quarter on either side, a close front camera, a wide front camera, and moderate high or low cameras that still see the front of the subject (a low camera in front tilted up, a moderately high camera in front tilted down).
- FORBIDDEN — never propose any of these: a camera behind the subject or behind the line of their shoulders, a rear or back-of-head view, an over-the-shoulder camera shooting from behind them, a reverse angle, or a steep directly-overhead / bird's-eye / straight-down camera that would crane the gaze upward. If a viewpoint would show the back of the head or the back of the body, it is out of bounds — do not return it.

Hard rules:
- Say only WHERE THE CAMERA IS. Do NOT describe the subject, their face, pose, or eyeline, and do NOT narrate the scenery, background, walls, reflections, or mood — the make step renders the scene. A clean position is all you give.
- The subject and their gaze stay fixed; the camera moves around them within the front hemisphere. Never propose an angle that only works if the subject turns to, faces, looks at, or acknowledges the camera. This is a hidden, observational camera.
- Each angle must be RADICALLY different from every other — a different real position across the front hemisphere (e.g. hard left side at eye level, a low camera in front tilted up, a full right profile, a moderately high front three-quarter, far back on a long lens, close and frontal). No near-duplicates.
- Together the set should read as ONE coherent space observed from several distinct front-hemisphere camera positions.

Form:
- Each angle is a short, concrete NOUN PHRASE that reads correctly after "Replace the original camera with ___". Examples: "a hard left-side camera at eye level, close to the subject", "a low camera near the floor a few steps in front, tilted up", "a moderately high front three-quarter camera on the right", "a far-back frontal camera on a long lens".
- One line each. No numbering, no camera brand names, no millimetre values, and no sentence about the subject or the scenery.

Return STRICT JSON only, no code fences, no prose:
{"angles": ["<angle 1>", "<angle 2>", ...]}`;

/** Language that would move the subject rather than just the camera — a
 *  candidate matching any of these is rejected (the subject is locked; only the
 *  camera moves). Kept deliberately broad on eye-contact / re-orientation verbs. */
const SUBJECT_FACING_RE = /\b(?:look(?:s|ing)?|gaz(?:e|es|ing)|star(?:e|es|ing)|glanc\w*|peer\w*)\s+(?:straight\s+|directly\s+|back\s+)?(?:at|into|toward|towards|to)\s+(?:the\s+)?(?:new\s+|second\s+)?(?:camera|lens|viewer|us|audience)\b|\bfac(?:e|es|ing)\s+(?:the\s+)?(?:new\s+|second\s+)?(?:camera|lens|viewer)\b|\b(?:turn|turns|turning|rotat\w+|orient\w*|pivot\w*|swivel\w*|angl\w*)\s+(?:their|his|her|the)?\s*(?:head|body|face|gaze|eyes|shoulders)?\s*(?:to|toward|towards|into|to face)\s+(?:the\s+)?(?:new\s+|second\s+)?(?:camera|lens|viewer)\b|\backnowledg\w*\s+(?:the\s+)?(?:new\s+|second\s+)?camera\b|\b(?:makes?\s+eye\s+contact|eye\s+contact)\b|\baddress(?:es|ing)?\s+(?:the\s+)?(?:camera|lens|viewer)\b|\b(?:looks?|looking)\s+(?:up|down|over|back)?\s*(?:at|into)\s+(?:the\s+)?(?:new\s+|second\s+)?(?:camera|lens)\b/i;

/** True if the angle string describes the SUBJECT changing (facing/eyeing the
 *  camera) rather than only the camera moving. Such candidates are dropped. */
export function anglePreservesSubject(angle: string): boolean {
  return !SUBJECT_FACING_RE.test(angle);
}

/** Wording that places the camera OUTSIDE the front hemisphere — behind /
 *  rear / back-of-head, over-the-shoulder-from-behind, reverse, or a steep
 *  directly-overhead / bird's-eye / straight-down crane. gpt-image-2 collapses
 *  these to a frontal re-render, so auto-proposals matching any of them are
 *  dropped and re-requested. Deliberately NOT applied to user-authored angles.
 *  Note: bare "back" is intentionally NOT matched — "far back on a long lens"
 *  is a valid front-hemisphere distance, not a rear position. */
const OUT_OF_HEMISPHERE_RE = /\bbehind\b|\brear\b|\bback\s*-?\s*of\s*-?\s*(?:the\s+|their\s+|his\s+|her\s+)?(?:subject|head|body|figure|person|neck|shoulders?)\b|\bfrom\s+(?:the\s+)?back\b|\bover[\s-]+(?:the\s+|their\s+|his\s+|her\s+|one\s+|a\s+)?shoulders?\b|\boverhead\b|\bstraight[\s-]+down\b|\bdirectly[\s-]+(?:above|overhead)\b|\bbird'?s?[\s-]?eye\b|\btop[\s-]?down\b|\bplan\s+view\b/i;

/** True if an AUTO-proposed angle sits in the front hemisphere (±90° of the
 *  subject's gaze axis) — i.e. it does NOT read as behind / rear / over-the-
 *  shoulder-from-behind / steep-overhead. Applied ONLY to the model's own
 *  proposals in proposeAngles; user-authored custom angles are never checked. */
export function angleIsFrontHemisphere(angle: string): boolean {
  return !OUT_OF_HEMISPHERE_RE.test(angle);
}

export interface ProposeResult {
  ok: boolean;
  angles?: string[];
  message?: string;
}

/**
 * Read the reference frame and return `need` distinct camera-angle strings,
 * each different from every entry in `avoid` (angles the user has already
 * locked in). Wired as the TASK-named 'camera-angles' call so the model is
 * resolved through the registry, never hardcoded.
 */
export async function proposeAngles(
  refPath: string,
  need: number,
  avoid: string[] = [],
): Promise<ProposeResult> {
  const target = Math.max(1, Math.min(MAX_ANGLES, Math.round(need)));

  // One request → parsed angle strings (subject-lock enforced by the caller).
  const requestBatch = async (count: number, avoidList: string[]): Promise<{ ok: boolean; angles: string[]; message?: string }> => {
    const avoidBlock = avoidList.length
      ? `\n\nThe following angles are already chosen — your proposals must be DIFFERENT from every one of them (a different camera viewpoint, not a rewording):\n${avoidList.map(a => `- ${a}`).join('\n')}`
      : '';
    const prompt = `Propose exactly ${count} distinct camera angle${count === 1 ? '' : 's'} for re-shooting the performance in this frame. Read the frame, then choose ${count} camera viewpoint${count === 1 ? '' : 's'} that are as different from each other as the scene allows — WITHOUT changing the subject's face, eyeline, or orientation. The subject is locked; only the camera moves.${avoidBlock}`;
    const res = await llmForTask('camera-angles', { system: SYSTEM, promptId: 'camera-angles', prompt, imagePaths: [refPath], maxTokens: 900 });
    if (!res.ok || !res.text) return { ok: false, angles: [], message: res.message || 'The scene read did not return.' };
    try {
      const m = res.text.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : JSON.parse(res.text);
      const rawArr = Array.isArray(parsed?.angles) ? parsed.angles : Array.isArray(parsed) ? parsed : [];
      const angles = rawArr.map((a: unknown) => String(a || '').trim()).filter((a: string) => a.length > 0);
      return { ok: true, angles };
    } catch {
      return { ok: false, angles: [], message: 'Could not read the proposed angles.' };
    }
  };

  // Collect angles that keep the subject locked AND sit in the front hemisphere.
  // A candidate is DROPPED (never rewritten into the make) if its language would
  // turn/face the subject toward the new camera, OR if it places the camera
  // behind / rear / over-the-shoulder-from-behind / steep-overhead. Dropping
  // leaves us short → ask again for the shortfall so the count still fills with
  // valid front-hemisphere angles.
  const kept: string[] = [];
  let lastMsg: string | undefined;
  for (let attempt = 0; attempt < 3 && kept.length < target; attempt++) {
    const shortfall = target - kept.length;
    const r = await requestBatch(shortfall, [...avoid, ...kept]);
    if (!r.ok) { lastMsg = r.message; break; }
    for (const a of r.angles) {
      if (kept.length >= target) break;
      if (anglePreservesSubject(a) && angleIsFrontHemisphere(a)) kept.push(a);
    }
  }

  if (!kept.length) return { ok: false, message: lastMsg || 'The scene read returned no usable angles.' };
  return { ok: true, angles: kept.slice(0, target) };
}
