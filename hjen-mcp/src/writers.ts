// Author-the-contract writers — headless mirrors of electron/main.ts's write
// handlers, byte-for-byte on the SAME files, WITH the same safety discipline:
// atomic writes (tmp+rename), throttled/deduped backups, empty-overwrite guard.
// The desktop app reads these files on next load (Phase 3 adds live hot-reload).

import fs from 'node:fs';
import path from 'node:path';
import type { Host } from './host.js';
import {
  projectsConfigPath, projectFolder, projectStatePath, projectDataPath,
  storyboardPath, graphPath,
} from './paths.js';
import {
  STAGE_NUMBERS, type ProjectMeta, type ProjectState, type StageNumber,
  type ProjectLedgerEntry, type StageStatus,
} from './types.js';
import { readProjectsIndex } from './projects.js';
import { pingControl } from './control-ping.js';

// ---- primitives -------------------------------------------------------------

/** Atomic write — tmp file + rename (no half-written file on crash). */
export function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

const uid = (n = 6) => `${Date.now()}-${Math.random().toString(36).slice(2, 2 + n)}`;
const readJson = <T>(f: string): T | null => {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) as T : null; } catch { return null; }
};

// ---- projects.json index ----------------------------------------------------

function writeProjectsIndex(host: Host, arr: ProjectMeta[]): void {
  atomicWrite(projectsConfigPath(host), JSON.stringify(arr, null, 2));
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'untitled';
}

/** After a state write, mirror currentStage + status map onto ProjectMeta so
 *  the Projects list renders without reading each state.json. Matches main.ts. */
function syncMetaMirror(host: Host, id: string, state: ProjectState): ProjectMeta | null {
  const arr = readProjectsIndex(host);
  const target = arr.find(p => p.id === id);
  if (!target) return null;
  target.currentStage = state.currentStage;
  const mirror: Partial<Record<StageNumber, StageStatus>> = {};
  for (const n of STAGE_NUMBERS) mirror[n] = state.stages[n]?.status ?? 'draft';
  target.stagesState = mirror;
  writeProjectsIndex(host, arr);
  return target;
}

// ---- project state ----------------------------------------------------------

function emptyProjectState(): ProjectState {
  const stages = {} as ProjectState['stages'];
  for (const n of STAGE_NUMBERS) stages[n] = { status: 'draft' };
  return { version: 1, currentStage: 1, stages, ledger: [] };
}

export function ensureState(host: Host, slug: string): ProjectState {
  const existing = readJson<ProjectState>(projectStatePath(host, slug));
  if (existing && existing.version === 1) return existing;
  const fresh = emptyProjectState();
  atomicWrite(projectStatePath(host, slug), JSON.stringify(fresh, null, 2));
  return fresh;
}

export function writeState(host: Host, project: ProjectMeta, state: ProjectState): ProjectMeta | null {
  if (!state || state.version !== 1) throw new Error('state.version must be 1');
  atomicWrite(projectStatePath(host, project.slug), JSON.stringify(state, null, 2));
  const meta = syncMetaMirror(host, project.id, state);
  pingControl(host, { projectId: project.id, kind: 'state' });
  return meta;
}

export function createProject(host: Host, name: string): ProjectMeta {
  const arr = readProjectsIndex(host);
  const base = slugify(name);
  let slug = base, n = 2;
  while (arr.some(p => p.slug === slug)) slug = `${base}-${n++}`;
  const project: ProjectMeta = {
    id: uid(), name: (name || 'Untitled Project').trim(), slug,
    created: new Date().toISOString(), generationCount: 0,
  };
  arr.unshift(project);
  writeProjectsIndex(host, arr);
  fs.mkdirSync(projectFolder(host, slug), { recursive: true });
  const seeded = ensureState(host, slug);
  const meta = syncMetaMirror(host, project.id, seeded) ?? project;
  // Live-refresh a running app: without this ping the new project only shows
  // after a restart (the renderer caches the projects index in its store).
  pingControl(host, { projectId: project.id, kind: 'projects' });
  return meta;
}

export function signStage(host: Host, project: ProjectMeta, stage: StageNumber, signed: boolean): ProjectState {
  const state = ensureState(host, project.slug);
  state.stages[stage] = signed ? { status: 'signed', signedAt: new Date().toISOString() } : { status: 'draft' };
  writeState(host, project, state);
  return state;
}

export function setCurrentStage(host: Host, project: ProjectMeta, stage: StageNumber): ProjectState {
  const state = ensureState(host, project.slug);
  state.currentStage = stage;
  writeState(host, project, state);
  return state;
}

export function addLedger(host: Host, project: ProjectMeta, kind: ProjectLedgerEntry['kind'], body: string): ProjectLedgerEntry {
  const state = ensureState(host, project.slug);
  const entry: ProjectLedgerEntry = { id: uid(), ts: Date.now(), kind, body };
  state.ledger = [entry, ...(state.ledger || [])];
  writeState(host, project, state);
  return entry;
}

// ---- stage data -------------------------------------------------------------

function stageMarkdownFilename(stage: StageNumber): string | null {
  return stage === 1 ? '01_brief.md' : stage === 4 ? '04_treatment.md' : null;
}

export function writeStageData(host: Host, project: ProjectMeta, stage: StageNumber, data: unknown, markdown?: string): void {
  atomicWrite(projectDataPath(host, project.slug, stage), JSON.stringify(data, null, 2));
  const mdName = stageMarkdownFilename(stage);
  if (mdName && typeof markdown === 'string') {
    atomicWrite(path.join(projectFolder(host, project.slug), '_project', mdName), markdown);
  }
}

// ---- backup engine (shared by storyboard + graph) --------------------------

function listBackups(bdir: string, prefix: string): string[] {
  if (!fs.existsSync(bdir)) return [];
  return fs.readdirSync(bdir).filter(n => n.startsWith(prefix) && n.endsWith('.json')).sort();
}

/** Snapshot prevRaw into bdir with dedup (skip identical) + throttle (skip if
 *  newest < 90s old and `throttleOk`) + retention (keep `keep` newest). */
function writeBackup(bdir: string, prefix: string, prevRaw: string, keep: number, throttleOk: (newestRaw: string) => boolean): void {
  try {
    fs.mkdirSync(bdir, { recursive: true });
    const files = listBackups(bdir, prefix);
    const newest = files.length ? path.join(bdir, files[files.length - 1]) : null;
    if (newest) {
      const newestRaw = fs.readFileSync(newest, 'utf-8');
      if (newestRaw === prevRaw) return;
      const ageMs = Date.now() - fs.statSync(newest).mtimeMs;
      if (ageMs < 90_000 && throttleOk(newestRaw)) return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    atomicWrite(path.join(bdir, `${prefix}${stamp}.json`), prevRaw);
    const after = listBackups(bdir, prefix);
    for (const old of after.slice(0, Math.max(0, after.length - keep))) {
      try { fs.unlinkSync(path.join(bdir, old)); } catch { /* ignore */ }
    }
  } catch { /* backups never block a write */ }
}

// ---- storyboard -------------------------------------------------------------

const len = (a: unknown) => (Array.isArray(a) ? a.length : 0);
function sbPopulated(d: any): boolean {
  return len(d?.shots) > 0 || len(d?.characters) > 0 || len(d?.places) > 0 || len(d?.elements) > 0 || !!String(d?.scriptText || '').trim();
}
function sbSignature(d: any): string {
  return [len(d?.shots), len(d?.characters), len(d?.places), len(d?.elements), String(d?.scriptText || '').length].join(':');
}

export function emptyStoryboard(projectId?: string): any {
  return {
    version: 1, projectId, scriptText: '', shots: [], characters: [], places: [], elements: [],
    presetId: 'graphite', model: 'GPT_IMAGE_2', quality: 'MED', aspect: '16:9', client: {}, step: 1,
    updatedAt: new Date().toISOString(),
  };
}

export interface WriteResult { ok: boolean; reason?: string }

export function writeStoryboard(host: Host, project: ProjectMeta, data: any, allowEmpty = false): WriteResult {
  const f = storyboardPath(host, project.slug);
  const next = data || {};
  const nextEmpty = !sbPopulated(next);
  try {
    if (fs.existsSync(f)) {
      const prevRaw = fs.readFileSync(f, 'utf-8');
      const prev = JSON.parse(prevRaw);
      if (sbPopulated(prev)) {
        writeBackup(path.join(path.dirname(f), 'backups'), 'storyboard_', prevRaw, 60,
          (newestRaw) => { try { return sbSignature(JSON.parse(newestRaw)) === sbSignature(prev); } catch { return false; } });
        if (nextEmpty && !allowEmpty) return { ok: false, reason: 'refused_empty_overwrite' };
      }
    }
  } catch { /* unreadable prev — fall through and write */ }
  atomicWrite(f, JSON.stringify(next, null, 2));
  pingControl(host, { projectId: project.id, kind: 'storyboard' });
  return { ok: true };
}

/** Create or update one shot by id (or scene+letter). Returns the merged shot. */
export function upsertShot(host: Host, project: ProjectMeta, patch: any): { shot: any; panelId: string } {
  const sb = readJson<any>(storyboardPath(host, project.slug)) || emptyStoryboard(project.id);
  sb.projectId = project.id;
  sb.shots = Array.isArray(sb.shots) ? sb.shots : [];
  let shot = patch.id ? sb.shots.find((s: any) => s.id === patch.id) : undefined;
  if (!shot && patch.scene != null && patch.letter) shot = sb.shots.find((s: any) => s.scene === patch.scene && s.letter === patch.letter);
  if (shot) {
    Object.assign(shot, patch);
  } else {
    shot = { id: patch.id || uid(), scene: patch.scene ?? 0, letter: patch.letter ?? 'A', description: patch.description ?? '', status: patch.status || 'pending', ...patch };
    shot.id = shot.id || uid();
    sb.shots.push(shot);
  }
  sb.updatedAt = new Date().toISOString();
  writeStoryboard(host, project, sb, false);
  return { shot, panelId: `${shot.scene}${shot.letter}` };
}

// ---- node graph -------------------------------------------------------------

function graphPopulated(d: any): boolean {
  if (len(d?.nodes) > 0) return true;
  if (Array.isArray(d?.canvases)) return d.canvases.some((c: any) => len(c?.nodes) > 0);
  return false;
}

export function emptyGraph(name = 'Node Graph'): any {
  const now = new Date().toISOString();
  return { schemaVersion: 2, id: uid(), name, nodes: [], edges: [], matrices: [], createdAt: now, updatedAt: now };
}

export function writeGraph(host: Host, project: ProjectMeta, doc: any, allowEmpty = false): WriteResult {
  const f = graphPath(host, project.slug);
  const next = doc || {};
  const nextEmpty = !graphPopulated(next);
  try {
    if (fs.existsSync(f)) {
      const prevRaw = fs.readFileSync(f, 'utf-8');
      const prev = JSON.parse(prevRaw);
      if (graphPopulated(prev)) {
        writeBackup(path.join(path.dirname(f), 'backups'), 'graph_', prevRaw, 40, () => true);
        if (nextEmpty && !allowEmpty) return { ok: false, reason: 'refused_empty_overwrite' };
      }
    }
  } catch { /* fall through */ }
  atomicWrite(f, JSON.stringify(next, null, 2));
  pingControl(host, { projectId: project.id, kind: 'graph' });
  return { ok: true };
}

/** Merge nodes + edges (by id) into the graph. Returns the resulting counts. */
export function upsertGraph(host: Host, project: ProjectMeta, patch: { name?: string; nodes?: any[]; edges?: any[] }): { nodes: number; edges: number } {
  const g = readJson<any>(graphPath(host, project.slug)) || emptyGraph(patch.name);
  g.nodes = Array.isArray(g.nodes) ? g.nodes : [];
  g.edges = Array.isArray(g.edges) ? g.edges : [];
  if (patch.name) g.name = patch.name;
  for (const nd of patch.nodes || []) {
    const id = nd.id || uid();
    const i = g.nodes.findIndex((x: any) => x.id === id);
    const node = { id, type: nd.type, position: nd.position || { x: 0, y: 0 }, paramValues: nd.paramValues || {} };
    if (i >= 0) g.nodes[i] = { ...g.nodes[i], ...node }; else g.nodes.push(node);
  }
  for (const ed of patch.edges || []) {
    const id = ed.id || uid();
    const i = g.edges.findIndex((x: any) => x.id === id);
    const edge = { id, from: ed.from, to: ed.to };
    if (i >= 0) g.edges[i] = edge; else g.edges.push(edge);
  }
  g.updatedAt = new Date().toISOString();
  writeGraph(host, project, g, false);
  return { nodes: g.nodes.length, edges: g.edges.length };
}
