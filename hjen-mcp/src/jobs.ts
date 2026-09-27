// In-memory job registry for long-running work (video renders). The stdio
// server is a persistent process, so jobs live for the session; each update is
// snapshotted to {root}/_mcp_jobs/{id}.json so a crash leaves a trail. Uses a
// submit→poll pattern: submit returns a jobId, wait/get track it.

import fs from 'node:fs';
import path from 'node:path';
import type { Host } from './host.js';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export interface Job {
  id: string; kind: string; status: JobStatus;
  progress?: string; result?: any; error?: string;
  createdAt: number; updatedAt: number; meta?: any;
}

const jobs = new Map<string, Job>();
let host: Host | null = null;
export function initJobs(h: Host): void { host = h; }

function snapshot(job: Job): void {
  if (!host) return;
  try {
    const dir = path.join(host.projectsRoot(), '_mcp_jobs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${job.id}.json`), JSON.stringify(job, null, 2));
  } catch { /* best-effort */ }
}

const uid = () => `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function createJob(kind: string, meta?: any): Job {
  const now = Date.now();
  const job: Job = { id: uid(), kind, status: 'queued', createdAt: now, updatedAt: now, meta };
  jobs.set(job.id, job); snapshot(job); return job;
}
export function updateJob(id: string, patch: Partial<Job>): Job | null {
  const j = jobs.get(id); if (!j) return null;
  Object.assign(j, patch, { updatedAt: Date.now() }); snapshot(j); return j;
}
export function getJob(id: string): Job | null { return jobs.get(id) ?? null; }

export async function waitJob(id: string, timeoutMs = 120_000): Promise<Job | null> {
  const start = Date.now();
  for (;;) {
    const j = jobs.get(id);
    if (!j) return null;
    if (j.status === 'succeeded' || j.status === 'failed') return j;
    if (Date.now() - start > timeoutMs) return j;   // caller polls again
    await new Promise(r => setTimeout(r, 2000));
  }
}

/** Public-facing view — omits bulky meta internals. */
export function view(j: Job | null): any {
  if (!j) return null;
  return { id: j.id, kind: j.kind, status: j.status, progress: j.progress, result: j.result, error: j.error, createdAt: j.createdAt, updatedAt: j.updatedAt, project: j.meta?.project?.slug, taskId: j.meta?.taskId };
}
