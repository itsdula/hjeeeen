import { useEffect, useRef, useState } from 'react';
import { BREAKDOWN_AXES } from '../../lib/breakdown/axes';
import { runBreakdown, newRunState, VISION_PASSES, type RunState, type RunEvent } from '../../lib/breakdown/run';
import type { NewBreakdownInput as _NI } from './NewBreakdown';
import { useStore, type JobStage } from '../../store';

// The seven-stage spine, mirrored into the background-jobs subsystem so the run
// survives leaving the Breakdown view. Keys match the RunEvent phase names, so
// every 'phase' event advances the matching job stage.
const JOB_STAGES: JobStage[] = [
  { key: 'fetch', label: 'Fetch', state: 'pending' },
  { key: 'frames', label: 'Frames', state: 'pending' },
  { key: 'vision', label: 'Read', state: 'pending' },
  { key: 'dna', label: 'DNA', state: 'pending' },
  { key: 'docs', label: 'Docs', state: 'pending' },
  { key: 'master', label: 'Fuse', state: 'pending' },
  { key: 'write', label: 'Write', state: 'pending' },
];

// The run in flight — the disc's visual language while it's being MADE: the 13
// craft axes light up as their vision pass lands, five phase-lamps track the
// spine (FETCH → FRAMES → READ → DOCS → WRITE), and a failure stops honestly on
// the stage that broke, with a retry that resumes from exactly there.

type Phase = 'fetch' | 'frames' | 'vision' | 'dna' | 'docs' | 'master' | 'write' | 'done' | 'error';
const PHASE_LAMPS: { key: Phase; label: string }[] = [
  { key: 'fetch', label: 'FETCH' },
  { key: 'frames', label: 'FRAMES' },
  { key: 'vision', label: 'READ' },
  { key: 'dna', label: 'DNA' },
  { key: 'docs', label: 'DOCS' },
  { key: 'master', label: 'FUSE' },
  { key: 'write', label: 'WRITE' },
];
const PHASE_ORDER: Phase[] = ['fetch', 'frames', 'vision', 'dna', 'docs', 'master', 'write', 'done'];

export function BreakdownProgress({ input, onDone, onExit }: {
  input: _NI; onDone: (slug: string) => void; onExit: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('fetch');
  const [label, setLabel] = useState('Fetching the film…');
  const [sub, setSub] = useState('');            // native ingest sub-step
  const [axesDone, setAxesDone] = useState<Set<string>>(new Set());
  const [dnaDone, setDnaDone] = useState<Set<string>>(new Set());
  const [masterDone, setMasterDone] = useState(0);
  const [passesDone, setPassesDone] = useState(0);
  const [error, setError] = useState('');
  const [brokePhase, setBrokePhase] = useState<Phase>('vision');   // which lamp broke

  const runId = useRef(`bd-run-${Date.now().toString(36)}`);
  const state = useRef<RunState>(newRunState());
  const cancelled = useRef(false);
  const started = useRef(false);
  const startedAt = useRef(Date.now());
  // Once-a-second tick — a visibly moving clock so a long stage never reads as
  // frozen (the client sees it's alive and how long it has taken).
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (phase === 'done' || phase === 'error') return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [phase]);
  // Background-jobs mirror — this run's id in the app-wide operations subsystem.
  // Actions are read from getState() (not closed-over) so the job keeps
  // advancing after this component unmounts (leaving the Breakdown view).
  const jobId = useRef<string | null>(null);

  const reduce = (ev: RunEvent) => {
    const jb = useStore.getState();
    if (ev.type === 'phase') {
      setPhase(ev.phase); setLabel(ev.label);
      if (jobId.current) jb.updateJob(jobId.current, { activeStage: ev.phase, progressText: ev.label });
    }
    else if (ev.type === 'slug') {
      // Capture the checkpoint reference into the job's nav so an interruption
      // from here on can RESUME the DNA/master tail from what's on disk. Keep the
      // runId alongside so a re-attached live view can still CANCEL the run.
      if (jobId.current) jb.updateJob(jobId.current, { nav: { view: 'breakdown', projectId: null, sub: { runId: runId.current, breakdownSlug: ev.slug } } });
    }
    else if (ev.type === 'axis-done') setAxesDone(s => new Set(s).add(ev.slug));
    else if (ev.type === 'pass-done') setPassesDone(n => Math.min(VISION_PASSES.length, n + 1));
    else if (ev.type === 'dna-done') {
      setDnaDone(s => new Set(s).add(ev.slug));
      if (jobId.current) jb.updateJob(jobId.current, { progressText: `Distilling the axis DNAs — ${ev.done}/${ev.total}` });
    }
    else if (ev.type === 'master-shot') {
      setMasterDone(n => n + 1);
      if (jobId.current) jb.updateJob(jobId.current, { progressText: `Fusing master prompts — shot ${ev.done}/${ev.total}` });
    }
    else if (ev.type === 'pass-error') {
      setBrokePhase(ev.pass === 'dna' ? 'dna' : ev.pass === 'master' ? 'master' : ev.pass.startsWith('docs') ? 'docs' : 'vision');
      setError(ev.message); setPhase('error');
      if (jobId.current) jb.finishJob(jobId.current, { status: 'error', error: ev.message });
    }
    else if (ev.type === 'error') {
      setError(ev.message); setPhase('error');
      if (jobId.current) jb.finishJob(jobId.current, { status: 'error', error: ev.message });
    }
    else if (ev.type === 'done') {
      setPhase('done'); onDone(ev.slug);
      if (jobId.current) jb.finishJob(jobId.current, {
        status: 'done',
        // A full run lands on the disc/overview — it IS the whole breakdown.
        nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: ev.slug, breakdownPage: 'disc' } },
      });
    }
  };

  const start = () => {
    cancelled.current = false;
    setError(''); setPhase(p => (p === 'error' ? brokePhase : p));
    // Register (or re-register, on retry) the operation in the jobs subsystem.
    const jb = useStore.getState();
    const prev = jobId.current ? jb.getJob(jobId.current) : undefined;
    if (!prev || prev.status !== 'running') {
      jobId.current = jb.startJob({
        kind: 'breakdown-run',
        title: `Breakdown · ${input.title || input.brand || 'the film'}`,
        // runId travels in the nav so a picker card / re-attached live view can
        // find the in-flight run and CANCEL it (before a slug checkpoint exists).
        nav: { view: 'breakdown', projectId: null, sub: { runId: runId.current } },
        stages: JOB_STAGES.map(s => ({ ...s })),
        progressText: 'Fetching the film…',
      });
    }
    runBreakdown({ input, runId: runId.current, state: state.current, emit: reduce, cancelled: () => cancelled.current });
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // native ingest sub-steps stream here (download / frames / thumbs / audio)
    const off = window.hjen.onBreakdownProgress((_e, d) => {
      if (d?.runId !== runId.current) return;
      if (d.step === 'fetch') { setPhase('fetch'); setSub(d.msg || ''); }
      else if (d.step === 'frames') { setPhase('frames'); setSub(d.msg || ''); }
      else if (d.step === 'audio') { setPhase('frames'); setSub(d.msg || 'extracting audio…'); }
      else if (d.step === 'ingested') setSub(d.msg || '');
    });
    start();
    return () => { off?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = () => {
    cancelled.current = true;
    window.hjen.breakdownCancel({ runId: runId.current }).catch(() => {});
    if (jobId.current) useStore.getState().finishJob(jobId.current, { status: 'error', error: 'Cancelled' });
    onExit();
  };

  const phaseIdx = PHASE_ORDER.indexOf(phase === 'error' ? brokePhase : phase);
  const visionPct = Math.round((passesDone / VISION_PASSES.length) * 100);

  return (
    <div className="bd-run">
      <div className="bd-run__inner">
        <div className="bd-run__head">
          <div className="bd-eyebrow">MAKING THE BREAKDOWN · تشريح الإعلان</div>
          <h1>{input.title || input.brand || 'Reading the film'}</h1>
        </div>

        {/* phase spine */}
        <div className="bd-run__phases">
          {PHASE_LAMPS.map((p, i) => {
            const done = phaseIdx > PHASE_ORDER.indexOf(p.key);
            const active = phase === p.key || (phase === 'error' && p.key === brokePhase);
            return (
              <div key={p.key} className={`bd-lamp${done ? ' is-done' : ''}${active ? ' is-active' : ''}`}>
                <span className="bd-lamp__dot" />
                <span className="bd-lamp__lbl">{p.label}</span>
                {i < PHASE_LAMPS.length - 1 && <span className="bd-lamp__bar" />}
              </div>
            );
          })}
        </div>

        {/* the 13 axes lighting up */}
        <div className="bd-run__axes" aria-label="craft axes">
          {BREAKDOWN_AXES.map(def => {
            const lit = axesDone.has(def.slug);
            const now = phase === 'vision' && !lit && VISION_PASSES.find(v => label.includes(v.label))?.axes.includes(def.slug);
            return (
              <span key={def.slug} className={`bd-axchip${lit ? ' is-lit' : ''}${now ? ' is-now' : ''}`}>
                {def.en}
              </span>
            );
          })}
        </div>

        {/* status line */}
        {phase !== 'error' ? (
          <div className="bd-run__status">
            <div className="bd-run__label">{phase === 'done' ? 'Done — opening the disc…' : label}</div>
            {phase !== 'done' && (
              <div className="bd-run__sub">
                <span className="bd-run__pulse" aria-hidden="true" /> Working · {fmtElapsed(nowTs - startedAt.current)} elapsed
              </div>
            )}
            {sub && phase !== 'done' && <div className="bd-run__sub">{sub}</div>}
            {phase === 'dna' && dnaDone.size > 0 && <div className="bd-run__sub">{dnaDone.size} axis DNA{dnaDone.size === 1 ? '' : 's'} MADE · dna/*.gem.md</div>}
            {phase === 'master' && masterDone > 0 && <div className="bd-run__sub">{masterDone} shot{masterDone === 1 ? '' : 's'} fused · FRAME + VIDEO + REFERENCES</div>}
            {(phase === 'master' || phase === 'vision') && (
              <div className="bd-run__hint">Each step calls the model — a big film can take a few minutes here. As long as the clock moves, it’s working.</div>
            )}
            {phase === 'vision' && (
              <div className="bd-run__bar"><i style={{ width: `${visionPct}%` }} /></div>
            )}
          </div>
        ) : (
          <div className="bd-run__error">
            <h4>STOPPED — {label}</h4>
            <p className="selectable">{error}</p>
            <div className="bd-run__erractions">
              <button className="bd-actbtn ghost" onClick={onExit}>‹ BACK</button>
              <button className="bd-actbtn primary" onClick={start}>RETRY THIS STAGE →</button>
            </div>
          </div>
        )}

        {phase !== 'error' && phase !== 'done' && (
          <div className="bd-run__foot">
            <button className="bd-actbtn ghost" onClick={onExit}>‹ BACK (KEEP RUNNING)</button>
            <button className="bd-actbtn ghost" onClick={cancel}>CANCEL</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ATTACH to a run already in flight ──────────────────────────────────────
// The picker surfaces every running `breakdown-run` job as a live card; clicking
// one lands here. This does NOT start a run — it MIRRORS the existing BgJob (the
// single source of truth the real run keeps updating from getState after its
// launching component unmounted). Phase spine + status read straight off the
// job's stages/progressText, so leaving and re-opening the run is lossless.
/** Compact elapsed readout — "42s" then "3m 07s". */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}

export function BreakdownProgressLive({ jobId, onDone, onExit }: {
  jobId: string; onDone: (slug: string) => void; onExit: () => void;
}) {
  const job = useStore(s => s.bgJobs.find(j => j.id === jobId));
  const doneFired = useRef(false);

  // When the run lands green, hand the finished slug up so the disc opens.
  useEffect(() => {
    if (doneFired.current) return;
    if (job?.status === 'done') {
      const slug = job.nav?.sub?.breakdownSlug as string | undefined;
      if (slug) { doneFired.current = true; onDone(slug); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  // A once-a-second tick so a long stage visibly counts up — proof the op is
  // alive and how long it's taken, so the client never wonders if it froze.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (job?.status !== 'running') return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [job?.status]);

  if (!job) {
    return (
      <div className="bd-run"><div className="bd-run__inner">
        <div className="bd-run__head"><div className="bd-eyebrow">MAKING THE BREAKDOWN</div><h1>Operation not found</h1></div>
        <div className="bd-run__error">
          <p className="selectable">This run is no longer tracked — it may have been cleared. Check the LOG for its history.</p>
          <div className="bd-run__erractions"><button className="bd-actbtn ghost" onClick={onExit}>‹ BACK</button></div>
        </div>
      </div></div>
    );
  }

  const errored = job.status === 'error' || job.status === 'interrupted';
  const activeKey = job.stages.find(s => s.state === 'active')?.key
    ?? job.stages.find(s => s.state === 'pending')?.key
    ?? 'fetch';
  const phase: Phase = job.status === 'done' ? 'done' : errored ? 'error' : (activeKey as Phase);
  const brokeKey = (job.stages.find(s => s.state === 'error' || s.state === 'interrupted')?.key ?? activeKey) as Phase;
  const phaseIdx = PHASE_ORDER.indexOf(errored ? brokeKey : phase);
  // Light the axis chips once READ (vision) has landed — the job doesn't track
  // per-axis granularity, so this is an honest coarse signal, not a fake.
  const visionDone = (job.stages.find(s => s.key === 'vision')?.state === 'done') || phaseIdx > PHASE_ORDER.indexOf('vision');
  const title = job.title.replace(/^Breakdown · /, '') || 'Reading the film';
  const runId = job.nav?.sub?.runId as string | undefined;

  const cancel = () => {
    if (runId) window.hjen.breakdownCancel({ runId }).catch(() => {});
    useStore.getState().finishJob(job.id, { status: 'error', error: 'Cancelled' });
    onExit();
  };

  return (
    <div className="bd-run"><div className="bd-run__inner">
      <div className="bd-run__head">
        <div className="bd-eyebrow">MAKING THE BREAKDOWN · تشريح الإعلان</div>
        <h1>{title}</h1>
      </div>

      <div className="bd-run__phases">
        {PHASE_LAMPS.map((p, i) => {
          const st = job.stages.find(s => s.key === p.key)?.state;
          const done = st === 'done' || phaseIdx > PHASE_ORDER.indexOf(p.key);
          const active = !errored && st === 'active';
          const broke = errored && p.key === brokeKey;
          return (
            <div key={p.key} className={`bd-lamp${done ? ' is-done' : ''}${active || broke ? ' is-active' : ''}`}>
              <span className="bd-lamp__dot" />
              <span className="bd-lamp__lbl">{p.label}</span>
              {i < PHASE_LAMPS.length - 1 && <span className="bd-lamp__bar" />}
            </div>
          );
        })}
      </div>

      <div className="bd-run__axes" aria-label="craft axes">
        {BREAKDOWN_AXES.map(def => (
          <span key={def.slug} className={`bd-axchip${visionDone ? ' is-lit' : ''}`}>{def.en}</span>
        ))}
      </div>

      {!errored ? (
        <div className="bd-run__status">
          <div className="bd-run__label">{phase === 'done' ? 'Done — opening the disc…' : (job.progressText || 'Working…')}</div>
          {phase !== 'done' && (
            <div className="bd-run__sub">
              <span className="bd-run__pulse" aria-hidden="true" /> Working · {fmtElapsed(nowTs - job.createdAt)} elapsed — safe to leave this page.
            </div>
          )}
          {(activeKey === 'master' || activeKey === 'vision') && phase !== 'done' && (
            <div className="bd-run__hint">Each step calls the model — a big film can take a few minutes here. As long as the clock moves, it’s working.</div>
          )}
        </div>
      ) : (
        <div className="bd-run__error">
          <h4>STOPPED — {job.stages.find(s => s.key === brokeKey)?.label || 'run'}</h4>
          <p className="selectable">{job.error || (job.status === 'interrupted' ? 'The app quit while this run was working — resume it from the LOG.' : 'This run stopped.')}</p>
          <div className="bd-run__erractions"><button className="bd-actbtn ghost" onClick={onExit}>‹ BACK</button></div>
        </div>
      )}

      {!errored && phase !== 'done' && (
        <div className="bd-run__foot">
          <button className="bd-actbtn ghost" onClick={onExit}>‹ BACK (KEEP RUNNING)</button>
          {runId && <button className="bd-actbtn ghost" onClick={cancel}>CANCEL</button>}
        </div>
      )}
    </div></div>
  );
}
