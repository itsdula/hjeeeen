// Source node — emits an image asset picked from the Library / a project.
// Pure DataNode: no inputs, resolves instantly. If no asset is selected it
// emits nothing (downstream `source` inputs are optional), so a seeded-but-
// unconfigured Source never errors the run.

import type { NodeSpec } from '../types';

export function makeSourceSpec(): NodeSpec {
  return {
    type: 'source',
    label: 'Source',
    sub: 'Library · Project asset',
    accent: '#257D64',
    flow: 'data',
    params: [
      { name: 'asset', label: 'Asset', kind: 'property', dataType: 'image', control: 'asset' },
      { name: 'out', label: 'Image', kind: 'output', dataType: 'image' },
    ],
    async process(ctx) {
      const asset = ctx.props.asset as { filePath?: string; path?: string } | undefined;
      const path = asset?.filePath || asset?.path;
      if (!path) return {}; // nothing selected — emit no value
      return { out: { type: 'image', path } };
    },
  };
}
