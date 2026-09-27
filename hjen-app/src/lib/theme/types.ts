/**
 * HJEN Studio theme system.
 *
 * A Theme is a bundle of CSS-custom-property overrides + a few structural
 * switches. Because the whole app reads `var(--…)` tokens (see
 * styles/tokens.css), applying a theme = writing those properties onto
 * `document.documentElement`. No component needs to know a theme changed.
 *
 * Built-in themes live in code (presets.ts). Only user-created (custom)
 * themes + the active id are persisted to disk (theme.json in userData).
 */

/** Color / type / radius values that map 1:1 to CSS variables. */
export interface ThemeTokens {
  // Surfaces
  bg: string;
  bgElev: string;
  bgElev2: string;
  /** Top bar (TopChrome) background — its own color so the bar can differ
   *  from the page field (e.g. a slightly-lighter studio bar). */
  topbar: string;
  // Ink (text) ramp
  ink: string;
  inkDim: string;
  inkMuted: string;
  inkFaint: string;
  // Hairlines
  line: string;
  lineStrong: string;
  // Brand accent
  accent: string;
  accentHover: string;
  /** Text/icon color drawn ON the accent (legibility on yellow/light accents). */
  onAccent: string;
  // Typography (full CSS font-family stacks)
  fontSans: string;
  fontSerif: string;
  /** Card / panel / modal corner radius (overrides --r-3). */
  rCard: string;
}

export type ButtonShape = 'pill' | 'rounded' | 'square';
export type ButtonFill = 'solid' | 'outline' | 'ghost';
/** 'soft' is the default (current look: subtle fill + border + radius). */
export type InputStyle = 'soft' | 'underline' | 'outline' | 'filled';
export type LogoMode = 'wordmark' | 'mark' | 'text' | 'hidden' | 'custom';
export type ThemeBase = 'dark' | 'light';
/**
 * Interface appearance — an ORTHOGONAL re-skin layered over whichever theme is
 * active. 'classic' is today's look (default). 'pro' tightens the spacing
 * rhythm, sharpens geometry, and adds a brushed-metal sheen so the app reads
 * as a dense production tool (Photoshop / HJEN Cuts register). It never hijacks
 * the palette — surfaces / ink / accent stay theme-driven — so it survives all
 * six built-in themes + Light + Daylight. Delivered by [data-appearance="pro"]
 * CSS (styles/pro-skin.css) plus a single inline geometry nudge in apply.ts.
 */
export type Appearance = 'classic' | 'pro';

/**
 * Product-Hub tile colouring — an independent user control (Settings →
 * Appearance → Hub tiles), applied in BOTH appearances:
 *  • 'identity'   — registered product colour (the signature look).
 *  • 'industrial' — full neutral graphite; product read from icon + title, with
 *                   a muted-accent edge on hover/selection (Maya/Photoshop feel).
 *  • 'faint'      — a middle ground: a very-low-saturation hint of the product
 *                   colour over graphite, so identity survives but reads quiet.
 *  • 'auto'       — follow the appearance: identity in Classic, industrial in Pro.
 *                   The stored default; an explicit pick sticks across toggles.
 */
export type HubTiles = 'auto' | 'industrial' | 'identity' | 'faint';

/** Resolve the effective (concrete) tile mode from the stored value + appearance. */
export function resolveHubTiles(appearance: Appearance, hubTiles: HubTiles): 'industrial' | 'identity' | 'faint' {
  if (hubTiles === 'auto') return appearance === 'pro' ? 'industrial' : 'identity';
  return hubTiles;
}
/** Structural shell — 'standard' is the current app layout; 'daylight' adds the
 *  Intelly-style black floating nav rail + cream framing + pastel cards. Carried
 *  through duplication so a custom theme keeps its shell. */
export type ThemeShell = 'standard' | 'daylight';

/**
 * Structural treatments expressed as data-attributes on :root. The DEFAULT
 * value of each is the current look, and its CSS rule is a no-op — non-default
 * values are additive overrides, so "Default" never drifts from today's UI.
 */
export interface ThemeControls {
  buttonShape: ButtonShape;
  buttonFill: ButtonFill;
  inputStyle: InputStyle;
}

export interface ThemeBrand {
  logoMode: LogoMode;
  /** Absolute path to a user-picked logo (rendered via hjen-file://). */
  logoCustomPath?: string;
  /** Absolute path to a user-picked boot/interface background image. */
  bootBgPath?: string;
}

export interface ThemeImages {
  /** Product-Hub tile overrides: productId → absolute image path. */
  products: Record<string, string>;
}

export interface ThemeActions {
  /** Label for the frame export action in the lightbox footer (a.k.a "Download"). */
  exportLabel: string;
  /** Whether the export action is shown at all. */
  showExport: boolean;
}

export interface Theme {
  id: string;
  name: string;
  /** Built-ins are read-only; "edit" duplicates into a custom theme. */
  builtin: boolean;
  /** Drives light-only CSS (scrollbars, logo invert, etc.). */
  base: ThemeBase;
  /** Structural shell (layout/chrome variant). Defaults to 'standard'. */
  shell: ThemeShell;
  tokens: ThemeTokens;
  controls: ThemeControls;
  brand: ThemeBrand;
  images: ThemeImages;
  actions: ThemeActions;
}

/** Shallow-per-section patch for editing the active theme. */
export interface ThemePatch {
  name?: string;
  base?: ThemeBase;
  tokens?: Partial<ThemeTokens>;
  controls?: Partial<ThemeControls>;
  brand?: Partial<ThemeBrand>;
  images?: { products?: Record<string, string> };
  actions?: Partial<ThemeActions>;
}

/** On-disk shape (theme.json). Built-ins are NOT stored — only customs. */
export interface ThemeConfig {
  version: 1;
  activeThemeId: string;
  customThemes: Theme[];
  /** Interface re-skin, independent of the active theme. Defaults to 'classic'. */
  appearance?: Appearance;
  /** Product-Hub tile colouring. Defaults to 'auto' (follows appearance). */
  hubTiles?: HubTiles;
  /** Background shade — 'theme' or a #rrggbb neutral-grey base. Default 'theme'. */
  bgShade?: string;
  updatedAt?: string;
}

/** Token → CSS custom property name. Single source of truth for apply.ts. */
export const TOKEN_VAR_MAP: Record<keyof ThemeTokens, string> = {
  bg: '--bg',
  bgElev: '--bg-elev',
  bgElev2: '--bg-elev-2',
  topbar: '--topbar-bg',
  ink: '--ink',
  inkDim: '--ink-dim',
  inkMuted: '--ink-muted',
  inkFaint: '--ink-faint',
  line: '--line',
  lineStrong: '--line-strong',
  accent: '--accent',
  accentHover: '--accent-hover',
  onAccent: '--on-accent',
  fontSans: '--font-sans',
  fontSerif: '--font-serif',
  rCard: '--r-3',
};

/** Named font choices offered in the editor → full CSS stack. */
export const FONT_CHOICES: Array<{ id: string; label: string; sans: string; serif: string }> = [
  {
    id: 'default',
    label: 'Inter (default)',
    sans: "'Inter', 'Inter', -apple-system, system-ui, 'SF Arabic', 'Geeza Pro', sans-serif",
    serif: "'Instrument Serif', 'Instrument Serif', Georgia, 'SF Arabic', 'Geeza Pro', serif",
  },
  {
    id: 'system',
    label: 'System',
    sans: "-apple-system, system-ui, 'Segoe UI', Roboto, 'SF Arabic', 'Geeza Pro', sans-serif",
    serif: "Georgia, 'Times New Roman', 'SF Arabic', 'Geeza Pro', serif",
  },
  {
    id: 'inter',
    label: 'Inter / Grotesk',
    sans: "'Inter', 'Helvetica Neue', Arial, 'SF Arabic', 'Geeza Pro', sans-serif",
    serif: "'Instrument Serif', Georgia, 'SF Arabic', 'Geeza Pro', serif",
  },
];

/** Resolve the font-choice id from a stored sans stack (for editor display). */
export function fontChoiceIdFromStack(sans: string): string {
  const match = FONT_CHOICES.find(f => f.sans === sans);
  return match ? match.id : 'default';
}

let idCounter = 0;
/** Stable-ish id for a custom theme. Avoids Math.random/Date (sandbox-safe). */
export function makeThemeId(): string {
  idCounter += 1;
  return `custom-${performance.now().toString(36).replace('.', '')}-${idCounter}`;
}

/** Deep clone helper (themes are plain JSON). */
export function cloneTheme(t: Theme): Theme {
  return JSON.parse(JSON.stringify(t));
}

/** Minimal structural validation for imported JSON. */
export function isValidTheme(x: any): x is Theme {
  return !!x && typeof x === 'object'
    && typeof x.id === 'string'
    && typeof x.name === 'string'
    && !!x.tokens && typeof x.tokens === 'object'
    && typeof x.tokens.bg === 'string'
    && typeof x.tokens.accent === 'string';
}
