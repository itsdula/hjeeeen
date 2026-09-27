// ColorDot — the single colour control used everywhere in Pitch (Fill / Outline
// / Box fill / Page background). A dot shows the current colour; clicking opens
// a popover with a hex field, the native wheel, a fixed row of the six theme
// colours, and the project palette (add-current / click-to-apply / remove).
//
// The popover is positioned as a fixed element anchored to the dot so it never
// clips inside the scrolling layers rail.

import { useEffect, useRef, useState } from 'react';

// the six equip theme tokens — a fixed, always-present row
const THEME_SWATCHES = ['#FBE6CE', '#E0531F', '#171310', '#030303', '#160F10', '#FFFFFF'];

export interface PaletteApi {
  palette: string[];
  onAdd: (hex: string) => void;
  onRemove: (hex: string) => void;
}

const isHex = (s: string): boolean => /^#[0-9a-fA-F]{6}$/.test(s);
const norm = (s: string): string => (s.startsWith('#') ? s : `#${s}`).toLowerCase();

export function ColorDot({ value, fallback = '#000000', onChange, onClear, palette, label, title }: {
  value?: string;
  fallback?: string;
  onChange: (hex: string) => void;
  onClear?: () => void;      // when set + a value exists, shows a Clear action
  palette: PaletteApi;
  label?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const cur = value ?? fallback;
  const [hexDraft, setHexDraft] = useState(cur);
  useEffect(() => { setHexDraft(cur); }, [cur, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true); };
  }, [open]);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const W = 232, H = 320;
      let left = r.left;
      let top = r.bottom + 6;
      if (left + W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - W - 8);
      if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 6);
      setPos({ top, left });
    }
    setOpen(o => !o);
  };
  const apply = (hex: string) => onChange(norm(hex));

  return (
    <div className="ppp-cdot-wrap">
      <button ref={btnRef} type="button" className={`ppp-cdot ${open ? 'is-open' : ''}`} title={title || label} onClick={toggle}>
        <span className={`ppp-cdot__chip ${value ? '' : 'is-empty'}`} style={value ? { background: value } : undefined} />
        {label && <span className="ppp-cdot__lbl">{label}</span>}
      </button>
      {open && pos && (
        <div ref={popRef} className="ppp-cpop" style={{ top: pos.top, left: pos.left }} onPointerDown={e => e.stopPropagation()}>
          <div className="ppp-cpop__row">
            <span className="ppp-cpop__hash">#</span>
            <input
              className="ppp-cpop__hex" value={hexDraft.replace(/^#/, '')} spellCheck={false} maxLength={6}
              onChange={e => { const v = norm(e.target.value.replace(/[^0-9a-fA-F]/g, '')); setHexDraft(v); if (isHex(v)) apply(v); }}
              onBlur={() => { if (isHex(norm(hexDraft))) apply(hexDraft); else setHexDraft(cur); }}
            />
            <input type="color" className="ppp-cpop__wheel" title="Colour wheel" value={isHex(cur) ? cur : '#000000'} onChange={e => apply(e.target.value)} />
          </div>
          <div className="ppp-cpop__lbl mono-label">Theme colours</div>
          <div className="ppp-cpop__grid">
            {THEME_SWATCHES.map(c => (
              <button key={c} type="button" className={`ppp-cpop__sw ${norm(cur) === norm(c) ? 'is-on' : ''}`} style={{ background: c }} title={c} onClick={() => apply(c)} />
            ))}
          </div>
          <div className="ppp-cpop__lblrow">
            <span className="ppp-cpop__lbl mono-label">Project palette</span>
            <button type="button" className="ppp-cpop__add" title="Save the current colour to the palette" onClick={() => palette.onAdd(norm(cur))}>＋ Add</button>
          </div>
          {palette.palette.length === 0 ? (
            <div className="ppp-cpop__empty mono-label">No saved colours yet — add the current one.</div>
          ) : (
            <div className="ppp-cpop__grid">
              {palette.palette.map(c => (
                <button
                  key={c} type="button" className={`ppp-cpop__sw ppp-cpop__sw--rm ${norm(cur) === norm(c) ? 'is-on' : ''}`}
                  style={{ background: c }} title={`${c} — click to apply · right-click or × to remove`}
                  onClick={() => apply(c)} onContextMenu={e => { e.preventDefault(); palette.onRemove(c); }}
                >
                  <span className="ppp-cpop__x" onClick={e => { e.stopPropagation(); palette.onRemove(c); }}>×</span>
                </button>
              ))}
            </div>
          )}
          {onClear && value && (
            <button type="button" className="ppp-cpop__clear" onClick={() => { onClear(); setOpen(false); }}>Clear colour</button>
          )}
        </div>
      )}
    </div>
  );
}
