import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { HJEN_DNA_IDS } from '../lib/dna';
import { LayerPreviewModal, type PreviewTarget } from './LayerPreviewModal';
import { QualityBadge } from './QualityBadge';
import { useActiveTheme } from '../lib/theme/useTheme';
import { cleanFileName } from '../lib/downloadName';

function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

interface SidecarLite {
  prompt?: string;
  size?: string;
  apiSize?: string;
  finalSize?: string;
  finalMP?: number;
  model?: string;
  apiModelId?: string;
  project?: { name: string } | null;
  durationMs?: number;
  estimatedCost?: { usd: number; breakdown: string };
  selections?: Record<string, any>;
  promptChain?: {
    skillId?: string | null;
    skillName?: string | null;
    masterPrompt?: string | null;
    originalPrompt?: string | null;
  } | null;
  references?: Array<{
    name: string;
    customName?: string;
    category: string;
    filePath?: string;
    parentLayerId?: string;
  }>;
}

const MAX_SCALE = 8;        // 800%
const ZOOM_STEP_PCT = 0.25; // each − / + step = 25% of natural size

// Back-compat: older sidecars stored `references` as bare PATH STRINGS. Normalize
// each into the object shape the preview renders (so old images show their refs).
type RefObj = { name: string; customName?: string; category: string; filePath?: string; parentLayerId?: string };
function normalizeRefs(refs: unknown): RefObj[] {
  return (Array.isArray(refs) ? refs : []).map((r: any) => typeof r === 'string'
    ? { name: (r.split('/').pop() || 'reference').replace(/\.(png|jpe?g|webp)$/i, ''), category: 'reference', filePath: r }
    : r);
}

/**
 * `scale` is in display-percent / 100 terms (1.0 = pixel-perfect actual size).
 * `baseScale` is what the CSS layout produces at transform-scale 1: for a
 * big image inside `object-fit: contain` this is the fit ratio (e.g. 0.51).
 * The CSS transform applied to the image is therefore `scale / baseScale`,
 * so the displayed pixels per image-pixel is `scale`.
 */
interface View { scale: number; x: number; y: number }

export function GenerationPreview() {
  const preview = useStore(s => s.preview);
  const previewList = useStore(s => s.previewList);
  const previewOrigin = useStore(s => s.previewOrigin);
  const activeTabId = useStore(s => s.activeTabId);
  const activeView = useStore(s => s.activeView);
  const close = useStore(s => s.closePreview);
  const navigate = useStore(s => s.navigatePreview);
  const viewPast = useStore(s => s.viewPastGeneration);
  const setActiveView = useStore(s => s.setActiveView);
  const refineFromCurrent = useStore(s => s.refineFromCurrent);
  const exportAction = useActiveTheme().actions;

  // Are we on the tab + view where this preview was opened? When false the
  // overlay stays MOUNTED (image decoded, sidecar loaded, zoom state intact) but
  // is hidden via CSS — so returning to its origin is instant with no reload
  // flash. Unmounting instead would remount+refetch on return, which reads to
  // the user as "it was closed and reopened".
  const onOrigin = !previewOrigin
    || (previewOrigin.tabId === activeTabId && previewOrigin.view === activeView);

  const [sidecar, setSidecar] = useState<SidecarLite | null>(null);
  const [imgUrl, setImgUrl] = useState<string | undefined>();

  // baseScale = the image's CSS-rendered scale (offsetWidth / naturalWidth)
  // when no transform is applied. 1 for images smaller than the wrap;
  // < 1 for images larger than the wrap (the typical case here).
  const [baseScale, setBaseScale] = useState(1);

  // view.scale = displayed-pixels-per-image-pixel. 1.0 = actual size (100%).
  // At first paint, before we know baseScale, we keep scale = baseScale
  // (= Fit). The transform-scale applied is `scale / baseScale`.
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  // Photoshop/Figma-style: holding Space turns the whole viewer into a
  // pan-grab — works at any zoom level, overrides button hit-testing so
  // the user can drag through controls without accidental clicks.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  // Click on a reference thumbnail in the side panel → open it at ~50%
  // of frame in a backdropped modal. Same component as the Layers sidebar.
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  // Compare mode: vertical drag-divider revealing more of the composition
  // reference vs the made frame. Available only when sidecar has a
  // composition ref attached. `compareX` is in 0–100 percent.
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareX, setCompareX] = useState(50);
  // Download the master (web: browser download with a clean name; desktop:
  // Save-As). In-flight state keeps the button honest and un-spammable.
  const [downloading, setDownloading] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragStartRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);

  // Index info for the navigation UI
  const idx = preview ? previewList.findIndex(e => e.imgPath === preview.imgPath) : -1;
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < previewList.length - 1;

  // Reset on preview change
  useEffect(() => {
    if (!preview) { setSidecar(null); setImgUrl(undefined); return; }
    setSidecar(null);
    setImgUrl(fileUrl(preview.imgPath));
    setBaseScale(1);
    setView({ scale: 1, x: 0, y: 0 }); // fit (will be corrected when image loads)
    setDragging(false);
    setPreviewTarget(null);
    setCompareOpen(false);
    setCompareX(50);
    dragStartRef.current = null;
    let cancelled = false;
    window.hjen.readSidecar(preview.jsonPath).then(s => { if (!cancelled) setSidecar(s); });
    return () => { cancelled = true; };
  }, [preview?.imgPath, preview?.jsonPath]);

  // Measure baseScale once the image lays out + on window resize.
  const measureBase = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    // offsetWidth is the layout box (NOT affected by transform).
    // But it IS affected by our transform: we need the untransformed size.
    // Trick: temporarily remove the transform to measure, then re-apply.
    // Simpler: compute geometrically. The CSS sets max-width:100% / max-height:100%
    // with object-fit:contain, so untransformed size = fit inside wrap rect.
    const wrap = wrapRef.current;
    if (!wrap) return;
    // Skip while the overlay is hidden (off-origin → display:none → zero box):
    // measuring a 0-size wrap would corrupt baseScale. We re-measure on return.
    if (!wrap.clientWidth || !wrap.clientHeight) return;
    // Read the wrap's REAL content box (clientWidth/Height already exclude
    // scrollbar; subtract the actual padding from computed style so the fit
    // math tracks the --s-7 token instead of a hardcoded guess). A stale
    // constant here made "Fit"/"1:1"/the % read a few points off.
    const cs = getComputedStyle(wrap);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availW = Math.max(1, wrap.clientWidth - padX);
    const availH = Math.max(1, wrap.clientHeight - padY);
    const fitScale = Math.min(availW / img.naturalWidth, availH / img.naturalHeight, 1);
    setBaseScale(fitScale);
    // Snap current view to fit (display-pct = fitScale) on first measure,
    // otherwise keep whatever the user is at.
    setView(v => v.scale === 1 && v.x === 0 && v.y === 0 ? { scale: fitScale, x: 0, y: 0 } : v);
  }, []);

  useEffect(() => {
    window.addEventListener('resize', measureBase);
    return () => window.removeEventListener('resize', measureBase);
  }, [measureBase]);

  // Coming back to the preview's origin (un-hidden): re-measure so baseScale is
  // correct even if the window was resized while the overlay was hidden (those
  // measures were skipped). Cheap, and it won't disturb an existing zoom.
  useEffect(() => {
    if (preview && onOrigin) requestAnimationFrame(measureBase);
  }, [onOrigin, preview, measureBase]);

  // Entering/leaving compare swaps the zoom subject (image → composite
  // canvas). Reset the zoom state so each subject starts at its own
  // "fit": baseScale=1 for the compare canvas (already fit-sized in JS),
  // re-measured baseScale for the raw image.
  useEffect(() => {
    if (compareOpen) {
      setBaseScale(1);
      setView({ scale: 1, x: 0, y: 0 });
    } else {
      setView({ scale: 1, x: 0, y: 0 });
      requestAnimationFrame(measureBase);
    }
  }, [compareOpen, measureBase]);

  function onImgLoad() {
    // run after the browser has laid out the image
    requestAnimationFrame(measureBase);
  }

  const minScale = baseScale; // can't zoom out smaller than fit
  const maxScale = MAX_SCALE;

  function clampScale(s: number): number {
    return Math.max(minScale, Math.min(maxScale, Math.round(s * 1000) / 1000));
  }

  // Multiplicative zoom (smooth, Photoshop-style). `factor` > 1 zooms in.
  const zoomBy = useCallback((factor: number, cursorX?: number, cursorY?: number) => {
    setView(prev => {
      const next = clampScale(prev.scale * factor);
      if (next === prev.scale) return prev;
      if (next <= minScale + 0.001) return { scale: minScale, x: 0, y: 0 };
      if (cursorX === undefined || cursorY === undefined || !wrapRef.current) {
        return { scale: next, x: prev.x, y: prev.y };
      }
      const rect = wrapRef.current.getBoundingClientRect();
      const cx = cursorX - rect.left - rect.width / 2;
      const cy = cursorY - rect.top - rect.height / 2;
      // Pan offset is in screen pixels and lives outside scale, so the
      // ratio between displayed scales is the same as the ratio between
      // transform scales: next/prev.
      const ratio = next / prev.scale;
      return { scale: next, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio };
    });
  }, [minScale]);

  const fitToScreen = useCallback(() => {
    setView({ scale: baseScale, x: 0, y: 0 });
  }, [baseScale]);

  const zoomToActual = useCallback(() => {
    setView({ scale: 1, x: 0, y: 0 });
  }, []);

  const stepZoom = useCallback((direction: 1 | -1) => {
    // Step by 25% of actual-size, snapping to nice values when possible.
    setView(prev => {
      const stepped = prev.scale + direction * ZOOM_STEP_PCT;
      const next = clampScale(stepped);
      if (next === prev.scale) return prev;
      return { scale: next, x: prev.x, y: prev.y };
    });
  }, [minScale]);

  // Native wheel listener — React's onWheel is passive, so preventDefault
  // is a no-op there. We need non-passive for trackpad pinch and to stop
  // the page from scrolling under the lightbox.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Trackpad pinch uses ctrlKey + small deltaY; mouse wheel = big deltaY.
      // Use a multiplicative factor for smooth Photoshop-style zoom.
      const factor = Math.exp(-e.deltaY * 0.0035);
      zoomBy(factor, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // Keyboard
  useEffect(() => {
    // Only bind the global keyboard shortcuts while the overlay is actually
    // visible — a hidden (off-origin) preview must not eat Escape/arrows/zoom
    // keys on the tab the user is now looking at.
    if (!preview || !onOrigin) return;
    const isTextTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      // Space-hold pan: track without consuming when focus is in a text field.
      if (e.code === 'Space') {
        if (isTextTarget(e.target)) return;
        if (e.repeat) { e.preventDefault(); return; }
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      // When a layer-preview modal is open it owns the keyboard — its own
      // capture-phase Escape closes it. We must NOT also close the lightbox.
      if (previewTarget) return;
      if (e.key === 'Escape') {
        // Compare mode swallows Escape to exit compare first.
        if (compareOpen) { setCompareOpen(false); return; }
        close();
        return;
      }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); stepZoom(1); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); stepZoom(-1); return; }
      if (e.key === '0') { e.preventDefault(); fitToScreen(); return; }
      if (e.key === '1') { e.preventDefault(); zoomToActual(); return; }
      // Only navigate at Fit — otherwise arrow keys conflict with pan.
      if (view.scale > baseScale + 0.001) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        navigate(1);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') { setSpaceHeld(false); }
    };
    // Release Space if the window loses focus mid-drag — prevents a "stuck"
    // grab cursor when the user Cmd-Tabs away while panning.
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [preview, onOrigin, close, navigate, view.scale, baseScale, stepZoom, fitToScreen, zoomToActual, previewTarget, compareOpen]);

  // Render nothing only when there is genuinely no preview. When a preview
  // exists but we're off its origin, we still render (mounted) and hide it with
  // `.lightbox--hidden` (display:none) — see onOrigin above — so returning is a
  // pure show, not a remount+reload.
  if (!preview) return null;

  const openInStudio = async () => {
    await viewPast(preview);
    setActiveView('frame');
    close();
  };

  // Refine from preview: load this past frame as the current frame, push
  // it to the Layers panel as a composition lock, then close the
  // lightbox. The dedup in refineFromCurrent / addToLibrary makes this
  // safe to press repeatedly on the same preview without piling up
  // copies. Mirrors the Refine button on the HeroCanvas chip bar.
  const refineFromPreview = async () => {
    await viewPast(preview);
    setActiveView('frame');
    await refineFromCurrent();
    close();
  };

  // Download this frame — the founder's #1 action. Works on both hosts via the
  // bridge: web triggers a browser download of the master, desktop opens Save-As.
  // The name is slugified from the frame's title; empty → bridge clean default.
  const downloadThis = async () => {
    if (!preview || downloading) return;
    setDownloading(true);
    try {
      const title = sidecar?.selections?.prompt?.split(/[.!?\n,]/)[0]?.trim()
        || preview.promptTitle
        || '';
      await window.hjen.downloadGeneration({
        filePath: preview.imgPath,
        name: cleanFileName(title, preview.imgPath),
      });
    } finally {
      setDownloading(false);
    }
  };

  const promptText = sidecar?.prompt || '';
  // First composition ref (if any) — enables the Compare slider mode.
  const compositionRef = normalizeRefs(sidecar?.references).find(r => r.category === 'composition' && r.filePath);
  const compareSrc = compositionRef?.filePath ? fileUrl(compositionRef.filePath) : undefined;
  // Lock the compare canvas to the MADE FRAME's aspect (that's what the
  // model actually produced). The composition ref is shown center-cropped
  // to the same aspect so the divider slides across identical pixel
  // dimensions — apples-to-apples composition compare.
  const compareAspect = (() => {
    const sz = sidecar?.finalSize || sidecar?.apiSize || preview?.size;
    if (!sz) return '16 / 9';
    const m = sz.match(/^(\d+)x(\d+)$/);
    return m ? `${m[1]} / ${m[2]}` : '16 / 9';
  })();

  // Pan when above Fit — OR whenever Space is held (Photoshop/Figma grab mode).
  // In Compare mode the divider stops its own pointer events from bubbling,
  // so a pointerdown that reaches the wrap is safe to interpret as pan.
  function onPointerDown(e: React.PointerEvent) {
    if (!spaceHeld && view.scale <= baseScale + 0.001) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStartRef.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    const s = dragStartRef.current;
    if (!s) return;
    setView(v => ({ ...v, x: s.vx + (e.clientX - s.px), y: s.vy + (e.clientY - s.py) }));
  }
  function onPointerUp(e: React.PointerEvent) {
    dragStartRef.current = null;
    setDragging(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }

  function onDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    // Toggle: actual ↔ fit. If already at actual or above, fit. Otherwise jump
    // to actual size centred on the click. Works identically in Compare —
    // there "actual" means 1.0× of the compare canvas (i.e. 100% display),
    // and "fit" returns to the JS-sized canvas.
    if (view.scale >= 1 - 0.001) {
      fitToScreen();
    } else {
      // Zoom to actual size around the click point
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) { zoomToActual(); return; }
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const ratio = 1 / view.scale;
      setView(prev => ({
        scale: 1,
        x: cx - (cx - prev.x) * ratio,
        y: cy - (cy - prev.y) * ratio,
      }));
    }
  }

  const pct = Math.round(view.scale * 100);
  const transformScale = baseScale > 0 ? view.scale / baseScale : 1;
  const atFit = view.scale <= baseScale + 0.001;
  const atActual = Math.abs(view.scale - 1) < 0.001;

  // Cursor: Space-hold takes priority — grab/grabbing regardless of zoom.
  // Otherwise: zoom-in cursor at Fit, grab/grabbing only when zoomed.
  const wrapCursor = spaceHeld
    ? (dragging ? 'grabbing' : 'grab')
    : (atFit ? 'zoom-in' : (dragging ? 'grabbing' : 'grab'));

  return (
    <div
      className={`lightbox ${spaceHeld ? 'lightbox--space-pan' : ''} ${onOrigin ? '' : 'lightbox--hidden'}`}
      aria-hidden={!onOrigin}
      onClick={close}
    >
      <div
        ref={wrapRef}
        className="lightbox__image-wrap"
        onClick={e => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        style={{ cursor: wrapCursor }}
      >
        {compareOpen && compareSrc && imgUrl ? (
          <CompareSlider
            leftSrc={compareSrc}
            leftLabel="Composition ref"
            rightSrc={imgUrl}
            rightLabel="Made frame"
            aspect={compareAspect}
            x={compareX}
            onChange={setCompareX}
            onClose={() => setCompareOpen(false)}
            view={view}
            dragging={dragging}
            spaceHeld={spaceHeld}
          />
        ) : imgUrl
          ? <img
              ref={imgRef}
              className="lightbox__image"
              src={imgUrl}
              alt=""
              draggable={false}
              onLoad={onImgLoad}
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${transformScale})`,
                // No transition during drag OR while Space is held — both are
                // interactive modes where a 140ms easing feels like input lag.
                transition: (dragging || spaceHeld) ? 'none' : 'transform 120ms ease-out',
              }}
            />
          : <div className="lightbox__loading">Loading…</div>}

        {/* Zoom toolbar — top centre.
            Stop pointer-down propagation so the wrap's pan-drag handler
            doesn't capture the pointer and steal the click. Stays visible
            in Compare so the user can zoom the composite canvas. */}
        <div
          className="lightbox__zoom"
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
        >
          <button
            className="lightbox__zoom-btn"
            onClick={() => stepZoom(-1)}
            disabled={atFit}
            title="Zoom out (−)"
          >−</button>
          <button
            className="lightbox__zoom-pct"
            onClick={zoomToActual}
            title="Zoom to 100% — actual size (1)"
          >{pct}%</button>
          <button
            className="lightbox__zoom-btn"
            onClick={() => stepZoom(1)}
            disabled={view.scale >= maxScale - 0.001}
            title="Zoom in (+)"
          >+</button>
          <span className="lightbox__zoom-divider" />
          <button
            className={`lightbox__zoom-action ${atFit ? 'lightbox__zoom-action--active' : ''}`}
            onClick={fitToScreen}
            title="Fit to screen (0)"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3" />
            </svg>
            Fit
          </button>
          <button
            className={`lightbox__zoom-action ${atActual ? 'lightbox__zoom-action--active' : ''}`}
            onClick={zoomToActual}
            title="Actual pixels — 100% (1)"
          >1:1</button>
        </div>

        {!compareOpen && previewList.length > 1 && (
          <>
            <button
              className="lightbox__nav lightbox__nav--prev"
              onClick={(e) => { e.stopPropagation(); navigate(-1); }}
              disabled={!hasPrev || !atFit}
              title="Previous (↑ / ←)"
            >‹</button>
            <button
              className="lightbox__nav lightbox__nav--next"
              onClick={(e) => { e.stopPropagation(); navigate(1); }}
              disabled={!hasNext || !atFit}
              title="Next (↓ / →)"
            >›</button>
            <div className="lightbox__counter mono-label">
              {idx + 1} / {previewList.length}
            </div>
          </>
        )}
      </div>

      <aside className="lightbox__side" onClick={e => e.stopPropagation()}>
        <header className="lightbox__head">
          <div
            className="lightbox__title"
            dir="auto"
            title={sidecar?.selections?.prompt || preview.promptTitle || ''}
          >
            {truncateTitle(
              sidecar?.selections?.prompt?.split(/[.!?\n,]/)[0]?.trim()
                || preview.promptTitle
                || 'Untitled'
            )}
          </div>
          <button className="lightbox__close" onClick={close} title="Close (Esc)">×</button>
        </header>

        <div className="lightbox__body">
          <Row label="Project" value={sidecar?.project?.name || '—'} />
          <Row label="Model" value={sidecar?.model || preview.modelLabel || '—'} mono={sidecar?.apiModelId} />
          <div className="lightbox__row">
            <div className="mono-label lightbox__row-label">Quality</div>
            <div className="lightbox__row-value">
              <QualityBadge quality={sidecar?.selections?.quality ?? (preview as any)?.quality} />
            </div>
          </div>
          <Row
            label="Size"
            value={sidecar?.finalSize || preview.size || '—'}
            sub={sidecar?.finalMP !== undefined ? `${sidecar.finalMP.toFixed(2)} MP` : undefined}
          />
          {sidecar?.estimatedCost && (
            <Row label="Cost (est.)" value={`~$${sidecar.estimatedCost.usd.toFixed(3)}`} sub={sidecar.estimatedCost.breakdown} accent />
          )}
          {sidecar?.durationMs !== undefined && (
            <Row label="Duration" value={fmtDuration(sidecar.durationMs)} />
          )}

          {(sidecar?.selections || sidecar?.promptChain?.skillId) && (() => {
            const sel = sidecar?.selections || {};
            const cam = sel.camera;
            const lens = sel.lens;
            const stock = sel.stock;
            const lighting = sel.lighting;
            const movie = sel.movie;
            const matchesDNA =
              cam === HJEN_DNA_IDS.camera &&
              lens === HJEN_DNA_IDS.lens &&
              stock === HJEN_DNA_IDS.stock &&
              lighting === HJEN_DNA_IDS.lighting &&
              movie === HJEN_DNA_IDS.movie;
            const skillName = sidecar?.promptChain?.skillName;
            const installedSkills = useStore.getState().skills;
            const skillStillInstalled = sidecar?.promptChain?.skillId
              ? installedSkills.some(s => s.id === sidecar.promptChain!.skillId)
              : false;
            const dnaRows: Array<[string, string | undefined]> = [
              ['Look', sel.movie],
              ['Camera', sel.camera],
              ['Lens', sel.lens],
              ['Stock', sel.stock],
              ['Lighting', sel.lighting],
              ['Aspect', sel.aspect],
            ].filter(([, v]) => v) as Array<[string, string]>;

            return (
              <section className="lightbox__dna">
                <div className="lightbox__dna-head">
                  <div className="mono-label lightbox__refs-label">DNA &amp; Skills</div>
                  {matchesDNA && <span className="lightbox__dna-badge">HJEN DNA preset</span>}
                </div>

                {skillName && (
                  <div className={`lightbox__skill-pill ${skillStillInstalled ? '' : 'lightbox__skill-pill--missing'}`}
                       title={skillStillInstalled
                         ? `Skill used to transform the prompt: ${skillName}`
                         : `Skill used: ${skillName} (no longer installed in this app)`}>
                    <span className="mono-label">Skill</span>
                    <span className="lightbox__skill-pill-name">{skillName}</span>
                    {!skillStillInstalled && <span className="lightbox__skill-pill-tag">removed</span>}
                  </div>
                )}

                {dnaRows.length > 0 && (
                  <div className="lightbox__dna-grid">
                    {dnaRows.map(([k, v]) => (
                      <div key={k} className="lightbox__dna-row">
                        <div className="mono-label lightbox__dna-key">{k}</div>
                        <div className="lightbox__dna-val">{v}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })()}

          {sidecar?.references && sidecar.references.length > 0 && (() => {
            const refs = normalizeRefs(sidecar.references);
            const compositionRef = refs.find(r => r.category === 'composition' && r.filePath);
            return (
              <section className="lightbox__refs">
                <div className="mono-label lightbox__refs-label">
                  <span>References ({refs.length})</span>
                  {compositionRef && (
                    <button
                      className="lightbox__compare-btn"
                      onClick={() => setCompareOpen(true)}
                      title="Compare composition reference with made frame"
                    >Compare ↔</button>
                  )}
                </div>
                <div className="lightbox__refs-grid">
                  {refs.map((r, i) => (
                    <div key={i} className="lightbox__ref-card" title={r.customName || r.name}>
                      {r.filePath
                        ? <img
                            className="lightbox__ref-thumb"
                            src={fileUrl(r.filePath)}
                            alt=""
                            loading="lazy"
                            onClick={() => setPreviewTarget({ filePath: r.filePath!, name: r.customName || r.name })}
                          />
                        : <div className="lightbox__ref-thumb lightbox__ref-thumb--missing">—</div>}
                      <div className="lightbox__ref-body">
                        <div className="lightbox__ref-cat mono-label">{r.category}</div>
                        <div className="lightbox__ref-name">{r.customName || r.name}</div>
                        {r.parentLayerId && <div className="lightbox__ref-parent">attached to a character</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}

          {promptText && (
            <section className="lightbox__prompt-wrap">
              <div className="mono-label lightbox__prompt-label">Prompt sent</div>
              <div className="lightbox__prompt-box">
                <pre className="lightbox__prompt" dir="auto">{promptText}</pre>
                <button
                  className="lightbox__prompt-copy"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(promptText); } catch { return; }
                    setPromptCopied(true);
                    setTimeout(() => setPromptCopied(false), 1500);
                  }}
                  title="Copy prompt"
                >
                  {promptCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </section>
          )}
        </div>

        <footer className="lightbox__foot">
          <button
            className="lightbox__action lightbox__action--download"
            onClick={downloadThis}
            disabled={downloading}
            title="Download a clean copy of this frame"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10" />
            </svg>
            {downloading ? 'Saving…' : 'Download'}
          </button>
          <button
            className="lightbox__action"
            onClick={openInStudio}
            title="Open this frame in the Studio canvas"
          >Studio</button>
          <button
            className="lightbox__action lightbox__action--primary"
            onClick={refineFromPreview}
            title="Push this frame to Layers as a composition lock and iterate"
          >Refine</button>
          {exportAction.showExport && (
            <button
              className="lightbox__action"
              onClick={() => window.hjen.openFolder(preview.imgPath.replace(/\/[^/]+$/, ''))}
              title="Reveal in Finder"
            >{exportAction.exportLabel || 'Reveal'}</button>
          )}
        </footer>
      </aside>

      <LayerPreviewModal target={previewTarget} onClose={() => setPreviewTarget(null)} />
    </div>
  );
}

/** Side-by-side compare with a vertical drag-divider.
 *  The compare canvas is locked to the made-frame's aspect ratio. Both
 *  images use object-fit: cover within it — the comp ref center-crops
 *  to match so the divider slices across IDENTICAL pixel boxes. Without
 *  the locked aspect, two refs of different aspects would each letterbox
 *  independently inside the wrap, making the compare visually misaligned. */
function CompareSlider({
  leftSrc, leftLabel, rightSrc, rightLabel, aspect, x, onChange, onClose,
  view, dragging: parentDragging, spaceHeld,
}: {
  leftSrc: string;
  leftLabel: string;
  rightSrc: string;
  rightLabel: string;
  aspect: string;
  x: number;
  onChange: (v: number) => void;
  onClose: () => void;
  /** Zoom / pan state shared with the lightbox toolbar + wheel handler.
   *  baseScale is implicitly 1 in compare mode (the canvas is already
   *  JS-sized to fit), so view.scale here means "× fit". */
  view: View;
  dragging: boolean;
  spaceHeld: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  // Pure-CSS aspect-ratio collapses to 0×0 when both width and height are
  // auto inside a flex parent. Compute the canvas size in JS instead —
  // shrink to whichever wrap dimension is the binding constraint.
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const m = aspect.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
    const target = m ? Number(m[1]) / Number(m[2]) : 16 / 9;

    const recalc = () => {
      const ww = wrap.clientWidth;
      const wh = wrap.clientHeight;
      if (!ww || !wh) return;
      const cur = ww / wh;
      const [w, h] = cur > target
        ? [wh * target, wh]  // wrap is wider — fit height
        : [ww, ww / target]; // wrap is taller — fit width
      setCanvasSize({ w, h });
    };
    recalc();

    const ro = new ResizeObserver(recalc);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [aspect]);

  const updateFromEvent = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    onChange(Math.max(0, Math.min(100, pct)));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    // Stop propagation so the parent wrap's pan handler doesn't also
    // engage on the same down. Without this, dragging the divider would
    // simultaneously start a pan when the canvas is zoomed in.
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    updateFromEvent(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    e.stopPropagation();
    updateFromEvent(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    setDragging(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };

  // Zoom/pan transform from the parent. baseScale is implicitly 1 here,
  // so view.scale doubles as both display-pct and transform-scale.
  // While the user is actively dragging the divider OR panning the wrap,
  // kill the CSS transition so the canvas tracks the pointer 1:1.
  const transformStyle: React.CSSProperties = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transformOrigin: 'center center',
    transition: (dragging || parentDragging || spaceHeld) ? 'none' : 'transform 120ms ease-out',
  };
  // ew-resize cursor only makes sense on the divider itself. When zoomed
  // in, or Space-held, the canvas surface is grabbable for pan.
  const canvasCursor = spaceHeld
    ? (parentDragging ? 'grabbing' : 'grab')
    : (view.scale > 1.001 ? (parentDragging ? 'grabbing' : 'grab') : 'ew-resize');

  return (
    <div
      ref={wrapRef}
      className="lightbox__compare-wrap"
      onClick={e => e.stopPropagation()}
    >
      <div
        ref={canvasRef}
        className="lightbox__compare-canvas"
        style={canvasSize
          ? { width: canvasSize.w, height: canvasSize.h, cursor: canvasCursor, ...transformStyle }
          : { visibility: 'hidden' }}
      >
        <img className="lightbox__compare-img lightbox__compare-img--right" src={rightSrc} alt="" draggable={false} />
        <img
          className="lightbox__compare-img lightbox__compare-img--left"
          src={leftSrc}
          alt=""
          draggable={false}
          style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }}
        />

        <span className="lightbox__compare-label lightbox__compare-label--left mono-label">{leftLabel}</span>
        <span className="lightbox__compare-label lightbox__compare-label--right mono-label">{rightLabel}</span>

        <div
          className={`lightbox__compare-divider ${dragging ? 'is-dragging' : ''}`}
          style={{ left: `${x}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="lightbox__compare-handle">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 5L3 10l4 5M13 5l4 5-4 5" />
            </svg>
          </div>
        </div>
      </div>

      <button className="lightbox__compare-exit" onClick={onClose}>Exit Compare</button>
    </div>
  );
}

function Row({ label, value, sub, mono, accent }: { label: string; value: string; sub?: string; mono?: string; accent?: boolean }) {
  return (
    <div className="lightbox__row">
      <div className="mono-label lightbox__row-label">{label}</div>
      <div className={`lightbox__row-value ${accent ? 'lightbox__row-value--accent' : ''}`}>
        {value}
        {mono && <code className="lightbox__row-mono">{mono}</code>}
        {sub && <span className="lightbox__row-sub">{sub}</span>}
      </div>
    </div>
  );
}

/** Cap a title at TITLE_MAX_CHARS and append an ellipsis when truncated.
 *  Pairs with CSS line-clamp on `.lightbox__title` — the JS cap stops the
 *  string explosion before layout, the CSS clamp catches the tail. Cuts at
 *  the last word boundary inside the cap so we don't slice mid-word like
 *  the old `slice(0, 80)` did ("compo..." instead of "composition..."). */
const TITLE_MAX_CHARS = 100;
function truncateTitle(s: string): string {
  if (s.length <= TITLE_MAX_CHARS) return s;
  const cut = s.slice(0, TITLE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  const safe = lastSpace > TITLE_MAX_CHARS * 0.7 ? cut.slice(0, lastSpace) : cut;
  return `${safe.trimEnd()}…`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}
