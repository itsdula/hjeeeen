// The visual question — one at a time. The question set is CRAFTED per brief by
// the engine (Anwar 2026-07-11), so this scene reads `questions`/`questionIndex`
// straight from the store. The user answers by PICKING a board of real frames,
// not by typing: each option resolves to a 2×2 collage of hidden-Frameset hits
// (slow Ken-Burns drift), arriving PROGRESSIVELY the moment its hunt finishes;
// a thin board falls back to a typographic card so the flow never blocks.
//
// Language law: English is the display type (precise, SEEN); the Arabic line is
// its smaller translation beneath.

import { useState, useRef, useEffect } from 'react';
import { useCreativeMind } from '../../store/creativeMindStore';
import type { MindOption } from '../../lib/creativemind/questions';
import { useLangMode } from '../../lib/lang/translate';
import { hjenFileUrl } from '../../lib/theme/apply';

/** grid columns by card count (options + the permanent custom card) —
 *  2-up / 3-up / 4-up, 5+ wraps to 3-up. */
function colsFor(n: number): number {
  if (n <= 2) return n;
  if (n === 3) return 3;
  if (n === 4) return 4;
  return 3;
}

/** The permanent "your own answer" card — one per question, always last in the
 *  grid (Anwar 2026-07-11). Idle: a quiet dashed ghost, distinct from photo
 *  boards AND the typographic fallback. Click → inline textarea; Enter records
 *  the user's own words via answerCustom and advances, Escape reverts to idle.
 *  Accepts AR or EN (dir="auto"). The <textarea> is exempt from the scene's
 *  number/S shortcuts (CreativeMindView guards on tagName). */
function OwnAnswerCard({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        className="cmind-board cmind-board--own"
        onClick={() => setEditing(true)}
        aria-label="Write your own answer"
      >
        <span className="cmind-own__glyph" aria-hidden="true">+</span>
        <span className="cmind-own__en">Your own answer</span>
        <span className="cmind-own__ar" dir="rtl">جوابك أنت — اكتبه بدقتك</span>
      </button>
    );
  }

  const submit = () => {
    const t = text.trim();
    if (t) onSubmit(t);
    else setEditing(false);
  };

  return (
    <div className="cmind-board cmind-board--own is-editing">
      <textarea
        ref={ref}
        className="cmind-own__field"
        dir="auto"
        rows={2}
        value={text}
        placeholder="Write it exactly as you see it"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          else if (e.key === 'Escape') { e.preventDefault(); setText(''); setEditing(false); }
        }}
        onBlur={() => { if (!text.trim()) setEditing(false); }}
      />
      <span className="cmind-own__hint" dir="rtl">اكتبه كما تراه بالضبط · Enter</span>
    </div>
  );
}

function OptionBoard({ qId, opt, onPick }: {
  qId: string;
  opt: MindOption;
  onPick: () => void;
}) {
  // Per-option subscription: this board re-renders the instant ITS hunt lands,
  // independent of its siblings (hunts are serialized, so they arrive staggered).
  const board = useCreativeMind(s => s.boards[`${qId}:${opt.id}`]);

  // Content language — the option caption is authored bilingual (opt.en/opt.ar);
  // 'en' shows English only, 'ar' the Arabic promoted to the display role, 'both'
  // both. Fall back to whichever language exists.
  const mode = useLangMode();
  const showEn = mode !== 'ar' || !opt.ar;
  const showAr = mode !== 'en' || !opt.en;
  const arSolo = mode === 'ar' && !!opt.ar;

  // undefined = hunt in flight → shimmer. [] or <2 = typographic fallback.
  if (board === undefined) {
    return <div className="cmind-board cmind-board--load" aria-hidden="true" />;
  }

  const frames = board.slice(0, 4);
  const rich = frames.length >= 2;

  if (!rich) {
    return (
      <button
        type="button"
        className="cmind-board cmind-board--type"
        onClick={onPick}
        aria-label={`${opt.en} — ${opt.ar}`}
      >
        <div className="cmind-board__cap">
          {showEn && <span className="cmind-board__en">{opt.en}</span>}
          {showAr && <span className={`cmind-board__ar${arSolo ? ' cmind-board__ar--solo' : ''}`} dir="rtl">{opt.ar}</span>}
        </div>
        {opt.tags.length > 0 && (
          <div className="cmind-board__chips">
            {opt.tags.slice(0, 4).map(t => <span key={t} className="cmind-chip">{t}</span>)}
          </div>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="cmind-board"
      onClick={onPick}
      aria-label={`${opt.en} — ${opt.ar}`}
    >
      <div className="cmind-board__grid" data-n={String(Math.min(frames.length, 4))}>
        {frames.map(f => (
          <img key={f.id} src={hjenFileUrl(f.filePath)} alt="" loading="lazy" decoding="async" />
        ))}
      </div>
      <span className="cmind-board__scrim" />
      <div className="cmind-board__cap">
        <span className="cmind-board__en">{opt.en}</span>
        <span className="cmind-board__ar" dir="rtl">{opt.ar}</span>
      </div>
    </button>
  );
}

export function QuestionScene() {
  const questions = useCreativeMind(s => s.questions);
  const questionIndex = useCreativeMind(s => s.questionIndex);
  const crafting = useCreativeMind(s => s.crafting);
  const answer = useCreativeMind(s => s.answer);
  const answerCustom = useCreativeMind(s => s.answerCustom);
  const rehuntQuestion = useCreativeMind(s => s.rehuntQuestion);
  const skip = useCreativeMind(s => s.skip);
  const mode = useLangMode();

  const q = questions[questionIndex];

  // Between the last answer and the seeds the director reads the picks — a
  // follow-up question may still arrive (index sits past the list meanwhile).
  if (!q) {
    if (!crafting) return null;
    return (
      <section className="cmind-scene cmind-analyzing">
        <div className="cmind-analyzing__inner">
          <span className="cmind-busy__ring" aria-hidden="true" />
          <h1 className="cmind-analyzing__en">Looking at your answers…</h1>
          <span className="cmind-analyzing__ar" dir="rtl">أتأمل إجاباتك — قد يبقى سؤال مهم واحد.</span>
        </div>
      </section>
    );
  }

  // the permanent custom card counts toward the grid so the layout reads
  // deliberate (4 options + custom → colsFor(5)=3 → a clean 3+2 wrap).
  const cols = colsFor(q.options.length + 1);

  return (
    <section className="cmind-scene cmind-q">
      <header className="cmind-q__head">
        <div className="cmind-dots" aria-hidden="true">
          {questions.map((_, i) => (
            <span
              key={i}
              className={i === questionIndex ? 'is-live' : i < questionIndex ? 'is-done' : ''}
            />
          ))}
        </div>
        {(mode !== 'ar' || !q.ar) && <h1 className="cmind-q__en">{q.en}</h1>}
        {(mode !== 'en' || !q.en) && (
          <span className={`cmind-q__ar${mode === 'ar' && q.ar ? ' cmind-q__ar--solo' : ''}`} dir="rtl">{q.ar}</span>
        )}
      </header>

      <div className="cmind-boards" style={{ ['--cmind-cols' as any]: cols }}>
        {q.options.map(opt => (
          <OptionBoard key={opt.id} qId={q.id} opt={opt} onPick={() => answer(opt.id)} />
        ))}
        <OwnAnswerCard key={`${q.id}:own`} onSubmit={answerCustom} />
      </div>

      <footer className="cmind-q__foot">
        <button className="cmind-rehunt" onClick={rehuntQuestion} title="Fresh frames for this question">
          ⟲ New frames · صور جديدة
        </button>
        <button className="cmind-skip" onClick={skip}>Skip · تخطَّ · S</button>
      </footer>
    </section>
  );
}
