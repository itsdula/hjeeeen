// My Mind — عقلي. The user's curated pipeline DNA: an on-canvas frame that
// collects elements DRAGGED OUT of Ad Breakdowns. Copy-on-drag semantics —
// the breakdown stays intact (it is the approval artifact); the copy is
// denormalized into {projectsRoot}/_mind/mymind.json (cross-project, backed
// up on write) and rendered as a mind.bdElement carrying entity 'mm:<id>'.

import { useStore } from '../../store';
import type { NodeInstance } from '../node-engine/types';
import type { MyMindItem, AxisKey } from '../creativemind/breakdown';
import { loadMyMind, saveMyMind } from '../creativemind/breakdown';
import { MIND_NODE_SIZE, sizeOfNode } from './sizes';

const EL = MIND_NODE_SIZE['mind.bdElement'];
const FRAME = MIND_NODE_SIZE['mind.myMind'];
const BAR_H = 30;            // keep in step with NodeView's GROUP_BAR_H
const PAD = 20;

let seq = 0;
const nid = () => `mm_${Date.now().toString(36)}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function itemParams(it: MyMindItem): Record<string, unknown> {
  return {
    kind: 'finding',
    claim: it.claim_en,
    claimAr: it.claim_ar ?? '',
    how: it.howHjenMakesIt ?? '',
    refs: (it.framePaths ?? []).slice(0, 3).join('\n'),
    dimension: it.dimension ?? '',
    weight: '',
    entity: `mm:${it.id}`,
  };
}

/** Grid spot for the i-th item INSIDE the frame. */
function slot(frame: NodeInstance, i: number): { x: number; y: number } {
  const w = frame.size?.w ?? FRAME.w;
  const perRow = Math.max(1, Math.floor((w - PAD * 2) / (EL.w + 16)));
  return {
    x: frame.position.x + PAD + (i % perRow) * (EL.w + 16),
    y: frame.position.y + BAR_H + PAD + Math.floor(i / perRow) * (EL.h + 16),
  };
}

/** The My Mind button: spawn the frame if missing, then materialize every
 *  saved item that isn't already on this canvas. Cross-project by design —
 *  the same collection appears on any project's mind canvas. */
export async function openMyMindOnCanvas(): Promise<void> {
  const s = useStore.getState();
  let frame = s.graphNodes.find(n => n.type === 'mind.myMind');
  const nodes = [...s.graphNodes];
  if (!frame) {
    const maxX = nodes.length ? Math.max(...nodes.map(n => n.position.x + sizeOfNode(n).w)) : 0;
    const minY = nodes.length ? Math.min(...nodes.map(n => n.position.y)) : 0;
    frame = {
      id: nid(),
      type: 'mind.myMind',
      position: { x: maxX + 160, y: Math.max(minY, 60) },
      paramValues: { title: 'My Mind', entity: 'mm:frame' },
    };
    nodes.push(frame);
  }
  const items = await loadMyMind();
  const have = new Set(nodes.map(n => str(n.paramValues?.entity)));
  let idx = nodes.filter(n => str(n.paramValues?.entity).startsWith('mm:') && n.type === 'mind.bdElement').length;
  for (const it of items) {
    if (have.has(`mm:${it.id}`)) continue;
    nodes.push({
      id: nid(),
      type: 'mind.bdElement',
      position: slot(frame, idx++),
      paramValues: itemParams(it),
    });
  }
  // grow the frame to hold its grid
  const rows = Math.ceil(idx / Math.max(1, Math.floor(((frame.size?.w ?? FRAME.w) - PAD * 2) / (EL.w + 16))));
  const needH = BAR_H + PAD * 2 + Math.max(1, rows) * (EL.h + 16);
  if (needH > (frame.size?.h ?? FRAME.h)) frame.size = { w: frame.size?.w ?? FRAME.w, h: needH };
  useStore.setState({ graphNodes: nodes });
  s.persistGraph();
}

/** Axis segment out of an element id 'bd-<slug>/<axis-or-stage>/<nn>'. */
function axisOf(elementId: string): { axis?: AxisKey | 'pipeline'; stage?: string } {
  const parts = elementId.split('/');
  if (parts.length < 2) return {};
  if (parts[1] === 'pipeline') return { axis: 'pipeline', stage: parts[2] ?? '' };
  return { axis: parts[1] as AxisKey };
}

/** Copy-on-drop: a bd element was released inside a My Mind frame.
 *  1) append the denormalized item to mymind.json, 2) spawn an mm node where
 *  it was dropped, 3) snap the ORIGINAL back to its pre-drag position. */
export async function copyIntoMyMind(
  drops: Array<{ node: NodeInstance; back: { x: number; y: number } }>,
): Promise<void> {
  const s = useStore.getState();
  const headerBySlug = new Map(
    s.graphNodes.filter(n => n.type === 'mind.bdHeader')
      .map(n => [str(n.paramValues.breakdownSlug), n]),
  );
  const items = await loadMyMind();
  const known = new Set(items.map(i => i.source.elementId));
  const newNodes: NodeInstance[] = [];
  const snap: Array<{ id: string; pos: { x: number; y: number } }> = [];

  for (const { node, back } of drops) {
    const entity = str(node.paramValues.entity);          // 'bd:bd-<slug>/…'
    const elementId = entity.slice(3);
    const slug = elementId.startsWith('bd-') ? elementId.slice(3).split('/')[0] : '';
    const header = headerBySlug.get(slug);
    snap.push({ id: node.id, pos: back });
    if (known.has(elementId)) continue;                   // already collected — just snap back
    known.add(elementId);
    const { axis, stage } = axisOf(elementId);
    const item: MyMindItem = {
      id: `mm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      source: {
        breakdownId: `bd-${slug}`, breakdownSlug: slug, elementId,
        adTitle: str(header?.paramValues.title), brand: str(header?.paramValues.brand),
        axis, stage,
      },
      claim_en: str(node.paramValues.claim),
      claim_ar: str(node.paramValues.claimAr) || undefined,
      howHjenMakesIt: str(node.paramValues.how) || undefined,
      framePaths: str(node.paramValues.refs).split('\n').map(x => x.trim()).filter(Boolean),
      dimension: str(node.paramValues.dimension) || undefined,
      tags: undefined,
      addedAt: new Date().toISOString(),
    };
    items.push(item);
    newNodes.push({
      id: nid(),
      type: 'mind.bdElement',
      position: node.position,          // lands exactly where the user dropped it
      paramValues: itemParams(item),
    });
  }

  await saveMyMind(items);
  const st = useStore.getState();
  const moved = st.graphNodes.map(n => {
    const hit = snap.find(x => x.id === n.id);
    return hit ? { ...n, position: hit.pos } : n;
  });
  useStore.setState({ graphNodes: [...moved, ...newNodes] });
  st.persistGraph();
}
