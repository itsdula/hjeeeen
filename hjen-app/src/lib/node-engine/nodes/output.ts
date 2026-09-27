// Output node — the terminal. Images from Frame/Enhancer and videos from Video
// are already saved to the project, so this mostly records the delivered path.
// If an image arrives unsaved (only b64) it persists it.

import type { NodeSpec, ImageValue, VideoValue } from '../types';

export function makeOutputSpec(): NodeSpec {
  return {
    type: 'output',
    label: 'Output',
    sub: 'Deliver · master file',
    accent: '#D1B310',
    flow: 'control',
    params: [
      { name: 'asset', label: 'Asset', kind: 'input', dataType: 'any' },
      { name: 'deliver', label: 'Save to project', kind: 'property', dataType: 'boolean', control: 'toggle', default: true },
    ],
    async process(ctx) {
      const asset = ctx.inputs.asset as ImageValue | VideoValue | undefined;
      if (!asset) throw new Error('Output has no asset on its input.');

      if (asset.type === 'video') {
        ctx.report(`Delivered video → ${asset.path}`);
        return {};
      }

      // image
      if (asset.path) {
        ctx.report(`Delivered → ${asset.path}`);
      } else if (asset.b64 && ctx.props.deliver) {
        try {
          const saved = await window.hjen.saveGeneration({
            base64: asset.b64,
            promptSlug: 'output',
            projectSlug: ctx.project?.slug,
            projectId: ctx.project?.id,
            sidecar: { captured: new Date().toISOString(), tool: 'node-output' },
          });
          ctx.report(`Saved → ${saved.imgPath}`);
        } catch (e) {
          console.warn('[output node] save failed', e);
        }
      }
      return {};
    },
  };
}
