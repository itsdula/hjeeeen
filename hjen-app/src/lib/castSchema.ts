// Cast — the character-profile schema + the vision reader that fills it from a
// photo. This is the INVERSE of the hand-filled "Reference Studio" tutorial
// tool: instead of typing 37 anchors to make a prompt, we read the anchors OUT
// of an uploaded portrait, then re-inject them into platform-ready prompts so
// the same locked identity rides into any Studio.
//
// Self-contained: depends only on window.hjen.claudeJson (vision) + extractJson.
// No electron/main or preload changes.

import { extractJson } from './storyboardLlm';

// ─── the schema (ported 1:1 from the Reference Studio tool) ───────────

export interface AttrItem {
  key: string;
  label: string;
  type?: 'text' | 'textarea';
  options?: string[];
  placeholder?: string;
}
export interface AttrGroup { group: string; items: AttrItem[] }

export const ATTRS: AttrGroup[] = [
  { group: 'Identity', items: [
    { key: 'name', label: 'Character name', type: 'text', placeholder: 'e.g., Maya Cole' },
    { key: 'archetype', label: 'Role / archetype', options: ['Lifestyle influencer', 'Fashion model', 'Fitness creator', 'Tech entrepreneur', 'Travel vlogger', 'Musician / artist', 'Chef / food creator', 'Gamer / streamer', 'Wellness coach', 'Luxury lifestyle'] },
    { key: 'age', label: 'Age range', options: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] },
    { key: 'sex', label: 'Sex', options: ['Female', 'Male'] },
    { key: 'heritage', label: 'Ethnicity / heritage', options: ['European heritage', 'Eastern European heritage', 'Mediterranean heritage', 'Scandinavian heritage', 'West African heritage', 'East African heritage', 'African American heritage', 'Afro-Caribbean heritage', 'East Asian heritage', 'South Asian heritage', 'Southeast Asian heritage', 'Middle Eastern heritage', 'Persian appearance', 'Levantine appearance', 'Latin American heritage', 'Pacific Islander heritage', 'Indigenous American heritage', 'Mixed heritage'] },
  ] },
  { group: 'Face', items: [
    { key: 'faceShape', label: 'Face shape', options: ['Oval', 'Round', 'Square', 'Heart', 'Diamond', 'Oblong'] },
    { key: 'skinTone', label: 'Skin tone', options: ['Fair', 'Light', 'Light-medium', 'Medium', 'Tan', 'Deep tan', 'Brown', 'Deep brown', 'Rich ebony'] },
    { key: 'skinDetail', label: 'Skin detail', options: ['Smooth and clear', 'Light freckles', 'Heavy freckles', 'Dimples', 'Beauty mark', 'Sun-kissed glow', 'Matte natural'] },
    { key: 'facialHair', label: 'Facial hair', options: ['None', 'Clean-shaven', 'Slight peach fuzz', 'Visible peach fuzz catching the light', 'Light stubble', 'Heavy stubble', 'Short boxed beard', 'Full beard', 'Mustache', 'Goatee'] },
    { key: 'blemish', label: 'Blemish control', options: ['Clear, blemish-free skin', 'Natural pores only, no blemishes', 'Light freckles only, no blemishes', 'Realistic skin with subtle imperfections', 'No retouching, natural skin'] },
    { key: 'noseShape', label: 'Nose shape', options: ['Straight', 'Button', 'Aquiline', 'Upturned', 'Wide', 'Narrow', 'Rounded'] },
    { key: 'lipShape', label: 'Lip shape', options: ['Full', 'Thin', 'Heart-shaped', 'Wide', 'Bow-shaped'] },
    { key: 'jawline', label: 'Jawline', options: ['Soft', 'Defined', 'Chiseled', 'Rounded'] },
    { key: 'eyebrows', label: 'Eyebrows', options: ['Naturally arched', 'Straight', 'Thick and bold', 'Thin and shaped', 'Feathered'] },
    { key: 'features', label: 'Distinguishing feature', type: 'text', placeholder: 'e.g., small scar above left brow (optional)' },
  ] },
  { group: 'Eyes', items: [
    { key: 'eyeColor', label: 'Eye color', options: ['Dark brown', 'Brown', 'Hazel', 'Amber', 'Green', 'Blue', 'Gray', 'Heterochromia'] },
    { key: 'eyeShape', label: 'Eye shape', options: ['Almond', 'Round', 'Hooded', 'Monolid', 'Upturned', 'Downturned', 'Deep-set'] },
  ] },
  { group: 'Hair', items: [
    { key: 'hairColor', label: 'Hair color', options: ['Jet black', 'Dark brown', 'Chestnut brown', 'Auburn', 'Copper red', 'Honey blonde', 'Platinum blonde', 'Silver gray', 'Dyed (bold color)'] },
    { key: 'hairLength', label: 'Hair length', options: ['Buzzed', 'Short', 'Chin-length', 'Shoulder-length', 'Long', 'Waist-length'] },
    { key: 'hairTexture', label: 'Hair texture', options: ['Straight', 'Wavy', 'Curly', 'Coily', 'Locs', 'Braided'] },
    { key: 'hairStyle', label: 'Signature hairstyle', options: ['Loose and natural', 'Sleek and styled', 'High ponytail', 'Low bun', 'Side part', 'Middle part', 'Slicked back', 'Protective style', 'Textured fade'] },
    { key: 'edges', label: 'Edges / baby hairs', options: ['None', 'Laid edges with sleek swirls', 'Slayed edges with sculpted swoops', 'Swooped baby hairs framing the face', 'Defined swirl edges along the hairline', 'Soft natural baby hairs', 'Dramatic swoops and swirl edges'] },
  ] },
  { group: 'Body', items: [
    { key: 'build', label: 'Body shape / build', options: ['Slim', 'Athletic', 'Average', 'Toned', 'Curvy', 'Muscular', 'Plus-size'] },
    { key: 'height', label: 'Height', options: ['Petite', 'Average', 'Tall'] },
  ] },
  { group: 'Style & Vibe', items: [
    { key: 'fashion', label: 'Fashion aesthetic', options: ['Streetwear', 'Luxury minimalist', 'Bohemian', 'Athleisure', 'Business casual', 'Edgy / alt', 'Vintage', 'Coastal casual', 'High fashion'] },
    { key: 'outfit', label: 'Specific clothing (optional)', type: 'textarea', placeholder: 'e.g., oversized cream wool coat over a black turtleneck' },
    { key: 'signature', label: 'Signature item', type: 'text', placeholder: 'e.g., gold hoop earrings (optional)' },
    { key: 'vibe', label: 'Personality energy', options: ['Confident', 'Warm and approachable', 'Mysterious', 'Playful', 'Intense', 'Serene', 'Magnetic'] },
    { key: 'expression', label: 'Default expression', options: ['Soft smile', 'Bright smile', 'Subtle smirk', 'Neutral and composed', 'Laughing', 'Pensive'] },
    { key: 'gaze', label: 'Gaze / eye contact', options: ['Looking directly into the camera', 'Direct, intense eye contact with the camera', 'Soft gaze toward the camera', 'Looking slightly off-camera', 'Looking away to the side', 'Looking down', 'Looking up and away', 'Over-the-shoulder glance at the camera'] },
    { key: 'pose', label: 'Pose', options: ['Standing, relaxed and confident', 'Arms crossed', 'Hands in pockets', 'Walking toward camera', 'Leaning against a wall', 'Seated, leaning forward', 'Three-quarter turn to camera', 'Over-the-shoulder glance', 'Candid mid-laugh', 'Hand on hip', 'Adjusting jacket or sleeve'] },
  ] },
  { group: 'Camera & Lighting', items: [
    { key: 'shotSize', label: 'Shot size', options: ['Medium close-up', 'Close-up', 'Extreme close-up', 'Insert (detail shot)', 'Medium shot', 'Cowboy shot (mid-thigh up)', 'Full body', 'Wide shot', 'Extreme wide / establishing'] },
    { key: 'cameraAngle', label: 'Camera angle', options: ['Eye level', 'Slightly above eye level', 'Low angle looking up', 'High angle looking down', 'Dutch tilt', 'Head-on symmetrical', 'Three-quarter angle', 'Profile side angle', 'Over-the-shoulder'] },
    { key: 'lens', label: 'Lens', options: ['85mm portrait lens', '50mm natural lens', '35mm environmental lens', '24mm wide-angle lens', '105mm telephoto lens'] },
    { key: 'lighting', label: 'Lighting', options: ['Soft studio key with gentle rim light', 'Soft natural window light', 'Golden hour sunlight', 'Overcast diffused daylight', 'Dramatic Rembrandt lighting', 'Butterfly beauty lighting', 'Hard direct sunlight', 'Neon night ambience', 'Moody low-key', 'Bright high-key'] },
    { key: 'aspectRatio', label: 'Aspect ratio', options: ['4:5 portrait (Instagram feed)', '9:16 vertical (Reels, TikTok, Stories)', '1:1 square (feed post)', '16:9 widescreen (YouTube)', '3:4 portrait', '2:3 portrait', '21:9 cinematic'] },
  ] },
  { group: 'Additional Details', items: [
    { key: 'extra', label: 'Anything else', type: 'textarea', placeholder: 'Tattoos, accessories, makeup style, scene context, brand notes…' },
  ] },
];

export const ALL_KEYS: string[] = ATTRS.flatMap(g => g.items.map(i => i.key));

const ITEM_BY_KEY: Record<string, AttrItem> = Object.fromEntries(
  ATTRS.flatMap(g => g.items.map(i => [i.key, i])),
);

export type Profile = Record<string, string>;

// ─── platform templates (the prompt re-injection payoff) ──────────────

export interface Platform { id: string; name: string; template: string }

export const PLATFORMS: Platform[] = [
  { id: 'nbp', name: 'Nano Banana Pro', template:
`Ultra-photorealistic portrait of a {age} {sex} {archetype} of {heritage}. {faceShape} face with {skinTone} skin ({skinDetail}){facialHairClause}{blemishClause}, {noseShape} nose, {lipShape} lips, {jawline} jawline, {eyebrows} eyebrows. {eyeShape} {eyeColor} eyes. {hairColor} {hairTexture} hair, {hairLength}, worn {hairStyle}{edgesClause}. {build} build, {height} height. Wearing {wardrobe}{signatureClause}. Pose: {pose}. Gaze: {gazeClause}. Expression: {expression}, energy reads {vibe}.{featuresClause}

Camera: {shotSize}, {cameraAngle}, {lens}. Lighting: {lighting}. Shallow depth of field, true-to-life skin texture, no plastic smoothing, editorial color grade. Aspect ratio {aspectClean}.{extraClause}` },
  { id: 'sd2', name: 'Seedance 2.0', template:
`Logline: A character introduction shot of a {vibe} {age} {sex} {archetype} of {heritage}.

Overview: The subject has a {faceShape} face, {skinTone} skin with {skinDetail}{facialHairClause}{blemishClause}, {eyeShape} {eyeColor} eyes, {noseShape} nose, {lipShape} lips, and a {jawline} jawline. {hairColor} {hairTexture} hair, {hairLength}, styled {hairStyle}{edgesClause}. {build} build, {height}. Dressed in {wardrobeShort}{signatureClause}.{featuresClause} Opening pose: {pose}. Gaze: {gazeClause}. The camera holds on a natural {expression}. Format: {aspectClean}.{extraClause}

Beat 1 (0-3s): {shotSize}, {cameraAngle}, {lens}. Camera holds, as the subject turns toward camera with a {expression}. Lighting: {lighting}. SFX: soft ambient room tone. Transition: hold.` },
  { id: 'gpt', name: 'GPT Image 2', template:
`A photorealistic image of a {age} {sex} {archetype} of {heritage} with a {vibe} presence. They have a {faceShape} face, {skinTone} skin with {skinDetail}{facialHairClause}{blemishClause}, {eyeShape} {eyeColor} eyes, a {noseShape} nose, {lipShape} lips, a {jawline} jawline, and {eyebrows} eyebrows.{featuresClause} Their {hairColor} hair is {hairLength} and {hairTexture}, styled {hairStyle}{edgesClause}. They have a {build}, {height} frame and wear {wardrobeClothing}{signatureClause}. They are posed: {pose}, {gazeClause}. Their expression is a {expression}. Camera: {shotSize}, {cameraAngle}, {lens}. Lighting: {lighting}. Realistic skin texture, high detail, consistent character reference. Aspect ratio {aspectClean}.{extraClause}` },
  { id: 'sheet', name: 'Reference Sheet', template:
`Character turnaround reference sheet of a {age} {sex} {archetype} of {heritage}, on a seamless pure white studio background with soft, even, shadow-free lighting.

Layout: one single wide image arranged as a clean two-row grid, no text or borders. Every panel shows the SAME character in the SAME outfit. Top row: full-body front, back, left profile, three-quarter front-left (waist up), three-quarter front-right (waist up). Bottom row, five head-and-shoulders studies: front, right three-quarter, left profile, right profile, left three-quarter.

Consistency lock: {faceShape} face, {skinTone} skin with {skinDetail}{facialHairClause}{blemishClause}, {eyeShape} {eyeColor} eyes, {noseShape} nose, {lipShape} lips, {jawline} jawline, {eyebrows} eyebrows.{featuresClause} {hairColor} {hairTexture} hair, {hairLength}, styled {hairStyle}{edgesClause}. {build} build, {height}. Wardrobe: {wardrobeShort}{signatureClause}.

Identical face, proportions, hair and outfit in every panel. Neutral composed expression throughout. Photorealistic model-sheet style on white, high detail. Aspect ratio 21:9 ultra-wide.{extraClause}` },
];

// ─── template engine (ported from the Reference Studio tool) ──────────

const lc = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Expand a raw profile into the derived dict the templates expect. */
export function buildData(values: Profile): Record<string, string> {
  const d: Record<string, string> = {};
  ALL_KEYS.forEach(k => { d[k] = (values[k] || '').trim(); });
  if (!d.name) d.name = 'this character';
  d.sex = (d.sex || '').toLowerCase();
  d.signatureClause = d.signature ? `, with ${d.signature}` : '';
  d.wardrobe = d.outfit ? d.outfit : ((d.fashion || '') + ' styling');
  d.wardrobeShort = d.outfit ? d.outfit : ((d.fashion || '') + ' wardrobe');
  d.wardrobeClothing = d.outfit ? d.outfit : ((d.fashion || '') + ' clothing');
  d.featuresClause = d.features ? ` Distinguishing feature: ${d.features}.` : '';
  d.edgesClause = (d.edges && d.edges !== 'None') ? ', ' + lc(d.edges) : '';
  d.facialHairClause = (d.facialHair && d.facialHair !== 'None') ? ', ' + lc(d.facialHair) : '';
  d.blemishClause = d.blemish ? ', ' + lc(d.blemish) : '';
  d.gazeClause = d.gaze ? d.gaze : 'looking directly into the camera';
  d.aspectClean = (d.aspectRatio || '').split(' (')[0];
  d.extraClause = d.extra ? ' Additional details: ' + d.extra + (/[.!?]$/.test(d.extra) ? '' : '.') : '';
  return d;
}

export function fillTemplate(tpl: string, d: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (d[k] !== undefined ? d[k] : m))
    .replace(/\s+,/g, ',').replace(/ {2,}/g, ' ')
    .replace(/\.\s*\./g, '.').replace(/\n{3,}/g, '\n\n').trim();
}

/** Plain-text serialization of the card — round-trips the tutorial tool's output. */
export function profileText(values: Profile): string {
  const d = buildData(values);
  const L: string[] = [];
  L.push('CHARACTER REFERENCE PROFILE');
  L.push('============================');
  L.push('Name: ' + (d.name === 'this character' ? 'Unnamed' : d.name));
  L.push('Archetype: ' + d.archetype); L.push('Age: ' + d.age); L.push('Sex: ' + d.sex); L.push('Heritage: ' + d.heritage); L.push('');
  L.push('FACE');
  L.push(`  Shape: ${d.faceShape} | Skin: ${d.skinTone} (${d.skinDetail})` + (d.facialHair && d.facialHair !== 'None' ? ` | Facial hair: ${d.facialHair}` : ''));
  if (d.blemish) L.push(`  Blemish control: ${d.blemish}`);
  L.push(`  Nose: ${d.noseShape} | Lips: ${d.lipShape} | Jawline: ${d.jawline} | Brows: ${d.eyebrows}`);
  if (d.features) L.push('  Distinguishing feature: ' + d.features);
  L.push('EYES');
  L.push(`  ${d.eyeShape}, ${d.eyeColor}`);
  L.push('HAIR');
  L.push(`  ${d.hairColor}, ${d.hairLength}, ${d.hairTexture}, styled ${d.hairStyle}` + (d.edges && d.edges !== 'None' ? ` | Edges: ${d.edges}` : ''));
  L.push('BODY');
  L.push(`  ${d.build} build, ${d.height}`);
  L.push('STYLE & VIBE');
  L.push(`  Fashion: ${d.fashion}${d.signature ? ' | Signature: ' + d.signature : ''}`);
  if (d.outfit) L.push(`  Specific clothing: ${d.outfit}`);
  L.push(`  Pose: ${d.pose}`);
  L.push(`  Energy: ${d.vibe} | Expression: ${d.expression} | Gaze: ${d.gaze}`);
  L.push('CAMERA & LIGHTING');
  L.push(`  ${d.shotSize} | ${d.cameraAngle} | ${d.lens}`);
  L.push(`  Lighting: ${d.lighting} | Aspect ratio: ${d.aspectClean}`);
  if (d.extra) { L.push('ADDITIONAL DETAILS'); L.push('  ' + d.extra); }
  return L.join('\n');
}

// ─── the vision reader: photo → profile ───────────────────────────────

const READER_SYSTEM = `You are a casting director and cinematographer. You are given ONE OR MORE photographs of the SAME person and you read a single precise CHARACTER PROFILE — the structured anchors a generation model needs to reproduce this exact person consistently.

Hard rules:
- The photos are the SAME individual across different shots/angles/lighting. Consolidate them into ONE profile. When photos disagree on a stable trait (face shape, eye colour, nose, heritage), trust the clearest, most front-lit, highest-confidence view. Treat changeable things (expression, pose, lighting, crop, wardrobe) as per-shot, not identity — describe the most representative.
- Report ONLY what is visible across these photos. Never invent. If an attribute is not visible or you are unsure, omit it (don't guess).
- For every "enum" attribute you DO report, the value MUST be copied verbatim from that attribute's allowed options — never paraphrase or invent a new label.
- Free-text attributes (name, features, outfit, signature, extra) accept your own short concrete phrase; leave them out if nothing is clearly present. Never invent a name.
- Camera/lighting/aspect attributes describe how THIS photo was shot (read the actual lens, angle, light and crop), not an ideal.
- For each attribute you report, give a confidence 0.0–1.0 (1.0 = unmistakable, 0.4 = a guess from weak evidence).

OUTPUT: return ONLY a fenced \`\`\`json block, no prose. Shape:
{ "values": { "<key>": "<value>", ... }, "confidence": { "<key>": 0.0, ... } }`;

function schemaForPrompt(): string {
  return ATTRS.map(g => {
    const lines = g.items.map(i => i.options
      ? `  - ${i.key} (enum): ${i.options.join(' | ')}`
      : `  - ${i.key} (free text): ${i.label}`);
    return `${g.group}:\n${lines.join('\n')}`;
  }).join('\n\n');
}

/** Snap a returned enum value to its allowed option (case-insensitive, then
 *  loose contains). Returns null if it cannot be reconciled. */
function snapEnum(item: AttrItem, raw: string): string | null {
  if (!item.options) return raw;
  const v = (raw || '').trim();
  if (!v) return null;
  const exact = item.options.find(o => o.toLowerCase() === v.toLowerCase());
  if (exact) return exact;
  const loose = item.options.find(o => o.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(o.toLowerCase()));
  return loose || null;
}

export interface ReadResult {
  ok: true;
  values: Profile;
  confidence: Record<string, number>;
  /** keys the reader filled but flagged low-confidence (< 0.6) → ask the human. */
  flagged: string[];
  /** keys that came back but could not be matched to an allowed option. */
  dropped: string[];
}
export interface ReadError { ok: false; message: string }

/** Read one consolidated character profile from one OR MORE photos of the
 *  same person via Claude vision (single multi-image call). */
export async function readProfileFromPhotos(imagePaths: string[]): Promise<ReadResult | ReadError> {
  const paths = (imagePaths || []).filter(Boolean);
  if (!paths.length) return { ok: false, message: 'No photos to read.' };

  const many = paths.length > 1;
  const res = await window.hjen.claudeJson({
    system: READER_SYSTEM,
    prompt: `${many ? `These ${paths.length} photos are the SAME person. Read ONE consolidated profile.` : 'Read this portrait into the profile below.'} Choose enum values ONLY from the allowed options; omit anything you cannot see.\n\nSCHEMA:\n${schemaForPrompt()}`,
    imagePaths: paths,
    maxTokens: 2000,
  });
  if (!res.ok) return { ok: false, message: res.message };

  const parsed = extractJson(res.text);
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, message: 'Could not read a profile from that photo. Try a clearer, front-facing portrait.' };
  }

  const rawValues: Record<string, any> = parsed.values && typeof parsed.values === 'object' ? parsed.values : parsed;
  const rawConf: Record<string, any> = parsed.confidence && typeof parsed.confidence === 'object' ? parsed.confidence : {};

  const values: Profile = {};
  const confidence: Record<string, number> = {};
  const flagged: string[] = [];
  const dropped: string[] = [];

  for (const key of ALL_KEYS) {
    const item = ITEM_BY_KEY[key];
    let raw = rawValues[key];
    if (raw == null || raw === '') continue;
    raw = String(raw).trim();
    if (item.options) {
      const snapped = snapEnum(item, raw);
      if (!snapped) { dropped.push(key); continue; }
      values[key] = snapped;
    } else {
      values[key] = raw;
    }
    const c = typeof rawConf[key] === 'number' ? rawConf[key] : 0.6;
    confidence[key] = c;
    if (c < 0.6) flagged.push(key);
  }

  if (Object.keys(values).length === 0) {
    return { ok: false, message: 'The reader returned nothing usable. Try a clearer portrait.' };
  }
  return { ok: true, values, confidence, flagged, dropped };
}

/** A compact, prompt-ready identity sentence built from the profile — used
 *  when recalling a character into Frame so the locked anchors travel into
 *  the prompt text (the references travel as layers separately). */
export function characterPrompt(values: Profile): string {
  const d = buildData(values);
  const who = d.name && d.name !== 'this character' ? d.name + ', a' : 'A';
  return fillTemplate(
    `${who} {age} {sex} {archetype} of {heritage}. {faceShape} face, {skinTone} skin ({skinDetail}){facialHairClause}{blemishClause}, {noseShape} nose, {lipShape} lips, {jawline} jawline, {eyebrows} eyebrows. {eyeShape} {eyeColor} eyes. {hairColor} {hairTexture} hair, {hairLength}, {hairStyle}{edgesClause}. {build} build, {height}.{featuresClause} Wearing {wardrobe}{signatureClause}. Keep this exact identity consistent.`,
    d,
  );
}
