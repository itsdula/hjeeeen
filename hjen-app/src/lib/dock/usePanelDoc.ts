// The two-window sync protocol, once, for both panel kinds.
//
// A panel document (a mood board, a sequence) can be open in the dock AND in
// its detached window at the same time. The file on disk is the truth; every
// write broadcasts; every window decides for itself whether to listen.
//
//     writer                                 reader(s)
//     mutate → rev++ → debounce 400ms        onDocChanged(d)
//            → docWrite({…, sourceId})         sourceId === MY_SOURCE → ignore (own echo)
//     main: rev-on-disk > rev-in → refuse      kind/docId not mine    → ignore
//           { ok:false, 'stale', doc }         mid-gesture            → defer to pointerup
//           → REBASE: winner + pending ops     else                   → re-read from disk
//
// Two rules make this correct rather than merely hopeful:
//
//  1 · SOURCE_ID. One per window, module scope, never changes. Without the echo
//      filter each window's own write bounces back and stomps the state it just
//      produced — mid-drag that reads as boxes snapping backwards.
//
//  2 · REBASE, not clobber. Every edit is kept as a pure function until it is
//      safely on disk. If main refuses a write as stale, we re-apply the
//      pending functions on top of the winner instead of throwing either side
//      away. Losing the race costs an extra write, never the work.
//
// The ownership rule in RefDock (a detached document is not editable in the
// dock) means this machinery is a safety net, not the main path.

import { useCallback, useEffect, useRef, useState } from 'react';

export type PanelKind = 'moodboard' | 'timeline';

/** Everything a panel document must carry for the store to reason about it. */
export interface PanelDocBase {
  id: string;
  name: string;
  rev: number;
  updatedAt?: string;
}

/** One window's identity for the whole session. */
export const SOURCE_ID = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const SAVE_DEBOUNCE_MS = 400;

export interface PanelDocHandle<T extends PanelDocBase> {
  doc: T | null;
  loaded: boolean;
  error: string | null;
  /** True for a beat after another window's change was pulled in. */
  reloaded: boolean;
  /** Mutate, bump rev, schedule a write. The function must be pure. */
  edit: (fn: (d: T) => T) => void;
  /** Write now — project switch, window close, before a destructive action. */
  flush: () => Promise<void>;
  /** Hold off cross-window reloads for the length of a pointer gesture, so the
   *  other window's autosave cannot yank a box out from under the cursor. */
  setInteracting: (v: boolean) => void;
  /** Re-read from disk, discarding nothing (pending ops are re-applied). */
  reload: () => Promise<void>;
}

export function usePanelDoc<T extends PanelDocBase>(
  kind: PanelKind,
  projectId: string | null,
  docId: string | null,
  opts?: { allowEmpty?: boolean },
): PanelDocHandle<T> {
  // The document is stored WITH the identity it belongs to.
  //
  // Without that pairing there is a render — the one right after the caller
  // switches kind or document — where `doc` still holds the OLD document while
  // the props already describe the new one. A mood board handed to the timeline
  // panel is not a cosmetic glitch: it reaches sequenceDuration(), throws
  // "tracks is not iterable" out of a useMemo, and takes the whole React tree
  // down with it. A separate `loaded` boolean cannot fix this, because it is
  // set in an effect and therefore lags by exactly that one render.
  const [entry, setEntry] = useState<{ key: string; doc: T } | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloaded, setReloaded] = useState(false);

  // The last state we know is on disk, plus every edit since. `doc` is always
  // ops.reduce(base) — kept as state only so React re-renders.
  const baseRef = useRef<T | null>(null);
  const opsRef = useRef<Array<(d: T) => T>>([]);
  const docRef = useRef<T | null>(null);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const interactingRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const allowEmpty = opts?.allowEmpty ?? false;

  const key = projectId && docId ? `${kind}:${projectId}:${docId}` : null;
  // The ONLY document this render may show. A document belonging to a different
  // key is treated as absent, not as stale-but-usable.
  const doc = entry && key && entry.key === key ? entry.doc : null;
  const loaded = loadedKey === key;

  docRef.current = doc;

  // ── load ──
  const load = useCallback(async () => {
    if (!key || !projectId || !docId) { setEntry(null); baseRef.current = null; setLoadedKey(key); return; }
    try {
      const res = await window.hjen.docRead({ id: projectId, kind, docId });
      if (res.ok) {
        const fresh = res.doc as T;
        baseRef.current = fresh;
        // Re-apply anything edited while the read was in flight.
        setEntry({ key, doc: opsRef.current.reduce((d, f) => f(d), fresh) });
        setError(null);
      } else if (res.reason === 'not_found') {
        setEntry(null); baseRef.current = null;
        setError(null);
      } else {
        setError(res.message || 'Could not open that document.');
      }
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      setLoadedKey(key);
    }
  }, [key, kind, projectId, docId]);

  useEffect(() => {
    opsRef.current = [];
    void load();
  }, [load]);

  // ── save ──
  const writeNow = useCallback(async (): Promise<void> => {
    if (!projectId || !docId) return;
    const next = docRef.current;
    if (!next || opsRef.current.length === 0) return;
    if (savingRef.current) return;
    savingRef.current = true;
    const sent = opsRef.current.slice();          // what this write covers
    try {
      let res = await window.hjen.docWrite({ id: projectId, kind, docId, doc: next, sourceId: SOURCE_ID, allowEmpty });
      if (!res.ok && res.reason === 'stale' && res.doc) {
        // REBASE — the other window won. Re-apply our ops on top of its result
        // and try once more. Never a silent loss on either side.
        const winner = res.doc as T;
        const rebased = sent.reduce((d, f) => f(d), winner);
        const bumped = { ...rebased, rev: Math.max(winner.rev ?? 0, rebased.rev ?? 0) + 1 };
        res = await window.hjen.docWrite({ id: projectId, kind, docId, doc: bumped, sourceId: SOURCE_ID, allowEmpty });
        if (res.ok) {
          baseRef.current = { ...bumped, rev: res.rev };
          // Drop only the ops this write covered — anything typed since stays.
          opsRef.current = opsRef.current.slice(sent.length);
          if (key) setEntry({ key, doc: opsRef.current.reduce((d, f) => f(d), baseRef.current as T) });
          setError(null);
          return;
        }
      }
      if (res.ok) {
        baseRef.current = { ...next, rev: res.rev };
        opsRef.current = opsRef.current.slice(sent.length);
        setError(null);
      } else if (res.reason === 'refused_empty_overwrite') {
        // The guard did its job. Re-read so the UI shows what actually survived
        // rather than the empty state it thought it had.
        setError('That would have emptied the document — reloaded from disk instead.');
        opsRef.current = [];
        await load();
      } else {
        setError(`Could not save: ${res.reason || 'unknown'}`);
      }
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      savingRef.current = false;
    }
  }, [key, kind, projectId, docId, allowEmpty, load]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void writeNow(); }, SAVE_DEBOUNCE_MS);
  }, [writeNow]);

  const edit = useCallback((fn: (d: T) => T) => {
    const cur = docRef.current;
    if (!cur || !key) return;
    const bump = (d: T): T => { const n = fn(d); return n === d ? d : { ...n, rev: (d.rev ?? 0) + 1 }; };
    const next = bump(cur);
    if (next === cur) return;
    opsRef.current.push(bump);
    docRef.current = next;
    setEntry({ key, doc: next });
    schedule();
  }, [key, schedule]);

  const flush = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    await writeNow();
  }, [writeNow]);

  const reload = useCallback(async () => {
    await load();
    setReloaded(true);
    window.setTimeout(() => setReloaded(false), 1400);
  }, [load]);

  const setInteracting = useCallback((v: boolean) => {
    interactingRef.current = v;
    if (!v && pendingReloadRef.current) {
      pendingReloadRef.current = false;
      void reload();
    }
  }, [reload]);

  // ── another window changed this document ──
  useEffect(() => {
    if (!key) return;
    const off = window.hjen.onDocChanged?.(d => {
      if (d.sourceId === SOURCE_ID) return;                                   // own echo
      if (d.kind !== kind || d.docId !== docId || d.projectId !== projectId) return;
      if ((baseRef.current?.rev ?? 0) >= d.rev) return;                        // already have it
      if (interactingRef.current) { pendingReloadRef.current = true; return; } // not mid-gesture
      void reload();
    });
    return off;
  }, [key, kind, docId, projectId, reload]);

  // ── never leave an edit only in memory ──
  useEffect(() => {
    const onBeforeUnload = () => { void writeNow(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
      void writeNow();          // project switch / unmount
    };
  }, [writeNow]);

  return { doc, loaded, error, reloaded, edit, flush, setInteracting, reload };
}
