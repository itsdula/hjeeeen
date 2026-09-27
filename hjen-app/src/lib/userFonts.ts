// User fonts — files the user dropped into the HJEN Fonts folder (Settings).
// We register each with an @font-face over hjen-file:// so every tool's font
// picker can use it. The family name is the file's base name, so the picker
// key `u:<family>` resolves to that family everywhere (see pitchFontCss).

import type { PitchFont } from './pitchPdf';
import { fileUrl } from './pitchPdf';

// Mutable list the pickers read. Populated by loadUserFonts().
export const USER_FONTS: PitchFont[] = [];

export function userFontKey(family: string): string { return `u:${family}`; }
export function isUserFontKey(key?: string): boolean { return !!key && key.startsWith('u:'); }
export function userFontCss(key: string): string { return `"${key.slice(2)}", "Geeza Pro", sans-serif`; }

let styleEl: HTMLStyleElement | null = null;

/** Fetch the fonts list, inject @font-face rules, and fill USER_FONTS. */
export async function loadUserFonts(): Promise<void> {
  let list: Array<{ family: string; file: string; path: string }> = [];
  try { list = (await window.hjen.listFonts()) ?? []; } catch { return; }

  const css = list.map(f => {
    const src = fileUrl(f.path);
    return `@font-face{font-family:"${f.family}";src:url("${src}");font-display:swap;}`;
  }).join('\n');

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'hjen-user-fonts';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;

  USER_FONTS.length = 0;
  for (const f of list) USER_FONTS.push({ key: userFontKey(f.family), label: `${f.family} ·`, css: `"${f.family}", "Geeza Pro", sans-serif` });
}
