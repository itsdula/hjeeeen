// The Asset store — one project's characters, locations, props and wardrobe.
//
// Backed by stage 6 of the project contract ({slug}/_project/06_assets/
// manifest.json) through the existing readStageData / writeStageData. No
// electron/main change was needed: write-stage-data already mkdir -p's the
// subfolder, and rewriteProjectPaths() repairs the absolute plate paths when a
// project is renamed.
//
// Shaped after store/storyboardStore.ts, which solved the same problems first:
//   • in-flight state keyed PER PROJECT, so a build started in project A keeps
//     reading as "making" after you navigate away and never bleeds into B
//   • debounced persist with an empty-overwrite guard
//   • reloadFromDisk() for writes that arrive from MCP
//
// The four views mount this; the Frame recall path and the MCP action read it.

import { create } from 'zustand';
import type {
  Asset, AssetKind, AssetPlate, AssetsData, AssetStatus, PlateRole,
} from '../types/assets';
import { emptyAssets, MULTI_ROLES } from '../types/assets';

const PERSIST_DEBOUNCE_MS = 400;

/** Stable id. Date.now() + a random tail is what every other store here uses. */
function mkId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** @tag names must be unique within a project — the prompt, the mention
 *  autocomplete and the model's "match 'Mubarak'" instruction all key off the
 *  name, so two assets sharing one is a silent identity merge. */
function uniqueName(assets: Asset[], want: string, selfId?: string): string {
  const base = (want || 'Untitled').trim() || 'Untitled';
  const taken = new Set(assets.filter(a => a.id !== selfId).map(a => a.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 999; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${mkId('x').slice(-4)}`;
}

interface AssetsStore {
  projectId: string | null;
  data: AssetsData | null;
  loaded: boolean;

  /** Per-project, per-asset in-flight counter — key `${projectId}::${assetId}`.
   *  Drives the "making" plate skeletons and survives navigation. */
  pending: Record<string, number>;
  /** Projects currently running a build-all. */
  makingAllIds: string[];

  open: (projectId: string) => Promise<void>;
  reloadFromDisk: () => Promise<void>;
  flush: () => void;

  // ── assets ──
  addAsset: (kind: AssetKind, name: string, seed?: Partial<Asset>) => Asset | null;
  updateAsset: (id: string, patch: Partial<Asset>) => void;
  removeAsset: (id: string) => void;
  /** Wardrobe → character. Passing null unbinds. */
  bindTo: (id: string, parentId: string | null) => void;

  // ── plates ──
  /** Append a plate and point `active` at it. Never overwrites history. */
  addPlate: (assetId: string, plate: Omit<AssetPlate, 'id'>) => AssetPlate | null;
  /** Move the active pointer for a role to an existing plate. */
  setActivePlate: (assetId: string, role: PlateRole, plateId: string) => void;
  removePlate: (assetId: string, plateId: string) => void;

  // ── in-flight ──
  bumpPending: (assetId: string, delta: number) => void;
  setStatus: (assetId: string, status: AssetStatus, error?: string) => void;

  // ── reads ──
  byKind: (kind: AssetKind) => Asset[];
  get: (id: string) => Asset | undefined;
  /** Wardrobe assets bound to a character. */
  childrenOf: (characterId: string) => Asset[];
}

let persistTimer: number | null = null;

const pendKey = (pid: string, id: string) => `${pid}::${id}`;

/** Persist to stage 6, debounced.
 *
 *  WRITE GUARD: refuse to replace a non-empty manifest on disk with an empty
 *  one. An empty in-memory list is almost always a load that hasn't landed or
 *  a project switch mid-flight, not a real "the user deleted everything" — and
 *  the cost of being wrong is the whole asset library. Deliberate deletion down
 *  to zero still persists, because removeAsset() writes through `force`. */
async function persist(projectId: string, data: AssetsData, force = false): Promise<void> {
  try {
    if (!force && data.assets.length === 0) {
      const disk = (await window.hjen.readStageData({ id: projectId, stage: 6 })) as AssetsData | null;
      if (disk && Array.isArray(disk.assets) && disk.assets.length > 0) return;   // refuse
    }
    await window.hjen.writeStageData({
      id: projectId, stage: 6,
      data: { ...data, updatedAt: new Date().toISOString() },
    });
  } catch { /* a failed write must never take the UI down */ }
}

export const useAssets = create<AssetsStore>((set, get) => {
  /** Schedule a debounced write for the CURRENT project. */
  const schedule = (force = false) => {
    const { projectId, data } = get();
    if (!projectId || !data) return;
    if (persistTimer) window.clearTimeout(persistTimer);
    const pid = projectId;
    const snapshot = data;
    persistTimer = window.setTimeout(() => { void persist(pid, snapshot, force); }, PERSIST_DEBOUNCE_MS);
  };

  /** Apply a patch to one asset and schedule a write. */
  const patchAsset = (id: string, build: (a: Asset) => Partial<Asset>) => {
    set(s => {
      if (!s.data) return s;
      const assets = s.data.assets.map(a =>
        a.id === id ? { ...a, ...build(a), updatedAt: new Date().toISOString() } : a);
      return { data: { ...s.data, assets } };
    });
    schedule();
  };

  return {
    projectId: null,
    data: null,
    loaded: false,
    pending: {},
    makingAllIds: [],

    async open(projectId: string) {
      // Drop any pending write from the PREVIOUS project before switching, or
      // its debounced snapshot lands in the new project's manifest.
      if (persistTimer) { window.clearTimeout(persistTimer); persistTimer = null; }
      set({ projectId, data: null, loaded: false });
      let loaded: AssetsData | null = null;
      try {
        const raw = (await window.hjen.readStageData({ id: projectId, stage: 6 })) as AssetsData | null;
        if (raw && typeof raw === 'object' && Array.isArray(raw.assets)) loaded = raw;
      } catch { /* fresh board */ }
      // A late read for a project we've already navigated away from must not win.
      if (get().projectId !== projectId) return;
      set({ data: loaded ?? emptyAssets(), loaded: true });
    },

    async reloadFromDisk() {
      const pid = get().projectId;
      if (!pid) return;
      try {
        const raw = (await window.hjen.readStageData({ id: pid, stage: 6 })) as AssetsData | null;
        if (raw && Array.isArray(raw.assets) && get().projectId === pid) set({ data: raw });
      } catch { /* keep what we have */ }
    },

    flush() {
      const { projectId, data } = get();
      if (!projectId || !data) return;
      if (persistTimer) { window.clearTimeout(persistTimer); persistTimer = null; }
      void persist(projectId, data);
    },

    // ── assets ──────────────────────────────────────────────────
    addAsset(kind, name, seed) {
      const { data } = get();
      if (!data) return null;
      const now = new Date().toISOString();
      const asset: Asset = {
        id: mkId(kind.slice(0, 4)),
        kind,
        name: uniqueName(data.assets, name),
        spec: {},
        negatives: [],
        anchor: '',
        plates: [],
        active: {},
        sourceRefs: [],
        status: 'draft',
        createdAt: now,
        updatedAt: now,
        ...(kind === 'location' ? { binding: 'style' as const } : {}),
        ...(kind === 'wardrobe' ? { photoType: 'ghost' as const } : {}),
        ...seed,
      };
      set(s => (s.data ? { data: { ...s.data, assets: [...s.data.assets, asset] } } : s));
      schedule();
      return asset;
    },

    updateAsset(id, patch) {
      patchAsset(id, (a) => (
        patch.name !== undefined
          ? { ...patch, name: uniqueName(get().data?.assets ?? [], patch.name, a.id) }
          : patch
      ));
    },

    removeAsset(id) {
      set(s => {
        if (!s.data) return s;
        // Unbind any wardrobe hanging off a character being removed, rather
        // than orphaning it to a parentId that no longer resolves.
        const assets = s.data.assets
          .filter(a => a.id !== id)
          .map(a => (a.parentId === id ? { ...a, parentId: undefined } : a));
        return { data: { ...s.data, assets } };
      });
      schedule(true);   // a real deletion may legitimately empty the list
    },

    bindTo(id, parentId) {
      patchAsset(id, () => ({ parentId: parentId ?? undefined }));
    },

    // ── plates ──────────────────────────────────────────────────
    addPlate(assetId, plate) {
      const asset = get().get(assetId);
      if (!asset) return null;
      const full: AssetPlate = { ...plate, id: mkId('plate') };
      patchAsset(assetId, (a) => ({
        plates: [...a.plates, full],
        // Single-slot roles point at the newest build. Multi-roles (inserts,
        // swatches) accumulate and carry no single active pointer.
        active: MULTI_ROLES.includes(full.role) ? a.active : { ...a.active, [full.role]: full.id },
        status: 'built',
        error: undefined,
      }));
      return full;
    },

    setActivePlate(assetId, role, plateId) {
      patchAsset(assetId, (a) => (
        a.plates.some(p => p.id === plateId && p.role === role)
          ? { active: { ...a.active, [role]: plateId } }
          : {}
      ));
    },

    removePlate(assetId, plateId) {
      patchAsset(assetId, (a) => {
        const plates = a.plates.filter(p => p.id !== plateId);
        const active = { ...a.active };
        // If the pointer referenced the removed plate, fall back to the newest
        // surviving plate for that role rather than leaving a dangling id.
        for (const [role, id] of Object.entries(active)) {
          if (id !== plateId) continue;
          const fallback = [...plates].reverse().find(p => p.role === role);
          if (fallback) active[role as PlateRole] = fallback.id;
          else delete active[role as PlateRole];
        }
        return { plates, active, status: plates.length ? a.status : 'draft' };
      });
    },

    // ── in-flight ───────────────────────────────────────────────
    bumpPending(assetId, delta) {
      const pid = get().projectId;
      if (!pid) return;
      const key = pendKey(pid, assetId);
      set(s => {
        const next = { ...s.pending };
        const v = (next[key] ?? 0) + delta;
        if (v <= 0) delete next[key]; else next[key] = v;
        return { pending: next };
      });
    },

    setStatus(assetId, status, error) {
      patchAsset(assetId, () => ({ status, error }));
    },

    // ── reads ───────────────────────────────────────────────────
    byKind(kind) {
      return (get().data?.assets ?? []).filter(a => a.kind === kind);
    },
    get(id) {
      return (get().data?.assets ?? []).find(a => a.id === id);
    },
    childrenOf(characterId) {
      return (get().data?.assets ?? []).filter(a => a.parentId === characterId);
    },
  };
});

/** How many builds are in flight for one asset in the CURRENT project. */
export function usePendingCount(assetId: string): number {
  return useAssets(s => (s.projectId ? (s.pending[pendKey(s.projectId, assetId)] ?? 0) : 0));
}
