// engine.js — the Eye, SERVER-side. Port of app/electron/eye.ts.
//
// WHY THIS FILE EXISTS. eye.ts was written for the Electron MAIN process
// precisely so the recipe never reaches the renderer ("grep -r EYE_READ_SYS
// app/src/ must return nothing"). The web runs the same renderer, so giving the
// web an Eye means putting the same engine behind the same seam on the server —
// not shipping the prompt to the browser. EYE_READ_SYS below is lifted VERBATIM
// from eye.ts; if one of them changes, both must.
//
// Differences from the desktop, all of them about WHERE things live, never what
// they say:
//   · the image arrives as a cloud token (cloudgen:// / cloudlib:// / cloudbd://)
//     instead of a disk path — src/llm/run.js resolves and transcodes it;
//   · the golden set is an account document instead of eye_golden.jsonl.

import crypto from 'node:crypto';
import { cloud } from '../cloudstore.js';
import { runLlmJson, providerFor, readVisionImage, parseCloudToken } from '../llm/run.js';

// Must match TASKS['eye-read'].defaultModel in src/lib/models/registry.ts.
const DEFAULT_MODEL = 'gemini-3.6-flash';

// ═══════════════════════════ THE RECIPE ═══════════════════════════
// Ten axes in three layers plus the search key. Layers 1-2 are what any
// captioner produces. Layer 3 is the eye - and the refusals in it are what stop
// this from drifting into stock-library description.

const EYE_READ_SYS = `You are a working commercial stills photographer reading ONE frame. Not a captioner — a photographer who has to brief a gaffer, a stylist and a retoucher from this read tomorrow morning.

Reply ONLY with a JSON object. No prose, no markdown fences.

{
  "subject": "who/what · how many · age band · posture · hands · eye-line. One line.",
  "place": "the place named SPECIFICALLY, interior or exterior, and the social register of the place",
  "action": "the verb of the frame — what is happening, not what surrounds it",
  "objects": ["3-6 concrete nouns ACTUALLY VISIBLE in frame"],

  "light": {
    "key": "direction + quality + apparent source",
    "fill": "the ratio in words",
    "accent": "rim / practical / event light, or omit if none",
    "kelvin": "named, and named as mixed when mixed",
    "state": "one of: day | golden | blue-hour | night | interior-practical | mixed"
  },
  "lens": {
    "size": "one of: ecu | cu | mcu | medium | medium-wide | wide | extreme-wide | aerial",
    "angle": "one of: eye | low | high | dutch — where the camera TILTS",
    "height": "one of: floor | child | hip | eye | overhead — where the camera STANDS",
    "focal": "one of: wide | normal | long | macro — the FEEL, never a mm number you cannot know",
    "depth": "where the depth band sits and what falls out of it"
  },
  "colour": {
    "dominant": "", "second": "", "accent": "",
    "behaviour": "the RELATIONSHIP between them, not a list"
  },
  "medium": "film or digital · grain structure · halation · the era OF THE IMAGE ITSELF",
  "time": "hour · weather · operational state (rush hour / quiet hour / first light / closing)",

  "inside": "what is happening INSIDE the subject IN THIS FRAME. One sentence.",
  "craftMove": "what the photographer DID — the decision behind the frame",
  "culturalTruth": "the object, gesture or detail that makes this real rather than staged — or, if it IS staged, the tell that gives it away",
  "refusal": "what is WRONG with this frame",

  "searchPhrase": "5-10 English words",
  "searchPhraseAr": "نفس المفتاح بالعربية — ٥ إلى ١٠ كلمات",
  "tags": ["8-14 tags, Arabic and English mixed in one array"],
  "register": "one of: longing | resolve | joy | desolation | turbulence | groundedness",
  "energy": "one of: quiet | mid | loud",
  "quality": 3
}

HOW TO READ — the disciplines that make this a read and not a caption:

LIGHT. Name every source and what it does. "well-lit", "atmospheric", "natural lighting", "bright and airy", "moody" are refusals dressed as answers — if you write one, you have not looked. Say where the key comes from, how hard it is, what the shadow side does, and whether the colour temperatures fight.

LENS. height is WHERE THE CAMERA STANDS; angle is WHERE IT TILTS. They are different facts and collapsing them destroys both. A camera at a child's height pointing straight ahead is height=child, angle=eye.

COLOUR. Never answer with an inventory. "orange, yellow, brown" is a list. "one warm body held inside a cold grey field, the only saturated thing in frame" is a read. dominant/second/accent name the hues; behaviour names what they DO to each other.

INSIDE. This frame, this instant — not the story around it. Not a mood word. A sentence with a person in it: "She is waiting for her husband, five minutes late; not worried yet." If you cannot find one person's interior state, say what the frame withholds instead — but say something a director could act on.

CRAFTMOVE. The decision, not the description. "Shot from the child's height so the adults read as architecture." "Let the practical blow out so the window becomes the subject." "Waited for the second the hands stopped moving." If the frame contains no decision, say that plainly — some frames are just documentation, and saying so is useful.

CULTURALTRUTH and REFUSAL are MANDATORY. Never "n/a", never "none", never "nothing". Every frame has a detail carrying its truth or betraying its staging, and every frame has something wrong with it — soft focus where it matters, a wardrobe piece too new, a gesture held one beat too long, a background that contradicts the story, a cliché it walked into. If you cannot fault a frame you have not looked hard enough. This is the axis that makes you an eye.

SEARCHPHRASE. 5-10 English words naming WHAT WOULD BE IN THE FRAME — concrete scene and subject nouns (place, people, object, action) plus one or two mood words. NO colour names. NO camera jargon. NO hashtags, no punctuation. This string is a search key for a film-stills library, and colour words poison it: they pull literal colour matches with nothing to do with the scene. Example: "farmer dusty field harvest homeland nostalgic".

SEARCHPHRASEAR. The same key in ARABIC — 5-10 words, same rules, same scene. NOT a word-for-word translation of the English: write it the way a Saudi director would ASK for this frame out loud. Natural Modern Standard Arabic, no transliteration, no Latin letters, no punctuation. Measured on the first 142 reads: every prose field came back English-only, so an Arabic query could reach nothing but the tag list — the same scene scored 10/10 searched in English and 0/10 in Arabic. This field is what closes that. Example: "مزارع حقل مغبر وقت الحصاد حنين للأرض".

QUALITY. 3 = strong enough to hand a generator as a direct reference. 2 = partial, worth it for palette or blocking only. 1 = documentation.

Read what is ACTUALLY THERE. Do not infer a culture, a country or a religion from a face. Do not invent text on signage you cannot read. Do not describe what you assume happened before or after the frame.`;

function eyeReadUser(note) {
  const n = String(note || '').trim();
  return n
    ? `Read this frame. Context the owner supplied (use it to sharpen the read, never to override what is actually in the pixels): ${n}`
    : 'Read this frame.';
}

// ═══════════════════════════ parse + validate ═══════════════════════════

const REGISTERS = ['longing', 'resolve', 'joy', 'desolation', 'turbulence', 'groundedness'];
const ENERGIES = ['quiet', 'mid', 'loud'];
/** Answers that mean "I did not look." A layer-3 axis returning one of these is
 *  a FAILED read, not a partial one - surfaced as `thin` so the gate counts it. */
const EVASIONS = /^(n\/?a|none|nothing|unknown|unclear|not applicable|-{1,3}|\u2014)?$/i;

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const oneOf = (v, allowed, fallback) => {
  const s = str(v).toLowerCase();
  return allowed.includes(s) ? s : fallback;
};

/** Slice the first {...} out of the reply - models wrap JSON in fences even when
 *  told not to. Same lenient parse the rest of the house uses. */
function sliceJson(text) {
  const t = String(text || '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  return JSON.parse(s >= 0 ? t.slice(s, e + 1) : t);
}

/** Coerce the model's reply into the EyeRead shape and report which axes came
 *  back empty or evasive. Layer 3 is NOT silently repaired - an invented refusal
 *  would be worse than a missing one, because it would look like signal. */
export function validateRead(raw) {
  const thin = [];
  const o = raw && typeof raw === 'object' ? raw : {};
  const l = o.light && typeof o.light === 'object' ? o.light : {};
  const n = o.lens && typeof o.lens === 'object' ? o.lens : {};
  const c = o.colour && typeof o.colour === 'object' ? o.colour : (o.color && typeof o.color === 'object' ? o.color : {});

  const read = {
    subject: str(o.subject),
    place: str(o.place),
    action: str(o.action),
    objects: Array.isArray(o.objects) ? o.objects.map(str).filter(Boolean).slice(0, 8) : [],

    light: {
      key: str(l.key), fill: str(l.fill),
      accent: str(l.accent) || undefined,
      kelvin: str(l.kelvin),
      state: oneOf(l.state, ['day', 'golden', 'blue-hour', 'night', 'interior-practical', 'mixed'], 'mixed'),
    },
    lens: {
      size: oneOf(n.size, ['ecu', 'cu', 'mcu', 'medium', 'medium-wide', 'wide', 'extreme-wide', 'aerial'], 'medium'),
      angle: oneOf(n.angle, ['eye', 'low', 'high', 'dutch'], 'eye'),
      height: oneOf(n.height, ['floor', 'child', 'hip', 'eye', 'overhead'], 'eye'),
      focal: oneOf(n.focal, ['wide', 'normal', 'long', 'macro'], 'normal'),
      depth: str(n.depth),
    },
    colour: {
      dominant: str(c.dominant), second: str(c.second), accent: str(c.accent), behaviour: str(c.behaviour),
    },
    medium: str(o.medium),
    time: str(o.time),

    inside: str(o.inside),
    craftMove: str(o.craftMove ?? o.craft_move),
    culturalTruth: str(o.culturalTruth ?? o.cultural_truth),
    refusal: str(o.refusal),

    searchPhrase: str(o.searchPhrase ?? o.search_phrase).replace(/[#"',.]/g, '').replace(/\s+/g, ' ').trim(),
    searchPhraseAr: str(o.searchPhraseAr ?? o.search_phrase_ar).replace(/[#"',.]/g, '').replace(/\s+/g, ' ').trim(),
    tags: Array.isArray(o.tags) ? o.tags.map(str).filter(Boolean).slice(0, 16) : [],
    register: oneOf(o.register, REGISTERS, 'groundedness'),
    energy: oneOf(o.energy, ENERGIES, 'mid'),
    quality: (o.quality === 1 || o.quality === 2 || o.quality === 3) ? o.quality : 2,
  };

  // Layer 1 + 2 - empty is thin.
  for (const k of ['subject', 'place', 'action', 'medium', 'time']) if (!read[k]) thin.push(k);
  if (!read.objects.length) thin.push('objects');
  if (!read.light.key || !read.light.fill) thin.push('light');
  if (!read.lens.depth) thin.push('lens');
  if (!read.colour.behaviour) thin.push('colour');
  // Layer 3 + the key - empty OR evasive is thin. This is the gate's real signal.
  for (const k of ['inside', 'craftMove', 'culturalTruth', 'refusal']) {
    if (!read[k] || EVASIONS.test(read[k])) thin.push(k);
  }
  const words = read.searchPhrase ? read.searchPhrase.split(/\s+/).length : 0;
  if (words < 4 || words > 12) thin.push('searchPhrase');
  // The Arabic key is thin if absent OR if it came back in Latin letters -
  // a transliteration is useless to an Arabic query.
  const wordsAr = read.searchPhraseAr ? read.searchPhraseAr.split(/\s+/).length : 0;
  if (wordsAr < 4 || wordsAr > 12 || !/[\u0600-\u06FF]/.test(read.searchPhraseAr)) thin.push('searchPhraseAr');
  if (read.tags.length < 6) thin.push('tags');

  return { read, thin };
}

// ═══════════════════════════ the read ═══════════════════════════

function modelOverride(acc, task) {
  try {
    const j = cloud.readAcctDoc(acc, 'models', null);
    const m = j?.tasks?.[task];
    return typeof m === 'string' && m ? m : null;
  } catch { return null; }
}

export async function eyeRead(inv, args = {}) {
  const imagePath = String(args.imagePath || '');
  const bytes = imagePath ? await readVisionImage(inv.id, imagePath) : null;
  if (!bytes) return { ok: false, reason: 'no_image', message: 'No readable image at that path.' };

  const model = String(args.model || modelOverride(inv.id, 'eye-read') || DEFAULT_MODEL);
  const provider = providerFor(model);
  const started = Date.now();

  let imageHash = '';
  try { imageHash = crypto.createHash('sha256').update(Buffer.from(bytes.data, 'base64')).digest('hex').slice(0, 32); } catch { /* non-fatal */ }

  const ask = () => runLlmJson(inv, {
    provider, model,
    system: EYE_READ_SYS,
    prompt: eyeReadUser(args.note),
    imagePaths: [imagePath],
    maxTokens: 2400,
    jsonMode: true,
  });

  // Malformed JSON here is INTERMITTENT, not deterministic - measured at ~17%
  // before jsonMode, and the identical request parsed cleanly on retry. One
  // retry converts a visible failure into a read; two would just cost the owner
  // his time while he waits on a single frame.
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ask();
    if (!r.ok) return { ok: false, reason: r.reason || 'llm_failed', message: r.message || 'The eye could not look.', model };
    try {
      const { read, thin } = validateRead(sliceJson(r.text || ''));
      return { ok: true, read, thin, model, imageHash, ms: Date.now() - started, retried: attempt > 0 };
    } catch (e) {
      lastErr = String(e?.message || e).slice(0, 200);
    }
  }
  return { ok: false, reason: 'parse_failed', message: lastErr, model };
}

// ═══════════════════════════ the golden set ═══════════════════════════
// Anwar's graded reads: BOTH the few-shot corpus for a later EYE_READ_SYS and
// the regression suite - a correction is never just a correction, it is the
// next version's evidence. Append-only, exactly like eye_golden.jsonl.

const GOLDEN_KEY = 'eye-golden';

export function eyeGoldenWrite(inv, entry) {
  if (!entry || typeof entry !== 'object' || !entry.read) {
    return { ok: false, reason: 'bad_args', message: 'Nothing to sign.' };
  }
  const row = {
    ts: new Date().toISOString(),
    imagePath: String(entry.imagePath ?? ''),
    imageHash: String(entry.imageHash ?? ''),
    model: String(entry.model ?? ''),
    read: entry.read,
    axisGrades: entry.axisGrades && typeof entry.axisGrades === 'object' ? entry.axisGrades : {},
    corrections: entry.corrections && typeof entry.corrections === 'object' ? entry.corrections : {},
    signedBy: String(entry.signedBy || 'anwar'),
  };
  try {
    const cur = cloud.readAcctDoc(inv.id, GOLDEN_KEY, null);
    const entries = (cur && Array.isArray(cur.entries)) ? cur.entries : [];
    entries.push(row);
    cloud.writeAcctDoc(inv.id, GOLDEN_KEY, { entries });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'write_failed', message: String(e?.message || e).slice(0, 200) };
  }
}

export function eyeStatus(inv) {
  let golden = 0, gradedAxes = 0;
  try {
    const cur = cloud.readAcctDoc(inv.id, GOLDEN_KEY, null);
    for (const e of (cur?.entries || [])) {
      golden++;
      gradedAxes += Object.keys(e?.axisGrades ?? {}).length;
    }
  } catch { /* nothing signed yet - zero is the honest answer */ }
  return { ok: true, root: 'cloud://eye', golden, gradedAxes };
}
