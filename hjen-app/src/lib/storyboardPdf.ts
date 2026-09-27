// Storyboard PDF assembler — zero dependency.
//
// Composes each page on an offscreen canvas (cover + frame pages laid out per
// the chosen template + an optional reference-assets section at the end),
// exports each as JPEG, then hands the pages to the shared packer in
// lib/pdfPack.ts. Layout logic ported from storyboard_to_pdf.py.

import type { StoryboardData, StoryboardShot, StoryboardRefSlot } from '../types/storyboard';
import { panelId } from '../types/storyboard';
import { pdfTemplateById, type PdfTemplate, type CaptionMode } from './storyboardPdfTemplates';
import { assemblePdf, canvasToPage, loadImage } from './pdfPack';

const PAGE_W = 2339;
const PAGE_H = 1654;
const MARGIN = 70;
const HEADER_H = 130;
const GUTTER = 36;
const TOP_STRIP_H = 56;
const BOT_STRIP_H = 120;
const INNER_PAD = 10;

const PAPER = '#ffffff';
const INK = '#1c1a18';
const RULE = '#3c3a38';

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
function hasArabic(t: string): boolean { return !!t && ARABIC_RE.test(t); }

function fileUrl(p?: string): string | undefined { return p ? `hjen-file://${encodeURI(p)}` : undefined; }

function newPage(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.textBaseline = 'top';
  return { canvas, ctx };
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, startSize: number, minSize: number, weight = '400'): number {
  for (let s = startSize; s >= minSize; s--) {
    ctx.font = `${weight} ${s}px "Courier New", monospace`;
    if (ctx.measureText(text).width <= maxW) return s;
  }
  return minSize;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, maxLines: number): string[] {
  ctx.font = `400 ${size}px "Courier New", monospace`;
  const words = text.split(/\s+/).filter(Boolean);
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

/** Draw one line, honouring RTL when it contains Arabic (Chromium shapes it). */
function drawLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxW: number) {
  ctx.font = `400 ${size}px "Courier New", "Geeza Pro", sans-serif`;
  if (hasArabic(text)) {
    ctx.direction = 'rtl'; ctx.textAlign = 'right';
    ctx.fillText(text, x + maxW, y);
    ctx.direction = 'ltr'; ctx.textAlign = 'left';
  } else {
    ctx.fillText(text, x, y);
  }
}

// ─── cover ────────────────────────────────────────────────────────

async function composeCover(data: StoryboardData, projectName: string, frameCount: number): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = newPage();
  ctx.fillStyle = INK; ctx.textAlign = 'center';
  ctx.font = '700 44px "Courier New", monospace';
  ctx.fillText('STORYBOARD', PAGE_W / 2, PAGE_H / 2 - 220);

  const title = data.title?.trim() || projectName;
  const ts = fitText(ctx, title, PAGE_W - 2 * MARGIN, 130, 48, '700');
  ctx.font = `700 ${ts}px "Courier New", monospace`;
  ctx.fillText(title, PAGE_W / 2, PAGE_H / 2 - 120);

  const c = data.client ?? {};
  const lines = [
    c.brand && `BRAND — ${c.brand.toUpperCase()}`,
    c.client && `CLIENT — ${c.client.toUpperCase()}`,
    c.agency && `AGENCY — ${c.agency.toUpperCase()}`,
  ].filter(Boolean) as string[];
  ctx.font = '600 28px "Courier New", monospace'; ctx.fillStyle = INK;
  let ly = PAGE_H / 2 - 20;
  for (const ln of lines) { ctx.fillText(ln, PAGE_W / 2, ly); ly += 40; }

  ctx.font = '400 26px "Courier New", monospace'; ctx.fillStyle = RULE;
  ctx.fillText(`${frameCount} panels`, PAGE_W / 2, ly + 16);

  const logoPaths = [c.clientLogoPath, c.brandLogoPath, c.agencyLogoPath].filter(Boolean) as string[];
  if (logoPaths.length) {
    const maxH = 110;
    const imgs: HTMLImageElement[] = [];
    for (const p of logoPaths) { try { imgs.push(await loadImage(fileUrl(p)!)); } catch { /* skip */ } }
    const scaled = imgs.map(im => { const h = Math.min(maxH, im.height); return { im, w: im.width * (h / im.height), h }; });
    const gap = 80;
    const totalW = scaled.reduce((a, s) => a + s.w, 0) + gap * Math.max(0, scaled.length - 1);
    let lx = (PAGE_W - totalW) / 2;
    const logoY = PAGE_H - MARGIN - maxH;
    for (const s of scaled) { ctx.drawImage(s.im, lx, logoY + (maxH - s.h) / 2, s.w, s.h); lx += s.w + gap; }
  }
  ctx.textAlign = 'left';
  return canvas;
}

// ─── a frame cell, drawn per caption mode ─────────────────────────

async function drawFrameCell(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, shot: StoryboardShot, mode: CaptionMode) {
  const pid = panelId(shot);
  let imgY0 = y0;
  let imgY1 = y0 + h;

  if (mode === 'tech') {
    // top strip: Shot id · shot code
    ctx.strokeStyle = RULE; ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, w, TOP_STRIP_H);
    ctx.fillStyle = INK; ctx.textAlign = 'left';
    const tl = `Shot: ${pid}`; const tr = (shot.shot || shot.angle || '').toUpperCase();
    const s = fitText(ctx, tl, w * 0.6, 26, 12, '700');
    ctx.font = `700 ${s}px "Courier New", monospace`;
    const ty = y0 + (TOP_STRIP_H - s) / 2;
    ctx.fillText(tl, x0 + 10, ty);
    if (tr) { ctx.textAlign = 'right'; ctx.fillText(tr, x0 + w - 10, ty); ctx.textAlign = 'left'; }
    imgY0 = y0 + TOP_STRIP_H + INNER_PAD;
  }
  if (mode === 'tech' || mode === 'frame') {
    imgY1 = y0 + h - BOT_STRIP_H - INNER_PAD;
  }

  // image
  const boxH = imgY1 - imgY0, boxW = w;
  const url = fileUrl(shot.generatedImagePath);
  if (url) {
    try {
      const im = await loadImage(url);
      const ar = im.width / im.height, boxAr = boxW / boxH;
      let dw: number, dh: number;
      if (ar > boxAr) { dw = boxW; dh = boxW / ar; } else { dh = boxH; dw = boxH * ar; }
      ctx.drawImage(im, x0 + (boxW - dw) / 2, imgY0 + (boxH - dh) / 2, dw, dh);
    } catch { /* blank */ }
  }

  // id badge for image-only modes
  if (mode === 'none') {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    const bw = 70, bh = 30;
    ctx.fillRect(x0 + 6, imgY0 + 6, bw, bh);
    ctx.fillStyle = '#fff'; ctx.font = '700 20px "Courier New", monospace'; ctx.textAlign = 'left';
    ctx.fillText(pid, x0 + 14, imgY0 + 12);
  }

  // bottom strip
  if (mode === 'tech' || mode === 'frame') {
    const botY = y0 + h - BOT_STRIP_H;
    ctx.strokeStyle = RULE; ctx.lineWidth = 2;
    ctx.strokeRect(x0, botY, w, BOT_STRIP_H);
    const pad = 12, maxW = w - 2 * pad;
    const dlg = (shot.dialogue || '').trim();
    const hasDlg = dlg && dlg !== '—' && dlg !== '-';
    const fsize = 22, lineH = Math.round(fsize * 1.3);
    const frameLines = wrapLines(ctx, (mode === 'frame' ? `${pid}  ` : '') + (shot.description || ''), maxW, fsize, hasDlg ? 2 : 3);
    let cy = botY + 12; ctx.fillStyle = INK;
    for (const ln of frameLines) { drawLine(ctx, ln, x0 + pad, cy, fsize, maxW); cy += lineH; }
    if (hasDlg) { const dt = `DIALOGUE — ${dlg}`; drawLine(ctx, dt, x0 + pad, cy, fitText(ctx, dt, maxW, fsize, 11), maxW); }
  }
}

function composeGridPage(headerText: string, cells: StoryboardShot[], t: PdfTemplate, drawn: Promise<void>[], ctxOut: { canvas: HTMLCanvasElement }): CanvasRenderingContext2D {
  const { canvas, ctx } = newPage();
  ctxOut.canvas = canvas;
  // header
  ctx.fillStyle = INK; ctx.font = '700 54px "Courier New", monospace'; ctx.textAlign = 'left';
  ctx.fillText(headerText, MARGIN, MARGIN - 6);
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  const ruleY = MARGIN + HEADER_H - 40;
  ctx.beginPath(); ctx.moveTo(MARGIN, ruleY); ctx.lineTo(PAGE_W - MARGIN, ruleY); ctx.stroke();

  const contentX = MARGIN, contentY = MARGIN + HEADER_H;
  const contentW = PAGE_W - 2 * MARGIN, contentH = PAGE_H - contentY - MARGIN;
  const cellW = Math.floor((contentW - (t.cols - 1) * GUTTER) / t.cols);
  const cellH = Math.floor((contentH - (t.rows - 1) * GUTTER) / t.rows);

  for (let i = 0; i < cells.length; i++) {
    const col = i % t.cols, row = Math.floor(i / t.cols);
    const x0 = contentX + col * (cellW + GUTTER), y0 = contentY + row * (cellH + GUTTER);
    drawn.push(drawFrameCell(ctx, x0, y0, cellW, cellH, cells[i], t.caption));
  }
  return ctx;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ─── reference-assets section ─────────────────────────────────────

interface AssetTile { src: string; label: string }

function collectAssetTiles(data: StoryboardData): AssetTile[] {
  const tiles: AssetTile[] = [];
  for (const c of data.characters) {
    if (c.faceImagePath) tiles.push({ src: c.faceImagePath, label: `${c.name} — face` });
    if (c.sheetImagePath) tiles.push({ src: c.sheetImagePath, label: `${c.name} — sheet` });
    if (!c.faceImagePath && !c.sheetImagePath && c.refImagePath) tiles.push({ src: c.refImagePath, label: c.name });
  }
  for (const p of data.places) if (p.refImagePath) tiles.push({ src: p.refImagePath, label: `${p.name} (location)` });
  for (const e of data.elements) if (e.refImagePath) tiles.push({ src: e.refImagePath, label: `${e.name} (element)` });
  return tiles;
}

async function composeAssetPage(headerText: string, tiles: AssetTile[]): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = newPage();
  ctx.fillStyle = INK; ctx.font = '700 54px "Courier New", monospace'; ctx.textAlign = 'left';
  ctx.fillText(headerText, MARGIN, MARGIN - 6);
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  const ruleY = MARGIN + HEADER_H - 40;
  ctx.beginPath(); ctx.moveTo(MARGIN, ruleY); ctx.lineTo(PAGE_W - MARGIN, ruleY); ctx.stroke();

  const cols = 3, rows = 3;
  const contentX = MARGIN, contentY = MARGIN + HEADER_H;
  const contentW = PAGE_W - 2 * MARGIN, contentH = PAGE_H - contentY - MARGIN;
  const cellW = Math.floor((contentW - (cols - 1) * GUTTER) / cols);
  const cellH = Math.floor((contentH - (rows - 1) * GUTTER) / rows);
  const capH = 44;

  for (let i = 0; i < tiles.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const x0 = contentX + col * (cellW + GUTTER), y0 = contentY + row * (cellH + GUTTER);
    ctx.strokeStyle = RULE; ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, cellW, cellH - capH);
    try {
      const im = await loadImage(fileUrl(tiles[i].src)!);
      const boxW = cellW, boxH = cellH - capH;
      const ar = im.width / im.height, boxAr = boxW / boxH;
      let dw: number, dh: number;
      if (ar > boxAr) { dw = boxW; dh = boxW / ar; } else { dh = boxH; dw = boxH * ar; }
      ctx.drawImage(im, x0 + (boxW - dw) / 2, y0 + (boxH - dh) / 2, dw, dh);
    } catch { /* blank */ }
    ctx.fillStyle = INK; ctx.textAlign = 'left';
    const s = fitText(ctx, tiles[i].label, cellW - 8, 24, 12, '600');
    ctx.font = `600 ${s}px "Courier New", monospace`;
    ctx.fillText(tiles[i].label, x0 + 4, y0 + cellH - capH + 10);
  }
  return canvas;
}

// ─── public ───────────────────────────────────────────────────────

export interface PdfBuildOptions {
  projectName?: string;
  selectedIds?: string[];        // shot ids to include; default = all made
  includeAssets?: boolean;       // append the reference-assets section
  templateId?: string;
}

export async function buildStoryboardPdf(data: StoryboardData, opts: PdfBuildOptions = {}): Promise<Uint8Array> {
  const projectName = opts.projectName ?? 'Storyboard';
  const t = pdfTemplateById(opts.templateId ?? data.exportTemplateId);
  const perPage = Math.max(1, t.cols * t.rows);

  // selected, made, in board order
  const sel = opts.selectedIds ? new Set(opts.selectedIds) : null;
  const made = data.shots.filter(s => s.generatedImagePath && (!sel || sel.has(s.id)));

  const canvases: HTMLCanvasElement[] = [];
  canvases.push(await composeCover(data, projectName, made.length));

  const drawn: Promise<void>[] = [];
  if (t.groupByScene) {
    const byScene = new Map<number, StoryboardShot[]>();
    for (const s of made) { if (!byScene.has(s.scene)) byScene.set(s.scene, []); byScene.get(s.scene)!.push(s); }
    for (const scene of byScene.keys()) {
      for (const page of chunk(byScene.get(scene)!, perPage)) {
        const holder = { canvas: null as unknown as HTMLCanvasElement };
        composeGridPage(`SCENE ${scene}`, page, t, drawn, holder);
        canvases.push(holder.canvas);
      }
    }
  } else {
    const title = (data.title?.trim() || projectName).toUpperCase();
    for (const page of chunk(made, perPage)) {
      const holder = { canvas: null as unknown as HTMLCanvasElement };
      composeGridPage(title, page, t, drawn, holder);
      canvases.push(holder.canvas);
    }
  }
  await Promise.all(drawn);   // cells draw async; wait before snapshotting

  if (opts.includeAssets) {
    const tiles = collectAssetTiles(data);
    const pages = chunk(tiles, 9);
    for (let i = 0; i < pages.length; i++) {
      canvases.push(await composeAssetPage(i === 0 ? 'REFERENCE ASSETS' : 'REFERENCE ASSETS (cont.)', pages[i]));
    }
  }

  return assemblePdf(canvases.map(c => canvasToPage(c)));
}

// also export asset paths so the export IPC can copy them into the folder
export function assetExportFiles(data: StoryboardData): Array<{ srcPath: string; fileName: string }> {
  const out: Array<{ srcPath: string; fileName: string }> = [];
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'asset';
  const add = (src: string | undefined, name: string) => { if (src) out.push({ srcPath: src, fileName: name }); };
  data.characters.forEach((c: StoryboardRefSlot) => { add(c.faceImagePath, `asset_char_${slug(c.name)}_face.png`); add(c.sheetImagePath, `asset_char_${slug(c.name)}_sheet.png`); });
  data.places.forEach((p: StoryboardRefSlot) => add(p.refImagePath, `asset_place_${slug(p.name)}.png`));
  data.elements.forEach((e: StoryboardRefSlot) => add(e.refImagePath, `asset_element_${slug(e.name)}.png`));
  return out;
}
