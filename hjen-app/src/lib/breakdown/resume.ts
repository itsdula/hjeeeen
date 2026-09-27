// Crash/quit-resilient RESUME for the operations subsystem.
//
// An `interrupted` BgJob (the app died mid-run) can be RESUMED from its on-disk
// checkpoint — re-running ONLY the unfinished work, never from scratch. This is
// the SAME retro path the Breakdown view's "FINISH THE DNAS" / "MAKE THE MASTER
// PROMPTS" buttons drive: it reads the stored breakdown.json, computes what is
// already on disk (LIVE axis DNAs · shot rows that already carry a masterPrompt),
// and asks the stage runners to make only the remainder.
//
//   breakdown-dna    → finish the missing axis DNAs (skip = already-LIVE)
//   breakdown-master → fuse the missing master prompts (skip = rows with a mp)
//   breakdown-run    → the tail: finish DNAs, then fuse master prompts
//
// A kind with no checkpoint reference (a breakdown-run that died before the film
// was written, so its nav carries no slug) is NOT resumable — resumeStateFor
// returns { can:false } and the UI disables RESUME with an honest hint. We never
// fake resume where there's nothing on disk to continue from.
//
// beginBreakdownResume registers a FRESH running job (via the store's public
// startJob/updateJob/finishJob API, read from getState() so it keeps advancing
// regardless of which view is mounted) and returns its id synchronously; the
// async work then finishes it green (or red on failure). House vocabulary: the
// work is MADE / FUSED, never "generated".

import { useStore, type BgJob, type JobStage } from '../../store';
import { readBreakdown, type BreakdownShotRow, type ShotMasterPrompt } from '../creativemind/breakdown';
import { loadDnaStatuses } from './content';
import { runDnaStage, dnaInputFromBreakdown } from './dna';
import { runMasterPromptStage, masterPromptInputFromBreakdown, mergeMasterPrompts } from './masterPrompt';
import { runBreakdown, runStateFromCheckpoint, type RunEvent } from './run';
import { captureBreakdownToBrain } from '../creativemind/brainCards';

// The full seven-stage spine, mirrored for a breakdown-run RESUME (same keys as
// BreakdownProgress's JOB_STAGES so a resumed run reads identically in the LOG).
const RUN_STAGES: JobStage[] = [
  { key: 'fetch', label: 'Fetch', state: 'pending' },
  { key: 'frames', label: 'Frames', state: 'pending' },
  { key: 'vision', label: 'Read', state: 'pending' },
  { key: 'dna', label: 'DNA', state: 'pending' },
  { key: 'docs', label: 'Docs', state: 'pending' },
  { key: 'master', label: 'Fuse', state: 'pending' },
  { key: 'write', label: 'Write', state: 'pending' },
];

/** Whether — and how — an interrupted job can be resumed. Drives the LOG's
 *  RESUME button (enabled / disabled-with-hint / "resumed"). */
export type ResumeState =
  | { can: true }
  | { can: false; resumed?: boolean; reason: string };

/** The breakdown slug a job's checkpoint lives under, if known. */
function slugOf(job: BgJob): string | null {
  const s = job.nav.sub?.breakdownSlug;
  return typeof s === 'string' && s ? s : null;
}

/** Short human tail of a job title (drops the "Kind · " prefix). */
function titleTail(job: BgJob): string {
  const parts = job.title.split('·');
  return (parts[parts.length - 1] || job.title).trim();
}

export function resumeStateFor(job: BgJob): ResumeState {
  // Resumable on BOTH an interruption (app quit) AND an error (a stage failed) —
  // either way the on-disk checkpoint holds the completed work, so RESUME can
  // continue from it. A run that dies at "master:batch4: fetch failed" must be
  // recoverable, not a dead end.
  if (job.status !== 'interrupted' && job.status !== 'error') return { can: false, reason: 'Not resumable' };
  if (job.resumedJobId) return { can: false, resumed: true, reason: 'Resumed' };
  const slug = slugOf(job);
  switch (job.kind) {
    case 'breakdown-dna':
    case 'breakdown-master':
      return slug ? { can: true } : { can: false, reason: 'Re-run from the tool — no checkpoint reference' };
    case 'breakdown-run':
      // A slug means the film was ingested → a mid-run checkpoint (run-state.json)
      // exists beside the frames, so the run resumes from exactly where it stopped.
      return slug
        ? { can: true }
        : { can: false, reason: 'Stopped before the film was ingested — re-run from the tool' };
    // A crashed image make is not server-recoverable (the image API is
    // synchronous) — RESUME re-applies the exact prompt + settings so the user
    // re-runs with one click. Only an interruption offers this (an error had its
    // own inline retry), so keep it interrupted-only.
    case 'frame-make':
      return job.status === 'interrupted' ? { can: true } : { can: false, reason: 'Re-run from the Frame form' };
    // Video makes are recovered AUTOMATICALLY on reopen by re-polling the
    // server task id, so there is no manual resume to offer here.
    case 'video-make':
    case 'video-recover':
      return { can: false, reason: 'Re-polls the server automatically on reopen' };
    default:
      return { can: false, reason: 'No resume path — re-run from the tool' };
  }
}

/** Register + kick off the resume for an interrupted breakdown job. Returns the
 *  fresh job's id, or null when the job isn't resumable. */
export function beginBreakdownResume(job: BgJob): string | null {
  const st = resumeStateFor(job);
  if (!st.can) return null;
  const slug = slugOf(job)!;
  const jb = useStore.getState();

  // A breakdown-run resumes TRULY — re-enters runBreakdown from the on-disk
  // checkpoint, re-running only the phases that hadn't finished. (The old path
  // only finished the DNA/master tail and needed a written breakdown.json, which
  // never exists mid-run — that was the "not found on disk" failure.)
  if (job.kind === 'breakdown-run') {
    const jobId = jb.startJob({
      kind: 'breakdown-run',
      title: `Resume · ${titleTail(job)}`,
      nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: slug } },
      stages: RUN_STAGES.map(s => ({ ...s })),
      progressText: 'Reading checkpoint…',
    });
    void runFullResume(slug, jobId);
    return jobId;
  }

  if (job.kind === 'breakdown-master') {
    const jobId = jb.startJob({
      kind: 'breakdown-master',
      title: `Resume · master prompts · ${titleTail(job)}`,
      nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: slug } },
      stages: [{ key: 'fuse', label: 'Fuse the missing master prompts', state: 'pending' }],
      progressText: 'Reading checkpoint…',
    });
    void runMasterResume(slug, jobId);
    return jobId;
  }

  // breakdown-dna (the retro "FINISH THE DNAS" on a written breakdown).
  const jobId = jb.startJob({
    kind: job.kind,
    title: `Resume · DNA · ${titleTail(job)}`,
    nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: slug } },
    stages: [{ key: 'distill', label: 'Finish the axis DNAs', state: 'pending' }],
    progressText: 'Reading checkpoint…',
  });
  void runDnaResume(slug, jobId, false);
  return jobId;
}

// Re-enter runBreakdown from the mid-run checkpoint, mirroring its phase events
// onto the resume job so the LOG + tabs read like any live run. Finishes green on
// the disc, or red with the stage that broke. If no checkpoint exists but a
// written breakdown.json does, fall back to the DNA/master tail.
async function runFullResume(slug: string, jobId: string) {
  try {
    let cp: unknown = null;
    try { const r = await window.hjen.breakdownRunstateRead({ slug }); if (r?.ok) cp = r.state; } catch { /* no checkpoint */ }
    const restored = runStateFromCheckpoint(cp);

    if (!restored) {
      const bd = await readBreakdown(slug);
      if (!bd) {
        store().finishJob(jobId, { status: 'error', error: `No checkpoint and no written file for "${slug}" — nothing to resume. Re-run it from the tool.` });
        return;
      }
      // Written but incomplete — finish the DNA/master tail in place.
      await runDnaResume(slug, jobId, true);
      return;
    }

    const { state, brand, title } = restored;
    const reduce = (ev: RunEvent) => {
      const jb = store();
      if (ev.type === 'phase') jb.updateJob(jobId, { activeStage: ev.phase, progressText: ev.label });
      else if (ev.type === 'dna-done') jb.updateJob(jobId, { progressText: `Distilling the axis DNAs — ${ev.done}/${ev.total}` });
      else if (ev.type === 'master-shot') jb.updateJob(jobId, { progressText: `Fusing master prompts — shot ${ev.done}/${ev.total}` });
      else if (ev.type === 'pass-error' || ev.type === 'error') jb.finishJob(jobId, { status: 'error', error: ev.message });
      else if (ev.type === 'done') jb.finishJob(jobId, { status: 'done', nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: ev.slug, breakdownPage: 'disc' } } });
    };

    const res = await runBreakdown({
      input: { brand, title, slug },
      runId: `resume-${jobId}`,
      state,
      emit: reduce,
      cancelled: () => false,
    });

    // Safety net if runBreakdown returned without a terminal event.
    const cur = store().getJob(jobId);
    if (cur && cur.status === 'running') {
      store().finishJob(jobId, res.ok
        ? { status: 'done', nav: { view: 'breakdown', projectId: null, sub: { breakdownSlug: slug, breakdownPage: 'disc' } } }
        : { status: 'error', error: res.message || 'Resume stopped' });
    }
  } catch (e: any) {
    store().finishJob(jobId, { status: 'error', error: String(e?.message || e) });
  }
}

const store = () => useStore.getState();

// Finish the missing axis DNAs, honoring the on-disk checkpoint (skip LIVE ones).
// For a breakdown-run tail, chain into the master-prompt convergence when done.
async function runDnaResume(slug: string, jobId: string, thenMaster: boolean) {
  try {
    const bd = await readBreakdown(slug);
    if (!bd) { store().finishJob(jobId, { status: 'error', error: `Breakdown "${slug}" not found on disk — nothing to resume.` }); return; }
    store().updateJob(jobId, { activeStage: 'distill' });

    const input = dnaInputFromBreakdown(bd);
    const statuses = await loadDnaStatuses(slug);
    const live = new Set(Object.entries(statuses).filter(([, k]) => k === 'live').map(([s]) => s));
    input.skip = live;                                   // CHECKPOINT — never re-make a LIVE DNA
    const total = input.axes.filter(a => !live.has(a.slug)).length;

    if (total > 0) {
      let done = 0;
      store().updateJob(jobId, { progressText: `0 / ${total} axes` });
      const res = await runDnaStage(input, ev => {
        if (ev.type === 'dna-axis') { done += 1; store().updateJob(jobId, { progressText: `${done} / ${total} axes` }); }
      }, () => false);
      if (!res.ok) { store().finishJob(jobId, { status: 'error', error: res.message || 'DNA distillation stopped' }); return; }
    }

    if (!thenMaster) { store().finishJob(jobId, { status: 'done' }); return; }
    await runMasterInto(slug, jobId, 'fuse');
  } catch (e: any) {
    store().finishJob(jobId, { status: 'error', error: String(e?.message || e) });
  }
}

// Single-stage master-prompt resume (breakdown-master).
async function runMasterResume(slug: string, jobId: string) {
  try {
    await runMasterInto(slug, jobId, 'fuse');
  } catch (e: any) {
    store().finishJob(jobId, { status: 'error', error: String(e?.message || e) });
  }
}

// The shared convergence: fuse only the shots that don't already carry a master
// prompt (checkpoint), persist the merged breakdown back to disk, finish the job.
async function runMasterInto(slug: string, jobId: string, stageKey: string) {
  const bd = await readBreakdown(slug);
  if (!bd) { store().finishJob(jobId, { status: 'error', error: `Breakdown "${slug}" not found on disk.` }); return; }
  store().updateJob(jobId, { activeStage: stageKey });

  const input = masterPromptInputFromBreakdown(bd);
  const rows = ((bd.pipeline as any)?.shotlist?.rows || []) as BreakdownShotRow[];
  const already = new Set(rows.filter(r => r.masterPrompt).map(r => r.no));   // CHECKPOINT
  const total = input.shots.filter(s => !already.has(s.no)).length;
  if (total === 0) { store().finishJob(jobId, { status: 'done' }); return; }

  store().updateJob(jobId, { progressText: `0 / ${total} shots` });
  const acc: Record<number, ShotMasterPrompt> = {};
  const res = await runMasterPromptStage(input, ev => {
    if (ev.type === 'mp-shot') { acc[ev.no] = ev.mp; store().updateJob(jobId, { progressText: `${Object.keys(acc).length} / ${total} shots` }); }
  }, () => false, already);

  if (Object.keys(acc).length) {
    const merged = mergeMasterPrompts(bd, acc);
    try { await window.hjen.mindBreakdownWrite({ slug, breakdown: merged }); } catch { /* next resume retries */ }
  }
  // الدماغ الثاني — الالتقاط التلقائي (idempotent؛ يضمن امتلاء الذاكرة حتى عبر مسار الاستئناف).
  try { await captureBreakdownToBrain(bd); } catch { /* capture never blocks resume */ }
  store().finishJob(jobId, res.ok ? { status: 'done' } : { status: 'error', error: res.message || 'Master-prompt fusion stopped' });
}
