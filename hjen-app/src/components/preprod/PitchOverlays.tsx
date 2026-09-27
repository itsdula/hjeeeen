// Pitch overlays — the shortcuts guide (استعلام فوق) and the interactive
// spotlight tour. Both are token-only, keyboard-dismissable overlays. The tour
// never auto-shows; it opens ONLY from its zoom-bar button.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
const CMD = isMac ? '⌘' : 'Ctrl';

interface Shortcut { keys: string[]; desc: string; }
const GROUPS: Array<{ title: string; items: Shortcut[] }> = [
  {
    title: 'Tools', items: [
      { keys: ['T'], desc: 'Add a text layer' },
      { keys: ['I'], desc: 'Add an image layer' },
      { keys: ['L'], desc: 'Add a rule line' },
      { keys: ['B'], desc: 'Add a filled box' },
    ],
  },
  {
    title: 'View', items: [
      { keys: ['Z'], desc: 'Zoom tool — click zooms in, ⌥click zooms out' },
      { keys: ['V'], desc: 'Back to the arrow (select) tool' },
      { keys: [CMD, '='], desc: 'Zoom in' },
      { keys: [CMD, '−'], desc: 'Zoom out' },
      { keys: [CMD, '0'], desc: 'Fit the page to the canvas' },
      { keys: ['Space', 'drag'], desc: 'Pan the canvas' },
      { keys: [CMD, 'wheel'], desc: 'Zoom to the cursor' },
    ],
  },
  {
    title: 'Pages', items: [
      { keys: ['←', '→'], desc: 'Previous / next page (when no layer is selected — press Esc to deselect)' },
      { keys: ['Esc'], desc: 'Deselect layers → arrow keys flip pages' },
    ],
  },
  {
    title: 'Layers', items: [
      { keys: ['↑', '↓', '←', '→'], desc: 'Nudge the selected layer (⇧ = larger step)' },
      { keys: ['⇧', 'click'], desc: 'Add / remove a layer from the selection' },
      { keys: [CMD, 'C'], desc: 'Copy the selected layers' },
      { keys: [CMD, 'V'], desc: 'Paste the copied layers — onto ANY page' },
      { keys: [CMD, 'D'], desc: 'Duplicate the selected layer' },
      { keys: ['Delete'], desc: 'Remove the selected added layer' },
      { keys: [CMD, 'Z'], desc: 'Undo  ·  ⇧' + CMD + 'Z redo' },
    ],
  },
  {
    title: 'Text editing (double-click a text)', items: [
      { keys: ['select', 'letters'], desc: 'A format bar appears: colour · B · I · U · font — applies ONLY to the selected letters' },
      { keys: ['Esc'], desc: 'Close the format bar, then cancel editing' },
    ],
  },
  {
    title: 'Export', items: [
      { keys: [CMD, 'E'], desc: 'Export the PDF' },
      { keys: ['?'], desc: 'Open this shortcuts guide' },
    ],
  },
];

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ppp-ovl" onClick={onClose}>
      <div className="ppp-ovl__card ppp-sc" onClick={e => e.stopPropagation()}>
        <div className="ppp-ovl__head">
          <span className="ppp-ovl__kicker mono-label">Pitch</span>
          <h2 className="ppp-ovl__title">Keyboard shortcuts</h2>
          <button className="ppp-ovl__x" title="Close (Esc)" onClick={onClose}>×</button>
        </div>
        <div className="ppp-sc__grid">
          {GROUPS.map(g => (
            <section key={g.title} className="ppp-sc__grp">
              <h3 className="ppp-sc__grptitle mono-label">{g.title}</h3>
              <ul className="ppp-sc__list">
                {g.items.map((s, i) => (
                  <li key={i} className="ppp-sc__row">
                    <span className="ppp-sc__keys">
                      {s.keys.map((k, j) => <kbd key={j} className="ppp-kbd">{k}</kbd>)}
                    </span>
                    <span className="ppp-sc__desc">{s.desc}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── interactive spotlight tour ─────────────────────────────────────────────
// Dims the whole view, cuts a lit rounded hole around the REAL target element
// (measured live via getBoundingClientRect), and anchors an explanation card
// beside it that auto-flips to stay on-screen. Never auto-shows — opens only
// from the zoom-bar button. Advances strictly on user action (Next / Back /
// Skip · Esc = skip · ←/→ = navigate). A step whose target isn't on screen
// (rail collapsed, no running slug yet) is skipped gracefully.

interface TourStop { sel: string | string[]; title: string; body: string; pad?: number; }

const STOPS: TourStop[] = [
  { sel: '.ppp-stage', pad: 10, title: 'The stage', body: 'Your slide fills the centre. Drag any layer to move it, double-click text to edit it in place, and pan or zoom from the bar below.' },
  { sel: '.ppp-ftbar', pad: 8, title: 'The tool bar', body: 'Drop in a layer — Text, Image, Line or Box — or press T · I · L · B. Drag the bar anywhere it suits you.' },
  { sel: '.ppp-ltabs', pad: 6, title: 'Project · Pages · Export', body: 'The left rail switches between the deck’s look, its pages (live thumbnails you can drag to reorder), and every export format.' },
  { sel: '.ppp-layers', pad: 8, title: 'Layers & styles', body: 'Every element on the page is a layer here. Lock it (🔒), rename by double-click, restyle it, and save reusable Paragraph styles.' },
  { sel: '.ppp-zoombar', pad: 8, title: 'Zoom & shortcuts', body: 'Zoom in and out, Fit to the canvas, or two-finger pan. The ⌨ button opens every keyboard shortcut.' },
  { sel: '.ppp-pgslug', pad: 8, title: 'The running header', body: 'This header/footer rides on every page, above every layer. Drag it anywhere on the canvas to place it deck-wide.' },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function resolveEl(sel: string | string[]): HTMLElement | null {
  for (const s of Array.isArray(sel) ? sel : [sel]) {
    const el = document.querySelector(s);
    if (el instanceof HTMLElement) return el;
  }
  return null;
}
// index of the next on-screen stop from `from`, travelling `dir`; −1 if none.
function nextValid(from: number, dir: 1 | -1): number {
  for (let i = from; i >= 0 && i < STOPS.length; i += dir) if (resolveEl(STOPS[i].sel)) return i;
  return -1;
}

export function SpotlightTour({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(() => Math.max(0, nextValid(0, 1)));
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const go = (dir: 1 | -1) => {
    const n = nextValid(step + dir, dir);
    if (n !== -1) setStep(n);
    else if (dir === 1) onDone();   // past the last stop → finish
  };

  // nothing to point at at all → close immediately
  useEffect(() => { if (nextValid(0, 1) === -1) onDone(); /* eslint-disable-line */ }, []);

  const stop = STOPS[step];

  // measure the target — and keep following it through resizes / rail drags
  useLayoutEffect(() => {
    const measure = () => {
      const el = resolveEl(stop.sel);
      if (!el) { go(1); return; }                  // vanished mid-tour → skip on
      setRect(el.getBoundingClientRect());
    };
    measure();
    window.addEventListener('resize', measure);
    const id = window.setInterval(measure, 400);
    return () => { window.removeEventListener('resize', measure); window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // place the card next to the hole, flipping right → left → below → above
  useLayoutEffect(() => {
    if (!rect || !cardRef.current) return;
    const cw = cardRef.current.offsetWidth, ch = cardRef.current.offsetHeight;
    const gap = 16, m = 12, vw = window.innerWidth, vh = window.innerHeight;
    const vy = clamp(rect.top, m, vh - ch - m);
    const hx = clamp(rect.left, m, vw - cw - m);
    let pos: { left: number; top: number };
    if (rect.right + gap + cw <= vw - m) pos = { left: rect.right + gap, top: vy };
    else if (rect.left - gap - cw >= m) pos = { left: rect.left - gap - cw, top: vy };
    else if (rect.bottom + gap + ch <= vh - m) pos = { left: hx, top: rect.bottom + gap };
    else if (rect.top - gap - ch >= m) pos = { left: hx, top: rect.top - gap - ch };
    else pos = { left: hx, top: clamp(vh - ch - 24, m, vh - ch - m) };   // fills the view → rest at the foot
    setCardPos(pos);
  }, [rect, step]);

  // keyboard — capture phase so arrows drive the tour, not the canvas underneath
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onDone(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); go(-1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const valid = STOPS.map((_, i) => i).filter(i => resolveEl(STOPS[i].sel));
  const pos = valid.indexOf(step);
  const last = pos === valid.length - 1;
  const pad = stop.pad ?? 8;

  return (
    <div className="ppp-tour2" role="dialog" aria-label="Pitch guided tour">
      <div className="ppp-tour2__block" />
      {rect && (
        <div
          className="ppp-tour2__hole"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        />
      )}
      <div
        ref={cardRef}
        className="ppp-tour2__card"
        style={cardPos ? { left: cardPos.left, top: cardPos.top } : { left: -9999, top: -9999 }}
      >
        <span className="ppp-tour2__kicker mono-label">Tour · {pos + 1} / {valid.length}</span>
        <h2 className="ppp-tour2__title">{stop.title}</h2>
        <p className="ppp-tour2__body">{stop.body}</p>
        <div className="ppp-tour2__dots">
          {valid.map((_, i) => <span key={i} className={`ppp-tour2__dot ${i === pos ? 'is-on' : ''}`} />)}
        </div>
        <div className="ppp-tour2__foot">
          <button className="pp-btn pp-btn--ghost" onClick={onDone}>Skip</button>
          <span className="pp-panel__spacer" />
          {pos > 0 && <button className="pp-btn pp-btn--ghost" onClick={() => go(-1)}>Back</button>}
          <button className="pp-btn pp-btn--accent" onClick={() => go(1)}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
