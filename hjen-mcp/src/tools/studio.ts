// Studio control tools — let the agent DRIVE the running app's UI, not just
// print deep links. hjen_studio_open posts to the app's control port
// ({userData}/mcp-control.json → POST /navigate), which the app maps to
// selectProject + view switch (App.tsx onNavigate). Silent-fail semantics:
// if the app isn't running, the tool says so and hands back the deep link.

import fs from 'node:fs';
import path from 'node:path';
import { McpServer, type ToolResult } from '../mcp/server.js';
import type { Host } from '../host.js';
import { resolveProject } from '../projects.js';
import { projectLink, type ViewName } from '../deeplinks.js';

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: true });

const VIEWS = [
  'overview', 'node', 'storyboard', 'frame', 'video', 'library', 'cast',
  // The four asset factories (stage 06).
  'character', 'location', 'prop', 'wardrobe',
] as const;

function controlPort(host: Host): number | null {
  try {
    const f = path.join(host.userDataDir(), 'mcp-control.json');
    if (!fs.existsSync(f)) return null;
    const { port } = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return typeof port === 'number' ? port : null;
  } catch { return null; }
}

async function postNavigate(port: number, body: { projectId: string | null; view: string }): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1200);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/navigate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    return res.ok;
  } catch { return false; }
  finally { clearTimeout(t); }
}

export function registerStudioTools(server: McpServer, host: Host): void {
  server.tool({
    name: 'hjen_studio_open',
    title: 'Open a view in the running HJEN Studio',
    description: 'Navigate the RUNNING desktop app for the user: select a project and switch to a view (node / storyboard / frame / video / library / cast / overview). Use this whenever the user asks to "open" something — do not just print a deep link. Returns opened:false if the app is not running (then hand the user the deepLink instead).',
    inputSchema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: [...VIEWS], description: 'Which view to open (default overview).' },
        project: { type: 'string', description: 'Project id, slug, or name to open it for. Omit for app-level views.' },
      },
    },
    handler: async ({ view, project }) => {
      const v = (typeof view === 'string' && (VIEWS as readonly string[]).includes(view) ? view : 'overview') as ViewName;
      let projectId: string | null = null;
      let deepLink: string | undefined;
      if (typeof project === 'string' && project.trim()) {
        const { project: p, matches } = resolveProject(host, project.trim());
        if (!p) return fail({ error: matches.length > 1 ? 'ambiguous' : 'not_found', query: project, matches: matches.map(m => ({ id: m.id, name: m.name, slug: m.slug })) });
        projectId = p.id;
        deepLink = projectLink(p.id, v);
      }
      const port = controlPort(host);
      if (!port) return ok({ opened: false, reason: 'app_not_running', view: v, projectId, deepLink, hint: 'HJEN Studio is not running (no control port). Give the user the deepLink.' });
      const opened = await postNavigate(port, { projectId, view: v });
      return ok({ opened, view: v, projectId, deepLink, ...(opened ? {} : { reason: 'navigate_failed', hint: 'Control port did not answer — app may be restarting.' }) });
    },
  });
}
