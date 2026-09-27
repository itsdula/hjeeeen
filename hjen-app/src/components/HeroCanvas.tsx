import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import hjenMaster from '../assets/hjen_master.svg';
import { TextOverlayModal } from './TextOverlayModal';

export function HeroCanvas() {
  const current = useStore(s => s.current);
  const openPicker = useStore(s => s.openPicker);
  const refineFromCurrent = useStore(s => s.refineFromCurrent);
  const lastMasterRun = useStore(s => s.lastMasterRun);
  const lastLayerRun = useStore(s => s.lastLayerRun);
  const skills = useStore(s => s.skills);
  const skillStillInstalled = lastMasterRun ? skills.some(s => s.id === lastMasterRun.skillId) : false;
  const [textOverlayOpen, setTextOverlayOpen] = useState(false);
  const [overlaySeedText, setOverlaySeedText] = useState<string | undefined>(undefined);

  // Smart framing: a frame NARROWER/TALLER than the canvas (portrait) is
  // CONTAINED so the whole take is visible (no crop); a frame WIDER than the
  // canvas (landscape / wide square) FILLS it for the immersive backdrop.
  // Square (1:1) is narrower than the wide canvas, so it contains — safe.
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [fitMode, setFitMode] = useState<'fit' | 'fill'>('fit');
  const recomputeFit = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.clientWidth || !img.clientHeight) return;
    const frameAspect = img.naturalWidth / img.naturalHeight;
    const canvasAspect = img.clientWidth / img.clientHeight;   // element box = canvas box
    setFitMode(frameAspect < canvasAspect ? 'fit' : 'fill');
  }, []);
  // Recompute when the canvas box changes (sidebar toggle, window resize). The
  // element box is unaffected by object-fit, so switching modes never re-fires.
  useEffect(() => {
    const img = imgRef.current;
    if (!img || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(recomputeFit);
    ro.observe(img);
    return () => ro.disconnect();
  }, [recomputeFit, current?.savedPath, current?.url]);

  // E28 flow — when the Saudi DNA Layer planned an OVERLAY for the user's
  // requested text (too long / a headline for in-model rendering), the نص
  // tool opens itself pre-filled the moment the frame lands. One auto-open
  // per layer run; closing it is respected.
  const handledLayerTs = useRef<number | null>(null);
  useEffect(() => {
    if (!lastLayerRun || !current?.savedPath) return;
    if (lastLayerRun.textPlan.mode !== 'overlay' || !lastLayerRun.textPlan.content) return;
    if (handledLayerTs.current === lastLayerRun.ts) return;
    handledLayerTs.current = lastLayerRun.ts;
    setOverlaySeedText(lastLayerRun.textPlan.content);
    setTextOverlayOpen(true);
  }, [lastLayerRun, current?.savedPath]);

  return (
    <div className="hero">
      {current ? (
        <img
          ref={imgRef}
          className={`hero__img hero__img--${fitMode}`}
          src={current.savedPath ? `hjen-file://${encodeURI(current.savedPath)}` : current.url}
          alt=""
          onLoad={recomputeFit}
        />
      ) : (
        <div className="hero__placeholder">
          <img className="hero__placeholder-mark" src={hjenMaster} alt="HJEN" />
        </div>
      )}
      {/* Generated frames get a top reading veil plus a cinematic floor. The
          empty brand canvas uses a floor-only variant so its colour and centre
          mark stay clean while the controls still land on confident black. */}
      <div className={`hero__gradient ${current ? '' : 'hero__gradient--empty'}`} />
      {current && (
        <div className="hero__saved">
          {lastMasterRun && (
            <button
              className={`hero__skill-chip ${skillStillInstalled ? '' : 'hero__skill-chip--missing'}`}
              onClick={() => openPicker('details')}
              title={skillStillInstalled
                ? `Made with skill: ${lastMasterRun.skillName}. Click for full prompt chain.`
                : `Made with skill: ${lastMasterRun.skillName} (no longer installed). Click for full prompt chain.`}
            >
              <span className="mono-label">Skill</span>
              <span className="hero__skill-chip-name">{lastMasterRun.skillName}</span>
            </button>
          )}
          {current.savedPath && (
            <>
              <span className="mono-label">Saved</span>
              <code className="hero__saved-path" title={current.savedPath}>{shortenPath(current.savedPath)}</code>
            </>
          )}
          <button className="hero__saved-reveal" onClick={() => openPicker('details')}>
            Prompt
          </button>
          {current.dir && (
            <button className="hero__saved-reveal" onClick={() => window.hjen.openFolder(current.dir!)}>
              Reveal
            </button>
          )}
          {current.savedPath && (
            <button
              className="hero__saved-reveal"
              onClick={() => { setOverlaySeedText(undefined); setTextOverlayOpen(true); }}
              title="Add real text over the frame — Inter font, always-correct letters"
            >
              ADD text
            </button>
          )}
          {current.savedPath && (
            <button
              className="hero__saved-reveal hero__saved-reveal--primary"
              onClick={() => refineFromCurrent()}
              title="Push this frame to Layers as a composition lock and iterate"
            >
              Refine
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4 }}>
                <path d="M3 8l4 4 6-8" />
                <path d="M12 3v3h-3" />
              </svg>
            </button>
          )}
        </div>
      )}
      {textOverlayOpen && current?.savedPath && (
        <TextOverlayModal
          sourcePath={current.savedPath}
          initialText={overlaySeedText}
          onClose={() => setTextOverlayOpen(false)}
        />
      )}
    </div>
  );
}

function shortenPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~');
}
