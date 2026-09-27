// FloatingToolbar — a slim vertical tool palette that floats over the Pitch
// canvas (Photoshop-style). Buttons add the four layer kinds; a grip drags the
// whole bar; when dragged near the right rail it snaps/docks to that edge.
// Position persists in localStorage.

import { useEffect, useRef, useState } from 'react';

type Kind = 'text' | 'image' | 'line' | 'box';
const STORE_KEY = 'hjen.pitch.toolbar';
const TOOLS: Array<{ k: Kind; icon: string; key: string; label: string }> = [
  { k: 'text', icon: 'T', key: 'T', label: 'Text' },
  { k: 'image', icon: '▦', key: 'I', label: 'Image' },
  { k: 'line', icon: '─', key: 'L', label: 'Line' },
  { k: 'box', icon: '▢', key: 'B', label: 'Box' },
];

const SNAP = 40;   // px from the right edge that triggers a dock

interface Pos { x: number; y: number }
function loadPos(): Pos {
  try { const p = JSON.parse(localStorage.getItem(STORE_KEY) || ''); if (p && typeof p.x === 'number' && typeof p.y === 'number') return p; } catch { /* first run */ }
  return { x: 16, y: 16 };
}

export function FloatingToolbar({ onAdd, tool, onTool }: { onAdd: (k: Kind) => void; tool?: 'select' | 'zoom'; onTool?: (t: 'select' | 'zoom') => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos>(loadPos);
  const drag = useRef<null | { sx: number; sy: number; ox: number; oy: number }>(null);

  // clamp inside the parent whenever it (or the window) resizes
  useEffect(() => {
    const clampIn = () => {
      const el = ref.current, parent = el?.offsetParent as HTMLElement | null;
      if (!el || !parent) return;
      setPos(p => ({
        x: Math.min(Math.max(0, p.x), Math.max(0, parent.clientWidth - el.offsetWidth)),
        y: Math.min(Math.max(0, p.y), Math.max(0, parent.clientHeight - el.offsetHeight)),
      }));
    };
    clampIn();
    window.addEventListener('resize', clampIn);
    return () => window.removeEventListener('resize', clampIn);
  }, []);

  const onGripDown = (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onGripMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const el = ref.current, parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const maxX = Math.max(0, parent.clientWidth - el.offsetWidth);
    const maxY = Math.max(0, parent.clientHeight - el.offsetHeight);
    const x = Math.min(Math.max(0, d.ox + (e.clientX - d.sx)), maxX);
    const y = Math.min(Math.max(0, d.oy + (e.clientY - d.sy)), maxY);
    setPos({ x, y });
  };
  const onGripUp = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const el = ref.current, parent = el?.offsetParent as HTMLElement | null;
    let next = pos;
    if (el && parent) {
      const maxX = Math.max(0, parent.clientWidth - el.offsetWidth);
      if (pos.x >= maxX - SNAP) next = { ...pos, x: maxX };   // dock to the right rail edge
    }
    setPos(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  return (
    <div ref={ref} className="ppp-ftbar" style={{ left: pos.x, top: pos.y }}>
      <div
        className="ppp-ftbar__grip" title="Drag the toolbar"
        onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp}
      >⠿</div>
      {onTool && (<>
        <button
          className={`ppp-ftbar__btn ${tool !== 'zoom' ? 'is-on' : ''}`}
          title="Arrow — select & move (V)"
          onClick={() => onTool('select')}
        ><span className="ppp-ftbar__ic">➤</span><span className="ppp-ftbar__key">V</span></button>
        <button
          className={`ppp-ftbar__btn ${tool === 'zoom' ? 'is-on' : ''}`}
          title="Zoom — click in, ⌥click out (Z)"
          onClick={() => onTool(tool === 'zoom' ? 'select' : 'zoom')}
        ><span className="ppp-ftbar__ic">🔍</span><span className="ppp-ftbar__key">Z</span></button>
        <span className="ppp-ftbar__sep" />
      </>)}
      {TOOLS.map(t => (
        <button key={t.k} type="button" className="ppp-ftbar__btn" title={`Add ${t.label}  ·  ${t.key}`} onClick={() => onAdd(t.k)}>
          <span className="ppp-ftbar__ic">{t.icon}</span>
          <span className="ppp-ftbar__key">{t.key}</span>
        </button>
      ))}
    </div>
  );
}
