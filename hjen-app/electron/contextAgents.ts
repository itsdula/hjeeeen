// contextAgents.ts — MAIN-side Context-Agents engine (THE recipe, server-side).
//
// House law (recipe stays server-side): method selection, the retrieval
// thresholds, the block-builders, and the three system prompts live HERE, in
// the Electron MAIN process. The renderer is a dumb terminal: it sends the
// small {register,beat,energy,goal} state and receives the chosen method IDs +
// the three finished texts — it never sees selectMethods, the scores, the
// prompt text, or the lexicon.
//
// The engine is a faithful port of the lab tool (STUDY/context_agents/):
//   - retrieve.mjs  → selectMethods / failsAny (VERBATIM)
//   - state.mjs     → REGISTERS/BEATS/ENERGIES / matchesPredicate / specificity (VERBATIM)
//   - apply.mjs     → the three block-builders + the three Arabic system prompts (VERBATIM)
//
// ONE INTENDED DIVERGENCE from apply.mjs: apply.mjs retrieved methods with an
// inline `top-6 confirmed-first by weight` slice. The approved retrieval is
// selectMethods (drops when_it_fails matches, condition-first / weight-last,
// winner-take-most per craft — the anti-mean rule). We adopt selectMethods and
// then keep a top-6 cap AFTER it (slice(0,6)) so the output size matches
// apply.mjs. Everything else (blocks, prompts) is byte-identical to apply.mjs.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electron = require('electron');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require('node:os');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('node:child_process');

const { ipcMain, nativeImage } = electron as typeof import('electron');

// Frameset saves stills as AVIF, which the OpenAI vision API rejects
// ("unsupported image"). Convert any non-JPEG/PNG/WEBP frame to a PNG the VLM can
// read: Electron's nativeImage (Chromium) decodes AVIF in-process; macOS `sips`
// is the fallback. Returns a path the VLM accepts (the original if already fine,
// or a cached PNG next to it). Cached so repeat looks don't re-convert.
function vlmReadablePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp' || ext === '.gif') return filePath;
  const png = filePath.replace(/\.[^.]+$/, '') + '.eye.png';
  try { if (fs.existsSync(png) && fs.statSync(png).size > 0) return png; } catch { /* re-make */ }
  // 1) in-process, portable: Chromium decodes AVIF
  try {
    const img = nativeImage.createFromPath(filePath);
    if (!img.isEmpty()) { fs.writeFileSync(png, img.toPNG()); if (fs.statSync(png).size > 0) return png; }
  } catch { /* fall through */ }
  // 2) macOS fallback
  try {
    childProcess.execFileSync('sips', ['-s', 'format', 'png', filePath, '--out', png], { stdio: 'ignore' });
    if (fs.existsSync(png) && fs.statSync(png).size > 0) return png;
  } catch { /* give up — VLM will report the error honestly */ }
  return filePath;
}

// ── injected MAIN dependencies (kept out of an import cycle with main.ts) ─────
// main.ts is a side-effect module (importing it re-registers everything), so we
// take its shared helpers by injection instead of importing them.
export interface ContextAgentsCtx {
  getWindow: () => any;
  runLlmJson: (args: {
    provider: string; model: string; system: string; prompt: string;
    maxTokens?: number; imagePaths?: string[]; audioPaths?: string[];
  }) => Promise<{ ok: boolean; text?: string; truncated?: boolean; model?: string; reason?: string; message?: string }>;
  contextAgentsRoot: () => string;
  /** The offline REF corpus root (index/hjen_ref_index.json + frames/). The Eye
   *  reads real frames from here; injected by main.ts (hjenRefCorpusRoot). */
  refCorpusRoot: () => string;
  taskModelOverride: (task: string) => string | null;
}

// ═══════════════════════════ state vocabulary ═══════════════════════════
// PORTED VERBATIM from lib/state.mjs — the UNIVERSAL, DNA-agnostic vocabulary.
// A card's condition_of_use and an incoming request are BOTH expressed here.

export const REGISTERS = ['longing', 'resolve', 'joy', 'desolation', 'turbulence', 'groundedness'];
export const BEATS = ['setup', 'desire', 'conflict', 'change', 'result'];
export const ENERGIES = ['quiet', 'mid', 'loud'];

export interface CAState { register: string; beat: string; energy: string }
export interface CAPredicate { register?: string[]; beat?: string[]; energy?: string[] }

/**
 * A predicate is { register?: string[], beat?: string[], energy?: string[] }.
 * It MATCHES a state when every axis present (and non-empty) contains the
 * state's value for that axis. An omitted or empty axis is a wildcard.
 */
export function matchesPredicate(state: CAState, predicate: CAPredicate | null | undefined): boolean {
  if (!predicate) return false;
  const axes = Object.keys(predicate);
  if (axes.length === 0) return false;
  let sawAxis = false;
  for (const axis of axes) {
    const allowed = (predicate as any)[axis];
    if (!Array.isArray(allowed) || allowed.length === 0) continue; // wildcard
    sawAxis = true;
    if (!allowed.includes((state as any)[axis])) return false;
  }
  return sawAxis; // an all-wildcard predicate does not match (avoids firing on everything)
}

/** How many axes a predicate pins — the strength of its fit. */
export function specificity(predicate: CAPredicate | null | undefined): number {
  if (!predicate) return 0;
  return Object.values(predicate).filter(v => Array.isArray(v) && v.length > 0).length;
}

// ═══════════════════════════ method selection ═══════════════════════════
// PORTED VERBATIM from lib/retrieve.mjs — condition FIRST, weight LAST.

export interface CACard {
  id: string;
  craft: string;
  principle: string;
  when_it_works?: CAPredicate;
  when_it_fails?: CAPredicate | CAPredicate[];
  effect: string;
  evidence?: string[];
  weight?: number;
  status?: string;
  source?: string;
}

// when_it_fails may be a single predicate OR an array of predicates.
// OR-semantics: the card is dropped if ANY predicate matches the state.
// (A single predicate keeps AND-semantics across its own axes.)
function failsAny(state: CAState, fails: CAPredicate | CAPredicate[] | undefined): boolean {
  if (!fails) return false;
  const list = Array.isArray(fails) ? fails : [fails];
  return list.some(p => matchesPredicate(state, p));
}

export function selectMethods(methods: CACard[], state: CAState, { perCraft = 1 }: { perCraft?: number } = {}): CACard[] {
  const scored: Array<{ card: CACard; score: number }> = [];
  for (const card of methods) {
    if (failsAny(state, card.when_it_fails)) continue;           // DROP
    if (!matchesPredicate(state, card.when_it_works)) continue;  // off-state
    const fit = 1000 + 100 * specificity(card.when_it_works);
    scored.push({ card, score: fit + (card.weight || 1) });
  }
  scored.sort((a, b) => b.score - a.score);

  const takenByCraft = new Map<string, number>();
  const selected: CACard[] = [];
  for (const { card } of scored) {
    const taken = takenByCraft.get(card.craft) || 0;
    if (taken >= perCraft) continue;
    takenByCraft.set(card.craft, taken + 1);
    selected.push(card);
  }
  return selected;
}

// ═══════════════════════════ file loaders ═══════════════════════════════
// Method cards and DNA profiles are DATA (JSON files), not code — a new profile
// is a file, never a build. The library is read live on every call so the
// Trainer's edits take effect on the next caApply with no restart.

export interface CAProfile {
  id: string;
  name?: string;
  palette?: string;
  light_logic?: string;
  lens?: string;
  texture?: string;
  world?: string;
  forbidden?: string[];
  [k: string]: unknown;
}

export interface CALexiconEntry {
  expression: string;
  meaning: string;
  register?: string;
  usage: string;
  example?: string;
  confidence?: string;
  verify?: string;
  verify_why?: string;
  status?: string;
  seen_in?: string[];
  [k: string]: unknown;
}

function methodsDir(root: string): string { return path.join(root, 'methods'); }
function profilesDir(root: string): string { return path.join(root, 'profiles'); }
function lexiconPath(root: string): string { return path.join(root, 'lexicon.json'); }

function loadMethods(root: string): CACard[] {
  const dir = methodsDir(root);
  try {
    return fs.readdirSync(dir)
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
      .filter(Boolean) as CACard[];
  } catch { return []; }
}

function loadProfile(root: string, id: string): CAProfile | null {
  try { return JSON.parse(fs.readFileSync(path.join(profilesDir(root), `${id}.json`), 'utf8')); }
  catch { return null; }
}

function loadProfiles(root: string): CAProfile[] {
  const dir = profilesDir(root);
  try {
    return fs.readdirSync(dir)
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
      .filter(Boolean) as CAProfile[];
  } catch { return []; }
}

function loadLexiconAll(root: string): CALexiconEntry[] {
  const p = lexiconPath(root);
  try { const arr = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}

function loadLexiconTrusted(root: string): CALexiconEntry[] {
  return loadLexiconAll(root).filter(e => e.status === 'trusted');
}

// ═══════════════════════════ block-builders ═════════════════════════════
// PORTED VERBATIM from apply.mjs (lines 47-49).

const confirmed = (c: CACard): boolean => (c.evidence || []).some(e => /CONFIRMED/i.test(e));

function methodBlock(cards: CACard[]): string {
  return cards.map(c => `- [${c.craft}${confirmed(c) ? '·confirmed' : ''}] ${c.principle}\n  DO: ${c.effect}`).join('\n');
}

function dnaBlock(profile: CAProfile): string {
  return `palette:${profile.palette} · light:${profile.light_logic} · lens:${profile.lens} · texture:${profile.texture} · forbidden:${(profile.forbidden || []).join(', ')}`;
}

function lexBlock(lex: CALexiconEntry[]): string {
  return lex.map(e => `- «${e.expression}» — ${e.meaning} | usage: ${e.usage}`).join('\n');
}

// ═══════════════════════════ the three prompts ══════════════════════════
// PORTED VERBATIM from apply.mjs (lines 58-70).

const SYS_USE1 = 'أنت استراتيجي مبدع. اقرأ الهدف الحقيقي خلف الإعلان في ٣ أسطر: النية · معيار النجاح · لمن. مختصر.';

function sysUse2(methodsText: string, dnaText: string): string {
  return `أنت مخرج. طوّر/أعد تجسيد هذا الإعلان مستعملاً هذه الطرق المتراكمة، بهذا اللوك. ٥–٧ أسطر، ملموس وقابل للتصوير، لا شعارات.\n\nالطرق:\n${methodsText}\n\nاللوك (DNA):\n${dnaText}`;
}

function sysUse3(lexText: string): string {
  return `أنت كاتب إعلانات سعودي. اكتب ٤ سطور إعلانية أجمل لهذا الإعلان، بالسجل السعودي الأصيل، مستعملاً هذه العبارات الموثوقة من القاموس في مواضعها الصحيحة (لا تخترع لهجة):\n${lexText || '(لا قاموس)'}\n`;
}

// ═══════════════════════════ caApply — the payoff ═══════════════════════
// Resolve the model MAIN-side (override → gpt-5.1/openai), run the three
// sequential LLM calls (like apply.mjs), and return the same shape apply.mjs's
// --json emits, plus a profile {id,name} and lexicon count for the UI.

export interface CAApplyResult {
  ok: boolean;
  reason?: string;
  message?: string;
  state?: CAState;
  methods?: Array<{ id: string; craft: string; confirmed: boolean }>;
  profile?: { id: string; name: string };
  lexiconCount?: number;
  use1?: string;
  use2?: string;
  use3?: string;
}

async function caApply(ctx: ContextAgentsCtx, args: {
  profileId: string; register: string; beat: string; energy: string; goal: string;
}): Promise<CAApplyResult> {
  const root = ctx.contextAgentsRoot();
  const register = String(args?.register ?? '').trim();
  const beat = String(args?.beat ?? '').trim();
  const energy = String(args?.energy ?? '').trim();
  const goal = String(args?.goal ?? '').trim();
  const profileId = String(args?.profileId ?? '').trim();
  if (!profileId || !register || !goal) {
    return { ok: false, reason: 'bad_args', message: 'profileId, register and goal are required.' };
  }
  const profile = loadProfile(root, profileId);
  if (!profile) return { ok: false, reason: 'no_profile', message: `Profile "${profileId}" not found.` };

  const state: CAState = { register, beat, energy };

  // Approved retrieval (selectMethods), then top-6 cap so output size matches
  // apply.mjs. THIS is the one intended divergence documented at the top.
  const cards = selectMethods(loadMethods(root), state, { perCraft: 1 }).slice(0, 6);
  const lex = loadLexiconTrusted(root);

  const mBlock = methodBlock(cards);
  const dBlock = dnaBlock(profile);
  const lBlock = lexBlock(lex);

  // Resolve the model like every other routed task: the Models dashboard
  // override wins, else the task default. Context-Agents is an OpenAI task.
  const model = ctx.taskModelOverride('context-agents') || 'gpt-5.1';
  const provider = 'openai';

  const call = async (system: string, prompt: string): Promise<string> => {
    const r = await ctx.runLlmJson({ provider, model, system, prompt, maxTokens: 2048 });
    if (!r.ok) throw new Error(r.message || r.reason || 'llm_failed');
    return (r.text || '').trim();
  };

  try {
    // Sequential, mirroring apply.mjs's await-in-order.
    const use1 = await call(SYS_USE1, `الإعلان: ${goal}`);
    const use2 = await call(sysUse2(mBlock, dBlock), `الهدف/الإعلان: ${goal}`);
    const use3 = await call(sysUse3(lBlock), `الهدف/الإعلان: ${goal}`);
    return {
      ok: true,
      state,
      methods: cards.map(c => ({ id: c.id, craft: c.craft, confirmed: confirmed(c) })),
      profile: { id: profile.id, name: String(profile.name || profile.id) },
      lexiconCount: lex.length,
      use1, use2, use3,
    };
  } catch (e: any) {
    return { ok: false, reason: 'llm_failed', message: String(e?.message || e).slice(0, 300) };
  }
}

// ═══════════════════════════ card CRUD (Trainer) ═════════════════════════

/** slug-sanitize a card id so a Trainer write can never escape methods/. */
function slugId(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || ('card-' + Date.now().toString(36));
}

/** A predicate's axes must be ⊆ the closed vocabulary, and each value legal. */
function validPredicate(pred: any, label: string): { ok: true } | { ok: false; message: string } {
  if (pred == null) return { ok: true };
  if (typeof pred !== 'object' || Array.isArray(pred)) return { ok: false, message: `${label} must be an object.` };
  const allowed: Record<string, string[]> = { register: REGISTERS, beat: BEATS, energy: ENERGIES };
  for (const axis of Object.keys(pred)) {
    if (!(axis in allowed)) return { ok: false, message: `${label}: unknown axis "${axis}".` };
    const vals = pred[axis];
    if (vals == null) continue;
    if (!Array.isArray(vals)) return { ok: false, message: `${label}.${axis} must be an array.` };
    for (const v of vals) {
      if (!allowed[axis].includes(v)) return { ok: false, message: `${label}.${axis}: "${v}" is not a valid ${axis}.` };
    }
  }
  return { ok: true };
}

/** Atomic write: tmp file in the same dir, then rename over the target, so a
 *  concurrent caListMethods never reads a half-written card. */
function atomicWriteJson(target: string, data: unknown): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

function caReadCard(root: string, id: string): { ok: boolean; card?: CACard; reason?: string; message?: string } {
  const safe = slugId(id);
  const p = path.join(methodsDir(root), `${safe}.json`);
  try { return { ok: true, card: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
  catch { return { ok: false, reason: 'not_found', message: `Card "${id}" not found.` }; }
}

function caWriteCard(root: string, card: CACard): { ok: boolean; id?: string; card?: CACard; reason?: string; message?: string } {
  if (!card || typeof card !== 'object') return { ok: false, reason: 'bad_card', message: 'Card payload is missing.' };
  if (!card.craft || !String(card.craft).trim()) return { ok: false, reason: 'bad_card', message: 'craft is required.' };
  if (!card.principle || !String(card.principle).trim()) return { ok: false, reason: 'bad_card', message: 'principle is required.' };
  if (!card.effect || !String(card.effect).trim()) return { ok: false, reason: 'bad_card', message: 'effect is required.' };
  const w = validPredicate(card.when_it_works, 'when_it_works');
  if (!w.ok) return { ok: false, reason: 'bad_predicate', message: w.message };
  // when_it_fails may be a single predicate OR an array of predicates.
  if (card.when_it_fails != null) {
    const list = Array.isArray(card.when_it_fails) ? card.when_it_fails : [card.when_it_fails];
    for (const p of list) {
      const f = validPredicate(p, 'when_it_fails');
      if (!f.ok) return { ok: false, reason: 'bad_predicate', message: f.message };
    }
  }
  const id = slugId(card.id || card.craft);
  const toWrite: CACard = { ...card, id };
  try {
    atomicWriteJson(path.join(methodsDir(root), `${id}.json`), toWrite);
    return { ok: true, id, card: toWrite };
  } catch (e: any) {
    return { ok: false, reason: 'write_failed', message: String(e?.message || e).slice(0, 200) };
  }
}

function caDeleteCard(root: string, id: string): { ok: boolean; reason?: string; message?: string } {
  const safe = slugId(id);
  const p = path.join(methodsDir(root), `${safe}.json`);
  try { if (fs.existsSync(p)) fs.unlinkSync(p); return { ok: true }; }
  catch (e: any) { return { ok: false, reason: 'delete_failed', message: String(e?.message || e).slice(0, 200) }; }
}

function caWriteLexiconEntry(root: string, entry: CALexiconEntry): { ok: boolean; count?: number; reason?: string; message?: string } {
  if (!entry || !entry.expression || !String(entry.expression).trim()) {
    return { ok: false, reason: 'bad_entry', message: 'expression is required.' };
  }
  const all = loadLexiconAll(root);
  const idx = all.findIndex(e => e.expression === entry.expression);
  if (idx >= 0) all[idx] = { ...all[idx], ...entry };
  else all.push(entry);
  try { atomicWriteJson(lexiconPath(root), all); return { ok: true, count: all.length }; }
  catch (e: any) { return { ok: false, reason: 'write_failed', message: String(e?.message || e).slice(0, 200) }; }
}

// ═══════════════════════════ caStudy — the lab pipeline ══════════════════
// Spawn STUDY/context_agents/pipeline.mjs on Electron's bundled node (via
// ELECTRON_RUN_AS_NODE) against the shared library root, stream stdout to the
// window, and on close re-read methods to report what was merged. Heavy deps
// (yt-dlp / ffmpeg / whisper / a `node` on PATH for the inner sub-scripts) live
// in the script — if they're missing the study fails honestly with stderr.

/** Resolve pipeline.mjs — the TRAINING script, which is a developer tool, not a
 *  shipped feature. It used to end at a hardcoded path on the author's own disk,
 *  which resolves to nothing on any other Mac; now the absence is reported
 *  honestly by the caller instead of spawning a file that isn't there. */
function pipelineScript(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'context_agents_pipeline', 'pipeline.mjs'),
    path.join(__dirname, '..', '..', 'STUDY', 'context_agents', 'pipeline.mjs'),
    path.join(__dirname, '..', '..', '..', 'STUDY', 'context_agents', 'pipeline.mjs'),
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* next */ } }
  return null;
}

async function caStudy(ctx: ContextAgentsCtx, args: {
  adId: string; profileId: string; videoPathOrUrl?: string; description?: string; lang?: string;
}): Promise<{ ok: boolean; report?: string; newCards?: string[]; profileId?: string; reason?: string; message?: string }> {
  const root = ctx.contextAgentsRoot();
  const adId = String(args?.adId ?? '').trim();
  const profileId = String(args?.profileId ?? '').trim();
  const src = String(args?.videoPathOrUrl ?? '').trim();
  const lang = String(args?.lang ?? 'ar').trim() || 'ar';
  if (!adId || !profileId || !src) {
    return { ok: false, reason: 'bad_args', message: 'adId, profileId and videoPathOrUrl are required.' };
  }
  const script = pipelineScript();
  if (!script) {
    return { ok: false, reason: 'no_script', message:
      'Training the library is a developer tool and is not part of this build — pipeline.mjs ships only with the source checkout.' };
  }

  // Snapshot the card ids before the run so we can diff what the merge added.
  const before = new Set(loadMethods(root).map(c => c.id));

  const send = (line: string) => {
    try { ctx.getWindow()?.webContents.send('hjen:ca-study-progress', { adId, profileId, line }); } catch { /* window gone */ }
  };

  const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = childProcess.spawn(
      process.execPath, [script, adId, profileId, src, lang],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HJEN_CONTEXT_AGENTS: root },
        cwd: os.tmpdir(),
      },
    );
    let stdout = '', stderr = '';
    // 20-minute ceiling — download + ASR + VLM can be slow, but never forever.
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 20 * 60 * 1000);
    child.stdout.on('data', (d: Buffer) => { const s = d.toString(); stdout += s; s.split('\n').forEach((l: string) => { if (l.trim()) send(l); }); });
    child.stderr.on('data', (d: Buffer) => { const s = d.toString(); stderr += s; s.split('\n').forEach((l: string) => { if (l.trim()) send(l); }); });
    child.on('error', (e: any) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e?.message || e) }); });
    child.on('close', (code: number) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });

  if (result.code !== 0) {
    return { ok: false, reason: 'study_failed', message: (result.stderr || result.stdout || `pipeline exited ${result.code}`).slice(-600) };
  }
  // Re-read live so any cards the study wrote are reflected immediately.
  const after = loadMethods(root).map(c => c.id);
  const newCards = after.filter(id => !before.has(id));
  return { ok: true, report: result.stdout.slice(-4000), newCards, profileId };
}

// ═══════════════════════════ Context Eye — the EYE ══════════════════════════
// The engine's value is an EYE that picks the right REAL reference frame for an
// emotional state from the offline corpus — NOT generation. Two stages, both
// MAIN-side (the recipe never crosses IPC):
//   1. metadata prefilter — scoreFrame/pickForState rank corpus frames by the
//      distilled per-register criteria (shot/angle/light/palette weights);
//   2. pixel confirm — a VLM READS THE PIXELS of the top candidates and re-ranks,
//      because "night+high+dark-blue" metadata can hide the wrong feeling.
// naivePick is the dumb keyword baseline the owner judges the eye against.
//
// PORTED VERBATIM from STUDY/context_agents/eye/{pick.mjs,confirm.mjs}: scoreFrame,
// pickForState, naivePick, and the pixelFit system + user prompt. The only change
// is threading corpusRoot (instead of a module CORPUS const) so it resolves the
// same absolute frame path the renderer loads via hjen-file://.

export interface CorpusFrame {
  id: string; ad: string; file: string;
  brand?: string; place?: string; palette?: string[];
  shotSize?: string; shotAngle?: string; lightState?: string;
  q?: number; analyzed?: boolean; blob?: string;
}
export type EyeCriteria = Record<string, {
  _n?: number;
  shotSize?: Record<string, number>;
  shotAngle?: Record<string, number>;
  lightState?: Record<string, number>;
  palette?: Record<string, number>;
}>;

const EYE_FIELDS = ['shotSize', 'shotAngle', 'lightState'] as const;

/** loadFrames() (pick.mjs) — read the corpus index and keep analyzed, q≥2, shot-sized. */
function loadCorpusFrames(corpusRoot: string): CorpusFrame[] {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(corpusRoot, 'index', 'hjen_ref_index.json'), 'utf8'));
    const records = Array.isArray(idx?.records) ? idx.records : [];
    return records.filter((r: any) => r && r.analyzed && (r.q || 0) >= 2 && r.shotSize);
  } catch { return []; }
}

/** The distilled per-register criteria (eye_criteria.json), written at the
 *  context-agents library root by the lab distiller — not in the corpus. */
function loadEyeCriteria(caRoot: string): EyeCriteria {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(caRoot, 'eye_criteria.json'), 'utf8'));
    return (o && typeof o === 'object') ? o : {};
  } catch { return {}; }
}

// scoreFrame — PORTED VERBATIM from pick.mjs. Sum of the register's learned
// field-value weights this frame hits; palette at half weight; q as a gentle tiebreak.
function scoreFrame(frame: CorpusFrame, register: string, criteria: EyeCriteria): { score: number; hits: string[] } {
  const c = criteria[register];
  if (!c || (c._n ?? 0) < 4) return { score: 0, hits: [] };
  let score = 0; const hits: string[] = [];
  for (const f of EYE_FIELDS) {
    const w = (c as any)[f]; if (!w) continue;
    const v = (frame as any)[f]; if (v && w[v] != null) { score += w[v]; hits.push(`${f}=${v}(+${w[v]})`); }
  }
  if (c.palette) for (const p of (frame.palette || [])) if (c.palette[p] != null) { score += c.palette[p] * 0.5; hits.push(`pal:${p}(+${(c.palette[p] * 0.5).toFixed(2)})`); }
  // gentle quality tiebreak so among equal-fit frames the better-analyzed wins
  score += (frame.q || 0) * 0.01;
  return { score, hits };
}

export interface EyePick { id: string; file: string; filePath: string; score: number; brand?: string; place?: string; why: string; }

// pickForState — PORTED VERBATIM from pick.mjs (one frame per ad for diversity),
// with corpusRoot threaded for the absolute filePath.
function pickForState(state: CAState, k: number, opts: { criteria: EyeCriteria; frames: CorpusFrame[]; corpusRoot: string }): EyePick[] {
  const { criteria, frames, corpusRoot } = opts;
  const reg = state.register;
  const scored = frames.map(fr => { const s = scoreFrame(fr, reg, criteria); return { fr, ...s }; })
    .sort((a, b) => b.score - a.score);
  const out: EyePick[] = []; const seenAd = new Set<string>();
  for (const s of scored) {
    if (out.length >= k) break;
    if (seenAd.has(s.fr.ad)) continue;
    seenAd.add(s.fr.ad);
    out.push({ id: s.fr.id, file: s.fr.file, filePath: path.join(corpusRoot, s.fr.file), score: Math.round(s.score * 100) / 100, brand: s.fr.brand, place: s.fr.place, why: s.hits.slice(0, 4).join(' ') });
  }
  return out;
}

export interface NaivePick { id: string; file: string; filePath: string; brand?: string; place?: string; }

// naivePick — PORTED VERBATIM from pick.mjs. The dumb keyword baseline: frames
// whose blob/palette literally contain the register word, else corpus order.
function naivePick(state: CAState, k: number, opts: { frames: CorpusFrame[]; corpusRoot: string }): NaivePick[] {
  const { frames, corpusRoot } = opts;
  const term = state.register;
  const hit = frames.filter(fr => (fr.blob || '').includes(term) || (fr.palette || []).some(p => p.includes(term)));
  const pool = hit.length >= k ? hit : frames; // if the word never appears, fall back to corpus order
  const out: NaivePick[] = []; const seenAd = new Set<string>();
  for (const fr of pool) {
    if (out.length >= k) break;
    if (seenAd.has(fr.ad)) continue;
    seenAd.add(fr.ad);
    out.push({ id: fr.id, file: fr.file, filePath: path.join(corpusRoot, fr.file), brand: fr.brand, place: fr.place });
  }
  return out;
}

// pixelFit prompt — PORTED VERBATIM from confirm.mjs. "Judge the pixels,
// metadata is not enough" — this instruction is the whole point of the eye.
const EYE_PIXELFIT_SYS = `You are a photo editor choosing a reference still for an ad. Score how well THIS image serves the target — its actual visual content, mood, light and composition — NOT its subject matter literally. Reply ONLY JSON: {"fit":0-5,"why":"few words"}. fit 5 = the feeling radiates from the frame; 0 = wrong feeling entirely (e.g. a comedy cartoon for a desolate mood). Be strict: metadata is not enough, judge the pixels.`;

function eyePixelUser(state: CAState, goal: string): string {
  return `TARGET feeling: register=${state.register}, beat=${state.beat}, energy=${state.energy}. Use: ${goal}`;
}

// Same lenient brace-slice parse confirm.mjs uses for the VLM reply.
function parseFit(text: string): { fit: number; why: string } {
  const t = (text || '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  try {
    const o = JSON.parse(s >= 0 ? t.slice(s, e + 1) : t);
    return { fit: Number(o?.fit) || 0, why: String(o?.why ?? '') };
  } catch { return { fit: 0, why: 'parse-fail' }; }
}

export interface EyeConfirmItem { id: string; filePath: string; fitScore: number; metaScore: number; brand?: string; place?: string; why: string; }

/** A ranking carries NO SIGNAL when every candidate scored the same — typically
 *  all 0, because the VLM errored on every call. The sort is then a stable no-op
 *  and the "eye" column silently becomes the input order, so the A/B compares a
 *  set with itself. That is exactly how the single line in eye_judgments.jsonl
 *  ended up with eyeIds identical to naiveIds. Surfaced so the ledger can refuse
 *  to record a self-comparison — an unfed loop is better than a poisoned one. */
function rankingIsDegenerate(items: EyeConfirmItem[]): boolean {
  if (items.length < 2) return true;
  return items.every(i => i.fitScore === items[0].fitScore);
}

// confirmPick (confirm.mjs) — metadata prefilter → VLM pixel-fit per frame → re-rank.
// runLlmJson takes imagePaths so the VLM reads the jpg by path (no base64 here).
async function eyeConfirm(
  ctx: ContextAgentsCtx, state: CAState, goal: string,
  prefilterK = 10, finalK = 4,
  pre?: { criteria: EyeCriteria; frames: CorpusFrame[] },
): Promise<EyeConfirmItem[]> {
  const corpusRoot = ctx.refCorpusRoot();
  const caRoot = ctx.contextAgentsRoot();
  const criteria = pre?.criteria ?? loadEyeCriteria(caRoot);
  const frames = pre?.frames ?? loadCorpusFrames(corpusRoot);
  const cand = pickForState(state, prefilterK, { criteria, frames, corpusRoot });

  // Resolve the model like caApply: the Models override wins, else the OpenAI task default.
  const model = ctx.taskModelOverride('context-agents') || 'gpt-5.1';
  const provider = 'openai';

  // The prefilter candidates are independent — score their pixels CONCURRENTLY.
  // (~5× faster than sequential; the owner runs this by hand many times.)
  const scored: EyeConfirmItem[] = await Promise.all(cand.map(async (c) => {
    let fit = 0; let why = 'err';
    try {
      const r = await ctx.runLlmJson({ provider, model, system: EYE_PIXELFIT_SYS, prompt: eyePixelUser(state, goal), imagePaths: [vlmReadablePath(c.filePath)], maxTokens: 200 });
      if (r.ok) { const v = parseFit(r.text || ''); fit = v.fit; why = v.why; }
      else { why = (r.message || r.reason || 'llm_failed').slice(0, 80); }
    } catch { why = 'err'; }
    return { id: c.id, filePath: c.filePath, fitScore: fit, metaScore: c.score, brand: c.brand, place: c.place, why };
  }));
  scored.sort((a, b) => (b.fitScore - a.fitScore) || (b.metaScore - a.metaScore));
  return scored.slice(0, finalK);
}

// ── Frameset path — the eye searches the VAST film-stills library, not just the
// thin local corpus (Anwar 2026-07-31). Frameset frames are PIXELS-ONLY (no
// metadata fields), so the eye can't prefilter by shotSize/palette there. Instead
// the DISTILLED CRITERIA become the SEARCH QUERY (the learned visual vocabulary of
// a feeling), Frameset returns real film stills, and the SAME VLM pixel-fit ranks
// them. The learning still matters — it makes the Frameset query smart.

// Build a Frameset search query. LESSON (Anwar 2026-07-31): the distilled criteria
// are COLOUR/shot words ("skin tone gold grey") — great for RANKING corpus frames
// by metadata, but as SEARCH terms in a semantic film library they pull literal
// matches (beauty close-ups) with NOTHING to do with the goal. Frameset searches
// by SCENE CONTENT, so the query must come from the GOAL's scene + the feeling.
// An LLM reads the goal (often Arabic) and returns a few English scene nouns +
// the emotional register — a real semantic query, not a colour list.
const EYE_QUERY_SYS = `You write a SHORT English image-search query for a cinematic film-stills library (Frameset). Read the ad brief (may be Arabic) and the target feeling, and output 4-7 English words naming WHAT WOULD BE IN THE FRAME — concrete scene/subject nouns (place, people, object, action) plus one or two mood words for the feeling. NO colour names, NO camera jargon, NO hashtags, NO punctuation. Reply ONLY JSON: {"query":"words"}. Example — brief "غبار الأشجار وقت الزراع والحصاد، بلدنا" feeling longing → {"query":"farmer dusty field harvest homeland nostalgic"}.`;

async function eyeQueryLLM(ctx: ContextAgentsCtx, state: CAState, goal: string, criteria: EyeCriteria): Promise<string> {
  const model = ctx.taskModelOverride('context-agents') || 'gpt-5.1';
  const g = (goal || '').trim();
  if (g) {
    try {
      const user = `Brief: ${g}\nTarget feeling: register=${state.register}, beat=${state.beat}, energy=${state.energy}.`;
      const r = await ctx.runLlmJson({ provider: 'openai', model, system: EYE_QUERY_SYS, prompt: user, maxTokens: 120 });
      if (r.ok && r.text) {
        const t = r.text.trim(); const s = t.indexOf('{'), e = t.lastIndexOf('}');
        const o = JSON.parse(s >= 0 ? t.slice(s, e + 1) : t);
        const q = String(o?.query ?? '').replace(/[#"']/g, '').trim();
        if (q) return q;
      }
    } catch { /* fall through to the feeling-only query */ }
  }
  // No goal (or the LLM failed): fall back to the register word + a mood cue.
  const mood = state.energy === 'loud' ? 'dynamic' : state.energy === 'quiet' ? 'quiet' : '';
  return [state.register, mood].filter(Boolean).join(' ');
}

// Confirm a set of ALREADY-HARVESTED frames (from Frameset, pixels-only) — the same
// VLM pixel-fit as eyeConfirm, but over frames the renderer supplies rather than a
// corpus pickForState. Concurrent, like eyeConfirm.
async function eyeConfirmFrames(
  ctx: ContextAgentsCtx, state: CAState, goal: string,
  frames: Array<{ id: string; filePath: string }>, finalK = 4,
): Promise<EyeConfirmItem[]> {
  const model = ctx.taskModelOverride('context-agents') || 'gpt-5.1';
  const provider = 'openai';
  const scored: EyeConfirmItem[] = await Promise.all(frames.map(async (c) => {
    let fit = 0; let why = 'err';
    try {
      const r = await ctx.runLlmJson({ provider, model, system: EYE_PIXELFIT_SYS, prompt: eyePixelUser(state, goal), imagePaths: [vlmReadablePath(c.filePath)], maxTokens: 200 });
      if (r.ok) { const v = parseFit(r.text || ''); fit = v.fit; why = v.why; }
      else { why = (r.message || r.reason || 'llm_failed').slice(0, 80); }
    } catch { why = 'err'; }
    return { id: c.id, filePath: c.filePath, fitScore: fit, metaScore: 0, brand: undefined, place: undefined, why };
  }));
  scored.sort((a, b) => b.fitScore - a.fitScore);
  return scored.slice(0, finalK);
}

/** Append one owner judgment to eye_judgments.jsonl — the accumulation the eye
 *  will one day reweight from. Create the file (and root) if missing. */
function eyeJudge(caRoot: string, args: {
  state: CAState | null; goal: string; verdict: string; eyeIds: string[]; naiveIds: string[];
}): { ok: boolean; reason?: string; message?: string } {
  if (!['eye', 'naive', 'tie'].includes(args.verdict)) {
    return { ok: false, reason: 'bad_args', message: 'verdict must be eye | naive | tie.' };
  }
  // Refuse a self-comparison. When the two columns hold the same frames the
  // verdict carries no signal — and one such line is currently the ENTIRE
  // contents of eye_judgments.jsonl. An empty ledger beats a poisoned one.
  const eyeKey = [...args.eyeIds].sort().join('|');
  const naiveKey = [...args.naiveIds].sort().join('|');
  if (eyeKey && eyeKey === naiveKey) {
    return { ok: false, reason: 'degenerate', message: 'Both columns hold the same frames — there is nothing to judge.' };
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    state: args.state ?? null,
    goal: String(args.goal ?? ''),
    verdict: args.verdict,
    eyeIds: Array.isArray(args.eyeIds) ? args.eyeIds : [],
    naiveIds: Array.isArray(args.naiveIds) ? args.naiveIds : [],
  });
  try {
    fs.mkdirSync(caRoot, { recursive: true });
    fs.appendFileSync(path.join(caRoot, 'eye_judgments.jsonl'), line + '\n', 'utf8');
    return { ok: true };
  } catch (e: any) { return { ok: false, reason: 'write_failed', message: String(e?.message || e).slice(0, 200) }; }
}

// ═══════════════════════════ IPC registration ═══════════════════════════
// Every hjen:ca-* handler lives here; main.ts calls registerContextAgents once.

export function registerContextAgents(ctx: ContextAgentsCtx): void {
  const root = () => ctx.contextAgentsRoot();

  ipcMain.handle('hjen:ca-apply', (_e: any, args: any) => caApply(ctx, args || {}));

  ipcMain.handle('hjen:ca-vocab', () => ({
    ok: true as const, registers: REGISTERS, beats: BEATS, energies: ENERGIES,
  }));

  ipcMain.handle('hjen:ca-list-methods', () => ({ ok: true as const, methods: loadMethods(root()) }));

  ipcMain.handle('hjen:ca-list-profiles', () => ({
    ok: true as const,
    profiles: loadProfiles(root()).map(p => ({ id: p.id, name: String(p.name || p.id) })),
  }));

  ipcMain.handle('hjen:ca-read-card', (_e: any, args: { id: string }) => caReadCard(root(), String(args?.id ?? '')));
  ipcMain.handle('hjen:ca-write-card', (_e: any, args: { card: CACard }) => caWriteCard(root(), args?.card));
  ipcMain.handle('hjen:ca-delete-card', (_e: any, args: { id: string }) => caDeleteCard(root(), String(args?.id ?? '')));

  ipcMain.handle('hjen:ca-read-lexicon', (_e: any, args: { status?: string }) => {
    const status = args?.status;
    const all = loadLexiconAll(root());
    const entries = status ? all.filter(e => e.status === status) : all;
    return { ok: true as const, entries };
  });
  ipcMain.handle('hjen:ca-write-lexicon-entry', (_e: any, args: { entry: CALexiconEntry }) => caWriteLexiconEntry(root(), args?.entry));

  ipcMain.handle('hjen:ca-study', (_e: any, args: any) => caStudy(ctx, args || {}));

  ipcMain.handle('hjen:ca-status', () => {
    const r = root();
    const methods = loadMethods(r);
    const profiles = loadProfiles(r);
    const lexicon = loadLexiconAll(r);
    return {
      ok: true as const,
      root: r,
      methods: methods.length,
      profiles: profiles.length,
      lexicon: lexicon.length,
      lexiconTrusted: lexicon.filter(e => e.status === 'trusted').length,
    };
  });

  // ── Context Eye — pick vs naive, and the owner's judgment log ──────────────
  // ca-eye-pick runs BOTH the two-stage eye AND the dumb keyword baseline over
  // ONE index load, and returns two columns for the owner to judge with his eyes.
  ipcMain.handle('hjen:ca-eye-pick', async (_e: any, args: any) => {
    const register = String(args?.register ?? '').trim();
    const beat = String(args?.beat ?? '').trim();
    const energy = String(args?.energy ?? '').trim();
    const goal = String(args?.goal ?? '').trim();
    if (!register) return { ok: false as const, reason: 'bad_args', message: 'register is required.' };
    const state: CAState = { register, beat, energy };
    const corpusRoot = ctx.refCorpusRoot();
    const frames = loadCorpusFrames(corpusRoot);
    if (frames.length === 0) return { ok: false as const, reason: 'no_corpus', message: `No corpus frames at ${corpusRoot}.` };
    const criteria = loadEyeCriteria(root());
    try {
      const eye = await eyeConfirm(ctx, state, goal, 10, 4, { criteria, frames });
      const naive = naivePick(state, 4, { frames, corpusRoot })
        .map(n => ({ id: n.id, filePath: n.filePath, brand: n.brand, place: n.place }));
      return { ok: true as const, eye, naive, state, degenerate: rankingIsDegenerate(eye) };
    } catch (e: any) {
      return { ok: false as const, reason: 'eye_failed', message: String(e?.message || e).slice(0, 300) };
    }
  });

  // ca-eye-query — the smart Frameset search query for a state, built MAIN-side
  // from the distilled criteria (the recipe stays server-side; the renderer only
  // gets a query string to hand to its Frameset hunt).
  ipcMain.handle('hjen:ca-eye-query', async (_e: any, args: any) => {
    const register = String(args?.register ?? '').trim();
    if (!register) return { ok: false as const, reason: 'bad_args', message: 'register is required.' };
    const state: CAState = { register, beat: String(args?.beat ?? ''), energy: String(args?.energy ?? '') };
    const query = await eyeQueryLLM(ctx, state, String(args?.goal ?? ''), loadEyeCriteria(root()));
    return { ok: true as const, query, state };
  });

  // ca-eye-confirm-frames — the VLM pixel-fit ranking over frames the renderer
  // harvested from Frameset (pixels-only). This is the Frameset eye's ranking half.
  ipcMain.handle('hjen:ca-eye-confirm-frames', async (_e: any, args: any) => {
    const register = String(args?.register ?? '').trim();
    if (!register) return { ok: false as const, reason: 'bad_args', message: 'register is required.' };
    const state: CAState = { register, beat: String(args?.beat ?? ''), energy: String(args?.energy ?? '') };
    const goal = String(args?.goal ?? '').trim();
    const frames = Array.isArray(args?.frames)
      ? args.frames.map((f: any) => ({ id: String(f?.id ?? ''), filePath: String(f?.filePath ?? '') })).filter((f: any) => f.filePath)
      : [];
    if (frames.length === 0) return { ok: false as const, reason: 'no_frames', message: 'No frames supplied to confirm.' };
    try {
      const eye = await eyeConfirmFrames(ctx, state, goal, frames, 4);
      return { ok: true as const, eye, state, degenerate: rankingIsDegenerate(eye) };
    } catch (e: any) {
      return { ok: false as const, reason: 'confirm_failed', message: String(e?.message || e).slice(0, 300) };
    }
  });

  ipcMain.handle('hjen:ca-eye-judge', (_e: any, args: any) => eyeJudge(root(), {
    state: (args?.state ?? null) as CAState | null,
    goal: String(args?.goal ?? ''),
    verdict: String(args?.verdict ?? ''),
    eyeIds: Array.isArray(args?.eyeIds) ? args.eyeIds.map(String) : [],
    naiveIds: Array.isArray(args?.naiveIds) ? args.naiveIds.map(String) : [],
  }));

  ipcMain.handle('hjen:ca-eye-status', () => {
    const criteria = loadEyeCriteria(root());
    const frames = loadCorpusFrames(ctx.refCorpusRoot());
    return { ok: true as const, criteriaRegisters: Object.keys(criteria), corpusFrames: frames.length };
  });
}
