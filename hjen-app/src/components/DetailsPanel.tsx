import { useEffect, useState } from 'react';
import { useStore } from '../store';

interface SidecarData {
  captured?: string;
  prompt?: string;
  size?: string;
  apiSize?: string;
  finalSize?: string;
  finalMP?: number;
  sizeNote?: string | null;
  model?: string;
  apiModelId?: string;
  project?: { id: string; name: string; slug: string } | null;
  selections?: Record<string, any>;
  estimatedCost?: {
    usd: number;
    perImage: number;
    imageCount: number;
    estimated: true;
    asOf: string;
    source: 'openai' | 'google';
    breakdown: string;
  };
  durationMs?: number;
  apiDurationMs?: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r}s`;
}

export function DetailsPanel() {
  const close = useStore(s => s.closePicker);
  const current = useStore(s => s.current);
  const projects = useStore(s => s.projects);
  const loadProjects = useStore(s => s.loadProjects);

  const [sidecar, setSidecar] = useState<SidecarData | null>(null);
  const [copied, setCopied] = useState(false);
  const [showMoveTo, setShowMoveTo] = useState(false);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (current?.sidecarPath) {
      window.hjen.readSidecar(current.sidecarPath).then(data => {
        if (!cancelled) setSidecar(data);
      });
    } else if (current) {
      // Built from in-memory state (just-generated)
      setSidecar({
        prompt: current.prompt,
        size: current.size,
        model: current.modelLabel,
      });
    }
    return () => { cancelled = true; };
  }, [current?.sidecarPath, current?.prompt]);

  const promptText = sidecar?.prompt ?? current?.prompt ?? '';

  const copyPrompt = async () => {
    if (!promptText) return;
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleMove = async (targetSlug: string | null, targetId: string | null) => {
    if (!current?.savedPath) return;
    setMoving(true);
    try {
      const res = await window.hjen.moveGeneration({
        imgPath: current.savedPath,
        targetProjectSlug: targetSlug,
        targetProjectId: targetId,
      });
      if (res.ok) {
        await loadProjects();
        setShowMoveTo(false);
        close();
      } else {
        alert(`Move failed: ${res.reason}`);
      }
    } finally {
      setMoving(false);
    }
  };

  if (!current) {
    return (
      <div className="modal-backdrop" onClick={close}>
        <div className="modal modal--narrow" onClick={e => e.stopPropagation()}>
          <header className="modal__header">
            <span className="mono-label">Details</span>
            <button className="modal__close" onClick={close}>Close</button>
          </header>
          <div className="modal__body modal__body--padded">
            <div className="details-empty">No frame yet. Make one or pick from the sidebar.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" style={{ width: 'min(860px, 100%)' }} onClick={e => e.stopPropagation()}>
        <header className="modal__header">
          <span className="mono-label">Frame details</span>
          <button className="modal__close" onClick={close}>Close</button>
        </header>
        <div className="modal__body modal__body--padded">
          {sidecar?.project !== undefined && (
            <div className="details-row">
              <span className="mono-label details-row__label">Project</span>
              <span className="details-row__value details-row__value--with-action">
                <span>{sidecar.project?.name ?? '(unassigned)'}</span>
                {current?.savedPath && (
                  <button className="details-action-btn" onClick={() => setShowMoveTo(v => !v)}>
                    {showMoveTo ? 'Cancel move' : 'Move to…'}
                  </button>
                )}
              </span>
            </div>
          )}

          {showMoveTo && current?.savedPath && (
            <div className="details-move">
              <div className="mono-label details-move__label">Pick destination project</div>
              <div className="details-move__list">
                {projects.length === 0 && <div className="details-empty">No projects yet.</div>}
                {projects
                  .filter(p => p.slug !== sidecar?.project?.slug)
                  .map(p => (
                    <button
                      key={p.id}
                      className="details-move__option"
                      onClick={() => handleMove(p.slug, p.id)}
                      disabled={moving}
                    >
                      <div className="details-move__option-name">{p.name}</div>
                      <div className="details-move__option-meta mono-label">{p.slug} · {p.generationCount} frames</div>
                    </button>
                  ))}
                {sidecar?.project && (
                  <button
                    className="details-move__option details-move__option--unassigned"
                    onClick={() => handleMove(null, null)}
                    disabled={moving}
                  >
                    <div className="details-move__option-name">Move to _unassigned</div>
                    <div className="details-move__option-meta mono-label">Detach from any project</div>
                  </button>
                )}
              </div>
            </div>
          )}

          {sidecar?.captured && (
            <div className="details-row">
              <span className="mono-label details-row__label">Captured</span>
              <span className="details-row__value">{new Date(sidecar.captured).toLocaleString()}</span>
            </div>
          )}

          <div className="details-row">
            <span className="mono-label details-row__label">Model</span>
            <span className="details-row__value">
              {sidecar?.model ?? current.modelLabel ?? '—'}
              {sidecar?.apiModelId && <code className="details-code">{sidecar.apiModelId}</code>}
            </span>
          </div>

          <div className="details-row">
            <span className="mono-label details-row__label">API size</span>
            <span className="details-row__value">
              <code className="details-code">{sidecar?.apiSize ?? current.size}</code>
            </span>
          </div>

          <div className="details-row">
            <span className="mono-label details-row__label">Final size (output)</span>
            <span className="details-row__value">
              <code className="details-code">{sidecar?.finalSize ?? current.size}</code>
              {sidecar?.finalMP !== undefined && (
                <span className="details-mp">{sidecar.finalMP.toFixed(2)} MP</span>
              )}
            </span>
          </div>

          {sidecar?.sizeNote && (
            <div className="details-note">{sidecar.sizeNote}</div>
          )}

          {sidecar?.estimatedCost && (
            <div className="details-row">
              <span className="mono-label details-row__label">Cost (est.)</span>
              <span className="details-row__value">
                <code className="details-code">~${sidecar.estimatedCost.usd.toFixed(3)}</code>
                <span className="details-cost-breakdown">{sidecar.estimatedCost.breakdown}</span>
              </span>
            </div>
          )}

          {sidecar?.durationMs !== undefined && (
            <div className="details-row">
              <span className="mono-label details-row__label">Duration</span>
              <span className="details-row__value">
                <code className="details-code">{formatDuration(sidecar.durationMs)}</code>
                {sidecar.apiDurationMs !== undefined && sidecar.apiDurationMs !== sidecar.durationMs && (
                  <span className="details-cost-breakdown">{formatDuration(sidecar.apiDurationMs)} API + {formatDuration(sidecar.durationMs - sidecar.apiDurationMs)} crop/save</span>
                )}
              </span>
            </div>
          )}

          {sidecar?.selections && (
            <details className="details-selections">
              <summary className="mono-label">Selections</summary>
              <table className="details-table">
                <tbody>
                  {Object.entries(sidecar.selections).map(([k, v]) => {
                    if (v === null || v === '') return null;
                    return (
                      <tr key={k}>
                        <td className="mono-label details-table__key">{k}</td>
                        <td className="details-table__val">{String(v)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          )}

          <div className="details-prompt-wrap">
            <div className="details-prompt-head">
              <span className="mono-label">Prompt sent to the model</span>
              <button className="details-copy" onClick={copyPrompt} disabled={!promptText}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="details-prompt">{promptText || '(empty)'}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
