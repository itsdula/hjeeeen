// MCP resources — application-loaded, read-only context (orient before act).
// Resources = read; Tools = write/make. These make the project map, the model
// registry, and the DNA/register bibles loadable so an agent can't act blind.

import fs from 'node:fs';
import { McpServer, type ResourceContents } from './mcp/server.js';
import type { Host } from './host.js';
import { readProjectsIndex, resolveProject, buildOverview } from './projects.js';
import { MODELS } from './models.js';

const json = (uri: string, data: unknown): ResourceContents[] =>
  [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }];
const md = (uri: string, body: string): ResourceContents[] =>
  [{ uri, mimeType: 'text/markdown', text: body }];

function fileOrNote(envVar: string, label: string): string {
  const p = process.env[envVar]?.trim();
  if (p && fs.existsSync(p)) {
    try { return fs.readFileSync(p, 'utf-8'); } catch { /* fall through */ }
  }
  return `# ${label}\n\nNot configured. Point the \`${envVar}\` env var at the ${label} markdown file to expose it here.`;
}

export function registerResources(server: McpServer, host: Host): void {
  server.resource({
    name: 'projects', uri: 'hjen://projects',
    title: 'HJEN projects', description: 'All projects (id, name, slug, current stage).', mimeType: 'application/json',
    reader: (uri) => json(uri, readProjectsIndex(host).map(p => ({ id: p.id, name: p.name, slug: p.slug, currentStage: p.currentStage }))),
  });

  server.resourceTemplate({
    name: 'project', uriTemplate: 'hjen://project/{query}',
    title: 'HJEN project contract', description: 'The full contract + internals for one project (by id, slug, or name).',
    reader: (uri, vars) => {
      const { project, matches } = resolveProject(host, vars.query ?? '');
      if (!project) return json(uri, { error: 'not_found_or_ambiguous', matches: matches.map(m => m.name) });
      return json(uri, buildOverview(host, project));
    },
  });

  server.resource({
    name: 'models', uri: 'hjen://models',
    title: 'HJEN model registry', description: 'Frame + video models the make-tools accept via the `model` param.', mimeType: 'application/json',
    reader: (uri) => json(uri, MODELS),
  });

  server.resource({
    name: 'dna', uri: 'hjen://dna',
    title: 'HJEN imagery DNA (Clay & Basil)', description: 'The image style bible — every HJEN frame must honor it.', mimeType: 'text/markdown',
    reader: (uri) => md(uri, fileOrNote('HJEN_DNA_FILE', 'HJEN imagery DNA (Clay & Basil)')),
  });

  server.resource({
    name: 'register', uri: 'hjen://register',
    title: 'HJEN copywriting register', description: 'The Saudi-novelist copy bible — every AR/EN line must honor it.', mimeType: 'text/markdown',
    reader: (uri) => md(uri, fileOrNote('HJEN_REGISTER_FILE', 'HJEN copywriting register')),
  });
}
