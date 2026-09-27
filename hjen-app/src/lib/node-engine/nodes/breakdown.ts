// Ad Breakdown 360 nodes — تشريح الإعلان on the thinking canvas. Same
// discipline as mind.ts: non-generative specs (process = noop), ONE optional
// `in` + ONE `out` port so the edge model works untouched, plain-string params
// (JSON-safe persistence), `entity` carries the breakdown reference
// ('bd:<elementId>' / 'bdaxis:<key>' / 'bdheader:<slug>' / 'mm:<itemId>').
// breakdown.json is the source of truth — these nodes are references; the
// canvas never writes back into it (except the approve seal, via its own IPC).

import type { NodeSpec, Parameter } from '../types';

export const BREAKDOWN_ACCENT = '#C97E35';   // forensic amber — a second family beside Brief-Mind blue

const IO: Parameter[] = [
  { name: 'in', label: 'From', kind: 'input', dataType: 'any', optional: true },
  { name: 'out', label: 'To', kind: 'output', dataType: 'any' },
];

const entity: Parameter = { name: 'entity', label: 'Entity', kind: 'property', dataType: 'text', control: 'text' };

const noop = async () => ({});

export const BREAKDOWN_TYPES = ['mind.bdHeader', 'mind.bdAxis', 'mind.bdElement', 'mind.myMind'] as const;

export function makeBreakdownSpecs(): NodeSpec[] {
  return [
    {
      type: 'mind.bdHeader',
      label: 'Breakdown 360',
      sub: 'One world-class ad, made by HJEN — reverse-read',
      accent: BREAKDOWN_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        { name: 'title', label: 'Ad', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'brand', label: 'Brand', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'year', label: 'Year', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'logline', label: 'Logline', kind: 'property', dataType: 'text', control: 'textarea' },
        { name: 'heroPath', label: 'Hero frame', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'approved', label: 'Approved', kind: 'property', dataType: 'boolean', control: 'toggle', default: false },
        { name: 'breakdownSlug', label: 'Slug', kind: 'property', dataType: 'text', control: 'text' },
        entity,
      ],
      process: noop,
    },
    {
      type: 'mind.bdAxis',
      label: 'Axis',
      sub: 'One craft axis of the breakdown',
      accent: BREAKDOWN_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        { name: 'axisKey', label: 'Axis', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'title', label: 'Title', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'titleAr', label: 'Title (ar)', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'summary', label: 'Thesis', kind: 'property', dataType: 'text', control: 'textarea' },
        // newline-joined ABSOLUTE frame paths (AnswerBody refs pattern)
        { name: 'refs', label: 'Frames', kind: 'property', dataType: 'text', control: 'textarea' },
        entity,
      ],
      process: noop,
    },
    {
      type: 'mind.bdElement',
      label: 'Finding',
      sub: 'One atomic craft fact + its evidence',
      accent: BREAKDOWN_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        // finding | beat | pair | brief | reference | pitch — branches the body
        { name: 'kind', label: 'Kind', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'claim', label: 'Claim', kind: 'property', dataType: 'text', control: 'textarea' },
        { name: 'claimAr', label: 'Claim (ar)', kind: 'property', dataType: 'text', control: 'textarea' },
        { name: 'how', label: 'How HJEN makes it', kind: 'property', dataType: 'text', control: 'textarea' },
        { name: 'refs', label: 'Frames', kind: 'property', dataType: 'text', control: 'textarea' },
        { name: 'dimension', label: 'Dimension', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'weight', label: 'Weight', kind: 'property', dataType: 'text', control: 'text' },
        entity,
      ],
      process: noop,
    },
    {
      type: 'mind.myMind',
      label: 'My Mind',
      sub: 'Your curated pipeline DNA — drag findings in',
      accent: BREAKDOWN_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        { name: 'title', label: 'Title', kind: 'property', dataType: 'text', control: 'text', default: 'My Mind' },
        entity,
      ],
      process: noop,
    },
  ];
}
