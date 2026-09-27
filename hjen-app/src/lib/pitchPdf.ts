// Pitch PDF assembler — zero dependency.
//
// Composes each pitch page on an offscreen canvas in one of the two codified
// page systems — Layl (dark full-bleed cinematic) / Sahifa (white editorial
// serif) — exports each as JPEG, then packs them into a multi-page PDF by
// hand (DCTDecode image XObjects). Packing approach ported from
// storyboardPdf.ts; page grammar ported from the Fawwara pitch smoke
// (STUDY/creative_pipeline/_smoke/html/Fawwara_Pitch_Smoke.html).

import type { PitchPage, PitchTheme } from '../types/preprod';

const PAGE_W = 2339;                 // fixed width @ ~200dpi (same as storyboardPdf)
let PAGE_H = 1654;                    // height varies with the chosen aspect
const A4_ASPECT = 297 / 210;
const MM = PAGE_W / 297;             // px per mm ≈ 7.875 (width-based — stays constant)
const PT = (25.4 / 72) * MM;         // px per pt ≈ 2.778
const JPEG_Q = 0.82;

const CONSOLE = '#000000';
const PAPER = '#F5F5F5';
const SIGNAL = '#D1B310';

// Font stacks — these families are loaded by the app (tokens.css), so the
// canvas can shape them directly. Instrument Serif Display falls back to the
// app's Instrument Serif when the Display cut isn't registered.
const F_DISPLAY = '"Anton", "Instrument Serif", sans-serif';
const F_AR = '"Instrument Serif Display", "Instrument Serif", "Geeza Pro", serif';
const F_MONO = '"Inter", "SF Mono", Menlo, monospace';
const F_FOLIO = '"Instrument Serif", Georgia, serif';

// Font choices the layers editor exposes per text element. Each `css` stack is
// registered by the app (tokens.css) so both the DOM preview and the canvas
// export shape it identically. Arabic-safe stacks fall back to Geeza Pro.
export interface PitchFont { key: string; label: string; css: string; }
export const PITCH_FONTS: PitchFont[] = [
  { key: 'display-serif', label: 'Display Serif', css: '"Instrument Serif Display", "Instrument Serif", "Geeza Pro", serif' },
  { key: 'display-sans',  label: 'Display Sans',  css: '"Inter", "Geeza Pro", sans-serif' },
  { key: 'anton',          label: 'Anton',          css: '"Anton", "Instrument Serif", sans-serif' },
  { key: 'instrument',     label: 'Instrument',     css: '"Instrument Serif", "Geeza Pro", Georgia, serif' },
  { key: 'inter',          label: 'Inter',          css: '"Inter", "Geeza Pro", sans-serif' },
];
export function pitchFontCss(key?: string): string | undefined {
  if (!key) return undefined;
  if (key.startsWith('u:')) return `"${key.slice(2)}", "Geeza Pro", sans-serif`;  // user font
  return PITCH_FONTS.find(f => f.key === key)?.css;
}

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
export function hasArabic(t: string): boolean { return !!t && ARABIC_RE.test(t); }

// Split a title at its LAST whitespace outside {#hex|…} colour tokens.
// The sig dot is rendered inside a nowrap span with `last`, so it can NEVER
// wrap onto its own line (U+2060 word-joiners are not honoured across
// inline-element boundaries — measured, not assumed).
export function sigSplit(t: string): { pre: string; last: string } {
  let depth = 0, cut = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(c)) cut = i;
  }
  return cut < 0 ? { pre: '', last: t } : { pre: t.slice(0, cut + 1), last: t.slice(cut + 1) };
}

// ── inline colour spans — "{#E0531F|words}" colours a run INSIDE one text layer ──
// One text layer can carry several colours: plain text plus any number of
// {#hex|…} runs. parseRich splits into segments; plainText strips the markers.
export interface RichSeg { t: string; color?: string; bold?: boolean; italic?: boolean; underline?: boolean; fontKey?: string }
// spec parts joined by '+': #hex (colour) · b · i · u · f:<fontKey> — e.g. {#E0531F+b|words} {b+u|words} {f:u:Archivo Black|word}
const RICH_RE = /\{((?:#[0-9a-fA-F]{3,8}|[biu]|f:[^|+}]+)(?:\+(?:#[0-9a-fA-F]{3,8}|[biu]|f:[^|+}]+))*)\|([^}]*)\}/g;
function richSpec(spec: string): Omit<RichSeg, 't'> {
  const o: Omit<RichSeg, 't'> = {};
  for (const part of spec.split('+')) {
    if (part.startsWith('#')) o.color = part;
    else if (part === 'b') o.bold = true;
    else if (part === 'i') o.italic = true;
    else if (part === 'u') o.underline = true;
    else if (part.startsWith('f:')) o.fontKey = part.slice(2);
  }
  return o;
}
export function parseRich(text: string): RichSeg[] {
  const out: RichSeg[] = [];
  let last = 0; let m: RegExpExecArray | null;
  RICH_RE.lastIndex = 0;
  while ((m = RICH_RE.exec(text || ''))) {
    if (m.index > last) out.push({ t: (text || '').slice(last, m.index) });
    out.push({ t: m[2], ...richSpec(m[1]) });
    last = RICH_RE.lastIndex;
  }
  if (last < (text || '').length) out.push({ t: (text || '').slice(last) });
  return out.length ? out : [{ t: text || '' }];
}
export function plainText(text: string): string { return parseRich(text).map(s => s.t).join(''); }

// ── independent text boxes (fractions of the page) ──────────────────────────
export type PitchElemKey = 'kicker' | 'title' | 'body';
export interface PitchBoxF { x: number; y: number; w: number; h: number; }
export function defaultBox(theme: PitchTheme, elem: PitchElemKey, close: boolean): PitchBoxF {
  if (close) {
    if (elem === 'kicker') return { x: 0.047, y: 0.30, w: 0.5, h: 0.04 };
    return elem === 'title' ? { x: 0.047, y: 0.37, w: 0.906, h: 0.14 } : { x: 0.047, y: 0.56, w: 0.906, h: 0.20 };
  }
  if (theme === 'sahifa') {
    if (elem === 'kicker') return { x: 0.697, y: 0.42, w: 0.263, h: 0.04 };
    return elem === 'title' ? { x: 0.697, y: 0.26, w: 0.263, h: 0.14 } : { x: 0.697, y: 0.48, w: 0.263, h: 0.40 };
  }
  // Layl — stacked bottom-left, tight
  if (elem === 'kicker') return { x: 0.047, y: 0.64, w: 0.5, h: 0.04 };
  return elem === 'title' ? { x: 0.047, y: 0.685, w: 0.52, h: 0.11 } : { x: 0.047, y: 0.81, w: 0.52, h: 0.15 };
}
export function resolveBox(page: PitchPage, theme: PitchTheme, elem: PitchElemKey, close: boolean): PitchBoxF {
  return page.layout?.[elem]?.box ?? defaultBox(theme, elem, close);
}

// Z-BAND LAW — the one stacking order every renderer obeys (preview DOM,
// exported HTML, PPTX shape order): all TEXT layers sit above ALL image
// layers; within a band the page's saved order (bottom→top) decides.
// key: 'image' | 'kicker' | 'title' | 'body' | <extra layer id>.
export function pitchZOf(page: PitchPage, key: string): number {
  const all = ['image', 'kicker', 'title', 'body', ...(page.extras ?? []).map(x => x.id)];
  const saved = (page.order ?? []).filter(k => all.includes(k));
  const ordered = [...saved, ...all.filter(k => !saved.includes(k))];
  const isImg = key === 'image' || (page.extras ?? []).some(x => x.id === key && x.kind === 'image');
  return (ordered.indexOf(key) + 1) * 10 + (isImg ? 10 : 500);
}

// ─── shared page vocabulary (the view imports these too) ───────────────────

const SECTION_AR: Record<string, string> = {
  COVER: 'الغلاف',
  APPROACH: 'المقاربة',
  IDEA: 'الفكرة',
  LOVE: 'ما نحبه',
  VISUALS: 'الصورة',
  WARDROBE: 'الأزياء',
  GRADE: 'اللون',
  POST: 'ما بعد التصوير',
  MUSIC: 'الموسيقى',
  SOUND: 'الصوت',
  CAST: 'الوجوه',
  TALENT: 'الوجوه',
  LOCATION: 'المكان',
  PRODUCT: 'المنتج',
  EQUIPMENT: 'العدة',
  BUDGET: 'الميزانية',
  CLOSE: 'لماذا نحن',
};

export function normSection(s: string): string { return (s || '').trim().toUpperCase(); }

/** CLOSE is the one section allowed to ship typographic-only. */
export function isClosePage(p: Pick<PitchPage, 'section'>): boolean {
  const n = normSection(p.section);
  return n === 'CLOSE' || (p.section || '').includes('لماذا نحن');
}

export function sectionArLabel(section: string): string {
  return SECTION_AR[normSection(section)] ?? ((section || '').trim() || '—');
}

/** Layl display title: the cover carries the project name; every other page carries its section. */
export function pageTitle(page: PitchPage, projectName?: string): string {
  const explicit = (page.titleText || '').trim();
  if (explicit) return explicit;
  if (normSection(page.section) === 'COVER') return (projectName || page.section || 'PITCH').trim();
  return (page.section || '').trim() || '—';
}

/** ≤2 short paragraphs per page — the editorial law from the smoke grammar. */
export function splitParas(text: string, max = 2): string[] {
  return (text || '').split(/\n+/).map(s => s.trim()).filter(Boolean).slice(0, max);
}

export function fileUrl(p?: string): string | undefined { return p ? `hjen-file://${encodeURI(p)}` : undefined; }

// ─── low-level helpers ──────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

function newPage(bg: string): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.textBaseline = 'top';
  return { canvas, ctx };
}

/** object-fit: cover (default) or contain — into a rect, clipped. */
function drawCoverImage(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number,
  st?: { opacity?: number; scale?: number; x?: number; y?: number; fit?: 'cover' | 'contain' },
) {
  const zoom = Math.max(1, st?.scale ?? 1);
  const fitFn = st?.fit === 'contain' ? Math.min : Math.max;
  const s = fitFn(w / img.width, h / img.height) * zoom;
  const dw = img.width * s, dh = img.height * s;
  const panX = (st?.x ?? 0) * w;      // fractional pan of the container
  const panY = (st?.y ?? 0) * h;
  ctx.save();
  if (st?.opacity != null) ctx.globalAlpha = Math.max(0, Math.min(1, st.opacity));
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2 + panX, y + (h - dh) / 2 + panY, dw, dh);
  ctx.restore();
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number) {
  try { (ctx as any).letterSpacing = `${Math.max(0, px)}px`; } catch { /* older engines */ }
}

/** Wrap with the ctx.font already set. Chromium shapes Arabic per line. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(trial).width <= maxW) { cur = trial; }
    else { if (cur) lines.push(cur); cur = w; if (lines.length >= maxLines) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines);
}

// ── rich (multi-colour) paragraph drawing — word tokens wrapped by measure ──
// Words carry their span colour; wrapping is word-based so one line can mix
// colours. Arabic shapes per word (no cross-space ligatures), so per-word
// drawing with manual advance is safe for RTL too.
type RichWord = { t: string; color?: string };
function richWordParas(text: string): RichWord[][] {
  return (text || '').split('\n').map(par => {
    const words: RichWord[] = [];
    for (const seg of parseRich(par)) {
      for (const w of seg.t.split(/\s+/).filter(Boolean)) words.push({ t: w, color: seg.color });
    }
    return words;
  });
}
function drawRichParas(
  ctx: CanvasRenderingContext2D, text: string, x: number, yTop: number, boxW: number,
  sizePx: number, lineH: number, defaultColor: string,
  o?: { rtl?: boolean; center?: boolean; paraGap?: number; maxLinesPer?: number },
): number {
  const rtl = !!o?.rtl, center = !!o?.center;
  const paraGap = o?.paraGap ?? 2 * MM;
  const maxLinesPer = o?.maxLinesPer ?? 20;
  ctx.save();
  ctx.direction = 'ltr'; ctx.textAlign = 'left';
  const spaceW = ctx.measureText(' ').width;
  let y = yTop;
  const paras = richWordParas(text);
  paras.forEach((words, pi) => {
    // wrap words by measured width
    const lines: Array<{ ws: RichWord[]; w: number }> = [];
    let cur: RichWord[] = []; let curW = 0;
    for (const w of words) {
      const ww = ctx.measureText(w.t).width;
      const trial = curW + (cur.length ? spaceW : 0) + ww;
      if (cur.length && trial > boxW && lines.length < maxLinesPer) { lines.push({ ws: cur, w: curW }); cur = [w]; curW = ww; }
      else { cur.push(w); curW = trial; }
    }
    if (cur.length && lines.length < maxLinesPer) lines.push({ ws: cur, w: curW });
    for (const ln of lines) {
      if (rtl) {
        let cx = center ? x + (boxW + ln.w) / 2 : x + boxW;
        for (const w of ln.ws) {
          const ww = ctx.measureText(w.t).width;
          cx -= ww;
          ctx.fillStyle = w.color || defaultColor;
          ctx.fillText(w.t, cx, y);
          cx -= spaceW;
        }
      } else {
        let cx = center ? x + (boxW - ln.w) / 2 : x;
        for (const w of ln.ws) {
          ctx.fillStyle = w.color || defaultColor;
          ctx.fillText(w.t, cx, y);
          cx += ctx.measureText(w.t).width + spaceW;
        }
      }
      y += sizePx * lineH;
    }
    if (pi < paras.length - 1) y += paraGap;
  });
  ctx.restore();
  return y;
}

/** Right-aligned RTL paragraph block. Returns the y just below the block. */
function drawRtlParas(
  ctx: CanvasRenderingContext2D, paras: string[], xRight: number, yTop: number,
  maxW: number, sizePx: number, lineH: number, maxLinesPer: number, paraGap: number,
): number {
  ctx.direction = 'rtl'; ctx.textAlign = 'right';
  let y = yTop;
  paras.forEach((p, i) => {
    for (const line of wrapText(ctx, p, maxW, maxLinesPer)) { ctx.fillText(line, xRight, y); y += sizePx * lineH; }
    if (i < paras.length - 1) y += paraGap;
  });
  ctx.direction = 'ltr'; ctx.textAlign = 'left';
  return y;
}

/** Measure how tall drawRtlParas will be (font must be set the same way). */
function measureRtlParas(
  ctx: CanvasRenderingContext2D, paras: string[], maxW: number,
  sizePx: number, lineH: number, maxLinesPer: number, paraGap: number,
): number {
  ctx.direction = 'rtl'; ctx.textAlign = 'right';
  let h = 0;
  paras.forEach((p, i) => {
    h += wrapText(ctx, p, maxW, maxLinesPer).length * sizePx * lineH;
    if (i < paras.length - 1) h += paraGap;
  });
  ctx.direction = 'ltr'; ctx.textAlign = 'left';
  return h;
}

function drawSlug(ctx: CanvasRenderingContext2D, slug: string, color: string) {
  if (!slug) return;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  if (hasArabic(slug)) {
    ctx.font = `400 ${8.5 * PT}px ${F_AR}`;
    ctx.direction = 'rtl'; ctx.textAlign = 'right';
    ctx.fillText(slug, PAGE_W - 14 * MM, 6 * MM);
  } else {
    const size = 7 * PT;
    ctx.font = `400 ${size}px ${F_MONO}`;
    setLetterSpacing(ctx, size * 0.14);
    ctx.fillText(slug.toUpperCase(), 14 * MM, 6 * MM);
    setLetterSpacing(ctx, 0);
  }
  ctx.restore();
}

function drawFolio(ctx: CanvasRenderingContext2D, folio: string, color: string) {
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = color;
  ctx.font = `italic 400 ${9 * PT}px ${F_FOLIO}`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(folio, PAGE_W - 14 * MM, PAGE_H - 6 * MM);
  ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
}

// ─── Layl — dark full-bleed cinematic ───────────────────────────────────────

function drawLayl(
  ctx: CanvasRenderingContext2D, page: PitchPage, img: HTMLImageElement | null,
  folio: string, slug: string, projectName?: string,
) {
  // NOTE: the main image + scrim are drawn by the page loop BEFORE extra image
  // layers (z-band law: images low band → text high band). `img` stays in the
  // signature for callers that still pass it (drawn only if provided).
  const L = page.layout ?? {};
  if (img && !L.image?.hidden) drawCoverImage(ctx, img, 0, 0, PAGE_W, PAGE_H, L.image);

  drawSlug(ctx, slug, PAPER);

  // independent title / body boxes (fractions of the page)
  const close = isClosePage(page);
  const tBox = resolveBox(page, 'layl', 'title', close);
  const bBox = resolveBox(page, 'layl', 'body', close);
  const titleFs = L.title?.fontScale ?? 1;
  const bodyFs = L.body?.fontScale ?? 1;
  const px = tBox.x * PAGE_W;
  const maxW = tBox.w * PAGE_W;
  const kickerSize = 8 * PT;
  const arSize = 13 * PT * bodyFs, arLh = 1.7 * (L.body?.lineScale ?? 1);

  const isCover = normSection(page.section) === 'COVER';
  const kicker = (isCover ? 'CAMPAIGN PITCH · HJEN' : normSection(page.section)).toUpperCase();
  const title = plainText(pageTitle(page, projectName));   // display title is single-colour — strip span markers
  const titleArabic = hasArabic(title);

  // fit the display title: shrink single line 34pt → 22pt, then wrap ≤2 lines
  let titleSize = 34 * PT;
  const titleFam = pitchFontCss(L.title?.fontKey) ?? (titleArabic ? F_AR : F_DISPLAY);
  const bodyFam = pitchFontCss(L.body?.fontKey) ?? F_AR;
  const titleWeight = L.title?.weight ?? (titleArabic ? 700 : 400);
  const titleItalic = L.title?.italic ? 'italic ' : '';
  const bodyWeight = L.body?.weight ?? 400;
  const bodyItalic = L.body?.italic ? 'italic ' : '';
  const titleFont = (s: number) => `${titleItalic}${titleWeight} ${s}px ${titleFam}`;
  const titleText = titleArabic ? title : title.toUpperCase();
  for (let s = 34; s >= 22; s--) {
    ctx.font = titleFont(s * PT);
    if (ctx.measureText(titleText).width <= maxW) { titleSize = s * PT; break; }
    titleSize = 22 * PT;
  }
  titleSize *= titleFs;
  ctx.font = titleFont(titleSize);
  const titleLines = wrapText(ctx, titleText, maxW, 2);
  const titleLh = 0.98 * (L.title?.lineScale ?? 1);

  const paras = splitParas(page.text, 999);   // body honours every line break (no 2-para cap)

  // kicker — its own box (the SECTION label)
  if (!L.kicker?.hidden) {
    const kBox = resolveBox(page, 'layl', 'kicker', close);
    ctx.save();
    ctx.fillStyle = L.kicker?.color || PAPER;
    ctx.globalAlpha = 0.9;
    ctx.font = `400 ${kickerSize}px ${F_MONO}`;
    setLetterSpacing(ctx, kickerSize * 0.22);
    ctx.fillText(kicker, kBox.x * PAGE_W, kBox.y * PAGE_H + kickerSize);
    setLetterSpacing(ctx, 0);
    ctx.restore();
  }

  // display title + signal period — top of the title box. First baseline sits at
  // ~0.8em below the box top (typographic ascent), matching the DOM box model —
  // a full-em drop clips poster-scale titles (fontScale 4–5+) off the page.
  if (!L.title?.hidden) {
    const titleColor = L.title?.color || PAPER;
    let y = tBox.y * PAGE_H + titleSize * 0.8;
    ctx.fillStyle = titleColor;
    ctx.font = titleFont(titleSize);
    if (titleArabic) {
      ctx.direction = 'rtl'; ctx.textAlign = 'right';
      for (const ln of titleLines) { ctx.fillText(ln, px + maxW, y); y += titleSize * titleLh; }
      ctx.direction = 'ltr'; ctx.textAlign = 'left';
    } else {
      for (let i = 0; i < titleLines.length; i++) {
        ctx.fillText(titleLines[i], px, y);
        if (i === titleLines.length - 1) {
          const w = ctx.measureText(titleLines[i]).width;
          ctx.fillStyle = SIGNAL;
          ctx.fillText('.', px + w, y);
          ctx.fillStyle = titleColor;
        }
        y += titleSize * titleLh;
      }
    }
  }

  // body — its own box; multi-colour spans supported ({#hex|…})
  if (!L.body?.hidden) {
    const bx = bBox.x * PAGE_W, bw = bBox.w * PAGE_W, by = bBox.y * PAGE_H + arSize;
    ctx.font = `${bodyItalic}${bodyWeight} ${arSize}px ${bodyFam}`;
    drawRichParas(ctx, paras.join('\n'), bx, by, bw, arSize, arLh, L.body?.color || PAPER,
      { rtl: hasArabic(plainText(page.text || '')), center: L.body?.align === 'center', maxLinesPer: 40, paraGap: 0 });
  }

  drawFolio(ctx, folio, PAPER);
}

// ─── Sahifa — white editorial serif ─────────────────────────────────────────

function drawSahifa(
  ctx: CanvasRenderingContext2D, page: PitchPage, img: HTMLImageElement | null,
  folio: string, slug: string,
) {
  // media — left, everything up to the 96mm text column
  const L = page.layout ?? {};
  const colW = 96 * MM;
  const mediaW = PAGE_W - colW;
  if (img && !L.image?.hidden) drawCoverImage(ctx, img, 0, 0, mediaW, PAGE_H, L.image);

  // independent title / body boxes (fractions of the page)
  const close = isClosePage(page);
  const tBox = resolveBox(page, 'sahifa', 'title', close);
  const bBox = resolveBox(page, 'sahifa', 'body', close);
  const tRight = (tBox.x + tBox.w) * PAGE_W, tMaxW = tBox.w * PAGE_W;
  const bRight = (bBox.x + bBox.w) * PAGE_W, bMaxW = bBox.w * PAGE_W;
  const xRight = PAGE_W - 14 * MM;   // slug still hugs the page edge

  // slug — top of the column
  if (slug) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = CONSOLE;
    if (hasArabic(slug)) {
      ctx.font = `400 ${8.5 * PT}px ${F_AR}`;
      ctx.direction = 'rtl'; ctx.textAlign = 'right';
      ctx.fillText(slug, xRight, 6 * MM);
      ctx.direction = 'ltr'; ctx.textAlign = 'left';
    } else {
      const size = 7 * PT;
      ctx.font = `400 ${size}px ${F_MONO}`;
      setLetterSpacing(ctx, size * 0.14);
      ctx.textAlign = 'right';
      ctx.fillText(slug.toUpperCase(), xRight, 6 * MM);
      setLetterSpacing(ctx, 0);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  // measure the centred block: display / deck / body — each element's font
  // family + size comes from its own layer (title = display, body = body).
  const dispSize = 30 * PT * (L.title?.fontScale ?? 1), dispLh = 1.15 * (L.title?.lineScale ?? 1);
  const deckSize = 7.5 * PT;
  const bodySize = 11.5 * PT * (L.body?.fontScale ?? 1), bodyLh = 1.9 * (L.body?.lineScale ?? 1);
  const dispFam = pitchFontCss(L.title?.fontKey) ?? F_AR;
  const bodyFam = pitchFontCss(L.body?.fontKey) ?? F_AR;
  const dispWeight = L.title?.weight ?? 700;
  const dispItalic = L.title?.italic ? 'italic ' : '';
  const bodyWeight = L.body?.weight ?? 400;
  const bodyItalic = L.body?.italic ? 'italic ' : '';

  const display = sectionArLabel(page.section);
  const dispArabic = hasArabic(display);
  ctx.font = `${dispItalic}${dispWeight} ${dispSize}px ${dispFam}`;
  if (!dispArabic) setLetterSpacing(ctx, dispSize * 0.35);
  const dispLines = wrapText(ctx, dispArabic ? display : display.toUpperCase(), tMaxW, 2);
  setLetterSpacing(ctx, 0);

  const deck = normSection(page.section);
  const paras = splitParas(page.text, 999);   // body honours every line break (no 2-para cap)

  // display title — top of the title box
  if (!L.title?.hidden) {
    let y = tBox.y * PAGE_H + dispSize;
    ctx.fillStyle = L.title?.color || CONSOLE;
    ctx.font = `${dispItalic}${dispWeight} ${dispSize}px ${dispFam}`;
    ctx.direction = dispArabic ? 'rtl' : 'ltr';
    ctx.textAlign = 'right';
    if (!dispArabic) setLetterSpacing(ctx, dispSize * 0.35);
    for (const ln of dispLines) { ctx.fillText(ln, tRight, y); y += dispSize * dispLh; }
    setLetterSpacing(ctx, 0);
    ctx.direction = 'ltr'; ctx.textAlign = 'left';
  }

  // deck (SECTION label) — its own box
  if (!L.kicker?.hidden) {
    const kBox = resolveBox(page, 'sahifa', 'kicker', close);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = CONSOLE;
    ctx.font = `400 ${deckSize}px ${F_MONO}`;
    setLetterSpacing(ctx, deckSize * 0.18);
    ctx.textAlign = 'right';
    ctx.fillText(deck, (kBox.x + kBox.w) * PAGE_W, kBox.y * PAGE_H + deckSize);
    setLetterSpacing(ctx, 0);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // body — its own box
  if (L.body?.hidden) { drawFolio(ctx, folio, CONSOLE); return; }
  ctx.fillStyle = L.body?.color || CONSOLE;
  ctx.font = `${bodyItalic}${bodyWeight} ${bodySize}px ${bodyFam}`;
  drawRtlParas(ctx, paras, bRight, bBox.y * PAGE_H + bodySize, bMaxW, bodySize, bodyLh, 40, 0);

  drawFolio(ctx, folio, CONSOLE);
}

// user-added layers, two z-band passes: images first (low band, above the main
// image only), texts after built-in elements (high band). Text layers support a
// solid `bg` fill (boxes / bars / lines) + multi-colour {#hex|…} spans.
async function drawExtraImages(ctx: CanvasRenderingContext2D, page: PitchPage) {
  for (const x of (page.extras ?? [])) {
    if (x.hidden || x.kind !== 'image' || !x.imagePath) continue;
    try {
      const im = await loadImage(fileUrl(x.imagePath)!);
      drawCoverImage(ctx, im, x.box.x * PAGE_W, x.box.y * PAGE_H, x.box.w * PAGE_W, x.box.h * PAGE_H, x.image);
    } catch { /* skip unreadable image */ }
  }
}
function drawExtraTexts(ctx: CanvasRenderingContext2D, page: PitchPage, color: string) {
  for (const x of (page.extras ?? [])) {
    if (x.hidden || x.kind !== 'text') continue;
    const st = x.style ?? {};
    const bx = x.box.x * PAGE_W, by = x.box.y * PAGE_H;
    const bw = x.box.w * PAGE_W, bh = x.box.h * PAGE_H;
    if (st.bg) { ctx.save(); ctx.fillStyle = st.bg; ctx.fillRect(bx, by, bw, bh); ctx.restore(); }
    const text = (x.text || '').trim();
    if (!text) continue;
    const size = 11 * PT * (st.fontScale ?? 1);      // 11pt parity with the app's .ppp-extra-text
    const lh = 1.5 * (st.lineScale ?? 1);
    const pad = st.bg ? bw * 0.045 : 0;              // filled boxes breathe like the DOM render
    const rtl = st.dir === 'rtl' || (st.dir !== 'ltr' && hasArabic(plainText(text)));
    const weight = st.weight ?? 400;
    const italic = st.italic ? 'italic ' : '';
    const fam = pitchFontCss(st.fontKey) ?? F_AR;
    ctx.save();
    ctx.font = `${italic}${weight} ${size}px ${fam}`;
    drawRichParas(ctx, text, bx + pad, by + pad + size, bw - pad * 2, size, lh, st.color || color,
      { rtl, center: st.align === 'center', paraGap: 0 });
    ctx.restore();
  }
}

// ─── CLOSE — dark typographic (the one image-free page allowed) ─────────────

function drawClose(ctx: CanvasRenderingContext2D, page: PitchPage, folio: string, slug: string) {
  const L = page.layout ?? {};
  drawSlug(ctx, slug, PAPER);

  const xRight = PAGE_W - 30 * MM;
  const eyebrowSize = 8 * PT;
  const h2Size = 26 * PT, h2Lh = 1.35, h2W = 200 * MM;
  const lastSize = 13 * PT, lastLh = 1.9, lastW = 190 * MM;

  const h2 = pageTitle(page);
  const last = (page.text || '').trim();

  ctx.font = `700 ${h2Size}px ${F_AR}`;
  ctx.direction = 'rtl'; ctx.textAlign = 'right';
  const h2Lines = wrapText(ctx, h2, h2W, 4);
  ctx.font = `400 ${lastSize}px ${F_AR}`;
  // body honours every line break (Enter = plain line break, no paragraph cap)
  const lastLines = last ? last.split('\n').flatMap(p => wrapText(ctx, p.trim(), lastW, 40)) : [];
  ctx.direction = 'ltr'; ctx.textAlign = 'left';

  const blockH =
    eyebrowSize + 8 * MM +
    h2Lines.length * h2Size * h2Lh + (lastLines.length ? 8 * MM + lastLines.length * lastSize * lastLh : 0);
  let y = Math.max(24 * MM, (PAGE_H - blockH) / 2);

  // eyebrow — signal gold
  if (!L.kicker?.hidden) {
    ctx.save();
    ctx.fillStyle = SIGNAL;
    ctx.font = `400 ${eyebrowSize}px ${F_MONO}`;
    setLetterSpacing(ctx, eyebrowSize * 0.2);
    ctx.textAlign = 'right';
    ctx.fillText('WHY US', xRight, y);
    setLetterSpacing(ctx, 0);
    ctx.restore();
    ctx.textAlign = 'left';
  }
  y += eyebrowSize + 8 * MM;

  if (!L.title?.hidden) {
    ctx.fillStyle = L.title?.color || PAPER;
    ctx.font = `700 ${h2Size}px ${F_AR}`;
    ctx.direction = 'rtl'; ctx.textAlign = 'right';
    for (const ln of h2Lines) { ctx.fillText(ln, xRight, y); y += h2Size * h2Lh; }
    ctx.direction = 'ltr'; ctx.textAlign = 'left';
  }

  if (lastLines.length && !L.body?.hidden) {
    y += 8 * MM;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = L.body?.color || PAPER;
    ctx.direction = 'rtl'; ctx.textAlign = 'right';
    ctx.font = `400 ${lastSize}px ${F_AR}`;
    for (const ln of lastLines) { ctx.fillText(ln, xRight, y); y += lastSize * lastLh; }
    ctx.restore();
  }
  ctx.direction = 'ltr'; ctx.textAlign = 'left';

  drawFolio(ctx, folio, PAPER);
}

// ─── PDF packer (same hand-packed DCTDecode approach as storyboardPdf) ──────

function dataUrlToJpegBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function assemblePdf(pages: Array<{ jpeg: Uint8Array; w: number; h: number }>): Uint8Array {
  // PDF page box: fixed width in points, height matched to the canvas aspect
  const PW = 842;
  const PH = Math.round(PW * ((pages[0]?.h || 1654) / (pages[0]?.w || 2339)));
  const enc = (s: string) => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff; return a; };
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (u: Uint8Array) => { chunks.push(u); pos += u.length; };
  const pushStr = (s: string) => push(enc(s));
  pushStr('%PDF-1.3\n');
  const N = pages.length;
  const pageObjNums: number[] = [], imgNums: number[] = [], contentNums: number[] = [];
  let objNum = 3;
  for (let i = 0; i < N; i++) { imgNums.push(objNum++); contentNums.push(objNum++); pageObjNums.push(objNum++); }
  const totalObjs = objNum - 1;
  const startObj = (n: number) => { offsets[n] = pos; pushStr(`${n} 0 obj\n`); };
  const endObj = () => pushStr('endobj\n');
  startObj(1); pushStr('<< /Type /Catalog /Pages 2 0 R >>\n'); endObj();
  startObj(2); pushStr(`<< /Type /Pages /Count ${N} /Kids [ ${pageObjNums.map(n => `${n} 0 R`).join(' ')} ] >>\n`); endObj();
  for (let i = 0; i < N; i++) {
    const p = pages[i];
    startObj(imgNums[i]);
    pushStr(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg); pushStr('\nendstream\n'); endObj();
    const content = `q\n${PW} 0 0 ${PH} 0 0 cm\n/Im0 Do\nQ\n`;
    startObj(contentNums[i]);
    pushStr(`<< /Length ${content.length} >>\nstream\n${content}endstream\n`); endObj();
    startObj(pageObjNums[i]);
    pushStr(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${imgNums[i]} 0 R >> >> /Contents ${contentNums[i]} 0 R >>\n`);
    endObj();
  }
  const xrefPos = pos;
  pushStr(`xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= totalObjs; n++) pushStr(`${(offsets[n] ?? 0).toString().padStart(10, '0')} 00000 n \n`);
  pushStr(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ─── public ─────────────────────────────────────────────────────────────────

export interface PitchPdfOptions {
  theme: PitchTheme;
  slug?: string;
  slugStyle?: { box?: PitchBoxF; color?: string; fontScale?: number; align?: 'center' | 'end' | 'start' };  // user-placed header/footer — drawn LAST, above every layer
  projectName?: string;
  aspect?: number;   // slide aspect (w/h); default A4
}

/** Compose every pitch page on canvas at the chosen aspect and pack a PDF. */
export async function buildPitchPdf(pages: PitchPage[], opts: PitchPdfOptions): Promise<Uint8Array> {
  try { await (document as any).fonts?.ready; } catch { /* draw with fallbacks */ }
  PAGE_H = Math.round(PAGE_W / (opts.aspect || A4_ASPECT));

  const slug = (opts.slug || '').trim();
  const slugSt = opts.slugStyle;
  // with a user-styled slug, the page renderers skip their built-in slug draw —
  // it is painted LAST per page (header/footer above every layer, every page).
  const innerSlug = slugSt ? '' : slug;
  const drawStyledSlug = (ctx: CanvasRenderingContext2D) => {
    if (!slug || !slugSt) return;
    const b = slugSt.box ?? { x: 0.047, y: 0.024, w: 0.5, h: 0.04 };
    const size = 7 * PT * (slugSt.fontScale ?? 1);
    ctx.save();
    ctx.fillStyle = slugSt.color || PAPER;
    const ar = hasArabic(slug);
    if (ar) { ctx.font = `400 ${size * 1.2}px ${F_AR}`; ctx.direction = 'rtl'; }
    else { ctx.font = `400 ${size}px ${F_MONO}`; setLetterSpacing(ctx, size * 0.14); }
    ctx.textAlign = slugSt.align === 'center' ? 'center' : slugSt.align === 'end' || ar ? 'right' : 'left';
    const bx = b.x * PAGE_W, bw = b.w * PAGE_W;
    const ax = ctx.textAlign === 'center' ? bx + bw / 2 : ctx.textAlign === 'right' ? bx + bw : bx;
    ctx.fillText(ar ? slug : slug.toUpperCase(), ax, b.y * PAGE_H + size * 0.85);
    setLetterSpacing(ctx, 0);
    ctx.restore();
    ctx.direction = 'ltr'; ctx.textAlign = 'left';
  };
  const canvases: HTMLCanvasElement[] = [];

  const hexLum = (h?: string) => {
    const v = (h || '').replace('#', '');
    if (v.length < 6) return 0;
    return 0.2126 * parseInt(v.slice(0, 2), 16) + 0.7152 * parseInt(v.slice(2, 4), 16) + 0.0722 * parseInt(v.slice(4, 6), 16);
  };

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const folio = String(i + 1).padStart(2, '0');
    const close = isClosePage(page);
    const dark = close || opts.theme === 'layl';
    const bgc = page.bgColor || (dark ? CONSOLE : PAPER);
    const { canvas, ctx } = newPage(bgc);

    let img: HTMLImageElement | null = null;
    if (page.imagePath) {
      try { img = await loadImage(fileUrl(page.imagePath)!); } catch { img = null; }
    }

    // Z-BAND LAW: main image (+ scrim on dark pages) → extra image layers →
    // built-in text elements → extra text layers. Text always paints above imagery.
    const laylPath = !(close && !img) && !(!close && opts.theme === 'sahifa');
    if (laylPath && img && !page.layout?.image?.hidden) {
      drawCoverImage(ctx, img, 0, 0, PAGE_W, PAGE_H, page.layout?.image);
      if (hexLum(bgc) <= 140) {   // scrim only beds text on dark pages (light pages carry ink type)
        const grad = ctx.createLinearGradient(0, PAGE_H, 0, 0);
        grad.addColorStop(0, 'rgba(0,0,0,0.72)');
        grad.addColorStop(0.42, 'rgba(0,0,0,0.18)');
        grad.addColorStop(0.65, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, PAGE_W, PAGE_H);
      }
    }
    await drawExtraImages(ctx, page);

    if (close && !img) drawClose(ctx, page, folio, innerSlug);
    else if (!close && opts.theme === 'sahifa') drawSahifa(ctx, page, img, folio, innerSlug);
    else drawLayl(ctx, page, null, folio, innerSlug, opts.projectName);

    drawExtraTexts(ctx, page, (opts.theme === 'sahifa' && !close) ? CONSOLE : PAPER);
    drawStyledSlug(ctx);   // header/footer — last, above everything

    canvases.push(canvas);
  }

  const jpegs = canvases.map(c => ({ jpeg: dataUrlToJpegBytes(c.toDataURL('image/jpeg', JPEG_Q)), w: c.width, h: c.height }));
  return assemblePdf(jpegs);
}
