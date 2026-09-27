import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type BgJob } from '../store';
import { resumeStateFor } from '../lib/breakdown/resume';
import { relTime } from './StatusBar';
import '../styles/log.css';

/**
 * LogView — the Operations register. Every background operation the studio has
 * run this session (running + finished + interrupted), in sequence, browsable at
 * a glance: status, stage progress, order, timing, with click-through back to
 * each op's home. Interrupted ops (the app closed mid-run) surface honestly with
 * their stop-point and a RESUME action that re-runs ONLY the unfinished work from
 * the on-disk checkpoint. This is a data view — hierarchy first, status surfaced
 * through pills and a stage rail. House vocabulary: operations are MADE, never
 * "generated".
 */
export function LogView() {
  const bgJobs = useStore(s => s.bgJobs);
  const openJobNav = useStore(s => s.openJobNav);
  const resumeJob = useStore(s => s.resumeJob);
  const setActiveView = useStore(s => s.setActiveView);
  const logFocusJobId = useStore(s => s.logFocusJobId);
  const setLogFocusJobId = useStore(s => s.setLogFocusJobId);

  // A stopped chip routes here with a focus id — consume it once so the matching
  // row auto-opens, then clear it (the row keeps its own expanded state).
  useEffect(() => {
    if (logFocusJobId) setLogFocusJobId(null);
  }, [logFocusJobId, setLogFocusJobId]);

  // Newest first; sequence numbers count in the order ops were STARTED so the
  // register reads like a real ledger (oldest = #1).
  const total = bgJobs.length;
  const rows = useMemo(() => bgJobs.map((j, i) => ({ job: j, seq: total - i })), [bgJobs, total]);

  const counts = useMemo(() => ({
    running: bgJobs.filter(j => j.status === 'running').length,
    done: bgJobs.filter(j => j.status === 'done').length,
    error: bgJobs.filter(j => j.status === 'error').length,
    interrupted: bgJobs.filter(j => j.status === 'interrupted').length,
  }), [bgJobs]);

  return (
    <div className="log-root">
      <div className="log-bar">
        <button className="log-bar__back" onClick={() => setActiveView('studio')} aria-label="Back to Studio">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M15 6l-6 6 6 6" /></svg>
          STUDIO
        </button>
        <span className="log-wordmark">OPERATIONS<b>LOG</b></span>
      </div>

      <div className="log-stage">
        <div className="log-head">
          <div className="log-eyebrow mono-label">THE OPERATIONS REGISTER</div>
          <h1>Every operation, in sequence</h1>
          <div className="log-summary">
            <span className="log-tally"><b>{total}</b> total</span>
            <span className="log-tally log-tally--running"><i /> {counts.running} running</span>
            <span className="log-tally log-tally--done"><i /> {counts.done} done</span>
            <span className="log-tally log-tally--error"><i /> {counts.error} stopped</span>
            {counts.interrupted > 0 && (
              <span className="log-tally log-tally--interrupted"><i /> {counts.interrupted} interrupted</span>
            )}
          </div>
        </div>

        {total === 0 ? (
          <div className="log-empty">
            <svg className="log-empty__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
            <h2>No operations yet</h2>
            <p>Start an operation — a breakdown run, a DNA distillation — and it registers here with its stages, order and timing. Everything the studio makes leaves a trace.</p>
          </div>
        ) : (
          <ul className="log-list" role="list">
            {rows.map(({ job, seq }) => (
              <LogRow
                key={job.id}
                job={job}
                seq={seq}
                focused={job.id === logFocusJobId}
                onOpen={() => void openJobNav(job.id)}
                onResume={() => resumeJob(job.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<BgJob['status'], string> = {
  running: 'RUNNING', done: 'DONE', error: 'STOPPED', interrupted: 'INTERRUPTED',
};

function LogRow({ job, seq, focused, onOpen, onResume }: { job: BgJob; seq: number; focused: boolean; onOpen: () => void; onResume: () => void }) {
  const label = STATUS_LABEL[job.status];
  const dur = job.doneAt ? fmtDur(job.doneAt - job.createdAt) : null;
  const doneCount = job.stages.filter(s => s.state === 'done').length;
  const stopStage = job.stages.find(s => s.state === 'interrupted');
  const isError = job.status === 'error';

  // A stopped op's home (a breakdown page) shows nothing about the failure, so
  // clicking an error row reveals the full log IN PLACE instead of navigating
  // away. Non-error rows keep their return-to-home click.
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused && isError) {
      setExpanded(true);
      ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [focused, isError]);

  return (
    <li ref={ref} className={`log-item log-item--${job.status}${isError && expanded ? ' log-item--open' : ''}`}>
      <button
        type="button"
        className={`log-row log-row--${job.status}`}
        onClick={isError ? () => setExpanded(e => !e) : onOpen}
        aria-expanded={isError ? expanded : undefined}
        title={isError ? `${expanded ? 'Hide' : 'Show'} the full log · ${job.title}` : `Open ${job.title}`}
      >
        <span className="log-row__seq">#{String(seq).padStart(3, '0')}</span>
        <span className={`log-row__pill log-row__pill--${job.status}`}>
          <span className="log-row__pill-dot" aria-hidden="true" />
          {label}
        </span>
        <span className="log-row__main">
          <span className="log-row__title">{job.title}</span>
          <span className="log-row__meta">
            <span className="log-row__kind mono-label">{job.kind}</span>
            {job.progressText && <span className="log-row__prog">{job.progressText}</span>}
            {isError && job.error && <span className="log-row__err">{job.error}</span>}
            {job.status === 'interrupted' && (
              <span className="log-row__stop">stopped at stage {doneCount + (stopStage ? 1 : 0)} of {job.stages.length}{stopStage ? ` · ${stopStage.label}` : ''}</span>
            )}
            {isError && (
              <span className={`log-row__disclose${expanded ? ' is-open' : ''}`} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M9 6l6 6-6 6" /></svg>
              </span>
            )}
          </span>
        </span>
        <span className="log-row__stages" aria-label={`${doneCount} of ${job.stages.length} stages done`}>
          {job.stages.map(s => (
            <span key={s.key} className={`log-stage-dot log-stage-dot--${s.state}`} title={`${s.label}: ${s.state}`} />
          ))}
        </span>
        <span className="log-row__time">
          <span className="log-row__rel">{relTime(job.doneAt ?? job.createdAt)}</span>
          {dur && <span className="log-row__dur">{dur}</span>}
        </span>
      </button>

      {job.status === 'interrupted' && <ResumePanel job={job} onResume={onResume} />}
      {isError && expanded && <ErrorPanel job={job} onOpen={onOpen} onResume={onResume} />}
    </li>
  );
}

/** The full-log panel a stopped row expands into — the complete error text,
 *  monospace, wrapping, selectable and copyable, with the stage it stopped at
 *  and a secondary jump to the op's home. Mirrors the interrupted ResumePanel. */
function ErrorPanel({ job, onOpen, onResume }: { job: BgJob; onOpen: () => void; onResume: () => void }) {
  const [copied, setCopied] = useState(false);
  // A stopped run that keeps an on-disk checkpoint can be RESUMED from where it
  // broke (e.g. "master:batch4: fetch failed") — never a dead end.
  const rs = resumeStateFor(job);
  const errStage = job.stages.find(s => s.state === 'error');
  const where = errStage
    ? (job.stages.length > 1
        ? `stage ${job.stages.indexOf(errStage) + 1} / ${job.stages.length} · ${errStage.label}`
        : `stage · ${errStage.label}`)
    : null;

  const copy = () => {
    const text = job.error ?? '';
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="log-detail">
      <div className="log-detail__head">
        {where
          ? <span className="log-detail__where mono-label">{where}</span>
          : <span className="log-detail__where mono-label">the full log</span>}
        <span className="log-detail__actions">
          <button type="button" className="log-detail__act" onClick={copy} aria-label="Copy the full error log">
            {copied ? 'COPIED' : 'COPY'}
          </button>
          <button type="button" className="log-detail__act" onClick={onOpen} aria-label={`Open ${job.title} home`}>
            OPEN
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path d="M7 17L17 7M8 7h9v9" /></svg>
          </button>
          {rs.can ? (
            <button type="button" className="log-detail__act log-detail__act--resume" onClick={onResume} aria-label={`Resume ${job.title}`}>
              RESUME
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          ) : rs.resumed ? <span className="log-detail__resumed">● RESUMED</span> : null}
        </span>
      </div>
      <pre className="log-detail__body selectable">{job.error ?? 'No error detail was captured for this operation.'}</pre>
    </div>
  );
}

function ResumePanel({ job, onResume }: { job: BgJob; onResume: () => void }) {
  const rs = resumeStateFor(job);
  return (
    <div className="log-resume">
      <span className="log-resume__note">
        The app closed before this finished — completed steps are saved.
        {rs.can && ' Resume to make only what’s missing.'}
      </span>
      {rs.can ? (
        <button type="button" className="log-resume__btn" onClick={onResume}>
          RESUME
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      ) : rs.resumed ? (
        <span className="log-resume__done">● RESUMED</span>
      ) : (
        <span className="log-resume__hint" title={rs.reason}>{rs.reason}</span>
      )}
    </div>
  );
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}
