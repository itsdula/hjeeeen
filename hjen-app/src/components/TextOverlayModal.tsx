// Typography Overlay modal — «نص» on a made frame.
// Real Inter type composited at native resolution; the guaranteed-correct
// path for Arabic text (the Saudi DNA Layer routes long/critical text here
// instead of asking the image model to draw glyphs). Drag to place, export
// saves as a new generation next to the source frame.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import {
  DEFAULT_SPEC, OVERLAY_COLORS, drawOverlay, ensureOverlayFonts,
  exportOverlayBase64, type OverlaySpec, type OverlayWeight,
} from '../lib/textOverlay';

const WEIGHTS: { id: OverlayWeight; label: string }[] = [
  { id: 'regular',     label: 'Regular' },
  { id: 'medium',      label: 'Medium' },
  { id: 'bold',        label: 'Bold' },
  { id: 'black',       label: 'Black' },
  { id: 'serif-bold',  label: 'Serif Bold' },
  { id: 'serif-black', label: 'Serif Black' },
];

function slugifyAr(s: string): string {
  return (s.trim().split(/\s+/).slice(0, 4).join('-') || 'typography').slice(0, 40);
}

export function TextOverlayModal({ sourcePath, onClose, initialText }: { sourcePath: string; onClose: () => void; initialText?: string }) {
  const projects = useStore(s => s.projects);
  const activeProjectId = useStore(s => s.activeProjectId);
  const proj = projects.find(p => p.id === activeProjectId) ?? null;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragging = useRef(false);

  const [spec, setSpec] = useState<OverlaySpec>({ ...DEFAULT_SPEC, text: initialText ?? '' });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  // Load fonts + source image once.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        await ensureOverlayFonts();
        const dataUrl = await window.hjen.readImageDataUrl(sourcePath);
        if (!dataUrl) { if (!dead) setError('Could not read the frame from disk'); return; }
        const img = new Image();
        img.onload = () => { if (!dead) { imgRef.current = img; setReady(true); } };
        img.onerror = () => { if (!dead) setError('Could not load the frame'); };
        img.src = dataUrl;
      } catch (e: any) {
        if (!dead) setError(e?.message || 'Could not prepare the tool');
      }
    })();
    return () => { dead = true; };
  }, [sourcePath]);

  // Redraw on every spec change.
  useEffect(() => {
    if (!ready || !canvasRef.current || !imgRef.current) return;
    drawOverlay(canvasRef.current, imgRef.current, spec);
  }, [ready, spec]);

  const placeFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(0.98, Math.max(0.02, (e.clientX - rect.left) / rect.width));
    const y = Math.min(0.98, Math.max(0.02, (e.clientY - rect.top) / rect.height));
    setSpec(s => ({ ...s, x, y }));
  };

  const save = async () => {
    if (!canvasRef.current || saving || !spec.text.trim()) return;
    setSaving(true);
    try {
      const b64 = exportOverlayBase64(canvasRef.current);
      const saved = await window.hjen.saveGeneration({
        base64: b64,
        promptSlug: `typo-${slugifyAr(spec.text)}`,
        projectSlug: proj?.slug,
        projectId: proj?.id,
        sidecar: {
          captured: new Date().toISOString(),
          project: proj ? { id: proj.id, name: proj.name, slug: proj.slug } : null,
          prompt: `Typography overlay (Inter): «${spec.text}»`,
          model: 'Typography Overlay',
          overlayOf: sourcePath,
          overlaySpec: spec,
        },
      });
      setSavedPath(saved.imgPath);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return createPortal((
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(8,10,12,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div dir="ltr" style={{ background: 'var(--panel, #16191d)', borderRadius: 12, padding: 16, width: 'min(1060px, 94vw)', maxHeight: '92vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="mono-label">Typography Overlay</div>
            <h3 style={{ margin: '2px 0 0' }}>Real text overlay — Inter font</h3>
          </div>
          <button className="btn-secondary" onClick={onClose}>Close ×</button>
        </header>

        {error && <div style={{ color: '#e08080', fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {/* Canvas preview — drag to place the text */}
          <div style={{ flex: '1 1 560px', minWidth: 320 }}>
            <canvas
              ref={canvasRef}
              style={{ width: '100%', borderRadius: 8, cursor: 'crosshair', display: ready ? 'block' : 'none', touchAction: 'none' }}
              onPointerDown={e => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); placeFromEvent(e); }}
              onPointerMove={e => { if (dragging.current) placeFromEvent(e); }}
              onPointerUp={() => { dragging.current = false; }}
            />
            {!ready && !error && <div style={{ padding: 40, textAlign: 'center', opacity: 0.6 }}>Loading frame and fonts…</div>}
            <div className="mono-label" style={{ marginTop: 6, fontSize: 10, opacity: 0.6 }}>Drag on the image to place the text</div>
          </div>

          {/* Controls */}
          <div style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="mono-label">Text (new line = second line)</span>
              <textarea
                dir="auto"
                rows={3}
                value={spec.text}
                onChange={e => setSpec(s => ({ ...s, text: e.target.value }))}
                placeholder="Type your text here — always rendered with correct letters"
                style={{ resize: 'vertical', padding: 8, borderRadius: 6 }}
              />
            </label>

            <div>
              <span className="mono-label">Weight</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {WEIGHTS.map(w => (
                  <button
                    key={w.id}
                    className="btn-secondary"
                    onClick={() => setSpec(s => ({ ...s, weight: w.id }))}
                    style={{ fontSize: 11, padding: '3px 10px', opacity: spec.weight === w.id ? 1 : 0.55, outline: spec.weight === w.id ? '1px solid currentColor' : 'none' }}
                  >{w.label}</button>
                ))}
              </div>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="mono-label">Size — {(spec.sizeFrac * 100).toFixed(1)}% of frame width</span>
              <input
                type="range" min={0.02} max={0.20} step={0.005}
                value={spec.sizeFrac}
                onChange={e => setSpec(s => ({ ...s, sizeFrac: Number(e.target.value) }))}
              />
            </label>

            <div>
              <span className="mono-label">Color</span>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {OVERLAY_COLORS.map(c => (
                  <button
                    key={c.id}
                    title={c.label}
                    onClick={() => setSpec(s => ({ ...s, colorHex: c.hex }))}
                    style={{
                      width: 26, height: 26, borderRadius: '50%', background: c.hex, cursor: 'pointer',
                      border: spec.colorHex === c.hex ? '2px solid #fff' : '1px solid rgba(255,255,255,0.25)',
                    }}
                  />
                ))}
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={spec.shadow}
                onChange={e => setSpec(s => ({ ...s, shadow: e.target.checked }))}
              />
              Soft shadow for legibility over busy frames
            </label>

            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {savedPath && (
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  Saved ✓ <button className="hero__saved-reveal" onClick={() => window.hjen.openFolder(savedPath.replace(/\/[^/]+$/, ''))}>Reveal</button>
                </div>
              )}
              <button
                className="btn-primary"
                onClick={save}
                disabled={saving || !ready || !spec.text.trim()}
              >
                {saving ? 'Saving…' : 'Save as new Frame'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
