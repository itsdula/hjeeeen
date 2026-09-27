// Bundled BREAKDOWN content compiled into the app.
//  · JOBS  — the 13 universal per-axis job Gems (job_<slug>.md). Per-axis, not
//            per-ad — the same construction is reused for every breakdown.
//  · DNA_SAMPLES — labelled DEMO fallbacks, keyed '<breakdownSlug>/<axisSlug>'.
//            Shown ONLY when the selected breakdown has no real dna/<slug>.gem.md
//            on disk yet. Today: the sealed grading_color sample for nike-why-do-it.
// Real per-breakdown DNA is read from the breakdown's own dna/ folder via IPC —
// see loadBreakdownDna(). These bundles are the seed/demo layer only.

import { parseGem, Gem } from './gem';

const jobRaw = import.meta.glob('../../assets/breakdowns/jobs/*.md', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

/** slug → parsed job Gem (five segments + header). */
export const JOBS: Record<string, Gem> = {};
/** slug → RAW job markdown — fed verbatim into the vision pass as that axis's
 *  analysis brief (the run appends the reproduction_prompt requirement). */
export const JOB_RAW: Record<string, string> = {};
for (const p in jobRaw) {
  const m = /job_([a-z_]+)\.md$/.exec(p);
  if (m) { JOBS[m[1]] = parseGem(jobRaw[p]); JOB_RAW[m[1]] = jobRaw[p]; }
}

const dnaSampleRaw = import.meta.glob('../../assets/breakdowns/dna_samples/*.gem.md', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

/** '<breakdownSlug>/<axisSlug>' → parsed demo DNA Gem. */
export const DNA_SAMPLES: Record<string, Gem> = {};
for (const p in dnaSampleRaw) {
  const m = /([a-z0-9-]+)__([a-z_]+)\.gem\.md$/.exec(p);
  if (m) DNA_SAMPLES[`${m[1]}/${m[2]}`] = parseGem(dnaSampleRaw[p]);
}

export function jobFor(axisSlug: string): Gem | null {
  return JOBS[axisSlug] || null;
}

export function demoDnaFor(breakdownSlug: string, axisSlug: string): Gem | null {
  return DNA_SAMPLES[`${breakdownSlug}/${axisSlug}`] || null;
}

// ─── per-breakdown DNA (the forward factory contract) ───────────────────────

export type DnaState =
  | { kind: 'live'; gem: Gem }        // real dna/<slug>.gem.md found on disk
  | { kind: 'demo'; gem: Gem }        // no real file yet; bundled demo sample
  | { kind: 'pending' };              // nothing yet — made after the factory run

/** Which axis DNAs exist for a breakdown: the real folder files (live) unioned
 *  with any bundled demo samples for this slug. */
export async function loadDnaStatuses(breakdownSlug: string): Promise<Record<string, DnaState['kind']>> {
  const out: Record<string, DnaState['kind']> = {};
  let live: string[] = [];
  try {
    const res = await window.hjen.mindBreakdownDnaList({ slug: breakdownSlug });
    if (res?.ok && Array.isArray(res.slugs)) live = res.slugs;
  } catch { /* no dna dir yet — all pending unless a demo exists */ }
  for (const s of live) out[s] = 'live';
  for (const key of Object.keys(DNA_SAMPLES)) {
    const [bs, ax] = key.split('/');
    if (bs === breakdownSlug && !out[ax]) out[ax] = 'demo';
  }
  return out;
}

/** Resolve ONE axis DNA: real folder file first, then bundled demo, then pending. */
export async function loadBreakdownDna(breakdownSlug: string, axisSlug: string): Promise<DnaState> {
  try {
    const res = await window.hjen.mindBreakdownDnaRead({ slug: breakdownSlug, axis: axisSlug });
    if (res?.ok && typeof res.text === 'string' && res.text.trim()) {
      return { kind: 'live', gem: parseGem(res.text) };
    }
  } catch { /* fall through to demo/pending */ }
  const demo = demoDnaFor(breakdownSlug, axisSlug);
  if (demo) return { kind: 'demo', gem: demo };
  return { kind: 'pending' };
}
