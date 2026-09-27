// The root of a DETACHED panel window.
//
// This is not the studio: no store.init(), no tabs, no TopChrome, no project
// switching. One document, bound at launch to (kind, projectId, docId), talking
// to the same disk over the same bridge. The theme/appearance bootstrap in
// main.tsx already ran at module scope for this window too — same origin, same
// localStorage — so it paints in the user's theme, not the Default one.

import { useCallback, useEffect, useState } from 'react';
import { PanelDocHost } from './PanelDocHost';
import type { PanelKind } from '../../lib/dock/usePanelDoc';
import '../../styles/dock.css';

export function PanelWindowRoot({ kind, projectId, docId }: {
  kind: PanelKind;
  projectId: string;
  docId: string;
}) {
  const [name, setName] = useState<string>(kind === 'timeline' ? 'Timeline' : 'Mood Board');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  // The title strip shows the document's name — in a second window the name is
  // the only thing telling you which board you are looking at.
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const res = await window.hjen.docList({ id: projectId, kind });
      if (!alive || !res.ok) return;
      const mine = res.docs.find(d => d.id === docId);
      if (mine) { setName(mine.name); document.title = mine.name; }
    };
    void read();
    const off = window.hjen.onDocChanged?.(d => {
      if (d.projectId === projectId && d.kind === kind && d.docId === docId) void read();
    });
    return () => { alive = false; off?.(); };
  }, [projectId, kind, docId]);

  return (
    <div className="pw-root">
      {/* The window's own title strip: the frame is hiddenInset, so this bar IS
          the drag region. Every control inside it must opt back out. */}
      <header className="pw-bar drag-region">
        <span className="pw-bar__name no-drag">{name}</span>
        <span className="pw-bar__spacer" />
        <span className="mono-label pw-bar__kind no-drag">{kind === 'timeline' ? 'TIMELINE' : 'MOOD BOARD'}</span>
      </header>
      <div className="pw-body">
        <PanelDocHost kind={kind} projectId={projectId} docId={docId} onToast={showToast} />
      </div>
      {toast && <div className="pp-toast rd-toast">{toast}</div>}
    </div>
  );
}
