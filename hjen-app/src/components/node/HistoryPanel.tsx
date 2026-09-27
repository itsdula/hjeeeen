// History panel — the canvas's recent operations. Lists
// the last 10 operations with details (what · when · size); click any row to jump
// straight to that version. Graph-scoped (nodes + edges), per canvas.

import { useStore } from '../../store';

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const undo = useStore(s => s.graphUndoStack);
  const redo = useStore(s => s.graphRedoStack);
  const jumpHistory = useStore(s => s.jumpHistory);
  const liveNodes = useStore(s => s.graphNodes.length);
  const now = Date.now();

  // Last 10 operations, newest first (undo stack = past states).
  const past = undo.slice(-10).reverse();
  const empty = undo.length + redo.length === 0;

  return (
    <div className="nv-hist__scrim" onPointerDown={onClose}>
      <div className="nv-hist" onPointerDown={(e) => e.stopPropagation()}>
        <header className="nv-hist__head">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4M12 8v4l3 2" /></svg>
          <span className="nv-hist__title">History</span>
          <span className="nv-hist__sub mono-label">last {past.length} operation{past.length === 1 ? '' : 's'}</span>
          <button className="nv-hist__x" onClick={onClose} title="Close">✕</button>
        </header>

        {empty ? (
          <div className="nv-hist__empty">
            <div className="nv-hist__emptytitle">No edits yet</div>
            <div className="nv-hist__emptysub mono-label">Build on the canvas — every action lands here to step back to.</div>
          </div>
        ) : (
          <div className="nv-hist__list">
            {/* Redoable (future) operations, furthest first */}
            {redo.map((snap, idx) => (
              <button key={`r${snap.id}`} className="nv-hist__row nv-hist__row--future" onClick={() => jumpHistory(redo.length - idx)}>
                <span className="nv-hist__dot" />
                <span className="nv-hist__label">{snap.label}</span>
                <span className="nv-hist__meta mono-label">{snap.nodes.length} node{snap.nodes.length === 1 ? '' : 's'} · redo</span>
              </button>
            ))}
            {/* Current */}
            <div className="nv-hist__row nv-hist__row--current">
              <span className="nv-hist__dot" />
              <span className="nv-hist__label">Current version</span>
              <span className="nv-hist__meta mono-label">now · {liveNodes} node{liveNodes === 1 ? '' : 's'}</span>
            </div>
            {/* Last 10 operations, newest first */}
            {past.map((snap, i) => (
              <button key={snap.id} className="nv-hist__row nv-hist__row--past" onClick={() => jumpHistory(-(i + 1))} title="Jump to this version">
                <span className="nv-hist__dot" />
                <span className="nv-hist__label">{snap.label}</span>
                <span className="nv-hist__meta mono-label">{ago(snap.ts, now)} · {snap.nodes.length} node{snap.nodes.length === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
