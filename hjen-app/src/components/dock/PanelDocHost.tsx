// One panel document, loaded and mounted — the piece the dock and the detached
// window both wrap. It knows nothing about which host it is in: it takes a
// (kind, projectId, docId) and renders the right surface. That is what lets the
// SAME component serve a panel inside References and a separate macOS window.

import { MoodBoardCanvas } from '../moodboard/MoodBoardCanvas';
import { TimelinePanel } from '../timeline/TimelinePanel';
import { usePanelDoc, type PanelKind } from '../../lib/dock/usePanelDoc';
import type { PendingMedia } from '../../lib/dock/dragPayload';
import type { MoodBoard } from '../../types/moodboard';
import type { TlSequence } from '../../lib/timeline/model';

export function PanelDocHost({ kind, projectId, docId, onToast, pending, onPendingConsumed }: {
  kind: PanelKind;
  projectId: string | null;
  docId: string | null;
  onToast: (msg: string) => void;
  /** Frames handed over without a drag — see PendingMedia. */
  pending?: PendingMedia[] | null;
  onPendingConsumed?: () => void;
}) {
  const handle = usePanelDoc<MoodBoard | TlSequence>(kind, projectId, docId);
  const { doc, loaded, error, reloaded, edit, setInteracting } = handle;

  if (!docId) {
    return (
      <div className="rd-empty">
        <p className="rd-empty__p">Pick one on the left, or start a new one.</p>
      </div>
    );
  }
  if (!loaded) return <div className="rd-empty"><p className="rd-empty__p">Opening…</p></div>;
  if (error && !doc) return <div className="rd-empty"><p className="rd-empty__p pp-error">{error}</p></div>;
  if (!doc) return <div className="rd-empty"><p className="rd-empty__p">That one is gone.</p></div>;

  // A shape guard, belt to usePanelDoc's braces. Handing a mood board to the
  // timeline is not a cosmetic mismatch — it reaches sequenceDuration(), throws
  // out of a useMemo, and unmounts the entire app. Two cheap checks make that
  // unreachable no matter how the timing lands.
  const isBoard = Array.isArray((doc as MoodBoard).items);
  const isSeq = Array.isArray((doc as TlSequence).tracks);
  if ((kind === 'moodboard' && !isBoard) || (kind === 'timeline' && !isSeq)) {
    return <div className="rd-empty"><p className="rd-empty__p">Opening…</p></div>;
  }

  return (
    <>
      {kind === 'moodboard' ? (
        <MoodBoardCanvas
          board={doc as MoodBoard}
          edit={edit as (fn: (d: MoodBoard) => MoodBoard) => void}
          setInteracting={setInteracting}
          projectId={projectId}
          onToast={onToast}
          pending={pending}
          onPendingConsumed={onPendingConsumed}
        />
      ) : (
        <TimelinePanel
          seq={doc as TlSequence}
          edit={edit as (fn: (d: TlSequence) => TlSequence) => void}
          setInteracting={setInteracting}
          projectId={projectId}
          onToast={onToast}
          pending={pending}
          onPendingConsumed={onPendingConsumed}
        />
      )}
      {/* Someone else changed this while it was open — say so rather than let
          the picture quietly rearrange itself. */}
      {reloaded && <div className="rd-reloaded mono-label">⟳ RELOADED FROM THE OTHER WINDOW</div>}
      {error && doc && <div className="pp-toast rd-toast">{error}</div>}
    </>
  );
}
