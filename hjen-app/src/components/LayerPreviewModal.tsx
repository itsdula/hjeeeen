import { useEffect } from 'react';

export type PreviewTarget = { filePath: string; name: string };

function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

/** Lightweight reference preview window — used by both the Layers sidebar
 *  and the GenerationPreview's reference list. ~50% of program frame,
 *  50%-dimmed backdrop, no zoom. Esc / X / backdrop click all close. */
export function LayerPreviewModal({ target, onClose }: { target: PreviewTarget | null; onClose: () => void }) {
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // Capture-phase so we beat the parent lightbox's bubble-phase Escape
    // handler — Esc closes the preview, not the lightbox underneath it.
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true } as any);
  }, [target, onClose]);

  if (!target) return null;
  return (
    <div className="layer-preview-backdrop" onClick={onClose}>
      <div className="layer-preview-modal" onClick={e => e.stopPropagation()}>
        <header className="layer-preview-modal__head">
          <span className="mono-label">{target.name}</span>
          <button className="layer-preview-modal__close" onClick={onClose}>Close</button>
        </header>
        <div className="layer-preview-modal__body">
          <img src={fileUrl(target.filePath)} alt={target.name} />
        </div>
      </div>
    </div>
  );
}
