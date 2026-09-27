// eye.ts — MAIN-side Eye engine. THE recipe, server-side.
//
// House law (recipe stays server-side): EYE_READ_SYS — the whole read — lives
// HERE, in the Electron MAIN process. The renderer sends an image path and gets
// back a finished EyeRead. It never sees the prompt, the validation, or the
// axis discipline. `grep -r EYE_READ_SYS app/src/` must return nothing.
//
// WHY THIS EXISTS. The old eye ranked corpus frames on three metadata fields,
// two of which are near-constants across the library (shotAngle is 'eye' in 82%
// of usable frames, lightState is 'interior-practical' in 57%). It lost 8 of 20
// blind rounds to a fixed baseline. The failure was never the judge — it was
// that nothing had ever WRITTEN what each frame is, so selection ran over an
// index with no semantics in it. READ is the fix, and its output is what the
// index becomes.
//
// DELIBERATELY NOT few-shot yet. The golden set accumulates here from Phase 0,
// but it is NOT injected into the prompt until Phase 5 — because the Phase 0
// gate has to measure the naked prompt. Inject examples now and the lift that
// Phase 5 is supposed to prove becomes unmeasurable.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electron = require('electron');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require('node:crypto');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('node:child_process');

const { ipcMain, nativeImage } = electron as typeof import('electron');

// ── injected MAIN dependencies (kept out of an import cycle with main.ts) ────
export interface EyeCtx {
  runLlmJson: (args: {
    provider: string; model: string; system: string; prompt: string;
    maxTokens?: number; imagePaths?: string[]; audioPaths?: string[];
    /** Constrain the vendor to valid JSON rather than merely asking for it. */
    jsonMode?: boolean;
  }) => Promise<{ ok: boolean; text?: string; truncated?: boolean; model?: string; reason?: string; message?: string }>;
  /** The Eye's writable library root — 02_PRODUCT/eye/ in dev, userData when packaged. */
  eyeRoot: () => string;
  taskModelOverride: (task: string) => string | null;
}

// Must match TASKS['eye-read'].defaultModel in src/lib/models/registry.ts — this
// is only the floor for when no override and no renderer resolution reached us.
// Probed live 2026-07-31: gemini-2.5-pro now 404s ("no longer available to new
// users") even though the /models listing still advertises it. Never trust the
// listing alone; make the call.
const DEFAULT_MODEL = 'gemini-3.6-flash';

/** Model id → its vendor. The registry owns this mapping renderer-side; MAIN
 *  needs its own because it resolves the override itself (same as caApply). */
function providerFor(model: string): string {
  if (model.startsWith('claude')) return 'anthropic';
  if (model.startsWith('gemini')) return 'google';
  return 'openai';
}

// Frameset saves stills as AVIF, which the OpenAI vision API rejects. Convert
// anything the vision APIs won't take into a PNG they will. (Same helper as
// contextAgents.ts — duplicated rather than shared because these two engines
// must stay independently registerable.)
function vlmReadablePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp' || ext === '.gif') return filePath;
  const png = filePath.replace(/\.[^.]+$/, '') + '.eye.png';
  try { if (fs.existsSync(png) && fs.statSync(png).size > 0) return png; } catch { /* re-make */ }
  try {
    const img = nativeImage.createFromPath(filePath);
    if (!img.isEmpty()) { fs.writeFileSync(png, img.toPNG()); if (fs.statSync(png).size > 0) return png; }
  } catch { /* fall through */ }
  try {
    childProcess.execFileSync('sips', ['-s', 'format', 'png', filePath, '--out', png], { stdio: 'ignore' });
    if (fs.existsSync(png) && fs.statSync(png).size > 0) return png;
  } catch { /* give up — the VLM will report the error honestly */ }
  return filePath;
}

// ═══════════════════════════ THE RECIPE ═══════════════════════════
// Ten axes in three layers plus the search key. Layers 1–2 are what any
// captioner produces. Layer 3 is the eye — and the refusals in it are what stop
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

function eyeReadUser(note: string): string {
  const n = (note || '').trim();
  return n
    ? `Read this frame. Context the owner supplied (use it to sharpen the read, never to override what is actually in the pixels): ${n}`
    : 'Read this frame.';
}

// ═══════════════════════════ parse + validate ═══════════════════════════

const REGISTERS = ['longing', 'resolve', 'joy', 'desolation', 'turbulence', 'groundedness'];
const ENERGIES = ['quiet', 'mid', 'loud'];
/** Answers that mean "I did not look." Layer-3 axes returning one of these is a
 *  FAILED read, not a partial one — surfaced as `thin` so the gate counts it. */
const EVASIONS = /^(n\/?a|none|nothing|unknown|unclear|not applicable|-{1,3}|—)?$/i;

const str = (v: any): string => (typeof v === 'string' ? v.trim() : '');
const oneOf = (v: any, allowed: string[], fallback: string): string => {
  const s = str(v).toLowerCase();
  return allowed.includes(s) ? s : fallback;
};

/** Slice the first {...} out of the reply — models wrap JSON in fences even when
 *  told not to. Same lenient parse the rest of the house uses. */
function sliceJson(text: string): any {
  const t = (text || '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  return JSON.parse(s >= 0 ? t.slice(s, e + 1) : t);
}

export interface ValidatedRead { read: any; thin: string[] }

/** Coerce the model's reply into the EyeRead shape and report which axes came
 *  back empty or evasive. We do NOT silently repair layer 3 — an invented
 *  refusal would be worse than a missing one, because it would look like signal. */
function validateRead(raw: any): ValidatedRead {
  const thin: string[] = [];
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

  // Layer 1 + 2 — empty is thin.
  for (const k of ['subject', 'place', 'action', 'medium', 'time'] as const) if (!read[k]) thin.push(k);
  if (!read.objects.length) thin.push('objects');
  if (!read.light.key || !read.light.fill) thin.push('light');
  if (!read.lens.depth) thin.push('lens');
  if (!read.colour.behaviour) thin.push('colour');
  // Layer 3 + the key — empty OR evasive is thin. This is the gate's real signal.
  for (const k of ['inside', 'craftMove', 'culturalTruth', 'refusal'] as const) {
    if (!read[k] || EVASIONS.test(read[k])) thin.push(k);
  }
  const words = read.searchPhrase ? read.searchPhrase.split(/\s+/).length : 0;
  if (words < 4 || words > 12) thin.push('searchPhrase');
  // The Arabic key is thin if absent OR if it came back in Latin letters —
  // a transliteration is useless to an Arabic query.
  const wordsAr = read.searchPhraseAr ? read.searchPhraseAr.split(/\s+/).length : 0;
  if (wordsAr < 4 || wordsAr > 12 || !/[\u0600-\u06FF]/.test(read.searchPhraseAr)) thin.push('searchPhraseAr');
  if (read.tags.length < 6) thin.push('tags');

  return { read, thin };
}

// ═══════════════════════════ the read ═══════════════════════════

async function eyeRead(ctx: EyeCtx, args: { imagePath: string; note?: string; model?: string }): Promise<any> {
  const imagePath = String(args?.imagePath ?? '');
  if (!imagePath || !fs.existsSync(imagePath)) {
    return { ok: false, reason: 'no_image', message: 'No readable image at that path.' };
  }
  const model = String(args?.model || ctx.taskModelOverride('eye-read') || DEFAULT_MODEL);
  const provider = providerFor(model);
  const started = Date.now();

  let imageHash = '';
  try { imageHash = crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex').slice(0, 32); } catch { /* non-fatal */ }

  const vlmPath = vlmReadablePath(imagePath);
  const ask = () => ctx.runLlmJson({
    provider, model,
    system: EYE_READ_SYS,
    prompt: eyeReadUser(String(args?.note ?? '')),
    imagePaths: [vlmPath],
    maxTokens: 2400,
    jsonMode: true,
  });

  // Malformed JSON here is INTERMITTENT, not deterministic — measured at ~17%
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
    } catch (e: any) {
      lastErr = String(e?.message || e).slice(0, 200);
    }
  }
  return { ok: false, reason: 'parse_failed', message: lastErr, model };
}

// ═══════════════════════════ the golden set ═══════════════════════════
// Anwar's graded reads. This file is BOTH the few-shot corpus for a later
// EYE_READ_SYS and the regression suite — a correction is never just a
// correction, it is the next version's evidence.

function goldenPath(root: string): string { return path.join(root, 'eye_golden.jsonl'); }

function eyeGoldenWrite(root: string, entry: any): { ok: boolean; reason?: string; message?: string } {
  if (!entry || typeof entry !== 'object' || !entry.read) {
    return { ok: false, reason: 'bad_args', message: 'Nothing to sign.' };
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    imagePath: String(entry.imagePath ?? ''),
    imageHash: String(entry.imageHash ?? ''),
    model: String(entry.model ?? ''),
    read: entry.read,
    axisGrades: entry.axisGrades && typeof entry.axisGrades === 'object' ? entry.axisGrades : {},
    corrections: entry.corrections && typeof entry.corrections === 'object' ? entry.corrections : {},
    signedBy: String(entry.signedBy || 'anwar'),
  });
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(goldenPath(root), line + '\n', 'utf8');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: 'write_failed', message: String(e?.message || e).slice(0, 200) };
  }
}

function eyeStatus(root: string): any {
  let golden = 0, gradedAxes = 0;
  try {
    const raw = fs.readFileSync(goldenPath(root), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim(); if (!t) continue;
      golden++;
      try { gradedAxes += Object.keys(JSON.parse(t)?.axisGrades ?? {}).length; } catch { /* skip bad line */ }
    }
  } catch { /* no file yet — zero is the honest answer */ }
  return { ok: true, root, golden, gradedAxes };
}

// ═══════════════════════════ IPC registration ═══════════════════════════

export function registerEye(ctx: EyeCtx): void {
  const root = () => ctx.eyeRoot();

  ipcMain.handle('hjen:eye-read', (_e: any, args: any) => eyeRead(ctx, args || {}));
  ipcMain.handle('hjen:eye-golden-write', (_e: any, args: any) => eyeGoldenWrite(root(), args?.entry));
  ipcMain.handle('hjen:eye-status', () => eyeStatus(root()));
}
