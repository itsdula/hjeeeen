// Persist a made asset in the EXACT layout the desktop app uses, so MCP-made
// frames/videos appear in the app's Usage + Library. Mirrors main.ts
// save-generation / save-video: {root}/{slug|_unassigned}/{date}/{ts}_{slug}.{ext}
// + .json sidecar, plus an append to the durable _generations.jsonl.
// (No thumbnail — that needs Electron nativeImage; the app falls back to the full image.)

import fs from 'node:fs';
import path from 'node:path';
import type { Host } from './host.js';
import type { ProjectMeta } from './types.js';
import { generationsLogPath, projectsConfigPath } from './paths.js';
import { readProjectsIndex } from './projects.js';
import { atomicWrite } from './writers.js';

function stamp(): { today: string; ts: string } {
  const iso = new Date().toISOString();
  return { today: iso.slice(0, 10), ts: iso.replace(/[:.]/g, '-').slice(0, 19) };
}
const safe = (s: string) => (s || 'untitled').replace(/[^a-z0-9-_]/gi, '-').replace(/-+/g, '-').slice(0, 60) || 'untitled';

function bumpCount(host: Host, project: ProjectMeta | null): string {
  if (!project) return '(unassigned)';
  const arr = readProjectsIndex(host);
  const t = arr.find(p => p.id === project.id);
  if (t) { t.generationCount = (t.generationCount || 0) + 1; atomicWrite(projectsConfigPath(host), JSON.stringify(arr, null, 2)); return t.name; }
  return project.name;
}

function appendLog(host: Host, entry: Record<string, unknown>): void {
  try { fs.mkdirSync(host.projectsRoot(), { recursive: true }); fs.appendFileSync(generationsLogPath(host), JSON.stringify(entry) + '\n'); }
  catch { /* log is best-effort */ }
}

export interface SaveInput {
  base64: string;
  sidecar: any;
  promptSlug: string;
  project?: ProjectMeta | null;
}

function saveBinary(host: Host, ext: string, input: SaveInput): { filePath: string; jsonPath: string; dir: string; base: string; today: string } {
  const { today, ts } = stamp();
  const bucket = input.project?.slug || '_unassigned';
  const dir = path.join(host.projectsRoot(), bucket, today);
  fs.mkdirSync(dir, { recursive: true });
  const base = `${ts}_${safe(input.promptSlug)}`;
  const filePath = path.join(dir, `${base}.${ext}`);
  const jsonPath = path.join(dir, `${base}.json`);
  fs.writeFileSync(filePath, Buffer.from(input.base64, 'base64'));
  fs.writeFileSync(jsonPath, JSON.stringify(input.sidecar, null, 2));
  return { filePath, jsonPath, dir, base, today };
}

export function saveImage(host: Host, input: SaveInput): { imgPath: string; jsonPath: string; dir: string } {
  const { filePath, jsonPath, base, today } = saveBinary(host, 'png', input);
  const name = bumpCount(host, input.project ?? null);
  const sc = input.sidecar || {};
  appendLog(host, {
    ts: Date.now(), imgPath: filePath, jsonPath, dateFolder: today, baseName: base,
    captured: sc.captured ?? null,
    promptTitle: (sc.selections?.prompt || '').split(/[.!?\n,]/)[0]?.trim()?.slice(0, 100) || base.split('_').slice(1).join(' ').replace(/-/g, ' '),
    finalSize: sc.finalSize || sc.size, modelLabel: sc.model, quality: sc.selections?.quality, aspect: sc.selections?.aspect,
    costUsd: typeof sc.estimatedCost?.usd === 'number' ? sc.estimatedCost.usd : undefined,
    durationMs: typeof sc.durationMs === 'number' ? sc.durationMs : undefined,
    referencesCount: Array.isArray(sc.references) ? sc.references.length : 0,
    projectId: input.project?.id ?? null, projectName: name, projectSlug: input.project?.slug || '_unassigned',
  });
  return { imgPath: filePath, jsonPath, dir: path.dirname(filePath) };
}

/** Persist a USER-UPLOADED asset (image or document) in the same layout as
 *  made assets, so it appears in the app's Library/Usage. Logged with
 *  modelLabel 'UPLOAD' so it is distinguishable from paid makes. */
export function saveUpload(host: Host, ext: string, input: SaveInput): { filePath: string; jsonPath: string; dir: string } {
  const { filePath, jsonPath, base, today } = saveBinary(host, ext, input);
  const name = bumpCount(host, input.project ?? null);
  const sc = input.sidecar || {};
  appendLog(host, {
    ts: Date.now(), imgPath: filePath, jsonPath, dateFolder: today, baseName: base,
    captured: sc.captured ?? null,
    promptTitle: sc.note ? String(sc.note).slice(0, 100) : base.split('_').slice(1).join(' ').replace(/-/g, ' '),
    modelLabel: 'UPLOAD', aspect: undefined,
    costUsd: 0, referencesCount: 0,
    projectId: input.project?.id ?? null, projectName: name, projectSlug: input.project?.slug || '_unassigned',
  });
  return { filePath, jsonPath, dir: path.dirname(filePath) };
}

/** Persist a STORYBOARD PANEL image into the board's own folder
 *  ({slug}/_storyboard/images/{date}/) — NOT the project generation folder — so
 *  panels never leak into the Frame history / Usage. Mirrors the app's
 *  hjen:save-storyboard-image. No _generations.jsonl append. */
export function saveStoryboardImage(host: Host, input: SaveInput): { imgPath: string; jsonPath: string; dir: string } {
  const { today, ts } = stamp();
  const bucket = input.project?.slug || '_unassigned';
  const dir = path.join(host.projectsRoot(), bucket, '_storyboard', 'images', today);
  fs.mkdirSync(dir, { recursive: true });
  const base = `${ts}_${safe(input.promptSlug)}`;
  const imgPath = path.join(dir, `${base}.png`);
  const jsonPath = path.join(dir, `${base}.json`);
  fs.writeFileSync(imgPath, Buffer.from(input.base64, 'base64'));
  fs.writeFileSync(jsonPath, JSON.stringify(input.sidecar, null, 2));
  return { imgPath, jsonPath, dir };
}

export function saveVideo(host: Host, input: SaveInput): { videoPath: string; jsonPath: string; dir: string } {
  const { filePath, jsonPath, base, today } = saveBinary(host, 'mp4', input);
  const name = bumpCount(host, input.project ?? null);
  const sc = input.sidecar || {};
  appendLog(host, {
    ts: Date.now(), imgPath: filePath, jsonPath, dateFolder: today, baseName: base,
    captured: sc.captured ?? null,
    promptTitle: (sc.prompt || '').split(/[.!?\n,]/)[0]?.trim()?.slice(0, 100) || base.split('_').slice(1).join(' ').replace(/-/g, ' '),
    modelLabel: sc.model, aspect: sc.ratio,
    costUsd: typeof sc.estimatedCost?.usd === 'number' ? sc.estimatedCost.usd : undefined,
    durationMs: typeof sc.durationMs === 'number' ? sc.durationMs : undefined,
    referencesCount: 0,
    projectId: input.project?.id ?? null, projectName: name, projectSlug: input.project?.slug || '_unassigned',
  });
  return { videoPath: filePath, jsonPath, dir: path.dirname(filePath) };
}
