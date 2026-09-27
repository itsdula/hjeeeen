// Enhancer node — Replicate CodeFormer (+ optional Clarity) on an input image.
// Requires the input image to have a saved file path. Persists the enhanced
// result so downstream path-based nodes can read it.

import type { NodeSpec, ImageValue } from '../types';
import { enhanceFace } from '../../enhancer';

export function makeEnhancerSpec(): NodeSpec {
  return {
    type: 'enhancer',
    label: 'Enhancer',
    sub: 'De-plastic · real skin',
    accent: '#2E7C9E',
    flow: 'control',
    opens: 'enhancer',
    params: [
      { name: 'image', label: 'Image', kind: 'input', dataType: 'image' },
      { name: 'fidelity', label: 'Fidelity', kind: 'property', dataType: 'number', control: 'number', default: 0.7, min: 0, max: 1, step: 0.05, batchable: true },
      { name: 'clarityPass', label: 'Clarity pass', kind: 'property', dataType: 'boolean', control: 'toggle', default: false },
      { name: 'out', label: 'Image', kind: 'output', dataType: 'image' },
    ],
    async process(ctx) {
      const img = ctx.inputs.image as ImageValue | undefined;
      if (!img?.path) throw new Error('Enhancer needs an image with a saved file path on its input.');

      ctx.report('enhancing…');
      const res = await enhanceFace({
        sourcePath: img.path,
        fidelity: Number(ctx.props.fidelity ?? 0.7),
        clarityPass: Boolean(ctx.props.clarityPass),
      });

      let savedPath: string | undefined;
      try {
        const saved = await window.hjen.saveGeneration({
          base64: res.b64,
          promptSlug: 'enhanced',
          projectSlug: ctx.project?.slug,
          projectId: ctx.project?.id,
          sidecar: {
            captured: new Date().toISOString(),
            tool: 'node-enhancer',
            size: res.size,
            stages: res.stages,
            costUsd: res.costUsd,
          },
        });
        savedPath = saved.imgPath;
      } catch (e) {
        console.warn('[enhancer node] save failed', e);
      }

      const [w, h] = (res.size || '').split('x').map(Number);
      return {
        out: {
          type: 'image',
          url: res.url,
          b64: res.b64,
          path: savedPath,
          width: Number.isFinite(w) ? w : undefined,
          height: Number.isFinite(h) ? h : undefined,
          mime: 'image/png',
        },
      };
    },
  };
}
