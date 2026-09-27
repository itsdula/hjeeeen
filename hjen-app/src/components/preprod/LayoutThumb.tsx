// A tiny, data-driven schematic of a pitch LAYOUT. It runs the layout's real
// apply() and draws each element's box as a mini wireframe — image tiles as
// soft rects, the title as an accent bar, body/columns as thin lines, kicker as
// a tick. Because it reads the preset's own bgColor + element colours, the thumb
// shows BOTH the layout's shape AND the theme's palette, and never drifts from
// what actually ships. Used in the theme picker + the per-page layout chips.
import type { PitchLayoutDef } from '../../lib/pitchThemes';
import type { PitchPage, PitchElemStyle, PitchExtraLayer } from '../../types/preprod';

const SAMPLE: PitchPage = { section: 'SECTION', titleText: 'Title', text: 'Body copy line one.\nBody copy line two.' };

function lum(hex?: string): number {
  if (!hex) return 0;
  const h = hex.replace('#', '');
  if (h.length < 6) return 0;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

interface Box { x: number; y: number; w: number; h: number; }
const pct = (b: Box) => ({ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });

export function LayoutThumb({ lay, width = 132 }: { lay: PitchLayoutDef; width?: number }) {
  let patch: Partial<PitchPage> = {};
  try { patch = lay.apply(SAMPLE) || {}; } catch { patch = {}; }
  const L = patch.layout || {};
  const bg = patch.bgColor || '#0f0f0f';
  const dark = lum(bg) < 140;
  const ph = dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.13)';       // photo tile fill
  const phB = dark ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.22)';      // photo tile border
  const inkFaint = dark ? 'rgba(245,245,245,.55)' : 'rgba(20,18,16,.5)';
  const h = Math.round(width * 9 / 16);

  const nodes: React.ReactNode[] = [];
  const imageHidden = !!L.image?.hidden;
  // full-bleed page image (schematic diagonal so it reads as "photo")
  if (patch.layout && !imageHidden && L.image !== undefined) {
    nodes.push(<div key="bg" className="lt-photo" style={{ position: 'absolute', inset: 0, background: ph }} />);
  }
  // extras — image tiles + text columns (drawn under built-ins, like the engine)
  (patch.extras || []).forEach((x: PitchExtraLayer, i) => {
    if (x.hidden) return;
    if (x.kind === 'image') {
      nodes.push(<div key={`xi${i}`} style={{ position: 'absolute', ...pct(x.box), background: ph, border: `1px solid ${phB}` }} />);
    } else if (x.style?.bg) {
      // filled text layer (bar / card / rule) — draw the solid itself
      nodes.push(<div key={`xb${i}`} style={{ position: 'absolute', ...pct(x.box), background: x.style.bg, borderRadius: 1 }} />);
    } else {
      const c = x.style?.color || inkFaint;
      nodes.push(
        <div key={`xt${i}`} style={{ position: 'absolute', ...pct(x.box), display: 'flex', flexDirection: 'column', gap: Math.max(1, h * 0.03), justifyContent: 'flex-start', paddingTop: 1 }}>
          {[0, 1, 2].map(k => <div key={k} style={{ height: 1.5, width: `${88 - k * 14}%`, background: c, opacity: .5, borderRadius: 1 }} />)}
        </div>
      );
    }
  });
  // kicker — short tick
  const K = L.kicker as PitchElemStyle | undefined;
  if (K && !K.hidden && K.box) {
    nodes.push(<div key="k" style={{ position: 'absolute', ...pct(K.box), background: K.color || inkFaint, height: 2, opacity: .9, borderRadius: 1, maxWidth: '34%' }} />);
  }
  // title — the accent display bar (the word)
  const T = L.title as PitchElemStyle | undefined;
  if (T && !T.hidden && T.box) {
    const barH = Math.max(4, Math.min(T.box.h, 0.16) * h * (T.fontScale ? Math.min(1.4, T.fontScale) : 1));
    const align = T.align === 'center' ? 'center' : T.align === 'end' ? 'flex-end' : 'flex-start';
    nodes.push(
      <div key="t" style={{ position: 'absolute', ...pct(T.box), display: 'flex', alignItems: 'flex-start', justifyContent: align }}>
        <div style={{ height: Math.round(barH), width: '82%', background: T.color || (dark ? '#F1E7D3' : '#171310'), borderRadius: 2 }} />
      </div>
    );
  }
  // body — a couple of thin lines
  const B = L.body as PitchElemStyle | undefined;
  if (B && !B.hidden && B.box) {
    const c = B.color || inkFaint;
    const align = B.align === 'center' ? 'center' : B.align === 'end' ? 'flex-end' : 'flex-start';
    nodes.push(
      <div key="b" style={{ position: 'absolute', ...pct(B.box), display: 'flex', flexDirection: 'column', gap: Math.max(1, h * 0.035), alignItems: align, paddingTop: 1 }}>
        {[0, 1, 2].map(k => <div key={k} style={{ height: 1.5, width: `${90 - k * 12}%`, background: c, opacity: .5, borderRadius: 1 }} />)}
      </div>
    );
  }

  return (
    <div className="lt" style={{ width, height: h, background: bg, position: 'relative', overflow: 'hidden', borderRadius: 3 }}>
      {nodes}
    </div>
  );
}
