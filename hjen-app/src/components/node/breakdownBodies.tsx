// Ad Breakdown 360 — node bodies. تشريح الإعلان rendered on the thinking
// canvas: the header (ad identity + the made-by-HJEN premise + the approve
// seal), one card per craft axis (thesis + frame strip), one card per atomic
// finding (claim + evidence + the HJEN control that makes it). All read-only
// toward breakdown.json — the file is the source; these are its face.
// Sizing law is mindBodies' law: fixed boxes, images crop, hover reveals full.

import { type FC } from 'react';
import { useStore } from '../../store';
import type { NodeInstance } from '../../lib/node-engine/types';
import { parseEntity } from '../../lib/mindcanvas/sync';
import { approveBreakdown } from '../../lib/creativemind/breakdown';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const fileUrl = (p: string) => `hjen-file://${encodeURI(p)}`;

// ── header — ad identity + premise + Anwar's seal on the SHAPE ──────────────
const BdHeaderBody: FC<{ node: NodeInstance }> = ({ node }) => {
  const setNodeParam = useStore(s => s.setNodeParam);
  const hero = str(node.paramValues.heroPath);
  const approved = !!node.paramValues.approved;
  const slug = str(node.paramValues.breakdownSlug);
  const seal = () => {
    const next = !approved;
    setNodeParam(node.id, 'approved', next);
    if (slug) void approveBreakdown(slug, next);
  };
  return (
    <>
      {hero && <img className="nv-bd__hero" src={fileUrl(hero)} alt="" draggable={false} loading="lazy" />}
      <div className="nv-bd__idrow">
        <span className="nv-bd__brand mono-label">{str(node.paramValues.brand)}</span>
        {str(node.paramValues.year) && <span className="nv-bd__year mono-label">{str(node.paramValues.year)}</span>}
      </div>
      <div className="nv-bd__title" dir="auto">{str(node.paramValues.title)}</div>
      <div className="nv-bd__premise mono-label" dir="rtl">هذا الإعلان صُنع بهجين — قراءة عكسية</div>
      <button className={`nv-mind__seal nodrag ${approved ? 'is-on' : ''}`} onClick={seal}>
        <span className="nv-mind__sealdot" />{approved ? 'Shape approved' : 'Approve the shape'}
      </button>
    </>
  );
};

// ── axis head — one craft axis: thesis + representative frame strip ─────────
const BdAxisBody: FC<{ node: NodeInstance }> = ({ node }) => {
  const refs = str(node.paramValues.refs).split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4);
  return (
    <>
      <div className="nv-bd__axisrow">
        <span className="nv-bd__axis mono-label">{str(node.paramValues.title)}</span>
        <span className="nv-bd__axisar" dir="rtl">{str(node.paramValues.titleAr)}</span>
      </div>
      <div className="nv-bd__summary" dir="auto">{str(node.paramValues.summary)}</div>
      {refs.length > 0 && (
        <div className="nv-bd__strip" data-count={refs.length}>
          {refs.map((p, i) => (
            <img key={i} className="nv-mind__ref" src={fileUrl(p)} alt="" draggable={false} loading="lazy" />
          ))}
        </div>
      )}
    </>
  );
};

// ── element — ONE atomic fact; the whole card drags (MIND_READONLY) ─────────
// kind: finding | beat | pair | brief | reference | pitch
const KIND_LABEL: Record<string, string> = {
  finding: '', beat: 'Beat', pair: 'Choice pairs', brief: 'Reverse brief',
  reference: 'Reference', pitch: 'Pitch page',
};
const BdElementBody: FC<{ node: NodeInstance }> = ({ node }) => {
  const kind = str(node.paramValues.kind) || 'finding';
  const dim = str(node.paramValues.dimension);
  const claim = str(node.paramValues.claim);
  const claimAr = str(node.paramValues.claimAr);
  const how = str(node.paramValues.how);
  const weight = Number(node.paramValues.weight) || 0;
  const refs = str(node.paramValues.refs).split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3);
  const chip = KIND_LABEL[kind] || dim;
  return (
    <div className="nv-bd-el">
      <div className="nv-bd__elhead">
        {chip && <span className="nv-mind__chip mono-label">{chip}</span>}
        {weight > 0 && (
          <span className="nv-bd__weight" title={`weight ${weight}`}>
            {'●'.repeat(weight)}{'○'.repeat(Math.max(0, 3 - weight))}
          </span>
        )}
      </div>
      {claimAr && <div className="nv-bd__claimar" dir="rtl">{claimAr}</div>}
      <div className="nv-bd__claim" dir="auto">{claim}</div>
      {refs.length > 0 && (
        <div className="nv-bd__strip nv-bd__strip--sm" data-count={refs.length}>
          {refs.map((p, i) => (
            <img key={i} className="nv-mind__ref" src={fileUrl(p)} alt="" draggable={false} loading="lazy" />
          ))}
        </div>
      )}
      {how && <div className="nv-bd__how mono-label" dir="auto">⌁ {how}</div>}
      {/* hover reveal — the full fact, uncropped (collision's ideafull pattern) */}
      <div className="nv-bd__full" dir="auto">
        {claimAr && <div className="nv-bd__claimar" dir="rtl">{claimAr}</div>}
        <div>{claim}</div>
        {how && <div className="nv-bd__how mono-label">⌁ {how}</div>}
      </div>
    </div>
  );
};

// ── My Mind body (Phase B spawns it as a frame; body used if rendered small) ─
const MyMindBody: FC<{ node: NodeInstance }> = ({ node }) => (
  <div className="nv-bd__mymind" dir="auto">
    {str(node.paramValues.title) || 'My Mind'}
    <span className="nv-bd__mymindhint">Drag findings from any breakdown into this frame.</span>
  </div>
);

export const BREAKDOWN_BODIES: Record<string, FC<{ node: NodeInstance }>> = {
  'mind.bdHeader': BdHeaderBody,
  'mind.bdAxis': BdAxisBody,
  'mind.bdElement': BdElementBody,
  'mind.myMind': MyMindBody,
};

/** Provenance line for the inspector — which ad/axis an element came from. */
export function breakdownEntityLabel(node: NodeInstance): string {
  const ref = parseEntity(node.paramValues.entity);
  return ref ? `${ref.kind}:${ref.id}` : '';
}
