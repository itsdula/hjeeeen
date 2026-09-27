// swap.ts — MAIN-side Swap engine. THE recipe, server-side.
//
// House law (recipe stays server-side): every sentence the model reads lives
// HERE, in the Electron MAIN process. The renderer sends slots and decisions and
// gets back a finished prompt it treats as an opaque string — it never sees the
// change contract, the preserve grammar, or the acceptance tests.
// `grep -rE 'SWAP_(SLOTS_SYS|CONSEQUENCE_SYS|VERIFY_SYS|PLAN_SYS|TEMPLATE)' app/src/`
// must return nothing. This is stronger than Camera Angles, which still ships
// ANGLE_PROMPT_TEMPLATE from the renderer bundle, and it is deliberate: the
// PRESERVE/CHANGE contract is the crown jewel of this tool.
//
// WHAT THIS IS. The Eye reads one frame into 18 fields (app/electron/eye.ts).
// Nothing anywhere turned those fields back into a make prompt — the reverse
// existed only at ad altitude. The Swap is that reverse at frame altitude, on
// two theses:
//
//   1. THE EYE READ IS THE PRESERVATION CONTRACT. A change is one field
//      replaced; everything untouched is already correct in the source
//      photograph and does not need to be described back to the model.
//   2. THE PRODUCT IS THE ENFORCEMENT, NOT THE PROMPT. Each change is a numbered
//      requirement stated twice — once as direction, once as an acceptance test
//      in the model's own checking voice — then read back off the result and
//      re-driven when it did not land.
//
// FOUR PASSES LIVE HERE:
//   SWAP_SLOTS_SYS       vision · splits the person the Eye fused, reads wardrobe
//   SWAP_PLAN_SYS        text   · writes the acceptance tests + finds conflicts
//   SWAP_CONSEQUENCE_SYS text   · what a change drags with it
//   SWAP_VERIFY_SYS      vision · did each requirement land, judged on the take alone
//
// ── PORTED TO THE SERVER ────────────────────────────────────────────────────
// This file is app/electron/swap.ts transpiled and re-seamed, NOT rewritten:
// every prompt, every validation and the whole buildSwapPrompt law are byte-for
// byte the desktop's. Only four things changed, and all four are about WHERE
// things live rather than what they say:
//   · runLlmJson / taskModelOverride arrive from src/llm/run.js + the account's
//     models document instead of an injected Electron ctx;
//   · images are cloud tokens, so the `sips`/nativeImage transcode is gone —
//     src/llm/run.js resolves and converts them;
//   · swap_golden.jsonl is an append-only account document;
//   · registerSwap's ipcMain handlers are plain exports the HTTP routes call.
// If swap.ts changes, re-run the port. Recipe parity is asserted in
// src/swap/engine.test.mjs.
import { cloud } from '../cloudstore.js';
import { runLlmJson as serverLlm, readVisionImage } from '../llm/run.js';

/** The injected-ctx shape the engine was written against, bound to one account. */
function ctxFor(inv) {
  return {
    runLlmJson: (a) => serverLlm(inv, a),
    swapRoot: () => inv.id,
    taskModelOverride: (task) => {
      try {
        const j = cloud.readAcctDoc(inv.id, 'models', null);
        const m = j?.tasks?.[task];
        return typeof m === 'string' && m ? m : null;
      } catch { return null; }
    },
  };
}
/** Can this cloud token be read as an image at all — the web's existsSync. */
async function readable(acc, token) {
  if (!token) return false;
  return !!(await readVisionImage(acc, token));
}
// Floors only — the renderer resolves the real model through the registry and
// passes it down. These are what runs when no override and no resolution reached
// us, and they must match TASKS[...].defaultModel in src/lib/models/registry.ts.
const DEFAULT_VISION_MODEL = 'gemini-3.6-flash'; // same eye that read the frame
const DEFAULT_TEXT_MODEL = 'claude-sonnet-4-6';
function providerFor(model) {
    if (model.startsWith('claude'))
        return 'anthropic';
    if (model.startsWith('gemini'))
        return 'google';
    return 'openai';
}
/** Frameset saves stills as AVIF, which the OpenAI vision API rejects. Same
 *  helper as eye.ts and contextAgents.ts — duplicated rather than shared because
 *  these engines must stay independently registerable. */
// The desktop converted AVIF/HEIC with nativeImage/sips before sending. On the
// server that happens inside readVisionImage(), so the token passes through.
function vlmReadablePath(filePath) { return filePath; }
// ═══════════════════════════ PASS 1 · THE SLOT READ ═══════════════════════════
// Runs on the same image PLUS the finished EyeRead. It re-reads only what the
// Eye fuses or never looked at; everything else is copied straight through,
// because re-reading a solved axis is how two passes drift apart.
const SWAP_SLOTS_SYS = `You are the same working commercial stills photographer who already read this frame — but now you are the one who has to RE-SHOOT it tomorrow with exactly one thing changed. A read that fuses the person into a single sentence is useless for that: you cannot recast the actor while holding his gaze when his identity and his gaze live in the same string.

You are given the frame and the read that was already made of it. Your ONLY job is to split the person apart, and to write down the wardrobe, which that read never looked at. You do NOT re-read the light, the lens, the colour, the place, the hour, the medium, the action or the objects — those are already correct and are copied straight through. Do not contradict them.

Reply ONLY with a JSON object. No prose, no markdown fences.

{
  "identity": "WHO. Apparent age as a tight bracket read off the face, sex, build, height impression, skin, hair and facial hair, and any permanent feature (a scar, glasses that are part of the face). NOT a single garment. NOT how they stand. NOT where they look.",
  "wardrobe": "WHAT THEY WEAR, piece by piece, top to bottom: each garment named, its fabric, its colour, its fit, its condition, and how it sits on the body — a collar open two buttons, a hem stiff with dust, a sleeve pushed to the elbow. If a garment is out of frame, say it is out of frame; do NOT invent it.",
  "posture": "THE BODY. Where the weight sits, what the spine does, the attitude of the torso and the head, what each arm and leg is doing. NOT the hands. NOT the eyes.",
  "hands": "EACH HAND separately, and precisely what it is doing or holding — raised, extended, reaching, gripping, in a pocket, out of frame.",
  "gaze": "WHERE THE EYES GO IN THE ROOM — the real point they are aimed at, not the direction on screen: at the object in their hands, past the camera to someone off-frame left, down at the ground, into the lens. Then what the face is actually carrying in this instant. One line."
}

HOW TO SPLIT — the disciplines that make this usable instead of a re-caption:

IDENTITY holds ONLY what would still be true if the person changed clothes, changed pose and looked somewhere else. If you can take it off them, it is wardrobe. If they can relax it, it is posture. If it moves when the eyes move, it is gaze. Age is read off the FACE and stated as a tight bracket — a child is a child, a young teen is a young teen, an adult only if adult. Never age a young subject up. Do not infer a nationality, a country or a religion from a face: describe the face.

WARDROBE is the axis this frame has never been read on, so it is the one you are most likely to invent. Write only what you can SEE. On a tight close-up the honest answer is usually "only a collar is in frame — dark, matte, cotton-weight; nothing below the clavicle is visible". That is a correct answer. A confident head-to-toe outfit list from a close-up is a FAILURE, not a bonus.

POSTURE is what a stand-in could copy with their back turned. "Standing" is a refusal. "Weight on the back foot, shoulders square to the wall, chin dropped a few degrees" is a posture.

HANDS: both of them, named separately. "Hands at his side" is a read only if that is genuinely what both are doing. If one is out of frame, say so.

GAZE is written in WORLD SPACE, never in screen space, because the whole point is that it must survive when the person in front of it is replaced. "Looking left" is useless. "Aimed down into the open engine bay, roughly a metre in front of him" survives a recast. Then one clause of what the face carries — flat, held, about to speak, already elsewhere.

If there is no person in this frame, say so plainly in every person slot rather than inventing one.

Read what is ACTUALLY THERE. Where the frame does not show you a slot, say the slot is not visible. An honest gap is worth more than a confident invention, because the next step hands your words to a machine that renders them.`;
function slotsUser(read) {
    const r = read && typeof read === 'object' ? read : {};
    return `Here is the read already made of this frame. Split the person and read the wardrobe. Do not contradict any of it.

subject: ${String(r.subject ?? '')}
action: ${String(r.action ?? '')}
place: ${String(r.place ?? '')}
lens: ${[r?.lens?.size, r?.lens?.angle, r?.lens?.height, r?.lens?.focal].filter(Boolean).join(' · ')}
inside: ${String(r.inside ?? '')}`;
}
// ═══════════════════════════ PASS 2 · THE PLAN ═══════════════════════════
// One call, two jobs, because both are the same act of reading the changes AS A
// SET: write each requirement's acceptance test, and name any way two of them
// cannot co-exist in one photograph.
const SWAP_PLAN_SYS = `You are a photographer's first assistant reading a shot instruction before the shot is taken. Two jobs, both narrow.

JOB ONE — write the ACCEPTANCE TEST for each change.

A test is ONE question a person can answer yes or no by looking at the finished photograph ALONE, having never seen the original. That constraint is the whole point: a test that needs the original ("did the character change?") cannot be checked against a result, so it cannot be enforced, so the change was never really required at all.

  change: "a woman in her sixties, silver hair"
  test:   "Is the person in this frame a woman in her sixties with silver hair?"

  change: "night, after the shops have closed"
  test:   "Is this frame at night, with the shops shut?"

  change: "he is pouring the tea, not holding the cup"
  test:   "Is the man pouring tea in this frame?"

Write the test in the plainest words that still pin the change down. Do not smuggle in anything the user did not ask for. Do not test two things in one question — if a change genuinely contains two, test the one that would be noticed first.

If a change is too vague to test — "make it better", "more cinematic", "nicer light" — do NOT invent a test for it. Put its id in "untestable" and say nothing more about it. A vague ask that quietly acquires a specific test is worse than a vague ask that gets flagged, because the machine will then enforce something the owner never said.

JOB TWO — name the CONFLICTS.

Read the changes together, against what the frame currently is. Say only where two of them cannot both be true in one photograph, or where a change contradicts something the frame is being told to keep. Be concrete and short: what fights what, in the frame's own terms. "The gaze is aimed down into an open engine bay, and the new place has no engine in it."

Most sets of changes have NO conflict. Returning an empty list is the common, correct answer — do not manufacture tension to look useful. Never comment on taste, and never suggest a change is a bad idea.

Return STRICT JSON only, no code fences:
{"tests": {"C1": "<question>", "C2": "<question>"}, "untestable": ["C3"], "conflicts": [{"between": ["C1","C2"], "message": "<one sentence>"}]}`;
// ═══════════════════════════ PASS 3 · THE CONSEQUENCE ═══════════════════════════
const SWAP_CONSEQUENCE_SYS = `You are a cinematographer being asked one narrow question: something in this frame is being changed, and you must say what the change DRAGS with it — nothing more.

You are given the frame's slots as they are now, the slots the director is changing, and the list of slots that physically follow from those changes. For each followed slot, write what it BECOMES.

The discipline:

- Change only what the physics forces. If the hour goes to night, the light must become a night light — but it keeps its DIRECTION, its architecture and its relationship to the subject. A key coming hard from three-quarter back through a doorway at noon comes hard from three-quarter back through that same doorway at night, from whatever is switched on behind it. You are not relighting the frame. You are answering what the same lighting plan looks like at a different hour.
- Write in the SAME grammar as the slot you are replacing. If the light slot carries key, fill, accent, kelvin and state, return all five in that shape.
- Say the smallest true thing. A followed slot that would barely move should barely move, and you should say so.
- Never touch a slot you were not asked about. Never move the camera. Never restage the body. Never add a person or a prop.
- No mood words. "Atmospheric", "moody", "beautiful light" are refusals dressed as answers.

Return STRICT JSON only, no code fences:
{"follows": {"<slotKey>": "<what it becomes, in that slot's own grammar>"}}
Return exactly the slot keys you were asked for — no more, no fewer.`;
// ═══════════════════════════ PASS 4 · THE VERIFIER ═══════════════════════════
// Deliberately BLIND to the source. Handed the original as well, a verifier
// grades by comparison and goes soft — "it's different from before, so it
// landed". Given only the finished frame and a yes/no question, it has to answer
// from the pixels in front of it.
const SWAP_VERIFY_SYS = `You are checking one finished photograph against a short list of requirements. You have never seen what this frame looked like before, and you do not need to — every question below can be answered from this image alone.

For each requirement, answer with one of exactly three verdicts:

  landed  — the frame plainly satisfies it. You could point at the pixels that prove it.
  partial — the frame moved toward it but does not satisfy it. A face that is somewhat older but not the age asked for. A room that gained a few new details but is still the old room. Half is not yes.
  missed  — the frame does not satisfy it at all.

Then, in one line, say what you actually SEE that makes you say so. Not a restatement of the requirement — the evidence. "The man reads mid-thirties: unlined forehead, dark full beard, no grey." That line is what the owner reads when he disagrees with you, so it has to be about the picture.

Be strict. A verdict of "landed" on a frame that only half-changed is worse than no check at all, because it ends the work. When you are between two verdicts, choose the lower one. When a requirement asks for a specific person, a specific age or a specific place and the frame gives you something merely adjacent, that is partial, not landed.

Judge only what you were asked. Do not comment on quality, composition, lighting or taste. Do not infer a nationality, a country or a religion from a face.

Return STRICT JSON only, no code fences:
{"verdicts": [{"id": "C1", "state": "landed|partial|missed", "evidence": "<one line of what you see>"}]}
Return one entry for every requirement id you were given, in the same order.`;
// ═══════════════════════════ THE MAKE TEMPLATE ═══════════════════════════
// Register: ANGLE_PROMPT_TEMPLATE's directness, masterPrompt.ts's weight order
// (camera + action → subject + wardrobe → light → grade → world → refuse tail).
// Five blocks, built by the five builders below and by nothing else. No caller
// reaches past buildSwapPrompt() to reword any of it — the same discipline as
// ANGLE_PROMPT_TEMPLATE's single [CAMERA ANGLE] token, scaled to a contract
// whose number of clauses varies.
const SWAP_HEAD = `Image 1 is the source frame. What you are making is that SAME frame, re-photographed with the changes listed below and nothing else changed — the same camera in the same place, the same negative, the same evening. Everything you are not told to change is already correct in Image 1 and survives untouched.`;
const SWAP_MIDDLE = `Each change wins ONLY inside its own slot and nowhere else. Do not reframe to make one fit. Do not re-light to make one read better. Do not re-stage the body, re-time the hour, or tidy the room. If a change sits awkwardly inside this frame, it stays awkward — that is the frame.`;
const SWAP_TAIL = `Render photorealistically: real skin texture with visible pores and fine facial hair, natural micro-expression, no airbrushing, no plastic skin, no beauty-retouch finish, no stacked filters.

REFUSE: no people who are not already there, no props that are not already there, no added text or signage, no reframe, no re-crop, no change of aspect, and no stylisation the source does not already have.`;
/** One frozen sentence per slot. Exactly two runtime substitutions: [VALUE] (the
 *  user's own words) and [IMG] (the "Image N shows it" clause, or nothing). The
 *  user supplies a noun phrase; the user never supplies prose that could reword
 *  the contract. */
const CHANGE_LINE = {
    identity: `THE PERSON. The human being in this frame is replaced. The new person is [VALUE].[IMG] Everything else about the human in this frame is unchanged and comes from Image 1: they stand in the same spot, at the same distance from the camera, at the same size in the frame, holding the same body, doing the same thing with their hands, looking at the same real point in the room, wearing the same garments, lit by the same light. A different person, standing in the exact same instant.`,
    wardrobe: `THE WARDROBE. What this person is wearing is replaced. The new wardrobe is [VALUE].[IMG] The garments change; the person does not. Same face, same age, same build, same hair — this is the same human being on the same day, dressed differently. The new clothes must sit on THIS body in THIS pose: they drape, fold, catch the light and fall exactly the way real cloth would on the body already in Image 1, and they take their wear, their weather and their light from that same frame.`,
    place: `THE PLACE. The location is replaced. The new place is [VALUE].[IMG] The subject does not move: they hold the same position in the frame, the same size, the same distance from the lens, the same body, the same hands, the same gaze, the same wardrobe. The world behind, beside and around them becomes this new place — seen from the SAME camera, at the same height, the same angle and the same lens, so the new room recedes and the horizon sits exactly where it sits in Image 1. Build the parts of this new place that this camera would actually see, and keep them physically continuous with each other.`,
    action: `THE ACTION. The verb of this frame is replaced. What is now happening is [VALUE].[IMG] The same person, the same clothes, the same place, the same light, the same camera in the same position — caught at a different instant, doing a different thing. Their body, their hands and their gaze move only as much as this action physically requires, and no further; every part of them the new action does not touch stays exactly as it is in Image 1.`,
    posture: `THE BODY. How this person holds themselves is replaced. The new posture is [VALUE].[IMG] Same person, same clothes, same place, same light, same camera. Only the body moves — and it moves within the same frame, so if a limb now leaves the frame it simply leaves the frame; the shot is not widened to accommodate it.`,
    hands: `THE HANDS. What the hands are doing is replaced. They are now [VALUE].[IMG] Nothing else about the person moves — not the stance, not the weight, not the shoulders, not the head, not the eyes.`,
    gaze: `THE GAZE. Where this person is looking is replaced. They now look [VALUE].[IMG] The head and the eyes turn only as far as that requires; the body, the hands, the wardrobe and the light do not move at all.`,
    light: `THE LIGHT. The lighting of this frame is replaced. The new light is [VALUE].[IMG] The room, the subject, the wardrobe, the camera and the moment are untouched — this is the same frame with the lamps changed. Re-light every surface honestly: where the new key falls, where the shadow now goes, what the shadow side does, what now blows out and what now falls to black, and what the new colour temperature does to skin, to cloth and to the walls.`,
    colour: `THE GRADE. The colour behaviour of this frame is replaced. It now reads [VALUE].[IMG] Nothing in the world changes — not one object, not one garment, not the direction or hardness of the light. This is the same negative, graded differently.`,
    medium: `THE MEDIUM. The image itself is replaced: it is now [VALUE].[IMG] Same scene, same people, same light, same camera position, shot on a different stock in a different era of image-making. Change the grain structure, the halation, the tonal roll-off and the sharpness accordingly, and nothing else.`,
    time: `THE HOUR. The time of this frame is replaced. It is now [VALUE].[IMG] Same place, same person, same wardrobe, same camera. What the hour physically brings with it — the light, the sky, what is switched on, who else would be about — follows the consequence lines below and goes no further than them.`,
    objects: `WHAT IS IN THE FRAME. These objects are replaced: [VALUE].[IMG] Each new object sits exactly where the old one sat, at the same scale, at the same distance, catching the same light and casting its shadow the same way. Everything else in the room is untouched.`,
    // camera is unreachable: a camera change routes to Camera Angles, which owns
    // that geometry prompt. Left present and empty so a programmatic caller gets
    // nothing rather than a wrong sentence.
    camera: '',
};
/** What to say about a change's reference image, per slot. The default merely
 *  points at it. IDENTITY carries real instruction instead, because a face
 *  reference is the one attachment a model will over-read — handed a portrait it
 *  will take the sitter's clothes, their pose and their room along with their
 *  face unless told, in that same breath, not to.
 *
 *  This lives in the clause rather than in the change line because a change may
 *  have NO reference at all — the user can type "a woman in her sixties" and
 *  attach nothing. A line that promises "take it from that reference" when no
 *  reference shipped is an instruction pointing at nothing, and the model fills
 *  the gap by inventing what it must have said. */
const IMG_CLAUSE = {
    identity: n => ` Take their face, their build, their apparent age and their colouring from Image ${n}, and NOTHING else from it — not their clothes, not their pose, not where they are looking, not their surroundings, not the light on them.`,
};
const s = (v) => (typeof v === 'string' ? v.trim() : '');
/** The preserve lines, written from the slots. Only the at-risk neighbourhood is
 *  emitted — see preserveSet() in lib/swap/deps.ts for why writing all thirteen
 *  makes the model average instead of obey. */
const PRESERVE_LINE = {
    camera: f => `CAMERA — a ${s(f?.camera?.size)} shot, camera ${s(f?.camera?.angle)}, standing at ${s(f?.camera?.height)} height, ${s(f?.camera?.focal)} lens feel; ${s(f?.camera?.depth)}. The framing rectangle is identical to Image 1: same horizon height, same scale of the subject against the frame edges, same headroom, same lead room. Overlaid on Image 1, the geometry must match.`,
    action: f => `ACTION — ${s(f?.action)}. The same instant, frozen the same way.`,
    identity: f => `THE PERSON — ${s(f?.identity)}. The same human being: same face, same age, same build, same hair. Not a lookalike, not a relative.`,
    wardrobe: f => `WARDROBE — ${s(f?.wardrobe)}. The same garments, the same fabric, the same colour, the same fit, the same wear.`,
    posture: f => `BODY — ${s(f?.posture)}.`,
    hands: f => `HANDS — ${s(f?.hands)}.`,
    gaze: f => `GAZE — ${s(f?.gaze)}. The eyes go to the same real point in the room they go to in Image 1; if that reads off-lens, it stays off-lens, and they never turn toward the camera.`,
    light: f => `LIGHT — key: ${s(f?.light?.key)}. Fill: ${s(f?.light?.fill)}.${s(f?.light?.accent) ? ` Accent: ${s(f?.light?.accent)}.` : ''} ${s(f?.light?.kelvin)}. ${s(f?.light?.state)}. The light comes from the same place, is the same hardness, and falls on the subject the same way.`,
    colour: f => `COLOUR — ${s(f?.colour?.dominant)} against ${s(f?.colour?.second)}, ${s(f?.colour?.accent)} as the accent. ${s(f?.colour?.behaviour)}`,
    medium: f => `MEDIUM — ${s(f?.medium)}.`,
    time: f => `HOUR — ${s(f?.time)}.`,
    place: f => `PLACE — ${s(f?.place)}.`,
    objects: f => {
        const objs = Array.isArray(f?.objects) ? f.objects.filter(Boolean).join(' · ') : '';
        const truth = s(f?.culturalTruth);
        return `IN FRAME — ${objs}. The same things, in the same places, at the same scale.${truth ? ` Keep the detail that makes this real rather than staged: ${truth}` : ''}`;
    },
};
/** Did the read actually SEE this slot. A slot the split could not fill must
 *  contribute nothing — an empty bullet ("THE PERSON — . The same human being…")
 *  is not a harmless blank: it teaches the model, in the middle of a contract
 *  built on precision, that a blank is an acceptable answer. Checked here rather
 *  than by pattern-matching the finished line, because the hole can sit anywhere
 *  inside the sentence, not only at its end. */
function slotSeen(f, key) {
    switch (key) {
        case 'camera': return !!(s(f?.camera?.size) || s(f?.camera?.depth));
        case 'light': return !!(s(f?.light?.key) || s(f?.light?.fill));
        case 'colour': return !!(s(f?.colour?.behaviour) || s(f?.colour?.dominant));
        case 'objects': return Array.isArray(f?.objects) && f.objects.filter(Boolean).length > 0;
        default: return !!s(f?.[key]);
    }
}
const SLOT_TITLE = {
    camera: 'CAMERA', action: 'ACTION', identity: 'THE PERSON', wardrobe: 'WARDROBE',
    posture: 'BODY', hands: 'HANDS', gaze: 'GAZE', light: 'LIGHT', colour: 'COLOUR',
    medium: 'MEDIUM', time: 'HOUR', place: 'PLACE', objects: 'IN FRAME',
};
/** The structure block, written from WHICH PLATES ACTUALLY SHIPPED — never from
 *  the kit's name. A prompt that cites an Image 3 depth map that was not built
 *  is worse than no lock: the model obeys the reference it was told about by
 *  inventing what it must have contained. */
function lockBlock(n) {
    if (!n.canny && !n.depth)
        return '';
    if (n.canny && n.subjectOnly) {
        return `STRUCTURE — Image ${n.canny} is an edge stencil of the SUBJECT ONLY, cut out of Image 1; everything around them is deliberately blank. That silhouette is exact and must be matched — the outline of the head, the shoulders, the arms, the fall of the cloth. The blank area is NOT empty space in the output: it is where the new place is built, freely, from the words above. Take no colour, no texture and no subject from the stencil.`;
    }
    if (n.canny && n.depth) {
        return `STRUCTURE — Image ${n.canny} is an edge stencil of Image 1 and Image ${n.depth} is its depth map. Neither is content; together they are the frame's geometry. The stencil is the exact outline the output must land on — the subject's silhouette and the major lines of the architecture. The depth map is the exact distance of every surface from the lens. Match both. Take nothing else from either: no colour, no texture, no light, no subject.`;
    }
    if (n.canny) {
        return `STRUCTURE — Image ${n.canny} is an edge stencil of Image 1. It is not content; it is the frame's outline — the subject's silhouette and the major lines of the architecture — and the output must land on it exactly. Take nothing else from it: no colour, no texture, no light, no subject.`;
    }
    return `STRUCTURE — Image ${n.depth} is a depth map of Image 1. It is not content; it is the frame's three-dimensional layout. Read it as the exact distance of every surface from the lens — how far the subject stands from the camera, how much of the body faces which way, how the planes recede behind them — and land the output on that layout. Take nothing else from it: no colour, no texture, no light, no subject, no edges.`;
}
/** THE LAW. Every sentence the image model reads is assembled here and nowhere
 *  else. Deterministic — same inputs, same prompt, which is what makes the
 *  preserve-mode experiment on the bench meaningful. */
export function buildSwapPrompt(a) {
    const refs = Array.isArray(a.refs) ? a.refs : [];
    const idxOf = (role, slot) => {
        const i = refs.findIndex(r => r.role === role && (slot === undefined || r.slot === slot));
        return i < 0 ? undefined : i + 1;
    };
    const indicesForRequirement = (id, slot) => {
        const exact = refs.flatMap((ref, index) => ref.role === 'slot' && ref.requirementId === id ? [index + 1] : []);
        if (exact.length)
            return exact;
        // Compatibility with manifests saved before references carried requirement ids.
        return refs.flatMap((ref, index) => ref.role === 'slot' && ref.slot === slot ? [index + 1] : []);
    };
    const imageList = (indices) => indices.length === 1
        ? `Image ${indices[0]}`
        : `Images ${indices.slice(0, -1).join(', ')} and ${indices[indices.length - 1]}`;
    const reqs = [...(a.requirements ?? [])].sort((x, y) => x.priority - y.priority);
    // ── CHANGE ──────────────────────────────────────────────────────────────
    const changes = [];
    for (const r of reqs) {
        const line = CHANGE_LINE[r.slot];
        if (!line)
            continue;
        const indices = indicesForRequirement(r.id, r.slot);
        const images = indices.length ? imageList(indices) : '';
        const hasWords = !!s(r.value);
        const value = hasWords
            ? s(r.value)
            : (images ? `the one ${indices.length === 1 ? 'shown' : 'jointly shown'} in ${images}` : '');
        if (!value)
            continue;
        // A slot with its own clause always states it — that clause is instruction,
        // not a pointer. The default clause is only a pointer, so it is dropped when
        // the value already names the image.
        const custom = IMG_CLAUSE[r.slot];
        const img = !indices.length
            ? ''
            : custom
                ? indices.length === 1
                    ? custom(indices[0])
                    : ` ${images} are complementary references for the same new person. Take their face, build, apparent age and colouring jointly from those images, and NOTHING else from them — not their clothes, pose, gaze, surroundings or light.`
                : (hasWords ? ` ${images} ${indices.length === 1 ? 'shows' : 'jointly show'} it.` : '');
        changes.push(`CHANGE ${r.id} — ${line.replace('[VALUE]', value).replace('[IMG]', img)}`);
    }
    // ── PRESERVE ────────────────────────────────────────────────────────────
    const preserve = [];
    for (const k of a.preserveKeys ?? []) {
        const fn = PRESERVE_LINE[k];
        if (!fn || !slotSeen(a.slots, k))
            continue;
        preserve.push(`· ${fn(a.slots)}`);
    }
    // ── FOLLOW ──────────────────────────────────────────────────────────────
    const follows = [];
    for (const [key, d] of Object.entries(a.decisions ?? {})) {
        if (d?.state !== 'follow')
            continue;
        const value = s(d.proposed);
        if (!value)
            continue;
        const cause = SLOT_TITLE[d.becauseOf] ?? '';
        follows.push(`· ${SLOT_TITLE[key] ?? key.toUpperCase()} — ${cause ? `because the ${cause.toLowerCase()} changed, it ` : 'it '}becomes: ${value}`);
    }
    // ── LOCK ────────────────────────────────────────────────────────────────
    const lock = lockBlock({ canny: idxOf('canny'), depth: idxOf('depth'), subjectOnly: !!a.subjectOnlyCanny });
    // ── the face anchor, when one shipped ───────────────────────────────────
    const faceIdx = idxOf('face');
    const faceLine = faceIdx
        ? `IDENTITY ANCHOR — Image ${faceIdx} is the face already in Image 1, shown close. It is not a new person and nothing about it is being changed: it is there so that this exact face survives the edit. The output's face must be this face.`
        : '';
    // ── CONTRACT — the requirements again, in the model's own checking voice ─
    const tested = reqs.filter(r => s(r.test));
    // ── the re-ask ──────────────────────────────────────────────────────────
    // Sending the identical prompt a second time is not a retry, it is a coin
    // flip. When a round has already failed on named requirements, the next one
    // says so — and says it before the checking block, so the model reads it as
    // direction rather than as a complaint.
    const escalated = (a.escalate ?? []).filter(id => reqs.some(r => r.id === id));
    const escalateBlock = escalated.length
        ? `A previous attempt at this exact frame satisfied everything else and FAILED on ${escalated.join(' and ')}. That is what this frame exists to fix. ${escalated.length === 1 ? 'It' : 'They'} lead the list above and ${escalated.length === 1 ? 'is' : 'are'} not optional: make ${escalated.length === 1 ? 'it' : 'them'} unmistakable in the result, and do not let the rest of the frame soften ${escalated.length === 1 ? 'it' : 'them'} back toward the original.`
        : '';
    const contract = tested.length
        ? `THIS FRAME IS ONLY CORRECT IF ALL OF THESE ARE TRUE. Check each one against what you have made, before you finish:
${tested.map(r => `  ${r.id} — ${s(r.test)}`).join('\n')}
Every one of them is required. Satisfying two and averaging the third is a failed frame, not a partial one. If any is not true of what you have made, you have made the wrong frame.`
        : '';
    return [
        SWAP_HEAD,
        changes.join('\n\n'),
        preserve.length ? `PRESERVE — these are not suggestions, they are the frame. Each one is already correct in Image 1 and must come through the change untouched:\n${preserve.join('\n')}` : '',
        follows.length ? `CONSEQUENCE — these follow from the change and are the ONLY other things in this frame permitted to move. Move them exactly this far and no further:\n${follows.join('\n')}` : '',
        SWAP_MIDDLE,
        escalateBlock,
        lock,
        faceLine,
        contract,
        SWAP_TAIL,
    ].filter(Boolean).join('\n\n');
}
// ═══════════════════════════ parse + validate ═══════════════════════════
/** Answers that mean "I did not look." Same gate as eye.ts — a slot returning
 *  one of these is a FAILED read, not a partial one. */
const EVASIONS = /^(n\/?a|none|nothing|unknown|unclear|not applicable|not visible|-{1,3}|—)?$/i;
function sliceJson(text) {
    const t = (text || '').trim();
    const start = t.indexOf('{'), end = t.lastIndexOf('}');
    return JSON.parse(start >= 0 ? t.slice(start, end + 1) : t);
}
const PERSON_SLOTS = ['identity', 'wardrobe', 'posture', 'hands', 'gaze'];
/** Merge the person split onto the verbatim EyeRead fields, and report which
 *  slots came back empty or evasive. A thin slot may not be offered as a SWAP
 *  target — you cannot swap a wardrobe the read could not see. */
export function validateSlots(raw, read) {
    const thin = [];
    const o = raw && typeof raw === 'object' ? raw : {};
    const r = read && typeof read === 'object' ? read : {};
    const slots = {
        // VERBATIM — never re-read, because two passes reading the same axis is how
        // they drift apart and the composed prompt inherits a contradiction.
        camera: r.lens ?? {},
        action: s(r.action),
        light: r.light ?? {},
        colour: r.colour ?? {},
        medium: s(r.medium),
        time: s(r.time),
        place: s(r.place),
        objects: Array.isArray(r.objects) ? r.objects.map(s).filter(Boolean) : [],
        culturalTruth: s(r.culturalTruth),
        // the split + the new read
        identity: s(o.identity),
        wardrobe: s(o.wardrobe),
        posture: s(o.posture),
        hands: s(o.hands),
        gaze: s(o.gaze),
    };
    for (const k of PERSON_SLOTS) {
        if (!slots[k] || EVASIONS.test(slots[k]))
            thin.push(k);
    }
    // WARDROBE-FROM-A-CLOSE-UP GUARD. The Eye has never read wardrobe, so there is
    // no golden data and no calibration for it, and a close-up is where the model
    // will confidently describe trousers it cannot see. A long outfit list from a
    // tight frame is invention, and invention that looks like signal is the worst
    // kind — flag it rather than let a swap be built on it.
    const size = s(slots.camera?.size);
    if ((size === 'ecu' || size === 'cu') && slots.wardrobe.split(/\s+/).length > 18 && !thin.includes('wardrobe')) {
        thin.push('wardrobe');
    }
    return { slots, thin };
}
// ═══════════════════════════ the passes ═══════════════════════════
async function swapSlots(ctx, args) {
    const imagePath = String(args?.imagePath ?? '');
    if (!(await readable(ctx.swapRoot(), imagePath))) {
        return { ok: false, reason: 'no_image', message: 'No readable image at that path.' };
    }
    if (!args?.read || typeof args.read !== 'object') {
        return { ok: false, reason: 'no_read', message: 'The frame has to be read by the Eye before it can be split.' };
    }
    const model = String(args?.model || ctx.taskModelOverride('swap-slots') || DEFAULT_VISION_MODEL);
    const started = Date.now();
    const vlmPath = vlmReadablePath(imagePath);
    // One retry, same reasoning as eye.ts: malformed JSON here is intermittent,
    // not deterministic, and a second attempt turns a visible failure into a read.
    let lastErr = '';
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = await ctx.runLlmJson({
            provider: providerFor(model), model,
            system: SWAP_SLOTS_SYS, prompt: slotsUser(args.read),
            imagePaths: [vlmPath], maxTokens: 1600, jsonMode: true,
        });
        if (!res.ok)
            return { ok: false, reason: res.reason || 'llm_failed', message: res.message || 'The split did not return.', model };
        try {
            const { slots, thin } = validateSlots(sliceJson(res.text || ''), args.read);
            return { ok: true, slots, thin, model, ms: Date.now() - started, retried: attempt > 0 };
        }
        catch (e) {
            lastErr = String(e?.message || e).slice(0, 200);
        }
    }
    return { ok: false, reason: 'parse_failed', message: lastErr, model };
}
async function swapConsequence(ctx, args) {
    const decisions = args?.decisions ?? {};
    const following = Object.keys(decisions).filter(k => decisions[k]?.state === 'follow');
    // Nothing follows — do not spend a call to be told so.
    if (!following.length)
        return { ok: true, follows: {} };
    const model = String(args?.model || ctx.taskModelOverride('swap-consequence') || DEFAULT_TEXT_MODEL);
    const swapped = Object.keys(decisions)
        .filter(k => decisions[k]?.state === 'swap')
        .map(k => `- ${k}: ${s(decisions[k]?.value) || '(shown in a reference image)'}`);
    const f = args?.slots ?? {};
    const current = [
        `light: key ${s(f?.light?.key)} · fill ${s(f?.light?.fill)}${s(f?.light?.accent) ? ` · accent ${s(f?.light?.accent)}` : ''} · ${s(f?.light?.kelvin)} · ${s(f?.light?.state)}`,
        `colour: ${s(f?.colour?.dominant)} / ${s(f?.colour?.second)} / ${s(f?.colour?.accent)} — ${s(f?.colour?.behaviour)}`,
        `objects: ${(Array.isArray(f?.objects) ? f.objects : []).join(' · ')}`,
        `place: ${s(f?.place)}`, `time: ${s(f?.time)}`, `medium: ${s(f?.medium)}`,
        `posture: ${s(f?.posture)}`, `hands: ${s(f?.hands)}`, `gaze: ${s(f?.gaze)}`,
        `wardrobe: ${s(f?.wardrobe)}`, `action: ${s(f?.action)}`,
    ].join('\n');
    const res = await ctx.runLlmJson({
        provider: providerFor(model), model,
        system: SWAP_CONSEQUENCE_SYS,
        prompt: `The frame as it is now:\n${current}\n\nThe director is changing:\n${swapped.join('\n')}\n\nWrite what each of these slots becomes, and nothing else: ${following.join(', ')}`,
        maxTokens: 1200, jsonMode: true,
    });
    if (!res.ok)
        return { ok: false, message: res.message || 'The consequence pass did not return.', model };
    try {
        const parsed = sliceJson(res.text || '');
        const raw = parsed?.follows && typeof parsed.follows === 'object' ? parsed.follows : {};
        const follows = {};
        // Only the slots we asked about. A pass that volunteers a slot it was not
        // asked for is proposing a change the user never made.
        for (const k of following)
            if (s(raw[k]))
                follows[k] = s(raw[k]);
        return { ok: true, follows, model };
    }
    catch (e) {
        return { ok: false, message: String(e?.message || e).slice(0, 200), model };
    }
}
async function swapPlan(ctx, args) {
    const reqs = Array.isArray(args?.requirements) ? args.requirements : [];
    if (!reqs.length)
        return { ok: true, tests: {}, untestable: [], conflicts: [] };
    const model = String(args?.model || ctx.taskModelOverride('swap-consequence') || DEFAULT_TEXT_MODEL);
    const f = args?.slots ?? {};
    const lines = reqs.map(r => `${r.id} — change the ${r.slot} to: ${s(r.value) || '(shown in a reference image, no words given)'}`);
    const res = await ctx.runLlmJson({
        provider: providerFor(model), model,
        system: SWAP_PLAN_SYS,
        prompt: `The frame as it is now — subject: ${s(f?.identity)}; wearing: ${s(f?.wardrobe)}; doing: ${s(f?.action)}; looking: ${s(f?.gaze)}; in: ${s(f?.place)}; at: ${s(f?.time)}.\n\nThe changes:\n${lines.join('\n')}`,
        maxTokens: 1200, jsonMode: true,
    });
    if (!res.ok)
        return { ok: false, message: res.message || 'The plan pass did not return.', model };
    try {
        const parsed = sliceJson(res.text || '');
        const tests = {};
        for (const r of reqs) {
            const t = s(parsed?.tests?.[r.id]);
            if (t)
                tests[r.id] = t;
        }
        const untestable = Array.isArray(parsed?.untestable) ? parsed.untestable.map(s).filter(Boolean) : [];
        const conflicts = Array.isArray(parsed?.conflicts)
            ? parsed.conflicts.map((c) => ({
                kind: 'physical',
                between: Array.isArray(c?.between) ? c.between.map(s).filter(Boolean) : [],
                message: s(c?.message),
            })).filter((c) => c.message)
            : [];
        return { ok: true, tests, untestable, conflicts, model };
    }
    catch (e) {
        return { ok: false, message: String(e?.message || e).slice(0, 200), model };
    }
}
/** Compose: write the tests if they are missing, then build the prompt.
 *  Re-drive rounds arrive with tests already written and skip the pass — the
 *  test must not drift between rounds, or the verdict trail stops meaning
 *  anything. */
async function swapCompose(ctx, args) {
    const reqs = Array.isArray(args?.requirements) ? args.requirements : [];
    let untestable = [];
    let conflicts = [];
    const needTests = reqs.some(r => !s(r.test));
    if (needTests) {
        const plan = await swapPlan(ctx, args);
        if (plan.ok) {
            for (const r of reqs)
                if (!s(r.test) && plan.tests[r.id])
                    r.test = plan.tests[r.id];
            untestable = plan.untestable ?? [];
            conflicts = plan.conflicts ?? [];
        }
        // A failed plan pass is NOT a failed compose. The frame can still be made;
        // it just cannot be automatically verified, and the UI says so rather than
        // blocking a make the owner asked for.
    }
    const prompt = buildSwapPrompt({
        slots: args?.slots, decisions: args?.decisions ?? {},
        requirements: reqs, refs: Array.isArray(args?.refs) ? args.refs : [],
        preserveKeys: Array.isArray(args?.preserveKeys) ? args.preserveKeys : [],
        escalate: Array.isArray(args?.escalate) ? args.escalate : [],
        round: Number(args?.round ?? 1),
        subjectOnlyCanny: !!args?.subjectOnlyCanny,
    });
    return { ok: true, prompt, requirements: reqs, untestable, conflicts };
}
async function swapVerify(ctx, args) {
    const takePath = String(args?.takePath ?? '');
    const reqs = Array.isArray(args?.requirements) ? args.requirements : [];
    if (!(await readable(ctx.swapRoot(), takePath))) {
        return { ok: false, message: 'No readable take at that path.' };
    }
    const testable = reqs.filter(r => s(r.test));
    if (!testable.length) {
        return { ok: false, message: 'Nothing to check — none of these changes has an acceptance test.' };
    }
    const model = String(args?.model || ctx.taskModelOverride('swap-verify') || DEFAULT_VISION_MODEL);
    const res = await ctx.runLlmJson({
        provider: providerFor(model), model,
        system: SWAP_VERIFY_SYS,
        prompt: `Check this photograph against these requirements:\n${testable.map(r => `${r.id} — ${s(r.test)}`).join('\n')}`,
        imagePaths: [vlmReadablePath(takePath)], maxTokens: 900, jsonMode: true,
    });
    if (!res.ok)
        return { ok: false, message: res.message || 'The check did not return.', model };
    try {
        const parsed = sliceJson(res.text || '');
        const raw = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
        const byId = new Map(raw.map((v) => [s(v?.id), v]));
        // A requirement the verifier skipped is NOT a pass. Silence is treated as
        // missed, because a dropped row read as success is how a broken change ships.
        const verdicts = testable.map(r => {
            const v = byId.get(r.id);
            const state = ['landed', 'partial', 'missed'].includes(s(v?.state)) ? s(v.state) : 'missed';
            return {
                id: r.id, state,
                evidence: s(v?.evidence) || 'The check returned nothing for this requirement, so it is counted as not landed.',
            };
        });
        return { ok: true, verdicts, model };
    }
    catch (e) {
        return { ok: false, message: String(e?.message || e).slice(0, 200), model };
    }
}
// ═══════════════════════════ the golden set ═══════════════════════════
// The mirror of eye_golden.jsonl. Two things are graded and the second matters
// more than it looks: whether each preserved slot held, AND whether the machine's
// own verdict agreed with Anwar's. A verifier that says "landed" on a 60% morph
// is worse than no verifier, and this file is where that gets caught.
const GOLDEN_KEY = 'swap-golden';
function swapGoldenWrite(acc, entry) {
    if (!entry || typeof entry !== 'object' || !entry.takePath) {
        return { ok: false, reason: 'bad_args', message: 'Nothing to sign.' };
    }
    let sourceHash = String(entry.sourceHash ?? '');
    const row = {
        ts: new Date().toISOString(),
        sourcePath: String(entry.sourcePath ?? ''),
        takePath: String(entry.takePath ?? ''),
        sourceHash,
        model: String(entry.model ?? ''),
        requirements: Array.isArray(entry.requirements) ? entry.requirements : [],
        machineVerdicts: Array.isArray(entry.machineVerdicts) ? entry.machineVerdicts : [],
        humanVerdicts: entry.humanVerdicts && typeof entry.humanVerdicts === 'object' ? entry.humanVerdicts : {},
        slotGrades: entry.slotGrades && typeof entry.slotGrades === 'object' ? entry.slotGrades : {},
        takeRead: entry.takeRead ?? null,
        rounds: Number(entry.rounds ?? 1),
        notes: entry.notes && typeof entry.notes === 'object' ? entry.notes : {},
        signedBy: String(entry.signedBy || 'anwar'),
    };
    try {
        const cur = cloud.readAcctDoc(acc, GOLDEN_KEY, null);
        const entries = (cur && Array.isArray(cur.entries)) ? cur.entries : [];
        entries.push(row);
        cloud.writeAcctDoc(acc, GOLDEN_KEY, { entries });
        return { ok: true };
    }
    catch (e) {
        return { ok: false, reason: 'write_failed', message: String(e?.message || e).slice(0, 200) };
    }
}
function swapStatus(acc) {
    let golden = 0, agreed = 0, judged = 0;
    try {
        const cur = cloud.readAcctDoc(acc, GOLDEN_KEY, null);
        for (const e of (cur?.entries ?? [])) {
            golden++;
            for (const v of e?.machineVerdicts ?? []) {
                const human = e?.humanVerdicts?.[v.id];
                if (!human)
                    continue;
                judged++;
                if (human === v.state)
                    agreed++;
            }
        }
    }
    catch { /* nothing signed yet — zero is the honest answer */ }
    return { ok: true, root: 'cloud://swap', golden, judged, agreed };
}
// ═══════════════════════════ the doors ═══════════════════════════
// registerSwap()'s ipcMain handlers, as plain functions. Same argument objects,
// same return shapes — the web adapter posts what the preload used to send.
export const swap = {
  slots:       (inv, args) => swapSlots(ctxFor(inv), args || {}),
  consequence: (inv, args) => swapConsequence(ctxFor(inv), args || {}),
  plan:        (inv, args) => swapPlan(ctxFor(inv), args || {}),
  compose:     (inv, args) => swapCompose(ctxFor(inv), args || {}),
  verify:      (inv, args) => swapVerify(ctxFor(inv), args || {}),
  goldenWrite: (inv, args) => swapGoldenWrite(inv.id, args?.entry),
  status:      (inv) => swapStatus(inv.id),
};
