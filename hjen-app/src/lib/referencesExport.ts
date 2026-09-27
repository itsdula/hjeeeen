// References export — take the reference board off the screen.
//
// Two exits, either or both in one act:
//   · a PDF — the set as a printable contact sheet / board / one-per-page
//     rail carrying the Why · Take · Leave lines, PPM-ready;
//   · a folder — every chosen frame copied out VERBATIM, byte for byte, so a
//     GIF stays a GIF and a PNG stays a PNG. The PDF flattens motion to its
//     first frame; the folder never does.
//
// House law carried into the export: a frame without a Leave line is an
// imitation trap — the notes sheet prints the gap rather than hiding it.

import type { HuntedRef, RefPalette } from '../types/preprod';
import { assemblePdf, canvasToPage, loadImage } from './pdfPack';

// ─── page geometry (A4 landscape, composed at ~200dpi) ─────────────────────

const PAGE_W = 2339;
const PAGE_H = 1654;
const MARGIN = 96;
const HEADER_H = 120;
const GUTTER = 34;

const PAPER = '#ffffff';
const INK = '#1b1917';
const INK_DIM = '#54504a';
const RULE = '#c9c4bb';

const SANS = '"Inter", "Helvetica Neue", Helvetica, Arial, "Geeza Pro", sans-serif';
const MONO = '"SF Mono", "Courier New", monospace';

const PALETTE_INK: Record<RefPalette, string> = {
  warm: '#C4703A',
  cool: '#3A6FA8',
  colorful: '#A0559B',
  mid: '#8A8578',
};

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const hasArabic = (t: string) => !!t && ARABIC_RE.test(t);

const hjenSrc = (p: string) => `hjen-file://${encodeURI(p)}`;

// ─── layouts ───────────────────────────────────────────────────────────────

export type RefPdfLayout = 'board' | 'sheet' | 'notes';

export interface RefPdfLayoutSpec {
  id: RefPdfLayout;
  label: string;
  cols: number;
  rows: number;
  note: string;
}

export const REF_PDF_LAYOUTS: RefPdfLayoutSpec[] = [
  { id: 'board', label: 'Board', cols: 4, rows: 3, note: '12 frames a page — the moodboard, image first.' },
  { id: 'sheet', label: 'Contact sheet', cols: 3, rows: 2, note: '6 a page with the Why line under each frame.' },
  { id: 'notes', label: 'One per page', cols: 1, rows: 1, note: 'Full frame + Why · Take · Leave rail. PPM-grade.' },
];

export function refLayoutById(id?: string): RefPdfLayoutSpec {
  return REF_PDF_LAYOUTS.find(l => l.id === id) ?? REF_PDF_LAYOUTS[0];
}

// ─── canvas helpers ────────────────────────────────────────────────────────

function newPage(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  return { canvas, ctx };
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, startSize: number, minSize: number, weight = '400', font = SANS): number {
  for (let s = startSize; s >= minSize; s--) {
    ctx.font = `${weight} ${s}px ${font}`;
    if (ctx.measureText(text).width <= maxW) return s;
  }
  return minSize;
}

/** Wrap to maxLines; the last line gets an ellipsis when text is cut. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, maxLines: number, weight = '400'): string[] {
  ctx.font = `${weight} ${size}px ${SANS}`;
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  let cut = false;
  for (let i = 0; i < words.length; i++) {
    const trial = cur ? `${cur} ${words[i]}` : words[i];
    if (ctx.measureText(trial).width <= maxW) { cur = trial; continue; }
    if (cur) lines.push(cur);
    cur = words[i];
    if (lines.length >= maxLines) { cut = true; break; }
  }
  if (!cut && cur && lines.length < maxLines) lines.push(cur);
  const out = lines.slice(0, maxLines);
  if ((cut || lines.length > maxLines) && out.length) out[out.length - 1] = `${out[out.length - 1]}…`;
  return out;
}

/** One line, right-aligned + RTL when it carries Arabic (Chromium shapes it). */
function drawLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxW: number, weight = '400') {
  ctx.font = `${weight} ${size}px ${SANS}`;
  if (hasArabic(text)) {
    ctx.direction = 'rtl'; ctx.textAlign = 'right';
    ctx.fillText(text, x + maxW, y);
    ctx.direction = 'ltr'; ctx.textAlign = 'left';
  } else {
    ctx.fillText(text, x, y);
  }
}

/** Draw wrapped body text; returns the y after the last line. */
function drawParagraph(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, maxLines: number, lineH = 1.45): number {
  const lines = wrapLines(ctx, text, maxW, size, maxLines);
  let cy = y;
  for (const ln of lines) { drawLine(ctx, ln, x, cy, size, maxW); cy += Math.round(size * lineH); }
  return cy;
}

/** Contain-fit an image inside a box. The hairline rule hugs the IMAGE, not the
 *  box — a 16:9 frame in a taller cell shouldn't float inside an empty outline.
 *  Returns the drawn rect so a caller can hang text off its real bottom edge. */
async function drawFrame(
  ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number, align: 'center' | 'top' = 'center',
): Promise<{ x: number; y: number; w: number; h: number }> {
  ctx.strokeStyle = RULE; ctx.lineWidth = 2;
  try {
    const im = await loadImage(src);            // a GIF resolves to its first frame
    const ar = im.width / im.height, boxAr = w / h;
    const dw = ar > boxAr ? w : h * ar;
    const dh = ar > boxAr ? w / ar : h;
    const dx = x + (w - dw) / 2;
    const dy = align === 'top' ? y : y + (h - dh) / 2;
    ctx.drawImage(im, dx, dy, dw, dh);
    ctx.strokeRect(dx + 1, dy + 1, dw - 2, dh - 2);
    return { x: dx, y: dy, w: dw, h: dh };
  } catch {
    // an unreadable frame keeps its empty box — the gap is visible, not hidden
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    return { x, y, w, h };
  }
}

function pageHeader(ctx: CanvasRenderingContext2D, left: string, right: string) {
  ctx.fillStyle = INK;
  ctx.font = `600 42px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText(left, MARGIN, MARGIN);
  if (right) {
    ctx.fillStyle = INK_DIM;
    ctx.font = `400 22px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(right, PAGE_W - MARGIN, MARGIN + 14);
    ctx.textAlign = 'left';
  }
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  const ruleY = MARGIN + HEADER_H - 44;
  ctx.beginPath(); ctx.moveTo(MARGIN, ruleY); ctx.lineTo(PAGE_W - MARGIN, ruleY); ctx.stroke();
}

/** The palette dot + its name, drawn as a small chip. Returns its width. */
function paletteChip(ctx: CanvasRenderingContext2D, palette: RefPalette, x: number, y: number, size = 18): number {
  const col = PALETTE_INK[palette] ?? PALETTE_INK.mid;
  const r = size / 2;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x + r, y + r, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = INK_DIM;
  ctx.font = `500 ${size - 2}px ${MONO}`;
  ctx.fillText(palette.toUpperCase(), x + size + 8, y + 1);
  return size + 8 + ctx.measureText(palette.toUpperCase()).width;
}

// ─── pages ─────────────────────────────────────────────────────────────────

/** Crop-to-fill — a cover image should meet the page edge, not float in it. */
async function drawCoverFill(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, w: number, h: number) {
  try {
    const im = await loadImage(src);
    const ar = im.width / im.height, boxAr = w / h;
    // take the largest centred crop of the source that matches the box
    const sw = ar > boxAr ? im.height * boxAr : im.width;
    const sh = ar > boxAr ? im.height : im.width / boxAr;
    ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h);
  } catch {
    ctx.fillStyle = '#eceae6';
    ctx.fillRect(x, y, w, h);
  }
}

async function composeCover(refs: HuntedRef[], title: string, dateStr: string): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = newPage();

  // the hero — the first frame, full-bleed across the lower two thirds
  const heroY = Math.round(PAGE_H * 0.42);
  if (refs[0]) await drawCoverFill(ctx, hjenSrc(refs[0].imagePath), 0, heroY, PAGE_W, PAGE_H - heroY);

  ctx.fillStyle = INK_DIM;
  ctx.font = `500 24px ${MONO}`;
  ctx.fillText('STAGE 02 · REFERENCES', MARGIN, MARGIN);

  ctx.fillStyle = INK;
  const ts = fitText(ctx, title, PAGE_W - 2 * MARGIN, 112, 44, '600');
  ctx.font = `600 ${ts}px ${SANS}`;
  ctx.fillText(title, MARGIN, MARGIN + 62);

  // the count and the palette spread — stated on the cover, not discovered later
  const counts: Record<string, number> = {};
  for (const r of refs) { const p = r.palette ?? 'mid'; counts[p] = (counts[p] ?? 0) + 1; }
  const py = heroY - 96;
  ctx.fillStyle = INK_DIM;
  ctx.font = `400 26px ${MONO}`;
  ctx.fillText(`${refs.length} frame${refs.length === 1 ? '' : 's'}  ·  ${dateStr}`, MARGIN, py - 46);

  let px = MARGIN;
  for (const p of ['warm', 'cool', 'colorful', 'mid'] as RefPalette[]) {
    if (!counts[p]) continue;
    const w = paletteChip(ctx, p, px, py, 20);
    ctx.fillStyle = INK_DIM;
    ctx.font = `400 18px ${MONO}`;
    ctx.fillText(`×${counts[p]}`, px + w + 8, py + 2);
    px += w + 8 + ctx.measureText(`×${counts[p]}`).width + 44;
  }
  return canvas;
}

async function composeGridPage(cells: HuntedRef[], spec: RefPdfLayoutSpec, header: string, pageLabel: string): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = newPage();
  pageHeader(ctx, header, pageLabel);

  const contentX = MARGIN, contentY = MARGIN + HEADER_H;
  const contentW = PAGE_W - 2 * MARGIN, contentH = PAGE_H - contentY - MARGIN;
  const cellW = Math.floor((contentW - (spec.cols - 1) * GUTTER) / spec.cols);
  const cellH = Math.floor((contentH - (spec.rows - 1) * GUTTER) / spec.rows);
  const capH = spec.id === 'sheet' ? 132 : 46;

  for (let i = 0; i < cells.length; i++) {
    const r = cells[i];
    const col = i % spec.cols, row = Math.floor(i / spec.cols);
    const x0 = contentX + col * (cellW + GUTTER), y0 = contentY + row * (cellH + GUTTER);
    await drawFrame(ctx, hjenSrc(r.imagePath), x0, y0, cellW, cellH - capH);

    // captions sit on one line per row — mixed aspect ratios must not stagger them
    const capY = y0 + cellH - capH + 10;
    const palette = (r.palette ?? 'mid') as RefPalette;
    // the query that found it, with its palette dot
    const dotR = 6;
    ctx.fillStyle = PALETTE_INK[palette] ?? PALETTE_INK.mid;
    ctx.beginPath(); ctx.arc(x0 + dotR, capY + dotR + 3, dotR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = INK;
    const tagW = cellW - dotR * 2 - 12;
    const tagSize = fitText(ctx, r.tag, tagW, 20, 12, '600', MONO);
    ctx.font = `600 ${tagSize}px ${MONO}`;
    ctx.fillText(r.tag.toUpperCase(), x0 + dotR * 2 + 12, capY);

    if (spec.id === 'sheet') {
      let cy = capY + 30;
      ctx.fillStyle = INK_DIM;
      cy = drawParagraph(ctx, r.why || '— no Why line yet', x0, cy, cellW, 19, 2);
      const take = (r.take || '').trim();
      const leave = (r.leave || '').trim();
      if (take) { ctx.fillStyle = INK_DIM; cy = drawParagraph(ctx, `TAKE — ${take}`, x0, cy + 4, cellW, 17, 1); }
      ctx.fillStyle = leave ? INK_DIM : '#B03A2E';
      drawParagraph(ctx, leave ? `LEAVE — ${leave}` : 'LEAVE — missing. A frame without a Leave line is an imitation trap.', x0, cy + 4, cellW, 17, 1);
    }
  }
  return canvas;
}

async function composeNotesPage(r: HuntedRef, header: string, pageLabel: string): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = newPage();
  pageHeader(ctx, header, pageLabel);

  const contentY = MARGIN + HEADER_H;
  const contentH = PAGE_H - contentY - MARGIN;
  const imgW = Math.round((PAGE_W - 2 * MARGIN) * 0.62);
  const railX = MARGIN + imgW + 64;
  const railW = PAGE_W - MARGIN - railX;

  // top-aligned so the frame's edge meets the rail's first line
  await drawFrame(ctx, hjenSrc(r.imagePath), MARGIN, contentY, imgW, contentH, 'top');

  let y = contentY + 4;
  const palette = (r.palette ?? 'mid') as RefPalette;

  ctx.fillStyle = INK;
  ctx.font = `600 ${fitText(ctx, r.tag, railW, 30, 15, '600', MONO)}px ${MONO}`;
  ctx.fillText(r.tag.toUpperCase(), railX, y);
  y += 44;

  paletteChip(ctx, palette, railX, y, 20);
  if (r.sourceName) {
    ctx.fillStyle = INK_DIM;
    ctx.font = `400 18px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(r.sourceName.toUpperCase(), PAGE_W - MARGIN, y + 2);
    ctx.textAlign = 'left';
  }
  y += 48;

  if (r.intent) {
    ctx.fillStyle = INK_DIM;
    y = drawParagraph(ctx, r.intent, railX, y, railW, 20, 3) + 20;
  }

  const field = (label: string, body: string, missingNote?: string) => {
    ctx.fillStyle = INK_DIM;
    ctx.font = `500 17px ${MONO}`;
    ctx.fillText(label, railX, y);
    y += 28;
    const has = !!body.trim();
    ctx.fillStyle = has ? INK : '#B03A2E';
    y = drawParagraph(ctx, has ? body : (missingNote ?? '— not written'), railX, y, railW, 23, 8) + 26;
  };

  field('WHY — fit to this story', r.why || '');
  field('TAKE — checkable in the frame', r.take || '');
  field('LEAVE — mandatory', r.leave || '', 'Missing. A frame without a Leave line is an imitation trap.');

  if (r.scores) {
    ctx.fillStyle = INK_DIM;
    ctx.font = `400 16px ${MONO}`;
    ctx.fillText(
      `LIT ${r.scores.literal} · POV ${r.scores.pov} · CFT ${r.scores.craft} · FIT ${r.scores.fit} · CLI ${r.scores.antiCliche}   —   ${r.scores.total}/25`,
      railX, PAGE_H - MARGIN - 20,
    );
  }
  return canvas;
}

// ─── public: build the PDF ─────────────────────────────────────────────────

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export interface RefPdfOptions {
  title?: string;
  layout?: RefPdfLayout;
  cover?: boolean;
  dateStr?: string;
}

export async function buildReferencesPdf(refs: HuntedRef[], opts: RefPdfOptions = {}): Promise<Uint8Array> {
  const spec = refLayoutById(opts.layout);
  const title = (opts.title || 'References').trim();
  const dateStr = opts.dateStr || new Date().toISOString().slice(0, 10);
  const head = title.toUpperCase();

  const canvases: HTMLCanvasElement[] = [];
  if (opts.cover !== false) canvases.push(await composeCover(refs, title, dateStr));

  if (spec.id === 'notes') {
    for (let i = 0; i < refs.length; i++) {
      canvases.push(await composeNotesPage(refs[i], head, `${i + 1} / ${refs.length}`));
    }
  } else {
    const perPage = spec.cols * spec.rows;
    const pages = chunk(refs, perPage);
    for (let i = 0; i < pages.length; i++) {
      canvases.push(await composeGridPage(pages[i], spec, head, `${i + 1} / ${pages.length}`));
    }
  }
  return assemblePdf(canvases.map(c => canvasToPage(c)));
}

// ─── public: file names + the notes sheet ──────────────────────────────────

const slugify = (s: string) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const extOf = (p: string) => {
  const m = /\.([a-z0-9]{1,5})$/i.exec(p || '');
  return m ? m[1].toLowerCase() : 'jpg';
};

/** `03_tungsten-kitchen-night_warm.gif` — order kept, extension untouched. */
export function refFileName(r: HuntedRef, index: number): string {
  const n = String(index + 1).padStart(2, '0');
  const tag = slugify(r.tag) || 'ref';
  return `${n}_${tag}_${r.palette ?? 'mid'}.${extOf(r.imagePath)}`;
}

export function refExportFiles(refs: HuntedRef[]): Array<{ srcPath: string; fileName: string }> {
  return refs
    .filter(r => !!r.imagePath)
    .map((r, i) => ({ srcPath: r.imagePath, fileName: refFileName(r, i) }));
}

/** The set as a spreadsheet — one row per frame, the PPM paper trail. */
export function refNotesCsv(refs: HuntedRef[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['#', 'file', 'query', 'intent', 'palette', 'source', 'source_url', 'why', 'take', 'leave', 'score'];
  const rows = refs.map((r, i) => [
    i + 1,
    refFileName(r, i),
    r.tag,
    r.intent ?? '',
    r.palette ?? 'mid',
    r.sourceName ?? '',
    r.sourceUrl ?? '',
    r.why ?? '',
    r.take ?? '',
    r.leave ?? '',
    r.scores ? `${r.scores.total}/25` : '',
  ].map(esc).join(','));
  // BOM so Excel opens the Arabic columns without a mangled first cell.
  return `﻿${head.map(esc).join(',')}\n${rows.join('\n')}\n`;
}

/** `HJEN_<project>_references_2026-08-04` — sanitized, never empty. */
export function defaultExportName(projectName: string, dateStr?: string): string {
  const base = (projectName || 'project').replace(/[\/\\:*?"<>|]+/g, '_').replace(/\s+/g, '_').trim().slice(0, 60);
  return `${base || 'project'}_references_${dateStr || new Date().toISOString().slice(0, 10)}`;
}
