/**
 * Built-in themes. DEFAULT_THEME is a verbatim snapshot of the values in
 * styles/tokens.css, so "Default" === the current look exactly. The other
 * four are authored as deltas on top of it.
 *
 * Keep DEFAULT_THEME's token values in sync with styles/tokens.css :root.
 */
import { cloneTheme, FONT_CHOICES, type Theme } from './types';

const SANS = FONT_CHOICES[0].sans;
const SERIF = FONT_CHOICES[0].serif;

export const DEFAULT_THEME: Theme = {
  id: 'default',
  name: 'Default',
  builtin: true,
  base: 'dark',
  shell: 'standard',
  tokens: {
    // Graphite palette — uniform #121212 field with subtle #141414 / #1D1D1D lifts.
    bg: '#121212',
    bgElev: '#141414',
    bgElev2: '#1D1D1D',
    topbar: '#1e1e1e',   // top bar sits a touch lighter than the field
    ink: '#FFFFFF',
    inkDim: 'rgba(255, 255, 255, 0.72)',
    inkMuted: 'rgba(255, 255, 255, 0.48)',
    inkFaint: 'rgba(255, 255, 255, 0.24)',
    line: 'rgba(255, 255, 255, 0.10)',
    lineStrong: 'rgba(255, 255, 255, 0.22)',
    accent: '#F25502',
    accentHover: '#ff6817',
    onAccent: '#FFFFFF',
    fontSans: SANS,
    fontSerif: SERIF,
    rCard: '12px',
  },
  controls: { buttonShape: 'pill', buttonFill: 'solid', inputStyle: 'soft' },
  brand: { logoMode: 'wordmark' },
  images: { products: {} },
  actions: { exportLabel: 'Reveal', showExport: true },
};

/** Build a preset by cloning Default and overriding a few fields. */
function preset(id: string, name: string, patch: Partial<Omit<Theme, 'tokens'>> & { tokens?: Partial<Theme['tokens']> }): Theme {
  const t = cloneTheme(DEFAULT_THEME);
  t.id = id;
  t.name = name;
  t.builtin = true;
  if (patch.base) t.base = patch.base;
  if (patch.shell) t.shell = patch.shell;
  if (patch.tokens) Object.assign(t.tokens, patch.tokens);
  if (patch.controls) t.controls = { ...t.controls, ...patch.controls };
  if (patch.brand) t.brand = { ...t.brand, ...patch.brand };
  if (patch.actions) t.actions = { ...t.actions, ...patch.actions };
  return t;
}

/** Light / daytime — inverted surface ramp, kept brand ember accent. */
export const LIGHT_THEME = preset('light', 'Light', {
  base: 'light',
  tokens: {
    bg: '#FFFFFF',
    bgElev: '#F5F5F5',
    bgElev2: '#ECECEE',
    topbar: '#FFFFFF',
    ink: '#0A0A0B',
    inkDim: 'rgba(10, 10, 11, 0.74)',
    inkMuted: 'rgba(10, 10, 11, 0.52)',
    inkFaint: 'rgba(10, 10, 11, 0.28)',
    line: 'rgba(10, 10, 11, 0.12)',
    lineStrong: 'rgba(10, 10, 11, 0.24)',
    accent: '#E04E02',
    accentHover: '#F25502',
    onAccent: '#FFFFFF',
  },
});

/** Film / warm — sepia-leaning surfaces, soil/dust palette, soft radii. */
export const FILM_THEME = preset('film', 'Film', {
  base: 'dark',
  tokens: {
    bg: '#14100C',
    bgElev: '#1C1712',
    bgElev2: '#241D16',
    topbar: '#14100C',
    ink: '#F3E9DD',
    inkDim: 'rgba(243, 233, 221, 0.72)',
    inkMuted: 'rgba(243, 233, 221, 0.46)',
    inkFaint: 'rgba(243, 233, 221, 0.22)',
    line: 'rgba(220, 201, 193, 0.12)',
    lineStrong: 'rgba(220, 201, 193, 0.26)',
    accent: '#C9772E',
    accentHover: '#E08E3F',
    onAccent: '#1A130C',
    rCard: '14px',
  },
  controls: { buttonShape: 'rounded', buttonFill: 'solid', inputStyle: 'filled' },
});

/** Teal — brand green leads instead of ember. */
export const TEAL_THEME = preset('teal', 'Teal', {
  base: 'dark',
  tokens: {
    bg: '#04100C',
    bgElev: '#081A14',
    bgElev2: '#0D241C',
    topbar: '#04100C',
    ink: '#EAF4F0',
    inkDim: 'rgba(234, 244, 240, 0.72)',
    inkMuted: 'rgba(234, 244, 240, 0.46)',
    inkFaint: 'rgba(234, 244, 240, 0.22)',
    line: 'rgba(37, 125, 100, 0.18)',
    lineStrong: 'rgba(37, 125, 100, 0.38)',
    accent: '#257D64',
    accentHover: '#2E9A7B',
    onAccent: '#FFFFFF',
  },
});

/** High-contrast — pure black/white, hard accent, square corners. */
export const CONTRAST_THEME = preset('contrast', 'High Contrast', {
  base: 'dark',
  tokens: {
    bg: '#000000',
    bgElev: '#000000',
    bgElev2: '#0A0A0A',
    topbar: '#000000',
    ink: '#FFFFFF',
    inkDim: 'rgba(255, 255, 255, 0.92)',
    inkMuted: 'rgba(255, 255, 255, 0.72)',
    inkFaint: 'rgba(255, 255, 255, 0.5)',
    line: 'rgba(255, 255, 255, 0.4)',
    lineStrong: 'rgba(255, 255, 255, 0.7)',
    accent: '#FFD400',
    accentHover: '#FFE34D',
    onAccent: '#000000',
    rCard: '2px',
  },
  controls: { buttonShape: 'square', buttonFill: 'solid', inputStyle: 'outline' },
});

/** Daylight — the Intelly/Clarity طابع: warm cream canvas, black floating nav
 *  rail, pastel cards, black pill buttons, large radii. The distinct *shell*
 *  (shell:'daylight') is delivered by [data-shell="daylight"] CSS in app.css. */
export const DAYLIGHT_THEME = preset('daylight', 'Daylight', {
  base: 'light',
  shell: 'daylight',
  tokens: {
    bg: '#EFE9DC', bgElev: '#F7F3EA', bgElev2: '#FFFFFF', topbar: '#EFE9DC',
    ink: '#1A1A1A',
    inkDim: 'rgba(26, 26, 26, 0.74)', inkMuted: 'rgba(26, 26, 26, 0.52)', inkFaint: 'rgba(26, 26, 26, 0.30)',
    line: 'rgba(0, 0, 0, 0.10)', lineStrong: 'rgba(0, 0, 0, 0.18)',
    accent: '#141414', accentHover: '#2A2A2A', onAccent: '#FFFFFF',
    rCard: '20px',
  },
  controls: { buttonShape: 'pill', buttonFill: 'solid', inputStyle: 'soft' },
});

/** Ordered list of built-ins (Default first). */
export const BUILTIN_THEMES: Theme[] = [
  DEFAULT_THEME,
  LIGHT_THEME,
  FILM_THEME,
  TEAL_THEME,
  CONTRAST_THEME,
  DAYLIGHT_THEME,
];

export function getBuiltin(id: string): Theme | undefined {
  return BUILTIN_THEMES.find(t => t.id === id);
}

/**
 * Fill any missing fields on a custom/imported theme from DEFAULT_THEME, so
 * older saved themes (or hand-edited JSON) gain new tokens like `onAccent`
 * or `buttonShape` without breaking apply.ts. Always returns a custom theme.
 */
export function normalizeTheme(t: Theme): Theme {
  const base = cloneTheme(DEFAULT_THEME);
  return {
    ...base,
    ...t,
    builtin: false,
    shell: t.shell || 'standard',
    tokens: { ...base.tokens, ...(t.tokens || {}) },
    controls: { ...base.controls, ...(t.controls || {}) },
    brand: { ...base.brand, ...(t.brand || {}) },
    images: { products: { ...(t.images?.products || {}) } },
    actions: { ...base.actions, ...(t.actions || {}) },
  };
}
