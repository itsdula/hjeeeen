// تشريح الإعلان — canvas projection. Projects an installed AdBreakdown onto
// the thinking canvas as a 360 RING: the ad header at the hub, the 11 craft
// axes around it (findings fanning outward radially), and the reverse
// pipeline as a spine below, flowing RIGHT → LEFT (brief → beats → treatment
// → references → pitch) — visually reversed on purpose: this pipeline was
// reconstructed backwards from the finished film.
//
// Same discipline as sync.ts's materializeMind: breakdown.json is the source
// of truth, nodes are references matched by `entity` (positions survive
// re-open), and the canvas never writes back (except the approve seal, which
// goes through its own IPC in the body).

import type { NodeInstance, GraphEdge } from '../node-engine/types';
import { useStore } from '../../store';
import type { AdBreakdown, BreakdownElement } from '../creativemind/breakdown';
import { readBreakdown } from '../creativemind/breakdown';
import { MIND_NODE_SIZE } from './sizes';

let seq = 0;
const nid = () => `bd_${Date.now().toString(36)}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const HEADER = MIND_NODE_SIZE['mind.bdHeader'];
const AXIS = MIND_NODE_SIZE['mind.bdAxis'];
const EL = MIND_NODE_SIZE['mind.bdElement'];

const RING_R = 760;            // hub → axis-head distance
const FAN_R0 = 300;            // axis head → first finding row
const FAN_ROW = EL.h + 20;
const FAN_COL = EL.w + 18;
const SPINE_GAP_X = 90;        // between pipeline stage clusters
const SPINE_GAP_Y = 16;

export interface Materialized { nodes: NodeInstance[]; edges: GraphEdge[] }

interface Put {
  (type: string, ref: string, pos: { x: number; y: number }, params: Record<string, unknown>): string;
}

function elementParams(kind: string, e: BreakdownElement, paths: string[]): Record<string, unknown> {
  return {
    kind,
    claim: e.claim_en,
    claimAr: e.claim_ar ?? '',
    how: e.howHjenMakesIt ?? '',
    refs: paths.slice(0, 3).join('\n'),
    dimension: e.dimension ?? '',
    weight: e.weight ? String(e.weight) : '',
  };
}

/** Deterministic 360 layout + node/edge production for one breakdown. */
export function materializeBreakdown(bd: AdBreakdown, existing: NodeInstance[]): Materialized {
  const byRef = new Map<string, NodeInstance>();
  for (const n of existing) {
    const ref = typeof n.paramValues?.entity === 'string' ? (n.paramValues.entity as string) : '';
    if (ref) byRef.set(ref, n);
  }

  const nodes: NodeInstance[] = [];
  const edges: GraphEdge[] = [];
  const idOf = new Map<string, string>();

  const put: Put = (type, ref, pos, params) => {
    const prev = byRef.get(ref);
    const node: NodeInstance = {
      id: prev?.id ?? nid(),
      type,
      position: prev?.position ?? pos,
      paramValues: { ...prev?.paramValues, ...params, entity: ref },
      name: prev?.name,
      size: prev?.size,
    };
    nodes.push(node);
    idOf.set(ref, node.id);
    return node.id;
  };
  const wire = (fromRef: string, toRef: string) => {
    const from = idOf.get(fromRef);
    const to = idOf.get(toRef);
    if (!from || !to) return;
    edges.push({ id: nid(), from: { node: from, param: 'out' }, to: { node: to, param: 'in' } });
  };

  const frameFile = new Map(bd.frames.map(f => [f.id, f.file]));
  const paths = (ids: string[]) => ids.map(id => frameFile.get(id) ?? '').filter(Boolean);

  // ── hub: place the ring clear of existing non-breakdown content ──────────
  const others = existing.filter(n => !String(n.paramValues?.entity ?? '').startsWith('bd'));
  const baseX = others.length ? Math.max(...others.map(n => n.position.x)) : 0;
  const maxFan = FAN_R0 + Math.ceil(8 / 2) * FAN_ROW;   // deepest possible fan
  const cx = baseX + 700 + RING_R + maxFan;
  const cy = RING_R + maxFan + 120;

  const headerRef = `bdheader:${bd.slug}`;
  put('mind.bdHeader', headerRef, { x: cx - HEADER.w / 2, y: cy - HEADER.h / 2 }, {
    title: bd.ad.title,
    brand: bd.ad.brand,
    year: bd.ad.year ?? '',
    logline: bd.ad.logline_ar ?? bd.ad.logline_en ?? '',
    heroPath: paths(bd.pipeline.treatment.firstFrameId ? [bd.pipeline.treatment.firstFrameId] : bd.axes[0]?.heroFrameIds.slice(0, 1) ?? [])[0] ?? '',
    approved: !!bd.approved,
    breakdownSlug: bd.slug,
  });

  // ── the 11 axes on the ring, findings fanning outward ────────────────────
  bd.axes.forEach((axis, i) => {
    const ang = (-90 + i * (360 / bd.axes.length)) * Math.PI / 180;
    const ux = Math.cos(ang), uy = Math.sin(ang);       // radial unit
    const px = -uy, py = ux;                            // perpendicular unit
    const axisRef = `bdaxis:${bd.slug}/${axis.key}`;
    put('mind.bdAxis', axisRef, {
      x: cx + ux * RING_R - AXIS.w / 2,
      y: cy + uy * RING_R - AXIS.h / 2,
    }, {
      axisKey: axis.key,
      title: axis.title_en,
      titleAr: axis.title_ar,
      summary: axis.summary ?? '',
      refs: paths(axis.heroFrameIds).slice(0, 4).join('\n'),
    });
    wire(headerRef, axisRef);

    axis.findings.forEach((f, k) => {
      const col = k % 2, row = Math.floor(k / 2);
      const r = RING_R + FAN_R0 + row * FAN_ROW;
      const side = (col - 0.5) * FAN_COL;
      const ref = `bd:${f.id}`;
      put('mind.bdElement', ref, {
        x: cx + ux * r + px * side - EL.w / 2,
        y: cy + uy * r + py * side - EL.h / 2,
      }, elementParams('finding', f, paths(f.frameIds)));
      wire(axisRef, ref);
    });
  });

  // ── the reverse-pipeline spine, below the ring, flowing right → left ─────
  const p = bd.pipeline;
  const spineY = cy + RING_R + maxFan + 220;
  type Cluster = { cards: Array<{ ref: string; params: Record<string, unknown> }> };
  const clusters: Cluster[] = [
    { cards: [{ ref: `bd:${p.brief.id}`, params: {
        kind: 'brief',
        claim: p.brief.proposition,
        claimAr: '',
        how: `Big Idea "${p.brief.bigIdea.name}" — ${p.brief.bigIdea.hook}`,
        refs: '', dimension: '', weight: '3',
      } }] },
    { cards: p.beats.map(b => ({ ref: `bd:${b.id}`, params: {
        kind: 'beat',
        claim: b.visual,
        claimAr: '',
        how: b.vo ? `VO: ${b.vo}` : '',
        refs: paths(b.frameIds).slice(0, 3).join('\n'),
        dimension: b.beat, weight: '',
      } })) },
    { cards: [{ ref: `bd:${p.treatment.id}`, params: {
        kind: 'pair',
        claim: p.treatment.lookPhrase,
        claimAr: '',
        how: [
          `aspect ${p.treatment.choicePairs.aspect}`, `lens ${p.treatment.choicePairs.lens}`,
          `light ${p.treatment.choicePairs.lightDirection}`, `move ${p.treatment.choicePairs.cameraMove}`,
          `hour ${p.treatment.choicePairs.hour}`, `place ${p.treatment.choicePairs.placeRegister}`,
        ].join(' · '),
        refs: paths([p.treatment.firstFrameId, p.treatment.lastFrameId].filter((x): x is string => !!x)).join('\n'),
        dimension: '', weight: '3',
      } }] },
    { cards: p.references.map(r => ({ ref: `bd:${r.id}`, params: {
        kind: 'reference',
        claim: r.note, claimAr: '', how: '',
        refs: paths(r.frameIds).slice(0, 3).join('\n'),
        dimension: '', weight: '',
      } })) },
    { cards: p.pitch.map(pg => ({ ref: `bd:${pg.id}`, params: {
        kind: 'pitch',
        claim: pg.title, claimAr: '', how: pg.body,
        refs: paths(pg.frameId ? [pg.frameId] : []).join('\n'),
        dimension: '', weight: '',
      } })) },
  ];

  // right → left: brief sits rightmost, pitch leftmost (the backwards read)
  let right = cx + (clusters.length * (EL.w + SPINE_GAP_X)) / 2;
  for (const cluster of clusters) {
    const x = right - EL.w;
    cluster.cards.forEach((card, i) => {
      put('mind.bdElement', card.ref, { x, y: spineY + i * (EL.h + SPINE_GAP_Y) }, card.params);
    });
    right -= EL.w + SPINE_GAP_X;
  }

  // lineage wires: header → brief → beats → treatment → references / pitch
  const briefRef = `bd:${p.brief.id}`;
  wire(headerRef, briefRef);
  for (const b of p.beats) wire(briefRef, `bd:${b.id}`);
  const treatRef = `bd:${p.treatment.id}`;
  if (p.beats.length) wire(`bd:${p.beats[p.beats.length - 1].id}`, treatRef);
  else wire(briefRef, treatRef);
  for (const r of p.references) wire(treatRef, `bd:${r.id}`);
  for (const pg of p.pitch) wire(treatRef, `bd:${pg.id}`);

  return { nodes, edges };
}

/** Load one installed breakdown onto the ACTIVE canvas (importNotes
 *  discipline: nodes are references; breakdown.json stays the source).
 *  Re-loading the same breakdown refreshes params but keeps positions. */
export async function loadBreakdownOnCanvas(slug: string): Promise<boolean> {
  const bd = await readBreakdown(slug);
  if (!bd) return false;
  const s = useStore.getState();
  const mine = (n: NodeInstance) => {
    const ref = String(n.paramValues?.entity ?? '');
    return ref === `bdheader:${bd.slug}` ||
      ref.startsWith(`bdaxis:${bd.slug}/`) ||
      ref.startsWith(`bd:bd-${bd.slug}/`);
  };
  const prev = s.graphNodes.filter(mine);
  const keepNodes = s.graphNodes.filter(n => !mine(n));
  const keepIds = new Set(keepNodes.map(n => n.id));
  const keepEdges = s.graphEdges.filter(e => keepIds.has(e.from.node) && keepIds.has(e.to.node));
  const m = materializeBreakdown(bd, prev.length ? prev : keepNodes);
  useStore.setState({
    graphNodes: [...keepNodes, ...m.nodes],
    graphEdges: [...keepEdges, ...m.edges],
  });
  s.persistGraph();
  return true;
}
