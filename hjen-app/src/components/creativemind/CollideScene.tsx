// Seeds → Collision. Two stages under one roof:
//   seeds    — the drawn Saudi-DNA cards as physical cards, evidence frames
//              fanned behind each; reroll any, then "Collide ×10".
//   collide  — the ten+ logged collisions scattered as a golden-angle
//              constellation around a center hub; keep the survivors, then
//              "Press into territories".

import { useMemo } from 'react';
import { useCreativeMind } from '../../store/creativeMindStore';
import { ALL_CARDS } from '../../lib/compiler';
import type { KnowledgeCard } from '../../lib/compiler';
import type { BriefCollision } from '../../types/preprod';
import { MACHINE_LABEL, MACHINES } from '../../lib/creativemind/engine';
import { useAr, useLangMode } from '../../lib/lang/translate';
import { hjenFileUrl } from '../../lib/theme/apply';

// ── seeds ──────────────────────────────────────────────────────────────────

function SeedCard({ card, idx }: { card: KnowledgeCard; idx: number }) {
  const frames = useCreativeMind(s => s.cardFrames[card.id]) ?? [];
  const rerollCard = useCreativeMind(s => s.rerollCard);
  // Natively bilingual (no LLM) — 'en' shows English only, 'ar' Arabic only,
  // 'both' both. Always fall back to the language that exists.
  const mode = useLangMode();
  const showEn = !!card.en && (mode !== 'ar' || !card.ar);
  const showAr = !!card.ar && (mode !== 'en' || !card.en);

  return (
    <div className="cmind-seed">
      <div className="cmind-seed__evidence" aria-hidden="true">
        {frames.slice(0, 3).map(r => (
          <img key={r.id} src={hjenFileUrl(r.filePath)} alt="" loading="lazy" decoding="async" />
        ))}
      </div>
      <div className="cmind-seed__card">
        <span className="cmind-seed__dim mono-label">{card.dimension}</span>
        {showEn && <span className="cmind-seed__en">{card.en}</span>}
        {showAr && <span className="cmind-seed__ar" dir="rtl">{card.ar}</span>}
        <div className="cmind-seed__foot">
          <span className="cmind-seed__id">{card.id}</span>
          <button
            type="button"
            className="cmind-reroll"
            onClick={() => rerollCard(idx)}
            aria-label="Reroll this seed"
            title="Reroll"
          >⟲</button>
        </div>
      </div>
    </div>
  );
}

function SeedsStage({ cards }: { cards: KnowledgeCard[] }) {
  const collide = useCreativeMind(s => s.collide);
  const busy = useCreativeMind(s => s.busy);

  return (
    <section className="cmind-scene cmind-collide">
      <header className="cmind-collide__head">
        <h1 className="cmind-collide__en">The seeds</h1>
        <span className="cmind-collide__ar" dir="rtl">البذور</span>
        <span className="cmind-collide__desc mono-label">
          {cards.length} seeds drawn from your visual world — reroll any, then collide
        </span>
      </header>

      <div className="cmind-seeds">
        {cards.map((c, i) => <SeedCard key={c.id} card={c} idx={i} />)}
      </div>

      <footer className="cmind-collide__foot">
        {busy ? (
          <span className="cmind-busy"><span className="cmind-busy__ring" />Running the machines…</span>
        ) : (
          <button className="cmind-btn cmind-btn--primary" onClick={() => void collide()} disabled={cards.length === 0}>
            Collide ×10
          </button>
        )}
      </footer>
    </section>
  );
}

// ── collision grid ───────────────────────────────────────────────────────────
//
// Ordered, readable composition (Anwar 2026-07-11): the golden-angle
// constellation overlapped 10–16 chips into an unreadable pile, so the ideas
// are grouped by machine into labelled columns instead — no overlap, full idea
// text, the column carries the FUNNEL/COLLIDE/INVERT/TRANSFORM label. Empty
// machines are skipped so uneven runs never leave a dead column.

// One collision chip — read-only idea text, with the content-language treatment.
// 'ar' → Arabic reads primary, the English source kept small beneath; 'both' →
// an Arabic line under the English; 'en' → English only. While a translation is
// in flight the English shows alone (never a blank).
function CollCard({ c, idx }: { c: BriefCollision; idx: number }) {
  const toggleKeep = useCreativeMind(s => s.toggleKeep);
  const mode = useLangMode();
  const ar = useAr(c.idea);
  const arPrimary = mode === 'ar' && !!ar;
  const primary = arPrimary ? ar! : c.idea;
  const alt = arPrimary ? c.idea : (mode === 'both' ? ar : null);
  return (
    <button
      type="button"
      className={`cmind-coll-card${c.kept ? ' is-kept' : ''}`}
      onClick={() => toggleKeep(idx)}
      aria-pressed={c.kept}
    >
      <span
        className={`cmind-coll-card__idea${arPrimary ? ' cmind-coll-card__idea--ar' : ''}`}
        dir={arPrimary ? 'rtl' : 'auto'}
      >{primary}</span>
      {alt && (
        <span
          className={arPrimary ? 'cmind-coll-card__idea-en' : 'cmind-coll-card__idea-ar'}
          dir={arPrimary ? 'auto' : 'rtl'}
        >{alt}</span>
      )}
      <span className="cmind-coll-card__keep">{c.kept ? 'Kept' : 'Keep'}</span>
    </button>
  );
}

function CollideStage() {
  const collisions = useCreativeMind(s => s.collisions);
  const press = useCreativeMind(s => s.press);
  const busy = useCreativeMind(s => s.busy);

  const kept = collisions.filter(c => c.kept).length;

  // group by machine, preserving each idea's original index for toggleKeep;
  // drop machines with no ideas so the grid stays dense.
  const groups = useMemo(() =>
    MACHINES
      .map(machine => ({
        machine,
        items: collisions.map((c, i) => ({ c, i })).filter(x => x.c.machine === machine),
      }))
      .filter(g => g.items.length > 0),
    [collisions]);

  return (
    <section className="cmind-scene cmind-collide">
      <header className="cmind-collide__head">
        <h1 className="cmind-collide__en">The collision</h1>
        <span className="cmind-collide__ar" dir="rtl">التصادم</span>
        <span className="cmind-collide__desc mono-label">
          Keep the ones that land in a majlis — kill the rest
        </span>
      </header>

      <div className="cmind-collide-grid" style={{ ['--cmind-coll-cols' as any]: groups.length }}>
        {groups.map(g => (
          <div className="cmind-coll-col" key={g.machine}>
            <div className="cmind-coll-col__head">
              <span className="cmind-coll-col__label mono-label">{MACHINE_LABEL[g.machine]}</span>
              <span className="cmind-coll-col__count">{g.items.length}</span>
            </div>
            <div className="cmind-coll-col__cards">
              {g.items.map(({ c, i }) => <CollCard key={i} c={c} idx={i} />)}
            </div>
          </div>
        ))}
      </div>

      <footer className="cmind-collide__foot">
        <div className="cmind-counter">
          <b>{kept}</b> kept / {collisions.length} logged
          {collisions.length < 10 && <span className="cmind-counter__hint"> · the collider runs a quota of ten</span>}
        </div>
        {busy ? (
          <span className="cmind-busy"><span className="cmind-busy__ring" />Pressing the survivors…</span>
        ) : (
          <button className="cmind-btn cmind-btn--primary" onClick={() => void press()} disabled={kept === 0}>
            Press into territories
          </button>
        )}
      </footer>
    </section>
  );
}

// ── router ───────────────────────────────────────────────────────────────────

export function CollideScene() {
  const stage = useCreativeMind(s => s.stage);
  const drawnCardIds = useCreativeMind(s => s.drawnCardIds);
  const collisions = useCreativeMind(s => s.collisions);

  const cards = useMemo(() => {
    const byId = new Map(ALL_CARDS.map(c => [c.id, c]));
    return drawnCardIds.map(id => byId.get(id)).filter((c): c is KnowledgeCard => !!c);
  }, [drawnCardIds]);

  // 'collide' stage but no collisions yet (first run still in flight) → keep the
  // seeds visible with their busy line rather than an empty starfield.
  if (stage === 'collide' && collisions.length > 0) return <CollideStage />;
  return <SeedsStage cards={cards} />;
}
