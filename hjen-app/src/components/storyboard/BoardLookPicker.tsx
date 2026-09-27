import { useEffect, useState } from 'react';
import { useStoryboard } from '../../store/storyboardStore';
import { STORYBOARD_PRESETS, resolvePreset, isCustomLookId } from '../../lib/storyboardPresets';
import { describeReference } from '../../lib/storyboardLlm';
import { LOOK_SAMPLES } from '../../lib/storyboardLookSamples';
import type { CustomBoard } from '../../types/storyboard';

function fileUrl(p?: string): string | undefined { return p ? `hjen-file://${encodeURI(p)}` : undefined; }
async function pickImages(): Promise<string[]> {
  const files = await window.hjen.pickImageFiles();
  return files && files.length ? files : [];
}

/** Visual Board-Look picker. The ten bundled presets ship with an example so the
 *  client sees the look immediately — select-only. After them, the user's OWN
 *  boards, which live in a GLOBAL library shared across every project: a look
 *  added here shows up in all projects. Each board holds one OR MORE references,
 *  an editable name + description (auto-fillable via "Describe"), and a sample.
 *  An "Add board" card appends another. Closes via ×, Escape, or click-outside. */
export function BoardLookPicker() {
  const data = useStoryboard(s => s.data);
  const patch = useStoryboard(s => s.patch);
  const boardLooks = useStoryboard(s => s.boardLooks);
  const addBoardLook = useStoryboard(s => s.addBoardLook);
  const [open, setOpen] = useState(false);

  // Escape closes (standing rule for every modal).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!data) return null;

  const cur = resolvePreset(data.presetId, boardLooks);
  const customSelected = isCustomLookId(data.presetId);

  // Display priority: user upload → made sample → bundled example.
  const displaySrc = (id: string): string | undefined =>
    fileUrl(data.presetStyleRefs?.[id]) ?? fileUrl(data.presetSamples?.[id]) ?? LOOK_SAMPLES[id];
  const boardSrc = (b: CustomBoard): string | undefined =>
    fileUrl(b.refs?.[0]) ?? fileUrl(data.presetSamples?.[b.id]);
  const curSrc = customSelected
    ? boardSrc(boardLooks.find(b => b.id === data.presetId) ?? { id: data.presetId! })
    : displaySrc(cur.id);

  const addBoard = () => { const id = addBoardLook(); patch({ presetId: id }); };

  return (
    <div className="sb-look">
      <button className="sb-look__current" onClick={() => setOpen(true)} title="Choose the board look">
        <span className="sb-look__chip">{curSrc ? <img src={curSrc} alt="" /> : <span className="sb-look__chip-ph">—</span>}</span>
        <span className="sb-look__label">{cur.label}</span>
        <span className="sb-look__caret">▾</span>
      </button>

      {open && (
        <div className="sb-look-modal" onClick={() => setOpen(false)}>
          <div className="sb-look-modal__panel" onClick={e => e.stopPropagation()}>
            <header className="sb-look-modal__head">
              <div>
                <h3>Board look</h3>
                <p className="sb-note">Pick a drawing medium — or build your own. Your boards are shared across every project.</p>
              </div>
              <button type="button" className="sb-icon" onClick={() => setOpen(false)} title="Close (Esc)">×</button>
            </header>

            <div className="sb-look-grid">
              {STORYBOARD_PRESETS.map(p => {
                const selected = !customSelected && p.id === cur.id;
                return (
                  <div key={p.id} className={`sb-look-card ${selected ? 'is-selected' : ''}`}>
                    <button
                      className="sb-look-card__preview"
                      onClick={() => { patch({ presetId: p.id }); setOpen(false); }}
                      title={`Use ${p.label}`}
                    >
                      <img src={displaySrc(p.id)} alt="" loading="lazy" />
                      {selected && <span className="sb-look-card__tick">✓</span>}
                    </button>
                    <div className="sb-look-card__meta">
                      <div className="sb-look-card__name">{p.label}</div>
                      <div className="sb-look-card__note">{p.note}</div>
                    </div>
                  </div>
                );
              })}

              {/* ── the user's own (global) boards ── */}
              {boardLooks.map(b => (
                <CustomBoardCard key={b.id} board={b} selected={data.presetId === b.id} onUse={() => setOpen(false)} />
              ))}

              {/* ── add another board ── */}
              <button className="sb-look-card sb-look-card--add" onClick={addBoard} title="Add a custom board">
                <span className="sb-look-card__addinner mono-label">＋<br />Add board</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── one custom board card (operates on the GLOBAL library) ────────
function CustomBoardCard({ board, selected, onUse }: { board: CustomBoard; selected: boolean; onUse: () => void }) {
  const data = useStoryboard(s => s.data)!;
  const patch = useStoryboard(s => s.patch);
  const updateBoardLook = useStoryboard(s => s.updateBoardLook);
  const removeBoardLook = useStoryboard(s => s.removeBoardLook);
  const makePresetSample = useStoryboard(s => s.makePresetSample);
  const making = useStoryboard(s => s.makingPreviewIds.includes(board.id));
  const [describing, setDescribing] = useState(false);
  const [descErr, setDescErr] = useState<string | null>(null);

  const refs = board.refs ?? [];
  const sample = fileUrl(data.presetSamples?.[board.id]);
  const src = fileUrl(refs[0]) ?? sample;

  const select = () => patch({ presetId: board.id });
  const upload = async () => {
    const picked = await pickImages();
    if (picked.length) { select(); updateBoardLook(board.id, { refs: [...refs, ...picked] }); }
  };
  const removeRef = (p: string) => updateBoardLook(board.id, { refs: refs.filter(x => x !== p) });
  const makeOne = () => { select(); makePresetSample(board.id); };
  const describe = async () => {
    if (!refs[0]) return;
    setDescribing(true); setDescErr(null);
    const res = await describeReference(refs[0]);
    setDescribing(false);
    if (res.ok) updateBoardLook(board.id, { note: res.note });
    else setDescErr(res.message);
  };

  return (
    <div className={`sb-look-card sb-look-card--custom ${selected ? 'is-selected' : ''}`}>
      <button
        className="sb-look-card__preview"
        onClick={src ? () => { select(); onUse(); } : upload}
        title={src ? 'Use this board' : 'Upload a reference'}
      >
        {src ? <img src={src} alt="" loading="lazy" /> : <span className="sb-look-card__empty mono-label">+ your look</span>}
        {selected && <span className="sb-look-card__tick">✓</span>}
        {refs.length > 0 && <span className="sb-look-card__badge mono-label">{refs.length} ref{refs.length > 1 ? 's' : ''}</span>}
        {making && (
          <span className="sb-look-card__spinner">
            <span className="sb-spinner" aria-hidden />
            <span className="mono-label">making…</span>
          </span>
        )}
      </button>
      <div className="sb-look-card__meta">
        <input
          className="sb-input sb-input--sm sb-input--name"
          placeholder="Board name…"
          value={board.name ?? ''}
          onChange={e => updateBoardLook(board.id, { name: e.target.value })}
        />
        <input
          className="sb-input sb-input--sm"
          placeholder="Describe your look (optional)…"
          value={board.note ?? ''}
          onChange={e => updateBoardLook(board.id, { note: e.target.value })}
        />
        {refs.length > 0 && (
          <div className="sb-look-refs">
            {refs.map(p => (
              <span key={p} className="sb-look-ref">
                <img src={fileUrl(p)} alt="" loading="lazy" />
                <button className="sb-look-ref__x" onClick={() => removeRef(p)} title="Remove reference">×</button>
              </span>
            ))}
          </div>
        )}
        {descErr && <div className="sb-panel__err">{descErr}</div>}
        <div className="sb-look-card__actions">
          <button className="sb-btn sb-btn--sm" onClick={upload}>{refs.length ? 'Add ref' : 'Upload'}</button>
          {refs.length > 0 && (
            <button className="sb-btn sb-btn--sm" onClick={describe} disabled={describing} title="Auto-describe the reference">
              {describing ? 'Describing…' : 'Describe'}
            </button>
          )}
          <button className="sb-btn sb-btn--sm" onClick={makeOne} disabled={making}>{making ? 'Making…' : 'Made'}</button>
          <button className="sb-look-card__del mono-label" onClick={() => removeBoardLook(board.id)} title="Delete this board">delete</button>
        </div>
      </div>
    </div>
  );
}
