// Mind node types — لوحة التفكير. Brief Mind's thinking line as canvas nodes
// (Flora-DNA: every thought is a block, wires are lineage). These specs are
// deliberately NON-generative for the GraphEngine (`process(){return {}}`) —
// mind canvases never call runGraph; the thinking machines fire through
// lib/mindcanvas/actions.ts instead, which spawns nodes + edges and writes
// stage 1 (the single source of truth).
//
// Every mind node exposes exactly ONE optional `in:any` + ONE `out:any` port,
// so the existing edge model, socket math, and wire rendering work untouched;
// edges here mean ANCESTRY (seed → collision → territory), not dataflow.
//
// Payload discipline: node properties hold plain strings (JSON-safe) — so
// graph persistence, undo, and MCP upsert all come free. `entity` holds the
// stage-1 reference `{kind}:{id}` used by lib/mindcanvas/sync.ts.

import type { NodeSpec, Parameter } from '../types';

export const MIND_ACCENT = '#0563E9';   // Brief Mind blue — one family, shades per role

const IO: Parameter[] = [
  { name: 'in', label: 'From', kind: 'input', dataType: 'any', optional: true },
  { name: 'out', label: 'To', kind: 'output', dataType: 'any' },
];

const entity: Parameter = { name: 'entity', label: 'Entity', kind: 'property', dataType: 'text', control: 'text' };

const noop = async () => ({});

export const MIND_TYPES = [
  'mind.brief', 'mind.proposition', 'mind.persona', 'mind.gaps',
  'mind.seed', 'mind.collision', 'mind.territory', 'mind.note', 'mind.answer',
] as const;

export function makeMindSpecs(): NodeSpec[] {
  return [
    {
      type: 'mind.brief',
      label: 'Brief',
      sub: 'The raw brief — where thinking starts',
      accent: MIND_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        { name: 'rawBrief', label: 'Raw brief', kind: 'property', dataType: 'text', control: 'textarea' },
        entity,
      ],
      process: noop,
    },
    {
      type: 'mind.proposition',
      label: 'Proposition',
      sub: 'One sentence, sold out loud',
      accent: MIND_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        { name: 'text', label: 'Proposition', kind: 'property', dataType: 'text', control: 'textarea' },
        entity,
      ],
      process: noop,
    },
    {
      type: 'mind.persona',
      label: 'Persona',
      sub: 'One named human, seen',
      accent: MIND_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        { name: 'text', label: 'Persona', kind: 'property', dataType: 'text', control: 'textarea' },
        entity,
      ],
      process: noop,
    },
    {
      type: 'mind.gaps',
      label: 'Gaps',
      sub: 'Client-ready questions',
      accent: MIND_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        // one gap per line — JSON-free editing
        { name: 'text', label: 'Gaps', kind: 'property', dataType: 'text', control: 'textarea' },
        entity,
      ],
      process: noop,
    },
    {
      type: 'mind.seed',
      label: 'Seed',
      sub: 'Saudi-DNA card — boring is good',
      accent: MIND_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        { name: 'cardId', label: 'Card', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'dimension', label: 'Dimension', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'ar', label: 'Arabic', kind: 'property', dataType: 'text', control: 'textarea' },
        { name: 'en', label: 'English', kind: 'property', dataType: 'text', control: 'textarea' },
        entity,
      ],
      process: noop,
    },
    {
      type: 'mind.collision',
      label: 'Collision',
      sub: 'The machines\' output — most are awful by design',
      accent: MIND_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        { name: 'machine', label: 'Machine', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'idea', label: 'Idea', kind: 'property', dataType: 'text', control: 'textarea' },
        { name: 'kept', label: 'Kept', kind: 'property', dataType: 'boolean', control: 'toggle', default: false },
        { name: 'seedRef', label: 'Seed', kind: 'property', dataType: 'text', control: 'text' },
        entity,
      ],
      process: noop,
    },
    {
      type: 'mind.territory',
      label: 'Territory',
      sub: 'Survived the kill-gate',
      accent: MIND_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        { name: 'name', label: 'Name', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'hook', label: 'Hook', kind: 'property', dataType: 'text', control: 'textarea' },
        { name: 'insight', label: 'Insight', kind: 'property', dataType: 'text', control: 'textarea' },
        { name: 'culturalTruth', label: 'Truth detail', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'big', label: 'Big Idea', kind: 'property', dataType: 'boolean', control: 'toggle', default: false },
        entity,
      ],
      process: noop,
    },
    {
      type: 'mind.note',
      label: 'Note',
      sub: 'A captured fleeting thought',
      accent: MIND_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        { name: 'text', label: 'Note', kind: 'property', dataType: 'text', control: 'textarea' },
        { name: 'dimension', label: 'Dimension', kind: 'property', dataType: 'text', control: 'text' },
        entity,
      ],
      process: noop,
    },
    {
      type: 'mind.answer',
      label: 'Answer',
      sub: 'A visual pick from the Creative Mind',
      accent: MIND_ACCENT,
      flow: 'data',
      params: [
        ...IO,
        { name: 'q', label: 'Question', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'a', label: 'Answer', kind: 'property', dataType: 'text', control: 'text' },
        { name: 'tags', label: 'Tags', kind: 'property', dataType: 'text', control: 'text' },
        entity,
      ],
      process: noop,
    },
  ];
}
