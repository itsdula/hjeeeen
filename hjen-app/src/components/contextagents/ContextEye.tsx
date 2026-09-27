// Context Eye — عين السياق. A hands-on LAB tool: the owner enters a STATE
// (register / beat / energy) + a GOAL, and the engine shows TWO columns side by
// side so he can judge, case by case, which reference is better. Two sources:
//
//   · Frameset (PRIMARY) — the vast online film-stills library. MAIN builds the
//     smart search query from the distilled criteria; the renderer harvests real
//     stills itself (the same hidden hunt Creative Mind uses); MAIN then runs the
//     VLM pixel-fit ranking over them. LEFT = the eye's VLM ranking, RIGHT = the
//     raw Frameset harvest order (the naive baseline). If Frameset is starved or
//     dry, we fall back to the local corpus so a result always shows.
//   · Local corpus (FALLBACK) — the thin offline REF library: metadata prefilter
//     → VLM pixel-confirm (eye) vs a keyword search (naive).
//
// House law: this view only calls the thin eye client (window.hjen.caEye*) plus
// the Frameset harvester (harvesting pixels, exactly like Creative Mind). It never
// scores, prefilters, or prompts — scoreFrame / pickForState / the query-builder /
// the VLM pixel-fit prompt all live in electron/contextAgents.ts. Dumb terminal.

import { useEffect, useState } from 'react';
import '../../styles/contextagents.css';
import { useStore } from '../../store';
import { hjenFileUrl } from '../../lib/theme/apply';
import { eyePick, eyeQuery, eyeConfirmFrames, eyeJudge, eyeStatus, eyeVocab } from '../../lib/contextagents/eye';
import { framesetBoardLadder, evictFramesetQuery, isFramesetStarved, openFramesetLogin, resetFramesetSession } from '../../lib/creativemind/framesetHunt';
import type { CAEyePickResult, CAEyeFrame, CANaiveFrame, CAVocab } from '../../types/hjen-bridge';

type Verdict = 'eye' | 'naive' | 'tie';
type Source = 'frameset' | 'local';
// where the shown result came from — drives the column labels + the attribution
type ResultSource = 'frameset' | 'local' | 'local-fallback';
type Phase = 'query' | 'harvest' | 'looking' | null;

// ── one real reference frame card (corpus or Frameset) ───────────────────────

function FrameCard({ src, caption, badge, alt }: {
  src: string; caption?: string; badge?: string; alt?: string;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <figure className="cae-frame">
      <div className="cae-frame__img">
        {broken
          ? <span className="cae-frame__missing mono-label">frame unavailable</span>
          : <img src={src} alt={alt || ''} loading="lazy" onError={() => setBroken(true)} />}
        {badge && <span className="cae-frame__fit mono-label" title="VLM pixel-fit 0–5">{badge}</span>}
      </div>
      {caption && <figcaption className="cae-frame__meta selectable" dir="auto">{caption}</figcaption>}
    </figure>
  );
}

// ── the EYE column (hero — VLM-ranked, fit badges) ───────────────────────────

function EyeColumn({ frames, ar, en }: { frames: CAEyeFrame[]; ar: string; en: string }) {
  return (
    <section className="cae-col cae-col--eye">
      <header className="cae-col__head">
        <span className="cae-col__ar" dir="rtl">{ar}</span>
        <span className="cae-col__en mono-label">{en}</span>
      </header>
      {frames.length === 0
        ? <p className="cae-col__none mono-label">no pick</p>
        : (
          <div className="cae-grid">
            {frames.map(f => (
              <FrameCard
                key={f.id}
                src={hjenFileUrl(f.filePath)}
                alt={f.place || f.brand}
                badge={`fit ${f.fitScore}`}
                caption={f.why || '—'}
              />
            ))}
          </div>
        )}
    </section>
  );
}

// ── the NAIVE / RAW column (control — no ranking) ────────────────────────────

function NaiveColumn({ frames, ar, en }: { frames: CANaiveFrame[]; ar: string; en: string }) {
  return (
    <section className="cae-col cae-col--naive">
      <header className="cae-col__head">
        <span className="cae-col__ar" dir="rtl">{ar}</span>
        <span className="cae-col__en mono-label">{en}</span>
      </header>
      {frames.length === 0
        ? <p className="cae-col__none mono-label">no match</p>
        : (
          <div className="cae-grid">
            {frames.map(f => (
              <FrameCard
                key={f.id}
                src={hjenFileUrl(f.filePath)}
                alt={f.place || f.brand}
                caption={[f.brand, f.place].filter(Boolean).join(' · ') || '—'}
              />
            ))}
          </div>
        )}
    </section>
  );
}

// ── root ─────────────────────────────────────────────────────────────────────

export function ContextEye() {
  const setActiveView = useStore(s => s.setActiveView);

  const [vocab, setVocab] = useState<CAVocab | null>(null);
  const [status, setStatus] = useState<{ corpusFrames: number; criteriaRegisters: string[] } | null>(null);

  const [source, setSource] = useState<Source>('frameset');   // Frameset is PRIMARY
  const [register, setRegister] = useState('');
  const [beat, setBeat] = useState('setup');
  const [energy, setEnergy] = useState('quiet');
  const [goal, setGoal] = useState('');

  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [result, setResult] = useState<CAEyePickResult | null>(null);
  const [resultSource, setResultSource] = useState<ResultSource | null>(null);
  const [notice, setNotice] = useState(false);               // Frameset needs sign-in
  const [error, setError] = useState<string | null>(null);
  const [judged, setJudged] = useState<Verdict | null>(null);

  useEffect(() => {
    void eyeVocab().then(v => setVocab(v)).catch(() => undefined);
    void eyeStatus().then(s => { if (s.ok) setStatus({ corpusFrames: s.corpusFrames, criteriaRegisters: s.criteriaRegisters }); }).catch(() => undefined);
  }, []);

  const ready = !!register && !busy;

  // Run the local-corpus two-column eye (also the Frameset fallback). Returns
  // true when it produced a result, so the caller can mark the source.
  const runLocal = async (fromFallback: boolean): Promise<boolean> => {
    const r = await eyePick({ register, beat, energy, goal: goal.trim() });
    if (r.ok) { setResult(r); setResultSource(fromFallback ? 'local-fallback' : 'local'); return true; }
    setError(r.message || r.reason || 'The eye could not look.');
    return false;
  };

  // The Frameset harvest → confirm → render pipeline. ONE code path, called by
  // SEE (after eyeQuery resolves the query) AND by the manual re-search / fresh-
  // stills buttons (with the owner's current, possibly edited, query). It never
  // re-calls eyeQuery — the caller owns the query text and the owner's edit wins.
  // Owns its own busy/phase/finally, so a button can call it directly. Skips the
  // 'query' phase — the query is already set — going straight to harvest → look.
  const runFramesetSearch = async (queryText: string): Promise<void> => {
    const q = queryText.trim();
    if (!q) return;
    setBusy(true); setError(null); setResult(null); setResultSource(null);
    setJudged(null); setNotice(false);
    try {
      // (b) harvest a WIDE pool of real film stills (the renderer's hidden hunt)
      setPhase('harvest');
      const harvested = await framesetBoardLadder(
        { query: q, en: goal.trim() || q, tags: q.split(' ').slice(0, 3) },
        12,
      );

      // de-dup by filePath so repeats never waste a VLM call
      const seen = new Set<string>();
      const pool = harvested.filter(f => (seen.has(f.filePath) ? false : (seen.add(f.filePath), true)));

      // starved or too thin → notice + automatic corpus fallback (a result always shows)
      if (pool.length < 2 || isFramesetStarved()) {
        setNotice(true);
        setPhase('looking');
        await runLocal(true);
        return;
      }

      // (c) VLM pixel-fit ranking over the FULL de-duped pool (MAIN returns its top 4)
      setPhase('looking');
      const conf = await eyeConfirmFrames({
        register, beat, energy, goal: goal.trim(),
        frames: pool.map(f => ({ id: f.id, filePath: f.filePath })),
      });
      if (!conf.ok) {
        // ranking failed — fall back to corpus so a result always shows
        setNotice(false);
        if (!(await runLocal(true))) setError(conf.message || conf.reason || 'The eye could not look.');
        return;
      }

      // (d) LEFT = VLM ranking · RIGHT = the raw Frameset harvest order (first 4 of the de-duped pool)
      const raw: CANaiveFrame[] = pool.slice(0, 4).map(f => ({ id: f.id, filePath: f.filePath, place: f.title }));
      setResult({ ok: true, eye: conf.eye ?? [], naive: raw, state: conf.state });
      setResultSource('frameset');
    } catch (e: any) {
      setError(String(e?.message || e).slice(0, 200));
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  const see = async () => {
    // ── local corpus path (unchanged) ────────────────────────────────────
    if (source === 'local') {
      setBusy(true); setError(null); setResult(null); setResultSource(null);
      setJudged(null); setNotice(false); setQuery(null); setPhase(null);
      try { await runLocal(false); }
      catch (e: any) { setError(String(e?.message || e).slice(0, 200)); }
      finally { setBusy(false); setPhase(null); }
      return;
    }

    // ── Frameset (PRIMARY) ───────────────────────────────────────────────
    // (a) the smart query MAIN builds from the distilled criteria — fill the
    // editable query input, then hand off to the shared harvest→confirm path.
    setBusy(true); setError(null); setResult(null); setResultSource(null);
    setJudged(null); setNotice(false); setQuery(null); setPhase('query');
    let resolved = register;
    try {
      const q = await eyeQuery({ register, beat, energy, goal: goal.trim() });
      resolved = (q.ok && q.query) ? q.query : register;
    } catch (e: any) {
      setError(String(e?.message || e).slice(0, 200));
      setBusy(false); setPhase(null);
      return;
    }
    setQuery(resolved);
    await runFramesetSearch(resolved);
  };

  // Manual re-hunt: drop this query's per-session cache, then re-run the shared
  // pipeline on the CURRENT (possibly edited) query. Backs both buttons — "Search
  // this" (owner edited the query) and "Fresh stills" (same query, new pick): a
  // cleared cache + the hunt's random draw yields different stills either way.
  const reSearch = (queryText: string): void => {
    const q = queryText.trim();
    if (!q || busy) return;
    evictFramesetQuery(q);
    void runFramesetSearch(q);
  };

  // login opens the real hunt Chrome AND resets the session so the next SEE
  // retries Frameset (mirrors Creative Mind's signInFrameset).
  const signIn = () => {
    openFramesetLogin();
    resetFramesetSession();
    setNotice(false);
  };

  const judge = async (verdict: Verdict) => {
    if (!result || noSignal) return;
    // attribute the verdict to its source so the accumulation stays honest
    const note = resultSource ? `[src:${resultSource}]` : '';
    const g = [goal.trim(), note].filter(Boolean).join(' ');
    await eyeJudge({
      state: result.state ?? null,
      goal: g,
      verdict,
      eyeIds: (result.eye ?? []).map(f => f.id),
      naiveIds: (result.naive ?? []).map(f => f.id),
    }).catch(() => undefined);
    setJudged(verdict);
    setResult(null); // clear for the next case
  };

  const rows: Array<{ label: string; ar: string; value: string; set: (v: string) => void; opts: string[] }> = [
    { label: 'Register', ar: 'الإحساس', value: register, set: setRegister, opts: vocab?.registers ?? [] },
    { label: 'Beat', ar: 'موضع القصة', value: beat, set: setBeat, opts: vocab?.beats ?? [] },
    { label: 'Energy', ar: 'الطاقة', value: energy, set: setEnergy, opts: vocab?.energies ?? [] },
  ];

  const criteriaHas = !!register && (status?.criteriaRegisters.includes(register) ?? true);

  // A pair carries NO SIGNAL when the ranking was flat (every candidate scored
  // the same, so the eye column is just the input order) or when both columns
  // literally hold the same frames. Judging one of these writes a line that
  // teaches the eye nothing — which is all eye_judgments.jsonl holds today.
  const noSignal = (() => {
    if (!result) return false;
    if (result.degenerate) return true;
    const a = (result.eye ?? []).map(f => f.id).sort().join('|');
    const b = (result.naive ?? []).map(f => f.id).sort().join('|');
    return !!a && a === b;
  })();

  const isFrameset = resultSource === 'frameset';
  // human name for the source that produced the shown result
  const sourceLabel = resultSource === 'frameset'
    ? 'Frameset + VLM'
    : resultSource === 'local-fallback'
      ? 'المكتبة المحلية (بديل عن Frameset)'
      : 'المكتبة المحلية';

  const phaseAr = phase === 'harvest' ? 'أبحث في Frameset…' : phase === 'query' ? 'أبني الاستعلام…' : 'العين تنظر…';
  const phaseEn = phase === 'harvest'
    ? 'harvesting real film stills from Frameset'
    : phase === 'query'
      ? 'building the smart search query'
      : 'the eye is looking — reading the pixels of each candidate';

  return (
    <div className="ca cae">
      <div className="ca-top drag-region">
        <button className="ca-back no-drag" onClick={() => setActiveView('studio')}>‹ Studio</button>
        <div className="ca-brand no-drag">
          <span className="ca-brand__dot" />
          <span className="ca-brand__ar" dir="auto">عين السياق</span>
          <span className="ca-brand__en mono-label">Context Eye</span>
        </div>
        <span className="ca-top__spacer" />
        <button className="ca-back no-drag" onClick={() => setActiveView('ca-studio')} title="The client-facing engine">Studio ›</button>
        <button className="ca-back no-drag" onClick={() => setActiveView('ca-trainer')} title="Curate the method library">Trainer ›</button>
      </div>

      <div className="ca-scroll">
        {/* source toggle — Frameset is PRIMARY */}
        <div className="cae-source">
          <span className="cae-source__label mono-label" dir="rtl">المصدر · source</span>
          <div className="cae-seg" role="group" aria-label="Reference source">
            <button
              className={`cae-seg__btn${source === 'frameset' ? ' is-on' : ''}`}
              aria-pressed={source === 'frameset'}
              disabled={busy}
              onClick={() => setSource('frameset')}
            >
              Frameset
              <span className="cae-seg__hint mono-label">the vast library</span>
            </button>
            <button
              className={`cae-seg__btn${source === 'local' ? ' is-on' : ''}`}
              aria-pressed={source === 'local'}
              disabled={busy}
              onClick={() => setSource('local')}
            >
              المكتبة المحلية
              <span className="cae-seg__hint mono-label">offline corpus</span>
            </button>
          </div>
        </div>

        {/* readiness line */}
        <div className="cae-status mono-label selectable" dir="ltr">
          <span>corpus {status ? status.corpusFrames.toLocaleString() : '…'} frames</span>
          <span className="cae-status__sep">·</span>
          <span>{status ? `${status.criteriaRegisters.length} registers with criteria` : 'reading criteria…'}</span>
          {!!register && !criteriaHas && (
            <span className="cae-status__warn" dir="auto">— no criteria for “{register}” yet, the query falls back to the register word</span>
          )}
        </div>

        {/* the case: state + goal + SEE */}
        <section className="cae-controls">
          <div className="cae-controls__rows">
            {rows.map(r => (
              <label key={r.label} className="ca-field">
                <span className="ca-field__label mono-label">{r.label} · {r.ar}</span>
                <select className="ca-select" value={r.value} onChange={e => r.set(e.target.value)} disabled={busy}>
                  {r.label === 'Register' && <option value="" disabled>—</option>}
                  {r.opts.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            ))}
          </div>
          <label className="ca-field ca-field--wide">
            <span className="ca-field__label mono-label">The goal · الهدف</span>
            <textarea
              className="ca-textarea"
              dir="auto"
              rows={2}
              value={goal}
              placeholder="وش تبي المرجع يوصله؟ — اكتب هدف اللقطة بجملة (اختياري)"
              onChange={e => setGoal(e.target.value)}
              disabled={busy}
            />
          </label>
          <div className="cae-controls__actions">
            <button className="ca-btn ca-btn--primary" onClick={() => void see()} disabled={!ready}>
              {busy ? 'Looking…' : 'SEE · أرِني'}
            </button>
            {!register && !busy && (
              <span className="cae-hint mono-label" dir="rtl">اختر الإحساس أولاً</span>
            )}
            {judged && !busy && (
              <span className="cae-logged" dir="auto">
                logged ✓ — {judged === 'eye' ? 'العين أفضل' : judged === 'naive' ? 'الساذج أفضل' : 'متساويان'} · pick the next case
              </span>
            )}
          </div>
        </section>

        {/* Frameset sign-in notice (starved / dry) — a result still shows via fallback */}
        {notice && !busy && (
          <div className="cae-notice" role="status" dir="rtl">
            <span className="cae-notice__ar">Frameset يحتاج تسجيل دخول — عرضنا لك بديلاً من المكتبة المحلية.</span>
            <button className="cae-notice__btn" onClick={signIn}>سجّل الدخول</button>
          </div>
        )}

        {/* loading */}
        {busy && (
          <div className="cae-loading" role="status">
            <span className="cae-spinner" aria-hidden="true" />
            <span className="cae-loading__ar" dir="rtl">{phaseAr}</span>
            <span className="cae-loading__en mono-label">{phaseEn}</span>
          </div>
        )}

        {/* result — two columns to judge */}
        {result && !busy && (
          <>
            <div className="cae-caseline mono-label selectable" dir="ltr">
              {result.state && `${result.state.register} · ${result.state.beat} · ${result.state.energy}`}
              {goal.trim() && <span className="cae-caseline__goal" dir="auto"> — {goal.trim()}</span>}
            </div>

            {/* editable query + manual re-hunt · source attribution */}
            <div className="cae-meta selectable" dir="auto">
              {query !== null && (
                <form
                  className="cae-qedit"
                  onSubmit={e => { e.preventDefault(); reSearch(query ?? ''); }}
                >
                  <span className="cae-qedit__label mono-label" dir="rtl">استعلام · query</span>
                  <input
                    className="cae-qedit__input selectable"
                    dir="ltr"
                    value={query ?? ''}
                    spellCheck={false}
                    placeholder="edit the search query…"
                    aria-label="Frameset search query"
                    onChange={e => setQuery(e.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="submit"
                    className="ca-btn ca-btn--ghost cae-qedit__btn"
                    disabled={busy || !(query ?? '').trim()}
                    title="Harvest Frameset again for this exact query"
                  >
                    ابحث بهذا <span className="cae-qedit__en">· Search this</span>
                  </button>
                  {isFrameset && (
                    <button
                      type="button"
                      className="ca-btn ca-btn--ghost cae-qedit__btn"
                      onClick={() => reSearch(query ?? '')}
                      disabled={busy || !(query ?? '').trim()}
                      title="Re-hunt Frameset for new stills on the same query"
                    >
                      لقطات جديدة <span className="cae-qedit__en">· Fresh stills</span>
                    </button>
                  )}
                </form>
              )}
              {resultSource && (
                <span className="cae-meta__src" dir="auto">المصدر: {sourceLabel}</span>
              )}
            </div>

            <div className="cae-columns">
              <EyeColumn
                frames={result.eye ?? []}
                ar={isFrameset ? 'العين — Frameset' : 'العين'}
                en={isFrameset ? 'The Eye · Frameset + VLM' : 'The Eye · metadata → pixels'}
              />
              <NaiveColumn
                frames={result.naive ?? []}
                ar={isFrameset ? 'Frameset الخام' : 'الساذج'}
                en={isFrameset ? 'Frameset · raw harvest order' : 'Naive · keyword match'}
              />
            </div>

            {noSignal ? (
              <div className="cae-judge cae-judge--void" role="status">
                <span className="cae-judge__q mono-label" dir="rtl">لا حكم هنا — العمودان متطابقان</span>
                <span className="cae-judge__en">
                  The ranking was flat, so both columns hold the same frames in the same order.
                  Nothing to compare — look again rather than record a verdict that teaches nothing.
                </span>
              </div>
            ) : (
              <div className="cae-judge" role="group" aria-label="Judge which column is better">
                <span className="cae-judge__q mono-label" dir="rtl">أيّهما أفضل؟</span>
                <button className="ca-btn ca-btn--primary" onClick={() => void judge('eye')}>
                  العين أفضل <span className="cae-judge__en">· Eye</span>
                </button>
                <button className="ca-btn ca-btn--ghost" onClick={() => void judge('tie')}>
                  متساويان <span className="cae-judge__en">· Tie</span>
                </button>
                <button className="ca-btn ca-btn--ghost" onClick={() => void judge('naive')}>
                  {isFrameset ? 'الخام أفضل' : 'الساذج أفضل'} <span className="cae-judge__en">· {isFrameset ? 'Raw' : 'Naive'}</span>
                </button>
              </div>
            )}
          </>
        )}

        {/* empty state — before the first look */}
        {!result && !busy && !judged && (
          <div className="cae-empty">
            <p className="cae-empty__ar" dir="rtl">اختر إحساس المشهد وموضعه وطاقته، واكتب الهدف — ثم اضغط «أرِني»</p>
            <p className="cae-empty__en mono-label">
              The eye picks a REAL reference for a feeling — from Frameset first, the local corpus as fallback.
              Judge its VLM ranking against the raw order — your verdicts accumulate.
            </p>
          </div>
        )}
      </div>

      {/* status strip */}
      <div className="ca-statusbar" role="status">
        <span className={`ca-statusbar__dot${busy ? ' is-live' : ''}`} aria-hidden="true" />
        <span className="ca-statusbar__stage mono-label">
          {busy
            ? (phase === 'harvest' ? 'Harvesting Frameset · أبحث في Frameset' : 'The eye is looking · العين تنظر')
            : result ? 'Judge the two columns · احكم' : 'Pick a feeling · اختر الإحساس'}
        </span>
      </div>

      {error && <div className="ca-error" role="alert">{error}</div>}
    </div>
  );
}
