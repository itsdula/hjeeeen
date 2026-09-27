// BREAKDOWN — per-axis job briefs (the analysis recipe), loaded from the deployed
// jobs/*.md on disk (server port of the app's Vite-glob content loader). LAW: this
// IS the recipe — it lives server-side, never shipped to the client.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JOBS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'jobs');

/** slug → RAW job markdown, fed verbatim into the vision pass as that axis's brief. */
export const JOB_RAW = {};
try {
  for (const f of fs.readdirSync(JOBS_DIR)) {
    const m = /job_([a-z_]+)\.md$/.exec(f);
    if (m) JOB_RAW[m[1]] = fs.readFileSync(path.join(JOBS_DIR, f), 'utf-8');
  }
} catch { /* no jobs dir → JOB_RAW stays empty; the run degrades to bare axis names */ }
