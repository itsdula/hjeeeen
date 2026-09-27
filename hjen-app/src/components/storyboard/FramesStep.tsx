import { useState } from 'react';
import { useStoryboard } from '../../store/storyboardStore';
import type { StoryboardShot, StoryboardRefSlot, SbModel, SbQuality } from '../../types/storyboard';
import { panelId } from '../../types/storyboard';
import { resolvePreset } from '../../lib/storyboardPresets';
import { acceptsRefs } from '../../lib/models';
import { BoardLookPicker } from './BoardLookPicker';

function fileUrl(p?: string): string | undefined { return p ? `hjen-file://${encodeURI(p)}` : undefined; }
function dirOf(p: string): string { const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : p; }

// Reference capability is read from the registry, never restated here — it was
// hardcoded `refs: false` for Nano Banana Pro back when that entry pointed at a
// text-only Imagen endpoint, and would have stayed wrong after the repoint.
const MODELS: ReadonlyArray<{ id: SbModel; label: string; refs: boolean }> = [
  { id: 'GPT_IMAGE_2', label: 'ChatGPT Image 2', refs: acceptsRefs('GPT_IMAGE_2') },
  { id: 'NANO_BANANA_PRO', label: 'Nano Banana Pro', refs: acceptsRefs('NANO_BANANA_PRO') },
];
const QUALITIES: ReadonlyArray<{ id: SbQuality; label: string }> = [
  { id: 'LOW', label: 'Draft' }, { id: 'MED', label: 'Standard' }, { id: 'HIGH', label: 'High' },
];
const ASPECTS = ['16:9', '4:3', '1:1', '2.39:1', '9:16'];

export function FramesStep() {
  const data = useStoryboard(s => s.data);
  const projectId = useStoryboard(s => s.projectId);
  const patch = useStoryboard(s => s.patch);
  const boardLooks = useStoryboard(s => s.boardLooks);
  const makingAll = useStoryboard(s => !!projectId && s.makingAllIds.includes(projectId));
  const makingAssets = useStoryboard(s => !!projectId && s.makingAssetIds.includes(projectId));
  const pendingTakes = useStoryboard(s => s.pendingTakes);
  const makeShot = useStoryboard(s => s.makeShot);
  const makeAll = useStoryboard(s => s.makeAll);
  const makeAssets = useStoryboard(s => s.makeAssets);
  const stopMaking = useStoryboard(s => s.stopMaking);
  const setStep = useStoryboard(s => s.setStep);
  const reorderByDrag = useStoryboard(s => s.reorderByDrag);
  const openPanel = useStoryboard(s => s.openPanel);
  const [dragId, setDragId] = useState<string | null>(null);

  if (!data) return null;
  const isPending = (id: string) => (pendingTakes[`${projectId}::${id}`] ?? 0) > 0;

  const made = data.shots.filter(s => s.generatedImagePath).length;
  const total = data.shots.length;
  const remaining = data.shots.filter(s => !s.generatedImagePath || s.status === 'failed').length;
  const preset = resolvePreset(data.presetId, boardLooks);
  const model = MODELS.find(m => m.id === (data.model ?? 'GPT_IMAGE_2'))!;

  const assetSlots = [...data.characters, ...data.places, ...data.elements];
  const assetsMade = assetSlots.filter(s => s.assetStatus === 'made').length;

  const openFrame = (shot: StoryboardShot) => {
    if (shot.generatedImagePath) openPanel(shot.id);
  };

  return (
    <div className="sb-step sb-frames">
      {/* ── make settings ── */}
      <div className="sb-settings">
        <div className="sb-settings__row">
          <div className="sb-set">
            <span className="mono-label">Board look</span>
            <BoardLookPicker />
          </div>
          <label className="sb-set">
            <span className="mono-label">Model</span>
            <select className="sb-select" value={data.model ?? 'GPT_IMAGE_2'} onChange={e => patch({ model: e.target.value as SbModel })}>
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className="sb-set">
            <span className="mono-label">Quality</span>
            <select className="sb-select" value={data.quality ?? 'HIGH'} onChange={e => patch({ quality: e.target.value as SbQuality })}>
              {QUALITIES.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
            </select>
          </label>
          <label className="sb-set">
            <span className="mono-label">Aspect</span>
            <select className="sb-select" value={data.aspect ?? '16:9'} onChange={e => patch({ aspect: e.target.value })}>
              {ASPECTS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>
        <div className="sb-settings__note">
          {preset.note}
          {!model.refs && <span className="sb-warn"> · Nano Banana is text-only — references (assets) won’t apply. Use ChatGPT Image 2 for consistency.</span>}
        </div>
      </div>

      {/* ── assets (made from the breakdown) ── */}
      <section className="sb-assets">
        <div className="sb-toolbar">
          <h3 className="sb-assets__title">Assets <span className="mono-label">{assetsMade}/{assetSlots.length} made</span></h3>
          {makingAssets ? (
            <button className="sb-btn sb-btn--stop" onClick={stopMaking}>Stop</button>
          ) : (
            <button className="sb-btn" onClick={makeAssets} disabled={assetSlots.length === 0 || makingAll}>
              {assetsMade > 0 ? 'Make missing assets' : 'Make assets'}
            </button>
          )}
          <span className="sb-note">Faces + sheets, then places, then continuity elements — locked refs for every panel.</span>
        </div>
        {assetSlots.length === 0 ? (
          <div className="sb-empty sb-empty--sm">No cast / places / elements. Add them in Breakdown.</div>
        ) : (
          <div className="sb-asset-grid">
            {data.characters.map(c => <AssetTile key={c.id} kind="characters" slot={c} pending={isPending(c.id)} />)}
            {data.places.map(p => <AssetTile key={p.id} kind="places" slot={p} pending={isPending(p.id)} />)}
            {data.elements.map(el => <AssetTile key={el.id} kind="elements" slot={el} pending={isPending(el.id)} />)}
          </div>
        )}
      </section>

      {/* ── panels ── */}
      <div className="sb-toolbar">
        {makingAll ? (
          <button className="btn-primary sb-btn--stop" onClick={stopMaking}>Stop making</button>
        ) : (
          <button className="btn-primary" onClick={makeAll} disabled={total === 0 || makingAssets || remaining === 0}>
            {made > 0 ? `Make the rest (${remaining})` : 'Make all panels'}
          </button>
        )}
        <button className="sb-btn" onClick={() => setStep(4)} disabled={made === 0}>Continue to Export →</button>
        <span className="sb-note">Drag panels to reorder — it carries into the export + PDF.</span>
        <div className="sb-toolbar__spacer" />
        <span className="mono-label">{made}/{total} made</span>
      </div>

      {total === 0 ? (
        <div className="sb-empty">No shots to make. Go back to Breakdown.</div>
      ) : (
        <div className="sb-panels">
          {data.shots.map(shot => (
            <PanelTile
              key={shot.id}
              shot={shot}
              pending={isPending(shot.id)}
              onMake={() => makeShot(shot.id)}
              onOpen={() => openFrame(shot)}
              busy={makingAll || makingAssets}
              dragging={dragId === shot.id}
              onDragStart={() => setDragId(shot.id)}
              onDragEnd={() => setDragId(null)}
              onDropOn={() => { if (dragId) reorderByDrag(dragId, shot.id); setDragId(null); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── asset tile ───────────────────────────────────────────────────
function AssetTile({ kind, slot, pending }: { kind: 'characters' | 'places' | 'elements'; slot: StoryboardRefSlot; pending: boolean }) {
  const makeAsset = useStoryboard(s => s.makeAsset);
  const openAsset = useStoryboard(s => s.openAsset);
  const making = slot.assetStatus === 'making' || pending;
  const failed = slot.assetStatus === 'failed';
  const isChar = kind === 'characters';
  const primary = isChar ? (slot.faceImagePath ?? slot.refImagePath) : slot.refImagePath;
  const open = () => openAsset(kind, slot.id);

  return (
    <div className={`sb-asset ${making ? 'is-making' : ''} ${failed ? 'is-failed' : ''}`}>
      <div className="sb-asset__thumbs">
        <AssetThumb src={primary} making={making} onOpen={open} />
        {isChar && <AssetThumb src={slot.sheetImagePath} making={making} small onOpen={open} />}
      </div>
      <div className="sb-asset__body">
        <button className="sb-asset__name sb-asset__name--btn" onClick={open}>{slot.name || (isChar ? 'character' : kind === 'places' ? 'place' : 'element')}</button>
        <div className="sb-asset__kind mono-label">{isChar ? 'face + sheet' : kind === 'places' ? 'location' : 'element'}</div>
        {failed && slot.assetError && <div className="sb-panel__err">{slot.assetError}</div>}
        <button className="sb-btn sb-btn--sm" onClick={() => makeAsset(kind, slot.id)} disabled={making}>
          {slot.assetStatus === 'made' ? 'Refine' : 'Make'}
        </button>
      </div>
    </div>
  );
}

function AssetThumb({ src, making, small, onOpen }: { src?: string; making: boolean; small?: boolean; onOpen?: () => void }) {
  return (
    <button
      type="button"
      className={`sb-asset__thumb ${small ? 'sb-asset__thumb--sm' : ''}`}
      onClick={src ? onOpen : undefined}
      disabled={!src}
      title={src ? 'Open larger' : undefined}
    >
      {src ? <img src={fileUrl(src)} alt="" loading="lazy" /> : <span className="sb-asset__ph">{making ? <Spinner /> : '—'}</span>}
      {src && making && <span className="sb-asset__overlay"><Spinner /></span>}
    </button>
  );
}

// ─── panel tile ───────────────────────────────────────────────────
function PanelTile({ shot, pending, onMake, onOpen, busy, dragging, onDragStart, onDragEnd, onDropOn }: {
  shot: StoryboardShot; pending: boolean; onMake: () => void; onOpen: () => void; busy: boolean;
  dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onDropOn: () => void;
}) {
  const pid = panelId(shot);
  const making = shot.status === 'making' || pending;
  const failed = shot.status === 'failed';
  const made = !!shot.generatedImagePath;

  const reveal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (shot.generatedImagePath) window.hjen.openFolder(dirOf(shot.generatedImagePath)).catch(() => {});
  };

  return (
    <div
      className={`sb-panel ${making ? 'is-making' : ''} ${failed ? 'is-failed' : ''} ${dragging ? 'is-dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); onDropOn(); }}
    >
      <button className="sb-panel__frame" onClick={made ? onOpen : undefined} disabled={!made} title={made ? 'Open larger' : undefined}>
        {made ? (
          <img className="sb-panel__img" src={fileUrl(shot.generatedImagePath)} alt={`Panel ${pid}`} loading="lazy" />
        ) : (
          <div className="sb-panel__placeholder">{making ? <Spinner label="making" /> : <span className="mono-label">{pid}</span>}</div>
        )}
        {made && making && <span className="sb-panel__overlay"><Spinner /></span>}
        <span className="sb-panel__id mono-label">{pid}{shot.shot ? ` · ${shot.shot}` : ''}</span>
      </button>
      <div className="sb-panel__body">
        <div className="sb-panel__desc">{shot.description || '—'}</div>
        {failed && shot.error && <div className="sb-panel__err">{shot.error}</div>}
        <div className="sb-panel__actions">
          <button className="sb-btn sb-btn--sm" onClick={onMake} disabled={making || busy}>{made ? 'Refine' : 'Make'}</button>
          {made && <button className="sb-btn sb-btn--sm" onClick={reveal} title="Reveal in Finder">Reveal</button>}
        </div>
      </div>
    </div>
  );
}

function Spinner({ label }: { label?: string }) {
  return (
    <span className="sb-spinner-wrap">
      <span className="sb-spinner" aria-hidden />
      {label && <span className="sb-spinner__label mono-label">{label}</span>}
    </span>
  );
}

