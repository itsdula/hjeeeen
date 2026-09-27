// Typography Overlay — real Arabic type composited onto a made frame. This is
// the guaranteed path for correct Arabic text: the browser text stack does
// proper shaping/ligatures, so the letters are ALWAYS right — unlike
// model-rendered glyphs. Uses OFL Arabic faces (IBM Plex Sans Arabic + Amiri).
// Canvas-based, exports PNG at the source image's exact dimensions.
import sansRegular from '../assets/fonts/IBMPlexSansArabic-400.woff2';
import sansMedium from '../assets/fonts/IBMPlexSansArabic-500.woff2';
import sansBold from '../assets/fonts/IBMPlexSansArabic-700.woff2';
import sansBlack from '../assets/fonts/IBMPlexSansArabic-700.woff2';
import serifBold from '../assets/fonts/Amiri-700.woff2';
import serifBlack from '../assets/fonts/Amiri-700.woff2';

export type OverlayWeight = 'regular' | 'medium' | 'bold' | 'black' | 'serif-bold' | 'serif-black';

const FONT_FILES: Record<OverlayWeight, { family: string; weight: string; url: string }> = {
  'regular':     { family: 'HjenArabicSans', weight: '400', url: sansRegular },
  'medium':      { family: 'HjenArabicSans', weight: '500', url: sansMedium },
  'bold':        { family: 'HjenArabicSans', weight: '700', url: sansBold },
  'black':       { family: 'HjenArabicSans', weight: '900', url: sansBlack },
  'serif-bold':  { family: 'HjenArabicSerif', weight: '700', url: serifBold },
  'serif-black': { family: 'HjenArabicSerif', weight: '900', url: serifBlack },
};

/** On-brand text colors pulled from the Clay & Basil palette. */
export const OVERLAY_COLORS = [
  { id: 'cream',    hex: '#F0E8D8', label: 'Cream' },
  { id: 'white',    hex: '#FFFFFF', label: 'White' },
  { id: 'night',    hex: '#14181C', label: 'Night' },
  { id: 'amber',    hex: '#E8C880', label: 'Amber' },
  { id: 'yellow',   hex: '#E8C840', label: 'Yellow' },
  { id: 'crescent', hex: '#2A6A3A', label: 'Crescent' },
];

const loaded = new Set<string>();

export async function ensureOverlayFonts(): Promise<void> {
  await Promise.all(Object.values(FONT_FILES).map(async f => {
    const key = `${f.family}-${f.weight}`;
    if (loaded.has(key)) return;
    const face = new FontFace(f.family, `url(${f.url})`, { weight: f.weight });
    await face.load();
    document.fonts.add(face);
    loaded.add(key);
  }));
}

export interface OverlaySpec {
  text: string;
  weight: OverlayWeight;
  /** Font size as a fraction of image width (0.02–0.20). */
  sizeFrac: number;
  colorHex: string;
  /** Anchor position as fractions of image dimensions (center of text block). */
  x: number;
  y: number;
  /** Optional soft shadow for legibility over busy frames. */
  shadow: boolean;
}

export const DEFAULT_SPEC: OverlaySpec = {
  text: '',
  weight: 'bold',
  sizeFrac: 0.055,
  colorHex: '#F0E8D8',
  x: 0.5,
  y: 0.82,
  shadow: true,
};

/** Draw the source image + text onto a canvas at native resolution. */
export function drawOverlay(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  spec: OverlaySpec,
): void {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0, w, h);
  if (!spec.text.trim()) return;

  const f = FONT_FILES[spec.weight];
  const px = Math.max(8, Math.round(spec.sizeFrac * w));
  ctx.font = `${f.weight} ${px}px "${f.family}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  ctx.fillStyle = spec.colorHex;
  if (spec.shadow) {
    ctx.shadowColor = 'rgba(10, 14, 18, 0.55)';
    ctx.shadowBlur = Math.round(px * 0.18);
    ctx.shadowOffsetY = Math.round(px * 0.04);
  }
  // Multi-line: split on newlines, stack around the anchor.
  const lines = spec.text.split('\n').map(s => s.trim()).filter(Boolean);
  const lineH = px * 1.35;
  const totalH = lineH * (lines.length - 1);
  lines.forEach((line, i) => {
    ctx.fillText(line, spec.x * w, spec.y * h - totalH / 2 + i * lineH);
  });
  ctx.shadowColor = 'transparent';
}

/** Export the composed canvas as base64 PNG (no data-URL prefix). */
export function exportOverlayBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}
