import { create } from 'zustand';
import { useStore } from '../store';
import type {
  StoryboardData,
  StoryboardShot,
  StoryboardStep,
  StoryboardRefSlot,
  StoryboardTake,
  CustomBoard,
} from '../types/storyboard';
import { emptyStoryboard, panelId } from '../types/storyboard';
import {
  buildPanelPrompt,
  buildFacePrompt,
  buildSheetPrompt,
  buildPlacePrompt,
  buildElementPrompt,
  buildPresetSamplePrompt,
  buildSafeAssetPrompt,
  buildSafePanelPrompt,
} from '../lib/storyboardPrompt';
import { presetById, resolvePreset, isCustomLookId, nextCustomBoardId, STORYBOARD_PRESETS } from '../lib/storyboardPresets';
import { breakdownScript, extractCastAndPlaces } from '../lib/storyboardLlm';
import { syncStagesToCreativeGraph } from '../lib/creativegraph/stageSync';
import { nodeOf } from '../lib/creativegraph/projectGraph';
import { projectionPrompt, type StoryboardProjection } from '../lib/creativegraph/technicalCompiler';
import { generateImage, generateWithReferences } from '../lib/openai';
import { generateWithGemini, generateWithGeminiImage } from '../lib/gemini';
import { cropImageToTarget } from '../lib/cropImage';
import { MODELS, mapQuality, resolveSize } from '../lib/models';
import { gatewayConf, readLayerB64 } from '../lib/frameGen';

export function uid(prefix = 'sb'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type RefKind = 'characters' | 'places' | 'elements';

const BOARD_RESOLUTION = '1MP' as const;
/** Frames AND assets both make 8 at a time (user request). */
const FRAME_CONCURRENCY = 8;
const ASSET_CONCURRENCY = 8;
/** Refs per panel cap — face+sheet per character add up; gpt-image-2 takes ~16. */
const MAX_PANEL_REFS = 12;

interface StoryboardStore {
  projectId: string | null;
  data: StoryboardData | null;
  loaded: boolean;

  open: (projectId: string) => Promise<void>;
  /** Re-read the active board from disk (e.g. after an MCP write) WITHOUT the
   *  open() flash and WITHOUT clearing an in-flight 'making' status. */
  reloadFromDisk: () => Promise<void>;
  close: () => void;

  patch: (patch: Partial<StoryboardData>) => void;
  setStep: (step: StoryboardStep) => void;

  // dedicated storyboard panel preview (not the Frame product lightbox)
  previewShotId: string | null;
  openPanel: (id: string) => void;
  closePanel: () => void;
  stepPanel: (dir: -1 | 1) => void;

  // dedicated asset preview (character/place/element)
  previewAsset: { kind: RefKind; id: string } | null;
  openAsset: (kind: RefKind, id: string) => void;
  closeAsset: () => void;

  // shots
  addShot: (afterId?: string) => void;
  updateShot: (id: string, patch: Partial<StoryboardShot>) => void;
  removeShot: (id: string) => void;
  moveShot: (id: string, dir: -1 | 1) => void;
  reorderByDrag: (draggedId: string, targetId: string) => void;
  replaceShots: (shots: StoryboardShot[]) => void;
  clearBreakdown: () => void;

  // LLM breakdown / cast — in-flight state tracked PER PROJECT (by id) so the
  // work survives step navigation, doesn't disable another project's button,
  // and applies even if you switch projects mid-run.
  breakingDownIds: string[];
  findingCastIds: string[];
  runBreakdown: () => Promise<{ ok: boolean; message?: string }>;
  findCast: () => Promise<{ ok: boolean; message?: string }>;

  // refs (characters / places / elements)
  addRef: (kind: RefKind, name?: string) => void;
  updateRef: (kind: RefKind, id: string, patch: Partial<StoryboardRefSlot>) => void;
  removeRef: (kind: RefKind, id: string) => void;

  // GLOBAL custom board-look library — shared across every storyboard project.
  boardLooks: CustomBoard[];
  loadBoardLooks: () => Promise<void>;
  addBoardLook: () => string;                                  // returns the new look id
  updateBoardLook: (id: string, patch: Partial<CustomBoard>) => void;
  removeBoardLook: (id: string) => void;

  // board-look samples (a real example per preset so clients can SEE the look)
  makingPreviews: boolean;
  makingPreviewIds: string[];      // which preset/board ids are making a sample right now
  makePresetSample: (presetId: string) => Promise<void>;
  makePresetSamples: () => Promise<void>;

  // make assets (reference images from the breakdown)
  makeAsset: (kind: RefKind, id: string) => Promise<void>;
  makeAssets: () => Promise<void>;
  selectAssetTake: (kind: RefKind, id: string, take: import('../types/storyboard').StoryboardAssetTake) => void;

  // make panels
  makeShot: (id: string) => Promise<void>;
  makeAll: () => Promise<void>;
  stopMaking: () => void;
  selectTake: (shotId: string, take: StoryboardTake) => void;

  // ── in-flight state, tracked PER PROJECT so it survives navigation ──
  // (a generation started in project A keeps showing as "making" when you
  //  leave and come back, and never bleeds into project B).
  makingAllIds: string[];          // projects running make-all
  makingAssetIds: string[];        // projects running make-assets
  /** Per-project per-target pending counter — key `${projectId}::${id}`. Drives the "making" tiles. */
  pendingTakes: Record<string, number>;

  flush: () => void;
}

let persistTimer: number | null = null;
/** Cooperative cancel PER PROJECT — stops dispatching new make jobs for that
 *  project; in-flight ones finish. A run in project A is unaffected by stopping B. */
const cancelTokens: Record<string, { cancelled: boolean }> = {};
let previewToken = { cancelled: false };           // board-look sample making (not project-tied)
function tokenFor(pid: string): { cancelled: boolean } {
  cancelTokens[pid] = { cancelled: false };
  return cancelTokens[pid];
}
// per-project helpers for the in-flight registries
const pendKey = (pid: string, id: string) => `${pid}::${id}`;
function addId(list: string[], id: string): string[] { return list.includes(id) ? list : [...list, id]; }
function dropId(list: string[], id: string): string[] { return list.filter(x => x !== id); }

export const useStoryboard = create<StoryboardStore>((set, get) => ({
  projectId: null,
  data: null,
  loaded: false,
  boardLooks: [],
  makingPreviews: false,
  makingPreviewIds: [],
  makingAllIds: [],
  makingAssetIds: [],
  breakingDownIds: [],
  findingCastIds: [],
  previewShotId: null,
  previewAsset: null,
  pendingTakes: {},

  async open(projectId: string) {
    if (persistTimer) { window.clearTimeout(persistTimer); persistTimer = null; }  // drop any pending write from the previous project
    set({ projectId, loaded: false, data: null });
    let loaded: StoryboardData | null = null;
    try {
      const raw = (await window.hjen.readStoryboard({ id: projectId })) as StoryboardData | null;
      if (raw && typeof raw === 'object') {
        // Hard guard: a stamped file from a DIFFERENT project means corruption /
        // a stray write — never show it. Discard to a fresh board.
        if (raw.projectId && raw.projectId !== projectId) {
          loaded = null;
        } else {
          try {
            loaded = clearStaleMaking(sanitizeForeign(migrateCustomBoards({ ...emptyStoryboard(), ...raw }), projectId));
          } catch {
            // A transform bug must NEVER discard the user's board. Fall back to
            // the raw data verbatim (still has every shot) rather than a blank.
            loaded = { ...emptyStoryboard(), ...raw, projectId };
          }
        }
      }
    } catch { /* empty */ }
    if (get().projectId !== projectId) return;
    const fresh = loaded ?? emptyStoryboard();
    fresh.projectId = projectId;       // stamp
    set({ data: fresh, loaded: true });
    if (loaded) get().flush();          // persist the cleaned + stamped copy
    void get().loadBoardLooks();        // refresh the global look library (+ migrate any local looks)
  },

  async reloadFromDisk() {
    const pid = get().projectId;
    if (!pid) return;
    try {
      const raw = (await window.hjen.readStoryboard({ id: pid })) as StoryboardData | null;
      // Only accept a board stamped for THIS project. Keep 'making' statuses the
      // MCP just wrote (don't run clearStaleMaking) so the live spinner shows.
      if (raw && typeof raw === 'object' && (!raw.projectId || raw.projectId === pid)) {
        set({ data: { ...emptyStoryboard(), ...raw, projectId: pid }, loaded: true });
      }
    } catch { /* leave current board */ }
  },

  close() {
    // Leaving the project does NOT cancel its generation — it keeps running in
    // the background (project-scoped), and results are written to that project's
    // file even while you're elsewhere. The per-project making registry persists.
    if (persistTimer) { window.clearTimeout(persistTimer); persistTimer = null; }
    set({ projectId: null, data: null, loaded: false, previewShotId: null, previewAsset: null });
  },

  patch(patch) {
    const cur = get().data;
    if (!cur) return;
    const next: StoryboardData = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    set({ data: next });
    schedulePersist(get);
  },

  setStep(step) { get().patch({ step }); },

  openPanel(id) { set({ previewShotId: id }); },
  closePanel() { set({ previewShotId: null }); },
  openAsset(kind, id) { set({ previewAsset: { kind, id } }); },
  closeAsset() { set({ previewAsset: null }); },
  stepPanel(dir) {
    const data = get().data;
    const cur = get().previewShotId;
    if (!data || !cur) return;
    const i = data.shots.findIndex(s => s.id === cur);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= data.shots.length) return;
    set({ previewShotId: data.shots[j].id });
  },

  addShot(afterId) {
    const cur = get().data;
    if (!cur) return;
    const shots = [...cur.shots];
    const idx = afterId ? shots.findIndex(s => s.id === afterId) : shots.length - 1;
    const prev = idx >= 0 ? shots[idx] : undefined;
    const scene = prev?.scene ?? 1;
    const letters = shots.filter(s => s.scene === scene).map(s => s.letter);
    const shot: StoryboardShot = { id: uid('shot'), scene, letter: nextPanelLetter(letters), description: '', status: 'pending' };
    shots.splice(idx >= 0 ? idx + 1 : shots.length, 0, shot);
    get().patch({ shots });
  },

  updateShot(id, patch) {
    const cur = get().data;
    if (!cur) return;
    get().patch({ shots: cur.shots.map(s => (s.id === id ? { ...s, ...patch } : s)) });
  },

  removeShot(id) {
    const cur = get().data;
    if (!cur) return;
    get().patch({ shots: cur.shots.filter(s => s.id !== id) });
  },

  moveShot(id, dir) {
    const cur = get().data;
    if (!cur) return;
    const shots = [...cur.shots];
    const i = shots.findIndex(s => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= shots.length) return;
    [shots[i], shots[j]] = [shots[j], shots[i]];
    get().patch({ shots });
  },

  reorderByDrag(draggedId, targetId) {
    const cur = get().data;
    if (!cur || draggedId === targetId) return;
    const shots = [...cur.shots];
    const from = shots.findIndex(s => s.id === draggedId);
    const to = shots.findIndex(s => s.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = shots.splice(from, 1);
    shots.splice(to, 0, moved);
    get().patch({ shots });
  },

  replaceShots(shots) { get().patch({ shots }); },

  clearBreakdown() { get().patch({ shots: [], characters: [], places: [], elements: [] }); },

  async runBreakdown() {
    const data = get().data;
    const pid = get().projectId;
    if (!data || !pid || get().breakingDownIds.includes(pid)) return { ok: false };
    set(s => ({ breakingDownIds: [...s.breakingDownIds, pid] }));
    try {
      const graph = await syncStagesToCreativeGraph(pid);
      const handoff = nodeOf<StoryboardProjection>(graph, 'projection:storyboard')?.payload;
      const r = await breakdownScript(data.scriptText, handoff ? projectionPrompt(handoff) : '');
      if (!r.ok) return { ok: false, message: r.message };
      if (get().projectId === pid) {
        get().replaceShots(r.shots);             // active project — live update
      } else {
        // switched away mid-run — save the result straight to its own file so it isn't lost
        try { await window.hjen.writeStoryboard({ id: pid, data: { ...data, shots: r.shots, projectId: pid } }); } catch { /* best-effort */ }
      }
      return { ok: true };
    } finally {
      set(s => ({ breakingDownIds: s.breakingDownIds.filter(x => x !== pid) }));
      if (get().projectId === pid) get().flush();
    }
  },

  async findCast() {
    const data = get().data;
    const pid = get().projectId;
    if (!data || !pid || get().findingCastIds.includes(pid)) return { ok: false };
    set(s => ({ findingCastIds: [...s.findingCastIds, pid] }));
    try {
      const r = await extractCastAndPlaces(data.scriptText, data.shots);
      if (!r.ok) return { ok: false, message: r.message };
      // Merge into the project's current data — live if active, else its captured snapshot.
      const active = get().projectId === pid;
      const cur = active ? get().data! : data;
      const mergeBy = (existing: StoryboardRefSlot[], found: StoryboardRefSlot[]) => {
        const have = new Set(existing.map(x => x.name.trim().toLowerCase()));
        return [...existing, ...found.filter(f => !have.has(f.name.trim().toLowerCase()))];
      };
      const mergedChars = mergeBy(cur.characters, r.characters);
      const mergedPlaces = mergeBy(cur.places, r.places);
      const mergedElems = mergeBy(cur.elements, r.elements);
      const idByName = (list: StoryboardRefSlot[]) => {
        const m = new Map<string, string>();
        for (const s of list) m.set(s.name.trim().toLowerCase(), s.id);
        return m;
      };
      const cMap = idByName(mergedChars), pMap = idByName(mergedPlaces), eMap = idByName(mergedElems);
      const mapNames = (names: string[] | undefined, m: Map<string, string>) =>
        (names ?? []).map(n => m.get(n.trim().toLowerCase())).filter((x): x is string => !!x);
      const nextShots = cur.shots.map(s => {
        const a = r.assignments[`${s.scene}${s.letter}`];
        if (!a) return s;
        return {
          ...s,
          characterIds: Array.from(new Set([...(s.characterIds ?? []), ...mapNames(a.characters, cMap)])),
          placeIds: Array.from(new Set([...(s.placeIds ?? []), ...mapNames(a.places, pMap)])),
          elementIds: Array.from(new Set([...(s.elementIds ?? []), ...mapNames(a.elements, eMap)])),
        };
      });
      if (active) {
        get().patch({ characters: mergedChars, places: mergedPlaces, elements: mergedElems, shots: nextShots });
      } else {
        try { await window.hjen.writeStoryboard({ id: pid, data: { ...cur, characters: mergedChars, places: mergedPlaces, elements: mergedElems, shots: nextShots, projectId: pid } }); } catch { /* best-effort */ }
      }
      return { ok: true };
    } finally {
      set(s => ({ findingCastIds: s.findingCastIds.filter(x => x !== pid) }));
    }
  },

  addRef(kind, name) {
    const cur = get().data;
    if (!cur) return;
    const prefix = kind === 'characters' ? 'char' : kind === 'places' ? 'place' : 'el';
    const slot: StoryboardRefSlot = { id: uid(prefix), name: name ?? '' };
    get().patch({ [kind]: [...cur[kind], slot] } as Partial<StoryboardData>);
  },

  updateRef(kind, id, patch) {
    const cur = get().data;
    if (!cur) return;
    get().patch({ [kind]: cur[kind].map(r => (r.id === id ? { ...r, ...patch } : r)) } as Partial<StoryboardData>);
  },

  removeRef(kind, id) {
    const cur = get().data;
    if (!cur) return;
    get().patch({ [kind]: cur[kind].filter(r => r.id !== id) } as Partial<StoryboardData>);
  },

  // ── global board-look library ───────────────────────────────────
  async loadBoardLooks() {
    try {
      const res = await window.hjen.readBoardLooks();
      let looks: CustomBoard[] = res.ok && Array.isArray(res.looks) ? (res.looks as CustomBoard[]) : [];
      // One-time migration: fold any project-local customBoards into the global
      // library (older projects stored looks per-project).
      const local = get().data?.customBoards ?? [];
      if (local.length) {
        const have = new Set(looks.map(l => l.id));
        const merged = [...looks];
        for (const b of local) if (!have.has(b.id)) merged.push(b);
        if (merged.length !== looks.length) { looks = merged; void window.hjen.writeBoardLooks({ looks }); }
      }
      set({ boardLooks: looks });
    } catch { set({ boardLooks: [] }); }
  },
  addBoardLook() {
    const looks = get().boardLooks;
    const id = nextCustomBoardId(looks);
    const next = [...looks, { id, refs: [] }];
    set({ boardLooks: next });
    void window.hjen.writeBoardLooks({ looks: next });
    return id;
  },
  updateBoardLook(id, patch) {
    const next = get().boardLooks.map(b => b.id === id ? { ...b, ...patch } : b);
    set({ boardLooks: next });
    void window.hjen.writeBoardLooks({ looks: next });    // immediate — survives navigation
  },
  removeBoardLook(id) {
    const next = get().boardLooks.filter(b => b.id !== id);
    set({ boardLooks: next });
    void window.hjen.writeBoardLooks({ looks: next });
    // if the active project was using it, fall back to the default preset
    if (get().data?.presetId === id) get().patch({ presetId: 'graphite' });
  },

  // ── board-look samples ──────────────────────────────────────────
  async makePresetSample(presetId) {
    await genPreview(get, presetId);
    get().flush();
  },

  async makePresetSamples() {
    const data = get().data;
    if (!data || get().makingPreviews) return;
    previewToken = { cancelled: false };
    const token = previewToken;
    set({ makingPreviews: true });
    try {
      const missing = STORYBOARD_PRESETS.filter(p => !(data.presetSamples ?? {})[p.id]);
      await runPool(missing.map(p => () => genPreview(get, p.id)), ASSET_CONCURRENCY, token);
    } finally {
      set({ makingPreviews: false });
      get().flush();
    }
  },

  // ── assets ──────────────────────────────────────────────────────
  async makeAsset(kind, id) {
    await makeOneAsset(get, kind, id);
    get().flush();
  },

  async makeAssets() {
    const data = get().data; const proj = activeStoryboardProject(); const pid = get().projectId;
    if (!data || !proj || !pid || get().makingAssetIds.includes(pid)) return;
    const token = tokenFor(pid);
    const ctx: GenCtx = { pid, slug: proj.slug, data };
    set(s => ({ makingAssetIds: addId(s.makingAssetIds, pid) }));
    try {
      // Order the user asked for: characters (face+sheet), then places, then elements.
      await runPool(data.characters.map(c => () => makeOneAsset(get, 'characters', c.id, ctx)), ASSET_CONCURRENCY, token);
      if (token.cancelled) return;
      await runPool(data.places.map(p => () => makeOneAsset(get, 'places', p.id, ctx)), ASSET_CONCURRENCY, token);
      if (token.cancelled) return;
      await runPool(data.elements.map(e => () => makeOneAsset(get, 'elements', e.id, ctx)), ASSET_CONCURRENCY, token);
    } finally {
      set(s => ({ makingAssetIds: dropId(s.makingAssetIds, pid) }));
      if (get().projectId === pid) get().flush();
    }
  },

  // ── panels ──────────────────────────────────────────────────────
  async makeShot(id) {
    await makeOnePanel(get, id);
    get().flush();
  },

  async makeAll() {
    const data = get().data; const proj = activeStoryboardProject(); const pid = get().projectId;
    if (!data || !proj || !pid || get().makingAllIds.includes(pid)) return;
    const token = tokenFor(pid);
    const ctx: GenCtx = { pid, slug: proj.slug, data };
    // Only the ones still missing or failed — never re-make panels already done.
    const targets = data.shots.filter(s => !s.generatedImagePath || s.status === 'failed');
    if (targets.length === 0) return;
    set(s => ({ makingAllIds: addId(s.makingAllIds, pid) }));
    try {
      await runPool(targets.map(s => () => makeOnePanel(get, s.id, ctx)), FRAME_CONCURRENCY, token);
    } finally {
      set(s => ({ makingAllIds: dropId(s.makingAllIds, pid) }));
      if (get().projectId === pid) get().flush();
    }
  },

  stopMaking() {
    // Cancel only the CURRENT project's run; other projects keep going.
    const pid = get().projectId;
    if (pid && cancelTokens[pid]) cancelTokens[pid].cancelled = true;
    previewToken.cancelled = true;
    if (pid) set(s => ({ makingAllIds: dropId(s.makingAllIds, pid), makingAssetIds: dropId(s.makingAssetIds, pid) }));
    set({ makingPreviews: false });
  },

  selectTake(shotId, take) {
    get().updateShot(shotId, { generatedImagePath: take.imgPath, thumbPath: take.thumbPath, generatedJsonPath: take.jsonPath, status: 'made' });
  },

  selectAssetTake(kind, id, take) {
    if (kind === 'characters') {
      get().updateRef(kind, id, { faceImagePath: take.faceImagePath, faceThumbPath: take.faceThumbPath, sheetImagePath: take.sheetImagePath, sheetThumbPath: take.sheetThumbPath, refImagePath: take.faceImagePath, assetStatus: 'made' });
    } else {
      get().updateRef(kind, id, { refImagePath: take.refImagePath, thumbPath: take.thumbPath, assetStatus: 'made' });
    }
  },

  flush() {
    if (persistTimer) { window.clearTimeout(persistTimer); persistTimer = null; }
    void persistNow(get);
  },
}));

// ─── shared generation core ───────────────────────────────────────

interface GenOut { imgPath: string; jsonPath: string; thumbPath: string }

const sbSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll the async storyboard job until rendered. Fully async: the server renders
 *  in the background (no Cloudflare ceiling in play), so no abort/timing — poll to
 *  done/error. The timeout is only a safety backstop, well above any real render. */
async function pollBoardAsync(gw: { url: string; token: string }, jobId: string): Promise<any> {
  const started = Date.now();
  const TIMEOUT_MS = 15 * 60 * 1000; // backstop only
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${gw.token}` };
  for (;;) {
    await sbSleep(3000);
    if (Date.now() - started > TIMEOUT_MS) throw new Error('Storyboard asset timed out after 15 minutes — please try again.');
    let r: Response;
    try { r = await fetch(`${gw.url}/api/storyboard/poll`, { method: 'POST', headers, body: JSON.stringify({ jobId }) }); }
    catch { continue; } // transient network — keep polling
    const pj: any = await r.json().catch(() => ({}));
    if (pj?.status === 'done' && pj?.b64) return pj;
    if (pj?.status === 'error') throw new Error(pj?.message || 'Storyboard failed.');
    // 'pending' → keep polling
  }
}

async function runGen(
  get: () => StoryboardStore,
  opts: { prompt: string; refPaths: string[]; slug: string; sidecar: Record<string, any>; fallbackPrompt?: string; req?: any },
  ctx?: GenCtx,
): Promise<GenOut> {
  // Use the captured context (project the make started in) when present, so the
  // image is saved into the correct project even after navigating away.
  const data = ctx?.data ?? get().data!;
  const projectSlug = ctx?.slug ?? activeStoryboardProject()!.slug;
  const model = data.model ?? 'GPT_IMAGE_2';
  const spec = MODELS[model];
  const aspect = data.aspect ?? '16:9';
  const size = resolveSize(model, aspect, BOARD_RESOLUTION);
  const quality = mapQuality(model, data.quality ?? 'HIGH');
  const refs = opts.refPaths.filter(Boolean).slice(0, MAX_PANEL_REFS);

  // Gateway mode (web + distributed desktop): compose + generate on the SERVER —
  // the board recipe never ships or crosses the wire, and the server retries the
  // wholesome fallback on a safety rejection. Offline keeps the local path below.
  const gw = spec.provider === 'openai' && opts.req ? await gatewayConf() : null;
  let result: { b64: string; size: string };
  if (gw) {
    const layerPayload: Array<{ b64: string; mime: string; filename: string }> = [];
    for (const rp of refs) {
      const bt = await readLayerB64(rp);
      if (bt) layerPayload.push({ b64: bt.b64, mime: bt.mime, filename: rp.split('/').pop() || 'ref.png' });
    }
    // FULLY ASYNC (same as Frame): submit returns a jobId in ms; the server renders
    // in the BACKGROUND (no Cloudflare ~100s ceiling in play) and we poll until done.
    // No abort, no timing — a HIGH board asset can take as long as it needs.
    const recoverJob = `sb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const sub = await fetch(`${gw.url}/api/storyboard/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gw.token}`, 'x-hjen-job': recoverJob },
      body: JSON.stringify({ req: opts.req, layers: layerPayload, settings: { model, aspect, resolution: BOARD_RESOLUTION, quality: data.quality ?? 'HIGH' } }),
    });
    const sj: any = await sub.json().catch(() => ({}));
    if (!sub.ok || !sj?.jobId) throw new Error(sj?.message || `Storyboard failed (HTTP ${sub.status})`);
    const j = await pollBoardAsync(gw, String(sj.jobId));
    result = { b64: j.b64, size: j.apiSize };
  } else {
    // Hard ceiling so a stalled request can't hang "making" forever.
    const TIMEOUT_MS = 500_000;
    const withTimeout = <T>(p: Promise<T>): Promise<T> => Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Timed out after 500s — the model stalled. Try again, lower Quality to Draft, or make another.')), TIMEOUT_MS)),
    ]);
    const call = (prompt: string) => withTimeout(
      spec.provider === 'openai'
        ? (refs.length
            ? generateWithReferences({ prompt, size: size.apiSize, quality: quality as 'low' | 'medium' | 'high', modelId: spec.apiModelId, referenceFilePaths: refs })
            : generateImage({ prompt, size: size.apiSize, quality: quality as 'low' | 'medium' | 'high', modelId: spec.apiModelId }))
        : spec.api === 'generateContent'
          // The Gemini image door DOES take references — the board's identity
          // locks (face → sheet → place) now survive on this model too.
          ? generateWithGeminiImage({ prompt, width: size.targetWidth, height: size.targetHeight, apiModelId: spec.apiModelId, referenceFilePaths: refs })
          // Imagen (:predict) is text-to-image only — references are ignored.
          : generateWithGemini({ prompt, width: size.targetWidth, height: size.targetHeight, quality, apiModelId: spec.apiModelId }),
    );
    try {
      result = await call(opts.prompt);
    } catch (err: any) {
      const msg = String(err?.message || err).toLowerCase();
      const isSafety = msg.includes('safety') || msg.includes('rejected') || msg.includes('moderation') || msg.includes('content policy') || msg.includes('content_policy');
      if (isSafety && opts.fallbackPrompt) {
        // Auto-retry once with a stripped, extra-wholesome prompt — handles the
        // safety filter's false positives on child/family characters.
        result = await call(opts.fallbackPrompt);
      } else {
        throw err;
      }
    }
  }

  let b64 = result.b64;
  const [aw, ah] = result.size.split('x').map(Number);
  if (Math.abs((aw / ah) - (size.targetWidth / size.targetHeight)) > 0.01 || aw !== size.targetWidth) {
    try { b64 = await cropImageToTarget(result.b64, size.targetWidth, size.targetHeight); }
    catch { /* keep raw */ }
  }

  // Save into the storyboard's own area so panels/assets never appear inside
  // the Frames product gallery, the Projects count, or the usage log.
  const saved = await window.hjen.saveStoryboardImage({
    base64: b64,
    promptSlug: opts.slug,
    projectSlug,
    sidecar: { captured: new Date().toISOString(), model: spec.label, prompt: gw ? '' : opts.prompt, size: `${size.targetWidth}x${size.targetHeight}`, references: opts.refPaths, ...opts.sidecar },
  });
  return { imgPath: saved.imgPath, jsonPath: saved.jsonPath, thumbPath: (saved as any).thumbPath ?? saved.imgPath };
}

// ─── board-look sample (one per preset, cached) ───────────────────

async function genPreview(get: () => StoryboardStore, presetId: string): Promise<void> {
  const data0 = get().data;
  const project = activeStoryboardProject();
  if (!data0 || !project) return;
  const preset = resolvePreset(presetId, get().boardLooks);
  // Always gpt-image-2, low quality, square — fast + cheap + reference-free.
  const size = resolveSize('GPT_IMAGE_2', '1:1', BOARD_RESOLUTION);
  useStoryboard.setState(s => ({ makingPreviewIds: addId(s.makingPreviewIds, presetId) }));
  try {
    // Gateway mode: compose the sample on the server (recipe hidden); offline local.
    const gw = await gatewayConf();
    let result: { b64: string; size: string };
    if (gw) {
      const resp = await fetch(`${gw.url}/api/storyboard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${gw.token}` },
        body: JSON.stringify({ req: { kind: 'sample', presetId: preset.id, preset: isCustomLookId(preset.id) ? preset : undefined }, layers: [], settings: { model: 'GPT_IMAGE_2', aspect: '1:1', resolution: BOARD_RESOLUTION, quality: 'LOW' } }),
      });
      let j: any = {};
      try { j = await resp.json(); } catch { /* non-json */ }
      if (!resp.ok || !j.ok) throw new Error(j?.message || 'sample failed');
      result = { b64: j.b64, size: j.apiSize };
    } else {
      result = await generateImage({ prompt: buildPresetSamplePrompt(preset), size: size.apiSize, quality: 'low', modelId: 'gpt-image-2' });
    }
    let b64 = result.b64;
    const [aw, ah] = result.size.split('x').map(Number);
    if (aw !== size.targetWidth || ah !== size.targetHeight) {
      try { b64 = await cropImageToTarget(result.b64, size.targetWidth, size.targetHeight); } catch { /* keep */ }
    }
    const saved = await window.hjen.saveStoryboardImage({
      base64: b64,
      promptSlug: `look-${presetId}`,
      projectSlug: project.slug,
      sidecar: { captured: new Date().toISOString(), kind: 'storyboard-look-sample', preset: presetId, promptTitle: `Look — ${preset.label}` },
    });
    const cur = get().data;
    if (cur) get().patch({ presetSamples: { ...(cur.presetSamples ?? {}), [presetId]: saved.imgPath } });
  } catch { /* preview failures are non-fatal */ }
  finally { useStoryboard.setState(s => ({ makingPreviewIds: dropId(s.makingPreviewIds, presetId) })); }
}

// ─── make one asset ───────────────────────────────────────────────

async function makeOneAsset(get: () => StoryboardStore, kind: RefKind, id: string, ctx?: GenCtx): Promise<void> {
  let context = ctx;
  if (!context) {
    const d = get().data; const proj = activeStoryboardProject(); const pidNow = get().projectId;
    if (!d || !proj || !pidNow) return;
    context = { pid: pidNow, slug: proj.slug, data: d };
  }
  const { pid, data: data0 } = context;
  const preset = resolvePreset(data0.presetId, get().boardLooks);
  const stylePlate = effectiveStylePlates(data0, get().boardLooks);

  // Capture the CURRENT version up front (from the captured project data).
  const start = data0[kind].find(x => x.id === id);
  if (!start) return;

  bumpPending(pid, id, +1);
  await applyRefPatch(get, pid, kind, id, () => ({ assetStatus: 'making', assetError: undefined }));

  // A client-supplied source reference (if any) drives the design and is
  // attached FIRST (highest priority), ahead of the board-style plate.
  const src = start.sourceRefPath;
  const fromRef = !!src;
  const baseRefs = src ? [src, ...stylePlate] : stylePlate;

  try {
    if (kind === 'characters') {
      const face = await runGen(get, {
        prompt: buildFacePrompt(start, preset, data0.styleNote, fromRef),
        fallbackPrompt: buildSafeAssetPrompt(start.name, 'face', preset, data0.styleNote),
        refPaths: baseRefs,
        slug: `face-${slugName(start.name)}`,
        sidecar: { kind: 'storyboard-face', name: start.name, promptTitle: `Face — ${start.name}` },
        req: { kind: 'face', slot: { name: start.name, note: start.note }, presetId: preset.id, preset: isCustomLookId(preset.id) ? preset : undefined, styleNote: data0.styleNote, fromRef },
      }, context);
      const sheet = await runGen(get, {
        prompt: buildSheetPrompt(start, preset, data0.styleNote, fromRef),
        fallbackPrompt: buildSafeAssetPrompt(start.name, 'sheet', preset, data0.styleNote),
        refPaths: src ? [src, face.imgPath, ...stylePlate] : [face.imgPath, ...stylePlate],
        slug: `sheet-${slugName(start.name)}`,
        sidecar: { kind: 'storyboard-sheet', name: start.name, promptTitle: `Sheet — ${start.name}` },
        req: { kind: 'sheet', slot: { name: start.name, note: start.note }, presetId: preset.id, preset: isCustomLookId(preset.id) ? preset : undefined, styleNote: data0.styleNote, fromRef },
      }, context);
      await applyRefPatch(get, pid, kind, id, (cur) => {
        const wasEmpty = !cur.faceImagePath && !cur.sheetImagePath;
        const takes = [...(cur.takes ?? [])];
        if ((cur.faceImagePath || cur.sheetImagePath) && !takes.some(t => t.faceImagePath === cur.faceImagePath && t.sheetImagePath === cur.sheetImagePath)) {
          takes.push({ faceImagePath: cur.faceImagePath, faceThumbPath: cur.faceThumbPath, sheetImagePath: cur.sheetImagePath, sheetThumbPath: cur.sheetThumbPath, ts: 0 });
        }
        const fresh = { faceImagePath: face.imgPath, faceThumbPath: face.thumbPath, sheetImagePath: sheet.imgPath, sheetThumbPath: sheet.thumbPath, ts: Date.now() };
        takes.push(fresh);
        return wasEmpty ? { ...fresh, refImagePath: face.imgPath, takes, assetStatus: 'made' } : { takes, assetStatus: 'made' };
      });
    } else {
      const out = kind === 'places'
        ? await runGen(get, { prompt: buildPlacePrompt(start, preset, data0.styleNote, fromRef), fallbackPrompt: buildSafeAssetPrompt(start.name, 'place', preset, data0.styleNote), refPaths: baseRefs, slug: `place-${slugName(start.name)}`, sidecar: { kind: 'storyboard-place', name: start.name, promptTitle: `Place — ${start.name}` }, req: { kind: 'place', slot: { name: start.name, note: start.note }, presetId: preset.id, preset: isCustomLookId(preset.id) ? preset : undefined, styleNote: data0.styleNote, fromRef } }, context)
        : await runGen(get, { prompt: buildElementPrompt(start, preset, data0.styleNote, fromRef), fallbackPrompt: buildSafeAssetPrompt(start.name, 'element', preset, data0.styleNote), refPaths: baseRefs, slug: `element-${slugName(start.name)}`, sidecar: { kind: 'storyboard-element', name: start.name, promptTitle: `Element — ${start.name}` }, req: { kind: 'element', slot: { name: start.name, note: start.note }, presetId: preset.id, preset: isCustomLookId(preset.id) ? preset : undefined, styleNote: data0.styleNote, fromRef } }, context);
      await applyRefPatch(get, pid, kind, id, (cur) => {
        const takes = [...(cur.takes ?? [])];
        if (cur.refImagePath && !takes.some(t => t.refImagePath === cur.refImagePath)) takes.push({ refImagePath: cur.refImagePath, thumbPath: cur.thumbPath, ts: 0 });
        takes.push({ refImagePath: out.imgPath, thumbPath: out.thumbPath, ts: Date.now() });
        return !cur.refImagePath ? { refImagePath: out.imgPath, thumbPath: out.thumbPath, takes, assetStatus: 'made' } : { takes, assetStatus: 'made' };
      });
    }
  } catch (err: any) {
    await applyRefPatch(get, pid, kind, id, () => ({ assetStatus: 'failed', assetError: String(err?.message || err).slice(0, 300) }));
  } finally {
    bumpPending(pid, id, -1);
  }
}

// ─── make one panel ───────────────────────────────────────────────

function bumpPending(pid: string, id: string, delta: number) {
  const key = pendKey(pid, id);
  const cur = (useStoryboard.getState().pendingTakes[key] ?? 0) + delta;
  useStoryboard.setState(s => {
    const next = { ...s.pendingTakes };
    if (cur <= 0) delete next[key]; else next[key] = cur;
    return { pendingTakes: next };
  });
}

/** Generation context captured at dispatch — so a make started in project A
 *  reads A's settings and writes to A's file even after the user switches away. */
interface GenCtx { pid: string; slug: string; data: StoryboardData; }

/** Apply a shot patch to the RIGHT project: live if it's active, else straight
 *  to its file on disk (so background results are never lost on navigation). */
async function applyShotPatch(get: () => StoryboardStore, pid: string, shotId: string, build: (shot: StoryboardShot) => Partial<StoryboardShot>): Promise<void> {
  if (get().projectId === pid && get().data) {
    const shot = get().data!.shots.find(s => s.id === shotId);
    if (shot) get().updateShot(shotId, build(shot));
    return;
  }
  try {
    const raw = await window.hjen.readStoryboard({ id: pid }) as StoryboardData | null;
    if (!raw || !Array.isArray(raw.shots)) return;
    const shot = raw.shots.find(s => s.id === shotId);
    if (!shot) return;
    const next = { ...raw, shots: raw.shots.map(s => s.id === shotId ? { ...s, ...build(s) } : s), updatedAt: new Date().toISOString(), projectId: pid };
    await window.hjen.writeStoryboard({ id: pid, data: next });
  } catch { /* best-effort */ }
}

/** Apply a ref (asset) patch to the right project — live or on disk. */
async function applyRefPatch(get: () => StoryboardStore, pid: string, kind: RefKind, id: string, build: (slot: StoryboardRefSlot) => Partial<StoryboardRefSlot>): Promise<void> {
  if (get().projectId === pid && get().data) {
    const slot = get().data![kind].find(r => r.id === id);
    if (slot) get().updateRef(kind, id, build(slot));
    return;
  }
  try {
    const raw = await window.hjen.readStoryboard({ id: pid }) as StoryboardData | null;
    if (!raw || !Array.isArray(raw[kind])) return;
    const slot = raw[kind].find(r => r.id === id);
    if (!slot) return;
    const next = { ...raw, [kind]: raw[kind].map(r => r.id === id ? { ...r, ...build(r) } : r), updatedAt: new Date().toISOString(), projectId: pid };
    await window.hjen.writeStoryboard({ id: pid, data: next });
  } catch { /* best-effort */ }
}

async function makeOnePanel(get: () => StoryboardStore, shotId: string, ctx?: GenCtx): Promise<void> {
  // Capture the project context at dispatch so the result lands in the right
  // project even if the user navigates away mid-generation.
  let context = ctx;
  if (!context) {
    const data = get().data; const proj = activeStoryboardProject(); const pidNow = get().projectId;
    if (!data || !proj || !pidNow) return;
    context = { pid: pidNow, slug: proj.slug, data };
  }
  const { pid, data } = context;
  const shot = data.shots.find(s => s.id === shotId);
  if (!shot) return;

  bumpPending(pid, shotId, +1);
  await applyShotPatch(get, pid, shotId, () => ({ status: 'making', error: undefined }));
  try {
    // Resolve refs: explicit tags MERGED with name-detected slots, so every
    // character/place/element actually present in the frame is referenced even
    // if the shot was never hand-tagged. This is what makes the board continuous.
    const charIds = mergeIds(shot.characterIds, detectSlots(shot, data.characters));
    const placeIds = mergeIds(shot.placeIds, detectSlots(shot, data.places));
    const elemIds = mergeIds(shot.elementIds, detectSlots(shot, data.elements));
    const chars = charIds.map(cid => data.characters.find(c => c.id === cid)).filter((c): c is StoryboardRefSlot => !!c);
    const places = placeIds.map(plid => data.places.find(p => p.id === plid)).filter((p): p is StoryboardRefSlot => !!p);
    const elements = elemIds.map(eid => data.elements.find(e => e.id === eid)).filter((e): e is StoryboardRefSlot => !!e);
    const preset = resolvePreset(data.presetId, get().boardLooks);
    const prompt = buildPanelPrompt(shot, chars, places, elements, preset, data.styleNote);

    // Reference order: character identity (face → sheet) first, then places, then elements, then style plate.
    const refPaths: string[] = [];
    for (const c of chars) { if (c.faceImagePath) refPaths.push(c.faceImagePath); else if (c.refImagePath) refPaths.push(c.refImagePath); }
    for (const c of chars) { if (c.sheetImagePath) refPaths.push(c.sheetImagePath); }
    for (const p of places) { if (p.refImagePath) refPaths.push(p.refImagePath); }
    for (const e of elements) { if (e.refImagePath) refPaths.push(e.refImagePath); }
    refPaths.push(...effectiveStylePlates(data, get().boardLooks));

    const pnl = panelId(shot);
    const out = await runGen(get, {
      prompt,
      fallbackPrompt: buildSafePanelPrompt(shot, preset, data.styleNote),
      refPaths,
      slug: `panel-${pnl}`,
      sidecar: { kind: 'storyboard-panel', panel: pnl, scene: shot.scene, promptTitle: `Panel ${pnl}` },
      req: { kind: 'panel', shot, characters: chars.map(c => ({ name: c.name, note: c.note })), places: places.map(p => ({ name: p.name, note: p.note })), elements: elements.map(e => ({ name: e.name, note: e.note })), presetId: preset.id, preset: isCustomLookId(preset.id) ? preset : undefined, styleNote: data.styleNote },
    }, context);
    // Keep every take — Refine never destroys the previous frame.
    await applyShotPatch(get, pid, shotId, (cur) => {
      const wasEmpty = !cur.generatedImagePath;
      const takes = [...(cur.takes ?? [])];
      if (cur.generatedImagePath && !takes.some(t => t.imgPath === cur.generatedImagePath)) {
        takes.push({ imgPath: cur.generatedImagePath, thumbPath: cur.thumbPath, jsonPath: cur.generatedJsonPath, ts: 0 });
      }
      takes.push({ imgPath: out.imgPath, thumbPath: out.thumbPath, jsonPath: out.jsonPath, ts: Date.now() });
      // First-ever take auto-approves; otherwise just add it to the strip.
      return wasEmpty
        ? { generatedImagePath: out.imgPath, generatedJsonPath: out.jsonPath, thumbPath: out.thumbPath, takes, status: 'made', error: undefined }
        : { takes, status: 'made', error: undefined };
    });
  } catch (err: any) {
    await applyShotPatch(get, pid, shotId, () => ({ status: 'failed', error: String(err?.message || err).slice(0, 300) }));
  } finally {
    bumpPending(pid, shotId, -1);
  }
}

// ─── concurrency pool with cooperative cancel ─────────────────────

async function runPool(tasks: Array<() => Promise<void>>, concurrency: number, token: { cancelled: boolean }): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (true) {
      if (token.cancelled) return;
      const i = cursor++;
      if (i >= tasks.length) return;
      try { await tasks[i](); } catch { /* per-task errors already captured */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length || 1) }, worker));
}

// ─── persistence ──────────────────────────────────────────────────

function schedulePersist(get: () => StoryboardStore) {
  if (persistTimer) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => { void persistNow(get); }, 350);
}

async function persistNow(get: () => StoryboardStore) {
  const { projectId, data } = get();
  if (!projectId || !data) return;
  // Never write data stamped for a different project (race guard).
  if (data.projectId && data.projectId !== projectId) return;
  try { await window.hjen.writeStoryboard({ id: projectId, data: { ...data, projectId } }); } catch { /* best-effort */ }
}

/** Reset any 'making' status left over from a previous session (no generation is
 *  actually running) so the UI doesn't show a stuck spinner forever. */
// Forward-migrate the old single-custom-look fields (+ a legacy single ref in
// presetStyleRefs['custom']) into the customBoards[] array. Idempotent.
function migrateCustomBoards(data: StoryboardData): StoryboardData {
  if (data.customBoards && data.customBoards.length) return data;
  const legacyRefs = data.customLookRefs?.length
    ? data.customLookRefs
    : (data.presetStyleRefs?.['custom'] ? [data.presetStyleRefs['custom']] : []);
  const hasLegacy = !!(data.customLookName || data.customLookNote || legacyRefs.length);
  if (!hasLegacy) return { ...data, customBoards: [] };
  return {
    ...data,
    customBoards: [{ id: 'custom', name: data.customLookName, note: data.customLookNote, refs: legacyRefs }],
  };
}

function clearStaleMaking(data: StoryboardData): StoryboardData {
  const fixSlot = (s: StoryboardRefSlot): StoryboardRefSlot =>
    s.assetStatus === 'making' ? { ...s, assetStatus: (s.faceImagePath || s.refImagePath) ? 'made' : 'pending' } : s;
  return {
    ...data,
    shots: data.shots.map(s => s.status === 'making' ? { ...s, status: s.generatedImagePath ? 'made' : 'pending' } : s),
    characters: data.characters.map(fixSlot),
    places: data.places.map(fixSlot),
    elements: data.elements.map(fixSlot),
  };
}

/** Strip any GENERATED image path that lives under a DIFFERENT project's folder.
 *  Self-heals files that picked up another project's references; leaves
 *  user-supplied paths (logos, manually-attached refs that may sit anywhere)
 *  alone unless they clearly belong to another project. */
function sanitizeForeign(data: StoryboardData, projectId: string): StoryboardData {
  const projects = useStore.getState().projects;
  const currentSlug = projects.find(p => p.id === projectId)?.slug ?? '';
  const otherSlugs = projects.filter(p => p.id !== projectId).map(p => p.slug).filter(Boolean);
  if (!otherSlugs.length) return data;
  const foreign = (p?: string) => !!p && !p.includes(`/${currentSlug}/`) && otherSlugs.some(s => p.includes(`/${s}/`));
  const keep = (p?: string) => (foreign(p) ? undefined : p);
  const cleanSlot = (s: StoryboardRefSlot): StoryboardRefSlot => {
    const wasForeign = foreign(s.refImagePath) || foreign(s.faceImagePath) || foreign(s.sheetImagePath);
    return {
      ...s,
      refImagePath: keep(s.refImagePath), thumbPath: keep(s.thumbPath),
      faceImagePath: keep(s.faceImagePath), faceThumbPath: keep(s.faceThumbPath),
      sheetImagePath: keep(s.sheetImagePath), sheetThumbPath: keep(s.sheetThumbPath),
      assetStatus: wasForeign ? 'pending' : s.assetStatus,
    };
  };
  const presetSamples: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.presetSamples ?? {})) if (!foreign(v)) presetSamples[k] = v;
  const presetStyleRefs: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.presetStyleRefs ?? {})) if (!foreign(v)) presetStyleRefs[k] = v;
  return {
    ...data,
    characters: data.characters.map(cleanSlot),
    places: data.places.map(cleanSlot),
    elements: data.elements.map(cleanSlot),
    shots: data.shots.map(sh => foreign(sh.generatedImagePath)
      ? { ...sh, generatedImagePath: undefined, generatedJsonPath: undefined, thumbPath: undefined, status: sh.status === 'made' ? 'pending' : sh.status }
      : sh),
    presetSamples,
    presetStyleRefs,
    customBoards: (data.customBoards ?? []).map(b => ({ ...b, refs: (b.refs ?? []).filter(p => !foreign(p)) })),
  };
}

// ─── helpers ──────────────────────────────────────────────────────

export function activeStoryboardProject() {
  const id = useStoryboard.getState().projectId;
  if (!id) return null;
  return useStore.getState().projects.find(p => p.id === id) ?? null;
}

// The style reference(s) attached to the active look — one for a bundled preset,
// one OR MORE for the active custom board. Returned as an array, appended last.
function effectiveStylePlates(data: StoryboardData, boardLooks: CustomBoard[]): string[] {
  if (isCustomLookId(data.presetId)) {
    const board = boardLooks.find(b => b.id === data.presetId);
    return (board?.refs ?? []).filter(Boolean);
  }
  const one = data.presetStyleRefs?.[data.presetId ?? 'graphite'] ?? data.styleRefImagePath;
  return one ? [one] : [];
}

/** Text of a shot we scan for character/place/element names. */
function shotText(shot: StoryboardShot): string {
  return `${shot.description} ${shot.character ?? ''} ${shot.blocking ?? ''} ${shot.frameFurniture ?? ''} ${shot.dialogue ?? ''}`.toLowerCase();
}

/** A slot is "present" in a shot if its name (or all its significant words)
 *  appears in the shot text. Detection regex wins when provided. */
function slotInText(slot: StoryboardRefSlot, text: string): boolean {
  if (slot.detectRegex) { try { if (new RegExp(slot.detectRegex, 'i').test(text)) return true; } catch { /* ignore bad regex */ } }
  const n = slot.name.trim().toLowerCase();
  if (!n) return false;
  if (text.includes(n)) return true;
  const words = n.split(/\s+/).filter(w => w.length >= 4);
  return words.length > 0 && words.every(w => text.includes(w));
}

function detectSlots(shot: StoryboardShot, slots: StoryboardRefSlot[]): string[] {
  const t = shotText(shot);
  return slots.filter(s => slotInText(s, t)).map(s => s.id);
}

function mergeIds(explicit: string[] | undefined, detected: string[]): string[] {
  return Array.from(new Set([...(explicit ?? []), ...detected]));
}

/** The cast/places/elements actually referenced by a shot (explicit tags merged
 *  with name-detected). Exported for the panel preview. */
export function resolveShotSlots(data: StoryboardData, shot: StoryboardShot): {
  characters: StoryboardRefSlot[]; places: StoryboardRefSlot[]; elements: StoryboardRefSlot[];
} {
  const pick = (ids: string[], list: StoryboardRefSlot[]) =>
    ids.map(id => list.find(s => s.id === id)).filter((s): s is StoryboardRefSlot => !!s);
  return {
    characters: pick(mergeIds(shot.characterIds, detectSlots(shot, data.characters)), data.characters),
    places: pick(mergeIds(shot.placeIds, detectSlots(shot, data.places)), data.places),
    elements: pick(mergeIds(shot.elementIds, detectSlots(shot, data.elements)), data.elements),
  };
}

function slugName(name: string): string {
  return (name || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'untitled';
}

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function nextPanelLetter(used: string[]): string {
  const set = new Set(used.map(u => u.toUpperCase()));
  for (let i = 0; i < ALPHA.length; i++) if (!set.has(ALPHA[i])) return ALPHA[i];
  for (let i = 0; i < ALPHA.length; i++) for (let j = 0; j < ALPHA.length; j++) {
    const c = ALPHA[i] + ALPHA[j];
    if (!set.has(c)) return c;
  }
  return `X${used.length}`;
}
