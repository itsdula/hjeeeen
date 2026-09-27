/**
 * applyTheme — the only place that touches the DOM for theming.
 *
 * Writes every token onto :root as a CSS custom property and sets a handful
 * of data-attributes that drive structural CSS (button fill, input style,
 * logo mode, light/dark base). Calling it again fully replaces the prior
 * theme — no stale properties, because we always write the complete set.
 */
import { TOKEN_VAR_MAP, resolveHubTiles, type Theme, type Appearance, type HubTiles } from './types';

const LS_CACHE_KEY = 'hjen.activeTheme';
const LS_APPEARANCE_KEY = 'hjen.appearance';
const LS_HUBTILES_KEY = 'hjen.hubTiles';
const LS_BGSHADE_KEY = 'hjen.bgShade';

/** 'theme' = leave the active theme's --bg untouched; otherwise a #rrggbb. */
export const BG_SHADE_THEME = 'theme';
/** The neutral-grey shade rail (Settings → Appearance → Background shade). */
export const BG_SHADE_MIN = 0x16;  // #161616 — deep
export const BG_SHADE_MAX = 0x3a;  // #3a3a3a — light graphite

const clampByte = (n: number) => Math.max(0, Math.min(255, n));
const hex2 = (n: number) => clampByte(n).toString(16).padStart(2, '0');

/** Offset every channel of a #rrggbb by delta (kept neutral for grey inputs). */
function nudgeHex(hex: string, delta: number): string {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `#${hex2(r + delta)}${hex2(g + delta)}${hex2(b + delta)}`;
}

/** A grey rail position (0..1) → the #rrggbb base background it maps to. */
export function bgShadeFromPosition(t: number): string {
  const v = Math.round(BG_SHADE_MIN + (BG_SHADE_MAX - BG_SHADE_MIN) * Math.max(0, Math.min(1, t)));
  return `#${hex2(v)}${hex2(v)}${hex2(v)}`;
}

/** Inverse: a #rrggbb base → its rail position (0..1), for the slider. */
export function positionFromBgShade(hex: string): number {
  const v = parseInt(hex.replace('#', '').slice(0, 2), 16);
  return Math.max(0, Math.min(1, (v - BG_SHADE_MIN) / (BG_SHADE_MAX - BG_SHADE_MIN)));
}

export function applyTheme(
  theme: Theme,
  appearance: Appearance = 'classic',
  hubTiles: HubTiles = 'auto',
  bgShade: string = BG_SHADE_THEME,
): void {
  const root = document.documentElement;

  // 1. Tokens → CSS variables
  (Object.keys(TOKEN_VAR_MAP) as Array<keyof typeof TOKEN_VAR_MAP>).forEach(key => {
    const cssVar = TOKEN_VAR_MAP[key];
    const value = theme.tokens[key];
    if (value != null && value !== '') root.style.setProperty(cssVar, String(value));
  });

  // 2. Structural attributes → drive attribute-selector CSS in app.css
  root.dataset.themeBase = theme.base;
  root.dataset.shell = theme.shell || 'standard';
  root.dataset.btnShape = theme.controls.buttonShape;
  root.dataset.btnFill = theme.controls.buttonFill;
  root.dataset.inputStyle = theme.controls.inputStyle;
  root.dataset.logoMode = theme.brand.logoMode;
  root.dataset.theme = theme.id;

  // 3. Appearance re-skin — STRUCTURE ONLY (density, hard corners, flat
  //    industrial controls, recessed inputs, bevel). It NEVER locks colour:
  //    surfaces / ink / accent stay theme + colour-editor driven, so editing a
  //    custom theme's palette is seen live in Pro. The only inline nudge is the
  //    card radius (geometry, not colour), which ships inline via TOKEN_VAR_MAP.
  root.dataset.appearance = appearance;
  if (appearance === 'pro') root.style.setProperty('--r-3', '2px');

  // 3b. Background shade — the user's neutral-grey --bg override + derived
  //     elevations (fixed brightness offsets). 'theme' leaves the theme's bg.
  //     Independent of appearance; overrides the inline surface tokens above.
  if (bgShade && bgShade !== BG_SHADE_THEME && /^#[0-9a-fA-F]{6}$/.test(bgShade)) {
    root.style.setProperty('--bg', bgShade);
    root.style.setProperty('--bg-elev', nudgeHex(bgShade, 8));
    root.style.setProperty('--bg-elev-2', nudgeHex(bgShade, 18));
    root.style.setProperty('--topbar-bg', nudgeHex(bgShade, 12));
  }

  // 3c. Hub-tile colouring — resolve the concrete mode (identity / industrial /
  //     faint) and stamp it; the [data-hub-tiles] CSS in app.css does the rest.
  const tiles = resolveHubTiles(appearance, hubTiles);
  root.dataset.hubTiles = tiles;

  // 4. Cache for instant first-paint on next launch (before IPC resolves)
  try {
    localStorage.setItem(LS_CACHE_KEY, JSON.stringify(theme));
    localStorage.setItem(LS_APPEARANCE_KEY, appearance);
    localStorage.setItem(LS_HUBTILES_KEY, hubTiles);
    localStorage.setItem(LS_BGSHADE_KEY, bgShade);
  } catch { /* ignore */ }
}

/** Read the last-applied background shade from localStorage (first-paint). */
export function readCachedBgShade(): string {
  try {
    const v = localStorage.getItem(LS_BGSHADE_KEY);
    return v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : BG_SHADE_THEME;
  } catch {
    return BG_SHADE_THEME;
  }
}

/** Read the last-applied appearance from localStorage (first-paint, pre-IPC). */
export function readCachedAppearance(): Appearance {
  try {
    return localStorage.getItem(LS_APPEARANCE_KEY) === 'pro' ? 'pro' : 'classic';
  } catch {
    return 'classic';
  }
}

/** Read the last-applied hub-tile mode from localStorage (first-paint, pre-IPC). */
export function readCachedHubTiles(): HubTiles {
  try {
    const v = localStorage.getItem(LS_HUBTILES_KEY);
    return v === 'industrial' || v === 'identity' || v === 'faint' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Read the last-applied theme from localStorage (first-paint, pre-IPC). */
export function readCachedTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    return t && t.tokens ? (t as Theme) : null;
  } catch {
    return null;
  }
}

/** Convert an absolute local path into a renderer-loadable URL.
 *  Matches the app-wide convention (see e.g. GenerationPreview.tsx). */
export function hjenFileUrl(absPath: string): string {
  return `hjen-file://${encodeURI(absPath)}`;
}
