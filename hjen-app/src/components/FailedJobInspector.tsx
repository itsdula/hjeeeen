import { useStore } from '../store';

function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

/**
 * Modal that shows the exact prompt + references + API error for a
 * previously-failed generation. Opens from LeftSidebar's "Failed" group.
 * Read-only — debugging surface only. The Delete action lives on the
 * sidebar row, not here, because the user is meant to inspect first.
 */
export function FailedJobInspector() {
  const job = useStore(s => s.inspectingFailedJob);
  const close = useStore(s => s.inspectFailedJob);
  const dismiss = useStore(s => s.dismissFailedJob);
  const restore = useStore(s => s.restoreFailedJob);

  if (!job) return null;

  // In gateway mode the full recipe is composed on the server and never reaches
  // the client (LAW: the recipe stays server-side), so `assembledPrompt` is
  // empty. Showing an empty box read as a bug — fall back to the scene prompt
  // the user actually typed, and say where the rest of the recipe lives.
  const composedOnServer = !job.assembledPrompt;
  const shownPrompt = job.assembledPrompt || String(job.selections?.prompt || '');
  const copyPrompt = async () => {
    if (!shownPrompt) return;
    try { await navigator.clipboard.writeText(shownPrompt); } catch {}
  };

  return (
    <div className="modal-backdrop" onClick={() => close(null)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <header className="modal__header">
          <span className="mono-label">Failed take · {new Date(job.ts).toLocaleString()}</span>
          <button className="modal__close" onClick={() => close(null)}>Close</button>
        </header>
        <div className="modal__body modal__body--padded">
          <section className="fji-section">
            <div className="mono-label fji-label">Error from API</div>
            <pre className="fji-error">{job.errorMessage}</pre>
          </section>

          <section className="fji-section">
            <div className="fji-row">
              <span className="mono-label">Model</span>
              <span>{job.modelLabel}</span>
            </div>
            <div className="fji-row">
              <span className="mono-label">Size</span>
              <span>{job.apiSize}</span>
            </div>
            <div className="fji-row">
              <span className="mono-label">Quality</span>
              <span>{job.quality}</span>
            </div>
            <div className="fji-row">
              <span className="mono-label">Aspect</span>
              <span>{job.aspect}</span>
            </div>
            <div className="fji-row">
              <span className="mono-label">Project</span>
              <span>{job.project?.name || '(unassigned)'}</span>
            </div>
          </section>

          <section className="fji-section">
            <div className="fji-section-head">
              <span className="mono-label fji-label">
                {composedOnServer ? 'Your prompt' : 'Assembled prompt sent to API'}
              </span>
              <button className="fji-copy-btn" onClick={copyPrompt} disabled={!shownPrompt}>Copy</button>
            </div>
            <pre className="fji-prompt" dir="auto">{shownPrompt || '(no prompt recorded)'}</pre>
            {composedOnServer && (
              <div className="fji-note">
                The full recipe for this take was composed on the HJEN server and is not stored on this machine.
              </div>
            )}
          </section>

          {job.layers.length > 0 && (
            <section className="fji-section">
              <div className="mono-label fji-label">References ({job.layers.length})</div>
              <div className="fji-refs-grid">
                {job.layers.map(l => (
                  <div key={l.id} className="fji-ref">
                    <img
                      className="fji-ref__thumb"
                      src={fileUrl(l.thumbPath || l.filePath)}
                      alt=""
                      loading="lazy"
                    />
                    <div className="fji-ref__body">
                      <div className="fji-ref__cat mono-label">{l.category}</div>
                      <div className="fji-ref__name">{l.customName || l.name}</div>
                      {l.parentLayerId && <div className="fji-ref__parent">attached to a character</div>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <footer className="modal__footer">
          <button
            className="fji-delete-btn"
            onClick={() => { dismiss(job.id); }}
            title="Permanently delete this failed-job entry from disk"
          >Dismiss</button>
          <button
            className="btn-primary"
            onClick={() => { restore(job.id); }}
            title="Re-apply this prompt + settings + references into the Frame form"
          >Restore into Frame</button>
        </footer>
      </div>
    </div>
  );
}
