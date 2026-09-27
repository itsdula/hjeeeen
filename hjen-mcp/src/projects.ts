// The orient layer — read a project's whole "contract" from disk.
//
// This is what "the MCP understands عقد المشروع and each project's internal
// details" means concretely: one buildOverview() call assembles the 8-stage
// state + ledger, the stage data, the storyboard, the node graph, the
// generations log, and the library — from the same JSON files the app owns.

import fs from 'node:fs';
import path from 'node:path';
import type { Host } from './host.js';
import {
  projectsConfigPath, projectStatePath, projectDataPath, storyboardPath,
  graphPath, libraryRoot, characterCardsRoot, generationsLogPath,
} from './paths.js';
import {
  STAGE_NUMBERS, STAGE_NAMES, type ProjectMeta, type ProjectState,
  type StageNumber, type GenerationLogEntry,
} from './types.js';
import { projectLink } from './deeplinks.js';

function readJson<T = unknown>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch { return null; }
}

export function readProjectsIndex(host: Host): ProjectMeta[] {
  const arr = readJson<ProjectMeta[]>(projectsConfigPath(host));
  return Array.isArray(arr) ? arr : [];
}

export interface ResolveResult {
  project: ProjectMeta | null;
  matches: ProjectMeta[]; // when ambiguous, all name-substring hits
}

/** Resolve id → exact slug → exact name (ci) → name-substring (ci). */
export function resolveProject(host: Host, query: string): ResolveResult {
  const projects = readProjectsIndex(host);
  const q = query.trim();
  const lc = q.toLowerCase();
  const byId = projects.find(p => p.id === q);
  if (byId) return { project: byId, matches: [byId] };
  const bySlug = projects.find(p => p.slug.toLowerCase() === lc);
  if (bySlug) return { project: bySlug, matches: [bySlug] };
  const byName = projects.find(p => p.name.toLowerCase() === lc);
  if (byName) return { project: byName, matches: [byName] };
  const partial = projects.filter(p => p.name.toLowerCase().includes(lc) || p.slug.toLowerCase().includes(lc));
  return { project: partial.length === 1 ? partial[0] : null, matches: partial };
}

export function readProjectState(host: Host, slug: string): ProjectState | null {
  return readJson<ProjectState>(projectStatePath(host, slug));
}

export function readStageData(host: Host, slug: string, stage: StageNumber): unknown {
  return readJson(projectDataPath(host, slug, stage));
}

export function readStoryboard(host: Host, slug: string): Record<string, unknown> | null {
  return readJson<Record<string, unknown>>(storyboardPath(host, slug));
}

export function readGraph(host: Host, slug: string): Record<string, unknown> | null {
  return readJson<Record<string, unknown>>(graphPath(host, slug));
}

export function readGenerationsLog(host: Host): GenerationLogEntry[] {
  const p = generationsLogPath(host);
  try {
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf-8').split(/\r?\n/).filter(Boolean)
      .map(l => { try { return JSON.parse(l) as GenerationLogEntry; } catch { return null; } })
      .filter((x): x is GenerationLogEntry => !!x);
  } catch { return []; }
}

export function listGenerations(host: Host, project: ProjectMeta): GenerationLogEntry[] {
  return readGenerationsLog(host)
    .filter(e => e.projectId === project.id || e.projectSlug === project.slug)
    .sort((a, b) => b.ts - a.ts);
}

/** Best-effort library census: count assets per category subfolder. */
export function libraryCensus(host: Host): { present: boolean; byCategory: Record<string, number> } {
  const root = libraryRoot(host);
  const byCategory: Record<string, number> = {};
  try {
    if (!fs.existsSync(root)) return { present: false, byCategory };
    for (const cat of fs.readdirSync(root, { withFileTypes: true })) {
      if (!cat.isDirectory() || cat.name === 'character_cards') continue;
      const dir = path.join(root, cat.name);
      let n = 0;
      try {
        for (const f of fs.readdirSync(dir)) {
          if (/\.(png|jpe?g|webp|gif|tiff?|bmp|mp4|mov|wav|mp3)$/i.test(f)) n++;
        }
      } catch { /* skip */ }
      byCategory[cat.name] = n;
    }
    return { present: true, byCategory };
  } catch { return { present: false, byCategory }; }
}

/** Shared-library assets WITH absolute paths (reference-ready). Reads the
 *  app-owned {_library}/library.json (array of {id,category,name,filePath,...}),
 *  keeping only image assets. */
export function listLibraryAssets(host: Host): Array<{ id: string; category?: string; name?: string; filePath: string; thumbPath?: string; addedAt?: string }> {
  const f = path.join(libraryRoot(host), 'library.json');
  const arr = readJson<any[]>(f);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(a => a && typeof a.filePath === 'string' && /\.(png|jpe?g|webp|gif|tiff?|bmp)$/i.test(a.filePath) && fs.existsSync(a.filePath))
    .map(a => ({ id: a.id, category: a.category, name: a.name, filePath: a.filePath, thumbPath: typeof a.thumbPath === 'string' ? a.thumbPath : undefined, addedAt: a.addedAt }))
    .sort((x, y) => String(y.addedAt || '').localeCompare(String(x.addedAt || '')));
}

/** Cast cards live at {_library}/character_cards/{id}/card.json. */
export function listCastCards(host: Host): Array<{ id: string; name?: string }> {
  const root = characterCardsRoot(host);
  const out: Array<{ id: string; name?: string }> = [];
  try {
    if (!fs.existsSync(root)) return out;
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const card = readJson<{ id?: string; name?: string }>(path.join(root, d.name, 'card.json'));
      out.push({ id: card?.id || d.name, name: card?.name });
    }
  } catch { /* skip */ }
  return out;
}

// ---- The assembled contract -------------------------------------------------

const num = (a: unknown) => (Array.isArray(a) ? a.length : 0);

export function buildOverview(host: Host, project: ProjectMeta) {
  const state = readProjectState(host, project.slug);

  // Contract: 8-stage status + ledger. state.json wins; else the ProjectMeta
  // mirror (which may be a bare status string or a { status } object).
  const stages = STAGE_NUMBERS.map(n => {
    const fromState = state?.stages?.[n];
    const meta = project.stagesState?.[n];
    const metaStatus = typeof meta === 'string' ? meta : meta?.status;
    return {
      stage: n,
      name: STAGE_NAMES[n],
      status: fromState?.status ?? metaStatus ?? 'draft',
      signedAt: fromState?.signedAt,
    };
  });

  // Stage data: parse the two single-file stages, presence-flag the manifests
  const brief = readStageData(host, project.slug, 1);
  const treatment = readStageData(host, project.slug, 4);
  const manifests: Record<string, boolean> = {};
  for (const n of [2, 3, 5, 6, 7, 8] as StageNumber[]) {
    manifests[STAGE_NAMES[n].toLowerCase()] = readStageData(host, project.slug, n) != null;
  }

  // Storyboard summary
  const sb = readStoryboard(host, project.slug);
  const storyboard = sb ? {
    present: true,
    scriptChars: String((sb as any).scriptText || '').length,
    counts: {
      shots: num((sb as any).shots),
      characters: num((sb as any).characters),
      places: num((sb as any).places),
      elements: num((sb as any).elements),
    },
    shots: (Array.isArray((sb as any).shots) ? (sb as any).shots : []).slice(0, 60).map((s: any) => ({
      id: s.id, scene: s.scene, letter: s.letter, description: s.description,
      status: s.status, hasImage: !!s.generatedImagePath, takes: num(s.takes),
    })),
  } : { present: false };

  // Node graph summary
  const g = readGraph(host, project.slug);
  const nodeTypes: Record<string, number> = {};
  if (g && Array.isArray((g as any).nodes)) {
    for (const nd of (g as any).nodes) nodeTypes[nd.type] = (nodeTypes[nd.type] || 0) + 1;
  }
  const nodeGraph = g ? {
    present: true,
    name: (g as any).name,
    counts: { nodes: num((g as any).nodes), edges: num((g as any).edges), matrices: num((g as any).matrices) },
    nodeTypes,
  } : { present: false };

  // Generations
  const gens = listGenerations(host, project);
  const generations = {
    total: gens.length,
    recent: gens.slice(0, 10).map(e => ({
      ts: e.ts, promptTitle: e.promptTitle, modelLabel: e.modelLabel,
      aspect: e.aspect, quality: e.quality, costUsd: e.costUsd, imgPath: e.imgPath,
    })),
  };

  return {
    project: {
      id: project.id, name: project.name, slug: project.slug, created: project.created,
      generationCount: project.generationCount, currentStage: state?.currentStage ?? project.currentStage,
      coverImagePath: project.coverImagePath,
    },
    contract: {
      currentStage: state?.currentStage ?? project.currentStage ?? 1,
      stages,
      ledger: state?.ledger ?? [],
    },
    stageData: { brief, treatment, manifests },
    storyboard,
    nodeGraph,
    generations,
    library: libraryCensus(host),
    cast: listCastCards(host),
    deepLinks: {
      overview: projectLink(project.id, 'overview'),
      storyboard: projectLink(project.id, 'storyboard'),
      node: projectLink(project.id, 'node'),
    },
  };
}
