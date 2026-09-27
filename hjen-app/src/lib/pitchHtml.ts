// Pitch — HTML export. A single self-contained .html (images embedded as data
// URLs) the client opens in any browser. Mirrors the Layl / Sahifa systems and
// honours every layers-editor override, including the independent, positioned
// title/body boxes and content-aware RTL/LTR.

import type { PitchPage, PitchTheme, PitchElemStyle } from '../types/preprod';
import {
  isClosePage, normSection, sectionArLabel, pageTitle, splitParas, hasArabic, pitchFontCss, resolveBox, parseRich, pitchZOf, sigSplit,
} from './pitchPdf';

interface HtmlOpts {
  theme: PitchTheme; slug: string; projectName?: string; aspect?: number;
  slugStyle?: PitchElemStyle;   // user-placed running header/footer — every page, above every layer
  fontCss?: string;             // embedded @font-face rules for installed u: fonts (data URLs)
}

// rich colour spans — "{#hex|words}" → <span style="color:#hex"> (parity with the app preview)
function rich(text: string): string {
  return parseRich(text || '').map(seg => {
    const css: string[] = [];
    if (seg.color) css.push(`color:${seg.color}`);
    if (seg.bold) css.push('font-weight:800');
    if (seg.italic) css.push('font-style:italic');
    if (seg.underline) css.push('text-decoration:underline');
    if (seg.fontKey) css.push(`font-family:${(pitchFontCss(seg.fontKey) || '').replace(/"/g, "'")}`);
    return css.length ? `<span style="${css.join(';')}">${esc(seg.t)}</span>` : esc(seg.t);
  }).join('');
}

// Z-BAND LAW — shared with the preview and the PPTX exporter (pitchPdf).
const zOf = pitchZOf;

const esc = (s: string) => (s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// content-aware inline CSS for one text element
function elemCss(st: PitchElemStyle | undefined, text: string): string {
  const s = st ?? {};
  const dir = s.dir === 'rtl' ? 'rtl' : s.dir === 'ltr' ? 'ltr' : (hasArabic(text) ? 'rtl' : 'ltr');
  const align = s.align === 'center' ? 'center' : dir === 'rtl' ? 'right' : 'left';
  const parts = [`--pp-fscale:${s.fontScale ?? 1}`, `--pp-lhscale:${s.lineScale ?? 1}`, `direction:${dir}`, `text-align:${align}`];
  if (s.rotate || s.flipH || s.flipV) parts.push(`transform:${s.rotate ? `rotate(${s.rotate}deg) ` : ''}${s.flipH ? 'scaleX(-1) ' : ''}${s.flipV ? 'scaleY(-1)' : ''}`.trim(), 'transform-origin:center center');
  // SINGLE quotes only — this lands inside style="…"; double quotes truncate the attribute
  if (s.fontKey) parts.push(`font-family:${(pitchFontCss(s.fontKey) || '').replace(/"/g, "'")}`);
  if (s.weight) parts.push(`font-weight:${s.weight}`);
  if (s.italic) parts.push('font-style:italic');
  if (s.underline) parts.push('text-decoration:underline');
  if (s.color) parts.push(`color:${s.color}`);
  if (s.strokeColor) {
    parts.push(`-webkit-text-stroke:${(s.strokeWidth ?? 0.6) * (s.strokePos === 'outside' ? 2 : 1)}px ${s.strokeColor}`);
    if (s.strokePos === 'outside') parts.push('paint-order:stroke');
  }
  return parts.join(';');
}
const boxCss = (b: { x: number; y: number; w: number; h: number }) =>
  `left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%`;
function imgCss(im: { opacity?: number; scale?: number; x?: number; y?: number } | undefined): string {
  const s = im ?? {};
  return `opacity:${s.opacity ?? 1};transform:translate(${(s.x ?? 0) * 100}%,${(s.y ?? 0) * 100}%) scale(${Math.max(1, s.scale ?? 1)});transform-origin:center`;
}
const paras = (text: string, max: number) => splitParas(text, max).map(p => `<p>${esc(p)}</p>`).join('');

// user-added layers (text / image) — free-floating boxes
function extrasHtml(page: PitchPage, images: Map<string, string>): string {
  return (page.extras ?? []).filter(x => !x.hidden).map(x => {
    const z = zOf(page, x.id);
    if (x.kind === 'text') {
      const st = x.style ?? {};
      const hasText = !!(x.text || '').trim();
      const boxExtra = (st.bg ? `;background:${st.bg}` : '') + (st.bg && hasText ? ';padding:4.5%' : '');
      const bs = `${boxCss(x.box)};z-index:${z}${boxExtra}`;
      return `<div class="tbox" style="${bs}"><div class="xtext" style="${elemCss(st, x.text || '')}">${rich(x.text || '')}</div></div>`;
    }
    const url = x.imagePath ? images.get(x.imagePath) : undefined;
    if (!url) return '';
    const fit = x.image?.fit === 'contain' ? 'contain' : 'cover';
    return `<div class="tbox" style="${boxCss(x.box)};z-index:${z};overflow:hidden"><img src="${url}" style="width:100%;height:100%;object-fit:${fit};${imgCss(x.image)}" alt=""></div>`;
  }).join('');
}

function slideHtml(page: PitchPage, opts: HtmlOpts, dataUrl: string | undefined, index: number, images: Map<string, string>): string {
  const folio = String(index + 1).padStart(2, '0');
  const close = isClosePage(page);
  const L = page.layout ?? {};
  const kb = resolveBox(page, opts.theme, 'kicker', close);
  const tb = resolveBox(page, opts.theme, 'title', close);
  const bb = resolveBox(page, opts.theme, 'body', close);
  const showK = !L.kicker?.hidden, showT = !L.title?.hidden, showB = !L.body?.hidden;
  const media = (dataUrl && !L.image?.hidden) ? `<img src="${dataUrl}" style="${imgCss(L.image)}" alt="">` : '';
  const ss = opts.slugStyle;
  const sb = ss?.box ?? { x: 0.047, y: 0.024, w: 0.5, h: 0.04 };
  const slugStyleCss = ss
    ? `${boxCss(sb)};z-index:5000;top:${sb.y * 100}%;left:${sb.x * 100}%;` +
      (ss.color ? `color:${ss.color};opacity:1;` : '') +
      (ss.fontScale ? `font-size:${7 * ss.fontScale}pt;` : '') +
      (ss.align === 'center' ? 'text-align:center;' : ss.align === 'end' ? 'text-align:right;' : '')
    : '';
  const slug = opts.slug ? `<div class="slug"${slugStyleCss ? ` style="${slugStyleCss}"` : ''}>${esc(opts.slug)}</div>` : '';
  const bg = page.bgColor ? ` style="background:${page.bgColor}"` : '';

  if (close && !dataUrl) {
    const closeTitle = pageTitle(page, opts.projectName);
    return `<section class="slide layl"${bg}>${slug}
      ${showK ? `<div class="tbox" style="${boxCss(kb)}"><div class="eyebrow" style="${elemCss(L.kicker, 'WHY US')}">WHY US</div></div>` : ''}
      ${showT ? `<div class="tbox" style="${boxCss(tb)}"><h2 class="h1" style="${elemCss(L.title, closeTitle)}">${esc(closeTitle)}</h2></div>` : ''}
      ${showB ? `<div class="tbox" style="${boxCss(bb)}"><div class="body" style="${elemCss(L.body, page.text)}">${paras(page.text, 3)}</div></div>` : ''}
      ${extrasHtml(page, images)}<div class="folio">${folio}</div></section>`;
  }

  if (opts.theme === 'sahifa' && !close) {
    const display = sectionArLabel(page.section);
    return `<section class="slide sahifa"${bg}>
      <div class="media">${media}</div><div class="paper"></div>
      ${opts.slug ? `<div class="slug rtl">${esc(opts.slug)}</div>` : ''}
      ${showT ? `<div class="tbox" style="${boxCss(tb)}"><div class="display" style="${elemCss(L.title, display)}">${esc(display)}</div></div>` : ''}
      ${showK ? `<div class="tbox" style="${boxCss(kb)}"><div class="deckline" style="${elemCss(L.kicker, normSection(page.section))}">${esc(normSection(page.section))}</div></div>` : ''}
      ${showB ? `<div class="tbox" style="${boxCss(bb)}"><div class="body" style="${elemCss(L.body, page.text)}">${paras(page.text, 2)}</div></div>` : ''}
      ${extrasHtml(page, images)}<div class="folio">${folio}</div></section>`;
  }

  // Layl
  const isCover = normSection(page.section) === 'COVER';
  const kicker = isCover ? 'CAMPAIGN PITCH · HJEN' : normSection(page.section);
  const title = pageTitle(page, opts.projectName);
  const titleArabic = hasArabic(title);
  const titleBase = titleArabic && !L.title?.fontKey
    ? "font-family:'Instrument Serif Display','Instrument Serif','Geeza Pro',serif;font-weight:700;" : '';
  // scrim — UNCONDITIONAL on every Layl page, exactly like the preview
  // (.ppp-layl__scrim renders always; light text overflowing dark cards
  // depends on it — dropping it on light pages made that text vanish)
  const scrim = L.image?.scrim === false ? '' : `<div class="scrim" style="z-index:${zOf(page, 'image') + 1}"></div>`;
  return `<section class="slide layl"${bg}>
    <div class="bg" style="z-index:${zOf(page, 'image')}">${media}</div>${scrim}${slug}
    ${showK ? `<div class="tbox" style="${boxCss(kb)};z-index:${zOf(page, 'kicker')}"><div class="kicker" style="${elemCss(L.kicker, kicker)}">${rich(kicker)}</div></div>` : ''}
    ${showT ? `<div class="tbox" style="${boxCss(tb)};z-index:${zOf(page, 'title')}"><h1 class="h1" style="${titleBase}${elemCss(L.title, title)}">${(()=>{const tt=titleArabic?title:title.toUpperCase();if(L.title?.noSig)return rich(tt);const sp=sigSplit(tt);return `${rich(sp.pre)}<span style="white-space:nowrap">${rich(sp.last)}<span class="sig">.</span></span>`})()}</h1></div>` : ''}
    ${showB && (page.text || '').trim() ? `<div class="tbox" style="${boxCss(bb)};z-index:${zOf(page, 'body')}"><div class="body ar" style="${elemCss(L.body, page.text)}">${rich(page.text)}</div></div>` : ''}
    ${extrasHtml(page, images)}<div class="folio">${folio}</div></section>`;
}

const STYLE = `
*{margin:0;padding:0;box-sizing:border-box}
:root{--gold:#D1B310}
html,body{height:100%}
body{background:#0b0d0f;font-family:'Inter',system-ui,sans-serif;overflow:hidden}
/* interactive deck — one slide per screen, swipe / arrows / click to move */
.deck{display:flex;width:100vw;height:100vh;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-behavior:smooth;-webkit-overflow-scrolling:touch}
.deck::-webkit-scrollbar{display:none}
.screen{flex:0 0 100vw;height:100vh;scroll-snap-align:center;display:flex;align-items:center;justify-content:center;position:relative}
.screen .slide{transform-origin:center center}
.navbar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:50;display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(18,18,20,.72);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.13);border-radius:999px;color:#eee;font:500 12px/1 'Inter',sans-serif;user-select:none}
.navbar button{background:none;border:none;color:#eee;font-size:17px;line-height:1;cursor:pointer;padding:3px 8px;border-radius:8px}
.navbar button:hover{background:rgba(255,255,255,.14)}
.navbar .count{font-variant-numeric:tabular-nums;letter-spacing:.06em;opacity:.85;min-width:58px;text-align:center}
.navbar .fs{font-size:14px}
.nav-hint{position:fixed;right:16px;bottom:24px;z-index:50;color:rgba(255,255,255,.4);font:400 11px/1 'Inter',sans-serif;letter-spacing:.03em}
.slide{position:relative;width:297mm;height:210mm;overflow:hidden;color:#111;background:#000;box-shadow:0 10px 50px rgba(0,0,0,.55);transform-origin:top center}
.slide.layl{background:#0a0a0a;color:#F5F5F5}
.bg{position:absolute;inset:0}
.bg img{width:100%;height:100%;object-fit:cover;display:block}
.scrim{position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.72) 0%,rgba(0,0,0,.18) 42%,rgba(0,0,0,0) 65%)}
.slug{position:absolute;top:6mm;left:14mm;font:400 7pt/1 'Inter',monospace;letter-spacing:.14em;text-transform:uppercase;opacity:.85;z-index:3}
.slug.rtl{left:auto;right:14mm;direction:rtl;letter-spacing:0;text-transform:none;font:400 8.5pt/1 'Instrument Serif Display','Instrument Serif','Geeza Pro',serif}
.tbox{position:absolute;z-index:3}
.kicker{font-family:'Inter',monospace;font-weight:400;font-size:calc(8pt*var(--pp-fscale,1));line-height:1;letter-spacing:.22em;text-transform:uppercase;margin-bottom:4mm;opacity:.9}
.eyebrow{font:400 calc(8pt*var(--pp-fscale,1))/1 'Inter',monospace;letter-spacing:.2em;text-transform:uppercase;color:#D1B310;margin-bottom:8mm}
.h1{font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;font-size:calc(34pt*var(--pp-fscale,1));line-height:calc(.98*var(--pp-lhscale,1));margin:0}
.sig{color:var(--gold)}
.body{font-family:'Instrument Serif Display','Geeza Pro',serif;font-size:calc(13pt*var(--pp-fscale,1));line-height:calc(1.7*var(--pp-lhscale,1));white-space:pre-wrap}
.body p{margin:0}
.xtext{width:100%;font-family:'Inter','Geeza Pro',sans-serif;font-size:calc(11pt*var(--pp-fscale,1));line-height:calc(1.5*var(--pp-lhscale,1));white-space:pre-wrap}
.folio{position:absolute;right:14mm;bottom:6mm;font:italic 400 9pt/1 'Instrument Serif',Georgia,serif;opacity:.8;z-index:60}
/* Sahifa — white editorial */
.slide.sahifa{background:#fff;color:#141414}
.sahifa .media{position:absolute;left:0;top:0;width:67.7%;height:100%;overflow:hidden}
.sahifa .media img{width:100%;height:100%;object-fit:cover}
.sahifa .paper{position:absolute;right:0;top:0;width:32.3%;height:100%;background:#fff}
.sahifa .slug{position:absolute;right:14mm;left:auto;opacity:.7}
.display{font-family:'Instrument Serif Display','Geeza Pro',serif;font-weight:700;font-size:calc(30pt*var(--pp-fscale,1));line-height:calc(1.15*var(--pp-lhscale,1));margin-bottom:6mm}
.deckline{font:400 calc(7.5pt*var(--pp-fscale,1))/1 'Inter',monospace;letter-spacing:.18em;text-transform:uppercase;opacity:.55;margin-bottom:8mm}
.sahifa .body{color:#141414;font-size:calc(11.5pt*var(--pp-fscale,1));line-height:calc(1.9*var(--pp-lhscale,1))}
.sahifa .body p{margin:0 0 5mm}
.sahifa .folio{color:#141414}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  @page{size:A4 landscape;margin:0}
  html,body{height:auto;overflow:visible;background:#fff}
  .deck{display:block;width:auto;height:auto;overflow:visible;scroll-snap-type:none}
  .screen{display:block;height:auto;page-break-after:always}
  .screen .slide,.slide{box-shadow:none;transform:none!important}
  .navbar,.nav-hint{display:none!important}
}
`;

// Deck navigation: fit each slide to the viewport, move with ← → / click / swipe
// (scroll-snap gives touch+trackpad swipe for free), keep a live page counter,
// and a fullscreen toggle. GIF images animate natively (they are <img> tags).
const NAV_JS = `
(function(){
  var deck=document.querySelector('.deck');
  var screens=[].slice.call(document.querySelectorAll('.screen'));
  if(!deck||!screens.length)return;
  var cur=0;
  function fit(){var vw=window.innerWidth,vh=window.innerHeight;screens.forEach(function(sc){var s=sc.querySelector('.slide');if(!s)return;var k=Math.min((vw*0.94)/s.offsetWidth,(vh*0.9)/s.offsetHeight);s.style.transform='scale('+k+')';});}
  function counter(){var el=document.getElementById('nav-count');if(el)el.textContent=(cur+1)+' / '+screens.length;}
  function go(i){cur=Math.max(0,Math.min(screens.length-1,i));deck.scrollTo({left:cur*window.innerWidth,behavior:'smooth'});counter();}
  window.addEventListener('resize',function(){fit();deck.scrollLeft=cur*window.innerWidth;});
  var t;deck.addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){var i=Math.round(deck.scrollLeft/window.innerWidth);if(i!==cur){cur=i;counter();}},60);});
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){e.preventDefault();go(cur+1);}
    else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();go(cur-1);}
    else if(e.key==='Home'){e.preventDefault();go(0);}
    else if(e.key==='End'){e.preventDefault();go(screens.length-1);}
  });
  var prev=document.getElementById('nav-prev'),next=document.getElementById('nav-next'),fs=document.getElementById('nav-fs');
  if(prev)prev.onclick=function(){go(cur-1);};
  if(next)next.onclick=function(){go(cur+1);};
  if(fs)fs.onclick=function(){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();};
  fit();counter();
})();
`;

export function buildPitchHtml(pages: PitchPage[], opts: HtmlOpts, images: Map<string, string>): string {
  const screens = pages
    .map((p, i) => `<div class="screen">${slideHtml(p, opts, p.imagePath ? images.get(p.imagePath) : undefined, i, images)}</div>`)
    .join('\n');
  const titleTag = esc(`${opts.projectName || opts.slug || 'HJEN'} — Campaign Pitch`);
  const heightMm = Math.round((297 / (opts.aspect || (297 / 210))) * 10) / 10;
  const pageCss = `@page{size:297mm ${heightMm}mm;margin:0}`;
  const nav = pages.length > 1
    ? `<div class="navbar"><button id="nav-prev" title="Previous (←)">‹</button><span class="count" id="nav-count">1 / ${pages.length}</span><button id="nav-next" title="Next (→)">›</button><button class="fs" id="nav-fs" title="Fullscreen">⤢</button></div>
<div class="nav-hint">← → to navigate · ⤢ fullscreen · ⌘P to save PDF</div>`
    : '';
  return `<!doctype html>
<html lang="ar" dir="ltr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titleTag}</title>
<style>${opts.fontCss || ''}\n${STYLE}\n.slide{height:${heightMm}mm}\n@media print{${pageCss}}</style></head>
<body>
<div class="deck">
${screens}
</div>
${nav}
<script>${NAV_JS}</script>
</body>
</html>`;
}
