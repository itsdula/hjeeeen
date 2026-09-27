import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { useStoryboard } from '../../store/storyboardStore';
import { panelId } from '../../types/storyboard';
import { buildStoryboardPdf, assetExportFiles } from '../../lib/storyboardPdf';
import { PDF_TEMPLATES, pdfTemplateById, type PdfTemplate } from '../../lib/storyboardPdfTemplates';

function fileUrl(p?: string): string | undefined { return p ? `hjen-file://${encodeURI(p)}` : undefined; }

/** Step 4 — choose template, pick which panels (and whether to append the
 *  reference assets), then pack the panels + formatted PDF into a folder. */
export function ExportStep() {
  const data = useStoryboard(s => s.data);
  const patch = useStoryboard(s => s.patch);
  const setStep = useStoryboard(s => s.setStep);
  const projectId = useStoryboard(s => s.projectId);
  const project = useStore(s => s.projects.find(p => p.id === projectId));
  const projectName = project?.name ?? 'Storyboard';
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const made = useMemo(() => (data ? data.shots.filter(s => s.generatedImagePath) : []), [data]);
  // Selection — default everything made. Keyed by shot id.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(made.map(s => s.id)));
  // File name — default: <project>_storyboard_<today>, editable.
  const [fileName, setFileName] = useState(() => `${projectName}_storyboard_${new Date().toISOString().slice(0, 10)}`);

  if (!data) return null;

  const templateId = data.exportTemplateId ?? 'classic6';
  const includeAssets = data.exportIncludeAssets ?? false;
  const selCount = made.filter(s => selected.has(s.id)).length;
  const allOn = selCount === made.length && made.length > 0;

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected(new Set(made.map(s => s.id)));
  const selectNone = () => setSelected(new Set());

  const handleExport = async () => {
    setMsg(null);
    const orderedSel = made.filter(s => selected.has(s.id));
    if (orderedSel.length === 0) { setMsg('Select at least one panel.'); return; }
    const folder = await window.hjen.pickExportFolder({ projectSlug: project?.slug });
    if (!folder) return;
    setExporting(true);
    try {
      const pdfBytes = await buildStoryboardPdf(data, {
        projectName: project?.name ?? 'Storyboard',
        selectedIds: orderedSel.map(s => s.id),
        includeAssets,
        templateId,
      });
      const panels = orderedSel.map((s, i) => ({ srcPath: s.generatedImagePath!, fileName: `${String(i + 1).padStart(2, '0')}_panel_${panelId(s)}.png` }));
      if (includeAssets) panels.push(...assetExportFiles(data));
      const res = await window.hjen.exportStoryboard({ folder, pdfBase64: bytesToBase64(pdfBytes), panels, fileName: fileName.trim() });
      if (res.ok) { setMsg(`Exported ${res.written ?? panels.length} files + storyboard.pdf.`); window.hjen.openFolder(folder).catch(() => {}); }
      else setMsg(res.reason || 'Export failed.');
    } catch (err: any) {
      setMsg(String(err?.message || err).slice(0, 200));
    } finally { setExporting(false); }
  };

  return (
    <div className="sb-step sb-export">
      {/* template picker */}
      <div className="sb-field">
        <div className="sb-field__head"><label className="sb-field__label mono-label">PDF template</label>
          <span className="sb-field__hint">{pdfTemplateById(templateId).note}</span></div>
        <div className="sb-tpl-grid">
          {PDF_TEMPLATES.map(t => (
            <button
              key={t.id}
              className={`sb-tpl ${t.id === templateId ? 'is-selected' : ''}`}
              onClick={() => patch({ exportTemplateId: t.id })}
              title={t.note}
            >
              <TemplatePreview t={t} />
              <span className="sb-tpl__name">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* file name */}
      <div className="sb-field">
        <div className="sb-field__head"><label className="sb-field__label mono-label">File name</label>
          <span className="sb-field__hint">Saves as <strong>{(fileName.trim() || 'storyboard')}.pdf</strong> + a <strong>{(fileName.trim() || 'storyboard')}_panels</strong> folder.</span></div>
        <input
          className="sb-input"
          value={fileName}
          onChange={e => setFileName(e.target.value)}
          placeholder={`${projectName}_storyboard_${new Date().toISOString().slice(0, 10)}`}
          spellCheck={false}
        />
      </div>

      {/* toolbar */}
      <div className="sb-toolbar">
        <button className="btn-primary" onClick={handleExport} disabled={exporting || selCount === 0}>
          {exporting ? 'Exporting…' : `Export ${selCount} panel${selCount === 1 ? '' : 's'} + PDF`}
        </button>
        <button className="sb-btn" onClick={allOn ? selectNone : selectAll}>{allOn ? 'Select none' : 'Select all'}</button>
        <label className="sb-check">
          <input type="checkbox" checked={includeAssets} onChange={e => patch({ exportIncludeAssets: e.target.checked })} />
          <span>Include assets at the end</span>
        </label>
        <button className="sb-btn" onClick={() => setStep(3)}>‹ Back to storyboard</button>
        {msg && <span className="sb-note">{msg}</span>}
        <div className="sb-toolbar__spacer" />
        <span className="mono-label">{selCount}/{made.length} selected</span>
      </div>

      {made.length === 0 ? (
        <div className="sb-empty">No made panels yet. Go back and make the storyboard first.</div>
      ) : (
        <ol className="sb-export-strip">
          {made.map((s, i) => {
            const on = selected.has(s.id);
            return (
              <li key={s.id} className={`sb-export-cell ${on ? 'is-on' : 'is-off'}`} onClick={() => toggle(s.id)}>
                <span className="sb-export-cell__n mono-label">{String(i + 1).padStart(2, '0')}</span>
                <span className={`sb-export-cell__check ${on ? 'is-on' : ''}`}>{on ? '✓' : ''}</span>
                <img src={fileUrl(s.generatedImagePath)} alt={`Panel ${panelId(s)}`} loading="lazy" />
                <span className="sb-export-cell__id mono-label">{panelId(s)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Small SVG diagram of a template's layout — the "reference image". */
function TemplatePreview({ t }: { t: PdfTemplate }) {
  const W = 96, H = 68, pad = 6, gap = 4;
  const cw = (W - pad * 2 - gap * (t.cols - 1)) / t.cols;
  const ch = (H - pad * 2 - gap * (t.rows - 1)) / t.rows;
  const cells = [];
  for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) {
    const x = pad + c * (cw + gap), y = pad + r * (ch + gap);
    // a caption bar inside each cell for frame/tech modes
    const capH = t.caption === 'none' ? 0 : t.caption === 'tech' ? Math.min(6, ch * 0.22) : Math.min(5, ch * 0.18);
    cells.push(
      <g key={`${r}-${c}`}>
        <rect x={x} y={y} width={cw} height={ch} rx={2} fill="#2a2a2a" stroke="#5a5a5a" strokeWidth={1} />
        <rect x={x + 2} y={y + 2} width={cw - 4} height={ch - capH - 4} rx={1.5} fill="#666" />
        {capH > 0 && <rect x={x + 2} y={y + ch - capH - 1} width={cw - 4} height={capH} rx={1} fill="#8a8a8a" />}
      </g>,
    );
  }
  return (
    <svg className="sb-tpl__svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={4} fill="#1a1a1a" stroke="#3a3a3a" />
      {cells}
    </svg>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  return btoa(binary);
}
