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
//
// ── PORTED TO THE SERVER ────────────────────────────────────────────────────
// app/electron/contextAgents.ts, transpiled and re-seamed. Every prompt, every
// block-builder and every validation is the desktop's, byte for byte. What
// changed is only WHERE state lives:
//
//   · the library is a READ-ONLY seed shipped at server/context_agents/ with the
//     account's own cards and lexicon entries OVERLAID on top — the same
//     "MERGE, DO NOT REPLACE" rule the packaged desktop applies when it seeds
//     userData, so an update brings new methods and nothing the user wrote is
//     lost;
//   · `root` is now an account id rather than a folder, so every call site is
//     unchanged;
//   · images are cloud tokens (src/llm/run.js transcodes), so sips is gone.
//
// NOT PORTED, and each says so honestly rather than failing blank:
//   · caStudy — the trainer is a developer tool that ships only with the source
//     checkout; it is not in the packaged desktop build either;
//   · caEyePick / caEyeQuery / caEyeConfirmFrames — these read the 1.3 GB REF
//     corpus (02_PRODUCT/dna_corpus). Putting that on the server is a data
//     decision, not a code one.
import fsSeed from 'node:fs';
import pathSeed from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloud } from '../cloudstore.js';
import { runLlmJson as serverLlm } from '../llm/run.js';

/** The shipped, read-only library. */
const SEED = pathSeed.join(pathSeed.dirname(fileURLToPath(import.meta.url)), '..', '..', 'context_agents');
function seedJson(...parts) {
  try { return JSON.parse(fsSeed.readFileSync(pathSeed.join(SEED, ...parts), 'utf8')); } catch { return null; }
}
function seedDirJson(sub) {
  try {
    return fsSeed.readdirSync(pathSeed.join(SEED, sub))
      .filter((f) => f.endsWith('.json'))
      .map((f) => seedJson(sub, f))
      .filter(Boolean);
  } catch { return []; }
}
/** The account's writes, laid over the seed. */
const CARDS_KEY = 'ca-cards', LEX_KEY = 'ca-lexicon', JUDGE_KEY = 'ca-judgments';
function overlay(acc) {
  const o = cloud.readAcctDoc(acc, CARDS_KEY, null) || {};
  return { cards: o.cards && typeof o.cards === 'object' ? o.cards : {}, deleted: Array.isArray(o.deleted) ? o.deleted : [] };
}
function writeOverlay(acc, o) { cloud.writeAcctDoc(acc, CARDS_KEY, o); }
// Frameset saves stills as AVIF, which the OpenAI vision API rejects
// ("unsupported image"). Convert any non-JPEG/PNG/WEBP frame to a PNG the VLM can
// read: Electron's nativeImage (Chromium) decodes AVIF in-process; macOS `sips`
// is the fallback. Returns a path the VLM accepts (the original if already fine,
// or a cached PNG next to it). Cached so repeat looks don't re-convert.
// The server transcodes inside readVisionImage(), so the token passes through.
function vlmReadablePath(filePath) { return filePath; }
// ═══════════════════════════ state vocabulary ═══════════════════════════
// PORTED VERBATIM from lib/state.mjs — the UNIVERSAL, DNA-agnostic vocabulary.
// A card's condition_of_use and an incoming request are BOTH expressed here.
export const REGISTERS = ['longing', 'resolve', 'joy', 'desolation', 'turbulence', 'groundedness'];
export const BEATS = ['setup', 'desire', 'conflict', 'change', 'result'];
export const ENERGIES = ['quiet', 'mid', 'loud'];
/**
 * A predicate is { register?: string[], beat?: string[], energy?: string[] }.
 * It MATCHES a state when every axis present (and non-empty) contains the
 * state's value for that axis. An omitted or empty axis is a wildcard.
 */
export function matchesPredicate(state, predicate) {
    if (!predicate)
        return false;
    const axes = Object.keys(predicate);
    if (axes.length === 0)
        return false;
    let sawAxis = false;
    for (const axis of axes) {
        const allowed = predicate[axis];
        if (!Array.isArray(allowed) || allowed.length === 0)
            continue; // wildcard
        sawAxis = true;
        if (!allowed.includes(state[axis]))
            return false;
    }
    return sawAxis; // an all-wildcard predicate does not match (avoids firing on everything)
}
/** How many axes a predicate pins — the strength of its fit. */
export function specificity(predicate) {
    if (!predicate)
        return 0;
    return Object.values(predicate).filter(v => Array.isArray(v) && v.length > 0).length;
}
// when_it_fails may be a single predicate OR an array of predicates.
// OR-semantics: the card is dropped if ANY predicate matches the state.
// (A single predicate keeps AND-semantics across its own axes.)
function failsAny(state, fails) {
    if (!fails)
        return false;
    const list = Array.isArray(fails) ? fails : [fails];
    return list.some(p => matchesPredicate(state, p));
}
export function selectMethods(methods, state, { perCraft = 1 } = {}) {
    const scored = [];
    for (const card of methods) {
        if (failsAny(state, card.when_it_fails))
            continue; // DROP
        if (!matchesPredicate(state, card.when_it_works))
            continue; // off-state
        const fit = 1000 + 100 * specificity(card.when_it_works);
        scored.push({ card, score: fit + (card.weight || 1) });
    }
    scored.sort((a, b) => b.score - a.score);
    const takenByCraft = new Map();
    const selected = [];
    for (const { card } of scored) {
        const taken = takenByCraft.get(card.craft) || 0;
        if (taken >= perCraft)
            continue;
        takenByCraft.set(card.craft, taken + 1);
        selected.push(card);
    }
    return selected;
}
// `root` is an ACCOUNT ID here, not a folder. Reads merge the shipped seed with
// the account's overlay; writes only ever touch the overlay.
function loadMethods(acc) {
    const { cards, deleted } = overlay(acc);
    const out = new Map();
    for (const c of seedDirJson('methods')) if (c?.id) out.set(c.id, c);
    for (const id of Object.keys(cards)) out.set(id, cards[id]);
    for (const id of deleted) out.delete(id);
    return [...out.values()];
}
function loadProfile(acc, id) {
    return seedJson('profiles', `${id}.json`);
}
function loadProfiles(acc) {
    return seedDirJson('profiles');
}
function loadLexiconAll(acc) {
    const seed = seedJson('lexicon.json');
    const base = Array.isArray(seed) ? seed : [];
    const mine = cloud.readAcctDoc(acc, LEX_KEY, null);
    const extra = (mine && Array.isArray(mine.entries)) ? mine.entries : [];
    // The account's entry wins on `expression` — the same merge the desktop does.
    const byExpr = new Map();
    for (const e of base) if (e?.expression) byExpr.set(e.expression, e);
    for (const e of extra) if (e?.expression) byExpr.set(e.expression, e);
    return [...byExpr.values()];
}
function loadLexiconTrusted(root) {
    return loadLexiconAll(root).filter(e => e.status === 'trusted');
}
// ═══════════════════════════ block-builders ═════════════════════════════
// PORTED VERBATIM from apply.mjs (lines 47-49).
const confirmed = (c) => (c.evidence || []).some(e => /CONFIRMED/i.test(e));
function methodBlock(cards) {
    return cards.map(c => `- [${c.craft}${confirmed(c) ? '·confirmed' : ''}] ${c.principle}\n  DO: ${c.effect}`).join('\n');
}
function dnaBlock(profile) {
    return `palette:${profile.palette} · light:${profile.light_logic} · lens:${profile.lens} · texture:${profile.texture} · forbidden:${(profile.forbidden || []).join(', ')}`;
}
function lexBlock(lex) {
    return lex.map(e => `- «${e.expression}» — ${e.meaning} | usage: ${e.usage}`).join('\n');
}
// ═══════════════════════════ the three prompts ══════════════════════════
// PORTED VERBATIM from apply.mjs (lines 58-70).
const SYS_USE1 = 'أنت استراتيجي مبدع. اقرأ الهدف الحقيقي خلف الإعلان في ٣ أسطر: النية · معيار النجاح · لمن. مختصر.';
function sysUse2(methodsText, dnaText) {
    return `أنت مخرج. طوّر/أعد تجسيد هذا الإعلان مستعملاً هذه الطرق المتراكمة، بهذا اللوك. ٥–٧ أسطر، ملموس وقابل للتصوير، لا شعارات.\n\nالطرق:\n${methodsText}\n\nاللوك (DNA):\n${dnaText}`;
}
function sysUse3(lexText) {
    return `أنت كاتب إعلانات سعودي. اكتب ٤ سطور إعلانية أجمل لهذا الإعلان، بالسجل السعودي الأصيل، مستعملاً هذه العبارات الموثوقة من القاموس في مواضعها الصحيحة (لا تخترع لهجة):\n${lexText || '(لا قاموس)'}\n`;
}
async function caApply(ctx, args) {
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
    if (!profile)
        return { ok: false, reason: 'no_profile', message: `Profile "${profileId}" not found.` };
    const state = { register, beat, energy };
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
    const call = async (system, prompt) => {
        const r = await ctx.runLlmJson({ provider, model, system, prompt, maxTokens: 2048 });
        if (!r.ok)
            throw new Error(r.message || r.reason || 'llm_failed');
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
    }
    catch (e) {
        return { ok: false, reason: 'llm_failed', message: String(e?.message || e).slice(0, 300) };
    }
}
// ═══════════════════════════ card CRUD (Trainer) ═════════════════════════
/** slug-sanitize a card id so a Trainer write can never escape methods/. */
function slugId(raw) {
    return String(raw || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || ('card-' + Date.now().toString(36));
}
/** A predicate's axes must be ⊆ the closed vocabulary, and each value legal. */
function validPredicate(pred, label) {
    if (pred == null)
        return { ok: true };
    if (typeof pred !== 'object' || Array.isArray(pred))
        return { ok: false, message: `${label} must be an object.` };
    const allowed = { register: REGISTERS, beat: BEATS, energy: ENERGIES };
    for (const axis of Object.keys(pred)) {
        if (!(axis in allowed))
            return { ok: false, message: `${label}: unknown axis "${axis}".` };
        const vals = pred[axis];
        if (vals == null)
            continue;
        if (!Array.isArray(vals))
            return { ok: false, message: `${label}.${axis} must be an array.` };
        for (const v of vals) {
            if (!allowed[axis].includes(v))
                return { ok: false, message: `${label}.${axis}: "${v}" is not a valid ${axis}.` };
        }
    }
    return { ok: true };
}
function caReadCard(acc, id) {
    const want = slugId(id);
    const card = loadMethods(acc).find(c => c?.id === want);
    return card ? { ok: true, card } : { ok: false, reason: 'not_found', message: `Card "${id}" not found.` };
}
function caWriteCard(acc, card) {
    if (!card || typeof card !== 'object')
        return { ok: false, reason: 'bad_card', message: 'Card payload is missing.' };
    if (!card.craft || !String(card.craft).trim())
        return { ok: false, reason: 'bad_card', message: 'craft is required.' };
    if (!card.principle || !String(card.principle).trim())
        return { ok: false, reason: 'bad_card', message: 'principle is required.' };
    if (!card.effect || !String(card.effect).trim())
        return { ok: false, reason: 'bad_card', message: 'effect is required.' };
    const w = validPredicate(card.when_it_works, 'when_it_works');
    if (!w.ok)
        return { ok: false, reason: 'bad_predicate', message: w.message };
    // when_it_fails may be a single predicate OR an array of predicates.
    if (card.when_it_fails != null) {
        const list = Array.isArray(card.when_it_fails) ? card.when_it_fails : [card.when_it_fails];
        for (const p of list) {
            const f = validPredicate(p, 'when_it_fails');
            if (!f.ok)
                return { ok: false, reason: 'bad_predicate', message: f.message };
        }
    }
    const id = slugId(card.id || card.craft);
    const toWrite = { ...card, id };
    try {
        const o = overlay(acc);
        o.cards[id] = toWrite;
        o.deleted = o.deleted.filter(x => x !== id);   // re-writing un-deletes
        writeOverlay(acc, o);
        return { ok: true, id, card: toWrite };
    }
    catch (e) {
        return { ok: false, reason: 'write_failed', message: String(e?.message || e).slice(0, 200) };
    }
}
function caDeleteCard(acc, id) {
    const safe = slugId(id);
    try {
        const o = overlay(acc);
        delete o.cards[safe];
        // A seeded card cannot be unlinked, so it is tombstoned instead — the
        // account stops seeing it without the shipped library being mutated.
        if (!o.deleted.includes(safe)) o.deleted.push(safe);
        writeOverlay(acc, o);
        return { ok: true };
    }
    catch (e) {
        return { ok: false, reason: 'delete_failed', message: String(e?.message || e).slice(0, 200) };
    }
}
function caWriteLexiconEntry(root, entry) {
    if (!entry || !entry.expression || !String(entry.expression).trim()) {
        return { ok: false, reason: 'bad_entry', message: 'expression is required.' };
    }
    const all = loadLexiconAll(root);
    const idx = all.findIndex(e => e.expression === entry.expression);
    if (idx >= 0)
        all[idx] = { ...all[idx], ...entry };
    else
        all.push(entry);
    try {
        cloud.writeAcctDoc(root, LEX_KEY, { entries: all });
        return { ok: true, count: all.length };
    }
    catch (e) {
        return { ok: false, reason: 'write_failed', message: String(e?.message || e).slice(0, 200) };
    }
}
// ═══════════════════════════ caStudy ═════════════════════════════════════
// The trainer spawns STUDY/context_agents/pipeline.mjs, which ships only with
// the source checkout — the packaged desktop build answers the same way. Said
// plainly rather than failing blank.
async function caStudy() {
    return { ok: false, reason: 'no_script', message:
        'Training the library is a developer tool and is not part of this build — pipeline.mjs ships only with the source checkout.' };
}
// The 1.3 GB REF corpus (02_PRODUCT/dna_corpus) is not deployed. Nothing here
// pretends otherwise: an empty frame set makes ca-eye-pick answer 'no_corpus'.
function loadCorpusFrames(corpusRoot) { return []; }
/** The distilled per-register criteria (eye_criteria.json), written at the
 *  context-agents library root by the lab distiller — not in the corpus. */
function loadEyeCriteria(acc) {
    const o = seedJson('eye_criteria.json');
    return (o && typeof o === 'object') ? o : {};
}
// scoreFrame — PORTED VERBATIM from pick.mjs. Sum of the register's learned
// field-value weights this frame hits; palette at half weight; q as a gentle tiebreak.
function scoreFrame(frame, register, criteria) {
    const c = criteria[register];
    if (!c || (c._n ?? 0) < 4)
        return { score: 0, hits: [] };
    let score = 0;
    const hits = [];
    for (const f of EYE_FIELDS) {
        const w = c[f];
        if (!w)
            continue;
        const v = frame[f];
        if (v && w[v] != null) {
            score += w[v];
            hits.push(`${f}=${v}(+${w[v]})`);
        }
    }
    if (c.palette)
        for (const p of (frame.palette || []))
            if (c.palette[p] != null) {
                score += c.palette[p] * 0.5;
                hits.push(`pal:${p}(+${(c.palette[p] * 0.5).toFixed(2)})`);
            }
    // gentle quality tiebreak so among equal-fit frames the better-analyzed wins
    score += (frame.q || 0) * 0.01;
    return { score, hits };
}
// pickForState — PORTED VERBATIM from pick.mjs (one frame per ad for diversity),
// with corpusRoot threaded for the absolute filePath.
function pickForState(state, k, opts) {
    const { criteria, frames, corpusRoot } = opts;
    const reg = state.register;
    const scored = frames.map(fr => { const s = scoreFrame(fr, reg, criteria); return { fr, ...s }; })
        .sort((a, b) => b.score - a.score);
    const out = [];
    const seenAd = new Set();
    for (const s of scored) {
        if (out.length >= k)
            break;
        if (seenAd.has(s.fr.ad))
            continue;
        seenAd.add(s.fr.ad);
        out.push({ id: s.fr.id, file: s.fr.file, filePath: pathSeed.join(corpusRoot, s.fr.file), score: Math.round(s.score * 100) / 100, brand: s.fr.brand, place: s.fr.place, why: s.hits.slice(0, 4).join(' ') });
    }
    return out;
}
// naivePick — PORTED VERBATIM from pick.mjs. The dumb keyword baseline: frames
// whose blob/palette literally contain the register word, else corpus order.
function naivePick(state, k, opts) {
    const { frames, corpusRoot } = opts;
    const term = state.register;
    const hit = frames.filter(fr => (fr.blob || '').includes(term) || (fr.palette || []).some(p => p.includes(term)));
    const pool = hit.length >= k ? hit : frames; // if the word never appears, fall back to corpus order
    const out = [];
    const seenAd = new Set();
    for (const fr of pool) {
        if (out.length >= k)
            break;
        if (seenAd.has(fr.ad))
            continue;
        seenAd.add(fr.ad);
        out.push({ id: fr.id, file: fr.file, filePath: pathSeed.join(corpusRoot, fr.file), brand: fr.brand, place: fr.place });
    }
    return out;
}
// pixelFit prompt — PORTED VERBATIM from confirm.mjs. "Judge the pixels,
// metadata is not enough" — this instruction is the whole point of the eye.
const EYE_PIXELFIT_SYS = `You are a photo editor choosing a reference still for an ad. Score how well THIS image serves the target — its actual visual content, mood, light and composition — NOT its subject matter literally. Reply ONLY JSON: {"fit":0-5,"why":"few words"}. fit 5 = the feeling radiates from the frame; 0 = wrong feeling entirely (e.g. a comedy cartoon for a desolate mood). Be strict: metadata is not enough, judge the pixels.`;
function eyePixelUser(state, goal) {
    return `TARGET feeling: register=${state.register}, beat=${state.beat}, energy=${state.energy}. Use: ${goal}`;
}
// Same lenient brace-slice parse confirm.mjs uses for the VLM reply.
function parseFit(text) {
    const t = (text || '').trim();
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    try {
        const o = JSON.parse(s >= 0 ? t.slice(s, e + 1) : t);
        return { fit: Number(o?.fit) || 0, why: String(o?.why ?? '') };
    }
    catch {
        return { fit: 0, why: 'parse-fail' };
    }
}
/** A ranking carries NO SIGNAL when every candidate scored the same — typically
 *  all 0, because the VLM errored on every call. The sort is then a stable no-op
 *  and the "eye" column silently becomes the input order, so the A/B compares a
 *  set with itself. That is exactly how the single line in eye_judgments.jsonl
 *  ended up with eyeIds identical to naiveIds. Surfaced so the ledger can refuse
 *  to record a self-comparison — an unfed loop is better than a poisoned one. */
function rankingIsDegenerate(items) {
    if (items.length < 2)
        return true;
    return items.every(i => i.fitScore === items[0].fitScore);
}
// confirmPick (confirm.mjs) — metadata prefilter → VLM pixel-fit per frame → re-rank.
// runLlmJson takes imagePaths so the VLM reads the jpg by path (no base64 here).
async function eyeConfirm(ctx, state, goal, prefilterK = 10, finalK = 4, pre) {
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
    const scored = await Promise.all(cand.map(async (c) => {
        let fit = 0;
        let why = 'err';
        try {
            const r = await ctx.runLlmJson({ provider, model, system: EYE_PIXELFIT_SYS, prompt: eyePixelUser(state, goal), imagePaths: [vlmReadablePath(c.filePath)], maxTokens: 200 });
            if (r.ok) {
                const v = parseFit(r.text || '');
                fit = v.fit;
                why = v.why;
            }
            else {
                why = (r.message || r.reason || 'llm_failed').slice(0, 80);
            }
        }
        catch {
            why = 'err';
        }
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
async function eyeQueryLLM(ctx, state, goal, criteria) {
    const model = ctx.taskModelOverride('context-agents') || 'gpt-5.1';
    const g = (goal || '').trim();
    if (g) {
        try {
            const user = `Brief: ${g}\nTarget feeling: register=${state.register}, beat=${state.beat}, energy=${state.energy}.`;
            const r = await ctx.runLlmJson({ provider: 'openai', model, system: EYE_QUERY_SYS, prompt: user, maxTokens: 120 });
            if (r.ok && r.text) {
                const t = r.text.trim();
                const s = t.indexOf('{'), e = t.lastIndexOf('}');
                const o = JSON.parse(s >= 0 ? t.slice(s, e + 1) : t);
                const q = String(o?.query ?? '').replace(/[#"']/g, '').trim();
                if (q)
                    return q;
            }
        }
        catch { /* fall through to the feeling-only query */ }
    }
    // No goal (or the LLM failed): fall back to the register word + a mood cue.
    const mood = state.energy === 'loud' ? 'dynamic' : state.energy === 'quiet' ? 'quiet' : '';
    return [state.register, mood].filter(Boolean).join(' ');
}
// Confirm a set of ALREADY-HARVESTED frames (from Frameset, pixels-only) — the same
// VLM pixel-fit as eyeConfirm, but over frames the renderer supplies rather than a
// corpus pickForState. Concurrent, like eyeConfirm.
async function eyeConfirmFrames(ctx, state, goal, frames, finalK = 4) {
    const model = ctx.taskModelOverride('context-agents') || 'gpt-5.1';
    const provider = 'openai';
    const scored = await Promise.all(frames.map(async (c) => {
        let fit = 0;
        let why = 'err';
        try {
            const r = await ctx.runLlmJson({ provider, model, system: EYE_PIXELFIT_SYS, prompt: eyePixelUser(state, goal), imagePaths: [vlmReadablePath(c.filePath)], maxTokens: 200 });
            if (r.ok) {
                const v = parseFit(r.text || '');
                fit = v.fit;
                why = v.why;
            }
            else {
                why = (r.message || r.reason || 'llm_failed').slice(0, 80);
            }
        }
        catch {
            why = 'err';
        }
        return { id: c.id, filePath: c.filePath, fitScore: fit, metaScore: 0, brand: undefined, place: undefined, why };
    }));
    scored.sort((a, b) => b.fitScore - a.fitScore);
    return scored.slice(0, finalK);
}
/** Append one owner judgment to eye_judgments.jsonl — the accumulation the eye
 *  will one day reweight from. Create the file (and root) if missing. */
function eyeJudge(caRoot, args) {
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
        const cur = cloud.readAcctDoc(caRoot, JUDGE_KEY, null);
        const entries = (cur && Array.isArray(cur.entries)) ? cur.entries : [];
        entries.push(JSON.parse(line));
        cloud.writeAcctDoc(caRoot, JUDGE_KEY, { entries });
        return { ok: true };
    }
    catch (e) {
        return { ok: false, reason: 'write_failed', message: String(e?.message || e).slice(0, 200) };
    }
}
// ═══════════════════════════ the doors ═══════════════════════════
// registerContextAgents()'s handlers as plain functions. Same arguments, same
// return shapes; the web adapter posts what the preload used to send.
function ctxFor(inv) {
  return {
    runLlmJson: (a) => serverLlm(inv, a),
    contextAgentsRoot: () => inv.id,
    refCorpusRoot: () => 'cloud://dna_corpus',
    getWindow: () => null,
    taskModelOverride: (task) => {
      try {
        const j = cloud.readAcctDoc(inv.id, 'models', null);
        const m = j?.tasks?.[task];
        return typeof m === 'string' && m ? m : null;
      } catch { return null; }
    },
  };
}

export const ca = {
  apply:        (inv, args) => caApply(ctxFor(inv), args || {}),
  vocab:        () => ({ ok: true, registers: REGISTERS, beats: BEATS, energies: ENERGIES }),
  listMethods:  (inv) => ({ ok: true, methods: loadMethods(inv.id) }),
  listProfiles: (inv) => ({ ok: true, profiles: loadProfiles(inv.id).map(p => ({ id: p.id, name: String(p.name || p.id) })) }),
  readCard:     (inv, args) => caReadCard(inv.id, String(args?.id ?? '')),
  writeCard:    (inv, args) => caWriteCard(inv.id, args?.card),
  deleteCard:   (inv, args) => caDeleteCard(inv.id, String(args?.id ?? '')),
  readLexicon:  (inv, args) => {
    const status = args?.status;
    const all = loadLexiconAll(inv.id);
    return { ok: true, entries: status ? all.filter(e => e.status === status) : all };
  },
  writeLexiconEntry: (inv, args) => caWriteLexiconEntry(inv.id, args?.entry),
  study:        () => caStudy(),
  status:       (inv) => {
    const methods = loadMethods(inv.id);
    const profiles = loadProfiles(inv.id);
    const lexicon = loadLexiconAll(inv.id);
    return {
      ok: true, root: 'cloud://context_agents',
      methods: methods.length, profiles: profiles.length, lexicon: lexicon.length,
      lexiconTrusted: lexicon.filter(e => e.status === 'trusted').length,
    };
  },
  // Needs the REF corpus, which is not deployed — answered, not faked.
  eyePick: async (inv, args) => {
    const register = String(args?.register ?? '').trim();
    if (!register) return { ok: false, reason: 'bad_args', message: 'register is required.' };
    return { ok: false, reason: 'no_corpus', message: 'The reference corpus is not available on the web — run the pick in the desktop app.' };
  },
  eyeQuery: async (inv, args) => {
    const register = String(args?.register ?? '').trim();
    if (!register) return { ok: false, reason: 'bad_args', message: 'register is required.' };
    const state = { register, beat: String(args?.beat ?? ''), energy: String(args?.energy ?? '') };
    const query = await eyeQueryLLM(ctxFor(inv), state, String(args?.goal ?? ''), loadEyeCriteria(inv.id));
    return { ok: true, query, state };
  },
  eyeConfirmFrames: async (inv, args) => {
    const register = String(args?.register ?? '').trim();
    if (!register) return { ok: false, reason: 'bad_args', message: 'register is required.' };
    const state = { register, beat: String(args?.beat ?? ''), energy: String(args?.energy ?? '') };
    const goal = String(args?.goal ?? '').trim();
    const frames = Array.isArray(args?.frames)
      ? args.frames.map((f) => ({ id: String(f?.id ?? ''), filePath: String(f?.filePath ?? '') })).filter((f) => f.filePath)
      : [];
    if (frames.length === 0) return { ok: false, reason: 'no_frames', message: 'No frames supplied to confirm.' };
    try {
      const eye = await eyeConfirmFrames(ctxFor(inv), state, goal, frames, 4);
      return { ok: true, eye, state, degenerate: rankingIsDegenerate(eye) };
    } catch (e) {
      return { ok: false, reason: 'confirm_failed', message: String(e?.message || e).slice(0, 300) };
    }
  },
  eyeJudge: (inv, args) => eyeJudge(inv.id, {
    state: (args?.state ?? null),
    goal: String(args?.goal ?? ''),
    verdict: String(args?.verdict ?? ''),
    eyeIds: Array.isArray(args?.eyeIds) ? args.eyeIds.map(String) : [],
    naiveIds: Array.isArray(args?.naiveIds) ? args.naiveIds.map(String) : [],
  }),
  eyeStatus: (inv) => ({
    ok: true, criteriaRegisters: Object.keys(loadEyeCriteria(inv.id)), corpusFrames: 0,
  }),
};
