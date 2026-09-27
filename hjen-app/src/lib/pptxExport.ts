// Pitch — PowerPoint (.pptx) export. Hand-rolled OOXML: no external library
// (none can be installed here). Produces an EDITABLE deck — every text element
// is a real PowerPoint text box (font / size / bold / italic / underline /
// colour / alignment / direction preserved) over a background picture. Opens
// in PowerPoint AND Keynote (Keynote imports .pptx natively).
//
// Known limits vs the live preview (documented for the caller):
//  · arbitrary font WEIGHTS collapse to bold/normal (PPTX has only b="1")
//  · image ZOOM/PAN is not mapped — the picture fills its frame at cover
//  · UNDERLINE is honoured; text COLOUR + alignment + RTL are honoured

import type { PitchPage, PitchTheme, PitchElemStyle, PitchImageStyle, PitchBox } from '../types/preprod';
import { isClosePage, normSection, sectionArLabel, pageTitle, splitParas, hasArabic, resolveBox , parseRich, pitchZOf
} from './pitchPdf';

interface PptxOpts { theme: PitchTheme; slug: string; projectName?: string; aspect?: number; slugStyle?: PitchElemStyle; }
export interface PptxImage { dataUrl: string; w: number; h: number; }

// ── geometry (EMU: 1mm = 36000) ── width fixed, height follows the aspect
const MM = 36000;
const SLIDE_W = 297 * MM;
let SLIDE_H = 210 * MM;
const SAHIFA_COL = 96 * MM; // right text column width

const escXml = (s: string) => (s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// ── CRC32 (for the ZIP container) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── minimal STORE-method ZIP writer ──
interface ZipFile { name: string; data: Uint8Array; }
function zipStore(files: ZipFile[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF]);
  const u32 = (v: number) => new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]);
  const cat = (arrs: Uint8Array[]) => { let n = 0; for (const a of arrs) n += a.length; const out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const local = cat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), // sig, ver, flags(UTF-8), method(store), time, date
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0),
      nameBytes, f.data,
    ]);
    chunks.push(local);
    central.push(cat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]));
    offset += local.length;
  }
  const cd = cat(central);
  const eocd = cat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cd.length), u32(offset), u16(0),
  ]);
  return cat([...chunks, cd, eocd]);
}

// ── style → PPTX helpers ──
const FACE: Record<string, string> = {
  'display-serif': 'Instrument Serif Display',
  'display-sans': 'Inter',
  'anton': 'Anton',
  'instrument': 'Instrument Serif',
  'inter': 'Inter',
};
const faceOf = (key: string | undefined, fallback: string) =>
  (key && key.startsWith('u:')) ? key.slice(2) : (key && FACE[key]) || fallback;
const algnOf = (st: PitchElemStyle, def: 'l' | 'r' | 'ctr') =>
  st.align === 'center' ? 'ctr' : st.dir === 'ltr' ? 'l' : st.dir === 'rtl' ? 'r' : def;
const isRtl = (st: PitchElemStyle, defRtl: boolean) => st.dir === 'rtl' || (st.dir !== 'ltr' && defRtl);
const boldOf = (st: PitchElemStyle, defBold: boolean) => (st.weight ? st.weight >= 600 : defBold);

interface RunSpec { text: string; color: string; b?: boolean; i?: boolean; u?: boolean; face?: string; }
const hex = (c?: string) => (c || '').replace('#', '').toUpperCase();
function runXml(r: RunSpec, sz: number, bold: boolean, st: PitchElemStyle, face: string): string {
  const b = r.b ?? bold, i = r.i ?? st.italic, u = r.u ?? st.underline;
  const runFace = r.face ? faceOf(r.face, face) : face;
  const attrs = `sz="${sz}"${b ? ' b="1"' : ''}${i ? ' i="1"' : ''}${u ? ' u="sng"' : ''}`;
  const fill = r.color || hex(st.color);
  // stroke width px → EMU (px × 0.75pt × 12700)
  const lnW = Math.round((st.strokeWidth ?? 0.6) * 0.75 * 12700 * (st.strokePos === 'outside' ? 2 : 1));
  const ln = st.strokeColor ? `<a:ln w="${lnW}"><a:solidFill><a:srgbClr val="${hex(st.strokeColor)}"/></a:solidFill></a:ln>` : '';
  return `<a:r><a:rPr lang="ar-SA" ${attrs} dirty="0">${ln}<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>`
    + `<a:latin typeface="${escXml(runFace)}"/><a:cs typeface="${escXml(runFace)}"/></a:rPr><a:t>${escXml(r.text)}</a:t></a:r>`;
}
// one paragraph, one style, N runs. Line spacing is EXACT points (spcPts),
// mirroring CSS: lineHeight = fontSize × baseLh × lineScale. spcPct would be
// % of the font's own leading (~1.2em, face-dependent) — that spread every
// multi-line title ~20% wider than the preview. sz is in 1/100 pt (like rPr).
function paraXml(runs: string, algn: string, rtl: boolean, baseLh: number, st: PitchElemStyle, sz: number): string {
  const pts = Math.round(sz * baseLh * (st.lineScale ?? 1));   // 1/100 pt
  return `<a:p><a:pPr algn="${algn}"${rtl ? ' rtl="1"' : ''}><a:lnSpc><a:spcPts val="${pts}"/></a:lnSpc></a:pPr>${runs}</a:p>`;
}
function textBox(id: number, name: string, x: number, y: number, cx: number, cy: number, anchor: 'b' | 't' | 'ctr', bodyXml: string, inset = 0, rotate = 0, flipH = false, flipV = false): string {
  const i = Math.round(inset);
  const rot = `${rotate ? ` rot="${Math.round(rotate * 60000)}"` : ''}${flipH ? ' flipH="1"' : ''}${flipV ? ' flipV="1"' : ''}`;   // PPTX: 60000ths of a degree, cw
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm${rot}><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`
    // noAutofit — PowerPoint must NEVER shrink text to fit the box; the
    // preview lets text overflow, so autofit here = silent size drift.
    // Insets are ZERO (PowerPoint defaults pad ~2.5mm; preview boxes do not)
    + `<p:txBody><a:bodyPr wrap="square" anchor="${anchor}" lIns="${i}" tIns="${i}" rIns="${i}" bIns="${i}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${bodyXml}</p:txBody></p:sp>`;
}
// the Layl scrim — bottom-up black gradient, EXACT stops of the preview's
// .ppp-layl__scrim: rgba(0,0,0,.72)@0% → .18@42% → 0@65% (measured bottom-up)
function scrimRect(id: number): string {
  const gs = (pos: number, alpha: number) =>
    `<a:gs pos="${pos}"><a:srgbClr val="000000"><a:alpha val="${alpha}"/></a:srgbClr></a:gs>`;
  // PPTX gradient runs top→bottom at ang 5400000; preview stops are bottom-up → mirror them
  const fill = `<a:gradFill><a:gsLst>${gs(0, 0)}${gs(35000, 0)}${gs(58000, 18000)}${gs(100000, 72000)}</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="scrim"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_W}" cy="${SLIDE_H}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}<a:ln><a:noFill/></a:ln></p:spPr>`
    + `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}
function rectFill(id: number, x: number, y: number, cx: number, cy: number, color: string, alpha?: number): string {
  const fill = `<a:solidFill><a:srgbClr val="${color}">${alpha != null ? `<a:alpha val="${Math.round(alpha * 100000)}"/>` : ''}</a:srgbClr></a:solidFill>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="rect"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}<a:ln><a:noFill/></a:ln></p:spPr>`
    + `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}
// center-crop the source so it COVERS the frame without distortion (fixes the
// stretch), then apply zoom + pan from the image layer.
function coverSrcRect(fw: number, fh: number, iw: number, ih: number, im?: PitchImageStyle): string {
  const cl = (v: number) => Math.round(Math.min(0.9, Math.max(0, v)) * 100000);
  let l = 0, t = 0, r = 0, b = 0;
  if (iw > 0 && ih > 0) {
    const frameAR = fw / fh, imageAR = iw / ih;
    if (imageAR > frameAR) { const c = (1 - frameAR / imageAR) / 2; l = c; r = c; }
    else { const c = (1 - imageAR / frameAR) / 2; t = c; b = c; }
  }
  const scale = Math.max(1, im?.scale ?? 1);
  const visW = 1 - l - r, visH = 1 - t - b;
  if (scale > 1) { const e = (1 - 1 / scale) / 2; l += e * visW; r += e * visW; t += e * visH; b += e * visH; }
  const sx = (im?.x ?? 0) * visW, sy = (im?.y ?? 0) * visH;
  l = Math.max(0, l - sx); r = Math.max(0, r + sx); t = Math.max(0, t - sy); b = Math.max(0, b + sy);
  return `<a:srcRect l="${cl(l)}" t="${cl(t)}" r="${cl(r)}" b="${cl(b)}"/>`;
}
function bgPic(id: number, rId: string, x: number, y: number, cx: number, cy: number, im: PitchImageStyle | undefined, iw: number, ih: number): string {
  const alpha = im?.opacity ?? 1;
  const alphaMod = alpha < 1 ? `<a:alphaModFix amt="${Math.round(alpha * 100000)}"/>` : '';
  const srcRect = coverSrcRect(cx, cy, iw, ih, im);
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="bg"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${rId}">${alphaMod}</a:blip>${srcRect}<a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

const PT = 100; // sz units per point
interface SlideImg { w: number; h: number; }

// a text box placed at a fractional box
function tboxAt(id: number, name: string, box: PitchBox, paras: string, anchor: 'b' | 't' | 'ctr' = 't', inset = 0, rotate = 0, flipH = false, flipV = false): string {
  return textBox(id, name, box.x * SLIDE_W, box.y * SLIDE_H, box.w * SLIDE_W, box.h * SLIDE_H, anchor, paras, inset, rotate, flipH, flipV);
}
// one paragraph for an element — content-aware direction + alignment
function elemPara(text: string, sz: number, color: string, defBold: boolean, defFace: string, baseLh: number, st: PitchElemStyle): string {
  const rtl = st.dir === 'rtl' || (st.dir !== 'ltr' && hasArabic(text));
  const algn = st.align === 'center' ? 'ctr' : (rtl ? 'r' : 'l');
  const base = hex(st.color) || color;               // the LAYER'S colour wins (parity with the preview)
  const face = faceOf(st.fontKey, defFace);
  // "{#hex|words}" colour spans → separate runs
  const runs = parseRich(text).map(seg => runXml({ text: seg.t, color: seg.color ? hex(seg.color) : base, b: seg.bold, i: seg.italic, u: seg.underline, face: seg.fontKey }, sz, boldOf(st, defBold), st, face)).join('');
  return paraXml(runs, algn, rtl, baseLh, st, sz);
}
const elemParas = (texts: string[], sz: number, color: string, defFace: string, baseLh: number, st: PitchElemStyle) =>
  texts.map(t => elemPara(t, sz, color, false, defFace, baseLh, st)).join('');

// build the shapes of one slide (background + independent text boxes + extras)
function slideShapes(page: PitchPage, opts: PptxOpts, byPath: Map<string, ImgRef>, idx: number): string {
  const L = page.layout ?? {};
  const T = L.title ?? {}, B = L.body ?? {};
  const close = isClosePage(page);
  const K = L.kicker ?? {};
  const bg = page.imagePath ? byPath.get(page.imagePath) : undefined;
  const kb = resolveBox(page, opts.theme, 'kicker', close);
  const tb = resolveBox(page, opts.theme, 'title', close);
  const bb = resolveBox(page, opts.theme, 'body', close);
  const showImg = !!bg && !L.image?.hidden;   // eye toggle
  const pageBg = page.bgColor ? hex(page.bgColor) : null;
  let id = 2;
  // Z-BAND LAW — shapes carry the shared z (pitchZOf) and are emitted sorted,
  // because PPTX stacking IS document order. Text always lands above images.
  const out: Array<{ z: number; xml: string }> = [];
  const put = (z: number, xml: string) => out.push({ z, xml });
  const emit = () => out.sort((a, b) => a.z - b.z).map(o => o.xml).join('');
  const zx = (key: string) => pitchZOf(page, key);
  if (pageBg) put(0, rectFill(id++, 0, 0, SLIDE_W, SLIDE_H, pageBg));
  const darkPage = !(opts.theme === 'sahifa' && !close);
  // running slug — every page, above every layer (parity: preview/HTML z 5000)
  if (opts.slug) {
    const ss = opts.slugStyle ?? {};
    const sb = ss.box ?? { x: 0.047, y: 0.024, w: 0.5, h: 0.04 };
    put(5000, tboxAt(id++, 'slug', sb, elemPara(opts.slug.toUpperCase(), Math.round(7 * (ss.fontScale ?? 1) * PT), hex(ss.color) || (darkPage ? 'F5F5F5' : '141414'), false, 'Inter', 1.2, ss)));
  }
  // folio — the page number, bottom-right, italic serif (parity: 9pt Georgia)
  {
    const fw = (14 * MM) / SLIDE_W, fh = (9 * MM) / SLIDE_H;
    const fbox = { x: 1 - fw - (14 * MM) / SLIDE_W, y: 1 - fh - (4 * MM) / SLIDE_H, w: fw, h: fh };
    put(5000, tboxAt(id++, 'folio', fbox, elemPara(String(idx + 1), Math.round(9 * PT), darkPage ? 'F5F5F5' : '141414', false, 'Georgia', 1, { italic: true, align: 'end', dir: 'ltr' }), 'b'));
  }
  // user-added layers — text boxes + image pictures (placed in their boxes)
  const extraColor = (opts.theme === 'sahifa' && !close) ? '141414' : 'F5F5F5';
  const pushExtras = () => {
    for (const x of (page.extras ?? [])) {
      if (x.hidden) continue;
      if (x.kind === 'image') {
        const info = x.imagePath ? byPath.get(x.imagePath) : undefined;
        if (!info) continue;
        let bx = x.box.x * SLIDE_W, by = x.box.y * SLIDE_H, bw = x.box.w * SLIDE_W, bh = x.box.h * SLIDE_H;
        if (x.image?.fit === 'contain' && info.w > 0 && info.h > 0) {
          // contain — whole image visible inside the box (PNG logos), centred
          const k = Math.min(bw / info.w, bh / info.h);
          const cw = info.w * k, ch = info.h * k;
          bx += (bw - cw) / 2; by += (bh - ch) / 2; bw = cw; bh = ch;
          put(zx(x.id), bgPic(id++, info.rId, bx, by, bw, bh, { ...x.image, scale: Math.max(1, x.image?.scale ?? 1) }, info.w, info.h));
        } else {
          put(zx(x.id), bgPic(id++, info.rId, bx, by, bw, bh, x.image, info.w, info.h));
        }
        continue;
      }
      const st = x.style ?? {};
      if (st.bg) put(zx(x.id) - 1, rectFill(id++, x.box.x * SLIDE_W, x.box.y * SLIDE_H, x.box.w * SLIDE_W, x.box.h * SLIDE_H, hex(st.bg)));
      if ((x.text || '').trim()) {
        // 11pt base — parity with the preview's extra-text size
        const paras = (x.text || '').split('\n').map(t => elemPara(t, Math.round(11 * (st.fontScale ?? 1) * PT), hex(st.color) || extraColor, false, 'Inter', 1.5 * (st.lineScale ?? 1), st)).join('');
        put(zx(x.id), tboxAt(id++, 'extra', x.box, paras, 't', st.bg ? 0.045 * x.box.w * SLIDE_W : 0, st.rotate ?? 0, !!st.flipH, !!st.flipV));
      }
    }
  };

  // CLOSE typographic (no image) → dark background
  if (close && !bg) {
    if (!pageBg) put(0, rectFill(id++, 0, 0, SLIDE_W, SLIDE_H, '0A0A0A'));
    if (!K.hidden) put(zx('kicker'), tboxAt(id++, 'section', kb, elemPara('WHY US', Math.round(8 * PT), '9A9A9A', false, 'Inter', 1.2, K)));
    if (!T.hidden) put(zx('title'), tboxAt(id++, 'title', tb, elemPara(pageTitle(page, opts.projectName), Math.round(30 * (T.fontScale ?? 1) * PT), 'F5F5F5', true, 'Instrument Serif Display', 1.1, T)));
    if (!B.hidden) put(zx('body'), tboxAt(id++, 'body', bb, elemParas(splitParas(page.text, 3), Math.round(13 * (B.fontScale ?? 1) * PT), 'C8C8C8', 'Instrument Serif Display', 1.5, B)));
    pushExtras();
    return emit();
  }

  if (opts.theme === 'sahifa' && !close) {
    const mediaW = SLIDE_W - SAHIFA_COL;
    if (showImg && bg) put(zx('image'), bgPic(id++, bg.rId, 0, 0, mediaW, SLIDE_H, L.image, bg.w, bg.h));
    put(490, rectFill(id++, mediaW, 0, SAHIFA_COL, SLIDE_H, pageBg ?? 'FFFFFF'));   // column paper — above images, below text
    const display = sectionArLabel(page.section);
    if (!T.hidden) put(zx('title'), tboxAt(id++, 'title', tb, elemPara(display, Math.round(30 * (T.fontScale ?? 1) * PT), '141414', true, 'Instrument Serif Display', 1.15, T)));
    if (!K.hidden) put(zx('kicker'), tboxAt(id++, 'section', kb, elemPara(normSection(page.section), Math.round(7.5 * PT), '8A8A8A', false, 'Inter', 1.2, K)));
    if (!B.hidden) put(zx('body'), tboxAt(id++, 'body', bb, elemParas(splitParas(page.text, 2), Math.round(11.5 * (B.fontScale ?? 1) * PT), '141414', 'Instrument Serif Display', 1.9, B)));
    pushExtras();
    return emit();
  }

  // Layl — dark full-bleed + the unconditional scrim (parity with the preview)
  if (showImg && bg) put(zx('image'), bgPic(id++, bg.rId, 0, 0, SLIDE_W, SLIDE_H, L.image, bg.w, bg.h));
  else if (!pageBg) put(0, rectFill(id++, 0, 0, SLIDE_W, SLIDE_H, '0A0A0A'));
  if (L.image?.scrim !== false) put(zx('image') + 1, scrimRect(id++));

  const isCover = normSection(page.section) === 'COVER';
  const kicker = isCover ? 'CAMPAIGN PITCH · HJEN' : normSection(page.section);
  const title = pageTitle(page, opts.projectName);
  const titleArabic = hasArabic(title);
  const titleFace = faceOf(T.fontKey, titleArabic ? 'Instrument Serif Display' : 'Anton');
  const tsz = Math.round(34 * (T.fontScale ?? 1) * PT);
  const trtl = T.dir === 'rtl' || (T.dir !== 'ltr' && titleArabic);
  const talgn = T.align === 'center' ? 'ctr' : (trtl ? 'r' : 'l');
  const titleText = titleArabic ? title : title.toUpperCase();
  const titleRuns = parseRich(titleText).map(seg => runXml({ text: seg.t, color: seg.color ? hex(seg.color) : (hex(T.color) || 'F5F5F5'), b: seg.bold, i: seg.italic, u: seg.underline, face: seg.fontKey }, tsz, boldOf(T, titleArabic), T, titleFace)).join('')
    + (T.noSig ? '' : runXml({ text: '\u2060.', color: 'D1B310' }, tsz, boldOf(T, titleArabic), T, titleFace));
  if (!K.hidden) put(zx('kicker'), tboxAt(id++, 'section', kb, elemPara(kicker, Math.round(8 * (K.fontScale ?? 1) * PT), hex(K.color) || 'F5F5F5', false, 'Inter', 1.4, K)));
  if (!T.hidden) put(zx('title'), tboxAt(id++, 'title', tb, paraXml(titleRuns, talgn, trtl, 0.98, T, tsz)));
  if (!B.hidden) put(zx('body'), tboxAt(id++, 'body', bb, elemParas((page.text || '').split('\n').filter(t => t.trim()), Math.round(13 * (B.fontScale ?? 1) * PT), hex(B.color) || 'F5F5F5', 'Instrument Serif Display', 1.7, B)));
  pushExtras();
  return emit();
}

interface ImgRef { rId: string; w: number; h: number; }
interface SlideRel { rId: string; file: string; }

function slideXml(page: PitchPage, opts: PptxOpts, byPath: Map<string, ImgRef>, idx: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${slideShapes(page, opts, byPath, idx)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function slideRels(rels: SlideRel[]): string {
  const imgRels = rels.map(r => `<Relationship Id="${r.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${r.file}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${imgRels}</Relationships>`;
}

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="HJEN"><a:themeElements><a:clrScheme name="HJEN"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="141414"/></a:dk2><a:lt2><a:srgbClr val="F5F5F5"/></a:lt2><a:accent1><a:srgbClr val="D1B310"/></a:accent1><a:accent2><a:srgbClr val="7A7A7A"/></a:accent2><a:accent3><a:srgbClr val="9E9E9E"/></a:accent3><a:accent4><a:srgbClr val="4A4A4A"/></a:accent4><a:accent5><a:srgbClr val="B0B0B0"/></a:accent5><a:accent6><a:srgbClr val="2A2A2A"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="HJEN"><a:majorFont><a:latin typeface="Anton"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="HJEN"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;

const LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; ext: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : mime.includes('webp') ? 'png' : 'jpg';
  return { bytes, ext };
}

export function buildPptx(pages: PitchPage[], opts: PptxOpts, images: Map<string, PptxImage>): Uint8Array {
  SLIDE_H = Math.round(SLIDE_W / (opts.aspect || (297 / 210)));
  const enc = new TextEncoder();
  const files: ZipFile[] = [];
  const add = (name: string, text: string) => files.push({ name, data: enc.encode(text) });

  const N = pages.length;
  // per-slide media: background + every image extra, each its own rId + file
  const slideAssets = pages.map((p, i) => {
    const rels: SlideRel[] = [];
    const byPath = new Map<string, ImgRef>();
    let rid = 2;   // rId1 is the slide layout
    const addImg = (imgPath?: string) => {
      if (!imgPath || byPath.has(imgPath)) return;
      const info = images.get(imgPath);
      if (!info) return;
      const dec = decodeDataUrl(info.dataUrl);
      if (!dec) return;
      const file = `image${i + 1}_${rels.length + 1}.${dec.ext}`;
      files.push({ name: `ppt/media/${file}`, data: dec.bytes });
      const rId = `rId${rid++}`;
      rels.push({ rId, file });
      byPath.set(imgPath, { rId, w: info.w, h: info.h });
    };
    addImg(p.imagePath);
    for (const x of p.extras ?? []) if (x.kind === 'image') addImg(x.imagePath);
    return { rels, byPath };
  });

  // [Content_Types].xml
  const slideOverrides = pages.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}</Types>`);

  // _rels/.rels
  add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);

  // ppt/presentation.xml — master rId1, slides rId2..rId(N+1), theme rId(N+2)
  const sldIds = pages.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  add('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="${SLIDE_H}" cy="${SLIDE_W}"/></p:presentation>`);

  const presRels = pages.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('');
  add('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${presRels}<Relationship Id="rId${N + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`);

  add('ppt/theme/theme1.xml', THEME_XML);
  add('ppt/slideMasters/slideMaster1.xml', SLIDE_MASTER);
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', MASTER_RELS);
  add('ppt/slideLayouts/slideLayout1.xml', SLIDE_LAYOUT);
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', LAYOUT_RELS);

  pages.forEach((p, i) => {
    const asset = slideAssets[i];
    add(`ppt/slides/slide${i + 1}.xml`, slideXml(p, opts, asset.byPath, i));
    add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, slideRels(asset.rels));
  });

  return zipStore(files);
}

// ── WYSIWYG deck — every slide is ONE full-bleed picture of the app's own
// preview (pixel-identical to what the user sees; the editable-shapes path can
// never truly match the canvas). Captures come from the hidden export renderer.
export function buildPptxFromCaptures(jpegs: Uint8Array[], aspect: number): Uint8Array {
  SLIDE_H = Math.round(SLIDE_W / (aspect || (297 / 210)));
  const enc = new TextEncoder();
  const files: ZipFile[] = [];
  const add = (name: string, text: string) => files.push({ name, data: enc.encode(text) });
  const N = jpegs.length;

  const slideOverrides = jpegs.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}</Types>`);
  add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  const sldIds = jpegs.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  add('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${sldIds}</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="${SLIDE_H}" cy="${SLIDE_W}"/></p:presentation>`);
  const presRels = jpegs.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('');
  add('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${presRels}<Relationship Id="rId${N + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`);
  add('ppt/theme/theme1.xml', THEME_XML);
  add('ppt/slideMasters/slideMaster1.xml', SLIDE_MASTER);
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', MASTER_RELS);
  add('ppt/slideLayouts/slideLayout1.xml', SLIDE_LAYOUT);
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', LAYOUT_RELS);

  jpegs.forEach((data, i) => {
    files.push({ name: `ppt/media/pagecap${i + 1}.jpg`, data });
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="2" name="page ${i + 1}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_W}" cy="${SLIDE_H}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    add(`ppt/slides/slide${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${pic}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/pagecap${i + 1}.jpg"/></Relationships>`);
  });
  return zipStore(files);
}
