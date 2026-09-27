// Reference Hunt — a PROJECT-SCOPED BACKGROUND engine, lifted out of the view.
//
// Why a store: the hunt used to live inside ReferencesView, so navigating away
// unmounted the component and killed the loop. Here it runs independent of any
// view — leave and return and the live hunt is still going. The engine NEVER
// writes through the view's useStageData; it persists straight to stage-2 on
// disk with a read-modify-APPEND-by-id discipline that can't clobber the user's
// edits made in the view meanwhile. The view subscribes to `refsVersion` and
// merges new frames in; a global pill (TopChrome) shows the state from anywhere.
//
// The engine logic (search grammar, image_type, ready-signal, suffix filters,
// _md capture, HJEN REF phase, POV fallback) is the verified behaviour MOVED
// here verbatim — not rewritten.

import { create } from 'zustand';
import { useStore } from '../store';
import { connectCdp } from '../lib/cdpBrowser';
import { rankByFeeling, applyOrder } from '../lib/eye/rank';
import type { Register } from '../lib/eye/types';
import { getPOV, reformulateQueries, evaluateImages } from '../lib/creative360';
import type { CreativePOV, Strictness } from '../lib/creative360';
import type { HuntedRef, ReferencesData, RefSource } from '../types/preprod';

// ─── small utils (moved from the view) ──────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tag';

const FRAMESET_CDN = 'd13mryl9xv19vu.cloudfront.net';
const framesetMd = (src: string, motion: boolean): string =>
  motion ? src.replace('_sm_motion.webp', '_md_motion.webp') : src.replace('_sm.avif', '_md.avif');

// ─── store types ────────────────────────────────────────────────────────────

export interface HuntLane {
  id: number;
  query: string | null;
  stage: string;              // "searching «…»" · "harvested 42" · "judging 11" · "idle"
}

export type HuntLogKind = 'phase' | 'search' | 'harvest' | 'read' | 'kept' | 'rejected' | 'end' | 'info' | 'stop';
export interface HuntLogEntry { id: string; ts: number; kind: HuntLogKind; text: string; }

export interface HuntStartArgs {
  projectId: string;
  projectName: string;
  projectSlug: string;
  tags: string[];
  intentFor: (tag: string) => string;
  /** The feeling each tag is chasing — written by craftQueries alongside the
   *  query itself. Null means no eye for that tag: the hunt keeps its old
   *  behaviour (first twelve results, straight to the judge). */
  registerFor?: (tag: string) => Register | null;
  perTag: number;
  laneCount: number;
  strictness: Strictness;
  imageType: 'frames' | 'motion';
  browserSources: RefSource[];      // enabled CDP search sites
  useRefLib: boolean;               // HJEN REF enabled + index ok
  seedRefs: HuntedRef[];            // frames already on the board (dedupe seed)
}

export type StartResult = { ok: true } | { ok: false; busyProject: string };

interface HuntStore {
  running: boolean;
  projectId: string | null;
  projectName: string | null;
  imageType: 'frames' | 'motion';
  strictness: Strictness;

  phase: string;                    // top-line stage
  queriesDone: number;
  queriesTotal: number;
  kept: number;
  startedAt: number | null;
  finishedAt: number | null;
  lanes: HuntLane[];
  log: HuntLogEntry[];

  refsVersion: number;              // bumps every disk flush → the view reloads
  toast: { id: number; msg: string } | null;

  start: (args: HuntStartArgs) => StartResult;
  stop: () => void;
  clear: () => void;                // wipe a finished run's panel/log
}

// ─── module-level engine state (survives every view unmount) ────────────────
let abort = { cancelled: false };
let sessionRefs: HuntedRef[] = [];          // every keeper this run (merge is by id — self-healing)
let seenSrcs = new Set<string>();
let flushChain: Promise<void> = Promise.resolve();

const LOG_CAP = 500;

export const useHunt = create<HuntStore>((set, get) => ({
  running: false,
  projectId: null,
  projectName: null,
  imageType: 'frames',
  strictness: 'strict',
  phase: '',
  queriesDone: 0,
  queriesTotal: 0,
  kept: 0,
  startedAt: null,
  finishedAt: null,
  lanes: [],
  log: [],
  refsVersion: 0,
  toast: null,

  start(args) {
    const st = get();
    if (st.running) {
      return { ok: false, busyProject: st.projectName ?? 'another project' };
    }
    abort = { cancelled: false };
    sessionRefs = [];
    seenSrcs = new Set(args.seedRefs.map(r => r.imageUrl).filter(Boolean) as string[]);
    set({
      running: true,
      projectId: args.projectId,
      projectName: args.projectName,
      imageType: args.imageType,
      strictness: args.strictness,
      phase: 'Starting the hunt…',
      queriesDone: 0,
      queriesTotal: args.tags.length,
      kept: 0,
      startedAt: Date.now(),
      finishedAt: null,
      lanes: [],
      log: [],
      refsVersion: 0,
    });
    void runHunt(set, get, args);      // fire-and-forget — the STORE owns the promise
    return { ok: true };
  },

  stop() {
    if (!get().running) return;
    abort.cancelled = true;
    log(set, 'stop', `stopping — ${get().kept} kept so far`);
    set({ phase: 'Stopping…' });
  },

  clear() {
    if (get().running) return;
    set({ log: [], phase: '', lanes: [], queriesDone: 0, queriesTotal: 0, kept: 0, startedAt: null, finishedAt: null, projectId: null, projectName: null });
  },
}));

// best-effort: never leave a hunt spinning promises after the window closes.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { abort.cancelled = true; });
}

// ─── log + progress helpers ─────────────────────────────────────────────────

function log(set: (fn: (s: HuntStore) => Partial<HuntStore>) => void, kind: HuntLogKind, text: string) {
  set(s => ({ log: [{ id: uid(), ts: Date.now(), kind, text }, ...s.log].slice(0, LOG_CAP) }));
}
function setPhase(set: (p: Partial<HuntStore>) => void, phase: string) { set({ phase }); }
function setLane(set: (fn: (s: HuntStore) => Partial<HuntStore>) => void, id: number, patch: Partial<HuntLane>) {
  set(s => ({ lanes: s.lanes.map(l => (l.id === id ? { ...l, ...patch } : l)) }));
}
function emitToast(set: (p: Partial<HuntStore>) => void, msg: string) {
  set({ toast: { id: Date.now() + Math.random(), msg } });
}

// Read-modify-APPEND-by-id: never clobbers the user's edits to OTHER refs (we
// start from the disk copy and only add session frames whose id isn't there).
// Serialised through a promise chain so two lane flushes can't interleave.
function flushToDisk(set: (fn: (s: HuntStore) => Partial<HuntStore>) => void, pid: string): Promise<void> {
  flushChain = flushChain.then(async () => {
    try {
      const cur = await window.hjen.readStageData({ id: pid, stage: 2 }) as ReferencesData | null;
      const base = (cur && typeof cur === 'object') ? cur : {} as ReferencesData;
      const existing = Array.isArray(base.refs) ? base.refs : [];
      const have = new Set(existing.map(r => r.id));
      const merged = [...existing, ...sessionRefs.filter(r => !have.has(r.id))];
      if (merged.length !== existing.length) {
        await window.hjen.writeStageData({ id: pid, stage: 2, data: { ...base, refs: merged, updatedAt: new Date().toISOString() } });
      }
      set(s => ({ refsVersion: s.refsVersion + 1 }));
    } catch { /* a failed flush is retried on the next keeper (sessionRefs is full-merge) */ }
  });
  return flushChain;
}

// ─── the engine ──────────────────────────────────────────────────────────────

async function runHunt(
  set: (arg: Partial<HuntStore> | ((s: HuntStore) => Partial<HuntStore>)) => void,
  get: () => HuntStore,
  args: HuntStartArgs,
): Promise<void> {
  const { projectId, projectSlug, tags, intentFor, registerFor, perTag, laneCount, strictness, imageType, browserSources, useRefLib } = args;
  const isMotion = imageType === 'motion';
  const queue = [...tags];
  const sessions: Array<{ cdp: Awaited<ReturnType<typeof connectCdp>>; targetId?: string }> = [];

  const bumpKept = () => set(s => ({ kept: s.kept + 1 }));
  const bumpDone = () => set(s => ({ queriesDone: Math.min(s.queriesTotal, s.queriesDone + 1) }));
  // "done" is owned by the primary (long-pole) phase to avoid double-counting.
  const doneOwner: 'browser' | 'ref' = browserSources.length > 0 ? 'browser' : 'ref';

  const pushKeeper = (ref: HuntedRef) => { sessionRefs.push(ref); bumpKept(); void flushToDisk(set, projectId); };

  // ── capture (verified _md rules) ──
  const captureFrame = async (cdp: Awaited<ReturnType<typeof connectCdp>>, src: string, isFrameset: boolean): Promise<string> => {
    if (isFrameset && isMotion) {
      const md = framesetMd(src, true);
      let b = await cdp.fetchImageBase64(md);
      if (!b) b = await cdp.fetchImageBase64(src);
      if (!b) b = await cdp.capturePng(src);
      return b;
    }
    if (isFrameset) {
      const md = framesetMd(src, false);
      let b = await cdp.capturePng(md);
      if (!b) b = await cdp.capturePng(src);
      return b;
    }
    let b = await cdp.fetchImageBase64(src);
    if (!b) b = await cdp.capturePng(src);
    return b;
  };

  const copyIntoRefs = async (absPath: string, namePrefix: string): Promise<string | null> => {
    try {
      const dataUrl = await window.hjen.readImageDataUrl(absPath);
      const base64 = dataUrl?.includes(',') ? dataUrl.split(',')[1] : null;
      if (!base64) return null;
      const saved = await window.hjen.saveImageBase64({ base64, projectSlug, fileName: `${namePrefix}_${uid()}`, subfolder: '_references' });
      return saved.ok ? saved.path : null;
    } catch { return null; }
  };

  const harvest = (cdp: Awaited<ReturnType<typeof connectCdp>>, isFrameset: boolean) =>
    cdp.evaluate<Array<{ src: string; w: number; h: number; title: string }>>(`(() => {
      const out=[]; const seen=new Set();
      const FS=${isFrameset ? 'true' : 'false'}, MOTION=${isMotion ? 'true' : 'false'}, CDN=${JSON.stringify(FRAMESET_CDN)};
      const list = FS ? document.querySelectorAll('img[src*="'+CDN+'"]') : document.images;
      for (const im of list) {
        const s=im.currentSrc||im.src;
        if(!s||!/^https?:/.test(s)||seen.has(s))continue;
        if (FS) {
          if(im.closest && im.closest('#submit-title'))continue;
          const isM=/_motion\\.webp$/.test(s);
          if(MOTION ? !isM : isM)continue;
        } else {
          const w=im.naturalWidth, h=im.naturalHeight;
          if(w&&h&&(w<200||h<110))continue;
          const r=im.getBoundingClientRect();
          if(r.top<90 && r.width>600)continue;
        }
        seen.add(s);
        out.push({src:s, w:im.naturalWidth||0, h:im.naturalHeight||0, title:(im.alt||'').slice(0,120)});
        if(out.length>=60)break;
      } return out;
    })()`).catch(() => [] as Array<{ src: string; w: number; h: number; title: string }>);

  let warnedLogout = false;
  // The POV the judge/reformulate measure against — set by phaseBrowser (real
  // POV when the stages exist, honest query-only fallback when they don't).
  let hunterPov: CreativePOV | null = null;
  const searchAndHarvest = async (
    laneId: number, cdp: Awaited<ReturnType<typeof connectCdp>>, source: RefSource, q: string,
  ): Promise<{ url: string; images: Array<{ src: string; w: number; h: number; title: string }>; isFrameset: boolean }> => {
    const isFrameset = /frameset\.app/i.test(source.urlTemplate);
    // Frameset grammar, LIVE-verified 2026-07-10 (see STUDY/frameset_adapter_spec.md
    // CORRECTION block): only the `search=` param RUNS a search on navigation —
    // `?q=` is ignored on load and lands every tab on the same Featured grid.
    // Motion stays pure URL grammar via image_type.
    const url = isFrameset
      ? `https://frameset.app/search?search=${encodeURIComponent(q)}&image_type=${isMotion ? 'motion' : 'frames'}`
      : source.urlTemplate.replace('{query}', encodeURIComponent(q));
    const short = source.name;
    setLane(set, laneId, { query: q, stage: `searching «${q}»${isMotion ? ' (motion)' : ''}` });
    log(set, 'search', `${short} · «${q}»${isMotion ? ' · motion' : ' · frames'}`);
    await cdp.navigate(url);

    const readyExpr = isFrameset
      ? `document.querySelectorAll('img[src*="${FRAMESET_CDN}"]').length >= 10`
      : `document.images.length >= 8`;
    let ready = await cdp.waitFor(readyExpr, { timeoutMs: 8000, intervalMs: 250 });

    if (isFrameset && !warnedLogout) {
      const out = await cdp.evaluate<boolean>(`/\\bLogin\\b|searches left/i.test(document.body.innerText||'')`).catch(() => false);
      if (out) { warnedLogout = true; emitToast(set, 'Frameset not logged in — results are quota-limited.'); log(set, 'info', 'Frameset logged out — quota-limited'); }
    }

    if (!ready && !abort.cancelled) {
      setLane(set, laneId, { stage: `«${q}» slow — typing it in` });
      await cdp.typeSearch(q, false);
      ready = await cdp.waitFor(readyExpr, { timeoutMs: 5000, intervalMs: 250 });
      if (!ready) log(set, 'info', `${short} · «${q}» slow to load`);
    }

    await cdp.scrollToLoad(2, 1000);
    const images = await harvest(cdp, isFrameset);
    setLane(set, laneId, { stage: `harvested ${images.length}` });
    log(set, 'harvest', `${short} · «${q}» → ${images.length} candidates`);
    return { url, images, isFrameset };
  };

  /** How many frames the judge is allowed to look at once the eye has shortlisted.
 *  Fewer than the old 12 because they are better chosen, not because we care less. */
const EYE_CANDIDATES = 8;
const MAX_ATTEMPTS = 4;
  const runTag = async (laneId: number, cdp: Awaited<ReturnType<typeof connectCdp>>, tag: string) => {
    const tagSlug = slugify(tag);
    const intentText = intentFor(tag) || tag;
    const register = registerFor?.(tag) ?? null;
    const tried: string[] = [];
    const qQueue: string[] = [tag];
    let keptForTag = 0, attempts = 0, lastNote = '';
    let endReason = 'no candidates';
    try {
      while (keptForTag < perTag && attempts < MAX_ATTEMPTS) {
        if (abort.cancelled) { endReason = 'stopped'; break; }
        let q = qQueue.shift();
        if (!q) {
          setLane(set, laneId, { stage: `«${tag}» — rewriting the query` });
          const fresh = hunterPov ? await reformulateQueries(hunterPov, intentText, tried, lastNote).catch(() => []) : [];
          if (fresh.length === 0) { endReason = 'no new angle'; break; }
          log(set, 'end', `«${tag}» — reformulated to «${fresh[0]}»`);
          qQueue.push(...fresh);
          q = qQueue.shift();
        }
        if (!q || tried.includes(q)) continue;
        tried.push(q); attempts++;

        for (const source of browserSources) {
          if (abort.cancelled) { endReason = 'stopped'; break; }
          if (keptForTag >= perTag) break;
          const { url, images, isFrameset } = await searchAndHarvest(laneId, cdp, source, q);
          const short = source.name;
          if (images.length === 0) { lastNote = `«${q}» returned no frames on ${short}.`; endReason = 'no candidates'; continue; }

          const ordered = isFrameset ? images : [...images].sort((a, b) => b.w * b.h - a.w * a.h);
          // THE EYE GOES FIRST. The judge is a VLM call per candidate, so the old
          // code could only afford to look at the first twelve results — and the
          // frame that actually carries the feeling is usually not in the first
          // twelve (measured on Frameset: median rank 58 of 120). The eye reads
          // the pixels of the whole harvest locally and cheaply, so the judge
          // spends its calls on the best EIGHT of sixty instead of the first
          // twelve of sixty: deeper reach and fewer calls at the same time.
          let candidates = ordered.slice(0, 12);
          if (register) {
            const ranked = await rankByFeeling(register, ordered.map(im => ({ id: im.src, url: im.src })));
            if (ranked?.order?.length) {
              candidates = applyOrder(ordered, im => im.src, ranked.order).slice(0, EYE_CANDIDATES);
              log(set, 'read', `${short} · «${q}» → the eye read ${ranked.read}/${ranked.of}, shortlisted ${candidates.length} (${ranked.mode === 'eye' ? 'feeling' : 'feeling + relevance'})`);
            }
          }
          setLane(set, laneId, { stage: `reading ${candidates.length}` });
          log(set, 'read', `${short} · «${q}» → reading ${candidates.length}`);
          const shots = await cdp.capturePngBatch(candidates.map(c => c.src), 1200);
          const local: Array<{ path: string; src: string; title: string }> = [];
          for (let i = 0; i < candidates.length; i++) {
            if (!shots[i]) continue;
            const saved = await window.hjen.saveImageBase64({
              base64: shots[i], projectSlug, fileName: `cand_${tagSlug}_${attempts}_${i + 1}`, subfolder: '_references/_candidates',
            });
            if (saved.ok) local.push({ path: saved.path, src: candidates[i].src, title: candidates[i].title });
          }
          if (local.length === 0) { lastNote = `Could not read candidates for «${q}».`; continue; }
          if (abort.cancelled) { endReason = 'stopped'; break; }

          setLane(set, laneId, { stage: `judging ${local.length}` });
          const need = perTag - keptForTag;
          if (!hunterPov) { endReason = 'no POV to judge with'; break; }
          const verdict = await evaluateImages(hunterPov, { intent: intentText, queries: [q], register }, local.map(l => l.path), need, strictness);
          lastNote = verdict.note || lastNote;

          // FULL transparency — log EVERY candidate's verdict, kept and rejected.
          for (const j of verdict.judged) {
            const s = j.scores;
            const bd = `lit${s.literal} pov${s.pov} cft${s.craft} fit${s.fit} cli${s.antiCliche}`;
            if (j.keep) log(set, 'kept', `✓ kept · ${s.total}/25 (${bd}) — ${trim(j.why)}`);
            else log(set, 'rejected', `✗ rejected · ${s.total}/25 (${bd}) — ${trim(j.why || lastNote)}`);
          }

          const keepers = verdict.judged.filter(j => j.keep);
          if (keepers.length === 0) { endReason = 'judge rejected all'; }
          for (const k of keepers) {
            if (abort.cancelled) { endReason = 'stopped'; break; }
            if (keptForTag >= perTag) break;
            const cand = local[k.index - 1];
            if (!cand || seenSrcs.has(cand.src)) continue;
            const b64 = await captureFrame(cdp, cand.src, isFrameset);
            if (!b64) continue;
            const saved = await window.hjen.saveImageBase64({ base64: b64, projectSlug, fileName: `${tagSlug}_${uid()}`, subfolder: '_references' });
            if (!saved.ok) continue;
            seenSrcs.add(cand.src);
            pushKeeper({
              id: uid(), tag: q,
              intent: [intentText, cand.title].filter(Boolean).join(' · '),
              imagePath: saved.path, imageUrl: cand.src,
              sourceUrl: url, sourceName: source.name,
              why: k.why, take: k.take, leave: k.leave, palette: k.palette, scores: k.scores,
            });
            keptForTag++;
            if (keptForTag >= perTag) endReason = 'target reached';
          }
        }
      }
    } catch { endReason = 'error'; }
    setLane(set, laneId, { query: null, stage: 'idle' });
    log(set, 'end', `«${tag}» — ${endReason} · kept ${keptForTag}/${perTag}${tried.length > 1 ? ` (${tried.length} tries)` : ''}`);
    if (doneOwner === 'browser') bumpDone();
  };

  // ── phase A · HJEN REF (instant, offline) ──
  const phaseRef = async () => {
    if (!useRefLib || isMotion) return;
    for (const tag of queue) {
      if (abort.cancelled) return;
      const intentText = intentFor(tag) || tag;
      log(set, 'search', `HJEN REF · «${tag}»`);
      let res: Awaited<ReturnType<typeof window.hjen.refSearch>> | null = null;
      try { res = await window.hjen.refSearch({ query: tag, limit: Math.max(perTag * 3, 12) }); } catch { res = null; }
      if (!res || !res.ok) { log(set, 'end', `HJEN REF · «${tag}» — index unavailable`); if (doneOwner === 'ref') bumpDone(); continue; }
      let keptForTag = 0;
      for (const hit of res.results) {
        if (abort.cancelled) return;
        if (keptForTag >= perTag) break;
        if (!hit.filePath || seenSrcs.has(hit.filePath)) continue;
        const savedPath = await copyIntoRefs(hit.filePath, `hjenref_${slugify(tag)}`);
        if (!savedPath) continue;
        seenSrcs.add(hit.filePath);
        const meta = [hit.brand, hit.title, hit.shotSize, hit.lightState].map(x => (x || '').trim()).filter(Boolean).join(' · ');
        pushKeeper({
          id: uid(), tag,
          intent: [intentText, meta].filter(Boolean).join(' — '),
          imagePath: savedPath, imageUrl: hit.filePath,
          sourceUrl: hit.url || undefined, sourceName: 'HJEN REF',
          why: '', take: '', leave: '', palette: 'mid',
        });
        keptForTag++;
        log(set, 'kept', `✓ HJEN REF · «${tag}» — ${meta || 'Saudi frame'}`);
      }
      log(set, 'end', `HJEN REF · «${tag}» — kept ${keptForTag}`);
      if (doneOwner === 'ref') bumpDone();
    }
  };

  // ── phase B · browser lanes ──
  const phaseBrowser = async () => {
    if (browserSources.length === 0) return;
    hunterPov = await getPOV(projectId).catch(() => null);
    if (!hunterPov) {
      // No brief/treatment on this project yet — a hand-added query must still
      // hunt. Build a minimal POV from the queries themselves and say so.
      const queryLine = queue.join(' · ');
      hunterPov = {
        essence: `A reference hunt driven by the user's own queries: ${queryLine}.`,
        register: 'Neutral — no project register formed yet.',
        audience: 'The photographer themselves, culling by eye.',
        visualLanguage: 'Judge literal scene content against each query; favor cinematic single frames over graphics, posters, or text cards.',
        forbidden: ['stock-photo gloss', 'watermarked frames', 'UI screenshots'],
        northStar: `Does the frame literally show: ${queryLine}?`,
        formedFrom: { brief: false, treatment: false, screenplay: false },
        formedAt: new Date().toISOString(),
      };
      emitToast(set, 'No brief or treatment yet — judging against your queries only.');
      log(set, 'info', 'no project POV — judging against the queries themselves');
    }
    setPhase(set, 'Opening your Chrome…');
    const launch = await window.hjen.chromeLaunch({ url: firstHome(browserSources) });
    if (!launch.ok) { emitToast(set, launch.message); log(set, 'info', `Chrome: ${launch.message}`); return; }
    await sleep(1200);
    if (abort.cancelled) return;
    const wantLanes = Math.min(laneCount, queue.length);
    setPhase(set, `Opening ${wantLanes} lane${wantLanes === 1 ? '' : 's'}…`);
    const first = await window.hjen.chromePage({ port: launch.port });
    if (first.ok) sessions.push({ cdp: await connectCdp(first.wsUrl), targetId: first.targetId });
    for (let i = sessions.length; i < wantLanes; i++) {
      const tab = await window.hjen.chromeNewTab({ port: launch.port, url: firstHome(browserSources) });
      if (tab.ok) { try { sessions.push({ cdp: await connectCdp(tab.wsUrl), targetId: tab.targetId }); } catch { /* dead tab */ } }
    }
    if (sessions.length === 0) { emitToast(set, 'Could not open any Chrome tab — is Chrome still open?'); return; }
    setPhase(set, `Hunting across ${sessions.length} lane${sessions.length === 1 ? '' : 's'}`);
    set({ lanes: sessions.map((_, i) => ({ id: i + 1, query: null, stage: 'idle' })) });

    // shared queue — each lane pulls the next tag until drained.
    let qi = 0;
    const takeTag = (): string | null => (qi < queue.length ? queue[qi++] : null);
    await Promise.all(sessions.map(async ({ cdp }, i) => {
      let tag: string | null;
      while (!abort.cancelled && (tag = takeTag()) !== null) await runTag(i + 1, cdp, tag);
    }));
  };

  try {
    setPhase(set, useRefLib && !isMotion ? 'Searching the internal library + opening Chrome…' : 'Opening Chrome…');
    // REQUIREMENT 5 — both phases run CONCURRENTLY: HJEN REF frames land within
    // seconds while Chrome is still opening.
    await Promise.all([phaseRef(), phaseBrowser()]);

    const kept = get().kept;
    try { void useStore.getState().addLedgerEntry({ kind: 'note', body: `References: hunted ${queue.length} queries → kept ${kept} frames (${imageType}${useRefLib ? ', +HJEN REF' : ''})${abort.cancelled ? ' — stopped by the user' : ''}.` }); } catch { /* ledger best-effort */ }
    if (abort.cancelled) { log(set, 'stop', `stopped by the user — ${kept} kept`); emitToast(set, `Hunt stopped — ${kept} frame(s) kept.`); }
    else { log(set, 'phase', `hunt complete — ${kept} kept`); emitToast(set, kept > 0 ? `Hunt done — ${kept} frame(s) kept. Check every Leave line.` : 'Hunt done — nothing cleared the bar. Log into Frameset, enable HJEN REF, or loosen the judge.'); }
    setPhase(set, abort.cancelled ? 'Stopped' : 'Done');
  } catch (e) {
    log(set, 'info', `hunt error: ${String((e as Error)?.message || e)}`);
    setPhase(set, 'Error');
  } finally {
    // close the extra lane tabs; leave lane 1 (the user's window) open.
    for (let i = 1; i < sessions.length; i++) {
      try { sessions[i].cdp.close(); } catch { /* gone */ }
      if (sessions[i].targetId) void window.hjen.chromeCloseTab({ targetId: sessions[i].targetId! });
    }
    try { sessions[0]?.cdp.close(); } catch { /* gone */ }
    await flushChain.catch(() => {});      // make sure the last keeper landed on disk
    set({ running: false, finishedAt: Date.now(), lanes: [] });
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const firstHome = (browserSources: RefSource[]): string => {
  const first = browserSources[0];
  if (!first) return 'https://frameset.app';
  try { return new URL(first.urlTemplate.replace('{query}', 'x')).origin; } catch { return first.urlTemplate; }
};

const trim = (s: string): string => (s || '').trim().slice(0, 140);

