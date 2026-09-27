// The mood board surface — the same component whether it is docked inside
// References or living in its own detached window.
//
// Everything here is hand-rolled pointer work on React 18: the app has no
// canvas library and adding one would be its first UI dependency. The pieces it
// reuses are the ones already proven elsewhere:
//   · zoomAtPoint / fitTransform / SCALE_BOUNDS  ← components/node/viewport.ts
//   · the transform layer + dot grid             ← NodeView
//   · window-listener drags, live preview, ONE commit on release  ← PitchView

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fitTransform, zoomAtPoint } from '../node/viewport';
import {
  MIN_SIZE, dropOffset, itemsBBox, normRect, rectsOverlap, resizeRect,
  type Handle, type Rect,
} from '../../lib/moodboard/geometry';
import { takeRefDragPayload, type PendingMedia } from '../../lib/dock/dragPayload';
import { moodKindForPath, type MoodBoard, type MoodItem } from '../../types/moodboard';
import { MoodItemView } from './MoodItemView';
import '../../styles/moodboard.css';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Longest edge a freshly-dropped picture gets, in board space. */
const DROP_LONG_EDGE = 320;
const NOTE_SIZE = { w: 240, h: 160 };

type Gesture =
  | { kind: 'move'; ids: string[]; from: { x: number; y: number }; start: Record<string, Rect> }
  | { kind: 'resize'; id: string; handle: Handle; from: { x: number; y: number }; base: Rect; aspect?: number }
  | { kind: 'pan'; from: { x: number; y: number }; pan0: { x: number; y: number } }
  | { kind: 'marquee'; from: { x: number; y: number }; additive: boolean };

export function MoodBoardCanvas({ board, edit, setInteracting, projectId, onToast, pending, onPendingConsumed }: {
  board: MoodBoard;
  edit: (fn: (d: MoodBoard) => MoodBoard) => void;
  setInteracting: (v: boolean) => void;
  projectId: string | null;
  onToast: (msg: string) => void;
  /** Frames handed over WITHOUT a drag — the "Send to Board" route. */
  pending?: PendingMedia[] | null;
  onPendingConsumed?: () => void;
}) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState(() => board.view?.pan ?? { x: 0, y: 0 });
  const [scale, setScale] = useState(() => board.view?.scale ?? 1);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [dropActive, setDropActive] = useState(false);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  /** Live geometry during a gesture. Never written to the document until the
   *  pointer is released, so a drag is ONE undo step and ONE disk write. */
  const [live, setLive] = useState<Record<string, Rect> | null>(null);

  const gestureRef = useRef<Gesture | null>(null);
  const liveRef = useRef<Record<string, Rect> | null>(null);
  const spaceRef = useRef(false);
  const panRef = useRef(pan);
  const scaleRef = useRef(scale);
  const itemsRef = useRef(board.items);
  const undoRef = useRef<MoodItem[][]>([]);

  liveRef.current = live;
  panRef.current = pan;
  scaleRef.current = scale;
  itemsRef.current = board.items;

  const items = board.items;
  const painted = useMemo(() => [...items].sort((a, b) => a.z - b.z), [items]);
  const maxZ = useMemo(() => items.reduce((m, i) => Math.max(m, i.z), 0), [items]);

  // ── camera ────────────────────────────────────────────────────────────────
  const toBoard = useCallback((cx: number, cy: number) => {
    const r = boardRef.current?.getBoundingClientRect();
    return {
      x: (cx - (r?.left ?? 0) - panRef.current.x) / scaleRef.current,
      y: (cy - (r?.top ?? 0) - panRef.current.y) / scaleRef.current,
    };
  }, []);

  // The wheel listener must be NATIVE and non-passive. React's onWheel is
  // passive, so preventDefault() inside it is a no-op and the whole window
  // rubber-bands instead of the board panning. (Same reason NodeView does this.)
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const t = zoomAtPoint(
          { pan: panRef.current, scale: scaleRef.current },
          1 - e.deltaY * 0.0015,
          e.clientX - r.left, e.clientY - r.top,
        );
        setScale(t.scale); setPan(t.pan);
      } else if (e.shiftKey) {
        setPan(p => ({ x: p.x - (e.deltaY || e.deltaX), y: p.y }));
      } else {
        setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Camera is a VIEW preference, not work: persisted lazily so panning around
  // does not churn `rev` and wake the other window on every frame.
  useEffect(() => {
    const t = window.setTimeout(() => {
      edit(d => ({ ...d, view: { pan: panRef.current, scale: scaleRef.current } }));
    }, 1500);
    return () => clearTimeout(t);
  }, [pan, scale, edit]);

  const fit = useCallback(() => {
    const r = boardRef.current?.getBoundingClientRect();
    const b = itemsBBox(itemsRef.current);
    if (!r || !b) return;
    const t = fitTransform(b, { w: r.width, h: r.height });
    setScale(t.scale); setPan(t.pan);
  }, []);

  // ── mutation helpers ──────────────────────────────────────────────────────
  const pushUndo = useCallback(() => {
    undoRef.current.push(itemsRef.current.map(i => ({ ...i })));
    if (undoRef.current.length > 20) undoRef.current.shift();
  }, []);

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    edit(d => ({ ...d, items: prev }));
    setSel(new Set());
  }, [edit]);

  const patchGeometry = useCallback((patch: Record<string, Rect>) => {
    edit(d => ({
      ...d,
      items: d.items.map(i => (patch[i.id] ? { ...i, ...patch[i.id] } : i)),
    }));
  }, [edit]);

  const removeSelected = useCallback(() => {
    if (sel.size === 0) return;
    pushUndo();
    edit(d => ({ ...d, items: d.items.filter(i => !sel.has(i.id)) }));
    setSel(new Set());
  }, [sel, edit, pushUndo]);

  // ── the one gesture engine ────────────────────────────────────────────────
  // ALL drags run on WINDOW listeners. Element pointer-capture was tried in
  // PitchView and proved unreliable — the browser drops it after one or two
  // moves and the layer sticks to the cursor. Do not re-litigate this.
  const begin = useCallback((e: React.PointerEvent, g: Gesture) => {
    e.preventDefault();
    gestureRef.current = g;
    setInteracting(true);
    if (g.kind === 'move' || g.kind === 'resize') pushUndo();

    const move = (ev: PointerEvent) => {
      const cur = gestureRef.current;
      if (!cur) return;
      const p = toBoard(ev.clientX, ev.clientY);

      if (cur.kind === 'pan') {
        setPan({ x: cur.pan0.x + (ev.clientX - cur.from.x), y: cur.pan0.y + (ev.clientY - cur.from.y) });
        return;
      }
      const dx = p.x - cur.from.x;
      const dy = p.y - cur.from.y;

      if (cur.kind === 'move') {
        const next: Record<string, Rect> = {};
        for (const id of cur.ids) {
          const s = cur.start[id];
          if (s) next[id] = { ...s, x: s.x + dx, y: s.y + dy };
        }
        setLive(next);
      } else if (cur.kind === 'resize') {
        // ⇧ frees the aspect on a corner — the deliberate crop.
        setLive({ [cur.id]: resizeRect(cur.base, cur.handle, dx, dy, ev.shiftKey ? undefined : cur.aspect) });
      } else {
        const r = normRect(cur.from.x, cur.from.y, p.x, p.y);
        setMarquee(r);
      }
    };

    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const cur = gestureRef.current;
      gestureRef.current = null;
      const committed = liveRef.current;
      setLive(null);
      setMarquee(null);
      setInteracting(false);
      if (!cur) return;

      if (cur.kind === 'marquee') {
        const r = normRect(cur.from.x, cur.from.y, toBoard(ev.clientX, ev.clientY).x, toBoard(ev.clientX, ev.clientY).y);
        // Under 4px is a click that wandered, not a marquee.
        if (r.w < 4 && r.h < 4) { if (!cur.additive) setSel(new Set()); return; }
        const hit = itemsRef.current.filter(i => rectsOverlap(r, i)).map(i => i.id);
        setSel(prev => (cur.additive ? new Set([...prev, ...hit]) : new Set(hit)));
        return;
      }
      // ONE commit for the whole gesture → one undo step, one debounced write,
      // one broadcast to the other window.
      if (committed && Object.keys(committed).length) patchGeometry(committed);
      else if (cur.kind === 'move' || cur.kind === 'resize') undoRef.current.pop();   // nothing moved
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [toBoard, patchGeometry, setInteracting, pushUndo]);

  const grabItem = useCallback((e: React.PointerEvent, item: MoodItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Grabbing raises: the thing you touched is the thing you see.
    if (item.z < maxZ) edit(d => ({ ...d, items: d.items.map(i => (i.id === item.id ? { ...i, z: maxZ + 1 } : i)) }));

    const additive = e.shiftKey || e.metaKey;
    const ids = sel.has(item.id) && !additive
      ? [...sel]
      : additive ? [...new Set([...sel, item.id])] : [item.id];
    setSel(new Set(ids));

    const start: Record<string, Rect> = {};
    for (const i of itemsRef.current) if (ids.includes(i.id)) start[i.id] = { x: i.x, y: i.y, w: i.w, h: i.h };
    begin(e, { kind: 'move', ids, from: toBoard(e.clientX, e.clientY), start });
  }, [sel, maxZ, edit, begin, toBoard]);

  const grabHandle = useCallback((e: React.PointerEvent, item: MoodItem, handle: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    begin(e, {
      kind: 'resize', id: item.id, handle,
      from: toBoard(e.clientX, e.clientY),
      base: { x: item.x, y: item.y, w: item.w, h: item.h },
      aspect: item.kind === 'note' ? undefined : item.aspect,
    });
  }, [begin, toBoard]);

  const onBoardPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('mb-layer')) return;
    const panning = e.button === 1 || e.altKey || spaceRef.current;
    if (panning) {
      begin(e, { kind: 'pan', from: { x: e.clientX, y: e.clientY }, pan0: { ...panRef.current } });
      return;
    }
    if (e.button !== 0) return;
    begin(e, { kind: 'marquee', from: toBoard(e.clientX, e.clientY), additive: e.shiftKey });
  }, [begin, toBoard]);

  // ── adding things ─────────────────────────────────────────────────────────
  const addItems = useCallback((
    entries: Array<{ src: string; kind: MoodItem['kind']; refId?: string; tag?: string; caption?: string }>,
    at: { x: number; y: number },
  ) => {
    if (!entries.length) return;
    pushUndo();
    const now = new Date().toISOString();
    const base = maxZ;
    const made: MoodItem[] = entries.map((e, k) => {
      const { dx, dy } = dropOffset(k);
      const size = e.kind === 'note' ? NOTE_SIZE : { w: 280, h: 180 };
      return {
        id: uid(), kind: e.kind, src: e.src,
        // Dropped where the cursor is, not where the cursor's top-left is.
        x: Math.round(at.x - size.w / 2 + dx), y: Math.round(at.y - size.h / 2 + dy),
        w: size.w, h: size.h, z: base + 1 + k,
        refId: e.refId, tag: e.tag, caption: e.caption, createdAt: now,
      };
    });
    edit(d => ({ ...d, items: [...d.items, ...made] }));
    setSel(new Set(made.map(m => m.id)));
  }, [edit, maxZ, pushUndo]);

  const addPaths = useCallback(async (paths: string[], at: { x: number; y: number }) => {
    if (!paths.length || !projectId) return;
    // Files from OUTSIDE the project are copied in and content-hashed, so a
    // board can never break because the user moved something on their Desktop.
    const res = await window.hjen.docImport({ id: projectId, kind: 'moodboard', paths });
    const files = res.ok ? res.files : paths.map(p => ({ path: p, name: p }));
    const entries = files.flatMap(f => {
      const kind = moodKindForPath(f.path);
      return kind ? [{ src: f.path, kind }] : [];
    });
    if (entries.length < files.length) onToast('Skipped what the board cannot show — pictures, GIFs and video only.');
    addItems(entries, at);
  }, [projectId, addItems, onToast]);

  const addNote = useCallback(() => {
    const r = boardRef.current?.getBoundingClientRect();
    const at = r ? toBoard(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 };
    addItems([{ src: '', kind: 'note', caption: '' }], at);
  }, [addItems, toBoard]);

  // ── drop ──────────────────────────────────────────────────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    const items2 = Array.from(e.dataTransfer.items || []);
    if (!items2.some(i => i.kind === 'file')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropActive) setDropActive(true);
  }, [dropActive]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    const at = toBoard(e.clientX, e.clientY);

    // 1 · Same document. The References grid preventDefault()s its dragstart so
    //     the native drag can take over, which throws dataTransfer away — the
    //     payload is stashed in a module singleton instead.
    const inline = takeRefDragPayload();
    if (inline.length) {
      addItems(inline.flatMap(r => {
        const kind = moodKindForPath(r.imagePath);
        return kind ? [{ src: r.imagePath, kind, refId: r.id, tag: r.tag }] : [];
      }), at);
      return;
    }

    // 2 · A native file drop: Finder, another app, or a tile dragged out of the
    //     studio window into this one. dataTransfer.files is the ONLY channel
    //     that crosses a BrowserWindow boundary, and pathForFile turns each File
    //     back into the absolute path Electron 32 removed from File.path.
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const paths = files.map(f => window.hjen.pathForFile(f)).filter(Boolean);
    await addPaths(paths, at);
  }, [toBoard, addItems, addPaths]);

  // ── frames sent here without a drag ───────────────────────────────────────
  const consumedRef = useRef(false);
  useEffect(() => {
    if (!pending?.length || consumedRef.current) return;
    consumedRef.current = true;
    const r = boardRef.current?.getBoundingClientRect();
    const at = r ? toBoard(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 };
    const entries = pending.flatMap(p => {
      const kind = moodKindForPath(p.src);
      return kind ? [{ src: p.src, kind, refId: p.refId, tag: p.label }] : [];
    });
    if (entries.length) addItems(entries, at);
    onPendingConsumed?.();
  }, [pending, addItems, toBoard, onPendingConsumed]);

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !typing(e.target)) { spaceRef.current = true; return; }
      if (typing(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault(); setSel(new Set(itemsRef.current.map(i => i.id))); return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
      if (e.key === 'Escape') { setSel(new Set()); return; }
      if (e.key === 'f' || e.key === 'F') { fit(); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [undo, removeSelected, fit]);

  // ── render ────────────────────────────────────────────────────────────────
  const zoomPct = Math.round(scale * 100);

  return (
    <div className="mb-surface">
      <div className="mb-toolbar">
        <button className="pp-btn pp-btn--ghost" onClick={addNote}>+ Note</button>
        <button
          className="pp-btn pp-btn--ghost"
          onClick={async () => {
            // pickAnyFiles, not pickImageFiles: the board takes GIFs and video too.
            const picked = await window.hjen.pickAnyFiles({ title: 'Add to the board' });
            const paths = Array.isArray(picked) ? picked : [];
            if (!paths.length) return;
            const r = boardRef.current?.getBoundingClientRect();
            await addPaths(paths, r ? toBoard(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 });
          }}
        >+ Pictures</button>
        <span className="mb-toolbar__spacer" />
        {sel.size > 0 && (
          <button className="pp-btn pp-btn--ghost mb-toolbar__del" onClick={removeSelected}>
            Remove {sel.size}
          </button>
        )}
        <button className="pp-btn pp-btn--ghost" onClick={fit} title="Fit the whole board (F)">Fit</button>
        <span className="mono-label mb-toolbar__zoom">{zoomPct}%</span>
      </div>

      <div
        ref={boardRef}
        className={`mb-board${dropActive ? ' is-drop' : ''}${spaceRef.current ? ' is-pan' : ''}`}
        onPointerDown={onBoardPointerDown}
        onDragOver={onDragOver}
        onDragLeave={e => { if (e.currentTarget === e.target) setDropActive(false); }}
        onDrop={e => { void onDrop(e); }}
      >
        <div
          className="mb-grid"
          style={{ backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${24 * scale}px ${24 * scale}px` }}
        />
        <div className="mb-layer" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: '0 0' }}>
          {painted.map(i => {
            const l = live?.[i.id];
            const shown = l ? { ...i, ...l } : i;
            return (
              <MoodItemView
                key={i.id}
                item={shown}
                selected={sel.has(i.id)}
                only={sel.size === 1 && sel.has(i.id)}
                scale={scale}
                onGrab={e => grabItem(e, i)}
                onResize={(e, h) => grabHandle(e, shown, h)}
                onCaption={text => edit(d => ({ ...d, items: d.items.map(x => (x.id === i.id ? { ...x, caption: text } : x)) }))}
                onNaturalSize={aspect => edit(d => ({
                  ...d,
                  items: d.items.map(x => {
                    if (x.id !== i.id || x.aspect) return x;
                    // Correct the provisional box to the picture's real shape,
                    // keeping its centre so nothing jumps under the cursor.
                    const w = aspect >= 1 ? DROP_LONG_EDGE : Math.round(DROP_LONG_EDGE * aspect);
                    const h = aspect >= 1 ? Math.round(DROP_LONG_EDGE / aspect) : DROP_LONG_EDGE;
                    return {
                      ...x, aspect,
                      x: Math.round(x.x + (x.w - w) / 2), y: Math.round(x.y + (x.h - h) / 2),
                      w: Math.max(MIN_SIZE, w), h: Math.max(MIN_SIZE, h),
                    };
                  }),
                }))}
              />
            );
          })}
          {marquee && (
            <div className="mb-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
          )}
        </div>

        {items.length === 0 && !dropActive && (
          <div className="mb-blank">
            <div className="mono-label mb-blank__eyebrow">MOOD BOARD</div>
            <p className="mb-blank__p">
              Drag frames in from the board on the left, or drop pictures from anywhere.
              Move them, size them, put a note beside them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
