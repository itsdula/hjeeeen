import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useStoryboard } from '../../store/storyboardStore';
import type { StoryboardRefSlot } from '../../types/storyboard';

function fileUrl(p?: string): string | undefined { return p ? `hjen-file://${encodeURI(p)}` : undefined; }
function dirOf(p: string): string { const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : p; }
async function pickOneImage(): Promise<string | null> {
  const files = await window.hjen.pickImageFiles();
  return files && files.length ? files[0] : null;
}

const KIND_LABEL: Record<string, string> = { characters: 'Character', places: 'Location', elements: 'Element' };

/** Dedicated asset viewer (character face + sheet, place, element). Shows the
 *  made image(s), lets the user attach a CLIENT reference to generate the asset
 *  from, and Refine re-makes it in place. Closes via ×, Esc, or click-outside. */
export function AssetPreview() {
  const data = useStoryboard(s => s.data);
  const pa = useStoryboard(s => s.previewAsset);
  const close = useStoryboard(s => s.closeAsset);
  const updateRef = useStoryboard(s => s.updateRef);
  const makeAsset = useStoryboard(s => s.makeAsset);
  const patch = useStoryboard(s => s.patch);
  const selectAssetTake = useStoryboard(s => s.selectAssetTake);
  const projectId = useStoryboard(s => s.projectId);
  const projectName = useStore(s => s.projects.find(p => p.id === projectId)?.name) ?? '—';
  const pending = useStoryboard(s => (s.previewAsset ? (s.pendingTakes[`${s.projectId}::${s.previewAsset.id}`] ?? 0) : 0));
  const [zoom, setZoom] = useState<string | null>(null);

  const open = !!pa;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (e.key === 'Escape') { e.stopPropagation(); if (zoom) setZoom(null); else if (tag !== 'input' && tag !== 'textarea') close(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close, zoom]);

  if (!data || !pa) return null;
  const list = data[pa.kind] as StoryboardRefSlot[];
  const slot = list.find(s => s.id === pa.id);
  if (!slot) return null;

  const isChar = pa.kind === 'characters';
  const making = slot.assetStatus === 'making';
  const images = isChar
    ? [{ src: slot.faceImagePath, label: 'Face' }, { src: slot.sheetImagePath, label: 'Sheet' }].filter(x => x.src)
    : [{ src: slot.refImagePath, label: KIND_LABEL[pa.kind] }].filter(x => x.src);

  const attachSource = async () => { const p = await pickOneImage(); if (p) updateRef(pa.kind, pa.id, { sourceRefPath: p }); };
  const clearSource = () => updateRef(pa.kind, pa.id, { sourceRefPath: undefined });

  return (
    <div className="sbp" onClick={close}>
      <div className="sbp__stage" onClick={e => e.stopPropagation()}>
        <div className="sbp__asset-imgs">
          {images.length === 0
            ? <div className="sbp__empty mono-label">{making ? 'making…' : 'not made yet'}</div>
            : images.map(im => (
                <button key={im.label} className="sbp__asset-img" onClick={() => im.src && setZoom(im.src)} title="Enlarge">
                  <img src={fileUrl(im.src)} alt={im.label} />
                  <span className="sbp__take-n mono-label">{im.label}</span>
                </button>
              ))}
        </div>

        {/* versions — Refine keeps the old ones; click to approve one */}
        {((slot.takes?.length ?? 0) > 1 || pending > 0) && (
          <div className="sbp__takes">
            <span className="mono-label sbp__dim">Versions</span>
            {(slot.takes ?? []).map((t, i) => {
              const tImg = isChar ? (t.faceThumbPath ?? t.faceImagePath) : (t.thumbPath ?? t.refImagePath);
              const isCur = isChar ? t.faceImagePath === slot.faceImagePath : t.refImagePath === slot.refImagePath;
              return (
                <button key={i} className={`sbp__take ${isCur ? 'is-current' : ''}`} onClick={() => selectAssetTake(pa.kind, pa.id, t)} title={isCur ? 'Approved version' : 'Use this version'}>
                  <img src={fileUrl(tImg)} alt="" />
                  <span className="sbp__take-n mono-label">v{i + 1}{isCur ? ' ✓' : ''}</span>
                </button>
              );
            })}
            {Array.from({ length: pending }).map((_, i) => (
              <div key={`p-${i}`} className="sbp__take sbp__take--pending" title="Making a new version…"><span className="sb-spinner" /></div>
            ))}
          </div>
        )}
      </div>

      <aside className="sbp__side" onClick={e => e.stopPropagation()}>
        <header className="sbp__head">
          <h2>{slot.name || KIND_LABEL[pa.kind]}</h2>
          <button className="sb-icon" onClick={close} title="Close (Esc)">×</button>
        </header>

        <div className="sbp__meta">
          <Meta label="Project" value={projectName} />
          <Meta label="Kind" value={KIND_LABEL[pa.kind]} />
        </div>

        <Field label="Name"><input className="sb-input" value={slot.name} onChange={e => updateRef(pa.kind, pa.id, { name: e.target.value })} /></Field>
        <Field label="Note"><input className="sb-input" value={slot.note ?? ''} onChange={e => updateRef(pa.kind, pa.id, { note: e.target.value })} placeholder="age, build, wardrobe… / what the place is" /></Field>

        {/* client reference — generate the asset FROM the client's image */}
        <div className="sbp__source">
          <div className="mono-label sbp__dim">Client reference (optional)</div>
          <div className="sbp__source-row">
            <button className="sbp__source-thumb" onClick={() => slot.sourceRefPath ? setZoom(slot.sourceRefPath) : attachSource()} title={slot.sourceRefPath ? 'Enlarge' : 'Attach a reference'}>
              {slot.sourceRefPath ? <img src={fileUrl(slot.sourceRefPath)} alt="" /> : <span className="sb-ref__plus">+</span>}
            </button>
            <div className="sbp__source-body">
              <p className="sbp__source-hint">Attach a photo/sketch from the client. Refine will build this asset from it, redrawn in the board style.</p>
              <div className="sbp__source-actions">
                <button className="sb-btn sb-btn--sm" onClick={attachSource}>{slot.sourceRefPath ? 'Replace' : 'Attach'}</button>
                {slot.sourceRefPath && <button className="sb-ref__clear mono-label" onClick={clearSource}>remove</button>}
              </div>
            </div>
          </div>
        </div>

        <div className="sbp__row2">
          <Field label="Quality (speed)">
            <select className="sb-input" value={data.quality ?? 'MED'} onChange={e => patch({ quality: e.target.value as any })}>
              <option value="LOW">Draft — fastest</option>
              <option value="MED">Standard</option>
              <option value="HIGH">High — slowest</option>
            </select>
          </Field>
          <Field label="Model">
            <select className="sb-input" value={data.model ?? 'GPT_IMAGE_2'} onChange={e => patch({ model: e.target.value as any })}>
              <option value="GPT_IMAGE_2">ChatGPT Image 2</option>
              <option value="NANO_BANANA_PRO">Nano Banana Pro</option>
            </select>
          </Field>
        </div>

        {making && <div className="sbp__making-note mono-label">Making… this can take a moment.</div>}
        {slot.assetStatus === 'failed' && slot.assetError && <div className="sb-panel__err">{slot.assetError}</div>}

        <footer className="sbp__foot">
          <button className="btn-primary" onClick={() => makeAsset(pa.kind, pa.id)}>
            {pending > 0 ? `MADE −${pending}` : (slot.assetStatus === 'made' ? 'Refine' : 'Make')}
          </button>
          {images[0]?.src && <button className="sb-btn" onClick={() => window.hjen.openFolder(dirOf(images[0].src!)).catch(() => {})}>Reveal</button>}
          <button className="sb-btn" onClick={close}>Close</button>
        </footer>
      </aside>

      {zoom && (
        <div className="sbp__zoom" onClick={e => { e.stopPropagation(); setZoom(null); }}>
          <img src={fileUrl(zoom)} alt="" />
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="sbp__metaitem">
      <div className="mono-label sbp__dim">{label}</div>
      <div className="sbp__metaval">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="sbp__field">
      <span className="mono-label sbp__dim">{label}</span>
      {children}
    </label>
  );
}
