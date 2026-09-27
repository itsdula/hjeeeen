import { useCallback, useEffect, useRef, useState } from 'react';
import '../../styles/toolrail.css';

/**
 * FLOATING TOOL RAIL — the create-tool rail, unpinned.
 *
 * The rail used to be nailed to the left edge at 50% height. On a wide board
 * that is fine; on a dense one it sits on top of the work. This shell keeps the
 * exact same buttons (they are passed in as children) and adds two moves:
 *
 *   MOVE      grab the grip and drag it anywhere over the stage. Release near
 *             an edge and it DOCKS to that edge — left/right dock vertical,
 *             top/bottom dock horizontal, so the rail always reads as a rail
 *             and never as a stray floating box. Release in open board and it
 *             stays exactly where it was dropped, keeping its last axis.
 *   COLLAPSE  fold it down to a small puck that holds only the grip and the
 *             expand chevron. The board is clear; one click brings it back.
 *
 * Position, dock, axis and collapsed state persist per surface — a Node rail
 * and a SPACE rail remember their own places. Double-click the grip resets.
 *
 * Everything is measured against the STAGE rect (the element this rail is
 * positioned inside), so the rail can never be dragged out of reach.
 */

export type RailDock = 'left' | 'right' | 'top' | 'bottom' | 'free';
export type RailAxis = 'v' | 'h';

export interface RailState {
  dock: RailDock;
  /** Free position, in stage pixels from the stage's top-left. */
  x: number;
  y: number;
  axis: RailAxis;
  collapsed: boolean;
}

const DEFAULT_STATE: RailState = { dock: 'left', x: 16, y: 0, axis: 'v', collapsed: false };

/** Distance from a stage edge, in px, within which a drop docks to that edge. */
const SNAP = 76;
/** Gap held between a docked rail and the stage edge. */
const EDGE_GAP = 16;
/** A drag must exceed this before it counts as a move (so a click still clicks). */
const DRAG_SLOP = 3;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function readState(key: string): RailState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...DEFAULT_STATE };
    const p = JSON.parse(raw) as Partial<RailState>;
    return {
      dock: (['left', 'right', 'top', 'bottom', 'free'] as RailDock[]).includes(p.dock as RailDock) ? p.dock as RailDock : DEFAULT_STATE.dock,
      x: Number.isFinite(p.x) ? Number(p.x) : DEFAULT_STATE.x,
      y: Number.isFinite(p.y) ? Number(p.y) : DEFAULT_STATE.y,
      axis: p.axis === 'h' ? 'h' : 'v',
      collapsed: !!p.collapsed,
    };
  } catch { return { ...DEFAULT_STATE }; }
}

/** Which edge (if any) a dropped rail belongs to. Nearest wins; a corner drop
 *  goes to whichever edge it is genuinely closest to. */
function edgeFor(x: number, y: number, w: number, h: number, sw: number, sh: number): RailDock {
  const d = {
    left: x, right: sw - (x + w),
    top: y, bottom: sh - (y + h),
  };
  const best = (Object.keys(d) as Array<keyof typeof d>).reduce((a, b) => (d[b] < d[a] ? b : a));
  return d[best] <= SNAP ? best : 'free';
}

export function FloatingToolRail({
  surface, stageRef, children, label = 'Tools',
}: {
  /** Persistence bucket — one saved place per tool ('node', 'space', …). */
  surface: string;
  /** The stage the rail floats over; drag bounds and docking read its rect. */
  stageRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  label?: string;
}) {
  const key = `hjen.toolrail.${surface}`;
  const [st, setSt] = useState<RailState>(() => readState(key));
  const [dragging, setDragging] = useState(false);
  /** Edge the rail WOULD dock to if released now — paints the snap hint. */
  const [hint, setHint] = useState<RailDock>('free');
  const railRef = useRef<HTMLElement | null>(null);

  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(st)); } catch { /* private mode */ } }, [key, st]);

  // ---- drag -------------------------------------------------------------
  const onGripDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const stage = stageRef.current;
    const rail = railRef.current;
    if (!stage || !rail) return;
    e.preventDefault();
    e.stopPropagation();   // never let the board start a pan under the grip

    const sr = stage.getBoundingClientRect();
    const rr = rail.getBoundingClientRect();
    // Grab offset inside the rail, so the rail doesn't jump to the cursor.
    const grabX = e.clientX - rr.left;
    const grabY = e.clientY - rr.top;
    const startX = e.clientX, startY = e.clientY;
    let moved = false;

    const place = (cx: number, cy: number) => {
      const rrNow = rail.getBoundingClientRect();
      const x = clamp(cx - sr.left - grabX, 0, Math.max(0, sr.width - rrNow.width));
      const y = clamp(cy - sr.top - grabY, 0, Math.max(0, sr.height - rrNow.height));
      return { x, y, w: rrNow.width, h: rrNow.height, sw: sr.width, sh: sr.height };
    };

    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_SLOP && Math.abs(ev.clientY - startY) < DRAG_SLOP) return;
      if (!moved) { moved = true; setDragging(true); }
      const { x, y, w, h, sw, sh } = place(ev.clientX, ev.clientY);
      setHint(edgeFor(x, y, w, h, sw, sh));
      // While dragging the rail is always free — docking is resolved on release.
      setSt(s => ({ ...s, dock: 'free', x, y }));
    };

    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(false);
      setHint('free');
      if (!moved) return;   // a click on the grip, not a drag
      const { x, y, w, h, sw, sh } = place(ev.clientX, ev.clientY);
      const dock = edgeFor(x, y, w, h, sw, sh);
      // Left/right are vertical rails; top/bottom are horizontal. A free drop
      // keeps whatever axis the rail already had.
      setSt(s => ({
        ...s, dock, x, y,
        axis: dock === 'top' || dock === 'bottom' ? 'h' : dock === 'left' || dock === 'right' ? 'v' : s.axis,
      }));
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [stageRef]);

  const reset = () => setSt(s => ({ ...DEFAULT_STATE, collapsed: s.collapsed }));
  const flipAxis = () => setSt(s => ({ ...s, dock: 'free', axis: s.axis === 'v' ? 'h' : 'v' }));

  // A docked rail is placed by CSS (edge + centred); a free one by x/y.
  const style: React.CSSProperties =
    st.dock === 'free' ? { left: st.x, top: st.y, right: 'auto', bottom: 'auto', transform: 'none' }
      : st.dock === 'left' ? { left: EDGE_GAP, top: '50%', transform: 'translateY(-50%)' }
        : st.dock === 'right' ? { right: EDGE_GAP, left: 'auto', top: '50%', transform: 'translateY(-50%)' }
          : st.dock === 'top' ? { top: EDGE_GAP, left: '50%', transform: 'translateX(-50%)' }
            : { bottom: EDGE_GAP, top: 'auto', left: '50%', transform: 'translateX(-50%)' };

  return (
    <>
      {dragging && hint !== 'free' && <div className={`tr-snap tr-snap--${hint}`} aria-hidden="true" />}
      <aside
        ref={railRef as React.RefObject<HTMLElement>}
        className={`nv-toolrail tr tr--${st.axis} tr--${st.dock}${st.collapsed ? ' tr--collapsed' : ''}${dragging ? ' tr--dragging' : ''}`}
        style={style}
        aria-label={label}
      >
        <div className="tr-head">
          <button
            className="tr-grip"
            onPointerDown={onGripDown}
            onDoubleClick={reset}
            title="Drag to move · double-click to reset · release near an edge to dock"
            aria-label="Move tool rail"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <circle cx="6" cy="4" r="1.25" /><circle cx="10" cy="4" r="1.25" />
              <circle cx="6" cy="8" r="1.25" /><circle cx="10" cy="8" r="1.25" />
              <circle cx="6" cy="12" r="1.25" /><circle cx="10" cy="12" r="1.25" />
            </svg>
          </button>
          <button
            className="tr-fold"
            onClick={() => setSt(s => ({ ...s, collapsed: !s.collapsed }))}
            title={st.collapsed ? 'Show tools' : 'Collapse the rail'}
            aria-expanded={!st.collapsed}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="7 10 12 15 17 10" />
            </svg>
          </button>
        </div>
        {!st.collapsed && (
          <>
            <div className="tr-body">{children}</div>
            <button className="tr-axis" onClick={flipAxis} title={st.axis === 'v' ? 'Lay the rail horizontal' : 'Stand the rail vertical'} aria-label="Flip rail direction">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8h11l-3-3M20 16H9l3 3" />
              </svg>
            </button>
          </>
        )}
      </aside>
    </>
  );
}
