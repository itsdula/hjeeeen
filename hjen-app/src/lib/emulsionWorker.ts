// Emulsion Web Worker — runs the (pure ImageData-in/out) engine off the main
// thread so the preview stays smooth at high resolution and Match-to-Cinema
// (~36 renders) never freezes the UI. The engine + matcher are DOM-free except
// resizeImageData, which now uses OffscreenCanvas (available in workers).
import { renderEmulsion } from './emulsion';
import { autoMatch } from './cinemaMatch';
import { depthDefocus } from './depthDefocus';
import { applySegTreatment } from './segTreat';

const post = (msg: any, transfer?: Transferable[]) => (self as any).postMessage(msg, transfer || []);

(self as any).onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'render') {
      // scene-aware capture stage: depth defocus BEFORE the look, if a depth map is supplied
      const base = (m.depth && m.dof && m.range) ? depthDefocus(m.source, m.depth, m.range, m.dof) : m.source;
      let { image } = renderEmulsion(base, m.choice);
      // segmentation-aware treatment (skin protect / sky) AFTER the look, using the in-focus base
      if (m.masks && m.segOpts) image = applySegTreatment(image, base, m.masks, m.segOpts);
      post({ type: 'render', id: m.id, image }, [image.data.buffer]);
    } else if (m.type === 'match') {
      const result = await autoMatch(m.source, (p: number) => post({ type: 'progress', id: m.id, p }));
      post({ type: 'match', id: m.id, result });
    }
  } catch (err: any) {
    post({ type: 'error', id: m.id, message: String(err?.message || err) });
  }
};
