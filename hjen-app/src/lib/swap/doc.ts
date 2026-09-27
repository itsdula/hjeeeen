// The per-project Swap document — load, merge, save.
//
// WHY A LIST AND NOT A LIVE DOCUMENT. A project accumulates many
// decompositions; the owner works on one frame, comes back a week later and
// needs the one from Tuesday. So the unit of storage is a SESSION, sessions are
// a list, and the view reopens one by id.
//
// WHY IT MUST NEVER RE-READ. Opening a session restores its stored read and
// slots. The two vision passes cost real money and were already paid; a reopen
// that silently re-ran them would charge the owner for looking at his own work.
//
// Writes are debounced and MERGED against what is on disk, because takes from a
// batch fired ten minutes ago still land while the composer is being edited —
// the same reason CameraAnglesView merges its localStorage writes.

import type { SwapDoc, SwapSession } from './types';
import { emptySwapDoc } from './types';

export async function loadSwapDoc(projectId: string): Promise<SwapDoc> {
  try {
    const raw = await window.hjen.readSwapDoc({ id: projectId });
    const doc = raw as SwapDoc | null;
    if (!doc || !Array.isArray(doc.sessions)) return emptySwapDoc(projectId);
    // A doc whose projectId disagrees belongs to another project and arrived
    // after a fast switch. Refuse it rather than paint one project's work under
    // another's name.
    if (doc.projectId && doc.projectId !== projectId) return emptySwapDoc(projectId);
    return { ...doc, projectId };
  } catch {
    return emptySwapDoc(projectId);
  }
}

/** Write one session back, newest first, merging against disk. Returns the doc
 *  actually persisted so the caller can render from the same truth. */
export async function saveSession(projectId: string, session: SwapSession): Promise<SwapDoc> {
  const disk = await loadSwapDoc(projectId);
  const stamped: SwapSession = { ...session, updatedAt: new Date().toISOString() };
  const rest = disk.sessions.filter(s => s.id !== stamped.id);
  const doc: SwapDoc = {
    version: 1, projectId,
    updatedAt: stamped.updatedAt,
    sessions: [stamped, ...rest],
  };
  try { await window.hjen.writeSwapDoc({ id: projectId, doc }); } catch { /* next save retries */ }
  return doc;
}

/** Drop a session. `allowEmpty` is passed only here — deleting the last one is a
 *  deliberate act, and the main-side guard exists to stop ACCIDENTAL emptying,
 *  not to argue with the owner. */
export async function deleteSession(projectId: string, id: string): Promise<SwapDoc> {
  const disk = await loadSwapDoc(projectId);
  const doc: SwapDoc = {
    version: 1, projectId,
    updatedAt: new Date().toISOString(),
    sessions: disk.sessions.filter(s => s.id !== id),
  };
  try { await window.hjen.writeSwapDoc({ id: projectId, doc, allowEmpty: true }); } catch { /* ignore */ }
  return doc;
}

/** The session already holding this frame, if there is one. Picking the same
 *  file twice must return the owner to his work, not start it again. */
export function sessionForSource(doc: SwapDoc, sourcePath: string): SwapSession | undefined {
  return doc.sessions.find(s => s.sourcePath === sourcePath);
}

let seq = 0;
export const newSessionId = (): string => `s-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** A short label for the history strip: the Eye's own search phrase when it has
 *  one (it is written to be how a director would ask for the frame), else the
 *  filename. Never a truncated prompt — that reads as noise at thumbnail size. */
export function sessionTitle(read: { searchPhrase?: string } | undefined, sourcePath: string): string {
  const phrase = (read?.searchPhrase || '').trim();
  if (phrase) return phrase.length > 46 ? phrase.slice(0, 46) + '…' : phrase;
  return (sourcePath.split('/').pop() || 'frame').replace(/\.(png|jpe?g|webp|avif|heic)$/i, '');
}
