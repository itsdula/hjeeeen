// Territories → Sign. The pressed survivors arrive as three full-bleed boards;
// the user seals one as the Big Idea, says why, and presses-and-holds to write
// it into the contract. The stage carries it from here.

import { useMemo, useRef, useState } from 'react';
import { useCreativeMind } from '../../store/creativeMindStore';
import { useStore } from '../../store';
import type { BoardFrame } from '../../lib/creativemind/framesetHunt';
import { hjenFileUrl } from '../../lib/theme/apply';
import { CmindAr } from './CmindAr';

// ── territories ─────────────────────────────────────────────────────────────

function TerritoriesStage() {
  const territories = useCreativeMind(s => s.territories);
  const bigIdea = useCreativeMind(s => s.bigIdea);
  const answers = useCreativeMind(s => s.answers);
  const boards = useCreativeMind(s => s.boards);
  const pickBigIdea = useCreativeMind(s => s.pickBigIdea);
  const setBigIdeaWhy = useCreativeMind(s => s.setBigIdeaWhy);
  const goSign = useCreativeMind(s => s.goSign);

  const [page, setPage] = useState(0);

  // resolve the session's visual world: the frames behind the answers the user
  // actually picked — the territory is dressed in the world they built.
  const pool = useMemo(() => {
    const wanted = new Set(answers.flatMap(a => a.refIds));
    const seen = new Set<string>();
    const out: BoardFrame[] = [];
    for (const arr of Object.values(boards)) {
      for (const r of arr) {
        if (wanted.has(r.id) && !seen.has(r.id)) { seen.add(r.id); out.push(r); }
      }
    }
    return out;
  }, [answers, boards]);

  if (territories.length === 0) return null;
  const t = territories[Math.min(page, territories.length - 1)];
  const isBig = bigIdea?.territory === t.name;
  const bg = pool.slice(page * 2, page * 2 + 6);

  return (
    <section className="cmind-scene cmind-terr">
      {bg.length > 0 ? (
        <div className="cmind-terr__bg" aria-hidden="true">
          {bg.map(r => <img key={r.id} src={hjenFileUrl(r.filePath)} alt="" loading="lazy" decoding="async" />)}
        </div>
      ) : (
        <div className="cmind-terr__bg cmind-terr__bg--empty" aria-hidden="true" />
      )}
      <div className="cmind-terr__scrim" aria-hidden="true" />

      <div className="cmind-terr__body">
        <div className="cmind-terr__lower">
          <span className="cmind-terr__eyebrow mono-label">Territory {page + 1} / {territories.length}</span>
          <h1 className="cmind-terr__name" dir="auto">{t.name}</h1>
          <CmindAr text={t.name} />
          {t.hook && <p className="cmind-terr__hook" dir="auto">{t.hook}</p>}
          <CmindAr text={t.hook} />
          {t.insight && <p className="cmind-terr__insight" dir="auto">{t.insight}</p>}
          <CmindAr text={t.insight} />
          {t.culturalTruth && (
            <span className="cmind-terr__truth" dir="auto"><b>truth</b> {t.culturalTruth}</span>
          )}
          <CmindAr text={t.culturalTruth} />

          <div className="cmind-terr__seal">
            <button
              type="button"
              className={`cmind-seal-radio${isBig ? ' is-on' : ''}`}
              onClick={() => pickBigIdea(t.name)}
              aria-pressed={isBig}
            >
              <span className="cmind-seal-radio__mark" />
              {isBig ? 'The Big Idea' : 'Seal as the Big Idea'}
            </button>
          </div>

          {isBig && (
            <>
              <textarea
                className="cmind-why"
                value={bigIdea?.why ?? ''}
                onChange={e => setBigIdeaWhy(e.target.value)}
                placeholder="Why this one — two lines the room will remember"
                dir="auto"
              />
              <CmindAr text={bigIdea?.why} />
            </>
          )}
        </div>

        <div className="cmind-terr__nav">
          <div className="cmind-terr__tabs">
            {territories.map((tt, i) => (
              <button
                key={i}
                type="button"
                className={`cmind-tab${i === page ? ' is-live' : ''}`}
                onClick={() => setPage(i)}
                aria-label={`Territory ${i + 1}: ${tt.name}`}
              >
                <span className="cmind-tab__n">{i + 1}</span>
              </button>
            ))}
          </div>
          <div className="cmind-terr__pager">
            <button className="cmind-arrow" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous territory">‹</button>
            <button className="cmind-arrow" onClick={() => setPage(p => Math.min(territories.length - 1, p + 1))} disabled={page === territories.length - 1} aria-label="Next territory">›</button>
            <button
              className="cmind-btn cmind-btn--primary"
              onClick={goSign}
              disabled={!bigIdea?.territory}
              style={{ marginLeft: 'var(--s-3)' }}
            >
              Continue to sign
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── sign (press-and-hold) ────────────────────────────────────────────────────

const HOLD_MS = 700;

function SignStage({ projectName }: { projectName?: string }) {
  const sign = useCreativeMind(s => s.sign);
  const busy = useCreativeMind(s => s.busy);
  const bigIdea = useCreativeMind(s => s.bigIdea);

  const btnRef = useRef<HTMLButtonElement>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const holdingRef = useRef(false);

  const setP = (p: number) => btnRef.current?.style.setProperty('--p', String(p));

  const stop = (reset: boolean) => {
    holdingRef.current = false;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (reset) setP(0);
  };

  const start = () => {
    if (busy || holdingRef.current) return;
    holdingRef.current = true;
    startRef.current = performance.now();
    const tick = (now: number) => {
      if (!holdingRef.current) return;
      const p = Math.min(1, (now - startRef.current) / HOLD_MS);
      setP(p);
      if (p >= 1) { stop(false); void sign(projectName); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  return (
    <section className="cmind-scene cmind-sign">
      <div className="cmind-sign__inner">
        <span className="cmind-sign__eyebrow mono-label">Stage 01 · the Big Idea</span>
        <h1 className="cmind-sign__title" dir="auto">{bigIdea?.territory || 'Sign the direction'}</h1>
        <p className="cmind-sign__sub">Press and hold to sign — the contract carries it from here.</p>
        <button
          ref={btnRef}
          className="cmind-hold"
          onPointerDown={start}
          onPointerUp={() => stop(true)}
          onPointerLeave={() => stop(true)}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } }}
          onKeyUp={e => { if (e.key === 'Enter' || e.key === ' ') stop(true); }}
          disabled={busy}
          aria-label="Press and hold to sign the Big Idea"
        >
          <span className="cmind-hold__ring" aria-hidden="true" />
          <span className="cmind-hold__core">
            {busy ? (
              <span className="cmind-busy__ring" />
            ) : (
              <>
                <span className="cmind-hold__en">SIGN</span>
                <span className="cmind-hold__ar" dir="rtl">وقّع</span>
              </>
            )}
          </span>
        </button>
      </div>
    </section>
  );
}

// ── done ─────────────────────────────────────────────────────────────────────

function DoneStage() {
  const setActiveView = useStore(s => s.setActiveView);
  const bigIdea = useCreativeMind(s => s.bigIdea);
  return (
    <section className="cmind-scene cmind-done">
      <div className="cmind-done__inner">
        <span className="cmind-done__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 6.5" /></svg>
        </span>
        <span className="mono-label" style={{ color: 'var(--ink-muted)' }}>Signed · {bigIdea?.territory || 'Big Idea'}</span>
        <h1 className="cmind-done__h" dir="auto">Stage 01 signed — the contract carries it now.</h1>
        <div className="cmind-done__actions">
          <button className="cmind-btn cmind-btn--primary" onClick={() => setActiveView('brief')}>Open Brief Mind</button>
          <button className="cmind-btn cmind-btn--ghost" onClick={() => setActiveView('studio')}>Back to Studio</button>
        </div>
      </div>
    </section>
  );
}

// ── router ───────────────────────────────────────────────────────────────────

export function TerritoryScene({ projectName }: { projectName?: string }) {
  const stage = useCreativeMind(s => s.stage);
  const signed = useCreativeMind(s => s.signed);

  if (stage === 'done' || signed) return <DoneStage />;
  if (stage === 'sign') return <SignStage projectName={projectName} />;
  return <TerritoriesStage />;
}
