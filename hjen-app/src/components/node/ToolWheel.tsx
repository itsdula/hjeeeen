import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRODUCTS, GLYPH, PRODUCT_VIEW, openStudioProduct, type ProductId } from '../ProductHub';
import '../../styles/toolwheel.css';

/**
 * THE TOOL WHEEL — every HJEN tool, on a dial, from inside the canvas.
 *
 * Anwar's shape, signed off in STUDY/ux_redesign/toolwheel_lab.html:
 * a trigger at the bottom-centre of the board opens a dial whose CENTRE sits
 * below the stage floor, so only the top cap of the circle is on screen. You
 * spin it — drag, trackpad, arrows — until the tool you want reaches the top
 * slot, or you type and the dial re-packs to the matches alone.
 *
 * GEOMETRY. Item i sits at (i·STEP + rotation)°, measured from 12 o'clock.
 * The dial WRAPS: the ring is 31 × 19° = 589° long, but only
 * ±acos(SINK/RADIUS) ≈ ±45° clears the floor, so the far side is never on
 * screen and wrapping costs nothing. That is why the wheel never dead-ends and
 * why there is always something to the left of your pick.
 *
 * THE NUMBERS below are the ones Anwar handed back from the lab. They are not
 * guesses and they are not to be "tidied" — if they change, they change in the
 * lab first and come back as numbers.
 */

// ── signed-off geometry ───────────────────────────────────────────────────
const RADIUS = 325;   // px — dial radius
const SINK = 230;     // px — dial centre below the stage floor
const STEP = 19;      // deg — angle between neighbouring tools
const DISC = 44;      // px — resting disc size (selected ×1.16 · far ×0.86)
const FADE = 20;      // deg — opacity 1 → 0.16 across this span
const HUB_RING = true;
const SNAP = false;   // free spin — no detent on release
// Past this the item is behind the floor; paint nothing rather than a sliver.
const HORIZON = 100;
/** How far the dial's 12 o'clock — the selected slot — clears the board floor.
 *  The centre sits SINK below the floor and the rim is RADIUS from the centre,
 *  so the visible cap is exactly this tall. Everything stacked above the dial
 *  is measured off this one number. */
const ARC_TOP = RADIUS - SINK;
/** 1px of drag ≈ this many degrees. Heavy enough to read as a dial, light
 *  enough to cross the whole set in one gesture. */
const DRAG_GAIN = 0.28;
const DRAG_SLOP = 3;

/** The wheel lists every tool that can actually open — a dial of dead buttons
 *  is worse than a shorter dial. Roadmap tools have no PRODUCT_VIEW entry. */
const WHEEL_TOOLS = PRODUCTS.filter(p => p.status === 'available' && PRODUCT_VIEW[p.id]);

export function ToolWheel({ open, onClose, surface }: {
  open: boolean;
  onClose: () => void;
  /** Which canvas this wheel belongs to — the tool you are already in is
   *  marked, so the dial tells you where you are as well as where you can go. */
  surface: string;
}) {
  const [rot, setRot] = useState(0);
  const [q, setQ] = useState('');
  const dialRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const wheelIdle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return WHEEL_TOOLS;
    return WHEEL_TOOLS.filter(t => (t.name + ' ' + t.tagline + ' ' + t.id).toLowerCase().includes(s));
  }, [q]);

  // The ring's full length. Wrapping into (-span/2, span/2] is what makes the
  // dial endless; with 31 tools the span is far wider than the visible cap.
  const span = Math.max(1, list.length) * STEP;
  const norm = useCallback((a: number) => {
    let x = a % span;
    if (x > span / 2) x -= span;
    if (x < -span / 2) x += span;
    return x;
  }, [span]);

  // Typing always brings the best match to the top slot — never spin after a search.
  useEffect(() => { setRot(0); }, [q]);
  useEffect(() => {
    if (!open) { setQ(''); setRot(0); return; }
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  const selectedIndex = useMemo(() => {
    if (!list.length) return -1;
    let best = -1, bd = Infinity;
    list.forEach((_, i) => { const o = Math.abs(norm(i * STEP + rot)); if (o < bd) { bd = o; best = i; } });
    return best;
  }, [list, rot, norm]);

  const openTool = useCallback((id: ProductId) => {
    onClose();
    openStudioProduct(id);
  }, [onClose]);

  // ── rotate: drag ────────────────────────────────────────────────────────
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const startX = e.clientX, rot0 = rot;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_SLOP) return;
      if (!moved) { moved = true; setDragging(true); }
      setRot(rot0 + (ev.clientX - startX) * DRAG_GAIN);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(false);
      if (moved && SNAP) setRot(r => Math.round(r / STEP) * STEP);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── rotate: trackpad ────────────────────────────────────────────────────
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setRot(r => r - d * 0.22);
    if (SNAP) {
      if (wheelIdle.current) clearTimeout(wheelIdle.current);
      wheelIdle.current = setTimeout(() => setRot(r => Math.round(r / STEP) * STEP), 110);
    }
  };

  // ── keys. The input has focus, so these ride on it. ─────────────────────
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); setRot(r => r - STEP); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setRot(r => r + STEP); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const t = list[selectedIndex];
      if (t) openTool(t.id);
    }
  };

  if (!open) return null;

  return (
    <div className="tw" onWheel={onWheel}>
      {/* Click-off closes. The dial sits above this, so a spin never closes. */}
      <div className="tw__scrim" onPointerDown={onClose} />

      <div className="tw__search" style={{ bottom: ARC_TOP + DISC * 0.62 + 58 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search a tool — type to filter, ↵ to open"
          spellCheck={false}
          autoComplete="off"
        />
        <span className="tw__count mono-label">
          {q ? `${list.length}/${WHEEL_TOOLS.length}` : `${WHEEL_TOOLS.length} tools`}
        </span>
        <span className="tw__esc">esc</span>
      </div>

      {!list.length && (
        <div className="tw__empty" style={{ bottom: ARC_TOP - 10 }}>No tool by that name</div>
      )}

      <div
        ref={dialRef}
        className={`tw__dial${dragging ? ' tw__dial--grabbing' : ''}${HUB_RING ? ' tw__dial--hub' : ''}`}
        style={{ width: RADIUS * 2, height: RADIUS * 2, marginLeft: -RADIUS, bottom: -(RADIUS + SINK) }}
        onPointerDown={onDown}
      >
        {list.map((t, i) => {
          const a = norm(i * STEP + rot);
          const off = Math.abs(a);
          const over = off > HORIZON;
          const on = i === selectedIndex;
          const k = Math.max(0, 1 - off / FADE);
          const size = DISC * (on ? 1.16 : 0.86 + 0.14 * k);
          const here = PRODUCT_VIEW[t.id] === surface;
          return (
            <button
              key={t.id}
              className={`tw__item${on ? ' tw__item--on' : ''}${here ? ' tw__item--here' : ''}`}
              style={{
                // Icons FOLLOW THE ARC — no counter-rotation. Anwar's call.
                transform: `rotate(${a}deg) translate(0, ${-RADIUS}px) translate(-50%, -50%)`,
                opacity: over ? 0 : 0.16 + 0.84 * k,
                pointerEvents: !over && k > 0.02 ? 'auto' : 'none',
                ['--tw-c' as string]: t.accent,
              }}
              title={`${t.name} — ${t.tagline}`}
              onClick={() => openTool(t.id)}
            >
              <span className="tw__disc" style={{ width: size, height: size }}>{GLYPH[t.id]}</span>
              <span className="tw__cap">{t.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
