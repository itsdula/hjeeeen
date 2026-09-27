import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../styles/image-preview-dialog.css';

export type ImagePreviewItem = {
  src: string;
  title?: string;
  detail?: string;
};

export function ImagePreviewDialog({ item, onClose }: {
  item: ImagePreviewItem | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!item) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [item, onClose]);

  if (!item) return null;

  return createPortal(
    <div className="image-preview" role="dialog" aria-modal="true" aria-label={item.title || 'Image preview'} onClick={onClose}>
      <div className="image-preview__panel" onClick={event => event.stopPropagation()}>
        <header className="image-preview__head">
          <div>
            <span className="mono-label">IMAGE PREVIEW</span>
            <strong className="selectable" dir="auto">{item.title || 'Reference image'}</strong>
            {item.detail && <small className="selectable" dir="auto">{item.detail}</small>}
          </div>
          <button type="button" className="image-preview__close" onClick={onClose} aria-label="Close image preview" title="Close (Esc)">×</button>
        </header>
        <div className="image-preview__stage">
          <img src={item.src} alt={item.title || 'Image preview'} draggable={false} />
        </div>
        <footer><span>Click outside or press Esc to close</span><span>Full image · no crop</span></footer>
      </div>
    </div>,
    document.body,
  );
}
