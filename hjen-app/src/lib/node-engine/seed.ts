// The default board: the canonical HJEN product family laid out, with a cheap,
// reliable default wiring (Frame → Output) so pressing Run out-of-the-box makes
// one real frame using only the core OpenAI key. Source / Enhancer / Video sit
// ready on the board (isolated = skipped until the user wires them in).

import type { NodeInstance, GraphEdge } from './types';

const SEED_PROMPT =
  'A Saudi man in his early thirties waiting on a quiet train platform at first light, documentary realism, composed warmth.';

export function seedGraph(): { nodes: NodeInstance[]; edges: GraphEdge[] } {
  const nodes: NodeInstance[] = [
    { id: 'seed-source', type: 'source', position: { x: 80, y: 150 }, paramValues: {} },
    { id: 'seed-frame', type: 'frame', position: { x: 360, y: 110 }, paramValues: { prompt: SEED_PROMPT } },
    { id: 'seed-enhancer', type: 'enhancer', position: { x: 640, y: 110 }, paramValues: { fidelity: 0.7, clarityPass: false } },
    { id: 'seed-video', type: 'video', position: { x: 920, y: 220 }, paramValues: { prompt: '', resolution: '720p', duration: 5, ratio: '16:9' } },
    { id: 'seed-output', type: 'output', position: { x: 1200, y: 150 }, paramValues: { deliver: true } },
  ];
  const edges: GraphEdge[] = [
    { id: 'seed-e1', from: { node: 'seed-frame', param: 'out' }, to: { node: 'seed-output', param: 'asset' } },
  ];
  return { nodes, edges };
}
