// Author-the-contract tools (Phase 1). Writes go to the SAME project files the
// desktop app owns, with atomic writes + backups (see writers.ts). Project-
// scoped tools resolve by id/slug/name and fail loudly on ambiguity.

import fs from 'node:fs';
import path from 'node:path';
import { McpServer, type ToolResult } from '../mcp/server.js';
import type { Host } from '../host.js';
import { resolveProject, readProjectsIndex } from '../projects.js';
import type { ProjectMeta, StageNumber } from '../types.js';
import {
  createProject, writeStageData, signStage, setCurrentStage, addLedger,
  upsertShot, upsertGraph,
} from '../writers.js';
import { projectLink, type ViewName } from '../deeplinks.js';

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: true });

function need(host: Host, query: string): { project: ProjectMeta } | { error: ToolResult } {
  const { project, matches } = resolveProject(host, query);
  if (project) return { project };
  return { error: fail({ error: matches.length > 1 ? 'ambiguous' : 'not_found', query, matches: matches.map(m => ({ id: m.id, name: m.name, slug: m.slug })), hint: 'Pass an exact id or slug from hjen_projects_list.' }) };
}

const asStage = (v: unknown): StageNumber | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? (n as StageNumber) : null;
};

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', wav: 'audio/wav', mp3: 'audio/mpeg', json: 'application/json' };

export function registerWriteTools(server: McpServer, host: Host): void {
  server.tool({
    name: 'hjen_project_create',
    title: 'Create a project',
    description: 'Create a new HJEN project (folder + seeded 8-stage state.json). Idempotent by name: if a project with the same name already exists it is RETURNED (existed:true) instead of making a duplicate — so "create then open X" always lands on one project. Returns the ProjectMeta.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name.' },
        force: { type: 'boolean', description: 'Set true to allow a same-named duplicate (default false — reuse the existing one).' },
      },
      required: ['name'],
    },
    handler: ({ name, force }) => {
      const nm = String(name ?? '').trim();
      if (!nm) return fail({ error: 'name_required' });
      if (force !== true) {
        const dup = readProjectsIndex(host).find(p => p.name.trim().toLowerCase() === nm.toLowerCase());
        if (dup) return ok({ ...dup, existed: true, note: `A project named "${dup.name}" already exists — reusing it (pass force:true to make a duplicate).` });
      }
      return ok({ ...createProject(host, nm), existed: false });
    },
  });

  server.tool({
    name: 'hjen_stage_write',
    title: 'Write stage data',
    description: 'Write a pipeline stage\'s data JSON (stage 1..8) to _project/. Optional `markdown` writes the human-readable companion for Brief (1) / Treatment (4).',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id, slug, or name.' },
        stage: { type: 'number', description: 'Stage number 1..8 (1 Brief, 4 Treatment, …).' },
        data: { type: 'object', description: 'The stage data object to persist.' },
        markdown: { type: 'string', description: 'Optional .md companion (Brief/Treatment only).' },
      },
      required: ['project', 'stage', 'data'],
    },
    handler: ({ project, stage, data, markdown }) => {
      const r = need(host, String(project ?? '')); if ('error' in r) return r.error;
      const st = asStage(stage); if (!st) return fail({ error: 'invalid_stage', stage });
      if (data == null || typeof data !== 'object') return fail({ error: 'data_must_be_object' });
      writeStageData(host, r.project, st, data, typeof markdown === 'string' ? markdown : undefined);
      return ok({ ok: true, project: r.project.slug, stage: st, deepLink: projectLink(r.project.id, 'overview') });
    },
  });

  server.tool({
    name: 'hjen_stage_sign',
    title: 'Sign / unsign a stage',
    description: 'Mark a pipeline stage signed (default) or draft. Signing stamps signedAt — this is the PPM lock.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id, slug, or name.' },
        stage: { type: 'number', description: 'Stage number 1..8.' },
        signed: { type: 'boolean', description: 'true = sign (default), false = revert to draft.' },
      },
      required: ['project', 'stage'],
    },
    handler: ({ project, stage, signed }) => {
      const r = need(host, String(project ?? '')); if ('error' in r) return r.error;
      const st = asStage(stage); if (!st) return fail({ error: 'invalid_stage', stage });
      const state = signStage(host, r.project, st, signed !== false);
      return ok({ ok: true, stage: st, status: state.stages[st] });
    },
  });

  server.tool({
    name: 'hjen_stage_set_current',
    title: 'Set the current stage',
    description: 'Set which pipeline stage (1..8) the project is currently on.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', description: 'Project id, slug, or name.' }, stage: { type: 'number', description: 'Stage number 1..8.' } },
      required: ['project', 'stage'],
    },
    handler: ({ project, stage }) => {
      const r = need(host, String(project ?? '')); if ('error' in r) return r.error;
      const st = asStage(stage); if (!st) return fail({ error: 'invalid_stage', stage });
      const state = setCurrentStage(host, r.project, st);
      return ok({ ok: true, currentStage: state.currentStage });
    },
  });

  server.tool({
    name: 'hjen_ledger_add',
    title: 'Add a ledger entry',
    description: 'Append a note / risk / open-item to the project ledger (the PPM record).',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id, slug, or name.' },
        kind: { type: 'string', enum: ['note', 'risk', 'open'], description: 'Entry kind.' },
        body: { type: 'string', description: 'The entry text.' },
      },
      required: ['project', 'kind', 'body'],
    },
    handler: ({ project, kind, body }) => {
      const r = need(host, String(project ?? '')); if ('error' in r) return r.error;
      const k = kind === 'risk' ? 'risk' : kind === 'open' ? 'open' : 'note';
      const text = String(body ?? '').trim();
      if (!text) return fail({ error: 'body_required' });
      return ok({ ok: true, entry: addLedger(host, r.project, k, text) });
    },
  });

  server.tool({
    name: 'hjen_storyboard_shot_upsert',
    title: 'Create / update a storyboard shot',
    description: 'Create or update one storyboard panel by id (or scene+letter). Merges the provided fields (description, shot/angle/lens/move, priority, characterIds…). Atomic write + backup.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id, slug, or name.' },
        shot: { type: 'object', description: 'Shot fields. New shot needs scene (number) + letter (e.g. "A") + description; existing matched by id or scene+letter.' },
      },
      required: ['project', 'shot'],
    },
    handler: ({ project, shot }) => {
      const r = need(host, String(project ?? '')); if ('error' in r) return r.error;
      if (shot == null || typeof shot !== 'object') return fail({ error: 'shot_must_be_object' });
      const { shot: saved, panelId } = upsertShot(host, r.project, shot);
      return ok({ ok: true, panelId, shot: saved, deepLink: projectLink(r.project.id, 'storyboard', panelId) });
    },
  });

  server.tool({
    name: 'hjen_graph_upsert',
    title: 'Create / update node-graph nodes + edges',
    description: 'Merge nodes and/or edges (by id) into the project node graph (creates the graph if absent). Node = {id?, type, position?, paramValues?}; Edge = {id?, from:{node,param}, to:{node,param}}. Atomic write + backup.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id, slug, or name.' },
        name: { type: 'string', description: 'Optional graph name.' },
        nodes: { type: 'array', description: 'Nodes to add/update.' },
        edges: { type: 'array', description: 'Edges to add/update.' },
      },
      required: ['project'],
    },
    handler: ({ project, name, nodes, edges }) => {
      const r = need(host, String(project ?? '')); if ('error' in r) return r.error;
      const counts = upsertGraph(host, r.project, {
        name: typeof name === 'string' ? name : undefined,
        nodes: Array.isArray(nodes) ? nodes : [],
        edges: Array.isArray(edges) ? edges : [],
      });
      return ok({ ok: true, counts, deepLink: projectLink(r.project.id, 'node') });
    },
  });

  server.tool({
    name: 'hjen_asset_get',
    title: 'Resolve an asset',
    description: 'Resolve an on-disk asset by absolute path: existence, size, mime, and a hjen-studio:// deep-link (optionally scoped to a project view).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path (e.g. a generation imgPath).' },
        project: { type: 'string', description: 'Optional project id/slug to scope the deep-link.' },
        view: { type: 'string', enum: ['overview', 'storyboard', 'node', 'frame', 'video', 'library', 'cast'], description: 'Optional view for the deep-link.' },
      },
      required: ['path'],
    },
    handler: ({ path: p, project, view }) => {
      const abs = String(p ?? '');
      if (!abs) return fail({ error: 'path_required' });
      let exists = false, size = 0;
      try { const st = fs.statSync(abs); exists = true; size = st.size; } catch { /* missing */ }
      const ext = path.extname(abs).slice(1).toLowerCase();
      let deepLink: string | undefined;
      if (project) {
        const r = resolveProject(host, String(project));
        if (r.project) deepLink = projectLink(r.project.id, (view as ViewName) || 'library');
      }
      return ok({ path: abs, exists, size, mimeType: MIME[ext] || 'application/octet-stream', deepLink });
    },
  });
}
