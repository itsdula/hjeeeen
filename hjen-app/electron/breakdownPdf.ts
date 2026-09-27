// Breakdown 360 → PDF — «معالجة الإعلان». Renders an installed breakdown as a
// paginated A4-landscape document on the house deck system (statusbar / body /
// footerbar skeleton, console+paper palette, Thmanyah type) and prints it via
// an offscreen BrowserWindow → printToPDF. Everything is self-contained:
// fonts and frames ride as data URIs, so the export works offline and outside
// the repo. The PDF lands beside the breakdown: _mind/breakdowns/<slug>/.

import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// ─── data shape (kept loose — breakdown.json is validated at assemble time) ──
interface BdFrame { id: string; file: string; t?: number; beat?: string }
interface BdElement {
  id: string; claim_en: string; claim_ar?: string; howHjenMakesIt?: string;
  frameIds: string[]; dimension?: string; weight?: number;
}
interface BdAxis {
  key: string; title_en: string; title_ar: string; summary?: string;
  heroFrameIds: string[]; findings: BdElement[];
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fontFace(dir: string, file: string, family: string, weight: number): string {
  try {
    const b64 = fs.readFileSync(path.join(dir, file)).toString('base64');
    return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:${weight};font-display:block}`;
  } catch { return ''; }
}

function embeddedFonts(): string {
  const dir = path.join(app.getAppPath(), 'src', 'assets', 'fonts');
  return [
    fontFace(dir, 'thmanyahsans-Regular.woff2', 'Thmanyah Sans', 400),
    fontFace(dir, 'thmanyahsans-Medium.woff2', 'Thmanyah Sans', 500),
    fontFace(dir, 'thmanyahsans-Bold.woff2', 'Thmanyah Sans', 700),
    fontFace(dir, 'thmanyahserifdisplay-Regular.woff2', 'Thmanyah Serif Display', 400),
    fontFace(dir, 'thmanyahserifdisplay-Bold.woff2', 'Thmanyah Serif Display', 700),
    fontFace(dir, 'thmanyahserifdisplay-Black.woff2', 'Thmanyah Serif Display', 900),
  ].join('\n');
}

// ─── the document ────────────────────────────────────────────────────────────

export function buildBreakdownHtml(bd: any, framesBase: string, arabic?: any): string {
  const imgCache = new Map<string, string>();
  const dataUri = (frameId?: string | null): string => {
    if (!frameId) return '';
    if (imgCache.has(frameId)) return imgCache.get(frameId)!;
    try {
      const rec = (bd.frames as BdFrame[]).find(f => f.id === frameId);
      const file = rec ? (path.isAbsolute(rec.file) ? rec.file : path.join(framesBase, rec.file)) : '';
      const uri = `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
      imgCache.set(frameId, uri);
      return uri;
    } catch { return ''; }
  };
  const img = (id: string | undefined | null, cls = ''): string => {
    const u = dataUri(id);
    return u ? `<img class="${cls}" src="${u}">` : '';
  };
  const strip = (ids: string[], cls = 'strip'): string => {
    const shots = (ids ?? []).map(i => img(i, '')).filter(Boolean);
    return shots.length ? `<div class="${cls}" data-n="${shots.length}">${shots.join('')}</div>` : '';
  };

  const p = bd.pipeline ?? {};
  const brief = p.brief ?? {};
  const big = brief.bigIdea ?? {};
  const treat = p.treatment ?? {};
  const pairs = treat.choicePairs ?? {};
  const axes: BdAxis[] = bd.axes ?? [];
  const totalFindings = axes.reduce((n, a) => n + (a.findings?.length ?? 0), 0);

  let pageNo = 0;
  const foot = (sectionAr: string, sectionEn: string): string => {
    pageNo += 1;
    return `
    <div class="statusbar"><span class="sb-l">HJEN STUDIO — BREAKDOWN 360</span><span class="sb-c">${esc(bd.ad?.brand)} · ${esc(bd.ad?.title)}</span><span class="sb-r" dir="rtl">هذا الإعلان صُنع بهجين — قراءة عكسية</span></div>`;
  };
  const footer = (sectionAr: string): string => `
    <div class="footerbar"><span dir="rtl">${esc(sectionAr)}</span><span class="pageno">${String(pageNo).padStart(2, '0')}</span></div>`;

  const pages: string[] = [];

  // ── cover ──────────────────────────────────────────────────────────────────
  const coverFrame = treat.firstFrameId ?? axes[0]?.heroFrameIds?.[0];
  pageNo += 1;
  pages.push(`
  <section class="slide dark cover">
    ${img(coverFrame, 'cover-img')}
    <div class="cover-veil"></div>
    <div class="cover-body">
      <div class="cover-kicker mono">BREAKDOWN 360 · ${esc(bd.ad?.brand)} · ${esc(bd.ad?.year ?? '')} · ${esc(Math.round(bd.ad?.durationS ?? 0))}S</div>
      <h1 class="cover-title">${esc(bd.ad?.title)}</h1>
      <div class="cover-ar" dir="rtl">${esc(bd.ad?.logline_ar ?? '')}</div>
      <div class="cover-en">${esc(bd.ad?.logline_en ?? '')}</div>
      <div class="cover-premise mono" dir="rtl">الفرضية الحاكمة: هذا الإعلان فيلم AI صنعه هجين — وكل ما يلي هو المسار الذي كان سيصنعه.</div>
    </div>
    <div class="footerbar"><span dir="rtl">الغلاف</span><span class="pageno">01</span></div>
  </section>`);

  // ── 01 · the read ─────────────────────────────────────────────────────────
  pages.push(`
  <section class="slide dark">
    ${foot('القراءة', 'THE READ')}
    <div class="body two-col">
      <div>
        <div class="label mono" dir="rtl">القراءة — ماذا رأينا</div>
        <div class="prop">${esc(brief.proposition ?? '')}</div>
        <div class="field"><span class="k mono">BIG IDEA</span><div class="v strong">${esc(big.name ?? '')}</div></div>
        <div class="field"><span class="k mono">HOOK</span><div class="v">${esc(big.hook ?? '')}</div></div>
        <div class="field"><span class="k mono">INSIGHT</span><div class="v">${esc(big.insight ?? '')}</div></div>
        ${big.culturalTruth ? `<div class="field"><span class="k mono">CULTURAL TRUTH</span><div class="v">${esc(big.culturalTruth)}</div></div>` : ''}
      </div>
      <div>
        <div class="label mono">WANT — BUT — UNTIL</div>
        <div class="wbu">${esc(p.wantButUntil ?? '')}</div>
        ${strip((p.beats ?? []).map((b: any) => b.frameIds?.[0]).filter(Boolean), 'strip strip-tall')}
      </div>
    </div>
    ${footer('القراءة')}
  </section>`);

  // ── 02 · the reverse brief ────────────────────────────────────────────────
  pages.push(`
  <section class="slide paper">
    ${foot('البريف المعكوس', 'THE REVERSE BRIEF')}
    <div class="body two-col">
      <div>
        <div class="label mono" dir="rtl">البريف المعكوس — ما الذي طُلب حتماً</div>
        <div class="raw">${esc(brief.rawBrief ?? '')}</div>
      </div>
      <div>
        <div class="label mono">THE PERSONA</div>
        <div class="persona">${esc(brief.persona ?? '')}</div>
      </div>
    </div>
    ${footer('البريف المعكوس')}
  </section>`);

  // ── 03 · the five beats ───────────────────────────────────────────────────
  const beatCols = (p.beats ?? []).map((b: any) => `
    <div class="beat">
      <div class="beat-name mono">${esc(b.beat)}</div>
      ${img(b.frameIds?.[0], 'beat-img')}
      <div class="beat-visual">${esc(b.visual ?? '')}</div>
      ${b.vo ? `<div class="beat-vo">“${esc(b.vo)}”</div>` : ''}
    </div>`).join('');
  pages.push(`
  <section class="slide dark">
    ${foot('الضربات الخمس', 'THE FIVE BEATS')}
    <div class="body">
      <div class="label mono" dir="rtl">القصة — الضربات الخمس</div>
      <div class="beats">${beatCols}</div>
    </div>
    ${footer('الضربات الخمس')}
  </section>`);

  // ── 04 · the treatment ────────────────────────────────────────────────────
  const pairRows = Object.entries({
    ASPECT: pairs.aspect, LENS: pairs.lens, LIGHT: pairs.lightDirection,
    MOVE: pairs.cameraMove, HOUR: pairs.hour, PLACE: pairs.placeRegister,
  }).map(([k, v]) => `<div class="pair"><span class="k mono">${k}</span><span class="v">${esc(v ?? '')}</span></div>`).join('');
  pages.push(`
  <section class="slide paper">
    ${foot('المعالجة', 'THE TREATMENT')}
    <div class="body two-col">
      <div>
        <div class="label mono" dir="rtl">المعالجة — الاختيارات المصنوعة</div>
        <div class="look">${esc(treat.lookPhrase ?? '')}</div>
        <div class="pairs">${pairRows}</div>
      </div>
      <div class="ff-col">
        <div class="ff"><span class="k mono">FIRST FRAME</span>${img(treat.firstFrameId, 'ff-img')}</div>
        <div class="ff"><span class="k mono">LAST FRAME</span>${img(treat.lastFrameId, 'ff-img')}</div>
      </div>
    </div>
    ${footer('المعالجة')}
  </section>`);

  // ── 05 · the references ───────────────────────────────────────────────────
  const refCards = (p.references ?? []).map((r: any) => `
    <div class="refcard">
      ${img(r.frameIds?.[0], 'ref-img')}
      <div class="ref-note">${esc(r.note ?? '')}</div>
    </div>`).join('');
  pages.push(`
  <section class="slide dark">
    ${foot('المراجع', 'THE REFERENCES')}
    <div class="body">
      <div class="label mono" dir="rtl">المراجع — ما كان الباحث البصري سيجمعه</div>
      <div class="refs">${refCards}</div>
    </div>
    ${footer('المراجع')}
  </section>`);

  // ── 06 · the pitch skeleton ───────────────────────────────────────────────
  const pitchRows = (p.pitch ?? []).map((pg: any, i: number) => `
    <div class="pitchrow">
      <span class="pitch-no mono">${String(i + 1).padStart(2, '0')}</span>
      ${img(pg.frameId, 'pitch-img')}
      <div class="pitch-txt"><div class="strong">${esc(pg.title ?? '')}</div><div>${esc(pg.body ?? '')}</div></div>
    </div>`).join('');
  pages.push(`
  <section class="slide paper">
    ${foot('هيكل العرض', 'THE PITCH SKELETON')}
    <div class="body">
      <div class="label mono" dir="rtl">هيكل العرض — خمس صفحات تكسب الغرفة</div>
      <div class="pitchlist">${pitchRows}</div>
    </div>
    ${footer('هيكل العرض')}
  </section>`);

  // ── النسخة العربية — the Arabic re-authoring, when it exists ─────────────
  if (arabic && arabic.proposition_ar) {
    const modelLine = `صيغت بـ ${esc(arabic.model || 'ChatGPT')} · ${esc(String(arabic.createdAt ?? '').slice(0, 10))}`;
    pages.push(`
  <section class="slide paper arx" dir="rtl">
    ${foot('النسخة العربية', 'THE ARABIC CUT')}
    <div class="body two-col">
      <div>
        <div class="label mono" dir="rtl">النسخة العربية — القراءة</div>
        <div class="arx-prop arx-serif">${esc(arabic.proposition_ar)}</div>
        <div class="field"><span class="k mono" dir="ltr">BIG IDEA</span><div class="v strong arx-serif">${esc(arabic.bigIdea_ar?.name ?? '')}</div></div>
        <div class="field"><span class="k mono" dir="ltr">HOOK</span><div class="v">${esc(arabic.bigIdea_ar?.hook ?? '')}</div></div>
        <div class="field"><span class="k mono" dir="ltr">INSIGHT</span><div class="v">${esc(arabic.bigIdea_ar?.insight ?? '')}</div></div>
        <div class="field"><span class="k mono" dir="ltr">CULTURAL TRUTH</span><div class="v">${esc(arabic.bigIdea_ar?.culturalTruth ?? '')}</div></div>
      </div>
      <div>
        <div class="label mono" dir="rtl">البريف المعكوس</div>
        <div class="arx-raw">${esc(arabic.brief_ar ?? '')}</div>
        <div class="label mono" dir="rtl" style="margin-top:6mm">الإنسان</div>
        <div class="arx-persona">${esc(arabic.persona_ar ?? '')}</div>
        <div class="arx-model mono" dir="ltr">${modelLine}</div>
      </div>
    </div>
    ${footer('النسخة العربية')}
  </section>`);

    const arxBeats = (arabic.beats_ar ?? []).map((b: any) => `
      <div class="beat">
        <div class="beat-name mono" dir="ltr">${esc(b.beat)}</div>
        <div class="arx-vo arx-serif">«${esc(b.vo ?? '')}»</div>
        <div class="beat-visual">${esc(b.visual ?? '')}</div>
      </div>`).join('');
    const arxPairs = Object.entries({
      ASPECT: arabic.treatment_ar?.pairs?.aspect, LENS: arabic.treatment_ar?.pairs?.lens,
      LIGHT: arabic.treatment_ar?.pairs?.light, MOVE: arabic.treatment_ar?.pairs?.move,
      HOUR: arabic.treatment_ar?.pairs?.hour, PLACE: arabic.treatment_ar?.pairs?.place,
    }).map(([k, v]) => `<div class="pair"><span class="k mono" dir="ltr">${k}</span><span class="v">${esc(v ?? '')}</span></div>`).join('');
    pages.push(`
  <section class="slide paper arx" dir="rtl">
    ${foot('النسخة العربية', 'THE ARABIC CUT')}
    <div class="body">
      <div class="label mono" dir="rtl">الضربات الخمس — بالتعليق الصوتي العربي</div>
      <div class="beats beats--paper">${arxBeats}</div>
      <div class="arx-treatrow">
        <div class="arx-look arx-serif">«${esc(arabic.treatment_ar?.lookPhrase ?? '')}»</div>
        <div class="pairs arx-pairs">${arxPairs}</div>
      </div>
    </div>
    ${footer('النسخة العربية')}
  </section>`);

    const arxRefs = (arabic.references_ar ?? []).map((r: string) => `<div class="arx-ref">${esc(r)}</div>`).join('');
    const arxPitch = (arabic.pitch_ar ?? []).map((pg: any, i: number) => `
      <div class="arx-pitchrow">
        <span class="pitch-no mono" dir="ltr">${String(i + 1).padStart(2, '0')}</span>
        <div class="pitch-txt"><div class="strong arx-serif">${esc(pg.title ?? '')}</div><div>${esc(pg.body ?? '')}</div></div>
      </div>`).join('');
    pages.push(`
  <section class="slide paper arx" dir="rtl">
    ${foot('النسخة العربية', 'THE ARABIC CUT')}
    <div class="body two-col">
      <div>
        <div class="label mono" dir="rtl">هيكل العرض — بالعربية</div>
        ${arxPitch}
      </div>
      <div>
        <div class="label mono" dir="rtl">المراجع — نأخذ ونترك</div>
        ${arxRefs}
      </div>
    </div>
    ${footer('النسخة العربية')}
  </section>`);
  }

  // ── the eleven axes ───────────────────────────────────────────────────────
  for (const axis of axes) {
    const findings = (axis.findings ?? []).map(f => `
      <div class="find">
        <div class="find-head">
          <span class="dots">${'●'.repeat(f.weight ?? 1)}${'○'.repeat(Math.max(0, 3 - (f.weight ?? 1)))}</span>
          ${f.dimension ? `<span class="dim mono">${esc(f.dimension)}</span>` : ''}
        </div>
        ${f.claim_ar ? `<div class="find-ar" dir="rtl">${esc(f.claim_ar)}</div>` : ''}
        <div class="find-en">${esc(f.claim_en)}</div>
        ${f.howHjenMakesIt ? `<div class="find-how mono">⌁ ${esc(f.howHjenMakesIt)}</div>` : ''}
        ${strip((f.frameIds ?? []).slice(0, 3), 'strip strip-sm')}
      </div>`).join('');
    pages.push(`
  <section class="slide dark axis">
    ${foot(axis.title_ar, axis.title_en.toUpperCase())}
    <div class="body">
      <div class="axis-head">
        <div>
          <div class="axis-en mono">${esc(axis.title_en.toUpperCase())}</div>
          <div class="axis-ar" dir="rtl">${esc(axis.title_ar)}</div>
        </div>
        <div class="axis-sum">${esc(axis.summary ?? '')}</div>
      </div>
      ${strip((axis.heroFrameIds ?? []).slice(0, 4), 'strip strip-hero')}
      <div class="finds">${findings}</div>
    </div>
    ${footer(axis.title_ar)}
  </section>`);
  }

  // ── closing plate ─────────────────────────────────────────────────────────
  pages.push(`
  <section class="slide dark close">
    ${foot('الخاتمة', 'CLOSE')}
    <div class="body close-body">
      <div class="close-big" dir="rtl">${esc(totalFindings)} حقيقة حِرَفية · ${esc(axes.length)} محاور · ${esc((p.beats ?? []).length)} ضربات</div>
      <div class="close-line mono">HJEN STUDIO · BREAKDOWN 360 · ${esc(bd.slug)} · ${esc(String(bd.createdAt ?? '').slice(0, 10))}</div>
    </div>
    ${footer('الخاتمة')}
  </section>`);

  return `<!DOCTYPE html>
<html lang="ar">
<head>
<meta charset="utf-8">
<title>${esc(bd.ad?.brand)} — ${esc(bd.ad?.title)} · Breakdown 360</title>
<style>
${embeddedFonts()}
:root{
  --console:#000000; --paper:#F5F5F5; --signal:#D1B310;
  --rule-l:rgba(0,0,0,0.18); --rule-d:rgba(245,245,245,0.22);
  --ink-dim-d:rgba(245,245,245,0.72); --ink-mut-d:rgba(245,245,245,0.45);
  --ink-dim-l:rgba(0,0,0,0.75); --ink-mut-l:rgba(0,0,0,0.45);
}
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:10pt}
body{font-family:'Thmanyah Sans',system-ui,sans-serif;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.mono{font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:7pt;letter-spacing:0.14em}
/* Arabic never takes mono or letter-spacing — joined letters are sacred. */
[dir="rtl"], [dir="rtl"] *{font-family:'Thmanyah Sans',system-ui,sans-serif !important;letter-spacing:0 !important}
.cover-ar, .cover-ar *, .axis-ar, .find-ar, .close-big{font-family:'Thmanyah Serif Display',serif !important}
.slide{width:297mm;height:210mm;position:relative;overflow:hidden;page-break-after:always;display:grid;grid-template-rows:13mm 1fr 11mm}
.slide:last-child{page-break-after:auto}
.slide.dark{background:var(--console);color:var(--paper)}
.slide.paper{background:var(--paper);color:var(--console)}
.statusbar{display:flex;align-items:center;justify-content:space-between;gap:8mm;padding:0 14mm;font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:6.5pt;letter-spacing:0.16em}
.dark .statusbar{border-bottom:0.5pt solid var(--rule-d);color:var(--ink-mut-d)}
.paper .statusbar{border-bottom:0.5pt solid var(--rule-l);color:var(--ink-mut-l)}
.footerbar{display:flex;align-items:center;justify-content:space-between;padding:0 14mm;font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:6.5pt;letter-spacing:0.16em}
.dark .footerbar{border-top:0.5pt solid var(--rule-d);color:var(--ink-mut-d)}
.paper .footerbar{border-top:0.5pt solid var(--rule-l);color:var(--ink-mut-l)}
.pageno{color:var(--signal)}
.body{padding:8mm 14mm;overflow:hidden;min-height:0}
.two-col{display:grid;grid-template-columns:1.15fr 1fr;gap:12mm}
.label{margin-bottom:5mm;color:var(--signal)}
.strong{font-weight:700}

/* cover */
.cover{grid-template-rows:1fr 11mm}
.cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.5}
.cover-veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0.25) 0%,rgba(0,0,0,0.82) 78%)}
.cover-body{position:relative;align-self:end;padding:0 14mm 10mm}
.cover-kicker{color:var(--signal);margin-bottom:4mm}
.cover-title{font-family:'Thmanyah Serif Display',serif;font-weight:900;font-size:52pt;line-height:0.95;letter-spacing:-0.01em;margin-bottom:5mm}
.cover-ar{font-family:'Thmanyah Serif Display',serif;font-weight:400;font-size:15pt;margin-bottom:2mm}
.cover-en{font-size:9.5pt;color:var(--ink-dim-d);margin-bottom:5mm}
.cover-premise{color:var(--ink-mut-d)}
.cover .footerbar{position:relative}

/* the read */
.prop{font-family:'Thmanyah Serif Display',serif;font-weight:700;font-size:19pt;line-height:1.25;margin-bottom:7mm}
.field{margin-bottom:4mm}
.field .k{display:block;color:var(--signal);margin-bottom:1mm}
.field .v{font-size:9.5pt;color:var(--ink-dim-d)}
.field .v.strong{font-size:12pt;color:var(--paper)}
.wbu{font-size:11pt;line-height:1.6;color:var(--ink-dim-d);margin-bottom:7mm}

/* reverse brief */
.raw{font-size:10pt;line-height:1.7;color:var(--ink-dim-l);white-space:pre-wrap}
.persona{font-size:10.5pt;line-height:1.7;color:var(--ink-dim-l);border-inline-start:2pt solid var(--signal);padding-inline-start:5mm}

/* beats */
.beats{display:grid;grid-template-columns:repeat(5,1fr);gap:6mm;height:100%}
.beat{display:flex;flex-direction:column;gap:3mm;min-width:0}
.beat-name{color:var(--signal)}
.beat-img{width:100%;aspect-ratio:16/9;object-fit:cover}
.beat-visual{font-size:8.5pt;line-height:1.5;color:var(--ink-dim-d)}
.beat-vo{font-size:8.5pt;font-style:italic;color:var(--ink-mut-d);margin-top:auto}

/* treatment */
.look{font-family:'Thmanyah Serif Display',serif;font-weight:700;font-size:22pt;line-height:1.15;margin-bottom:8mm}
.pairs{display:grid;grid-template-columns:1fr 1fr;gap:3mm 8mm}
.pair{display:flex;flex-direction:column;gap:0.5mm;border-top:0.5pt solid var(--rule-l);padding-top:2mm}
.pair .k{color:var(--ink-mut-l)}
.pair .v{font-size:8.5pt;line-height:1.4}
.ff-col{display:flex;flex-direction:column;gap:6mm}
.ff .k{display:block;color:var(--ink-mut-l);margin-bottom:1.5mm}
.ff-img{width:100%;aspect-ratio:16/9;object-fit:cover}

/* references */
.refs{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:7mm;height:100%}
.refcard{display:grid;grid-template-columns:1.1fr 1fr;gap:5mm;min-height:0}
.ref-img{width:100%;height:100%;object-fit:cover;min-height:0}
.ref-note{font-size:8.5pt;line-height:1.55;color:var(--ink-dim-d);align-self:center}

/* pitch */
.pitchlist{display:flex;flex-direction:column;gap:4.5mm;height:100%}
.pitchrow{display:grid;grid-template-columns:8mm 38mm 1fr;gap:6mm;align-items:center;border-top:0.5pt solid var(--rule-l);padding-top:3mm}
.pitch-no{color:var(--signal)}
.pitch-img{width:100%;aspect-ratio:16/9;object-fit:cover}
.pitch-txt{font-size:8.5pt;line-height:1.5;color:var(--ink-dim-l)}
.pitch-txt .strong{font-size:10pt;color:var(--console);margin-bottom:1mm}

/* axes */
.axis .body{display:flex;flex-direction:column;gap:5mm}
.axis-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12mm}
.axis-en{color:var(--signal);margin-bottom:1mm}
.axis-ar{font-family:'Thmanyah Serif Display',serif;font-weight:900;font-size:26pt;line-height:1}
.axis-sum{max-width:120mm;font-size:8.5pt;line-height:1.5;color:var(--ink-dim-d);text-align:left}
.strip{display:grid;gap:2mm;grid-template-columns:1fr 1fr}
.strip[data-n="1"]{grid-template-columns:1fr}
.strip[data-n="2"]{grid-template-columns:1fr 1fr}
.strip[data-n="3"]{grid-template-columns:repeat(3,1fr)}
.strip[data-n="4"]{grid-template-columns:repeat(4,1fr)}
.strip-tall{grid-template-columns:1fr 1fr !important}
.strip img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.strip-hero img{aspect-ratio:21/9}
.strip-tall{margin-top:6mm}
.finds{flex:1;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:min-content;gap:5mm;min-height:0;overflow:hidden}
.find{border-top:0.5pt solid var(--rule-d);padding-top:2.5mm;min-width:0}
.find-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1.5mm}
.dots{color:var(--signal);font-size:6pt;letter-spacing:2px}
.dim{color:var(--ink-mut-d)}
.find-ar{font-family:'Thmanyah Serif Display',serif;font-size:9pt;line-height:1.45;margin-bottom:1.5mm}
.find-en{font-size:7pt;line-height:1.45;color:var(--ink-mut-d);margin-bottom:1.5mm}
.find-how{color:var(--signal);font-size:6pt;line-height:1.4;letter-spacing:0.04em;margin-bottom:2mm}
.strip-sm img{aspect-ratio:16/9}

/* النسخة العربية */
.arx .field .v{color:var(--ink-dim-l)}
.arx .field .v.strong{color:var(--console)}
.arx-serif, .arx-serif *{font-family:'Thmanyah Serif Display',serif !important}
.arx-prop{font-size:20pt;font-weight:700;line-height:1.3;margin-bottom:7mm}
.arx-raw{font-size:9.5pt;line-height:1.75;color:var(--ink-dim-l)}
.arx-persona{font-size:10pt;line-height:1.7;color:var(--ink-dim-l);border-inline-start:2pt solid var(--signal);padding-inline-start:5mm}
.arx-model{margin-top:6mm;color:var(--ink-mut-l);text-align:left}
.beats--paper .beat-visual{color:var(--ink-dim-l)}
.beats--paper .beat-name{color:var(--signal)}
.arx-vo{font-size:11.5pt;font-weight:700;line-height:1.5}
.arx-treatrow{display:grid;grid-template-columns:1fr 1.2fr;gap:12mm;margin-top:8mm;border-top:0.5pt solid var(--rule-l);padding-top:6mm}
.arx-look{font-size:16pt;font-weight:700;line-height:1.3}
.arx-ref{font-size:9pt;line-height:1.65;color:var(--ink-dim-l);border-top:0.5pt solid var(--rule-l);padding:2.5mm 0}
.arx-pitchrow{display:grid;grid-template-columns:8mm 1fr;gap:4mm;border-top:0.5pt solid var(--rule-l);padding:2.5mm 0;font-size:8.5pt;line-height:1.55;color:var(--ink-dim-l)}
.arx-pitchrow .strong{font-size:10.5pt;color:var(--console);margin-bottom:1mm}

/* close */
.close-body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6mm}
.close-big{font-family:'Thmanyah Serif Display',serif;font-weight:700;font-size:24pt}
.close-line{color:var(--ink-mut-d)}
</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`;
}

// ─── print ───────────────────────────────────────────────────────────────────

export async function exportBreakdownPdf(breakdownDir: string): Promise<{ ok: boolean; path?: string; message?: string }> {
  try {
    const jsonPath = path.join(breakdownDir, 'breakdown.json');
    const bd = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    let arabic: any = null;
    try {
      const arPath = path.join(breakdownDir, 'arabic_rewrite.json');
      if (fs.existsSync(arPath)) arabic = JSON.parse(fs.readFileSync(arPath, 'utf-8'));
    } catch { /* the Arabic cut is optional — a corrupt file never blocks the export */ }
    const html = buildBreakdownHtml(bd, breakdownDir, arabic);
    const htmlPath = path.join(breakdownDir, '_export.html');
    fs.writeFileSync(htmlPath, html);

    const win = new BrowserWindow({
      show: false, width: 1400, height: 990,
      webPreferences: { offscreen: true, sandbox: true },
    });
    try {
      await win.loadFile(htmlPath);
      // let the embedded fonts + big data-URI images settle
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true);
      await new Promise(r => setTimeout(r, 400));
      const pdf = await win.webContents.printToPDF({
        pageSize: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      const outPath = path.join(breakdownDir, `HJEN_Breakdown360_${bd.slug}_${stamp}.pdf`);
      fs.writeFileSync(outPath, pdf);
      return { ok: true, path: outPath };
    } finally {
      win.destroy();
      try { fs.unlinkSync(htmlPath); } catch { /* temp file — best effort */ }
    }
  } catch (err) {
    return { ok: false, message: String(err).slice(0, 300) };
  }
}
