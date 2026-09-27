// The same-document fast path for a native drag.
//
// A native drag (webContents.startDrag) requires e.preventDefault() on
// dragstart, which means Chromium's own HTML5 session never starts — so
// dataTransfer.setData() carries nothing to an in-document drop target, and
// `dragend` never fires. The payload therefore lives here, in module scope,
// and a drop target in THIS document reads it.
//
// A drop in ANOTHER window (the detached panel) finds this empty and falls
// through to dataTransfer.files, which the native drag really does populate —
// that is the one channel that crosses a BrowserWindow boundary.

import type { HuntedRef } from '../../types/preprod';

/** Advertised on dataTransfer for symmetry with MIME_CUTCLIP. Best-effort:
 *  the singleton below is the load-bearing channel. */
export const HJEN_REF_MIME = 'application/x-hjen-ref';

/** Longer than any real drag, short enough that an abandoned one cannot be
 *  picked up by an unrelated drop half an hour later. */
const STALE_MS = 60_000;

let payload: HuntedRef[] = [];
let stamp = 0;

export function setRefDragPayload(refs: HuntedRef[]): void {
  payload = refs;
  stamp = Date.now();
}

/** Read-and-clear. Nothing else can clear an abandoned drag — there is no
 *  dragend — so staleness is the only garbage collection there is. */
export function takeRefDragPayload(): HuntedRef[] {
  const out = stamp && Date.now() - stamp < STALE_MS ? payload : [];
  payload = [];
  stamp = 0;
  return out;
}

/** Non-destructive peek, for a dragover that wants to know whether to accept. */
export function hasRefDragPayload(): boolean {
  return stamp > 0 && Date.now() - stamp < STALE_MS && payload.length > 0;
}

/** Frames handed to a panel WITHOUT a drag — the "Send to Board" / "Send to
 *  Timeline" route. It exists because a drag can fail for reasons outside this
 *  app's control, and adding a reference to a board must not be able to. */
export interface PendingMedia {
  src: string;
  label?: string;
  refId?: string;
}
