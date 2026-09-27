// The dock inside References — the host for both panel kinds.
//
// A mood board and a sequence are the same kind of object: a per-project
// document that lives here and can be torn off into its own macOS window. One
// dock, one document rail, one Detach button.
//
// THE OWNERSHIP RULE. A document that is detached is NOT editable here. The
// dock shows a placeholder with "Bring to front" and "Re-attach" instead. That
// is what keeps exactly one window mutating a document at any moment, which in
// turn makes the rev/echo machinery in usePanelDoc a safety net rather than the
// main path.
//
// KEEP-ALIVE. This renders INSIDE the ReferencesView subtree — never portalled
// to <body> — so KeepAlivePane's visibility:hidden reaches it. A portal would
// escape that and leave a mood board floating over another tab.

import { useCallback, useEffect, useRef, useState } from 'react';
import { PanelDocHost } from './PanelDocHost';
import { blankMoodBoard } from '../../types/moodboard';
import { blankSequence } from '../../lib/timeline/model';
import type { PanelKind } from '../../lib/dock/usePanelDoc';
import type { PendingMedia } from '../../lib/dock/dragPayload';
import type { PanelDocSummary } from '../../types/hjen-bridge';
import '../../styles/dock.css';

const KINDS: Array<{ kind: PanelKind; label: string; noun: string; blank: () => unknown }> = [
  { kind: 'moodboard', label: 'Mood Board', noun: 'board', blank: blankMoodBoard },
  { kind: 'timeline', label: 'Timeline', noun: 'sequence', blank: blankSequence },
];

export function RefDock({ projectId, initialKind, pending, onPendingConsumed, onClose }: {
  projectId: string | null;
  initialKind: PanelKind;
  /** Frames sent here WITHOUT a drag ("Send to Board" / "Send to Timeline"). */
  pending?: PendingMedia[] | null;
  onPendingConsumed?: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<PanelKind>(initialKind);
  const [docs, setDocs] = useState<PanelDocSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detached, setDetached] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<PanelDocSummary | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const meta = KINDS.find(k => k.kind === kind)!;
  const showToast = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  // ── the document list ──
  const refresh = useCallback(async () => {
    if (!projectId) { setDocs([]); return; }
    const res = await window.hjen.docList({ id: projectId, kind });
    if (!res.ok) { setDocs([]); return; }
    setDocs(res.docs);
    // Land on something rather than an empty stage.
    setActiveId(prev => (prev && res.docs.some(d => d.id === prev) ? prev : (res.docs[0]?.id ?? null)));
  }, [projectId, kind]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Frames were sent here and there is nowhere to put them yet — make the first
  // one rather than answering a deliberate action with an empty stage.
  const autoMade = useRef(false);
  useEffect(() => {
    if (!pending?.length || autoMade.current || busy || !projectId) return;
    if (docs.length > 0 || activeId) return;
    autoMade.current = true;
    void create();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, docs.length, activeId, busy, projectId]);

  // Another window created, wrote, or deleted one — keep the rail honest.
  useEffect(() => {
    const off = window.hjen.onDocChanged?.(d => {
      if (d.projectId === projectId && d.kind === kind) void refresh();
    });
    return off;
  }, [projectId, kind, refresh]);

  // ── which documents are currently OUT ──
  const syncDetached = useCallback(async () => {
    const res = await window.hjen.panelList();
    setDetached(new Set(res.ok ? res.open : []));
  }, []);
  useEffect(() => { void syncDetached(); }, [syncDetached]);
  useEffect(() => {
    const off = window.hjen.onPanelWindow?.(() => { void syncDetached(); });
    return off;
  }, [syncDetached]);

  const keyFor = (docId: string) => `${kind}:${projectId}:${docId}`;
  const isOut = (docId: string) => detached.has(keyFor(docId));

  // ── actions ──
  const create = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      const n = docs.length + 1;
      const res = await window.hjen.docCreate({
        id: projectId, kind,
        name: kind === 'timeline' ? `Sequence ${n}` : `Board ${n}`,
        doc: meta.blank(),
      });
      if (res.ok) { await refresh(); setActiveId(res.doc.id); }
      else showToast(res.message);
    } finally { setBusy(false); }
  };

  const remove = async (doc: PanelDocSummary) => {
    if (!projectId) return;
    await window.hjen.docDelete({ id: projectId, kind, docId: doc.id });
    setConfirmDel(null);
    showToast(`“${doc.name}” removed — recoverable from the project’s backups.`);
    await refresh();
  };

  const detach = async (docId: string) => {
    if (!projectId) return;
    const doc = docs.find(d => d.id === docId);
    const res = await window.hjen.panelOpen({ kind, id: projectId, docId, name: doc?.name });
    if (!res.ok) showToast(res.message);
    else await syncDetached();
  };

  const reattach = async (docId: string) => {
    if (!projectId) return;
    await window.hjen.panelClose({ kind, id: projectId, docId });
    await syncDetached();
  };

  const activeOut = activeId ? isOut(activeId) : false;
  const activeDoc = docs.find(d => d.id === activeId) ?? null;

  return (
    <div className="rd-dock">
      <header className="rd-bar">
        <div className="rd-tabs" role="tablist">
          {KINDS.map(k => (
            <button
              key={k.kind}
              role="tab"
              aria-selected={kind === k.kind}
              className={`rd-tab${kind === k.kind ? ' is-on' : ''}`}
              // Clear the selection in the SAME commit as the kind. Carrying a
              // mood board's id into the timeline tab, even for one render, is
              // how a document of the wrong shape reaches the wrong panel.
              onClick={() => { setKind(k.kind); setActiveId(null); }}
            >{k.label}</button>
          ))}
        </div>
        <span className="rd-bar__spacer" />
        {activeId && !activeOut && (
          <button className="pp-btn pp-btn--ghost" onClick={() => void detach(activeId)} title="Open in its own window, beside the studio">
            ⇱ Detach
          </button>
        )}
        {activeId && activeOut && (
          <button className="pp-btn pp-btn--ghost" onClick={() => void reattach(activeId)}>⇲ Re-attach</button>
        )}
        <button className="pp-btn pp-btn--ghost" onClick={onClose}>Close</button>
      </header>

      <div className="rd-body">
        <aside className="rd-rail">
          <button className="pp-btn pp-btn--accent rd-rail__new" onClick={() => void create()} disabled={!projectId || busy}>
            + New {meta.noun}
          </button>
          <div className="rd-rail__list">
            {docs.length === 0 && (
              <p className="rd-rail__blank">No {meta.noun}s yet.</p>
            )}
            {docs.map(d => (
              <div
                key={d.id}
                className={`rd-card${d.id === activeId ? ' is-on' : ''}${isOut(d.id) ? ' is-out' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setActiveId(d.id)}
                onKeyDown={e => { if (e.key === 'Enter') setActiveId(d.id); }}
              >
                <div className="rd-card__thumb">
                  {d.coverPath
                    ? <img src={`hjen-file://${encodeURI(d.coverPath)}`} alt="" draggable={false} />
                    : <span className="rd-card__thumb--empty" />}
                </div>
                <div className="rd-card__meta">
                  <span className="rd-card__name">{d.name}</span>
                  <span className="mono-label rd-card__count">
                    {d.count} {kind === 'timeline' ? 'clip' : 'item'}{d.count === 1 ? '' : 's'}
                    {isOut(d.id) ? ' · OUT' : ''}
                  </span>
                </div>
                <button
                  className="rd-card__del"
                  title={`Remove this ${meta.noun}`}
                  aria-label={`Remove ${d.name}`}
                  onClick={e => { e.stopPropagation(); setConfirmDel(d); }}
                >×</button>
              </div>
            ))}
          </div>
        </aside>

        <main className="rd-stage">
          {activeOut && activeDoc ? (
            // The ownership rule, made visible: one window owns the document.
            <div className="rd-empty">
              <div className="mono-label rd-empty__eyebrow">OPEN IN ITS OWN WINDOW</div>
              <p className="rd-empty__p">“{activeDoc.name}” is being worked on beside the studio.</p>
              <div className="rd-empty__row">
                <button className="pp-btn pp-btn--ghost" onClick={() => void detach(activeDoc.id)}>Bring to front</button>
                <button className="pp-btn pp-btn--accent" onClick={() => void reattach(activeDoc.id)}>Re-attach</button>
              </div>
            </div>
          ) : (
            <PanelDocHost
              kind={kind}
              projectId={projectId}
              docId={activeId}
              onToast={showToast}
              // Only the tab that was asked for receives the sent frames —
              // switching tabs afterwards must not re-deliver them somewhere else.
              pending={kind === initialKind ? pending : null}
              onPendingConsumed={onPendingConsumed}
            />
          )}
        </main>
      </div>

      {confirmDel && (
        <div className="modal-backdrop" onClick={() => setConfirmDel(null)}>
          <div className="modal modal--narrow rd-confirm" onClick={e => e.stopPropagation()}>
            <div className="rd-confirm__body">
              <div className="mono-label rd-confirm__eyebrow">REMOVE</div>
              <h3 className="rd-confirm__h">Remove “{confirmDel.name}”?</h3>
              <p className="rd-confirm__p">
                Its last state is kept in the project’s backups folder, so this is recoverable.
              </p>
            </div>
            <div className="rd-confirm__foot">
              <button className="pp-btn pp-btn--ghost" onClick={() => setConfirmDel(null)}>Keep</button>
              <button className="rd-confirm__yes" onClick={() => void remove(confirmDel)}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="pp-toast rd-toast">{toast}</div>}
    </div>
  );
}
