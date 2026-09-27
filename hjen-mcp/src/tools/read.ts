// Read / orient tools. The agent is nudged to call hjen_project_overview FIRST
// (orient-before-act): it returns the whole contract so every later action is
// grounded. Every result is JSON text; project-scoped tools resolve by id,
// slug, or name and fail loudly on ambiguity.

import { McpServer, type ToolResult } from '../mcp/server.js';
import type { Host } from '../host.js';
import {
  readProjectsIndex, resolveProject, buildOverview,
  readStoryboard, readGraph, listGenerations, listLibraryAssets,
} from '../projects.js';
import { listModels } from '../models.js';
import type { ProjectMeta } from '../types.js';

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: true });

const PROJECT_ARG = {
  type: 'object' as const,
  properties: { project: { type: 'string', description: 'Project id, slug, or name.' } },
  required: ['project'],
};

/** Resolve or return a structured ambiguity/not-found error. */
function need(host: Host, query: string): { project: ProjectMeta } | { error: ToolResult } {
  const { project, matches } = resolveProject(host, query);
  if (project) return { project };
  return {
    error: fail({
      error: matches.length > 1 ? 'ambiguous' : 'not_found',
      query,
      matches: matches.map(m => ({ id: m.id, name: m.name, slug: m.slug })),
      hint: 'Pass an exact id or slug from hjen_projects_list.',
    }),
  };
}

export function registerReadTools(server: McpServer, host: Host): void {
  server.tool({
    name: 'hjen_projects_list',
    title: 'List HJEN projects',
    description: 'List all HJEN Studio projects with id, name, slug, and current pipeline stage. Start here.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Optional name/slug substring filter.' } } },
    handler: ({ query }) => {
      let arr = readProjectsIndex(host);
      const q = typeof query === 'string' ? query.trim() : '';
      if (q) { const lc = q.toLowerCase(); arr = arr.filter(p => p.name.toLowerCase().includes(lc) || p.slug.toLowerCase().includes(lc)); }
      return ok({
        projectsRoot: host.projectsRoot(),
        count: arr.length,
        projects: arr.map(p => ({ id: p.id, name: p.name, slug: p.slug, currentStage: p.currentStage, created: p.created })),
      });
    },
  });

  server.tool({
    name: 'hjen_project_overview',
    title: 'HJEN project overview (the contract)',
    description: 'The whole project contract + internals in one read: 8-stage state + ledger, stage data (brief/treatment + manifest presence), storyboard summary, node-graph summary, recent generations, library census, cast, and deep-links. Call this BEFORE acting on a project.',
    inputSchema: PROJECT_ARG,
    handler: ({ project }) => {
      const r = need(host, String(project ?? ''));
      if ('error' in r) return r.error;
      return ok(buildOverview(host, r.project));
    },
  });

  server.tool({
    name: 'hjen_storyboard_read',
    title: 'Read the storyboard',
    description: 'Return the full storyboard.json for a project (shots, characters, places, elements, takes).',
    inputSchema: PROJECT_ARG,
    handler: ({ project }) => {
      const r = need(host, String(project ?? ''));
      if ('error' in r) return r.error;
      const sb = readStoryboard(host, r.project.slug);
      return ok(sb ?? { present: false, project: r.project.slug });
    },
  });

  server.tool({
    name: 'hjen_graph_read',
    title: 'Read the node graph',
    description: 'Return the full node-engine GraphDoc for a project (nodes, edges, matrices).',
    inputSchema: PROJECT_ARG,
    handler: ({ project }) => {
      const r = need(host, String(project ?? ''));
      if ('error' in r) return r.error;
      const g = readGraph(host, r.project.slug);
      return ok(g ?? { present: false, project: r.project.slug });
    },
  });

  server.tool({
    name: 'hjen_generations_list',
    title: 'List a project’s generations',
    description: 'List the durable generation log for a project (most recent first): prompt title, model, aspect, cost, path.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id, slug, or name.' },
        limit: { type: 'number', description: 'Max entries (default 25, max 200).' },
      },
      required: ['project'],
    },
    handler: ({ project, limit }) => {
      const r = need(host, String(project ?? ''));
      if ('error' in r) return r.error;
      const n = Math.min(200, Math.max(1, Number(limit) || 25));
      const all = listGenerations(host, r.project);
      return ok({ total: all.length, entries: all.slice(0, n) });
    },
  });

  server.tool({
    name: 'hjen_library_list',
    title: 'List shared-library assets (with paths)',
    description: 'List the shared library\'s image assets with absolute file paths — reference-ready. Filter by `category` (character/location/prop/wardrobe/composition/general). Use these paths as `references` (frame) or `imagePath` (video).',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category filter (character, location, prop, wardrobe, composition, general).' },
        limit: { type: 'number', description: 'Max entries (default 60, max 300).' },
      },
    },
    handler: ({ category, limit }) => {
      const n = Math.min(300, Math.max(1, Number(limit) || 60));
      const cat = typeof category === 'string' ? category.trim().toLowerCase() : '';
      let assets = listLibraryAssets(host);
      if (cat) assets = assets.filter(a => (a.category || '').toLowerCase().startsWith(cat.replace(/s$/, '')));
      return ok({ total: assets.length, assets: assets.slice(0, n) });
    },
  });

  server.tool({
    name: 'hjen_models_list',
    title: 'List models',
    description: 'List frame + video models the make-tools accept via the `model` param, with provider + notes.',
    inputSchema: { type: 'object', properties: { capability: { type: 'string', enum: ['make-frame', 'make-video'], description: 'Optional capability filter.' } } },
    handler: ({ capability }) => ok(listModels(capability === 'make-frame' || capability === 'make-video' ? capability : undefined)),
  });
}
