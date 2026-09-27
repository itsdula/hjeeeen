// Frame node — the Saudi-DNA KV still. Wraps the SHARED runFrameGeneration()
// (same core as store.generate()) then persists the result to the project so
// downstream path-based nodes (Enhancer / Video) can read it from disk.

import type { NodeSpec, ImageValue, ReferenceSetValue, SelectionSetValue, TextValue } from '../types';
import type { Selections } from '../../../types/catalog';
import type { Layer } from '../../../store';
import { runFrameGeneration } from '../../frameGen';
import { initialSelections } from '../../selectionsDefault';
import { imageFromGenerateResult } from '../values';

function slugify(t: string): string {
  return (t || 'frame').replace(/[^\w\s-]/gu, '').trim().toLowerCase().replace(/[\s_-]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'frame';
}

export function makeFrameSpec(): NodeSpec {
  return {
    type: 'frame',
    label: 'Frame',
    sub: 'Saudi-DNA KV still',
    accent: '#F25502',
    flow: 'control',
    opens: 'frame',
    params: [
      { name: 'source', label: 'Source image', kind: 'input', dataType: 'image', optional: true },
      { name: 'reference', label: 'References', kind: 'input', dataType: 'referenceSet', optional: true },
      { name: 'selections', label: 'DOP selections', kind: 'input', dataType: 'selectionSet', optional: true },
      { name: 'promptIn', label: 'Prompt in', kind: 'input', dataType: 'text', optional: true },
      { name: 'prompt', label: 'Prompt', kind: 'property', dataType: 'text', control: 'textarea', default: '', batchable: true },
      { name: 'dop', label: 'Selections', kind: 'property', dataType: 'selectionSet', control: 'selections' },
      { name: 'out', label: 'Image', kind: 'output', dataType: 'image' },
    ],
    async process(ctx) {
      // Effective selections: defaults <- node's dop property <- input selectionSet.
      const dopProp = ctx.props.dop as SelectionSetValue | undefined;
      const dopSel = dopProp && dopProp.type === 'selectionSet' ? dopProp.selections : undefined;
      const inSel = ctx.inputs.selections as SelectionSetValue | undefined;
      const merged: Selections = { ...initialSelections, ...(dopSel ?? {}), ...(inSel?.selections ?? {}) };

      // Prompt precedence: wired prompt input > prompt property > merged.prompt.
      const pIn = ctx.inputs.promptIn as TextValue | undefined;
      const pProp = ctx.props.prompt as string | undefined;
      if (pIn?.text?.trim()) merged.prompt = pIn.text;
      else if (typeof pProp === 'string' && pProp.trim()) merged.prompt = pProp;

      // Build layers from a referenceSet input and/or a single source image.
      const layers: Layer[] = [];
      const refSet = ctx.inputs.reference as ReferenceSetValue | undefined;
      if (refSet?.refs?.length) layers.push(...refSet.refs);
      const src = ctx.inputs.source as ImageValue | undefined;
      if (src?.path) {
        layers.push({
          id: 'src', assetId: 'src', category: 'general',
          name: 'source', filePath: src.path, thumbPath: src.path,
        } as Layer);
      }

      ctx.report('making frame…');
      const { result } = await runFrameGeneration(merged, layers);

      // Persist so Enhancer/Video downstream get a real file path.
      let savedPath: string | undefined;
      try {
        const saved = await window.hjen.saveGeneration({
          base64: result.b64,
          promptSlug: slugify(merged.prompt),
          projectSlug: ctx.project?.slug,
          projectId: ctx.project?.id,
          sidecar: {
            captured: new Date().toISOString(),
            tool: 'node-frame',
            prompt: result.prompt,
            size: result.size,
            model: result.modelLabel,
          },
        });
        savedPath = saved.imgPath;
      } catch (e) {
        console.warn('[frame node] save failed', e);
      }

      return { out: imageFromGenerateResult(result, savedPath) };
    },
  };
}
