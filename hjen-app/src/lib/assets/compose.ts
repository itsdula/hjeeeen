// ASSET RECIPES — how each plate is written.
//
// LAW: the recipe lives on the SERVER. This file is the OFFLINE mirror (the
// owner's own machine, no gateway configured) and must stay byte-compatible
// with server/src/assets/compose.js. Any edit here is mirrored there.
//
// Four factories, four output shapes. What they share is the ground, the flat
// light and the refusal to bake a decision into an asset that has to survive
// every later decision. What differs is everything else.
//
// Craft rules encoded below, and where each came from:
//
//  • Identity is CLOTHING-FREE by construction. The face plate is made with
//    bare shoulders and no garment at all, so wardrobe stays a separate,
//    composable asset. (Already proven in store.ts's breakdown entity builder.)
//  • The SHEET is made WITH the face attached. Without that single reference it
//    drifts to a different person — the most reliably reproducible failure in
//    this whole system.
//  • Multi-view goes on ONE canvas, not N renders. Simultaneous generation
//    holds identity better than sequential.
//  • Locations are built at a THREE-QUARTER angle so the model gets depth, and
//    carry an explicit foreground/midground/background plate list.
//  • Objects need a real contact shadow and visible taper. A flat render
//    animates like 2D card in any video model.
//  • Positive phrasing for the locks; hard exclusions go in NEGATIVE, last.

import type { Asset, PlateRole } from '../../types/assets';
import { groundClause, flatLightClause, contactShadowClause } from './plateGround';

/** What the factory asks the recipe for. Deliberately small: the client sends
 *  this, the server composes. No prompt text crosses the wire outbound. */
export interface AssetRecipeReq {
  kind: Asset['kind'];
  role: PlateRole;
  name: string;
  spec: Record<string, string>;
  negatives: string[];
  /** Wardrobe: which piece this plate is for. Prop: which detail insert. */
  part?: string;
  /** Wardrobe only. */
  photoType?: 'flat' | 'ghost' | 'on-body';
  /** Location only. */
  binding?: 'hard' | 'style';
  /** True when a client-supplied source reference is attached — the recipe
   *  then designs FROM it instead of inventing. */
  fromRef?: boolean;
  /** True when an identity plate (the face) is attached, for the sheet pass. */
  fromIdentity?: boolean;
  /** CHARACTER SHEET only — exact clothing refs kept distinct from the face
   * identity anchor so each reference has one clear job. */
  fromWardrobeRef?: boolean;
}

export interface AssetRecipe {
  prompt: string;
  /** Aspect this role wants. */
  aspect: string;
  /** A wholesome retry used only when the provider rejects the first pass on
   *  safety — same subject, nothing suggestive, nothing tight. */
  fallbackPrompt: string;
}

// ─── shared blocks ───────────────────────────────────────────────────────────

const REFERENCE_PLATE_FRAME =
  'This is a PRODUCTION REFERENCE PLATE for a film art department — not a finished frame, '
  + 'not an advertisement, not a portrait for publication. It exists to lock one thing so it '
  + 'stays identical across later shots.';

function fromRefLine(fromRef?: boolean): string {
  return fromRef
    ? 'Design this closely on the ATTACHED client reference — match its likeness and construction '
      + 'faithfully rather than inventing a new one.'
    : '';
}

function specLine(spec: Record<string, string>, keys: string[]): string {
  const parts = keys.map(k => spec[k]).filter(Boolean);
  return parts.join('. ');
}

function negativeBlock(negatives: string[], extra: string[]): string {
  const all = [...extra, ...negatives.filter(Boolean)];
  if (!all.length) return '';
  return `NEGATIVE — hard exclusion list, NOT subject matter. Do NOT render, include, or partially `
    + `depict: ${all.join('; ')}.`;
}

function join(...blocks: Array<string | false | undefined>): string {
  return blocks.filter(Boolean).join('\n\n');
}

// ─── CHARACTER ───────────────────────────────────────────────────────────────

function characterRecipe(r: AssetRecipeReq): AssetRecipe {
  const identity = specLine(r.spec, [
    'age', 'sex', 'heritage', 'faceShape', 'skinTone', 'skinDetail', 'facialHair',
    'noseShape', 'lipShape', 'jawline', 'eyebrows', 'eyeShape', 'eyeColor',
    'hairColor', 'hairLength', 'hairTexture', 'build', 'height', 'features',
  ]) || r.name;

  if (r.role === 'face') {
    return {
      aspect: '4:5',
      prompt: join(
        REFERENCE_PLATE_FRAME,
        r.fromRef
          ? `IDENTITY LOCK — the attached photographs show the exact person, "${r.name}". Reproduce `
            + `THIS SPECIFIC INDIVIDUAL, not a lookalike, reinterpretation, younger substitute or `
            + `generic person of the same heritage. Reference pixels outrank the text: preserve the `
            + `same facial geometry, skull and cheek volume, eye spacing and lids, nose, mouth, jaw, `
            + `age, asymmetry, skin character, hairline and facial hair across the clearest views.`
          : '',
        `IDENTITY PLATE for "${r.name}". A clean tight reference portrait: head, neck and only the `
        + `top of the shoulders. Crop below the neck so clothing cannot become the identity anchor. `
        + `Preserve identity-defining hair, facial hair and culturally specific headwear when it is `
        + `consistently present in the attached identity references.`,
        `Secondary identity notes (use only where the photographs do not resolve a detail): ${identity}.`,
        `The face is sharp and clearly readable, neutral composed expression, front-facing `
        + `(passport-style) or a clean three-quarter view. No props, no jewellery, no logos.`,
        flatLightClause(),
        groundClause(),
        negativeBlock(r.negatives, [
          'visible outfit below the neckline', 'jewellery',
          'a lookalike or generic replacement face', 'beautification that changes identity',
          'de-aging or age smoothing',
          'dramatic or coloured lighting', 'background gradient or environment',
          'text, watermark or logo', 'more than one person',
        ]),
      ),
      fallbackPrompt: join(
        `A simple, wholesome front-view character-design head study for "${r.name}" — a modest, `
        + `fully appropriate casting reference for a film art department. Neutral expression.`,
        flatLightClause(), groundClause(),
      ),
    };
  }

  if (r.role === 'sheet') {
    const body = specLine(r.spec, ['age', 'sex', 'build', 'height']) || 'adult, natural build and stature';
    const exactHeight = r.spec.heightCm
      ? `EXACT STANDING HEIGHT LOCK: ${r.spec.heightCm}. Keep this same real-world stature and limb `
        + `scale in all three views; do not visually shorten the figure to fit the canvas.`
      : `No exact height was supplied. Default to a natural average-to-tall adult standing stature, `
        + `7.5 to 8 head-lengths tall. Never infer short stature from age, body weight or wide clothing.`;
    const wardrobe = r.fromWardrobeRef
      ? `WARDROBE LOCK — the attached image(s) are clothing references ONLY. Reproduce the exact `
        + `garments, cut, layers, length, drape, fabric, colour, condition, footwear and worn `
        + `accessories in all three views. Do not copy the wardrobe model's face, head, pose, body `
        + `proportions or identity.`
      : `No wardrobe reference is attached. Use a plain MEDIUM NEUTRAL GREY technical study outfit `
        + `(simple fitted long-sleeve top and straight trousers), with no black garment, logo, pattern `
        + `or cultural styling. This is only a temporary body-reading layer.`;
    return {
      aspect: '16:9',
      prompt: join(
        REFERENCE_PLATE_FRAME,
        r.fromIdentity
          ? `IDENTITY LOCK — the attached face plate is the exact person, "${r.name}". Use it ONLY for `
            + `the THREE-QUARTER face: same facial geometry, age, skin, hairline, `
            + `facial hair and natural asymmetry. The wardrobe references never override this face.`
          : `IDENTITY LOCK — use the physical identity description for "${r.name}" consistently.`,
        `THREE-VIEW CHARACTER TURNAROUND for "${r.name}". ONE single wide canvas showing EXACTLY THREE `
        + `full-body views side by side, left to right: FRONT, THREE-QUARTER, BACK. Show the complete `
        + `standing body to the soles of the feet in every view. FRONT is the sole technical headless `
        + `body plate: straight-on, cropped cleanly at the BASE OF THE NECK, with NO face, facial `
        + `feature, hair or headwear visible. THREE-QUARTER shows the complete head and the face clearly `
        + `with a neutral expression. BACK shows the complete natural back of the head and outfit, with `
        + `no over-shoulder turn and no face visible. One person seen three times — never three people.`,
        `Body specification: ${body}. Render true adult human proportions at natural stature: normal `
        + `shoulder-to-torso ratio, pelvis at a believable height, legs approximately half the standing `
        + `height, normal-length arms and hands. All three bodies use the same scale, shoulder line and `
        + `feet baseline. No compressed torso or shortened limbs.`,
        `TALL-STATURE COMPOSITION LOCK — construct the underlying body in every panel at 7.5 to 8 `
        + `head-lengths tall. The crotch sits just above the standing-height midpoint; knees sit halfway `
        + `between crotch and floor; fingertips reach mid-thigh. A plus-size or broad build changes width, `
        + `never height, torso length or leg length. Each complete figure uses 88–92% of the canvas `
        + `height and no more than 68% of its own column width. Empty side space is correct. Use three `
        + `equal vertical columns, one figure per column. All panels share one invisible crown line, one `
        + `shoulder line and one feet baseline; the FRONT reserves empty head space above its neck crop `
        + `and must not enlarge or shorten the body to fill that space.`,
        exactHeight,
        wardrobe,
        `Neutral anatomical stance, arms relaxed with a small gap from the torso, hands visible, feet `
        + `parallel. Flat orthographic character-sheet camera at mid-torso height, 85mm-equivalent `
        + `perspective, level horizon; no high angle, wide-angle foreshortening or perspective shrink. `
        + `The three views must read as one consistent identity, body and outfit.`,
        flatLightClause(),
        contactShadowClause(),
        groundClause(),
        negativeBlock(r.negatives, [
          'any face, facial feature, hair, headwear or portrait fragment in the front view',
          'a cropped or missing head in the three-quarter or back view',
          'a hidden or unreadable face in the three-quarter view',
          'an over-shoulder face in the back view',
          'a fourth view or a duplicated angle',
          'a dwarf, childlike, chibi or caricatured body',
          'short stature unless explicitly stated in the character specification',
          'shortened legs, shortened arms, compressed torso or oversized shoulders',
          'a plus-size build interpreted as reduced height or shortened limbs',
          'a high camera, wide-angle lens, perspective foreshortening or figure scaled small in frame',
          'different body proportions between views', 'more than one character identity',
          'scene background or environment',
          r.fromWardrobeRef ? 'any wardrobe not present in the attached wardrobe reference' : 'black clothing',
          'text, labels or watermark',
        ]),
      ),
      fallbackPrompt: join(
        `A simple three-view standing character turnaround for "${r.name}" — headless front body `
        + `cropped at the base of the neck, complete three-quarter with face visible, and complete back `
        + `with the back of the head visible. Exactly three views. Natural average-to-tall adult body, `
        + `7.5 to 8 head-lengths tall, long uncompressed limbs, large in frame.`,
        flatLightClause(), groundClause(),
      ),
    };
  }

  // video-anchor — the variant that survives a video model's face filter.
  //
  // BytePlus rejects any readable face outright (InputImageSensitiveContent
  // .PrivacyInformation), so a passport-style identity plate is exactly the
  // shape it refuses. This plate keeps the same person but full-body, face
  // small in frame, with the grain-and-bloom pass already applied.
  return {
    aspect: '9:16',
    prompt: join(
      REFERENCE_PLATE_FRAME,
      r.fromIdentity
        ? 'The attached image is the identity reference — same person, same build, same hair.'
        : '',
      `VIDEO ANCHOR for "${r.name}". A full-body standing view, the whole figure in frame from head `
      + `to feet, with the face occupying well under a tenth of the frame height — legible as the `
      + `same person by build, posture, hair and silhouette rather than by facial detail.`,
      `Physical identity: ${identity}.`,
      `Plain dark monochrome clothing. Natural standing posture, arms relaxed at the sides.`,
      `Rendered with a soft photographic grain and a gentle highlight bloom, as a filmed frame `
      + `rather than a clean studio capture.`,
      flatLightClause(),
      contactShadowClause(),
      groundClause(),
      negativeBlock(r.negatives, [
        'close-up or cropped framing', 'a large or sharply detailed face',
        'more than one person', 'text or watermark',
      ]),
    ),
    fallbackPrompt: join(
      `A simple, modest full-body standing reference of "${r.name}" in plain everyday clothes, `
      + `seen from a distance. Innocent pre-production art.`,
      flatLightClause(), groundClause(),
    ),
  };
}

// ─── LOCATION ────────────────────────────────────────────────────────────────

const LOCATION_ROLE_BRIEF: Record<string, string> = {
  wide: 'An ESTABLISHING WIDE built at a THREE-QUARTER angle to the space — never flat-on — so the '
    + 'depth of the room reads and the model can extend it. The plate must show three distinct '
    + 'depth planes.',
  reverse: 'The REVERSE ANGLE of the same space, shot back toward where the establishing wide was '
    + 'standing. Same architecture, same materials, same light direction — the other half of the room.',
  working: 'A MEDIUM WORKING view: the part of the space where the action actually plays, closer in, '
    + 'still showing enough surround to place it.',
  detail: 'A TIGHT DETAIL INSERT of the one object that makes this place real.',
};

function locationRecipe(r: AssetRecipeReq): AssetRecipe {
  const planes = [
    r.spec.foreground && `Foreground: ${r.spec.foreground}`,
    r.spec.midground && `Midground: ${r.spec.midground}`,
    r.spec.background && `Background: ${r.spec.background}`,
  ].filter(Boolean).join('. ');

  const hour = [r.spec.hour, r.spec.light].filter(Boolean).join(', ');

  return {
    aspect: r.role === 'detail' ? '4:5' : '16:9',
    prompt: join(
      REFERENCE_PLATE_FRAME,
      fromRefLine(r.fromRef),
      `LOCATION PLATE for "${r.name}"${r.spec.note ? ` — ${r.spec.note}` : ''}.`,
      LOCATION_ROLE_BRIEF[r.role] ?? LOCATION_ROLE_BRIEF.wide,
      planes && `Three plates. ${planes}.`,
      r.spec.truthObject && `The one detail that tells the viewer this place is real, and it must be `
        + `present and readable: ${r.spec.truthObject}.`,
      hour && `Time and light: ${hour}. The light direction must be identical across every plate of `
        + `this location, so the space stays one place across the set.`,
      `NO PEOPLE in frame — this plate is the space itself.`,
      negativeBlock(r.negatives, [
        'people or figures', 'invented readable signage or lettering',
        'text or watermark', 'an artificially saturated or brand-coloured sky',
      ]),
    ),
    fallbackPrompt: join(
      `A simple, wholesome establishing sketch of a location: "${r.name}". No people in frame. `
      + `Innocent pre-production art.`,
    ),
  };
}

// ─── PROP ────────────────────────────────────────────────────────────────────

function propRecipe(r: AssetRecipeReq): AssetRecipe {
  const object = [r.spec.material, r.spec.finish, r.spec.note].filter(Boolean).join(', ');

  if (r.role === 'insert') {
    return {
      aspect: '1:1',
      prompt: join(
        REFERENCE_PLATE_FRAME,
        `DETAIL INSERT for the prop "${r.name}"${r.part ? ` — the ${r.part}` : ''}. A tight isolated `
        + `study of that one part, large in frame, so its construction, texture and any engraving `
        + `read exactly. These are the details that drift first when the model only ever sees the `
        + `object wide.`,
        object && `The object: ${object}.`,
        contactShadowClause(),
        flatLightClause(),
        groundClause(),
        negativeBlock(r.negatives, ['hands', 'people', 'environment or set dressing', 'text or watermark']),
      ),
      fallbackPrompt: join(`A simple object study of one part of "${r.name}". No people.`, groundClause()),
    };
  }

  return {
    aspect: '32:9',
    prompt: join(
      REFERENCE_PLATE_FRAME,
      fromRefLine(r.fromRef),
      `PROP TURNAROUND for "${r.name}". ONE single wide canvas laid out as four clean orthographic `
      + `studio views side by side, labelled in order: FRONT, THREE-QUARTER, SIDE, BACK. The SAME `
      + `object in all four panels, identical in design, colour, scale and lighting.`,
      object && `The object: ${object}.`,
      r.spec.scaleCue && `Scale: ${r.spec.scaleCue}. The object must read at that real size, not as `
        + `a miniature or a monument.`,
      // The single most important line in the prop recipe.
      `The object is a real physical thing with volume: real material thickness and taper, visible `
      + `surface texture, and honest highlight roll-off. Matte surfaces read matte, metal reads metal.`,
      contactShadowClause(),
      flatLightClause(),
      groundClause(),
      negativeBlock(r.negatives, [
        'a flat or cut-out rendering with no volume', 'a missing contact shadow',
        'hands or people', 'environment or set dressing', 'text or watermark',
        'differing designs between the four views',
      ]),
    ),
    fallbackPrompt: join(
      `A simple multi-view object study of "${r.name}" — front, side and back on a plain ground. `
      + `No people.`,
      groundClause(),
    ),
  };
}

// ─── WARDROBE ────────────────────────────────────────────────────────────────

/** How the garment is presented. Input TYPE measurably changes the output:
 *  flat-lay wins on print, logo and text fidelity; on-body imports pose
 *  artefacts from the reference figure; ghost-mannequin is the honest middle
 *  and the only one that keeps the DRAPE — which for a thobe, abaya or bisht
 *  is the garment. */
const PHOTO_TYPE_BRIEF: Record<string, string> = {
  flat: 'Presented as a FLAT-LAY: the garment laid out flat and square to camera, fully visible, '
    + 'smoothed but not ironed stiff, shot from directly above.',
  ghost: 'Presented as a GHOST-MANNEQUIN: the garment holds its worn shape and full drape with NO '
    + 'body and no mannequin visible inside it — the hollow neck and cuffs are open. The fall of the '
    + 'fabric is the point.',
  'on-body': 'Presented ON A NEUTRAL FIGURE, standing straight, arms relaxed, so the garment sits as '
    + 'it really hangs. The figure is deliberately anonymous — this plate is about the garment.',
};

function wardrobeRecipe(r: AssetRecipeReq): AssetRecipe {
  const piece = r.part || r.spec.piece || r.name;
  const build = [r.spec.material, r.spec.colour, r.spec.condition].filter(Boolean).join(', ');
  const type = r.photoType ?? 'ghost';

  if (r.role === 'swatch') {
    return {
      aspect: '1:1',
      prompt: join(
        REFERENCE_PLATE_FRAME,
        `MATERIAL SWATCH for "${piece}". A flat close study of the cloth itself, filling the frame: `
        + `weave, weight, sheen and colour readable at a glance.`,
        build && `The material: ${build}.`,
        flatLightClause(), groundClause(),
        negativeBlock(r.negatives, ['people', 'the whole garment', 'text or watermark']),
      ),
      fallbackPrompt: join(`A simple fabric swatch study for "${piece}".`, groundClause()),
    };
  }

  return {
    aspect: type === 'flat' ? '1:1' : '4:5',
    prompt: join(
      REFERENCE_PLATE_FRAME,
      fromRefLine(r.fromRef),
      `WARDROBE PLATE for "${piece}"${r.spec.role ? `, worn by ${r.spec.role}` : ''}.`,
      PHOTO_TYPE_BRIEF[type],
      build && `The piece: ${build}.`,
      r.spec.cut && `Cut and construction: ${r.spec.cut}.`,
      // Wrinkles in the input become amplified wrinkles in the output, so the
      // condition has to be stated as an intended state, not left to chance.
      `Condition is deliberate: ${r.spec.condition || 'pressed but not crisp, previously worn'} — `
      + `not crumpled, not factory-new.`,
      flatLightClause(),
      groundClause(),
      negativeBlock(r.negatives, [
        'a visible mannequin, stand or hanger',
        type === 'on-body' ? 'a recognisable face' : 'any person or body part',
        'brand logos or counterfeit marks', 'text or watermark',
      ]),
    ),
    fallbackPrompt: join(
      `A simple, modest clothing study of "${piece}" laid out plainly. No people. Innocent `
      + `pre-production wardrobe reference.`,
      groundClause(),
    ),
  };
}

// ─── entry point ─────────────────────────────────────────────────────────────

export function buildAssetRecipe(r: AssetRecipeReq): AssetRecipe {
  switch (r.kind) {
    case 'character': return characterRecipe(r);
    case 'location': return locationRecipe(r);
    case 'prop': return propRecipe(r);
    case 'wardrobe': return wardrobeRecipe(r);
  }
}
