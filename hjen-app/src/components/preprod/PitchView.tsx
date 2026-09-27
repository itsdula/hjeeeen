// Pitch — وثيقة الحملة. Standalone tool: turns the Treatment's page-plan into
// a themed campaign pitch document (Layl dark full-bleed / Sahifa white
// editorial) with a live A4-landscape preview and a print-grade PDF export.
//
// Persistence: NO dedicated stage — pitch data lives inside stage 4 as the
// `pitch` sidecar key next to the treatment fields (never clobbered: the
// whole stage-4 object is loaded, merged, and written back).
//
// House laws: MADE not Generate (verbs here: Pull / Resolve / Make / Export);
// one image per page — CLOSE is the only typographic-only exception; no
// "Honest risk" text, disclaimers, or AI-tell phrasing on any exported page.

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PreprodShell, usePreprodProject, useStageData, Field, Busy, useToast } from './shared';
import { useStore } from '../../store';
import type { TreatmentData, PitchData, PitchPage, PitchTheme, PitchLayout, PitchElemStyle, PitchImageStyle, PitchBox, PitchExtraLayer, PitchParaStyle, HuntedRef, ReferencesData } from '../../types/preprod';

// Layer keys: built-ins are fixed strings; user-added layers use their id.
type TextLayer = 'kicker' | 'title' | 'body';
const BUILTIN_TEXT: TextLayer[] = ['kicker', 'title', 'body'];
const isBuiltinText = (k: string): k is TextLayer => (BUILTIN_TEXT as string[]).includes(k);
const DEFAULT_EXTRA_BOX: PitchBox = { x: 0.32, y: 0.36, w: 0.36, h: 0.14 };
import type { StoryboardData } from '../../types/storyboard';
import type { LibraryAsset } from '../../types/hjen-bridge';
import { getPOV, assignImages } from '../../lib/creative360';
import {
  isClosePage, normSection, sectionArLabel, pageTitle, fileUrl, hasArabic,
  PITCH_FONTS, pitchFontCss, resolveBox, parseRich, plainText, sigSplit,
} from '../../lib/pitchPdf';
import { buildPitchHtml } from '../../lib/pitchHtml';
import { buildPptx } from '../../lib/pptxExport';
import { USER_FONTS } from '../../lib/userFonts';

// bundled Inter faces — embedded into exports so the default serif/sans
// travel with the HTML exactly as the preview renders them
const DEFAULT_FONT_URLS = import.meta.glob('../../assets/fonts/{Inter,InstrumentSerif}-*.woff2', {
  query: '?url', import: 'default', eager: true,
}) as Record<string, string>;
import { PITCH_THEMES } from '../../lib/pitchThemes';
import { LayoutThumb } from './LayoutThumb';
import { ColorDot, type PaletteApi } from './ColorDot';
import { FloatingToolbar } from './FloatingToolbar';
import { ShortcutsOverlay, SpotlightTour } from './PitchOverlays';
import '../../styles/preprod-pitch.css';
import { syncStagesToCreativeGraph } from '../../lib/creativegraph/stageSync';
import { compilePitchManifest } from '../../lib/creativegraph/pitchCompiler';

type ImgSource = 'reference' | 'storyboard' | 'library' | 'file';
interface PickItem { path: string; thumb?: string; label: string; sub?: string; source: ImgSource; }

type Stage4 = TreatmentData & { pitch?: PitchData };
const EMPTY: Stage4 = {};

// design size of the DOM page: 297mm × 210mm at CSS 96dpi
const PAGE_W_PX = 297 * (96 / 25.4);
const PAGE_H_PX = 210 * (96 / 25.4);

// Slide sizes — the value is the aspect ratio (w/h); boxes are fractional so
// they reflow to any aspect. Width stays constant → fonts stay proportional.
const SLIDE_SIZES: Array<{ label: string; aspect: number }> = [
  { label: 'A4 print · 297×210', aspect: 297 / 210 },
  { label: '4:3 · 1024×768', aspect: 4 / 3 },
  { label: '16:9 · 1920×1080', aspect: 16 / 9 },
  { label: '21:9 · 2560×1080', aspect: 21 / 9 },
];

const CLIENT_DIRECT_SECTIONS = ['PRODUCT', 'TALENT', 'EQUIPMENT', 'BUDGET'] as const;

const STUB_TEXT: Record<string, { text: string; imageSpec: string }> = {
  PRODUCT: { text: 'المنتج نفسه — ما الذي يجعله يستحق الكاميرا، وأين يعيش داخل الكادر.', imageSpec: 'لقطة المنتج البطلة — ضوء المنتج الحقيقي، لا ضوء الاستوديو المحايد.' },
  TALENT: { text: 'الوجوه — من يحمل الحملة، ولماذا هذه الوجوه بالذات.', imageSpec: 'بورتريه الكاست الأول — وجه حقيقي في ضوء الحملة.' },
  EQUIPMENT: { text: 'العدة — الكاميرا والعدسات والإضاءة التي تصنع هذا اللوك تحديداً.', imageSpec: 'لقطة من موقع تصوير بنفس العدة — الكاميرا في يد الطاقم.' },
  BUDGET: { text: 'الميزانية — أين يذهب كل ريال، وما الذي يشتريه للشاشة.', imageSpec: 'كادر يجسد قيمة الإنتاج — ما تشتريه الميزانية فعلاً.' },
};

function coverPage(projectName?: string): PitchPage {
  return {
    section: 'COVER',
    text: `شكراً على الثقة.\nهذه الوثيقة نقطة بداية لحملة «${(projectName || '').trim() || 'الحملة'}» — تتطور بعملنا المشترك.`,
    imageSpec: 'الكادر الأول للحملة — اللقطة التي تحمل الوعد كله.',
  };
}

function closePage(): PitchPage {
  return {
    section: 'CLOSE',
    text: 'نعرف هذا العالم من الداخل — الصور في هذه الوثيقة صُنعت داخل توجه الحملة، قبل يوم التصوير الأول.\nما تراه هو العقد: نسلّم الحملة بهذا الجلد نفسه.',
  };
}

function baseName(p?: string): string {
  if (!p) return '';
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  return btoa(binary);
}

async function pickOneImage(): Promise<string | null> {
  const files = await window.hjen.pickImageFiles();
  return files && files.length ? files[0] : null;
}

function imageDims(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => res({ w: 0, h: 0 });
    im.src = dataUrl;
  });
}

// ─── view ───────────────────────────────────────────────────────────────────

export function PitchView() {
  return (
    <PreprodShell tool="Pitch" sub="The winning campaign document, made in-DNA" accent="#E5AAD8">
      <PitchBody />
    </PreprodShell>
  );
}

function PitchBody() {
  const { project } = usePreprodProject();
  const addLedger = useStore(s => s.addLedgerEntry);
  const { data, loaded, update } = useStageData<Stage4>(4, EMPTY);

  const pitch: PitchData = data.pitch ?? {};
  const theme: PitchTheme = pitch.theme ?? 'layl';
  const preset = pitch.preset ?? 8;
  const pages: PitchPage[] = pitch.pages ?? [];
  const slug = pitch.slug ?? '';
  const aspect = pitch.aspect || (297 / 210);
  const themeId = pitch.themeId;
  const activeTheme = PITCH_THEMES.find(t => t.id === themeId);

  const [sel, setSel] = useState(0);
  // Layer selection: a list; the last entry is the "primary" (drives the tools).
  // Shift-click toggles a layer in/out; plain click selects just one.
  const [selKeys, setSelKeys] = useState<string[]>(['title']);
  const selLayer = selKeys[selKeys.length - 1] ?? '';
  const [navMode, setNavMode] = useState<'page' | 'layer'>('layer'); // what the arrow keys drive
  const selectLayer = (k: string, additive = false) => {
    setNavMode('layer');
    setSelKeys(prev => {
      if (!additive) return [k];
      return prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k];
    });
  };
  const [busy, setBusy] = useState(false);
  const [fitting, setFitting] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);   // page being dragged
  const [overIdx, setOverIdx] = useState<number | null>(null);   // drop-target row
  const [picker, setPicker] = useState<number | null>(null);  // page index being resolved
  const [extraPicker, setExtraPicker] = useState<string | null>(null);  // extra-layer id resolving an image
  const [error, setError] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [zoomTool, setZoomTool] = useState(false);   // Z zoom tool · V arrow (toolbar + keyboard)
  // ONE favorite theme, app-wide — ALWAYS exactly one (never zero): defaults to
  // the first registered theme; picking another MOVES the star, it can't be unset.
  const [favTheme, setFavThemeState] = useState<string>(() =>
    localStorage.getItem('hjen.pitch.favTheme') || PITCH_THEMES[0]?.id || 'equip');
  const setFavTheme = (id: string) => {
    setFavThemeState(id);
    localStorage.setItem('hjen.pitch.favTheme', id);
  };
  const [showTour, setShowTour] = useState(false);
  const [leftTab, setLeftTab] = useState<'project' | 'pages' | 'export'>('pages');   // Pages is default
  const projectId = project?.id ?? null;

  // resizable / collapsible rails (persisted per machine)
  const RAILS_KEY = 'hjen.pitch.rails';
  const [rails, setRails] = useState<{ leftW: number; rightW: number; leftC: boolean; rightC: boolean }>(() => {
    try { const r = JSON.parse(localStorage.getItem(RAILS_KEY) || ''); return { leftW: r.leftW ?? 320, rightW: r.rightW ?? 236, leftC: !!r.leftC, rightC: !!r.rightC }; }
    catch { return { leftW: 320, rightW: 236, leftC: false, rightC: false }; }
  });
  const persistRails = (r: typeof rails) => { try { localStorage.setItem(RAILS_KEY, JSON.stringify(r)); } catch { /* ignore */ } };
  const setLeftC = (v: boolean) => setRails(r => { const n = { ...r, leftC: v }; persistRails(n); return n; });
  const setRightC = (v: boolean) => setRails(r => { const n = { ...r, rightC: v }; persistRails(n); return n; });
  const railDrag = useRef<null | { side: 'l' | 'r'; sx: number; start: number }>(null);
  const startRail = (side: 'l' | 'r') => (e: React.PointerEvent) => {
    e.preventDefault();
    railDrag.current = { side, sx: e.clientX, start: side === 'l' ? rails.leftW : rails.rightW };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveRail = (e: React.PointerEvent) => {
    const d = railDrag.current; if (!d) return;
    const dx = e.clientX - d.sx;
    if (d.side === 'l') setRails(r => ({ ...r, leftW: Math.min(480, Math.max(248, d.start + dx)) }));
    else setRails(r => ({ ...r, rightW: Math.min(420, Math.max(208, d.start - dx)) }));
  };
  const endRail = (e: React.PointerEvent) => {
    if (!railDrag.current) return;
    railDrag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    setRails(r => { persistRails(r); return r; });
  };

  useEffect(() => {
    if (sel > 0 && sel >= pages.length) setSel(Math.max(0, pages.length - 1));
  }, [pages.length, sel]);

  // ── undo / redo (≤ 20 steps), STRICTLY per-project ──
  // History records only real user edits (they all flow through setPitch);
  // data loads never touch setPitch, so a project switch/load is never an
  // undoable step. Stacks are cleared whenever the active project changes, so
  // one project's history can never be applied to another.
  const HISTORY_MAX = 20;
  const undoStack = useRef<PitchData[]>([]);
  const redoStack = useRef<PitchData[]>([]);
  const lastEditRef = useRef(0);          // for coalescing a drag into one step
  const histIdRef = useRef<string | null>(null);
  const [undoN, setUndoN] = useState(0);
  const [redoN, setRedoN] = useState(0);
  // reset history on project change (prevents cross-project contamination)
  useEffect(() => {
    undoStack.current = []; redoStack.current = []; lastEditRef.current = 0;
    histIdRef.current = project?.id ?? null;
    setUndoN(0); setRedoN(0);
  }, [project?.id]);

  const setPitch = (patch: Partial<PitchData>) => {
    const cur = data.pitch ?? {};
    // record the pre-edit state; coalesce rapid edits (a drag) into one step
    if (histIdRef.current === (project?.id ?? null)) {
      const now = Date.now();
      if (now - lastEditRef.current > 400) {
        undoStack.current.push(cur);
        if (undoStack.current.length > HISTORY_MAX) undoStack.current.shift();
        redoStack.current = [];
        setUndoN(undoStack.current.length);
        setRedoN(0);
      }
      lastEditRef.current = now;
    }
    update({ pitch: { ...cur, ...patch } });
  };
  const setPages = (next: PitchPage[]) => setPitch({ pages: next });

  // project colour palette — saved swatches shared by every ColorDot (ONE setPitch)
  const palette = pitch.palette ?? [];
  const paletteApi: PaletteApi = {
    palette,
    onAdd: (hex: string) => { if (!palette.includes(hex)) setPitch({ palette: [...palette, hex] }); },
    onRemove: (hex: string) => setPitch({ palette: palette.filter(c => c !== hex) }),
  };

  const undo = () => {
    if (!undoStack.current.length) return;
    const target = undoStack.current.pop()!;
    redoStack.current.push(data.pitch ?? {});
    if (redoStack.current.length > HISTORY_MAX) redoStack.current.shift();
    lastEditRef.current = 0;              // next edit starts a fresh step
    update({ pitch: target });
    setUndoN(undoStack.current.length);
    setRedoN(redoStack.current.length);
  };
  const redo = () => {
    if (!redoStack.current.length) return;
    const target = redoStack.current.pop()!;
    undoStack.current.push(data.pitch ?? {});
    if (undoStack.current.length > HISTORY_MAX) undoStack.current.shift();
    lastEditRef.current = 0;
    update({ pitch: target });
    setUndoN(undoStack.current.length);
    setRedoN(redoStack.current.length);
  };

  // ── Compile the pitch argument from the signed Creative Graph ──
  const pullPlan = async () => {
    setError(null);
    if (!projectId) return;
    setBusy(true);
    try {
      const graph = await syncStagesToCreativeGraph(projectId);
      const manifest = compilePitchManifest(graph, project?.name ?? 'HJEN', preset);
      if (manifest.missing.length) setError(`Pitch contract is thin — missing: ${manifest.missing.join(', ')}.`);
      const prev = pages;
      const used = new Set<number>();
      const next: PitchPage[] = manifest.pages.map(r => {
        const j = prev.findIndex((p, k) => !used.has(k) && normSection(p.section) === normSection(r.section) && !!p.imagePath);
        if (j !== -1) used.add(j);
        return {
          ...r,
          imagePath: j !== -1 ? prev[j].imagePath : undefined,
          imageSource: j !== -1 ? prev[j].imageSource : undefined,
          imageWhy: j !== -1 ? prev[j].imageWhy : undefined,
          layout: j !== -1 ? prev[j].layout : undefined,
        };
      });
      if (pitch.clientDirect) insertClientDirectStubs(next);
      setPitch({ pages: next, manifestFingerprint: manifest.fingerprint, graphRevision: manifest.graphRevision });
      setSel(0);
      showToast(`Compiled ${next.length} graph-backed pages — fitting signed references…`);
      void autoFitImages(next);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // ── Auto-fit: Creative 360 picks the best REFERENCE image for each empty
  //    slide (the initial plan). Only fills blanks — never clobbers a resolved
  //    image. The user overrides any slide from more sources via Resolve. ──
  const autoFitImages = async (list?: PitchPage[]) => {
    if (!projectId || fitting) return;
    const target = list ?? pages;
    const openIdx = target.map((p, i) => ({ p, i })).filter(({ p }) => !isClosePage(p) && !p.imagePath);
    if (openIdx.length === 0) { if (!list) showToast('Every slide already has an image.'); return; }
    setFitting(true); setError(null);
    try {
      const pov = await getPOV(projectId);
      const st = await window.hjen.readStageData({ id: projectId, stage: 2 }) as ReferencesData | null;
      const refs = (st?.refs ?? []).filter((r: HuntedRef) => r.imagePath).slice(0, 20);
      if (!pov || refs.length === 0) {
        showToast('No references to fit yet — hunt references in stage 02 first.');
        return;
      }
      const slides = openIdx.map(({ p }) => ({ section: p.section, spec: p.imageSpec || '' }));
      const paths = refs.map(r => r.imagePath);
      const labels = refs.map(r => `${r.tag || ''}${r.why ? ' — ' + r.why : ''}`.slice(0, 130));
      const assigned = await assignImages(pov, slides, paths, labels);
      if (assigned.length === 0) { showToast('Could not fit references — resolve slides manually.'); return; }
      const next = target.slice();
      let filled = 0;
      for (const a of assigned) {
        const local = openIdx[a.slide - 1];              // slide is 1-based into openIdx
        if (!local || a.image < 1 || a.image > paths.length) continue;
        if (next[local.i].imagePath) continue;           // never overwrite
        next[local.i] = { ...next[local.i], imagePath: paths[a.image - 1], imageSource: 'reference', imageWhy: a.why };
        filled++;
      }
      setPages(next);
      showToast(filled > 0 ? `Fitted references to ${filled} slide(s) — refine any via Resolve.` : 'No reference was a real fit — resolve slides manually.');
    } catch (e: any) {
      setError(`Auto-fit failed — ${String(e?.message || e).slice(0, 160)}`);
    } finally {
      setFitting(false);
    }
  };

  const insertClientDirectStubs = (arr: PitchPage[]) => {
    const missing = CLIENT_DIRECT_SECTIONS.filter(s => !arr.some(p => normSection(p.section) === s));
    if (missing.length === 0) return;
    const closeAt = arr.findIndex(isClosePage);
    const at = closeAt === -1 ? arr.length : closeAt;
    arr.splice(at, 0, ...missing.map(s => ({ section: s, ...STUB_TEXT[s] })));
  };

  const toggleClientDirect = () => {
    const on = !pitch.clientDirect;
    const next = [...pages];
    if (on) {
      insertClientDirectStubs(next);
    } else {
      // remove only untouched stubs — a resolved image is work, keep it
      for (let i = next.length - 1; i >= 0; i--) {
        const n = normSection(next[i].section);
        if ((CLIENT_DIRECT_SECTIONS as readonly string[]).includes(n) && !next[i].imagePath) next.splice(i, 1);
      }
    }
    setPitch({ clientDirect: on, pages: next });
  };

  // ── page list actions ──
  const patchPage = (i: number, patch: Partial<PitchPage>) => {
    setPages(pages.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };
  // Merge into a page's layout overrides (the layers editor).
  const patchLayout = (i: number, patch: Partial<PitchLayout>) => {
    setPages(pages.map((p, j) => (j === i ? { ...p, layout: { ...(p.layout ?? {}), ...patch } } : p)));
  };
  // Merge into ONE text element's style (title / body) — each is its own layer.
  const patchElem = (i: number, elem: TextLayer, patch: Partial<PitchElemStyle>) => {
    setPages(pages.map((p, j) => (j === i
      ? { ...p, layout: { ...(p.layout ?? {}), [elem]: { ...(p.layout?.[elem] ?? {}), ...patch } } }
      : p)));
  };
  // Merge into the image layer's transforms (opacity / scale / pan).
  const patchImage = (i: number, patch: Partial<PitchImageStyle>) => {
    setPages(pages.map((p, j) => (j === i
      ? { ...p, layout: { ...(p.layout ?? {}), image: { ...(p.layout?.image ?? {}), ...patch } } }
      : p)));
  };
  const resetLayout = (i: number) => {
    setPages(pages.map((p, j) => (j === i ? { ...p, layout: undefined } : p)));
  };
  const movePage = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= pages.length) return;
    const next = [...pages];
    [next[i], next[j]] = [next[j], next[i]];
    setPages(next);
    setSel(j);
  };
  // drag-to-reorder: pull a page out and drop it at another slot.
  const reorderPage = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return;
    const next = [...pages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPages(next);
    setSel(to);
  };
  const addPage = () => {
    const next = [...pages];
    const closeAt = next.findIndex(isClosePage);
    const at = closeAt === -1 ? next.length : closeAt;
    next.splice(at, 0, { section: 'VISUALS', text: '', imageSpec: '' });
    setPages(next);
    setSel(at);
  };
  const removePage = (i: number) => {
    setPages(pages.filter((_, j) => j !== i));
    setSel(Math.max(0, Math.min(sel, pages.length - 2)));
  };

  // Resolve now opens a multi-source picker (References · Storyboard · Library ·
  // File) rather than jumping straight to the OS file dialog.
  const resolveImage = (i: number) => { setError(null); setPicker(i); };
  const setExtraImageOnPage = (path: string, source: PickItem['source']) => {
    if (extraPicker == null) return;
    setPages(pages.map((p, j) => (j === sel
      ? { ...p, extras: (p.extras ?? []).map(x => (x.id === extraPicker ? { ...x, imagePath: path, imageSource: source } : x)) }
      : p)));
  };
  const onPick = (item: PickItem) => {
    if (extraPicker != null) { setExtraImageOnPage(item.path, item.source); setExtraPicker(null); return; }
    if (picker == null) return;
    patchPage(picker, { imagePath: item.path, imageSource: item.source, imageWhy: undefined });
    setPicker(null);
  };
  const pickFromFile = async () => {
    try {
      const p = await pickOneImage();
      if (p != null) {
        if (extraPicker != null) setExtraImageOnPage(p, 'file');
        else if (picker != null) patchPage(picker, { imagePath: p, imageSource: 'file', imageWhy: undefined });
      }
    } catch (e: any) {
      setError(`Could not pick the image — ${String(e?.message || e).slice(0, 160)}`);
    }
    setPicker(null); setExtraPicker(null);
  };

  // ── export ── images are optional on every page; only need a page-plan.
  const canExport = loaded && pages.length > 0 && !busy;
  const canExportDraft = canExport;
  const blockReason = pages.length === 0 ? 'Pull the page-plan first.' : undefined;
  const draftBlockReason = blockReason;

  // Every Pitch export lands in <project>/Pitch/ — one place per tool, no picker.
  const nameSeed = (slug || project?.name || 'HJEN').replace(/\s*\/\s*/g, '_').replace(/\s+/g, '_');
  const pitchDir = async (): Promise<string | null> => {
    const r = await window.hjen.projectToolDir({ projectSlug: project?.slug, tool: 'Pitch' });
    if (!r.ok || !r.dir) { setError(r.reason || 'Could not resolve the project folder.'); return null; }
    return r.dir;
  };
  const loadImages = async (): Promise<Map<string, { dataUrl: string; w: number; h: number }>> => {
    const map = new Map<string, { dataUrl: string; w: number; h: number }>();
    const paths = new Set<string>();
    for (const p of pages) {
      if (p.imagePath) paths.add(p.imagePath);
      for (const x of p.extras ?? []) if (x.kind === 'image' && x.imagePath) paths.add(x.imagePath);
    }
    for (const path of paths) {
      const url = await window.hjen.readImageDataUrl(path);
      if (url) { const d = await imageDims(url); map.set(path, { dataUrl: url, w: d.w, h: d.h }); }
    }
    return map;
  };

  // embed EVERY font family the deck resolves to — user fonts (u:<Family>),
  // builtin picker keys (inter → "Inter" from the same Fonts folder), the fixed
  // export-CSS faces (Inter · Anton · Instrument Serif), and the app-bundled
  // Inter faces — as data-URL @font-face rules, so the exported HTML and the
  // hidden PDF window shape text exactly like the preview. No fallback fonts.
  const userFontCss = async (): Promise<string> => {
    const used = new Set<string>(['Inter', 'Anton', 'Instrument Serif']);   // kicker/xtext · h1 · folio
    const note = (k?: string) => {
      if (!k) return;
      const fam = (pitchFontCss(k) || '').match(/"([^"]+)"/)?.[1];
      if (fam) used.add(fam);
    };
    for (const p of pages) {
      const L = p.layout ?? {};
      note(L.kicker?.fontKey); note(L.title?.fontKey); note(L.body?.fontKey);
      for (const x of p.extras ?? []) note(x.style?.fontKey);
    }
    note(pitch?.slugStyle?.fontKey);
    const toB64 = (u8: Uint8Array): string => {
      let bin = '';
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return btoa(bin);
    };
    const css: string[] = [];
    // 1 · Fonts-folder TTFs (user fonts + the builtin faces that live there)
    let fonts: Array<{ family: string; file: string; path: string }> = [];
    try { fonts = (await window.hjen.listFonts()) ?? []; } catch { /* fonts bridge down — bundled faces still embed */ }
    const wanted = fonts.filter(f => used.has(f.family) || (f.family.endsWith(' Italic') && used.has(f.family.slice(0, -7))));
    for (const f of wanted) {
      try {
        const b64 = toB64(new Uint8Array(await (await fetch(fileUrl(f.path)!)).arrayBuffer()));
        css.push(`@font-face{font-family:'${f.family}';src:url(data:font/ttf;base64,${b64}) format('truetype')}`);
        if (f.family.endsWith(' Italic')) {
          css.push(`@font-face{font-family:'${f.family.slice(0, -7)}';font-style:italic;src:url(data:font/ttf;base64,${b64}) format('truetype')}`);
        }
      } catch { /* unreadable font — skip */ }
    }
    // 2 · app-bundled Inter faces — the preview's default body/display serif
    //     ('Instrument Serif Display' is unregistered in-app, so it resolves to
    //     'Instrument Serif'; the export registers BOTH names to the same data).
    const W: Record<string, number> = { Light: 300, Regular: 400, Medium: 500, Bold: 700, Black: 900 };
    for (const [p, url] of Object.entries(DEFAULT_FONT_URLS)) {
      const m = p.match(/(Inter|InstrumentSerif)-(\w+)\.woff2$/i);
      if (!m) continue;
      const fams = m[1].toLowerCase() === 'inter' ? ['Inter'] : ['Instrument Serif', 'Instrument Serif Display'];
      const wght = W[m[2]] ?? (parseInt(m[2], 10) || 400);
      try {
        // '/assets/…' URLs don't resolve on file:// — anchor them to the page
        const abs = new URL(url.replace(/^\//, ''), document.baseURI).href;
        const b64 = toB64(new Uint8Array(await (await fetch(abs)).arrayBuffer()));
        for (const fam of fams) css.push(`@font-face{font-family:'${fam}';font-weight:${wght};src:url(data:font/woff2;base64,${b64}) format('woff2')}`);
      } catch { /* missing asset — skip */ }
    }
    return css.join('\n');
  };

  // ONE renderer, three outputs — the exported HTML mirrors the preview
  // exactly (embedded fonts + images); the PDF is Chromium's print of that
  // same HTML (REAL selectable text, not a picture).
  const buildFaithfulHtml = async (): Promise<{ html: string; folder: string } | null> => {
    const images = new Map<string, string>();
    (await loadImages()).forEach((v, k) => images.set(k, v.dataUrl));
    const fontCss = await userFontCss();
    const html = buildPitchHtml(pages, { theme, slug, slugStyle: pitch?.slugStyle, projectName: project?.name, aspect, fontCss }, images);
    const folder = await pitchDir();
    if (!folder) return null;
    return { html, folder };
  };

  const exportPdf = async () => {
    if (!canExport) return;
    setError(null); setBusy(true);
    try {
      const built = await buildFaithfulHtml();
      if (!built) return;
      const tmp = await window.hjen.exportFile({ folder: built.folder, fileName: '_render_tmp.html', base64: bytesToBase64(new TextEncoder().encode(built.html)) });
      if (!tmp.ok || !tmp.path) { setError(tmp.reason || 'Render temp failed.'); return; }
      const res0 = await window.hjen.pitchPdf({ htmlPath: tmp.path, widthMm: 297, heightMm: 297 / aspect });
      if (!res0.ok || !res0.pdf) { setError(res0.reason || 'PDF print failed.'); return; }
      const bin = atob(res0.pdf);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const folder = built.folder;
      const fileName = `Pitch_${nameSeed}.pdf`;
      const res = await window.hjen.exportFile({ folder, fileName, base64: bytesToBase64(bytes) });
      if (res.ok) {
        setPitch({ lastExportPath: res.path ?? folder });
        void window.hjen.openFolder(folder).catch(() => {});
        void addLedger({ kind: 'note', body: `Pitch: exported ${pages.length}-page ${theme === 'layl' ? 'Layl' : 'Sahifa'} campaign document (Pitch/${fileName}).` });
        showToast(`Exported ${pages.length} pages → Pitch/${fileName}`);
      } else setError(res.reason || 'Export failed.');
    } catch (e: any) {
      setError(`Export failed — ${String(e?.message || e).slice(0, 200)}`);
    } finally { setBusy(false); }
  };

  // Self-contained HTML — images embedded; opens straight in the browser.
  const exportHtml = async () => {
    if (!canExport) return;
    setError(null); setBusy(true);
    try {
      const images = new Map<string, string>();
      (await loadImages()).forEach((v, k) => images.set(k, v.dataUrl));
      const fontCss = await userFontCss();
      const html = buildPitchHtml(pages, { theme, slug, slugStyle: pitch?.slugStyle, projectName: project?.name, aspect, fontCss }, images);
      const folder = await pitchDir();
      if (!folder) return;
      const fileName = `Pitch_${nameSeed}.html`;
      const res = await window.hjen.exportFile({ folder, fileName, base64: bytesToBase64(new TextEncoder().encode(html)) });
      if (res.ok) {
        setPitch({ lastExportPath: res.path ?? folder });
        // open the deck in the default BROWSER (renders + runs nav JS), not the
        // default .html app (which may be a code editor → looks blank).
        if (res.path) void window.hjen.openInBrowser(res.path).catch(() => window.hjen.openFolder(folder).catch(() => {}));
        else void window.hjen.openFolder(folder).catch(() => {});
        void addLedger({ kind: 'note', body: `Pitch: exported ${pages.length}-page interactive HTML deck (Pitch/${fileName}).` });
        showToast(`Exported interactive deck → Pitch/${fileName}`);
      } else setError(res.reason || 'HTML export failed.');
    } catch (e: any) {
      setError(`HTML export failed — ${String(e?.message || e).slice(0, 200)}`);
    } finally { setBusy(false); }
  };

  // Editable PowerPoint (.pptx) — also opens in Keynote.
  const exportPptx = async () => {
    if (!canExportDraft) return;
    setError(null); setBusy(true);
    try {
      const images = await loadImages();
      const bytes = buildPptx(pages, { theme, slug, projectName: project?.name, aspect, slugStyle: pitch?.slugStyle }, images);
      const folder = await pitchDir();
      if (!folder) return;
      const fileName = `Pitch_${nameSeed}.pptx`;
      const res = await window.hjen.exportFile({ folder, fileName, base64: bytesToBase64(bytes) });
      if (res.ok) {
        setPitch({ lastExportPath: res.path ?? folder });
        void window.hjen.openFolder(folder).catch(() => {});
        void addLedger({ kind: 'note', body: `Pitch: exported ${pages.length}-page editable PowerPoint (Pitch/${fileName}).` });
        showToast(`Exported PowerPoint → Pitch/${fileName}`);
      } else setError(res.reason || 'PowerPoint export failed.');
    } catch (e: any) {
      setError(`PowerPoint export failed — ${String(e?.message || e).slice(0, 200)}`);
    } finally { setBusy(false); }
  };

  const page = pages[sel] as PitchPage | undefined;

  // ── user-added (extra) layers ──
  const setExtras = (next: PitchExtraLayer[]) => patchPage(sel, { extras: next });
  const addExtra = (kind: 'text' | 'image' | 'box' | 'line') => {
    const id = `x${Date.now().toString(36)}${Math.round(sel * 97 + (page?.extras?.length ?? 0) * 13).toString(36)}`;
    const n = (page?.extras?.length ?? 0) + 1;
    const layer: PitchExtraLayer =
      kind === 'image' ? { id, kind: 'image', name: `Image ${n}`, box: { ...DEFAULT_EXTRA_BOX } }
      : kind === 'box' ? { id, kind: 'text', name: `Box ${n}`, box: { x: 0.35, y: 0.40, w: 0.30, h: 0.20 }, text: 'نص جديد', style: { bg: '#171310', color: '#FBE6CE', align: 'center' } }
      : kind === 'line' ? { id, kind: 'text', name: `Line ${n}`, box: { x: 0.35, y: 0.50, w: 0.30, h: 0.008 }, text: '', style: { bg: '#E0531F' } }
      : { id, kind: 'text', name: `Text ${n}`, box: { ...DEFAULT_EXTRA_BOX }, text: 'نص جديد' };
    setExtras([...(page?.extras ?? []), layer]);
    setSelKeys([id]);
  };
  const patchExtra = (id: string, patch: Partial<PitchExtraLayer>) =>
    setExtras((page?.extras ?? []).map(x => (x.id === id ? { ...x, ...patch } : x)));
  const patchExtraStyle = (id: string, sp: Partial<PitchElemStyle>) =>
    setExtras((page?.extras ?? []).map(x => (x.id === id ? { ...x, style: { ...(x.style ?? {}), ...sp } } : x)));
  const patchExtraImage = (id: string, ip: Partial<PitchImageStyle>) =>
    setExtras((page?.extras ?? []).map(x => (x.id === id ? { ...x, image: { ...(x.image ?? {}), ...ip } } : x)));
  const removeExtra = (id: string) => { setExtras((page?.extras ?? []).filter(x => x.id !== id)); setSelKeys(['title']); };
  const findExtra = (id: string) => (page?.extras ?? []).find(x => x.id === id);

  // inline (double-click on canvas) text commit — same state the side inputs use
  const setLayerText = (key: string, v: string) => {
    if (key === 'kicker') patchPage(sel, { section: v });
    else if (key === 'title') patchPage(sel, { titleText: v });
    else if (key === 'body') patchPage(sel, { text: v });
    else patchExtra(key, { text: v });
  };
  // ⌘C / ⌘V — copy the selected layers and paste them on ANY page. Built-in
  // text elements copy as portable extra text layers (same look, same box).
  const clipRef = useRef<PitchExtraLayer[]>([]);
  const copySelection = () => {
    if (!page) return;
    const out: PitchExtraLayer[] = [];
    for (const k of selKeys) {
      if (k === 'image') continue;
      if (isBuiltinText(k)) {
        const st = page.layout?.[k] ?? {};
        const text = k === 'kicker' ? (page.section || '') : k === 'title' ? (page.titleText || '') : (page.text || '');
        const box = st.box ?? resolveBox(page, theme, k, isClosePage(page));
        const { box: _b, ...style } = st;
        out.push({ id: k, kind: 'text', box: { ...box }, text, style: { ...style } });
      } else {
        const x = findExtra(k);
        if (x) out.push(JSON.parse(JSON.stringify(x)));
      }
    }
    if (out.length) { clipRef.current = out; showToast(`Copied ${out.length} layer${out.length > 1 ? 's' : ''} — ⌘V on any page.`); }
  };
  const pasteClipboard = () => {
    if (!page || !clipRef.current.length) return;
    const ids: string[] = [];
    const clones = clipRef.current.map((src, k) => {
      const nid = `x${Date.now().toString(36)}${((Math.random() * 1e6) | 0).toString(36)}${k}`;
      ids.push(nid);
      const b = src.box;
      return { ...(JSON.parse(JSON.stringify(src)) as PitchExtraLayer), id: nid, box: { ...b, x: Math.min(1 - b.w, b.x + 0.02), y: Math.min(1 - b.h, b.y + 0.02) } };
    });
    setExtras([...(page.extras ?? []), ...clones]);
    setSelKeys(ids);
    showToast(`Pasted ${clones.length} layer${clones.length > 1 ? 's' : ''}.`);
  };

  // Cmd+D — clone the selected added layer, nudged down-right, and select it.
  const duplicateExtra = (id: string) => {
    const src = findExtra(id); if (!src) return;
    const nid = `x${Date.now().toString(36)}${Math.round(Math.random() * 1e4).toString(36)}`;
    const b = src.box;
    const box = { ...b, x: Math.min(1 - b.w, b.x + 0.02), y: Math.min(1 - b.h, b.y + 0.02) };
    const clone: PitchExtraLayer = { ...src, id: nid, box, name: src.name ? `${src.name} copy` : undefined };
    setExtras([...(page?.extras ?? []), clone]);
    setSelKeys([nid]);
  };

  // ── paragraph styles (Keynote-like) — link via styleRef; Update propagates ──
  // Propagation is by COPY into each linked layer, so render/export paths need
  // no knowledge of styles. `box` never travels with a style.
  const paraStyles = pitch?.paraStyles ?? [];
  const PARA_KEYS: (keyof PitchElemStyle)[] = ['color', 'strokeColor', 'strokeWidth', 'strokePos', 'align', 'dir', 'fontScale', 'lineScale', 'fontKey', 'weight', 'italic', 'underline', 'bg'];
  const paraProps = (s?: PitchElemStyle): PitchElemStyle =>
    Object.fromEntries(PARA_KEYS.filter(k => (s as any)?.[k] !== undefined).map(k => [k, (s as any)[k]]));
  // full patch — absent keys go undefined so adopting a style CLEARS stale local props
  const paraPatch = (props: PitchElemStyle): Partial<PitchElemStyle> =>
    Object.fromEntries(PARA_KEYS.map(k => [k, (props as any)[k]]));
  const selStyle = (): PitchElemStyle | undefined =>
    isBuiltinText(selLayer) ? page?.layout?.[selLayer] : findExtra(selLayer)?.style;
  const patchSelStyle = (patch: Partial<PitchElemStyle>) => {
    if (isBuiltinText(selLayer)) patchElem(sel, selLayer, patch);
    else patchExtraStyle(selLayer, patch);
  };
  const applyPara = (id: string | null) => {
    if (!id) { patchSelStyle({ styleRef: undefined }); return; }
    const def = paraStyles.find(p => p.id === id); if (!def) return;
    patchSelStyle({ ...paraPatch(def.style), styleRef: id });
  };
  const createPara = () => {
    // ONE setPitch — two consecutive calls read a stale data.pitch and the
    // second silently clobbers the first patch (paraStyles vanished).
    const id = `ps${Date.now().toString(36)}`;
    const def: PitchParaStyle = { id, name: `Style ${paraStyles.length + 1}`, style: paraProps(selStyle()) };
    const nextPages = pages.map((pg, j) => {
      if (j !== sel) return pg;
      if (isBuiltinText(selLayer)) return { ...pg, layout: { ...(pg.layout ?? {}), [selLayer]: { ...(pg.layout?.[selLayer] ?? {}), styleRef: id } } };
      return { ...pg, extras: pg.extras?.map(x => (x.id === selLayer ? { ...x, style: { ...(x.style ?? {}), styleRef: id } } : x)) };
    });
    setPitch({ paraStyles: [...paraStyles, def], pages: nextPages });
  };
  const updatePara = () => {
    const id = selStyle()?.styleRef; if (!id) return;
    const props = paraProps(selStyle());
    const defs = paraStyles.map(p => (p.id === id ? { ...p, style: props } : p));
    const patch = paraPatch(props);
    const nextPages = pages.map(pg => {
      let L: PitchLayout | undefined = pg.layout;
      for (const k of BUILTIN_TEXT) {
        if (pg.layout?.[k]?.styleRef === id) L = { ...(L ?? {}), [k]: { ...pg.layout![k], ...patch, styleRef: id } };
      }
      const extras = pg.extras?.map(x =>
        x.kind === 'text' && x.style?.styleRef === id ? { ...x, style: { ...x.style, ...patch, styleRef: id } } : x);
      return { ...pg, layout: L, extras };
    });
    setPitch({ paraStyles: defs, pages: nextPages });
    showToast('Style updated across the deck.');
  };
  const renamePara = (name: string) => {
    const id = selStyle()?.styleRef; if (!id) return;
    setPitch({ paraStyles: paraStyles.map(p => (p.id === id ? { ...p, name } : p)) });
  };
  const paraUi = {
    styles: paraStyles,
    current: selStyle()?.styleRef,
    onApply: applyPara, onCreate: createPara, onUpdate: updatePara, onRename: renamePara,
  };
  // reorder an extra layer's paint order (+1 = forward/on top, -1 = back)
  const moveExtra = (id: string, dir: 1 | -1) => {
    const arr = [...(page?.extras ?? [])];
    const i = arr.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setExtras(arr);
  };
  const applyLayout = (lay: { id: string; apply: (p: PitchPage) => Partial<PitchPage> }) => {
    if (!page) return;
    patchPage(sel, { ...lay.apply(page), layoutPreset: lay.id });
  };
  // drag-reorder any layer (built-in or extra) — drop dragKey just above target
  const reorderLayer = (dragKey: string, targetKey: string) => {
    if (!page || dragKey === targetKey) return;
    const arr = orderedKeys(page);           // bottom → top
    const from = arr.indexOf(dragKey);
    if (from < 0) return;
    arr.splice(from, 1);
    const to = arr.indexOf(targetKey);
    arr.splice(to + 1, 0, dragKey);          // above target = higher z
    patchPage(sel, { order: arr });
  };

  // resolve the box of any layer key (built-in text or extra)
  const layerBoxOf = (key: string): PitchBox | null => {
    if (!page) return null;
    if (isBuiltinText(key)) return resolveBox(page, theme, key, isClosePage(page));
    return findExtra(key)?.box ?? null;
  };
  const setLayerBox = (key: string, box: PitchBox) => {
    if (isBuiltinText(key)) patchElem(sel, key, { box });
    else patchExtra(key, { box });
  };
  // Apply many layer boxes (+ optional bg-image pan) in ONE update — used for
  // group move so multi-selected layers don't clobber each other's state.
  const applyLayers = (boxes: Record<string, PitchBox>, image?: { x: number; y: number }) => {
    if (!page) return;
    let layout = { ...(page.layout ?? {}) };
    let extras = [...(page.extras ?? [])];
    for (const [key, box] of Object.entries(boxes)) {
      if (isBuiltinText(key)) layout = { ...layout, [key]: { ...(layout[key] ?? {}), box } };
      else extras = extras.map(x => (x.id === key ? { ...x, box } : x));
    }
    if (image) layout = { ...layout, image: { ...(layout.image ?? {}), ...image } };
    patchPage(sel, { layout, extras });
  };

  // nudge every selected layer with the keyboard arrows
  const nudgeSelected = (dx: number, dy: number) => {
    if (!page) return;
    const boxes: Record<string, PitchBox> = {};
    let image: { x: number; y: number } | undefined;
    for (const key of selKeys) {
      if (key === 'image') {
        if (page.layout?.image?.locked) continue;   // locked — no nudge
        const im = page.layout?.image ?? {};
        image = { x: Math.min(0.5, Math.max(-0.5, (im.x ?? 0) + dx)), y: Math.min(0.5, Math.max(-0.5, (im.y ?? 0) + dy)) };
      } else {
        const locked = isBuiltinText(key) ? !!page.layout?.[key]?.locked : !!findExtra(key)?.locked;
        if (locked) continue;                        // locked — no nudge
        const b = layerBoxOf(key);
        // may travel outside the frame (recoverable — the stage shows past the page edge)
        if (b) boxes[key] = { ...b, x: Math.min(1.9 - b.w, Math.max(-0.9, b.x + dx)), y: Math.min(1.9 - b.h, Math.max(-0.9, b.y + dy)) };
      }
    }
    applyLayers(boxes, image);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = document.activeElement?.tagName;
      const typing = t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
      const mod = e.metaKey || e.ctrlKey;
      // ? or ⌘/ — the shortcuts guide (toggle)
      if (!typing && (e.key === '?' || (mod && e.key === '/'))) { e.preventDefault(); setShowShortcuts(v => !v); return; }
      if (showShortcuts && e.key === 'Escape') { e.preventDefault(); setShowShortcuts(false); return; }
      // ⌘E — export the PDF
      if (mod && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); void exportPdf(); return; }
      // ⌘C / ⌘V — copy the selected layers · paste onto the CURRENT page (works across pages)
      if (mod && (e.key === 'c' || e.key === 'C')) {
        if (typing || !selKeys.length || window.getSelection()?.toString()) return;   // native copy for real text selections
        e.preventDefault(); copySelection(); return;
      }
      if (mod && (e.key === 'v' || e.key === 'V')) {
        if (typing) return;
        if (clipRef.current.length) { e.preventDefault(); pasteClipboard(); }
        return;
      }
      // ⌘D — duplicate the selected added layer
      if (mod && (e.key === 'd' || e.key === 'D')) {
        if (typing) return;
        e.preventDefault();
        if (selLayer && !isBuiltinText(selLayer) && selLayer !== 'image') duplicateExtra(selLayer);
        return;
      }
      // T / I / L / B — drop a new layer (no modifier, not typing)
      if (!typing && !mod && !e.altKey && page) {
        const k = e.key.toLowerCase();
        const map: Record<string, 'text' | 'image' | 'line' | 'box'> = { t: 'text', i: 'image', l: 'line', b: 'box' };
        if (map[k]) { e.preventDefault(); addExtra(map[k]); return; }
      }
      // Delete / Backspace — remove the selected added layer
      if (!typing && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (selLayer && !isBuiltinText(selLayer) && selLayer !== 'image') { e.preventDefault(); removeExtra(selLayer); return; }
      }
      // Escape — deselect layers so the arrow keys flip pages
      if (!typing && e.key === 'Escape' && selKeys.length) { e.preventDefault(); setSelKeys([]); setNavMode('page'); return; }
      // Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z = redo (native undo inside fields)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      // Cmd/Ctrl+A while a box is selected → select that layer's text only
      // (not the whole document). Native select-all still works inside inputs.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        if (typing || !selLayer) return;
        e.preventDefault();
        const key = (window.CSS && CSS.escape) ? CSS.escape(selLayer) : selLayer;
        const el = document.querySelector(`[data-pitch-layer="${key}"]`);
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) { el.focus(); el.select(); }
        return;
      }
      if (!e.key.startsWith('Arrow')) return;
      if (typing) return; // don't hijack typing
      // Page mode (a row selected) OR no layer selected: arrows flip pages.
      // ←/↑ = previous · →/↓ = next.
      if (navMode === 'page' || selKeys.length === 0) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') setSel(s => Math.min(pages.length - 1, s + 1));
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') setSel(s => Math.max(0, s - 1));
        else return;
        e.preventDefault();
        return;
      }
      // Layer mode: nudge the selected box.
      const step = e.shiftKey ? 0.02 : 0.004;
      if (e.key === 'ArrowLeft') nudgeSelected(-step, 0);
      else if (e.key === 'ArrowRight') nudgeSelected(step, 0);
      else if (e.key === 'ArrowUp') nudgeSelected(0, -step);
      else if (e.key === 'ArrowDown') nudgeSelected(0, step);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // Keep DOM focus on the selected page row while navigating pages, so Enter
  // acts on the page you arrowed to (not the one you originally clicked).
  useEffect(() => {
    if (navMode !== 'page') return;
    const el = document.querySelector(`[data-page-row="${sel}"]`);
    if (el instanceof HTMLElement) el.focus();
  }, [sel, navMode]);

  return (
    <div className="pp-grid">
      {rails.leftC ? (
        <button className="ppp-railtab ppp-railtab--l" title="Show the left panel" onClick={() => setLeftC(false)}>›</button>
      ) : (
        <>
          <aside className="pp-aside ppp-rail ppp-rail--l" style={{ width: rails.leftW }}>
            <div className="ppp-railhead">
              <div className="ppp-ltabs">
                <button className={`ppp-ltab ${leftTab === 'project' ? 'is-on' : ''}`} onClick={() => setLeftTab('project')}>Project</button>
                <button className={`ppp-ltab ${leftTab === 'pages' ? 'is-on' : ''}`} onClick={() => setLeftTab('pages')}>Pages</button>
                <button className={`ppp-ltab ${leftTab === 'export' ? 'is-on' : ''}`} onClick={() => setLeftTab('export')}>Export</button>
              </div>
              <button className="ppp-railcollapse" title="Collapse the left panel" onClick={() => setLeftC(true)}>‹</button>
            </div>
            <div className="ppp-railbody">
              {error && <div className="pp-error">{error}</div>}

              {leftTab === 'project' && (
                <>
                  <Field label="Page system" hint="pick one — pages are self-contained">
                    <div className="ppp-swatches">
                      <button className={`ppp-swatch ${theme === 'layl' ? 'is-on' : ''}`} title="Layl · dark full-bleed cinematic" onClick={() => setPitch({ theme: 'layl' })}>
                        <span className="ppp-swatch__chip ppp-swatch__chip--layl" />
                        Layl · dark full-bleed
                      </button>
                      <button className={`ppp-swatch ${theme === 'sahifa' ? 'is-on' : ''}`} title="Sahifa · white editorial serif" onClick={() => setPitch({ theme: 'sahifa' })}>
                        <span className="ppp-swatch__chip ppp-swatch__chip--sahifa" />
                        Sahifa · white editorial
                      </button>
                    </div>
                  </Field>

                  <Field label="Length preset" hint="reader busyness → pages">
                    <div className="pp-chiprow">
                      {([8, 25, 50] as const).map(n => (
                        <button key={n} className={`pp-chip ${preset === n ? 'is-on' : ''}`} onClick={() => setPitch({ preset: n })}>{n}</button>
                      ))}
                      <button
                        className={`pp-chip ${pitch.clientDirect ? 'is-on' : ''}`}
                        title="Adds product / talent / equipment / budget pages"
                        onClick={toggleClientDirect}
                      >
                        Client-direct mode
                      </button>
                    </div>
                  </Field>

                  <Field label="Slide size" hint="aspect ratio — content reflows">
                    <select className="pp-input" value={String(aspect)} onChange={e => setPitch({ aspect: Number(e.target.value) })}>
                      {SLIDE_SIZES.map(s => <option key={s.label} value={String(s.aspect)}>{s.label}</option>)}
                    </select>
                  </Field>

                  <Field label="Theme" hint="picks the layout family — click to preview & apply · ★ = the favorite (one only)">
                    <div className="ppp-themegrid">
                      {PITCH_THEMES.map(t => {
                        const on = themeId === t.id;
                        const fav = favTheme === t.id;
                        return (
                          <button key={t.id} type="button" className={`ppp-themecard ${on ? 'is-on' : ''}`}
                            title={t.name} onClick={() => setPitch({ theme: 'layl', themeId: t.id })}>
                            <span
                              role="button"
                              className={`ppp-themecard__fav ${fav ? 'is-fav' : ''}`}
                              title={fav ? 'The favorite theme (there is always one)' : 'Move the favorite star here'}
                              onClick={e => { e.stopPropagation(); if (!fav) setFavTheme(t.id); }}
                            >{fav ? '★' : '☆'}</span>
                            {t.thumb
                              ? <img className="ppp-themecard__img" src={t.thumb} alt="" draggable={false} />
                              : (t.layouts[0] && <LayoutThumb lay={t.layouts[0] as any} width={96} />)}
                            <span className="ppp-themecard__name">{t.name}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="ppp-themebase">
                      <button type="button" className={`pp-chip ${!themeId && theme === 'layl' ? 'is-on' : ''}`}
                        onClick={() => setPitch({ theme: 'layl', themeId: undefined })}>Layl · dark</button>
                      <button type="button" className={`pp-chip ${!themeId && theme === 'sahifa' ? 'is-on' : ''}`}
                        onClick={() => setPitch({ theme: 'sahifa', themeId: undefined })}>Sahifa · editorial</button>
                    </div>
                  </Field>

                  <Field label="Running slug" hint="header/footer — every page, above every layer; drag it on the canvas">
                    <input
                      className="pp-input"
                      value={slug}
                      onChange={e => setPitch({ slug: e.target.value })}
                      placeholder="CLIENT / CAMPAIGN / HJEN"
                      spellCheck={false}
                    />
                    <div className="ppp-tools__row ppp-cdots" style={{ marginTop: 6, alignItems: 'center', gap: 8 }}>
                      <ColorDot label="Colour" value={pitch?.slugStyle?.color} fallback="#F5F5F5"
                        onChange={c => setPitch({ slugStyle: { ...(pitch?.slugStyle ?? {}), color: c } })}
                        onClear={() => setPitch({ slugStyle: { ...(pitch?.slugStyle ?? {}), color: undefined } })}
                        palette={paletteApi} />
                      <span className="ppp-tools__lbl mono-label" style={{ marginLeft: 4 }}>Size</span>
                      <button className="ppp-tool" style={{ flex: '0 0 auto' }} onClick={() => setPitch({ slugStyle: { ...(pitch?.slugStyle ?? {}), fontScale: Math.max(0.6, (pitch?.slugStyle?.fontScale ?? 1) - 0.1) } })}>−</button>
                      <button className="ppp-tool" style={{ flex: '0 0 auto' }} onClick={() => setPitch({ slugStyle: { ...(pitch?.slugStyle ?? {}), fontScale: Math.min(3, (pitch?.slugStyle?.fontScale ?? 1) + 0.1) } })}>＋</button>
                    </div>
                  </Field>
                </>
              )}

              {leftTab === 'pages' && (
                <div className="pp-panel ppp-pagespanel">
                  <div className="pp-panel__head">
                    <span className="pp-panel__title">Pages</span>
                    <span className="pp-panel__spacer" />
                    {pages.length > 0 && (
                      <button
                        className="ppp-fitbtn"
                        title="Creative 360 fits the best reference to each empty slide"
                        disabled={fitting}
                        onClick={() => void autoFitImages()}
                      >{fitting ? 'Fitting…' : '✦ Auto-fit'}</button>
                    )}
                    <button className="ppp-row__tool" title="Add a page" onClick={addPage}>＋</button>
                  </div>
                  <button className="pp-btn pp-btn--ghost ppp-pullbtn" onClick={() => void pullPlan()} disabled={!loaded || busy}
                    title="Compile the client argument from the signed Creative Graph">
                    Compile from Creative Graph
                  </button>
                  {pages.length === 0 ? (
                    <div className="pp-gate__empty mono-label">No pages yet — compile the Creative Graph.</div>
                  ) : (
                    <div className="ppp-rows">
                      {pages.map((p, i) => {
                        const resolved = !!p.imagePath || isClosePage(p);
                        return (
                          <div
                            key={i}
                            className={`ppp-row ppp-row--thumb ${i === sel ? 'is-sel' : ''} ${dragIdx === i ? 'is-drag' : ''} ${overIdx === i && dragIdx !== null && dragIdx !== i ? 'is-dragover' : ''}`}
                            role="button"
                            tabIndex={0}
                            data-page-row={i}
                            draggable
                            onDragStart={e => { setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* noop */ } }}
                            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overIdx !== i) setOverIdx(i); }}
                            onDrop={e => { e.preventDefault(); if (dragIdx !== null) reorderPage(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
                            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                            onClick={() => { setSel(i); setNavMode('page'); }}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); selectLayer('title'); } }}
                          >
                            <span className="ppp-row__grip" title="Drag to reorder" aria-hidden>⠿</span>
                            <div className="ppp-row__thumb"><PageThumb page={p} theme={theme} projectName={project?.name} aspect={aspect} index={i} slug={slug} slugStyle={pitch?.slugStyle} /></div>
                            <div className="ppp-row__meta">
                              <div className="ppp-row__metatop">
                                <span className="ppp-row__n">{String(i + 1).padStart(2, '0')}</span>
                                <span className={`ppp-row__dot ${resolved ? 'is-resolved' : 'is-open'}`} />
                              </div>
                              <span className="ppp-row__name">{p.section || '—'}</span>
                            </div>
                            <span className="ppp-row__tools">
                              <button className="ppp-row__tool" title="Move up" disabled={i === 0} onClick={e => { e.stopPropagation(); movePage(i, -1); }}>↑</button>
                              <button className="ppp-row__tool" title="Move down" disabled={i === pages.length - 1} onClick={e => { e.stopPropagation(); movePage(i, 1); }}>↓</button>
                              <button className="ppp-row__tool" title="Remove page" onClick={e => { e.stopPropagation(); removePage(i); }}>×</button>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {leftTab === 'export' && (
                <div className="pp-panel ppp-export">
                  <div className="pp-panel__head">
                    <span className="pp-panel__title">Export</span>
                  </div>
                  <button
                    className="pp-btn pp-btn--accent"
                    onClick={exportPdf}
                    disabled={!canExport}
                    title={blockReason}
                  >
                    {busy ? 'Exporting…' : 'Export PDF'}
                  </button>
                  <button
                    className="pp-btn pp-btn--ghost"
                    style={{ width: '100%', marginTop: 8 }}
                    onClick={exportHtml}
                    disabled={!canExportDraft}
                    title={draftBlockReason || 'Interactive deck — flip with ← →, animated GIFs play, opens in any browser'}
                  >
                    Export Interactive (HTML)
                  </button>
                  <button
                    className="pp-btn pp-btn--ghost"
                    style={{ width: '100%', marginTop: 8 }}
                    onClick={exportPptx}
                    disabled={!canExportDraft}
                    title={draftBlockReason || 'Editable PowerPoint — also opens in Keynote'}
                  >
                    Export PowerPoint (.pptx)
                  </button>
                  <div className="ppp-law">Interactive HTML flips ← → and plays animated GIFs. PDF is flat (⌘P from the HTML for a static PDF).</div>
                  {pitch.lastExportPath && <div className="ppp-lastpath">{pitch.lastExportPath}</div>}
                  {busy && <div style={{ marginTop: 10 }}><Busy label="Making the document…" /></div>}
                </div>
              )}
            </div>
          </aside>
          <div className="ppp-railresize" title="Drag to resize" onPointerDown={startRail('l')} onPointerMove={moveRail} onPointerUp={endRail} />
        </>
      )}

      <main className="pp-main ppp-main">
        {!loaded ? (
          <Busy label="Loading the treatment…" />
        ) : !page ? (
          <div className="pp-gate__empty mono-label">Pull the page-plan to start the document.</div>
        ) : (
          <>
            <PageStage
              page={page}
              theme={theme}
              slug={slug}
              projectName={project?.name}
              index={sel}
              total={pages.length}
              aspect={aspect}
              rails={rails}
              selKeys={selKeys}
              extras={page.extras ?? []}
              onResolve={() => void resolveImage(sel)}
              onLayerBox={setLayerBox}
              onApplyLayers={applyLayers}
              onPanImage={(x, y) => patchImage(sel, { x, y })}
              onSelectLayer={selectLayer}
              onText={setLayerText}
              slugStyle={pitch?.slugStyle}
              onSlugBox={box => setPitch({ slugStyle: { ...(pitch?.slugStyle ?? {}), box } })}
              onShortcuts={() => setShowShortcuts(true)}
              onTour={() => setShowTour(true)}
              zoomTool={zoomTool}
              onZoomTool={setZoomTool}
            />
            <FloatingToolbar onAdd={addExtra} tool={zoomTool ? 'zoom' : 'select'} onTool={t => setZoomTool(t === 'zoom')} />
            <div className="ppp-pager">
              <button className="ppp-pager__btn" title="Undo (⌘Z)" disabled={undoN === 0} onClick={undo}>↶</button>
              <button className="ppp-pager__btn" title="Redo (⇧⌘Z)" disabled={redoN === 0} onClick={redo}>↷</button>
              <span className="ppp-pager__sp" />
              <button className="ppp-pager__btn" disabled={sel === 0} onClick={() => setSel(sel - 1)}>‹</button>
              <span className="ppp-pager__count">{sel + 1} / {pages.length}</span>
              <button className="ppp-pager__btn" disabled={sel >= pages.length - 1} onClick={() => setSel(sel + 1)}>›</button>
            </div>
          </>
        )}
        {toast && <div className="pp-toast">{toast}</div>}
      </main>

      {page && (rails.rightC ? (
        <button className="ppp-railtab ppp-railtab--r" title="Show the layers panel" onClick={() => setRightC(false)}>‹</button>
      ) : (
        <>
          <div className="ppp-railresize" title="Drag to resize" onPointerDown={startRail('r')} onPointerMove={moveRail} onPointerUp={endRail} />
          <LayersPanel
            page={page}
            selLayer={selLayer}
            selKeys={selKeys}
            railWidth={rails.rightW}
            onCollapse={() => setRightC(true)}
            onSelectLayer={selectLayer}
            onResolve={() => resolveImage(sel)}
            onClearImage={() => patchPage(sel, { imagePath: undefined, imageSource: undefined, imageWhy: undefined, layout: page.layout ? { ...page.layout, image: undefined } : undefined })}
            onElem={(elem, patch) => patchElem(sel, elem, patch)}
            onImage={patch => patchImage(sel, patch)}
            onReset={() => resetLayout(sel)}
            onAddLayer={addExtra}
            onExtra={patchExtra}
            onExtraStyle={patchExtraStyle}
            onExtraImage={patchExtraImage}
            onRemoveExtra={removeExtra}
            onResolveExtra={id => setExtraPicker(id)}
            onMoveExtra={moveExtra}
            onReorder={reorderLayer}
            themeLayouts={activeTheme?.layouts ?? []}
            themeName={activeTheme?.name}
            onApplyLayout={applyLayout}
            para={paraUi}
            palette={paletteApi}
            onPageBg={c => patchPage(sel, { bgColor: c })}
            onSection={v => patchPage(sel, { section: v })}
            onTitle={v => patchPage(sel, { titleText: v })}
            onBody={v => patchPage(sel, { text: v })}
          />
        </>
      ))}

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
      {showTour && <SpotlightTour onDone={() => setShowTour(false)} />}

      {(picker != null || extraPicker != null) && (
        <PitchImagePicker
          projectId={projectId}
          spec={picker != null ? pages[picker]?.imageSpec : undefined}
          section={picker != null ? pages[picker]?.section : 'Image layer'}
          onPick={onPick}
          onFile={() => void pickFromFile()}
          onClose={() => { setPicker(null); setExtraPicker(null); }}
        />
      )}
    </div>
  );
}

// ─── layers panel — Photoshop-style component list + per-element tools ───────

const FONT_MIN = 0.6, FONT_MAX = 4;
const LH_MIN = 0.3, LH_MAX = 3;
const IMG_MIN = 1, IMG_MAX = 3, IMG_STEP = 0.15;
const WEIGHTS: Array<{ v: number; label: string }> = [
  { v: 300, label: 'Light · 300' },
  { v: 400, label: 'Regular · 400' },
  { v: 500, label: 'Medium · 500' },
  { v: 600, label: 'Semibold · 600' },
  { v: 700, label: 'Bold · 700' },
  { v: 800, label: 'Extrabold · 800' },
  { v: 900, label: 'Black · 900' },
];
const clampRound = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;

// paragraph-style linkage the tools panel exposes for the selected layer
export interface ParaUi {
  styles: PitchParaStyle[];
  current?: string;
  onApply: (id: string | null) => void;
  onCreate: () => void;
  onUpdate: () => void;
  onRename: (name: string) => void;
}

// the base point-size + line-height each text role renders at (the live DOM &
// PDF numbers), so the panel can show real px. px = pt × 96/72 × scale × sell-ratio.
type SizeRole = 'title' | 'body' | 'kicker' | 'extra';
const BASE_PT: Record<SizeRole, number> = { title: 34, body: 13, kicker: 8, extra: 11 };
const BASE_LH: Record<SizeRole, number> = { title: 0.98, body: 1.7, kicker: 1.2, extra: 1.5 };
const PX_MULT = (96 / 72) * (1920 / (297 * (96 / 25.4)));   // pt → on-screen px at the "1920×1080" sell size

// tools for one text element (title or body) — font family, size, dir, align
function TextTools({ style, onPatch, hasBox, para, role, palette }: {
  style: PitchElemStyle;
  onPatch: (patch: Partial<PitchElemStyle>) => void;
  hasBox: boolean;
  para?: ParaUi;
  role: SizeRole;
  palette: PaletteApi;
}) {
  const fscale = style.fontScale ?? 1;
  const lscale = style.lineScale ?? 1;
  const fontKey = style.fontKey ?? '';
  const curPara = para?.styles.find(p => p.id === para.current);
  // font size + line spacing expressed in whole pixels (data stays in scales)
  const basePt = BASE_PT[role], baseLh = BASE_LH[role];
  const fontPx = basePt * PX_MULT * fscale;
  const linePx = fontPx * baseLh * lscale;
  const setFontPx = (px: number) => onPatch({ fontScale: clampRound(px / (basePt * PX_MULT), FONT_MIN, FONT_MAX) });
  const setLinePx = (px: number) => onPatch({ lineScale: clampRound(px / (fontPx * baseLh), LH_MIN, LH_MAX) });
  const fontPxMin = Math.round(basePt * PX_MULT * FONT_MIN), fontPxMax = Math.round(basePt * PX_MULT * FONT_MAX);
  return (
    <div className="ppp-tools">
      {para && (
        <div className="ppp-tools__grp">
          <span className="ppp-tools__lbl mono-label">Paragraph style</span>
          <div className="ppp-tools__row">
            <select className="ppp-select" style={{ flex: 1 }} value={para.current ?? ''} onChange={e => para.onApply(e.target.value || null)}>
              <option value="">None</option>
              {para.styles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="ppp-tool" style={{ flex: '0 0 auto' }} title="New style from this layer" onClick={para.onCreate}>＋</button>
          </div>
          {curPara && (
            <div className="ppp-tools__grp ppp-renamegrp">
              <span className="ppp-tools__lbl mono-label">✎ Style name — rename here</span>
              <div className="ppp-tools__row">
                <input className="ppp-select ppp-rename" value={curPara.name} onChange={e => para.onRename(e.target.value)} spellCheck={false} placeholder="Style name" />
                <button className="ppp-tool is-on" style={{ flex: '0 0 auto' }} title="Push THIS layer's look into the style — every linked layer updates" onClick={para.onUpdate}>Update</button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="ppp-tools__grp">
        <span className="ppp-tools__lbl mono-label">Font</span>
        <select className="ppp-select" value={fontKey} onChange={e => onPatch({ fontKey: e.target.value || undefined })}>
          <option value="">Theme default</option>
          {PITCH_FONTS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          {USER_FONTS.length > 0 && <option disabled>──────────</option>}
          {USER_FONTS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </div>
      <div className="ppp-tools__grp">
        <span className="ppp-tools__lbl mono-label">Colour</span>
        <div className="ppp-tools__row ppp-cdots">
          <ColorDot label="Fill" value={style.color} fallback="#F5F5F5" onChange={c => onPatch({ color: c })} onClear={() => onPatch({ color: undefined })} palette={palette} />
          <ColorDot label="Outline" value={style.strokeColor} fallback="#000000" onChange={c => onPatch({ strokeColor: c })} onClear={() => onPatch({ strokeColor: undefined })} palette={palette} />
          <ColorDot label="Box" title="Solid fill behind the box (bars / cards / lines)" value={style.bg} fallback="#171310" onChange={c => onPatch({ bg: c })} onClear={() => onPatch({ bg: undefined })} palette={palette} />
        </div>
      </div>
      <div className="ppp-tools__grp">
        <span className="ppp-tools__lbl mono-label">Weight & style</span>
        <select className="ppp-select" value={style.weight ?? ''} onChange={e => onPatch({ weight: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">Theme default</option>
          {WEIGHTS.map(w => <option key={w.v} value={w.v}>{w.label}</option>)}
        </select>
        <div className="ppp-tools__row">
          <button className={`ppp-tool ppp-tool--bius ${style.weight === 700 ? 'is-on' : ''}`} title="Bold" style={{ fontWeight: 800 }} onClick={() => onPatch({ weight: style.weight === 700 ? undefined : 700 })}>B</button>
          <button className={`ppp-tool ppp-tool--bius ${style.italic ? 'is-on' : ''}`} title="Italic" style={{ fontStyle: 'italic' }} onClick={() => onPatch({ italic: !style.italic })}>I</button>
          <button className={`ppp-tool ppp-tool--bius ${style.underline ? 'is-on' : ''}`} title="Underline" style={{ textDecoration: 'underline' }} onClick={() => onPatch({ underline: !style.underline })}>U</button>
        </div>
      </div>
      <div className="ppp-tools__grp">
        <span className="ppp-tools__lbl mono-label">Rotate · Flip</span>
        <div className="ppp-tools__row ppp-sizerow">
          <button className="ppp-tool ppp-tool--step" title="Rotate −15°" onClick={() => { const r = ((style.rotate ?? 0) - 15) % 360; onPatch({ rotate: r || undefined }); }}>⟲</button>
          <input className="ppp-num" type="number" min={-180} max={360} value={Math.round(style.rotate ?? 0)}
            onChange={e => { const v = Number(e.target.value); onPatch({ rotate: Number.isFinite(v) && v !== 0 ? v : undefined }); }} />
          <button className="ppp-tool ppp-tool--step" title="Rotate +15°" onClick={() => { const r = ((style.rotate ?? 0) + 15) % 360; onPatch({ rotate: r || undefined }); }}>⟳</button>
          <button className={`ppp-tool ${style.flipH ? 'is-on' : ''}`} title="Flip horizontal" onClick={() => onPatch({ flipH: style.flipH ? undefined : true })}>⇋</button>
          <button className={`ppp-tool ${style.flipV ? 'is-on' : ''}`} title="Flip vertical" onClick={() => onPatch({ flipV: style.flipV ? undefined : true })}>⇵</button>
        </div>
      </div>
      {style.strokeColor && (
        <div className="ppp-tools__grp">
          <span className="ppp-tools__lbl mono-label">Outline · {(style.strokeWidth ?? 0.6).toFixed(1)} px</span>
          <div className="ppp-tools__row ppp-sizerow">
            <button className="ppp-tool ppp-tool--step" title="Thinner" onClick={() => onPatch({ strokeWidth: Math.max(0.2, +(((style.strokeWidth ?? 0.6) - 0.2).toFixed(1))) })}>−</button>
            <input className="ppp-num" type="number" step={0.2} min={0.2} max={12} value={style.strokeWidth ?? 0.6}
              onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) onPatch({ strokeWidth: Math.min(12, v) }); }} />
            <button className="ppp-tool ppp-tool--step" title="Thicker" onClick={() => onPatch({ strokeWidth: Math.min(12, +(((style.strokeWidth ?? 0.6) + 0.2).toFixed(1))) })}>＋</button>
          </div>
          <div className="ppp-tools__row">
            <button className={`ppp-tool ${(style.strokePos ?? 'center') === 'center' ? 'is-on' : ''}`} title="Stroke sits half in, half out" onClick={() => onPatch({ strokePos: undefined })}>Centre</button>
            <button className={`ppp-tool ${style.strokePos === 'outside' ? 'is-on' : ''}`} title="Stroke fully outside the letterform" onClick={() => onPatch({ strokePos: 'outside' })}>Outside</button>
            <button className={`ppp-tool ${style.strokePos === 'inside' ? 'is-on' : ''}`} title="Web engines have no true inside stroke — rendered as centre" onClick={() => onPatch({ strokePos: 'inside' })}>Inside</button>
          </div>
        </div>
      )}
      <div className="ppp-tools__grp">
        <span className="ppp-tools__lbl mono-label">Font size · {Math.round(fontPx)} px</span>
        <div className="ppp-tools__row ppp-sizerow">
          <button className="ppp-tool ppp-tool--step" title="Smaller" disabled={fscale <= FONT_MIN} onClick={() => setFontPx(Math.round(fontPx) - 1)}>−</button>
          <input className="ppp-num" type="number" min={fontPxMin} max={fontPxMax} value={Math.round(fontPx)}
            onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) setFontPx(v); }} />
          <button className="ppp-tool ppp-tool--step" title="Larger" disabled={fscale >= FONT_MAX} onClick={() => setFontPx(Math.round(fontPx) + 1)}>＋</button>
          {fscale !== 1 && <button className="ppp-tool ppp-tool--wide" onClick={() => onPatch({ fontScale: undefined })}>Reset size</button>}
        </div>
      </div>
      <div className="ppp-tools__grp">
        <span className="ppp-tools__lbl mono-label">Line spacing · {Math.round(linePx)} px</span>
        <div className="ppp-tools__row ppp-sizerow">
          <button className="ppp-tool ppp-tool--step" title="Tighter" disabled={lscale <= LH_MIN} onClick={() => setLinePx(Math.round(linePx) - 1)}>−</button>
          <input className="ppp-num" type="number" value={Math.round(linePx)}
            onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) setLinePx(v); }} />
          <button className="ppp-tool ppp-tool--step" title="Looser" disabled={lscale >= LH_MAX} onClick={() => setLinePx(Math.round(linePx) + 1)}>＋</button>
          {lscale !== 1 && <button className="ppp-tool ppp-tool--wide" onClick={() => onPatch({ lineScale: undefined })}>Reset spacing</button>}
        </div>
      </div>
      <div className="ppp-tools__grp">
        <span className="ppp-tools__lbl mono-label">Direction</span>
        <div className="ppp-tools__row">
          <button className={`ppp-tool ${style.dir === 'rtl' ? 'is-on' : ''}`} title="Right-to-left" onClick={() => onPatch({ dir: 'rtl' })}>RTL</button>
          <button className={`ppp-tool ${style.dir === 'ltr' ? 'is-on' : ''}`} title="Left-to-right" onClick={() => onPatch({ dir: 'ltr' })}>LTR</button>
          <button className={`ppp-tool ${(!style.dir || style.dir === 'auto') ? 'is-on' : ''}`} title="Theme default" onClick={() => onPatch({ dir: 'auto' })}>Auto</button>
        </div>
      </div>
      <div className="ppp-tools__grp">
        <span className="ppp-tools__lbl mono-label">Align</span>
        <div className="ppp-tools__row">
          <button className={`ppp-tool ${style.align !== 'center' ? 'is-on' : ''}`} title="Edge (follows direction)" onClick={() => onPatch({ align: undefined })}>▤ Edge</button>
          <button className={`ppp-tool ${style.align === 'center' ? 'is-on' : ''}`} title="Center" onClick={() => onPatch({ align: 'center' })}>▥ Center</button>
        </div>
      </div>
      <div className="ppp-tools__hint mono-label">↔ Drag the box to move · drag its corner to resize.</div>
      {hasBox && <button className="ppp-tool ppp-tool--wide" onClick={() => onPatch({ box: undefined })}>Reset box</button>}
    </div>
  );
}

// one row in the layers list — draggable to reorder stacking (z-order)
function LayerRow({ icon, iconSm, name, selected, hidden, locked, empty, over, onSelect, onToggle, onLock, onRename, onDragStart, onDragOver, onDrop, onDragEnd }: {
  icon: string; iconSm?: boolean; name: string;
  selected: boolean; hidden: boolean; locked?: boolean; empty?: boolean; over?: boolean;
  onSelect: (additive: boolean) => void; onToggle: () => void; onLock?: () => void;
  onRename?: (name: string) => void;   // double-click the name to rename in place
  onDragStart?: () => void; onDragOver?: () => void; onDrop?: () => void; onDragEnd?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const commit = () => { setEditing(false); const v = draft.trim(); if (onRename && v && v !== name) onRename(v); };
  return (
    <div
      className={`ppp-lyr ${selected ? 'is-sel' : ''} ${hidden ? 'is-hidden' : ''} ${locked ? 'is-locked' : ''} ${empty ? 'is-empty' : ''} ${over ? 'is-dragover' : ''}`}
      role="button" tabIndex={0} draggable={!!onDragStart}
      onClick={e => onSelect(e.shiftKey)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(e.shiftKey); } }}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragOver={e => { e.preventDefault(); onDragOver?.(); }}
      onDrop={e => { e.preventDefault(); onDrop?.(); }}
      onDragEnd={() => onDragEnd?.()}
    >
      <span className="ppp-lyr__grip" title="Drag to reorder">⋮⋮</span>
      <button className="ppp-lyr__eye" title={hidden ? 'Show layer' : 'Hide layer'} onClick={e => { e.stopPropagation(); onToggle(); }}>
        {hidden ? '◌' : '◉'}
      </button>
      {onLock && (
        <button className={`ppp-lyr__eye ppp-lyr__lock ${locked ? 'is-on' : ''}`} title={locked ? 'Unlock — allow moving/selecting on the canvas' : 'Lock — can’t be moved or selected on the canvas'} onClick={e => { e.stopPropagation(); onLock(); }}>
          {locked ? '🔒' : '🔓'}
        </button>
      )}
      <span className={`ppp-lyr__ic ${iconSm ? 'ppp-lyr__ic--sm' : ''}`}>{icon}</span>
      {editing ? (
        <input
          className="ppp-lyr__rename"
          value={draft}
          autoFocus
          spellCheck={false}
          onChange={e => setDraft(e.target.value)}
          onClick={e => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span
          className="ppp-lyr__name"
          title={onRename ? 'Double-click to rename' : undefined}
          onDoubleClick={onRename ? (e => { e.stopPropagation(); setDraft(name); setEditing(true); }) : undefined}
        >{name}</span>
      )}
    </div>
  );
}

// image transform tools (shared by the background image and image extras)
function ImageTools({ im, onImage, onResolve, onDelete, hasImage }: {
  im: PitchImageStyle; onImage: (p: Partial<PitchImageStyle>) => void;
  onResolve: () => void; onDelete: () => void; hasImage: boolean;
}) {
  const opacity = im.opacity ?? 1, imgScale = im.scale ?? 1;
  return (
    <div className="ppp-tools">
      <button className="pp-btn pp-btn--ghost" style={{ width: '100%' }} onClick={onResolve}>{hasImage ? 'Replace image' : 'Resolve image'}</button>
      {hasImage && (
        <>
          <div className="ppp-tools__grp">
            <span className="ppp-tools__lbl mono-label">Fit</span>
            <div className="ppp-tools__row">
              <button className={`ppp-tool ${(im.fit ?? 'cover') === 'cover' ? 'is-on' : ''}`} title="Fill the box (crop)" onClick={() => onImage({ fit: undefined })}>Cover</button>
              <button className={`ppp-tool ${im.fit === 'contain' ? 'is-on' : ''}`} title="Whole image visible — PNG logos" onClick={() => onImage({ fit: 'contain' })}>Contain</button>
            </div>
          </div>
          <div className="ppp-tools__grp">
            <span className="ppp-tools__lbl mono-label">Opacity · {Math.round(opacity * 100)}%</span>
            <input className="ppp-range" type="range" min={0} max={1} step={0.02} value={opacity} onChange={e => onImage({ opacity: Number(e.target.value) })} />
          </div>
          <div className="ppp-tools__grp">
            <span className="ppp-tools__lbl mono-label">Zoom · {Math.round(imgScale * 100)}%</span>
            <div className="ppp-tools__row">
              <button className="ppp-tool" title="Zoom out" disabled={imgScale <= IMG_MIN} onClick={() => onImage({ scale: clampRound(imgScale - IMG_STEP, IMG_MIN, IMG_MAX) })}>−</button>
              <button className="ppp-tool" title="Zoom in" disabled={imgScale >= IMG_MAX} onClick={() => onImage({ scale: clampRound(imgScale + IMG_STEP, IMG_MIN, IMG_MAX) })}>＋</button>
              <input className="ppp-range" type="range" min={IMG_MIN} max={IMG_MAX} step={0.05} value={imgScale} onChange={e => onImage({ scale: Number(e.target.value) })} />
            </div>
          </div>
          <button className="pp-btn pp-btn--ghost ppp-delbtn" style={{ width: '100%', justifyContent: 'center' }} onClick={onDelete}>✕ Delete image</button>
        </>
      )}
    </div>
  );
}

function LayersPanel({ page, selLayer, selKeys, railWidth, onCollapse, onSelectLayer, onResolve, onClearImage, onElem, onImage, onReset, onAddLayer, onExtra, onExtraStyle, onExtraImage, onRemoveExtra, onResolveExtra, onMoveExtra, onReorder, themeLayouts, themeName, onApplyLayout, para, palette, onPageBg, onSection, onTitle, onBody }: {
  page: PitchPage;
  selLayer: string;
  selKeys: string[];
  railWidth: number;
  onCollapse: () => void;
  onSelectLayer: (l: string, additive?: boolean) => void;
  onResolve: () => void;
  onClearImage: () => void;
  onElem: (elem: TextLayer, patch: Partial<PitchElemStyle>) => void;
  onImage: (patch: Partial<PitchImageStyle>) => void;
  onReset: () => void;
  onAddLayer: (kind: 'text' | 'image' | 'box' | 'line') => void;
  onExtra: (id: string, patch: Partial<PitchExtraLayer>) => void;
  onExtraStyle: (id: string, patch: Partial<PitchElemStyle>) => void;
  onExtraImage: (id: string, patch: Partial<PitchImageStyle>) => void;
  onRemoveExtra: (id: string) => void;
  onResolveExtra: (id: string) => void;
  onMoveExtra: (id: string, dir: 1 | -1) => void;
  onReorder: (dragKey: string, targetKey: string) => void;
  themeLayouts: Array<{ id: string; name: string; apply: (p: PitchPage) => Partial<PitchPage> }>;
  themeName?: string;
  onApplyLayout: (lay: { id: string; apply: (p: PitchPage) => Partial<PitchPage> }) => void;
  para?: ParaUi;
  palette: PaletteApi;
  onPageBg: (c: string | undefined) => void;
  onSection: (v: string) => void;
  onTitle: (v: string) => void;
  onBody: (v: string) => void;
}) {
  const L = page.layout ?? {};
  const hasImage = !!page.imagePath;
  const dirty = (!!page.layout && Object.keys(page.layout).length > 0) || (page.extras?.length ?? 0) > 0;
  const im = L.image ?? {};
  const extras = page.extras ?? [];
  const selExtra = selKeys.length === 1 ? extras.find(x => x.id === selKeys[0]) : undefined;
  const inSel = (k: string) => selKeys.includes(k);
  const multi = selKeys.length > 1;
  const singleBuiltin = selKeys.length === 1 ? selKeys[0] : '';
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [layoutsOpen, setLayoutsOpen] = useState(false);   // layout gallery folds behind a side arrow
  // a text layer's list name mirrors its CONTENT (first line, trimmed) — Figma-style;
  // an explicit user rename (not the auto "Text N / Box N / Line N") still wins.
  const contentName = (t: string | undefined, fallback: string) => {
    const s = plainText(t ?? '').trim().split('\n')[0];
    return s ? (s.length > 26 ? s.slice(0, 26) + '…' : s) : fallback;
  };
  const layerDescriptor = (key: string, pg: PitchPage, hasImg: boolean) => {
    if (key === 'image') return { icon: '▦', iconSm: false, name: hasImg ? 'Image' : 'Image — empty', empty: !hasImg, hidden: !!L.image?.hidden, toggle: () => onImage({ hidden: !L.image?.hidden }), locked: !!L.image?.locked, lock: () => onImage({ locked: !L.image?.locked }) };
    if (key === 'kicker') return { icon: '§', iconSm: true, name: contentName(pg.section, 'Section label'), empty: false, hidden: !!L.kicker?.hidden, toggle: () => onElem('kicker', { hidden: !L.kicker?.hidden }), locked: !!L.kicker?.locked, lock: () => onElem('kicker', { locked: !L.kicker?.locked }) };
    if (key === 'title') return { icon: 'T', iconSm: false, name: contentName(pg.titleText, 'Title'), empty: false, hidden: !!L.title?.hidden, toggle: () => onElem('title', { hidden: !L.title?.hidden }), locked: !!L.title?.locked, lock: () => onElem('title', { locked: !L.title?.locked }) };
    if (key === 'body') return { icon: '¶', iconSm: true, name: contentName(pg.text, 'Body text'), empty: false, hidden: !!L.body?.hidden, toggle: () => onElem('body', { hidden: !L.body?.hidden }), locked: !!L.body?.locked, lock: () => onElem('body', { locked: !L.body?.locked }) };
    const x = (pg.extras ?? []).find(e => e.id === key);
    if (!x) return null;
    const i = (pg.extras ?? []).indexOf(x);
    const autoName = !x.name || /^(Text|Box|Line|Image)( \d+)?$/.test(x.name);
    const name = x.kind === 'text'
      ? (autoName ? contentName(x.text, x.name || `Text ${i + 1}`) : x.name!)
      : (x.name || `Image ${i + 1}`);
    return { icon: x.kind === 'text' ? 'T' : '▦', iconSm: x.kind === 'text', name, empty: false, hidden: !!x.hidden, toggle: () => onExtra(x.id, { hidden: !x.hidden }), locked: !!x.locked, lock: () => onExtra(x.id, { locked: !x.locked }) };
  };

  return (
    <aside className="ppp-layers" style={{ width: railWidth }}>
      <div className="ppp-rrail-top">
        <span className="ppp-layers__title mono-label">Design</span>
        <button className="ppp-railcollapse" title="Collapse the layers panel" onClick={onCollapse}>›</button>
      </div>
      {themeLayouts.length > 0 && (
        <div className="ppp-layoutbar">
          <button className="ppp-layers__collhead" onClick={() => setLayoutsOpen(v => !v)}
            title={layoutsOpen ? 'Collapse the layout gallery' : 'Expand the layout gallery'}>
            <span className="ppp-layers__title mono-label">Page layout{themeName ? ` · ${themeName}` : ''}</span>
            <span className={`ppp-collarrow ${layoutsOpen ? 'is-open' : ''}`} aria-hidden>›</span>
          </button>
          {layoutsOpen && (
            <div className="ppp-laygrid">
              {themeLayouts.map(lay => (
                <button key={lay.id} className={`ppp-laycard ${page.layoutPreset === lay.id ? 'is-on' : ''}`}
                  title={`Apply the ${lay.name} layout to this page`} onClick={() => onApplyLayout(lay)}>
                  <LayoutThumb lay={lay as any} width={92} />
                  <span className="ppp-laycard__name">{lay.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="ppp-tools__grp ppp-pagebg">
        <span className="ppp-tools__lbl mono-label">Page background</span>
        <div className="ppp-tools__row ppp-cdots">
          <ColorDot label="Colour" value={page.bgColor} fallback="#0A0A0A" onChange={onPageBg} onClear={() => onPageBg(undefined)} palette={palette} />
        </div>
      </div>

      <div className="ppp-layers__head">
        <span className="ppp-layers__title mono-label">Layers{multi ? ` · ${selKeys.length} selected` : ''}</span>
        {dirty && <button className="ppp-layers__reset" title="Reset this page's layout" onClick={onReset}>Reset all</button>}
      </div>

      <div className="ppp-lyr-list">
        {orderedKeys(page).slice().reverse().map(key => {   // front (top of list) → back
          const d = layerDescriptor(key, page, hasImage);
          if (!d) return null;
          return (
            <LayerRow key={key} icon={d.icon} iconSm={d.iconSm} name={d.name} empty={d.empty}
              selected={inSel(key)} hidden={d.hidden} locked={d.locked} over={dragOver === key}
              onSelect={a => onSelectLayer(key, a)} onToggle={d.toggle} onLock={d.lock}
              onRename={!isBuiltinText(key) && key !== 'image' ? (n => onExtra(key, { name: n })) : undefined}
              onDragStart={() => setDragKey(key)}
              onDragOver={() => { if (dragKey && dragKey !== key) setDragOver(key); }}
              onDrop={() => { if (dragKey && dragKey !== key) onReorder(dragKey, key); setDragKey(null); setDragOver(null); }}
              onDragEnd={() => { setDragKey(null); setDragOver(null); }} />
          );
        })}
      </div>

      {multi && <div className="ppp-tools__hint mono-label" style={{ padding: '4px 2px' }}>Multiple layers selected — drag or arrow-key to move them together. Shift-click a layer to add/remove.</div>}

      <div className="ppp-lyr-add">
        <button className="ppp-tool" onClick={() => onAddLayer('text')}>+ Text</button>
        <button className="ppp-tool" onClick={() => onAddLayer('image')}>+ Image</button>
        <button className="ppp-tool" title="Filled box you can write inside" onClick={() => onAddLayer('box')}>+ Box</button>
        <button className="ppp-tool" title="Rule line — drag to size, colour via Box fill" onClick={() => onAddLayer('line')}>+ Line</button>
      </div>

      {!multi && singleBuiltin === 'kicker' && (
        <>
          <div className="ppp-tools__grp ppp-txtfield">
            <span className="ppp-tools__lbl mono-label">Section</span>
            <input className="pp-input" data-pitch-layer="kicker" value={page.section} onChange={e => onSection(e.target.value)} spellCheck={false} placeholder="Section label" />
          </div>
          <TextTools role="kicker" palette={palette} style={L.kicker ?? {}} onPatch={p => onElem('kicker', p)} hasBox={!!L.kicker?.box} para={para} />
        </>
      )}
      {!multi && singleBuiltin === 'title' && (
        <>
          <div className="ppp-tools__grp ppp-txtfield">
            <span className="ppp-tools__lbl mono-label">Title</span>
            <input className="pp-input pp-input--ar" data-pitch-layer="title" value={page.titleText ?? ''} onChange={e => onTitle(e.target.value)} placeholder={sectionArLabel(page.section)} spellCheck={false} />
          </div>
          <TextTools role="title" palette={palette} style={L.title ?? {}} onPatch={p => onElem('title', p)} hasBox={!!L.title?.box} para={para} />
        </>
      )}
      {!multi && singleBuiltin === 'body' && (
        <>
          <div className="ppp-tools__grp ppp-txtfield">
            <span className="ppp-tools__lbl mono-label">Body — Enter for a line break</span>
            <textarea className="pp-textarea pp-textarea--ar" data-pitch-layer="body" style={{ minHeight: 72 }} value={page.text} onChange={e => onBody(e.target.value)} spellCheck={false} />
          </div>
          <TextTools role="body" palette={palette} style={L.body ?? {}} onPatch={p => onElem('body', p)} hasBox={!!L.body?.box} para={para} />
        </>
      )}
      {!multi && singleBuiltin === 'image' && (
        <>
          {page.imagePath && (
            <div className="ppp-tools__grp ppp-prov">
              <div className="ppp-editor__imgrow">
                {page.imageSource && <span className={`ppp-srcbadge ppp-srcbadge--${page.imageSource}`}>{page.imageSource}</span>}
                <span className="ppp-editor__imgname" title={page.imagePath}>{baseName(page.imagePath)}</span>
              </div>
              {page.imageWhy && <div className="ppp-editor__why" title="Why the mind fitted this reference">✦ {page.imageWhy}</div>}
            </div>
          )}
          <ImageTools im={im} hasImage={hasImage} onResolve={onResolve} onDelete={onClearImage} onImage={onImage} />
        </>
      )}

      {selExtra && selExtra.kind === 'text' && (
        <div className="ppp-tools">
          <div className="ppp-tools__grp">
            <span className="ppp-tools__lbl mono-label">Text</span>
            <textarea className="pp-textarea pp-textarea--ar" data-pitch-layer={selExtra.id} style={{ minHeight: 56 }} value={selExtra.text ?? ''} onChange={e => onExtra(selExtra.id, { text: e.target.value })} spellCheck={false} />
          </div>
          <TextTools role="extra" palette={palette} style={selExtra.style ?? {}} onPatch={p => onExtraStyle(selExtra.id, p)} hasBox para={para} />
          <button className="pp-btn pp-btn--ghost ppp-delbtn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => onRemoveExtra(selExtra.id)}>✕ Delete layer</button>
        </div>
      )}
      {selExtra && selExtra.kind === 'image' && (
        <>
          <ImageTools im={selExtra.image ?? {}} hasImage={!!selExtra.imagePath} onResolve={() => onResolveExtra(selExtra.id)} onDelete={() => onExtra(selExtra.id, { imagePath: undefined, imageSource: undefined })} onImage={p => onExtraImage(selExtra.id, p)} />
          <div className="ppp-tools">
            <button className="pp-btn pp-btn--ghost ppp-delbtn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => onRemoveExtra(selExtra.id)}>✕ Delete layer</button>
          </div>
        </>
      )}
    </aside>
  );
}

// ─── multi-source image picker (References · Storyboard · Library · File) ────

function PitchImagePicker({ projectId, spec, section, onPick, onFile, onClose }: {
  projectId: string | null;
  spec?: string; section?: string;
  onPick: (item: PickItem) => void;
  onFile: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Exclude<ImgSource, 'file'>>('reference');
  const [items, setItems] = useState<Record<'reference' | 'storyboard' | 'library', PickItem[] | null>>({
    reference: null, storyboard: null, library: null,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      try {
        if (tab === 'reference' && items.reference == null) {
          const st = projectId ? await window.hjen.readStageData({ id: projectId, stage: 2 }) as ReferencesData | null : null;
          const list: PickItem[] = (st?.refs ?? []).filter((r: HuntedRef) => r.imagePath)
            .map((r: HuntedRef) => ({ path: r.imagePath, label: r.tag || 'reference', sub: r.why, source: 'reference' as const }));
          if (live) setItems(s => ({ ...s, reference: list }));
        } else if (tab === 'storyboard' && items.storyboard == null) {
          const sb = projectId ? await window.hjen.readStoryboard({ id: projectId }) as StoryboardData | null : null;
          const list: PickItem[] = (sb?.shots ?? []).filter(sh => sh.generatedImagePath)
            .map(sh => ({ path: sh.generatedImagePath!, thumb: sh.thumbPath, label: `${sh.scene}${sh.letter}`, sub: sh.description, source: 'storyboard' as const }));
          if (live) setItems(s => ({ ...s, storyboard: list }));
        } else if (tab === 'library' && items.library == null) {
          const assets = await window.hjen.listLibrary() as LibraryAsset[];
          const list: PickItem[] = (assets ?? []).map(a => ({ path: a.filePath, thumb: a.thumbPath, label: a.name, sub: a.category, source: 'library' as const }));
          if (live) setItems(s => ({ ...s, library: list }));
        }
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [tab, projectId]);

  const current = items[tab];
  const TABS: Array<{ id: 'reference' | 'storyboard' | 'library'; label: string }> = [
    { id: 'reference', label: 'References' },
    { id: 'storyboard', label: 'Storyboard' },
    { id: 'library', label: 'Library' },
  ];

  return (
    <div className="ppp-picker" onClick={onClose}>
      <div className="ppp-picker__card" onClick={e => e.stopPropagation()}>
        <div className="ppp-picker__head">
          <div className="ppp-picker__title">
            Resolve image
            {section && <span className="ppp-picker__for"> · {section}</span>}
          </div>
          {spec && <div className="ppp-picker__spec pp-input--ar" dir="auto">{spec}</div>}
          <span className="pp-panel__spacer" />
          <button className="pp-btn pp-btn--ghost" onClick={onFile}>From file…</button>
          <button className="ppp-row__tool" title="Close" onClick={onClose}>×</button>
        </div>
        <div className="ppp-picker__tabs">
          {TABS.map(t => {
            const n = items[t.id]?.length;
            return (
              <button key={t.id} className={`ppp-picker__tab ${tab === t.id ? 'is-on' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}{typeof n === 'number' ? <span className="ppp-picker__count">{n}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="ppp-picker__body">
          {loading && current == null ? (
            <div className="ppp-picker__empty"><Busy label="Reading…" /></div>
          ) : !current || current.length === 0 ? (
            <div className="ppp-picker__empty mono-label">
              {tab === 'reference' ? 'No references yet — hunt them in stage 02.'
                : tab === 'storyboard' ? 'No made storyboard shots yet.'
                  : 'Library is empty — add assets from the Library page.'}
            </div>
          ) : (
            <div className="ppp-picker__grid">
              {current.map((it, i) => (
                <button key={i} className="ppp-pick" title={it.sub || it.label} onClick={() => onPick(it)}>
                  <img src={fileUrl(it.thumb || it.path)} alt={it.label} loading="lazy" />
                  <span className="ppp-pick__label">{it.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── the scaled A4-landscape page preview ───────────────────────────────────

interface StageProps {
  page: PitchPage; theme: PitchTheme; slug: string; projectName?: string;
  index: number; total: number; onResolve: () => void;
  aspect: number;
  rails?: { leftW: number; rightW: number; leftC: boolean; rightC: boolean };   // re-fit when rails change
  selKeys?: string[];
  extras?: PitchExtraLayer[];
  onLayerBox?: (key: string, box: PitchBox) => void;
  onApplyLayers?: (boxes: Record<string, PitchBox>, image?: { x: number; y: number }) => void;
  onPanImage?: (x: number, y: number) => void;
  onSelectLayer?: (l: string, additive?: boolean) => void;
  onText?: (key: string, text: string) => void;   // inline (double-click) text commit
  slugStyle?: PitchElemStyle;                     // deck-level header/footer — same box on every page, above every layer
  onSlugBox?: (box: PitchBox) => void;            // slug drag commit
  onShortcuts?: () => void;
  onTour?: () => void;
  zoomTool?: boolean;                             // Z tool active (lifted — toolbar toggles it too)
  onZoomTool?: (v: boolean) => void;
}
const SLUG_BOX: PitchBox = { x: 0.047, y: 0.024, w: 0.5, h: 0.04 };   // default running-slug box
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// stacking order — canonical keys + the page's saved order (bottom → top)
const layerKeys = (page: PitchPage): string[] => ['image', 'kicker', 'title', 'body', ...(page.extras ?? []).map(x => x.id)];
function orderedKeys(page: PitchPage): string[] {
  const all = layerKeys(page);
  const saved = (page.order ?? []).filter(k => all.includes(k));
  return [...saved, ...all.filter(k => !saved.includes(k))]; // bottom → top
}
// z-order law: text ALWAYS paints above imagery — image layers live in a low band,
// text layers in a high band; relative order within each band still follows page.order.
const isImgKey = (page: PitchPage, key: string) =>
  key === 'image' || (page.extras ?? []).some(x => x.id === key && x.kind === 'image');
const zIndexOf = (page: PitchPage, key: string) =>
  (orderedKeys(page).indexOf(key) + 1) * 10 + (isImgKey(page, key) ? 10 : 500);

const Z_MIN = 0.25, Z_MAX = 3;
const clampZoom = (z: number) => Math.min(Z_MAX, Math.max(Z_MIN, z));

// In-place text editor — a contentEditable that wears the element's exact style.
// Shows the RAW text (colour-span markers visible) so they stay editable;
// Esc cancels · blur / ⌘Enter commits · Enter = plain newline.
function InlineEdit({ value, className, style, upper, onCommit, onCancel }: {
  value: string; className?: string; style?: React.CSSProperties; upper?: boolean;
  onCommit: (v: string) => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  // selection-format popup: select letters → colour / B / I / U / font apply
  // ONLY to the selection by wrapping it in a {spec|…} rich token.
  const [selFmt, setSelFmt] = useState<null | { start: number; len: number; x: number; y: number }>(null);
  const [selColor, setSelColor] = useState('#E0531F');
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.innerText = value;
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return; done.current = true;
    if (commit) onCommit(ref.current?.innerText ?? ''); else onCancel();
  };
  const readSelection = () => {
    const el = ref.current; const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) { setSelFmt(null); return; }
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) { setSelFmt(null); return; }
    const pre = r.cloneRange(); pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length; const len = r.toString().length;
    if (!len) { setSelFmt(null); return; }
    const rect = r.getBoundingClientRect();
    setSelFmt({ start, len, x: rect.left, y: Math.max(8, rect.top - 36) });
  };
  const wrapSel = (spec: string) => {
    const el = ref.current; const f = selFmt; if (!el || !f) return;
    const raw = el.innerText;
    el.innerText = `${raw.slice(0, f.start)}{${spec}|${raw.slice(f.start, f.start + f.len)}}${raw.slice(f.start + f.len)}`;
    setSelFmt(null); el.focus();
  };
  const fontOptions = [...PITCH_FONTS, ...USER_FONTS];
  return (<>
    <div
      ref={ref}
      className={className}
      contentEditable={'plaintext-only' as any}
      suppressContentEditableWarning
      spellCheck={false}
      style={{ ...style, whiteSpace: 'pre-wrap', cursor: 'text', outline: '1.5px dashed var(--pp-accent, #E5AAD8)', outlineOffset: 2, minHeight: '1em', ...(upper ? { textTransform: 'uppercase' as const } : null) }}
      onPointerDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onMouseUp={readSelection}
      onKeyUp={e => { if (e.key.startsWith('Arrow') || e.shiftKey) readSelection(); }}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); if (selFmt) { setSelFmt(null); return; } finish(false); }
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(true); }
      }}
      onBlur={e => {
        // clicking the popup steals focus — don't commit mid-format
        const to = e.relatedTarget as HTMLElement | null;
        if (to && to.closest?.('.ppp-selfmt')) return;
        finish(true);
      }}
    />
    {selFmt && (
      <div className="ppp-selfmt" style={{ left: selFmt.x, top: selFmt.y }}
        onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.preventDefault()}>
        <input type="color" title="Colour the selected letters" value={selColor} onChange={e => setSelColor(e.target.value)} />
        <button title="Apply colour to selection" onClick={() => wrapSel(selColor)} style={{ color: selColor }}>A</button>
        <button title="Bold selection" style={{ fontWeight: 800 }} onClick={() => wrapSel('b')}>B</button>
        <button title="Italic selection" style={{ fontStyle: 'italic' }} onClick={() => wrapSel('i')}>I</button>
        <button title="Underline selection" style={{ textDecoration: 'underline' }} onClick={() => wrapSel('u')}>U</button>
        <select title="Change the selection's typeface" defaultValue="" onChange={e => { if (e.target.value) wrapSel(`f:${e.target.value}`); }}>
          <option value="" disabled>Font…</option>
          {fontOptions.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </div>
    )}
  </>);
}

// TRUE mini preview — the page's REAL composition (main image, collage tiles,
// bars/cards, every text layer, correct z-order) rendered read-only by the
// same PitchPageDom the stage uses, just scaled down. Memoized per page object
// so typing in one layer never re-renders the whole list.
const THUMB_W = 116;
const _noop = () => {};
const PageThumb = memo(function PageThumb({ page, theme, projectName, aspect, index, slug, slugStyle }: {
  page: PitchPage; theme: PitchTheme; projectName?: string; aspect: number; index: number; slug?: string; slugStyle?: PitchElemStyle;
}) {
  const s = THUMB_W / PAGE_W_PX;
  const h = Math.round(THUMB_W / aspect);
  return (
    <div className="ppp-pthumb ppp-pthumb--mini" style={{ width: THUMB_W, height: h }} aria-hidden>
      <PitchPageDom
        page={page} theme={theme} slug={slug ?? ''} projectName={projectName}
        index={index} total={0} onResolve={_noop} scale={s} aspect={aspect}
        selKeys={[]} extras={page.extras} slugStyle={slugStyle}
      />
    </div>
  );
}, (a, b) => a.page === b.page && a.theme === b.theme && a.aspect === b.aspect && a.index === b.index && a.slug === b.slug && a.slugStyle === b.slugStyle);

function PageStage(props: StageProps) {
  const zoomTool = props.zoomTool ?? false;
  const setZoomTool = props.onZoomTool ?? (() => {});
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageHpx = PAGE_W_PX / props.aspect;
  const [fitScale, setFitScale] = useState(0.4);
  const [scale, setScale] = useState(0.4);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [space, setSpace] = useState(false);
  const [altZoom, setAltZoom] = useState(false);   // ⌥ held → zoom-out cursor
  const userZoomed = useRef(false);
  const panDrag = useRef<null | { sx: number; sy: number; ox: number; oy: number }>(null);

  const fit = () => { userZoomed.current = false; setScale(fitScale); setPan({ x: 0, y: 0 }); };
  const zoomBy = (f: number) => { userZoomed.current = true; setScale(s => clampZoom(s * f)); };

  const r = props.rails;
  const railsKey = `${r?.leftW}|${r?.rightW}|${r?.leftC}|${r?.rightC}`;   // re-fit + re-center when the rails move
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const pad = 32;
      const s = Math.min((el.clientWidth - pad) / PAGE_W_PX, (el.clientHeight - pad) / pageHpx);
      const fs = Number.isFinite(s) && s > 0 ? Math.min(s, 1.1) : 0.4;
      setFitScale(fs);
      if (!userZoomed.current) { setScale(fs); setPan({ x: 0, y: 0 }); }   // centered fit
    };
    // defer one frame so the flex layout has settled → the first fit isn't conservative
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [pageHpx, railsKey]);

  // keyboard: ⌘= / ⌘− zoom · ⌘0 fit · hold Space to pan · Z zoom tool / V arrow
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = document.activeElement?.tagName;
      const typing = t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomBy(1.2); return; }
        if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.2); return; }
        if (e.key === '0') { e.preventDefault(); fit(); return; }
      }
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); setZoomTool(true); return; }
        if (e.key === 'v' || e.key === 'V') { setZoomTool(false); return; }
      }
      if (e.key === 'Alt') setAltZoom(true);
      if (e.code === 'Space' && !typing && !space) { e.preventDefault(); setSpace(true); }
    };
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); if (e.key === 'Alt') setAltZoom(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
  });

  // wheel over the stage: ⌘/pinch = zoom (trackpad pinch sends ctrlKey); a plain
  // two-finger scroll pans the frame (Figma-style, both axes) — page never scrolls.
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08); return; }
    userZoomed.current = true;   // manual pan sticks through rail resizes
    setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
  };
  const startPan = (e: React.PointerEvent) => {
    panDrag.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const movePan = (e: React.PointerEvent) => {
    const d = panDrag.current; if (!d) return;
    setPan({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
  };
  const endPan = (e: React.PointerEvent) => { panDrag.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ } };

  return (
    <div
      className={`ppp-stage ${space ? 'is-space' : ''} ${zoomTool ? (altZoom ? 'is-zoomtool-out' : 'is-zoomtool') : ''}`} ref={wrapRef} onWheel={onWheel}
      onClickCapture={zoomTool ? (e => { e.preventDefault(); e.stopPropagation(); zoomBy(e.altKey ? 1 / 1.25 : 1.25); }) : undefined}
    >
      {/* absolutely centred — a grid track sized by the UNSCALED page used to
          start-align and overflow right, hiding the page edge under the rail */}
      <div className="ppp-zoomwrap" style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${scale})`, transformOrigin: 'center center' }}>
        <div className="ppp-scalebox" style={{ width: PAGE_W_PX, height: pageHpx }}>
          <PitchPageDom {...props} scale={1} />
        </div>
      </div>
      {space && <div className="ppp-panveil" onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} />}
      <div className="ppp-zoombar">
        <button className="ppp-zoombtn" title="Zoom out (⌘−)" onClick={() => zoomBy(1 / 1.2)}>−</button>
        <button className="ppp-zoombtn ppp-zoombtn--pct" title="Fit to canvas (⌘0)" onClick={fit}>{Math.round(scale * 100)}%</button>
        <button className="ppp-zoombtn" title="Zoom in (⌘=)" onClick={() => zoomBy(1.2)}>＋</button>
        <button className="ppp-zoombtn ppp-zoombtn--fit" title="Fit to canvas (⌘0)" onClick={fit}>Fit</button>
        <span className="ppp-zoombar__sep" />
        <button className="ppp-zoombtn ppp-zoombtn--ic" title="Keyboard shortcuts (?)" onClick={props.onShortcuts}>⌨</button>
        <button className="ppp-zoombtn ppp-zoombtn--ic" title="Guided tour" onClick={props.onTour} aria-label="Guided tour">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4.2 12.4 Q3.4 6.2 11 6.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="0.2 2.4" />
            <circle cx="4.2" cy="12.4" r="1.7" fill="currentColor" />
            <path d="M11.4 2.6c1.5 0 2.6 1.15 2.6 2.6 0 1.75-2.6 4.2-2.6 4.2S8.8 6.95 8.8 5.2c0-1.45 1.1-2.6 2.6-2.6Z" fill="currentColor" />
            <circle cx="11.4" cy="5.2" r="0.95" fill="var(--bg-elev-2)" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Resolve a text element's inline style. Direction is content-aware: an
// element with no explicit dir follows its own text (Arabic → RTL, Latin →
// LTR) so nothing inherits the wrong direction from a parent.
// multi-colour spans — "{#E0531F|words}" runs inside ONE text render as coloured <span>s
function rich(text: string): React.ReactNode {
  const segs = parseRich(text || '');
  if (segs.length === 1 && !segs[0].color && !segs[0].bold && !segs[0].italic && !segs[0].underline && !segs[0].fontKey) return text;
  return segs.map((s, i) => {
    const st: React.CSSProperties = {};
    if (s.color) st.color = s.color;
    if (s.bold) st.fontWeight = 800;
    if (s.italic) st.fontStyle = 'italic';
    if (s.underline) st.textDecoration = 'underline';
    if (s.fontKey) st.fontFamily = pitchFontCss(s.fontKey);
    return <span key={i} style={Object.keys(st).length ? st : undefined}>{s.t}</span>;
  });
}

function elemStyle(s: PitchElemStyle | undefined, text: string): React.CSSProperties {
  const st = s ?? {};
  const plain = plainText(text || '');
  const dir: 'rtl' | 'ltr' = st.dir === 'rtl' ? 'rtl' : st.dir === 'ltr' ? 'ltr' : (hasArabic(plain) ? 'rtl' : 'ltr');
  const align: React.CSSProperties['textAlign'] = st.align === 'center' ? 'center' : dir === 'rtl' ? 'right' : 'left';
  return {
    ['--pp-fscale' as any]: st.fontScale ?? 1,
    ...((st.rotate || st.flipH || st.flipV) ? { transform: `${st.rotate ? `rotate(${st.rotate}deg) ` : ''}${st.flipH ? 'scaleX(-1) ' : ''}${st.flipV ? 'scaleY(-1)' : ''}`.trim(), transformOrigin: 'center center' } : null),
    ['--pp-lhscale' as any]: st.lineScale ?? 1,
    direction: dir,
    textAlign: align,
    ...(st.fontKey ? { fontFamily: pitchFontCss(st.fontKey) } : null),
    ...(st.weight ? { fontWeight: st.weight } : null),
    ...(st.italic ? { fontStyle: 'italic' as const } : null),
    ...(st.underline ? { textDecoration: 'underline' as const } : null),
    ...(st.color ? { color: st.color } : null),
    ...(st.strokeColor ? ({
      WebkitTextStroke: `${(st.strokeWidth ?? 0.6) * (st.strokePos === 'outside' ? 2 : 1)}px ${st.strokeColor}`,
      ...(st.strokePos === 'outside' ? { paintOrder: 'stroke' as any } : null),
    } as any) : null),
  };
}

function PitchPageDom({ page, theme, slug, projectName, index, onResolve, scale, aspect, selKeys, extras, onLayerBox, onApplyLayers, onPanImage, onSelectLayer, onText, slugStyle, onSlugBox }: StageProps & { scale: number }) {
  const pageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | { kind: 'move' | 'resize' | 'image'; key?: string; keys?: string[]; startBoxes?: Record<string, PitchBox>; sx: number; sy: number; b?: PitchBox; ix?: number; iy?: number; lastDx?: number; lastDy?: number }>(null);
  // live drag preview — the pointer moves a LOCAL offset only (this component
  // re-renders, nothing else); app state + autosave + undo get ONE commit on
  // pointer-up. Writing state per mousemove is what made dragging stick.
  const [live, setLive] = useState<null | { dx: number; dy: number }>(null);
  const liveBox = (key: string, b: PitchBox): PitchBox => {
    const d = drag.current;
    if (!live || !d) return b;
    if (d.kind === 'move' && d.keys?.includes(key) && d.startBoxes?.[key]) {
      const sb = d.startBoxes[key];
      return { ...sb, x: clamp(sb.x + live.dx, -0.9, 1.9 - sb.w), y: clamp(sb.y + live.dy, -0.9, 1.9 - sb.h) };
    }
    if (d.kind === 'resize' && d.key === key && d.b) {
      return { ...d.b, w: clamp(d.b.w + live.dx, 0.04, 1.9 - d.b.x), h: clamp(d.b.h + live.dy, 0.006, 1.9 - d.b.y) };
    }
    return b;
  };

  // ── inline (double-click) text editing — edit right on the design ──
  const [editKey, setEditKey] = useState<string | null>(null);
  useEffect(() => { setEditKey(null); }, [index]);   // leaving the page exits edit mode
  const canEdit = !!onText;
  const beginEdit = (key: string) => { if (canEdit) { onSelectLayer?.(key, false); setEditKey(key); } };
  const commitEdit = (key: string, v: string) => { onText?.(key, v); setEditKey(null); };

  const sel = selKeys ?? [];
  const isSel = (k: string) => sel.includes(k);
  const folio = String(index + 1).padStart(2, '0');
  const close = isClosePage(page);
  const src = fileUrl(page.imagePath);
  const style = { transform: `scale(${scale})`, height: `${297 / aspect}mm`, ...(page.bgColor ? { background: page.bgColor } : null) } as React.CSSProperties;

  // running slug — the deck's header/footer: user-positioned box, user colour,
  // SAME on every page, always painted above every layer (z 5000).
  // Drags on WINDOW listeners: live local preview, ONE commit on release.
  const sb0 = slugStyle?.box ?? SLUG_BOX;
  const slugDrag = useRef<null | { b: PitchBox; lastDx?: number; lastDy?: number }>(null);
  const [slugLive, setSlugLive] = useState<{ dx: number; dy: number } | null>(null);
  const sb = slugLive && slugDrag.current
    ? { ...slugDrag.current.b, x: clamp(slugDrag.current.b.x + slugLive.dx, -0.4, 0.97), y: clamp(slugDrag.current.b.y + slugLive.dy, -0.2, 0.97) }
    : sb0;
  const startSlugDrag = (e: React.PointerEvent) => {
    if (!onSlugBox) return;
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    slugDrag.current = { b: sb0 };
    const mv = (ev2: PointerEvent) => {
      const r = pageRef.current?.getBoundingClientRect(); const d = slugDrag.current;
      if (!r || !d) return;
      d.lastDx = (ev2.clientX - sx) / r.width; d.lastDy = (ev2.clientY - sy) / r.height;
      setSlugLive({ dx: d.lastDx, dy: d.lastDy });
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      const d = slugDrag.current; slugDrag.current = null; setSlugLive(null);
      if (d?.lastDx !== undefined) onSlugBox!({ ...d.b, x: clamp(d.b.x + d.lastDx, -0.4, 0.97), y: clamp(d.b.y + (d.lastDy ?? 0), -0.2, 0.97) });
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const slugEl = slug ? (
    <div
      className="ppp-pgslug"
      dir={hasArabic(slug) ? 'rtl' : 'ltr'}
      style={{
        left: `${sb.x * 100}%`, top: `${sb.y * 100}%`, width: `${sb.w * 100}%`, height: `${sb.h * 100}%`, right: 'auto',
        zIndex: 5000,
        ...(slugStyle?.color ? { color: slugStyle.color, opacity: 1 } : null),
        ...(slugStyle?.fontScale ? { fontSize: `${7 * slugStyle.fontScale}pt` } : null),
        ...(slugStyle?.align === 'center' ? { textAlign: 'center' as const } : slugStyle?.align === 'end' ? { textAlign: 'right' as const } : null),
        ...(onSlugBox ? { cursor: 'move' } : null),
      }}
      title={onSlugBox ? 'Running header/footer — drag to place (shows on every page)' : undefined}
      onPointerDown={onSlugBox ? startSlugDrag : undefined}
    >{slug}</div>
  ) : null;

  const L = page.layout ?? {};
  const img = L.image ?? {};
  const kickerSel = isSel('kicker'), titleSel = isSel('title'), bodySel = isSel('body'), imageSel = isSel('image');
  const imgHidden = !!L.image?.hidden;
  const imgLive = live && drag.current?.kind === 'image' ? live : null;   // smooth pan preview — commit on release
  const imgStyle: React.CSSProperties = {
    opacity: img.opacity ?? 1,
    transform: `translate(${(clamp((drag.current?.ix ?? img.x ?? 0) + (imgLive?.dx ?? 0), -0.5, 0.5)) * 100}%, ${(clamp((drag.current?.iy ?? img.y ?? 0) + (imgLive?.dy ?? 0), -0.5, 0.5)) * 100}%) scale(${Math.max(1, img.scale ?? 1)})`,
    transformOrigin: 'center',
  };
  const boxFor = (key: string): PitchBox =>
    isBuiltinText(key) ? resolveBox(page, theme, key, close) : (extras?.find(x => x.id === key)?.box ?? DEFAULT_EXTRA_BOX);
  // lock — a locked layer can't be moved OR selected from the canvas
  const isLocked = (key: string): boolean =>
    key === 'image' ? !!L.image?.locked
    : isBuiltinText(key) ? !!L[key]?.locked
    : !!extras?.find(x => x.id === key)?.locked;

  // ── drag/resize a layer box, or pan the background image ──
  // ALL drags run on WINDOW listeners: element pointer-capture proved unreliable
  // (the browser drops it after 1–2 moves → the layer "sticks"). Live preview is
  // local per move; app state gets ONE commit on release.
  const beginDrag = (e: React.PointerEvent, init: { kind: 'move' | 'resize'; key?: string; keys?: string[]; startBoxes?: Record<string, PitchBox>; b?: PitchBox }) => {
    const sx = e.clientX, sy = e.clientY;
    drag.current = { ...init, sx, sy };
    const mv = (ev2: PointerEvent) => {
      const r = pageRef.current?.getBoundingClientRect(); const d = drag.current;
      if (!r || !d) return;
      let dx = (ev2.clientX - sx) / r.width, dy = (ev2.clientY - sy) / r.height;
      if (ev2.shiftKey && d.kind === 'move') { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
      d.lastDx = dx; d.lastDy = dy;
      setLive({ dx, dy });
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      const d = drag.current; drag.current = null; setLive(null);
      if (!d || d.lastDx === undefined || d.lastDy === undefined) return;   // plain click — nothing moved
      const dx = d.lastDx, dy = d.lastDy;
      if (d.kind === 'move' && d.keys && d.startBoxes && onApplyLayers) {
        // layers may travel OUTSIDE the frame (Figma-style) — recoverable, export clips
        const boxes: Record<string, PitchBox> = {};
        for (const k of d.keys) { const sb = d.startBoxes[k]; boxes[k] = { ...sb, x: clamp(sb.x + dx, -0.9, 1.9 - sb.w), y: clamp(sb.y + dy, -0.9, 1.9 - sb.h) }; }
        onApplyLayers(boxes);
      } else if (d.kind === 'resize' && d.key && d.b && onLayerBox) {
        onLayerBox(d.key, { ...d.b, w: clamp(d.b.w + dx, 0.04, 1 - d.b.x), h: clamp(d.b.h + dy, 0.006, 1 - d.b.y) });   // h floor 0.006 → hairline rules stay draggable
      }
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const startMove = (e: React.PointerEvent, key: string) => {
    e.stopPropagation();
    if (isLocked(key)) return;                               // locked — untouchable on the canvas
    if (editKey === key) return;                             // editing in place — no drag
    if (e.shiftKey) { onSelectLayer?.(key, true); return; }  // shift = toggle in selection, no drag
    // drag the whole selection if this layer is part of it; else select just it
    const keys = isSel(key) ? sel.filter(k => k !== 'image') : [key];
    if (!isSel(key)) onSelectLayer?.(key, false);
    const startBoxes: Record<string, PitchBox> = {};
    for (const k of keys) startBoxes[k] = boxFor(k);
    beginDrag(e, { kind: 'move', keys, startBoxes });
  };
  const startResize = (e: React.PointerEvent, key: string) => { e.stopPropagation(); onSelectLayer?.(key, false); beginDrag(e, { kind: 'resize', key, b: boxFor(key) }); };
  // image pan drags via WINDOW listeners — pointer capture on the element gets
  // dropped by the browser mid-drag (lostpointercapture after ~2 moves), which
  // made the image feel stuck while text boxes dragged fine. Window listeners
  // are immune to re-renders and capture loss; commit once on release.
  const startImage = (e: React.PointerEvent) => {
    if (isLocked('image')) return;
    if (e.shiftKey) { onSelectLayer?.('image', true); e.stopPropagation(); return; }
    onSelectLayer?.('image', false);
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ix = img.x ?? 0, iy = img.y ?? 0;
    drag.current = { kind: 'image', sx, sy, ix, iy };
    const mv = (ev2: PointerEvent) => {
      const r = pageRef.current?.getBoundingClientRect(); if (!r || !drag.current) return;
      let dx = (ev2.clientX - sx) / r.width, dy = (ev2.clientY - sy) / r.height;
      if (ev2.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
      drag.current.lastDx = dx; drag.current.lastDy = dy;
      setLive({ dx, dy });
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      const d = drag.current; drag.current = null; setLive(null);
      if (d?.lastDx !== undefined && onPanImage) onPanImage(clamp(ix + d.lastDx, -0.5, 0.5), clamp(iy + (d.lastDy ?? 0), -0.5, 0.5));
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  // An un-resized box hugs its content (height auto); once the user drags the
  // corner (a custom box is stored) it honours the fixed height. Keeps default
  // slides tight — no big empty rectangles.
  const boxStyle = (b0: PitchBox, elem: TextLayer): React.CSSProperties => {
    const b = liveBox(elem, b0);
    // glyph-only hit for UNSELECTED bare text: the box ignores the pointer, only
    // the inline text (a pointer-events:auto span) catches it — overlapping text
    // boxes stop stealing each other's clicks. Selected / filled / editing boxes
    // stay fully grabbable.
    const glyphOnly = !isSel(elem) && !L[elem]?.bg && editKey !== elem;
    return {
      left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`,
      height: L[elem]?.box ? `${b.h * 100}%` : 'auto',
      zIndex: zIndexOf(page, elem),
      ...(L[elem]?.bg ? { background: L[elem]!.bg } : null),
      ...(glyphOnly ? { pointerEvents: 'none' as const } : null),
      ...(L[elem]?.locked ? { pointerEvents: 'none' as const } : null),   // locked = unclickable on canvas
      ...(L[elem]?.hidden ? { display: 'none' } : null),
    };
  };
  // wraps rendered text so ONLY the glyph runs are clickable (events bubble to the box)
  const hit = (children: React.ReactNode) => <span style={{ pointerEvents: 'auto' }}>{children}</span>;
  const handle = (key: string) => <span className="ppp-box__handle" title="Resize" onPointerDown={e => startResize(e, key)} />;

  const spec = (page.imageSpec || '').trim();
  const slot = (
    <div className="ppp-slot">
      <div className="ppp-slot__hint">Image spec</div>
      <div className="ppp-slot__spec" dir={spec && hasArabic(spec) ? 'rtl' : 'ltr'}>{spec || 'Set the image spec for this page.'}</div>
      <button className="ppp-slot__btn" onClick={onResolve}>Resolve image</button>
    </div>
  );
  const imgZ = zIndexOf(page, 'image');
  const imgLayer = (cls: string) => {
    if (!src) return slot;
    if (imgHidden) return <div className={cls} style={{ zIndex: imgZ }} />;  // hidden image → hold layout, show background
    return <div className={`${cls} ${imageSel ? 'is-sel' : ''}`} style={{ zIndex: imgZ }} onPointerDown={startImage}><img src={src} alt="" style={imgStyle} draggable={false} onDragStart={e => e.preventDefault()} /></div>;
  };

  // user-added layers — free-floating boxes over the page
  const extrasEls = (extras ?? []).map(x => {
    if (x.hidden) return null;
    const selX = isSel(x.id);
    const xb = liveBox(x.id, x.box);
    // bare text layers hit only on their glyphs (see boxStyle) — filled/selected/editing stay grabbable
    const glyphOnly = x.kind === 'text' && !selX && !x.style?.bg && editKey !== x.id;
    const bs: React.CSSProperties = {
      left: `${xb.x * 100}%`, top: `${xb.y * 100}%`, width: `${xb.w * 100}%`, height: `${xb.h * 100}%`,
      zIndex: zIndexOf(page, x.id),
      ...(x.style?.bg ? { background: x.style.bg } : null),
      ...(x.style?.bg && (x.text || '').trim() ? { padding: '4.5%' } : null),   // filled boxes breathe (parity with export)
      ...(glyphOnly ? { pointerEvents: 'none' as const } : null),
      ...(x.locked ? { pointerEvents: 'none' as const } : null),                // locked = unclickable on canvas
    };
    if (x.kind === 'text') {
      return (
        <div key={x.id} className={`ppp-box ${selX ? 'is-sel' : ''}`} style={bs} onPointerDown={e => startMove(e, x.id)} onDoubleClick={() => beginEdit(x.id)}>
          {editKey === x.id
            ? <InlineEdit value={x.text || ''} className="ppp-extra-text" style={elemStyle(x.style, x.text || '')} onCommit={v => commitEdit(x.id, v)} onCancel={() => setEditKey(null)} />
            : <div className="ppp-extra-text" style={elemStyle(x.style, x.text || '')}>{hit(rich(x.text || ''))}</div>}
          {selX && handle(x.id)}
        </div>
      );
    }
    const xsrc = fileUrl(x.imagePath);
    const xi = x.image ?? {};
    const xImgStyle: React.CSSProperties = {
      opacity: xi.opacity ?? 1,
      transform: `translate(${(xi.x ?? 0) * 100}%, ${(xi.y ?? 0) * 100}%) scale(${Math.max(1, xi.scale ?? 1)})`,
      transformOrigin: 'center',
      ...(xi.fit === 'contain' ? { objectFit: 'contain' as const } : null),
    };
    return (
      <div key={x.id} className={`ppp-box ppp-box--img ${selX ? 'is-sel' : ''}`} style={bs} onPointerDown={e => startMove(e, x.id)}>
        {xsrc
          ? <img className="ppp-extra-img" src={xsrc} alt="" style={xImgStyle} draggable={false} onDragStart={e => e.preventDefault()} />
          : <div className="ppp-extra-imgph mono-label">Image layer — resolve it</div>}
        {selX && handle(x.id)}
      </div>
    );
  });

  const kb = resolveBox(page, theme, 'kicker', close);
  const tb = resolveBox(page, theme, 'title', close);
  const bb = resolveBox(page, theme, 'body', close);
  const bodyText = page.text;

  // CLOSE without an image → typographic page
  if (close && !src) {
    const closeTitle = pageTitle(page, projectName);
    return (
      <div className="ppp-page ppp-page--dark" style={style} dir="ltr" ref={pageRef}>
        {slugEl}
        <div className={`ppp-box ${kickerSel ? 'is-sel' : ''}`} style={boxStyle(kb, 'kicker')} onPointerDown={e => startMove(e, 'kicker')}>
          <div className="ppp-close__eyebrow" style={elemStyle(L.kicker, 'WHY US')}>WHY US</div>
          {kickerSel && handle('kicker')}
        </div>
        <div className={`ppp-box ${titleSel ? 'is-sel' : ''}`} style={boxStyle(tb, 'title')} onPointerDown={e => startMove(e, 'title')}>
          <h2 className="ppp-close__h2" style={elemStyle(L.title, closeTitle)}>{closeTitle}</h2>
          {titleSel && handle('title')}
        </div>
        <div className={`ppp-box ${bodySel ? 'is-sel' : ''}`} style={boxStyle(bb, 'body')} onPointerDown={e => startMove(e, 'body')}>
          <div className="ppp-close__last" style={elemStyle(L.body, bodyText)}>{rich(bodyText)}</div>
          {bodySel && handle('body')}
        </div>
        {extrasEls}
        <div className="ppp-pgfolio">{folio}</div>
      </div>
    );
  }

  if (theme === 'sahifa' && !close) {
    const display = sectionArLabel(page.section);
    return (
      <div className="ppp-page ppp-sahifa" style={style} dir="ltr" ref={pageRef}>
        {imgLayer('ppp-sahifa__media')}
        <div className="ppp-sahifa__paper" />
        {slug && <div className="ppp-pgslug ppp-pgslug--rtl">{slug}</div>}
        <div className={`ppp-box ${titleSel ? 'is-sel' : ''}`} style={boxStyle(tb, 'title')} onPointerDown={e => startMove(e, 'title')}>
          <div className="ppp-sahifa__display" style={elemStyle(L.title, display)}>{display}</div>
          {titleSel && handle('title')}
        </div>
        <div className={`ppp-box ${kickerSel ? 'is-sel' : ''}`} style={boxStyle(kb, 'kicker')} onPointerDown={e => startMove(e, 'kicker')}>
          <div className="ppp-sahifa__deck" style={elemStyle(L.kicker, normSection(page.section))}>{normSection(page.section)}</div>
          {kickerSel && handle('kicker')}
        </div>
        <div className={`ppp-box ${bodySel ? 'is-sel' : ''}`} style={boxStyle(bb, 'body')} onPointerDown={e => startMove(e, 'body')}>
          <div className="ppp-sahifa__body" style={elemStyle(L.body, bodyText)}>{rich(bodyText)}</div>
          {bodySel && handle('body')}
        </div>
        {extrasEls}
        <div className="ppp-pgfolio">{folio}</div>
      </div>
    );
  }

  // Layl — dark full-bleed (also CLOSE with an image)
  const isCover = normSection(page.section) === 'COVER';
  const kicker = isCover ? 'CAMPAIGN PITCH · HJEN' : normSection(page.section);
  const title = pageTitle(page, projectName);
  const titleArabic = hasArabic(title);
  const titleBase: React.CSSProperties = titleArabic && !L.title?.fontKey
    ? { fontFamily: "'Instrument Serif Display', 'Instrument Serif', 'Geeza Pro', serif", fontWeight: 700 }
    : {};

  return (
    <div className="ppp-page ppp-page--dark" style={style} dir="ltr" ref={pageRef}>
      {imgLayer('ppp-layl__bg')}
      {L.image?.scrim === false ? null : <div className="ppp-layl__scrim" style={{ zIndex: imgZ + 1 }} />}
      {slugEl}
      <div className={`ppp-box ${kickerSel ? 'is-sel' : ''}`} style={boxStyle(kb, 'kicker')} onPointerDown={e => startMove(e, 'kicker')} onDoubleClick={() => beginEdit('kicker')}>
        {editKey === 'kicker'
          ? <InlineEdit value={page.section || ''} className="ppp-layl__kicker" style={elemStyle(L.kicker, kicker)} upper onCommit={v => commitEdit('kicker', v)} onCancel={() => setEditKey(null)} />
          : <div className="ppp-layl__kicker" style={elemStyle(L.kicker, kicker)}>{hit(kicker)}</div>}
        {kickerSel && handle('kicker')}
      </div>
      <div className={`ppp-box ${titleSel ? 'is-sel' : ''}`} style={boxStyle(tb, 'title')} onPointerDown={e => startMove(e, 'title')} onDoubleClick={() => beginEdit('title')}>
        {editKey === 'title'
          ? <InlineEdit value={page.titleText || title} className="ppp-layl__h1" style={{ ...titleBase, ...elemStyle(L.title, title) }} upper={!titleArabic} onCommit={v => commitEdit('title', v)} onCancel={() => setEditKey(null)} />
          : (
            <h1 className="ppp-layl__h1" style={{ ...titleBase, ...elemStyle(L.title, title) }}>
              {hit((() => { const tt = titleArabic ? title : title.toUpperCase(); if (L.title?.noSig) return <>{rich(tt)}</>; const sp = sigSplit(tt); return <>{rich(sp.pre)}<span style={{ whiteSpace: 'nowrap' }}>{rich(sp.last)}<span className="ppp-layl__sig">.</span></span></>; })())}
            </h1>
          )}
        {titleSel && handle('title')}
      </div>
      <div className={`ppp-box ${bodySel ? 'is-sel' : ''}`} style={boxStyle(bb, 'body')} onPointerDown={e => startMove(e, 'body')} onDoubleClick={() => beginEdit('body')}>
        {editKey === 'body'
          ? <InlineEdit value={page.text || ''} className="ppp-layl__ar" style={elemStyle(L.body, bodyText)} onCommit={v => commitEdit('body', v)} onCancel={() => setEditKey(null)} />
          : <div className="ppp-layl__ar" style={elemStyle(L.body, bodyText)}>{hit(rich(bodyText))}</div>}
        {bodySel && handle('body')}
      </div>
      {extrasEls}
      <div className="ppp-pgfolio">{folio}</div>
    </div>
  );
}
