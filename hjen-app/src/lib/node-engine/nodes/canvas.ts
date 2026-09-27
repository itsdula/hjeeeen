// Canvas-native node types for the create tools (Text · Bin ·
// Variable · Set). These are lightweight: Text/Bin are pure organisation
// (no output), Variable emits a text value into prompts, and Set is the v1
// proxy for the 3D-set pipeline — it simply holds a plate image and passes it
// downstream (real World-Labs-style 3D navigation lands in a later milestone).

import type { NodeSpec } from '../types';

export function makeTextSpec(): NodeSpec {
  return {
    type: 'text',
    label: 'Text',
    sub: 'Note · annotation',
    accent: '#C9B06B',
    flow: 'data',
    params: [
      { name: 'text', label: 'Note', kind: 'property', dataType: 'text', control: 'textarea' },
    ],
    async process() { return {}; },   // organisation only — no downstream value
  };
}

export function makeBinSpec(): NodeSpec {
  return {
    type: 'bin',
    label: 'Bin',
    sub: 'Group · container',
    accent: '#8A8A8A',
    flow: 'data',
    params: [
      { name: 'label', label: 'Label', kind: 'property', dataType: 'text', control: 'text' },
    ],
    async process() { return {}; },
  };
}

/** Group — a Figma-style FRAME painted behind the board. Membership is
 *  geometric (a node whose centre sits inside the frame moves with it), so
 *  the graph schema stays untouched. The link ports tie a whole cluster
 *  (DNA · references · camera · movement · era…) into the mind's lineage. */
export function makeGroupSpec(): NodeSpec {
  return {
    type: 'group',
    label: 'Group',
    sub: 'Frame · visual cluster',
    accent: '#4FB7B3',
    flow: 'data',
    params: [
      { name: 'label', label: 'Title', kind: 'property', dataType: 'text', control: 'text', default: 'Group' },
      { name: 'in', label: 'Link', kind: 'input', dataType: 'any', optional: true },
      { name: 'out', label: 'Link', kind: 'output', dataType: 'any' },
    ],
    async process() { return {}; },   // organisation only
  };
}

/** File — any document dropped or picked onto the board (PDF, Word, deck,
 *  audio, video, text). The card shows kind + name; open runs the default app.
 *  Kind is derived from the extension at creation time. */
export function makeFileSpec(): NodeSpec {
  return {
    type: 'file',
    label: 'File',
    sub: 'Document · attachment',
    accent: '#D9913F',
    flow: 'data',
    params: [
      { name: 'path', label: 'Path', kind: 'property', dataType: 'text', control: 'text' },
      { name: 'name', label: 'Name', kind: 'property', dataType: 'text', control: 'text' },
      { name: 'kind', label: 'Kind', kind: 'property', dataType: 'text', control: 'text' },
      { name: 'in', label: 'Link', kind: 'input', dataType: 'any', optional: true },
      { name: 'out', label: 'Link', kind: 'output', dataType: 'any' },
    ],
    async process() { return {}; },
  };
}

export function makeVariableSpec(): NodeSpec {
  return {
    type: 'variable',
    label: 'Variable',
    sub: 'Reusable prompt value',
    accent: '#B07FD0',
    flow: 'data',
    params: [
      { name: 'name', label: 'Name', kind: 'property', dataType: 'text', control: 'text' },
      { name: 'value', label: 'Value', kind: 'property', dataType: 'text', control: 'textarea' },
      { name: 'out', label: 'Value', kind: 'output', dataType: 'text' },
    ],
    async process(ctx) {
      const value = (ctx.props.value as string) ?? '';
      return { out: { type: 'text', text: String(value) } };
    },
  };
}

export function makeSetSpec(): NodeSpec {
  return {
    type: 'set',
    label: 'Set',
    sub: '3D set · plate (proxy)',
    accent: '#5BA8FF',
    flow: 'data',
    params: [
      { name: 'plate', label: 'Plate', kind: 'property', dataType: 'image', control: 'asset' },
      { name: 'out', label: 'Plate', kind: 'output', dataType: 'image' },
    ],
    async process(ctx) {
      const asset = ctx.props.plate as { filePath?: string; path?: string } | undefined;
      const path = asset?.filePath || asset?.path;
      if (!path) return {};
      return { out: { type: 'image', path } };
    },
  };
}
