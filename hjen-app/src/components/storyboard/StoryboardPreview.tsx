import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useStoryboard, resolveShotSlots } from '../../store/storyboardStore';
import type { StoryboardShot } from '../../types/storyboard';
import { panelId } from '../../types/storyboard';
import { SHOT_SIZES, ANGLES, MOVES, LENSES } from '../../lib/storyboardCamera';

function fileUrl(p?: string): string | undefined { return p ? `hjen-file://${encodeURI(p)}` : undefined; }
function dirOf(p: string): string { const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : p; }
const codeOf = (v?: string) => (v ?? '').split('(')[0].trim().toUpperCase();

/** Dedicated storyboard panel viewer. Shows the panel + its project/model/refs,
 *  lets you edit every §6.1 setting, and Refine re-makes the panel IN PLACE
 *  (updating the storyboard) — it never jumps to the Frame product. Closes via
 *  ×, Esc, or clicking outside. */
export function StoryboardPreview() {
  const data = useStoryboard(s => s.data);
  const previewShotId = useStoryboard(s => s.previewShotId);
  const close = useStoryboard(s => s.closePanel);
  const step = useStoryboard(s => s.stepPanel);
  const updateShot = useStoryboard(s => s.updateShot);
  const patch = useStoryboard(s => s.patch);
  const makeShot = useStoryboard(s => s.makeShot);
  const selectTake = useStoryboard(s => s.selectTake);
  const projectId = useStoryboard(s => s.projectId);
  const projectName = useStore(s => s.projects.find(p => p.id === projectId)?.name) ?? '—';
  const pending = useStoryboard(s => (previewShotId ? (s.pendingTakes[`${s.projectId}::${previewShotId}`] ?? 0) : 0));
  const [zoom, setZoom] = useState<string | null>(null);

  const open = !!previewShotId;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (!typing && e.key === 'ArrowLeft') { step(-1); }
      else if (!typing && e.key === 'ArrowRight') { step(1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close, step]);

  if (!data || !previewShotId) return null;
  const shot = data.shots.find(s => s.id === previewShotId);
  if (!shot) return null;

  const pid = panelId(shot);
  const made = !!shot.generatedImagePath;
  const refs = resolveShotSlots(data, shot);
  const modelLabel = (data.model ?? 'GPT_IMAGE_2') === 'NANO_BANANA_PRO' ? 'Nano Banana Pro' : 'ChatGPT Image 2.0';

  // reference tiles for this shot (face for cast, plate for place/element) + style plate
  const refTiles: Array<{ src?: string; label: string }> = [
    ...refs.characters.map(c => ({ src: c.faceThumbPath ?? c.faceImagePath ?? c.refImagePath, label: c.name })),
    ...refs.places.map(p => ({ src: p.thumbPath ?? p.refImagePath, label: `${p.name} (loc)` })),
    ...refs.elements.map(e => ({ src: e.thumbPath ?? e.refImagePath, label: `${e.name} (el)` })),
  ];
  const stylePlate = data.presetStyleRefs?.[data.presetId ?? 'graphite'] ?? data.styleRefImagePath;
  if (stylePlate) refTiles.push({ src: stylePlate, label: 'board style' });

  const set = (patch: Partial<StoryboardShot>) => updateShot(shot.id, patch);

  return (
    <div className="sbp" onClick={close}>
      <div className="sbp__stage" onClick={e => e.stopPropagation()}>
        {/* image */}
        <div className="sbp__imgwrap">
          {made ? <img className="sbp__img" src={fileUrl(shot.generatedImagePath)} alt={`Panel ${pid}`} />
                : <div className="sbp__empty mono-label">{pending > 0 ? 'making…' : 'not made yet'}</div>}
          <button className="sbp__nav sbp__nav--prev" onClick={() => step(-1)} title="Previous (←)">‹</button>
          <button className="sbp__nav sbp__nav--next" onClick={() => step(1)} title="Next (→)">›</button>
        </div>

        {/* takes — every version (Refine keeps old ones, click to approve) + any in-progress */}
        {((shot.takes?.length ?? 0) > 1 || pending > 0) && (
          <div className="sbp__takes">
            <span className="mono-label sbp__dim">Takes</span>
            {(shot.takes ?? []).map((t, i) => {
              const isCur = t.imgPath === shot.generatedImagePath;
              return (
                <button
                  key={t.imgPath}
                  className={`sbp__take ${isCur ? 'is-current' : ''}`}
                  onClick={() => selectTake(shot.id, t)}
                  title={isCur ? 'Approved take' : 'Use this take'}
                >
                  <img src={fileUrl(t.thumbPath ?? t.imgPath)} alt="" />
                  <span className="sbp__take-n mono-label">v{i + 1}{isCur ? ' ✓' : ''}</span>
                </button>
              );
            })}
            {Array.from({ length: pending }).map((_, i) => (
              <div key={`pending-${i}`} className="sbp__take sbp__take--pending" title="Making a new take…">
                <span className="sb-spinner" />
              </div>
            ))}
          </div>
        )}
        {pending > 0 && <div className="sbp__making-note mono-label">Making {pending} new take{pending > 1 ? 's' : ''}…</div>}
      </div>

      {/* info / edit panel */}
      <aside className="sbp__side" onClick={e => e.stopPropagation()}>
        <header className="sbp__head">
          <h2>Panel {pid}</h2>
          <button className="sb-icon" onClick={close} title="Close (Esc)">×</button>
        </header>

        <div className="sbp__meta">
          <Meta label="Project" value={projectName} />
          <Meta label="Model" value={modelLabel} />
          <Meta label="Aspect" value={data.aspect ?? '16:9'} />
        </div>

        <div className="sbp__refs">
          <div className="mono-label sbp__refs-title">References ({refTiles.length})</div>
          <div className="sbp__refs-grid">
            {refTiles.length === 0 && <span className="mono-label sbp__dim">none attached</span>}
            {refTiles.map((t, i) => (
              <button className="sbp__ref" key={i} title={t.src ? `${t.label} — click to enlarge` : t.label} onClick={() => t.src && setZoom(t.src!)} disabled={!t.src}>
                {t.src ? <img src={fileUrl(t.src)} alt="" /> : <span className="sbp__dim">—</span>}
                <span className="sbp__ref-cap">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* editable §6.1 settings */}
        <div className="sbp__fields">
          <Field label="Description">
            <textarea className="sb-input" rows={2} value={shot.description} onChange={e => set({ description: e.target.value })} />
          </Field>
          <div className="sbp__row2">
            <Field label="Shot">
              <select className="sb-input" value={codeOf(shot.shot)} onChange={e => set({ shot: e.target.value })}>
                <option value="">SHOT</option>
                {SHOT_SIZES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Angle">
              <select className="sb-input" value={codeOf(shot.angle)} onChange={e => set({ angle: e.target.value })}>
                <option value="">ANGLE</option>
                {ANGLES.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="sbp__row2">
            <Field label="Lens">
              <select className="sb-input" value={LENSES.some(l => l.code === shot.lens) ? shot.lens : ''} onChange={e => set({ lens: e.target.value })}>
                <option value="">— lens —</option>
                {LENSES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </Field>
            <Field label="Move">
              <select className="sb-input" value={MOVES.some(m => m.code === shot.move) ? shot.move : ''} onChange={e => set({ move: e.target.value })}>
                <option value="">— move —</option>
                {MOVES.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="sbp__row2">
            <Field label="Duration"><input className="sb-input" value={shot.duration ?? ''} onChange={e => set({ duration: e.target.value })} placeholder="2.5s" /></Field>
            <Field label="Dialogue"><input className="sb-input" value={shot.dialogue ?? ''} onChange={e => set({ dialogue: e.target.value })} placeholder="≤12 words" /></Field>
          </div>
          <Field label="Light"><input className="sb-input" value={shot.light ?? ''} onChange={e => set({ light: e.target.value })} placeholder="key + ambient + event-light" /></Field>
          <Field label="Frame furn."><input className="sb-input" value={shot.frameFurniture ?? ''} onChange={e => set({ frameFurniture: e.target.value })} placeholder="FG / MG / BG + cultural-truth object" /></Field>
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

        {shot.status === 'failed' && shot.error && <div className="sb-panel__err">{shot.error}</div>}

        <footer className="sbp__foot">
          {/* Generate another take any time — each run keeps the previous as a take. */}
          <button className="btn-primary" onClick={() => makeShot(shot.id)}>
            {pending > 0 ? `MADE −${pending}` : made ? 'Refine' : 'Make'}
          </button>
          {made && <button className="sb-btn" onClick={() => window.hjen.openFolder(dirOf(shot.generatedImagePath!)).catch(() => {})}>Reveal</button>}
          <button className="sb-btn" onClick={close}>Close</button>
        </footer>
      </aside>

      {/* reference zoom — click anywhere to dismiss */}
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
