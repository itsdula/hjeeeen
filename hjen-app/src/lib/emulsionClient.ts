// Main-thread client for the Emulsion Web Worker. Promise-based API that mirrors
// the direct engine calls, so the view can swap `renderEmulsion(...).image` →
// `await renderAsync(...)` and `autoMatch(...)` → `await matchAsync(...)`.
// Falls back to synchronous on-thread execution if Workers are unavailable.
import { renderEmulsion, type CameraChoice } from './emulsion';
import { autoMatch, type MatchResult } from './cinemaMatch';
import { depthDefocus, type DofParams, type MeterRange } from './depthDefocus';
import { applySegTreatment, type SegMasks, type SegOpts } from './segTreat';

export interface DofArg { depth: ImageData; range: MeterRange; params: DofParams; }
export interface SegArg { masks: SegMasks; opts: SegOpts; }

type Pending = { resolve: (v: any) => void; reject: (e: any) => void; onProgress?: (p: number) => void };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();
let workerBroken = false;

function ensure(): Worker | null {
  if (workerBroken) return null;
  if (!worker && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./emulsionWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data; const p = pending.get(m.id); if (!p) return;
        if (m.type === 'progress') { p.onProgress?.(m.p); return; }
        pending.delete(m.id);
        if (m.type === 'error') p.reject(new Error(m.message));
        else p.resolve(m.type === 'match' ? m.result : m.image);
      };
      worker.onerror = () => { workerBroken = true; worker = null; };   // fall back to sync
    } catch { workerBroken = true; worker = null; }
  }
  return worker;
}

/** Render the emulsion look off-thread. If `dof` is supplied, depth-defocus is
 *  composited first (capture stage), then the look. Returns processed ImageData. */
export function renderAsync(source: ImageData, choice: CameraChoice, dof?: DofArg, seg?: SegArg): Promise<ImageData> {
  const w = ensure();
  if (!w) {
    const base = dof ? depthDefocus(source, dof.depth, dof.range, dof.params) : source;
    let image = renderEmulsion(base, choice).image;
    if (seg) image = applySegTreatment(image, base, seg.masks, seg.opts);
    return Promise.resolve(image);
  }
  return new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    w.postMessage({ type: 'render', id, source, choice, depth: dof?.depth, range: dof?.range, dof: dof?.params,
                    masks: seg?.masks, segOpts: seg?.opts });
  });
}

/** Run Match-to-Cinema off-thread, with progress. Returns the best MatchResult. */
export function matchAsync(source: ImageData, onProgress?: (p: number) => void): Promise<MatchResult> {
  const w = ensure();
  if (!w) return autoMatch(source, onProgress);
  return new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ type: 'match', id, source });
  });
}
