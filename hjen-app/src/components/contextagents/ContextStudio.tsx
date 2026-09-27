// Context Studio — العميل يجرّب. The client-facing page of the Context Agents
// engine: a beginner answers three IMPRESSION questions by picking a picture
// that conveys a feeling (never the technical vocabulary), names a goal, and
// the engine returns three finished outputs — each retrieved method paired with
// a reference board so the beginner reads the output right.
//
// Two scenes on store.stage:
//   'questions' → three picture-questions (register / beat / energy) + goal +
//                 profile → MAKE. An advanced toggle swaps pictures for plain
//                 dropdowns for the professional.
//   'result'   → ① الهدف · ② التطوير · ③ النصّ, above them the retrieved
//                 methods as Lock cards, each with its own evidence board.
//
// House law: this view only calls engine.caApply (through the store); it never
// scores, thresholds, or prompts — the recipe lives in MAIN. Arabic content
// register per the app convention (creative/campaign-facing, like Creative Mind).

import { useEffect, useState } from 'react';
import '../../styles/contextagents.css';
import { useStore } from '../../store';
import { useContextAgents } from '../../store/contextAgentsStore';
import { IMPRESSION_QUESTIONS, type ImpressionQuestion } from '../../lib/contextagents/impressions';
import type { CACard, CAVocab } from '../../types/hjen-bridge';
import { vocab as loadVocab } from '../../lib/contextagents/engine';
import { RefBoard } from './RefBoard';
import type { BoardFrame } from '../../store/contextAgentsStore';

// ── one picture-question (register / beat / energy) ─────────────────────────

function ImpressionScene({ q }: { q: ImpressionQuestion }) {
  const boards = useContextAgents(s => s.boards);
  const state = useContextAgents(s => s.state);
  const answer = useContextAgents(s => s.answer);
  const picked = state[q.axis];

  return (
    <section className="ca-q">
      <header className="ca-q__head">
        <h2 className="ca-q__en">{q.en}</h2>
        <span className="ca-q__ar" dir="rtl">{q.ar}</span>
      </header>
      <div className="ca-boards" style={{ ['--ca-cols' as any]: q.options.length >= 5 ? 3 : q.options.length }}>
        {q.options.map(o => (
          <RefBoard
            key={o.id}
            frames={boards[`${q.axis}:${o.id}`]}
            en={o.en}
            ar={o.ar}
            meaning={o.meaning}
            chips={o.tags}
            selected={picked === o.value}
            onPick={() => answer(q.axis, o.id)}
          />
        ))}
      </div>
    </section>
  );
}

// ── advanced mode — three plain dropdowns (the professional bypass) ─────────

function AdvancedScene({ vocab }: { vocab: CAVocab | null }) {
  const state = useContextAgents(s => s.state);
  const setAxis = useContextAgents(s => s.setAxis);
  const rows: Array<{ axis: 'register' | 'beat' | 'energy'; label: string; ar: string; opts: string[] }> = [
    { axis: 'register', label: 'Register', ar: 'الإحساس', opts: vocab?.registers ?? [] },
    { axis: 'beat', label: 'Beat', ar: 'موضع القصة', opts: vocab?.beats ?? [] },
    { axis: 'energy', label: 'Energy', ar: 'الطاقة', opts: vocab?.energies ?? [] },
  ];
  return (
    <section className="ca-advanced">
      {rows.map(r => (
        <label key={r.axis} className="ca-advanced__row">
          <span className="ca-advanced__label mono-label">{r.label} · {r.ar}</span>
          <select
            className="ca-select"
            value={state[r.axis] ?? ''}
            onChange={e => setAxis(r.axis, e.target.value)}
          >
            <option value="" disabled>—</option>
            {r.opts.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      ))}
    </section>
  );
}

// ── the questions stage ─────────────────────────────────────────────────────

function QuestionsStage() {
  const advanced = useContextAgents(s => s.advanced);
  const setAdvanced = useContextAgents(s => s.setAdvanced);
  const state = useContextAgents(s => s.state);
  const profiles = useContextAgents(s => s.profiles);
  const profileId = useContextAgents(s => s.profileId);
  const setProfile = useContextAgents(s => s.setProfile);
  const goal = useContextAgents(s => s.goal);
  const setGoal = useContextAgents(s => s.setGoal);
  const busy = useContextAgents(s => s.busy);
  const run = useContextAgents(s => s.run);

  const [vocab, setVocab] = useState<CAVocab | null>(null);
  useEffect(() => { if (advanced && !vocab) void loadVocab().then(setVocab).catch(() => undefined); }, [advanced, vocab]);

  const axes: Array<'register' | 'beat' | 'energy'> = ['register', 'beat', 'energy'];
  const doneCount = axes.filter(a => state[a]).length;
  const ready = doneCount === 3 && goal.trim().length > 0 && !!profileId;

  return (
    <div className="ca-questions">
      {/* progress + advanced toggle */}
      <div className="ca-progress">
        <div className="ca-dots" aria-hidden="true">
          {axes.map(a => (
            <span key={a} className={state[a] ? 'is-done' : ''} />
          ))}
        </div>
        <span className="ca-progress__count mono-label">{doneCount}/3</span>
        <span className="ca-progress__spacer" />
        <button
          type="button"
          className={`ca-toggle${advanced ? ' is-on' : ''}`}
          onClick={() => setAdvanced(!advanced)}
          aria-pressed={advanced}
          title="Switch between picture questions and plain dropdowns"
        >
          {advanced ? 'Picture questions · الأسئلة المصوّرة' : 'Advanced · متقدّم'}
        </button>
      </div>

      {/* the three questions — pictures or dropdowns */}
      {advanced
        ? <AdvancedScene vocab={vocab} />
        : IMPRESSION_QUESTIONS.map(q => <ImpressionScene key={q.axis} q={q} />)}

      {/* goal + profile + MAKE */}
      <section className="ca-commit">
        <div className="ca-commit__grid">
          <label className="ca-field">
            <span className="ca-field__label mono-label">DNA profile · البروفايل</span>
            <select className="ca-select" value={profileId} onChange={e => setProfile(e.target.value)}>
              {profiles.length === 0 && <option value="">—</option>}
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="ca-field ca-field--wide">
            <span className="ca-field__label mono-label">The goal · الهدف</span>
            <textarea
              className="ca-textarea"
              dir="auto"
              rows={2}
              value={goal}
              placeholder="وش تبي المشهد يوصله؟ — اكتب الهدف بجملة"
              onChange={e => setGoal(e.target.value)}
            />
          </label>
        </div>
        <div className="ca-commit__actions">
          <button className="ca-btn ca-btn--primary" onClick={() => void run()} disabled={!ready || busy}>
            {busy ? 'Making…' : 'MAKE · صُغ'}
          </button>
          {!ready && !busy && (
            <span className="ca-commit__hint mono-label" dir="rtl">
              {doneCount < 3 ? 'اختر إحساس القصة وموضعها وطاقتها' : !goal.trim() ? 'اكتب الهدف' : 'اختر بروفايل'}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

// ── one retrieved method as a Lock card (output evidence) ───────────────────

function LockCard({ method }: { method: { id: string; craft: string; confirmed: boolean } }) {
  const cardFrames = useContextAgents(s => s.cardFrames[method.id]) as BoardFrame[] | undefined;
  const [card, setCard] = useState<CACard | null>(null);
  useEffect(() => {
    let live = true;
    void window.hjen.caReadCard({ id: method.id }).then(r => { if (live && r.ok) setCard(r.card); });
    return () => { live = false; };
  }, [method.id]);

  const chips = card
    ? (card.effect || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3).slice(0, 4)
    : [];

  return (
    <article className="ca-lock">
      <RefBoard
        frames={cardFrames}
        en={method.craft}
        chips={chips}
        className="ca-lock__board"
      >
        <div className="ca-lock__body selectable">
          {card?.principle && <p className="ca-lock__principle">{card.principle}</p>}
          {card?.effect && <p className="ca-lock__effect">{card.effect}</p>}
        </div>
        <div className="ca-lock__slots" aria-hidden="true">
          <span className="ca-slot" title="Phase 2 — soon">▷ clip</span>
          <span className="ca-slot" title="Phase 2 — soon">♪ audio</span>
          {method.confirmed && <span className="ca-lock__badge mono-label" title="Confirmed by evidence across registers">universal</span>}
        </div>
      </RefBoard>
    </article>
  );
}

// ── the result stage ────────────────────────────────────────────────────────

function ResultStage() {
  const result = useContextAgents(s => s.result);
  const reset = useContextAgents(s => s.reset);
  if (!result) return null;

  const outputs: Array<{ n: string; en: string; ar: string; body?: string }> = [
    { n: '①', en: 'The goal', ar: 'الهدف', body: result.use1 },
    { n: '②', en: 'The development — a shootable direction', ar: 'التطوير — إخراج قابل للتصوير', body: result.use2 },
    { n: '③', en: 'Copy / script', ar: 'نصّ / كوبي', body: result.use3 },
  ];

  return (
    <div className="ca-result">
      <div className="ca-result__head">
        <div className="ca-result__state mono-label">
          {result.state && `${result.state.register} · ${result.state.beat} · ${result.state.energy}`}
          {result.profile && <span className="ca-result__profile"> — {result.profile.name}</span>}
        </div>
        <button className="ca-btn ca-btn--ghost" onClick={reset}>‹ New · جديد</button>
      </div>

      {/* the three finished outputs */}
      <div className="ca-outputs">
        {outputs.map(o => (
          <section key={o.n} className="ca-output">
            <header className="ca-output__head">
              <span className="ca-output__n" aria-hidden="true">{o.n}</span>
              <div>
                <h3 className="ca-output__en">{o.en}</h3>
                <span className="ca-output__ar" dir="rtl">{o.ar}</span>
              </div>
            </header>
            <div className="ca-output__body selectable" dir="auto">{o.body || '—'}</div>
          </section>
        ))}
      </div>

      {/* the retrieved methods — each Lock paired with its reference */}
      {(result.methods?.length ?? 0) > 0 && (
        <section className="ca-locks">
          <header className="ca-locks__head">
            <span className="mono-label">Methods in play · الطرق المسترجَعة</span>
            <span className="ca-locks__count mono-label">{result.methods!.length}</span>
          </header>
          <div className="ca-locks__grid">
            {result.methods!.map(m => <LockCard key={m.id} method={m} />)}
          </div>
        </section>
      )}
    </div>
  );
}

// ── root ─────────────────────────────────────────────────────────────────────

export function ContextStudio() {
  const setActiveView = useStore(s => s.setActiveView);
  const init = useContextAgents(s => s.init);
  const stage = useContextAgents(s => s.stage);
  const busy = useContextAgents(s => s.busy);
  const activity = useContextAgents(s => s.activity);
  const error = useContextAgents(s => s.error);
  const framesetStarved = useContextAgents(s => s.framesetStarved);
  const signInFrameset = useContextAgents(s => s.signInFrameset);

  useEffect(() => { void init(); }, [init]);

  return (
    <div className="ca">
      <div className="ca-top drag-region">
        <button className="ca-back no-drag" onClick={() => setActiveView('studio')}>‹ Studio</button>
        <div className="ca-brand no-drag">
          <span className="ca-brand__dot" />
          <span className="ca-brand__ar" dir="auto">استوديو السياق</span>
          <span className="ca-brand__en mono-label">Context Studio</span>
        </div>
        <span className="ca-top__spacer" />
        <button className="ca-back no-drag" onClick={() => setActiveView('ca-trainer')} title="Curate the method library">
          Trainer ›
        </button>
      </div>

      <div className="ca-scroll">
        {stage === 'questions' ? <QuestionsStage /> : <ResultStage />}
      </div>

      {/* status strip — what the wait is, or the quota-wall sign-in */}
      <div className="ca-statusbar" role="status">
        <span className={`ca-statusbar__dot${busy || activity ? ' is-live' : ''}`} aria-hidden="true" />
        <span className="ca-statusbar__stage mono-label">
          {stage === 'result' ? 'Made · جاهز' : 'Pick the feeling · اختر الإحساس'}
        </span>
        {activity && <span className="ca-statusbar__activity">{activity}</span>}
        {framesetStarved && (
          <button className="ca-statusbar__signin" onClick={signInFrameset}>
            Sign in to Frameset · سجّل الدخول
          </button>
        )}
      </div>

      {error && <div className="ca-error" role="alert">{error}</div>}
    </div>
  );
}
