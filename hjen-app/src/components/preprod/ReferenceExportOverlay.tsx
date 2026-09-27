// Reference export — take the set off the screen.
//
// One sheet, two exits, either or both: a PDF of the board (three layouts) and
// a folder of the frames copied VERBATIM — a GIF leaves as a GIF. The PDF is a
// flattening (motion becomes its first frame); the folder is the original.
// Scope defaults to the selection when there is one, the whole set otherwise.

import { useMemo, useState } from 'react';
import { hjenFileUrl } from '../../lib/theme/apply';
import { Busy } from './shared';
import { REF_PDF_LAYOUTS, refLayoutById, type RefPdfLayout } from '../../lib/referencesExport';
import type { HuntedRef } from '../../types/preprod';

export interface RefExportConfig {
  refs: HuntedRef[];
  wantPdf: boolean;
  wantFiles: boolean;
  wantNotes: boolean;
  layout: RefPdfLayout;
  baseName: string;
}

const isMotion = (p: string) => /\.(gif|webp|mp4|webm|mov)$/i.test(p || '');

export function ReferenceExportOverlay({ refs, selectedIds, defaultName, exporting, onClose, onExport }: {
  refs: HuntedRef[];
  selectedIds: string[];
  defaultName: string;
  exporting: boolean;
  onClose: () => void;
  onExport: (cfg: RefExportConfig) => void;
}) {
  const hasSelection = selectedIds.length > 0;
  const [scope, setScope] = useState<'selected' | 'all'>(hasSelection ? 'selected' : 'all');
  const [wantPdf, setWantPdf] = useState(true);
  const [wantFiles, setWantFiles] = useState(true);
  const [wantNotes, setWantNotes] = useState(true);
  const [layout, setLayout] = useState<RefPdfLayout>('board');
  const [baseName, setBaseName] = useState(defaultName);

  const chosen = useMemo(() => {
    if (scope === 'all' || !hasSelection) return refs;
    const keep = new Set(selectedIds);
    return refs.filter(r => keep.has(r.id));
  }, [refs, selectedIds, scope, hasSelection]);

  const motionCount = chosen.filter(r => isMotion(r.imagePath)).length;
  const noLeave = chosen.filter(r => !(r.leave || '').trim()).length;
  const spec = refLayoutById(layout);
  const pdfPages = layout === 'notes' ? chosen.length + 1 : Math.ceil(chosen.length / (spec.cols * spec.rows)) + 1;
  // the notes sheet can leave on its own — it's the PPM paper trail, not a garnish
  const nothingChosen = !wantPdf && !wantFiles && !wantNotes;
  const name = baseName.trim() || defaultName;

  return (
    <div className="modal-backdrop" onClick={exporting ? undefined : onClose}>
      <div className="modal ppre" style={{ width: 'min(900px, 100%)' }} onClick={e => e.stopPropagation()}>
        <header className="modal__header">
          <span className="mono-label">Export the reference set</span>
          <span className="ppre__sub">A PDF of the board, a folder of the frames, or both.</span>
          <button className="modal__close" disabled={exporting} onClick={onClose}>Close</button>
        </header>

        <div className="modal__body ppre__body">
          {/* ── scope ── */}
          <section className="ppre__row">
            <div className="ppre__label mono-label">FRAMES</div>
            <div className="ppre__seg">
              <button
                className={`ppre__segopt${scope === 'selected' ? ' is-on' : ''}`}
                disabled={!hasSelection}
                title={hasSelection ? 'Only the frames checked on the board' : 'Nothing is selected on the board'}
                onClick={() => setScope('selected')}
              >Selected {hasSelection ? selectedIds.length : ''}</button>
              <button
                className={`ppre__segopt${scope === 'all' ? ' is-on' : ''}`}
                onClick={() => setScope('all')}
              >Whole set {refs.length}</button>
            </div>
          </section>

          {/* ── what leaves ── */}
          <section className="ppre__row">
            <div className="ppre__label mono-label">EXPORT</div>
            <div className="ppre__picks">
              <label className={`ppre__pick${wantPdf ? ' is-on' : ''}`}>
                <input type="checkbox" checked={wantPdf} onChange={e => setWantPdf(e.target.checked)} />
                <span className="ppre__pick__t">PDF</span>
                <span className="ppre__pick__s">{pdfPages} page{pdfPages === 1 ? '' : 's'} · cover + board</span>
              </label>
              <label className={`ppre__pick${wantFiles ? ' is-on' : ''}`}>
                <input type="checkbox" checked={wantFiles} onChange={e => setWantFiles(e.target.checked)} />
                <span className="ppre__pick__t">Image files</span>
                <span className="ppre__pick__s">{chosen.length} file{chosen.length === 1 ? '' : 's'}, copied as they are</span>
              </label>
              <label className={`ppre__pick${wantNotes ? ' is-on' : ''}`}>
                <input type="checkbox" checked={wantNotes} onChange={e => setWantNotes(e.target.checked)} />
                <span className="ppre__pick__t">Notes sheet</span>
                <span className="ppre__pick__s">CSV — query · Why · Take · Leave</span>
              </label>
            </div>
          </section>

          {/* ── pdf layout ── */}
          {wantPdf && (
            <section className="ppre__row">
              <div className="ppre__label mono-label">PDF LAYOUT</div>
              <div className="ppre__layouts">
                {REF_PDF_LAYOUTS.map(l => (
                  <button
                    key={l.id}
                    className={`ppre__layout${layout === l.id ? ' is-on' : ''}`}
                    onClick={() => setLayout(l.id)}
                    title={l.note}
                  >
                    <LayoutPreview cols={l.cols} rows={l.rows} notes={l.id !== 'board'} />
                    <span className="ppre__layout__t">{l.label}</span>
                    <span className="ppre__layout__s">{l.note}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ── name ── */}
          <section className="ppre__row">
            <div className="ppre__label mono-label">NAME</div>
            <div className="ppre__namewrap">
              <input
                className="pp-input"
                value={baseName}
                spellCheck={false}
                placeholder={defaultName}
                onChange={e => setBaseName(e.target.value)}
              />
              <div className="ppre__tree mono-label">
                {wantFiles ? (
                  <>
                    <span>{name}/</span>
                    <span className="ppre__treeline">├ 01_…, 02_… — {chosen.length} frame{chosen.length === 1 ? '' : 's'}</span>
                    {wantPdf && <span className="ppre__treeline">├ {name}.pdf</span>}
                    {wantNotes && <span className="ppre__treeline">└ {name}_notes.csv</span>}
                  </>
                ) : (
                  <>
                    {wantPdf && <span className="ppre__treeline">{name}.pdf</span>}
                    {wantNotes && <span className="ppre__treeline">{name}_notes.csv</span>}
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ── the honest lines ── */}
          <div className="ppre__notes">
            {motionCount > 0 && (
              <div className="ppre__note">
                {motionCount} moving frame{motionCount === 1 ? '' : 's'} in this set — the folder keeps them whole; the PDF prints the first frame.
              </div>
            )}
            {noLeave > 0 && (
              <div className="ppre__note ppre__note--warn">
                {noLeave} frame{noLeave === 1 ? '' : 's'} with no Leave line — it exports marked as missing, not hidden.
              </div>
            )}
          </div>

          {/* ── what's leaving, small ── */}
          {chosen.length > 0 && (
            <div className="ppre__strip">
              {chosen.slice(0, 24).map(r => (
                <span key={r.id} className="ppre__thumb" title={r.tag}>
                  <img src={hjenFileUrl(r.imagePath)} alt="" loading="lazy" decoding="async" />
                  {isMotion(r.imagePath) && <span className="ppre__thumb__mo mono-label">MO</span>}
                </span>
              ))}
              {chosen.length > 24 && <span className="ppre__more mono-label">+{chosen.length - 24}</span>}
            </div>
          )}
        </div>

        <footer className="ppre__foot">
          <span className="mono-label ppre__count">
            {chosen.length} frame{chosen.length === 1 ? '' : 's'} leaving
          </span>
          <span className="ppre__spacer" />
          <button className="pp-btn pp-btn--ghost" disabled={exporting} onClick={onClose}>Cancel</button>
          <button
            className="pp-btn pp-btn--accent"
            disabled={exporting || chosen.length === 0 || nothingChosen}
            title={nothingChosen ? 'Choose a PDF, image files, or both.' : undefined}
            onClick={() => onExport({ refs: chosen, wantPdf, wantFiles, wantNotes, layout, baseName: name })}
          >{exporting ? <Busy label="Exporting…" /> : 'Choose folder + export'}</button>
        </footer>
      </div>
    </div>
  );
}

/** The layout, drawn — the same reference-image idea the storyboard export uses. */
function LayoutPreview({ cols, rows, notes }: { cols: number; rows: number; notes: boolean }) {
  const W = 92, H = 62, pad = 5, gap = 3;
  const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
  const ch = (H - pad * 2 - gap * (rows - 1)) / rows;
  const capH = notes ? Math.min(rows === 1 ? 0 : 7, ch * 0.3) : 0;
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = pad + c * (cw + gap), y = pad + r * (ch + gap);
    const imgW = rows === 1 && cols === 1 ? cw * 0.6 : cw;
    cells.push(
      <g key={`${r}-${c}`}>
        <rect x={x} y={y} width={imgW} height={ch - capH} rx={1.5} fill="currentColor" opacity={0.5} />
        {capH > 0 && <rect x={x} y={y + ch - capH + 1} width={cw * 0.8} height={capH - 2} rx={1} fill="currentColor" opacity={0.22} />}
        {rows === 1 && cols === 1 && (
          <g fill="currentColor" opacity={0.22}>
            <rect x={x + imgW + 5} y={y + 2} width={cw - imgW - 8} height={4} rx={1} />
            <rect x={x + imgW + 5} y={y + 11} width={cw - imgW - 14} height={3} rx={1} />
            <rect x={x + imgW + 5} y={y + 18} width={cw - imgW - 8} height={3} rx={1} />
            <rect x={x + imgW + 5} y={y + 25} width={cw - imgW - 20} height={3} rx={1} />
          </g>
        )}
      </g>,
    );
  }
  return (
    <svg className="ppre__layout__svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={3} fill="none" stroke="currentColor" strokeOpacity={0.28} />
      {cells}
    </svg>
  );
}
