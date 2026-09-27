// لوحة التفكير — rich node bodies. Each mind node type renders its thought
// in-place (Flora-DNA: the block IS the content), editing BOTH canvas state
// (setNodeParam) AND stage 1 (applyNodeEdit) on every change. The data layer
// (mind.ts / actions.ts / sync.ts) is the source of truth — these are its face.
//
// Sizing is FIXED per type (MIND_NODE_SIZE): the card height can't be content-
// driven because the wire endpoints anchor to the card's vertical center, and a
// growing card would desync the sockets. So bodies fit their box; the collision
// "expand" is a hover overlay, never a taller card.

import { useCallback, useEffect, useRef, type CSSProperties, type FC } from 'react';
import { useStore } from '../../store';
import type { NodeInstance } from '../../lib/node-engine/types';
import { parseEntity, applyNodeEdit } from '../../lib/mindcanvas/sync';
import { analyzeFromCanvas, rerollSeedOnCanvas, useMindCanvas } from '../../lib/mindcanvas/actions';
import { MACHINE_LABEL } from '../../lib/creativemind/engine';
import { useAr, useLangMode } from '../../lib/lang/translate';
import { BREAKDOWN_BODIES } from './breakdownBodies';

// Per-type card box — the ONE source of truth lives in lib/mindcanvas/sizes.ts
// so the body renderer, the arrange engine, and marquee hit-testing never drift.
// (w tunes the reading measure; h is FIXED so socket dots at CSS top:50% and
// wire endpoints at node.y + h/2 stay locked together.)
export { MIND_NODE_SIZE } from '../../lib/mindcanvas/sizes';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const sentences = (t: string): string[] => t.split(/[.!؟?…]+/).map(s => s.trim()).filter(Boolean);

// ── edit hook: fold one param change into BOTH canvas + stage 1 ──────────────
function useMindEdit(nodeId: string, entity: unknown) {
  const setNodeParam = useStore(s => s.setNodeParam);
  return useCallback((param: string, value: unknown) => {
    setNodeParam(nodeId, param, value);
    const st = useStore.getState();
    const ref = parseEntity(entity);
    if (st.activeProjectId && ref) {
      const name = st.projects.find(p => p.id === st.activeProjectId)?.name;
      applyNodeEdit(st.activeProjectId, name, ref, param, value);
    }
  }, [nodeId, entity, setNodeParam]);
}

// ── لغة العرض — the Arabic reading layer inside a node body ──────────────────
// A TRANSLATION of the English source (Settings → Content language), never the
// editable copy. Renders nothing in 'en' mode, while a translation is still in
// flight, or when the source is already Arabic — so the English never blanks.
// Joined-letters law: serif face via CSS, dir="rtl", never a mono/tracked class.
// Cards are FIXED height (sockets anchor at h/2), so every line clamps.

/** Reading line appended UNDER an editable English field (proposition, persona,
 *  gaps, territory hook/insight). In 'ar' mode it reads as the primary line. */
const ArLine: FC<{ text: string; clamp?: number }> = ({ text, clamp }) => {
  const mode = useLangMode();
  const ar = useAr(text);
  if (!ar) return null;
  const primary = mode === 'ar';
  return (
    <div
      className={`nv-mind__arline${primary ? ' nv-mind__arline--primary' : ''}`}
      dir="rtl"
      style={{ WebkitLineClamp: clamp ?? (primary ? 4 : 2) } as CSSProperties}
    >{ar}</div>
  );
};

/** Read-only text that flips its primary language by mode: 'ar' → Arabic is the
 *  main read with the English source kept small beneath it; 'both' → English
 *  stays primary with an Arabic reading line under it; 'en' → English only. */
const ReadText: FC<{ text: string; cls: string; clamp?: number }> = ({ text, cls, clamp }) => {
  const mode = useLangMode();
  const ar = useAr(text);
  if (mode === 'ar' && ar) {
    return (
      <>
        <div className={cls} dir="rtl">{ar}</div>
        <div className="nv-mind__src-small" dir="auto">{text}</div>
      </>
    );
  }
  return (
    <>
      <div className={cls} dir="auto">{text}</div>
      {mode === 'both' && ar && (
        <div className="nv-mind__arline" dir="rtl" style={{ WebkitLineClamp: clamp ?? 3 } as CSSProperties}>{ar}</div>
      )}
    </>
  );
};

// ── brief ────────────────────────────────────────────────────────────────────
const BriefBody: FC<{ node: NodeInstance }> = ({ node }) => {
  const edit = useMindEdit(node.id, node.paramValues.entity);
  const busy = useMindCanvas(s => s.busy);
  const raw = str(node.paramValues.rawBrief);
  const analyzing = busy === 'analyze';
  return (
    <>
      <textarea
        className="nv-mind__ta nv-mind__ta--grow nodrag" dir="auto"
        value={raw}
        onChange={e => edit('rawBrief', e.target.value)}
        placeholder="Paste the brief as it arrived — the email, the call notes, the deck text. What it leaves unsaid is more dangerous than what it says."
      />
      <button
        className="nv-mind__go nodrag"
        disabled={!!busy || !raw.trim()}
        onClick={() => void analyzeFromCanvas(node)}
      >{analyzing ? 'Reading…' : 'Read the brief'}</button>
      {analyzing && <div className="nv-mind__busy mono-label">Compressing the truth — this takes a moment.</div>}
    </>
  );
};

// ── proposition ──────────────────────────────────────────────────────────────
const PropositionBody: FC<{ node: NodeInstance }> = ({ node }) => {
  const edit = useMindEdit(node.id, node.paramValues.entity);
  const text = str(node.paramValues.text);
  return (
    <>
      <textarea
        className="nv-mind__ta nv-mind__ta--grow nodrag" dir="auto"
        value={text}
        onChange={e => edit('text', e.target.value)}
        placeholder="One sentence a stranger could sell out loud in any room."
      />
      <ArLine text={text} clamp={3} />
      {sentences(text).length > 1 && (
        <div className="nv-mind__warn mono-label">More than one sentence — not a proposition yet.</div>
      )}
    </>
  );
};

// ── persona ──────────────────────────────────────────────────────────────────
const PersonaBody: FC<{ node: NodeInstance }> = ({ node }) => {
  const edit = useMindEdit(node.id, node.paramValues.entity);
  const text = str(node.paramValues.text);
  return (
    <>
      <textarea
        className="nv-mind__ta nv-mind__ta--grow nodrag" dir="auto"
        value={text}
        onChange={e => edit('text', e.target.value)}
        placeholder="One named human — name, age, city, one daily behaviour, one thing they mock."
      />
      <ArLine text={text} clamp={2} />
    </>
  );
};

// ── gaps ─────────────────────────────────────────────────────────────────────
const GapsBody: FC<{ node: NodeInstance }> = ({ node }) => {
  const edit = useMindEdit(node.id, node.paramValues.entity);
  const text = str(node.paramValues.text);
  const count = text.split('\n').map(x => x.trim()).filter(Boolean).length;
  return (
    <>
      <textarea
        className="nv-mind__ta nv-mind__ta--grow nodrag" dir="auto"
        value={text}
        onChange={e => edit('text', e.target.value)}
        placeholder="One client-ready question per line — the things the brief left unsaid."
      />
      <ArLine text={text} clamp={3} />
      <div className="nv-mind__count mono-label">{count} {count === 1 ? 'gap' : 'gaps'}</div>
    </>
  );
};

// ── seed (read-only card + reroll) ──────────────────────────────────────────
const SeedBody: FC<{ node: NodeInstance }> = ({ node }) => {
  const mode = useLangMode();
  const dim = str(node.paramValues.dimension);
  const ar = str(node.paramValues.ar);
  const en = str(node.paramValues.en);
  // Natively bilingual — no LLM. 'en' → English only, 'ar' → Arabic only,
  // 'both' → both. Fall back to Arabic if the language it wants is missing.
  const showAr = mode !== 'en' || !en;
  const showEn = !!en && (mode !== 'ar' || !ar);
  return (
    <>
      <span className="nv-mind__dim mono-label">{dim || 'Saudi-DNA card'}</span>
      {showAr && <div className="nv-mind__ar" dir="rtl">{ar}</div>}
      {showEn && <div className={`nv-mind__en${!showAr ? ' nv-mind__en--solo' : ''}`} dir="auto">{en}</div>}
      <div className="nv-mind__seedfoot">
        <button className="nv-mind__reroll nodrag" title="Re-draw this card"
          onClick={() => void rerollSeedOnCanvas(node)}>⟲ Reroll</button>
      </div>
    </>
  );
};

// ── collision (read-only idea + KEEP toggle on body click) ──────────────────
const CollisionBody: FC<{ node: NodeInstance }> = ({ node }) => {
  const edit = useMindEdit(node.id, node.paramValues.entity);
  const mode = useLangMode();
  const idea = str(node.paramValues.idea);
  const machine = str(node.paramValues.machine);
  const kept = !!node.paramValues.kept;
  const ar = useAr(idea);
  const arPrimary = mode === 'ar' && !!ar;
  const primary = arPrimary ? ar! : idea;
  // 'both' → Arabic line under the English; 'ar' → the English source kept
  // small under the Arabic. While a translation is in flight, English only.
  const alt = arPrimary ? idea : (mode === 'both' ? ar : null);
  return (
    <div className="nv-mind-col" onClick={() => edit('kept', !kept)}>
      <span className="nv-mind__machine mono-label">{MACHINE_LABEL[machine as keyof typeof MACHINE_LABEL] ?? machine}</span>
      <div className="nv-mind__idea" dir={arPrimary ? 'rtl' : 'auto'} style={{ WebkitLineClamp: alt ? 2 : 4 } as CSSProperties}>{primary}</div>
      {alt && (
        <div
          className={arPrimary ? 'nv-mind__src-small' : 'nv-mind__arline'}
          dir={arPrimary ? 'auto' : 'rtl'}
          style={arPrimary ? undefined : ({ WebkitLineClamp: 2 } as CSSProperties)}
        >{alt}</div>
      )}
      <div className="nv-mind__ideafull" dir={arPrimary ? 'rtl' : 'auto'}>
        {primary}
        {alt && <span className="nv-mind__ideafull-alt" dir={arPrimary ? 'auto' : 'rtl'}>{alt}</span>}
      </div>
      <span className={`nv-mind__keep mono-label ${kept ? 'is-on' : ''}`}>{kept ? '✓ Kept' : 'Keep'}</span>
    </div>
  );
};

// ── territory (editable + Big-Idea seal) ────────────────────────────────────
const TerritoryBody: FC<{ node: NodeInstance }> = ({ node }) => {
  const edit = useMindEdit(node.id, node.paramValues.entity);
  const setNodeParam = useStore(s => s.setNodeParam);
  const big = !!node.paramValues.big;
  const pickBig = () => {
    if (big) return;
    // radio semantics: clear every sibling territory on the canvas (visual),
    // stage bigIdea is repointed by this node's applyNodeEdit('big', true).
    for (const n of useStore.getState().graphNodes) {
      if (n.type === 'mind.territory' && n.id !== node.id && n.paramValues.big) setNodeParam(n.id, 'big', false);
    }
    edit('big', true);
  };
  return (
    <>
      <input className="nv-mind__in nv-mind__name nodrag" dir="auto"
        value={str(node.paramValues.name)} placeholder="Territory name"
        onChange={e => edit('name', e.target.value)} />
      <label className="nv-mind__flabel mono-label">Hook · said in a majlis</label>
      <textarea className="nv-mind__ta nodrag" dir="auto" rows={2}
        value={str(node.paramValues.hook)} onChange={e => edit('hook', e.target.value)} />
      <ArLine text={str(node.paramValues.hook)} clamp={2} />
      <label className="nv-mind__flabel mono-label">Insight</label>
      <textarea className="nv-mind__ta nodrag" dir="auto" rows={2}
        value={str(node.paramValues.insight)} onChange={e => edit('insight', e.target.value)} />
      <ArLine text={str(node.paramValues.insight)} clamp={2} />
      <label className="nv-mind__flabel mono-label">Cultural truth</label>
      <input className="nv-mind__in nodrag" dir="auto"
        value={str(node.paramValues.culturalTruth)} placeholder="name / place / year / gesture"
        onChange={e => edit('culturalTruth', e.target.value)} />
      <button className={`nv-mind__seal nodrag ${big ? 'is-on' : ''}`} onClick={pickBig}>
        <span className="nv-mind__sealdot" />{big ? 'The Big Idea' : 'Mark as Big Idea'}
      </button>
    </>
  );
};

// ── note (read-only zettel) ──────────────────────────────────────────────────
const NoteBody: FC<{ node: NodeInstance }> = ({ node }) => {
  const dim = str(node.paramValues.dimension);
  return (
    <>
      <ReadText text={str(node.paramValues.text)} cls="nv-mind__notetext" />
      {dim && <span className="nv-mind__chip mono-label">{dim}</span>}
    </>
  );
};

// ── answer (read-only visual pick) ──────────────────────────────────────────
// The reference frames the answer stood on are part of the visual mind, not
// hidden provenance — a tight 2×2 thumb grid renders below the Q/A text.
// (hjen-file:// serves the board AVIFs directly.)
const AnswerBody: FC<{ node: NodeInstance }> = ({ node }) => {
  const tags = str(node.paramValues.tags).split(',').map(t => t.trim()).filter(Boolean);
  const refs = str(node.paramValues.refs).split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4);
  return (
    <>
      <span className="nv-mind__q mono-label" dir="auto">{str(node.paramValues.q)}</span>
      <ReadText text={str(node.paramValues.a)} cls="nv-mind__a" />

      {refs.length > 0 && (
        <div className="nv-mind__refs" data-count={refs.length}>
          {refs.map((p, i) => (
            <img key={i} className="nv-mind__ref" src={`hjen-file://${encodeURI(p)}`} alt="" draggable={false} loading="lazy" />
          ))}
        </div>
      )}
      {tags.length > 0 && (
        <div className="nv-mind__tags">
          {tags.map((t, i) => <span key={i} className="nv-mind__chip mono-label">{t}</span>)}
        </div>
      )}
    </>
  );
};

// ── free text — BARE thought on the canvas (no card, no title bar) ───────────
// On the mind canvas the Text tool writes directly: display state is just the
// words; edit state is a transparent auto-growing textarea. Escape/blur commits
// (the value is already live via setNodeParam). Instrument Serif carries latin,
// the Arabic system stack carries Arabic (dir=auto), matching the moodboard feel.
function autoGrow(el: HTMLTextAreaElement) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }

export const MindFreeText: FC<{ node: NodeInstance; editing: boolean; onCommit: () => void }> = ({ node, editing, onCommit }) => {
  const setNodeParam = useStore(s => s.setNodeParam);
  const text = str(node.paramValues.text);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) return;
    const el = taRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    autoGrow(el);
  }, [editing]);
  if (editing) {
    return (
      <textarea
        ref={taRef} className="nv-freetext__ta nodrag" dir="auto" value={text}
        placeholder="Write a thought…"
        onPointerDown={e => e.stopPropagation()}
        onChange={e => { setNodeParam(node.id, 'text', e.target.value); autoGrow(e.target); }}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onCommit(); } }}
        onBlur={onCommit}
      />
    );
  }
  return (
    <div className="nv-freetext__txt" dir="auto">
      {text || <span className="nv-freetext__ph">Write a thought…</span>}
    </div>
  );
};

export const MIND_BODIES: Record<string, FC<{ node: NodeInstance }>> = {
  'mind.brief': BriefBody,
  'mind.proposition': PropositionBody,
  'mind.persona': PersonaBody,
  'mind.gaps': GapsBody,
  'mind.seed': SeedBody,
  'mind.collision': CollisionBody,
  'mind.territory': TerritoryBody,
  'mind.note': NoteBody,
  'mind.answer': AnswerBody,
  // تشريح الإعلان — Ad Breakdown 360 (header / axis / element / My Mind)
  ...BREAKDOWN_BODIES,
};
