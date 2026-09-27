// Creative Mind — العقل الإبداعي. A full-screen visual brainstorm stage: raw
// brief → visual questions → seeds → collision constellation → territory boards
// → press-and-hold sign. One scene at a time; the session engine lives in
// creativeMindStore, so this view is pure staging + keyboard + capture.

import { useEffect, useState } from 'react';
import '../../styles/creativemind.css';
import { useStore } from '../../store';
import { useCreativeMind } from '../../store/creativeMindStore';
import { usePreprodProject } from '../preprod/shared';
import type { ProjectMeta } from '../../types/hjen-bridge';
import { QuestionScene } from './QuestionScene';
import { CollideScene } from './CollideScene';
import { TerritoryScene } from './TerritoryScene';
import { CaptureInbox, CaptureStrip } from './CaptureInbox';
import { CreativeGraphMap } from './CreativeGraphMap';

// ── project gate (Creative Mind's own dark idiom) ───────────────────────────

function CmindGate({ projects, pick }: { projects: ProjectMeta[]; pick: (id: string) => Promise<void> }) {
  return (
    <section className="cmind-scene cmind-gate">
      <div className="cmind-gate__card">
        <div className="cmind-gate__eyebrow mono-label">العقل الإبداعي · Creative Mind</div>
        <h2 className="cmind-gate__h" dir="auto">Which project does this thinking belong to?</h2>
        <p className="cmind-gate__p">Every board you pick and every idea you keep is written into the project's contract — the same stage the room signs.</p>
        {projects.length === 0 ? (
          <div className="cmind-gate__empty mono-label">No projects yet — create one from Projects.</div>
        ) : (
          <div className="cmind-gate__list">
            {projects.map(p => (
              <button key={p.id} className="cmind-gate__row" onClick={() => void pick(p.id)}>
                <span className="cmind-gate__name">{p.name}</span>
                <span className="cmind-gate__meta mono-label">Stage 0{p.currentStage ?? 1}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── entry (raw brief → analyze) ─────────────────────────────────────────────

function EntryScene() {
  const rawBrief = useCreativeMind(s => s.rawBrief);
  const setRawBrief = useCreativeMind(s => s.setRawBrief);
  const analyze = useCreativeMind(s => s.analyze);
  const busy = useCreativeMind(s => s.busy);

  return (
    <section className="cmind-scene cmind-entry">
      <div className="cmind-entry__inner">
        <span className="cmind-entry__eyebrow mono-label">Stage 01 · from intent to Big Idea</span>
        <h1 className="cmind-entry__h">Drop the brief as it arrived.</h1>
        <span className="cmind-entry__sub" dir="rtl">أنزِل البريف كما وصلك.</span>
        <p className="cmind-entry__lede">Paste the client brief — deck notes, an email, what was said on the call. The Mind reads it, hunts its gaps, then crafts the picture around it.</p>
        <textarea
          className="cmind-entry__field"
          value={rawBrief}
          onChange={e => setRawBrief(e.target.value)}
          placeholder="الصق البريف هنا…"
          dir="auto"
        />
        <div className="cmind-entry__actions">
          <button className="cmind-btn cmind-btn--primary" onClick={() => void analyze()} disabled={busy || !rawBrief.trim()}>
            {busy ? 'Reading…' : 'Read the brief'}
          </button>
          <span className="mono-label" style={{ color: 'var(--ink-faint)' }}>or capture a stray thought first ↓</span>
        </div>
        <CaptureStrip />
      </div>
    </section>
  );
}

function AnalyzingScene() {
  const crafting = useCreativeMind(s => s.crafting);

  // Two felt steps: read the brief, then craft its questions. Step 2 lights only
  // once the classifier lands — the user sees the Mind adapt to THEIR brief.
  const en = crafting ? 'Crafting your questions from this brief…' : 'Reading between the lines…';
  const ar = crafting ? 'أصوغ أسئلتك من هذا البريف…' : 'أقرأ ما بين السطور…';

  return (
    <section className="cmind-scene cmind-analyzing">
      <div className="cmind-analyzing__inner">
        <div className="cmind-orbit" aria-hidden="true"><span /><span /><span /></div>
        <div className="cmind-analyzing__steps" aria-hidden="true">
          <span className={`cmind-step${crafting ? ' is-done' : ' is-active'}`}>
            <span className="cmind-step__dot" />Read
          </span>
          <span className="cmind-analyzing__rail" />
          <span className={`cmind-step${crafting ? ' is-active' : ''}`}>
            <span className="cmind-step__dot" />Craft
          </span>
        </div>
        <span className="cmind-analyzing__en">{en}</span>
        <span className="cmind-analyzing__ar" dir="rtl">{ar}</span>
      </div>
    </section>
  );
}

// ── root ─────────────────────────────────────────────────────────────────────

const STAGE_LABEL: Record<string, [string, string]> = {
  entry: ['Ready — drop the brief', 'جاهز — أنزِل البريف'],
  analyzing: ['Reading the brief', 'قراءة البريف'],
  questions: ['Visual questions', 'الأسئلة البصرية'],
  seeds: ['Seeds on the table', 'البذور'],
  collide: ['The collision', 'التصادم'],
  territories: ['Territories', 'الاتجاهات'],
  sign: ['Signing stage 01', 'التوقيع'],
  done: ['Stage 01 signed', 'وُقّعت المرحلة ١'],
};

function StatusBar() {
  const stage = useCreativeMind(s => s.stage);
  const activity = useCreativeMind(s => s.activity);
  const questions = useCreativeMind(s => s.questions);
  const questionIndex = useCreativeMind(s => s.questionIndex);
  const boards = useCreativeMind(s => s.boards);
  const framesetStarved = useCreativeMind(s => s.framesetStarved);
  const signInFrameset = useCreativeMind(s => s.signInFrameset);

  const total = questions.reduce((n, q) => n + q.options.length, 0);
  const done = questions.reduce(
    (n, q) => n + q.options.filter(o => boards[`${q.id}:${o.id}`] !== undefined).length, 0);
  const [en, ar] = STAGE_LABEL[stage] ?? STAGE_LABEL.entry;
  const stageLine = stage === 'questions' && questions.length
    ? `Question ${Math.min(questionIndex + 1, questions.length)}/${questions.length}`
    : en;

  return (
    <div className="cmind-statusbar" role="status">
      <span className={`cmind-statusbar__dot ${activity ? 'is-live' : ''}`} aria-hidden="true" />
      <span className="cmind-statusbar__stage mono-label">{stageLine}</span>
      <span className="cmind-statusbar__ar" dir="rtl">{ar}</span>
      {activity && <span className="cmind-statusbar__activity">{activity}</span>}
      {framesetStarved && (
        <button className="cmind-statusbar__signin" onClick={signInFrameset}>
          Sign in to Frameset · سجّل الدخول
        </button>
      )}
      <span className="cmind-statusbar__spacer" />
      {total > 0 && (
        <span className="cmind-statusbar__boards mono-label" title="Reference boards hunted">
          Boards {done}/{total}
          <span className="cmind-statusbar__meter" aria-hidden="true">
            <span style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} />
          </span>
        </span>
      )}
    </div>
  );
}

export function CreativeMindView() {
  const setActiveView = useStore(s => s.setActiveView);
  const { projects, project, pick } = usePreprodProject();

  const init = useCreativeMind(s => s.init);
  const resumeOffer = useCreativeMind(s => s.resumeOffer);
  const resume = useCreativeMind(s => s.resume);
  const startFresh = useCreativeMind(s => s.startFresh);
  const stage = useCreativeMind(s => s.stage);
  const error = useCreativeMind(s => s.error);
  const costUsd = useCreativeMind(s => s.costUsd);
  const notesCount = useCreativeMind(s => s.notes.length);

  const [captureOpen, setCaptureOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);

  // init the session when a project is picked
  useEffect(() => {
    if (project?.id) void init(project.id);
  }, [project?.id, init]);

  // global keyboard — numbers/S pick options on the question scene; ArrowLeft
  // steps back. Escape does nothing (house spec). Typing in a field is exempt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const st = useCreativeMind.getState();

      if (st.stage === 'questions' && !typing) {
        const q = st.questions[st.questionIndex];
        if (q) {
          const n = Number(e.key);
          if (n >= 1 && n <= q.options.length) { e.preventDefault(); st.answer(q.options[n - 1].id); return; }
          if (e.key === 's' || e.key === 'S') { e.preventDefault(); st.skip(); return; }
        }
      }
      if (e.key === 'ArrowLeft' && !typing) {
        if (st.stage !== 'entry' && st.stage !== 'analyzing' && st.stage !== 'done') { e.preventDefault(); st.back(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scene = () => {
    if (!project) return <CmindGate projects={projects} pick={pick} />;
    switch (stage) {
      case 'entry': return <EntryScene />;
      case 'analyzing': return <AnalyzingScene />;
      case 'questions': return <QuestionScene />;
      case 'seeds':
      case 'collide': return <CollideScene />;
      case 'territories':
      case 'sign':
      case 'done': return <TerritoryScene projectName={project.name} />;
      default: return <EntryScene />;
    }
  };

  return (
    <div className="cmind">
      <div className="cmind-top drag-region">
        <button className="cmind-back no-drag" onClick={() => setActiveView('studio')}>‹ Studio</button>
        <div className="cmind-brand no-drag">
          <span className="cmind-brand__dot" />
          <span className="cmind-brand__ar" dir="auto">العقل الإبداعي</span>
          <span className="cmind-brand__en mono-label">Creative Mind</span>
        </div>
        <span className="cmind-top__spacer" />
        {project && <button className="cmind-graphbtn no-drag" onClick={() => setGraphOpen(true)}>Graph</button>}
        {typeof costUsd === 'number' && costUsd > 0 && (
          <span className="cmind-cost no-drag">${costUsd.toFixed(2)}</span>
        )}
      </div>

      {scene()}

      {/* the always-on status bar — where the Mind stands + what the wait IS
          + how many boards are hunted (Anwar 2026-07-11: no blind loading) */}
      {project && <StatusBar />}

      {error && <div className="cmind-error" role="alert">{error}</div>}

      {/* capture — a quiet corner glyph toggles the inbox at ANY stage */}
      {project && (
        <button
          className="cmind-capglyph"
          onClick={() => setCaptureOpen(o => !o)}
          aria-label="Capture inbox"
          aria-expanded={captureOpen}
          title="Capture · التقاط"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.7}>
            <circle cx="12" cy="12" r="3" />
            <path d="M4 6l1.4 1.4M18.6 16.6L20 18M6 20l1.4-1.4M16.6 5.4L18 4M3 13h2M19 13h2M12 3v2M12 19v2" opacity={0.7} />
          </svg>
          {notesCount > 0 && <span className="cmind-capglyph__count">{notesCount}</span>}
        </button>
      )}
      {captureOpen && <CaptureInbox onClose={() => setCaptureOpen(false)} />}
      {graphOpen && project && <CreativeGraphMap projectId={project.id} onClose={() => setGraphOpen(false)} />}

      {/* resume offer — a non-done session waits on disk */}
      {resumeOffer && (
        <div className="cmind-resume" role="dialog" aria-label="Resume session">
          <div className="cmind-resume__card">
            <h2 className="cmind-resume__h">A session was left half-finished.</h2>
            <span className="cmind-resume__ar" dir="rtl">تُرِكت جلسة في منتصفها.</span>
            <p className="cmind-resume__p">You left a Creative Mind session open on this project. Pick it up where it stood, or begin again.</p>
            <div className="cmind-resume__actions">
              <button className="cmind-btn cmind-btn--primary" onClick={resume}>Resume · استئناف</button>
              <button className="cmind-btn cmind-btn--ghost" onClick={startFresh}>Start fresh</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
