// Director tools — the storyboard pipeline, DRIVEN LIVE in the running app.
// Instead of re-implementing script/breakdown/cast/assets/panels headlessly and
// pasting the result, these tools trigger the app's OWN real actions via the
// command bridge (driveApp → control-port /command → real store action), so the
// user WATCHES each step happen in the Studio. Paid steps keep the cost guard.

import { McpServer, type ToolResult } from '../mcp/server.js';
import type { Host } from '../host.js';
import { resolveProject, readStoryboard } from '../projects.js';
import { asQuality, frameEstimate } from '../make-core.js';
import { driveApp, appIsRunning } from '../drive.js';
import { projectLink } from '../deeplinks.js';
import type { ProjectMeta } from '../types.js';

const ok = (d: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(d, null, 2) }] });
const fail = (d: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(d, null, 2) }], isError: true });

const APP_CLOSED = { error: 'app_not_running', hint: 'This step drives the live Studio so you can watch it — open HJEN Studio, then retry. (Headless authoring still available via hjen_stage_write / hjen_storyboard_shot_upsert.)' };
const PROJECT_ARG = { type: 'string', description: 'Project id, slug, or name.' };

function need(host: Host, q: string): { project: ProjectMeta } | { error: ToolResult } {
  const { project, matches } = resolveProject(host, q);
  if (project) return { project };
  return { error: fail({ error: matches.length > 1 ? 'ambiguous' : 'not_found', query: q, matches: matches.map(m => ({ id: m.id, slug: m.slug })) }) };
}

export function registerDirectorTools(server: McpServer, host: Host): void {
  // 1 — paste the script into the Script step (live)
  server.tool({
    name: 'hjen_storyboard_set_script',
    title: 'Set the storyboard script (live)',
    description: 'Paste a screenplay/ad script into a project\'s Storyboard → Script step IN THE RUNNING APP (the user watches it appear). Prereq before breakdown. Requires HJEN Studio open.',
    inputSchema: { type: 'object', properties: { project: PROJECT_ARG, script: { type: 'string', description: 'The full script text.' }, title: { type: 'string', description: 'Optional board title.' } }, required: ['project', 'script'] },
    handler: async ({ project, script, title }) => {
      const r = need(host, String(project ?? '')); if ('error' in r) return r.error;
      if (!appIsRunning(host)) return fail(APP_CLOSED);
      const res = await driveApp(host, 'storyboard.setScript', { projectId: r.project.id, script: String(script ?? ''), title });
      if (!res) return fail(APP_CLOSED);
      return res.ok ? ok({ ...res, deepLink: projectLink(r.project.id, 'storyboard') }) : fail(res);
    },
  });

  // 2 — run the real breakdown (script → scenes/shots), live
  server.tool({
    name: 'hjen_storyboard_breakdown',
    title: 'Run the storyboard breakdown (live)',
    description: 'Run the app\'s REAL script breakdown (script → scenes → shots) in the running Studio — the user watches the Breakdown step run. Requires a script set first + HJEN Studio open.',
    inputSchema: { type: 'object', properties: { project: PROJECT_ARG }, required: ['project'] },
    handler: async ({ project }) => {
      const r = need(host, String(project ?? '')); if ('error' in r) return r.error;
      if (!appIsRunning(host)) return fail(APP_CLOSED);
      const res = await driveApp(host, 'storyboard.runBreakdown', { projectId: r.project.id });
      if (!res) return fail(APP_CLOSED);
      return res.ok ? ok(res) : fail(res);
    },
  });

  // 3 — run the real cast/places extraction, live
  server.tool({
    name: 'hjen_storyboard_cast',
    title: 'Extract cast & places (live)',
    description: 'Run the app\'s REAL cast/places/elements extraction from the script + shots, live in the running Studio. Requires a breakdown first + HJEN Studio open.',
    inputSchema: { type: 'object', properties: { project: PROJECT_ARG }, required: ['project'] },
    handler: async ({ project }) => {
      const r = need(host, String(project ?? '')); if ('error' in r) return r.error;
      if (!appIsRunning(host)) return fail(APP_CLOSED);
      const res = await driveApp(host, 'storyboard.findCast', { projectId: r.project.id });
      if (!res) return fail(APP_CLOSED);
      return res.ok ? ok(res) : fail(res);
    },
  });

  // 4 — make the reference assets (PAID, cost-guarded), live
  server.tool({
    name: 'hjen_storyboard_assets_make',
    title: 'Make storyboard reference assets (live)',
    description: 'Build ALL the board\'s reference images (characters/places/elements) using the app\'s REAL asset maker, live in the Studio. COST GUARD: estimate unless confirm:true.',
    inputSchema: { type: 'object', properties: { project: PROJECT_ARG, confirm: { type: 'boolean', description: 'Must be true to spend.' } }, required: ['project'] },
    handler: async ({ project, confirm }) => {
      const r = need(host, String(project ?? '')); if ('error' in r) return r.error;
      const sb: any = readStoryboard(host, r.project.slug);
      const slots = (Array.isArray(sb?.characters) ? sb.characters.length : 0) + (Array.isArray(sb?.places) ? sb.places.length : 0) + (Array.isArray(sb?.elements) ? sb.elements.length : 0);
      const q = asQuality(sb?.quality);
      if (confirm !== true) return ok({ requiresConfirm: true, assetSlots: slots, estimateUsd: +(frameEstimate(q) * Math.max(1, slots)).toFixed(2), note: 'Dry-run. Set confirm:true to build the assets live.' });
      if (!appIsRunning(host)) return fail(APP_CLOSED);
      const res = await driveApp(host, 'storyboard.makeAssets', { projectId: r.project.id });
      if (!res) return fail(APP_CLOSED);
      return res.ok ? ok(res) : fail(res);
    },
  });

  // 5 — make ALL panels (PAID, cost-guarded), live in board style + refs
  server.tool({
    name: 'hjen_storyboard_panels_make',
    title: 'Make ALL storyboard panels (live)',
    description: 'Make every panel on the board using the app\'s REAL panel maker (board style + character/face/wardrobe refs) — live, in parallel, the user watches each render. This is the correct way to fill a board; do NOT loop hjen_frame_make. COST GUARD: estimate unless confirm:true.',
    inputSchema: { type: 'object', properties: { project: PROJECT_ARG, confirm: { type: 'boolean', description: 'Must be true to spend.' } }, required: ['project'] },
    handler: async ({ project, confirm }) => {
      const r = need(host, String(project ?? '')); if ('error' in r) return r.error;
      const sb: any = readStoryboard(host, r.project.slug);
      const shots = Array.isArray(sb?.shots) ? sb.shots : [];
      const todo = shots.filter((s: any) => !s.generatedImagePath || s.status === 'failed').length;
      const q = asQuality(sb?.quality);
      if (confirm !== true) return ok({ requiresConfirm: true, panelsToMake: todo, ofTotal: shots.length, quality: q, estimateUsd: +(frameEstimate(q) * Math.max(1, todo)).toFixed(2), note: 'Dry-run. Set confirm:true to make all panels live in the app.' });
      if (!appIsRunning(host)) return fail(APP_CLOSED);
      const res = await driveApp(host, 'storyboard.makeAll', { projectId: r.project.id });
      if (!res) return fail(APP_CLOSED);
      return res.ok ? ok({ ...res, deepLink: projectLink(r.project.id, 'storyboard') }) : fail(res);
    },
  });

  // 6 — build ONE project asset through its factory (PAID, cost-guarded), live
  server.tool({
    name: 'hjen_assets_make',
    title: 'Build a project asset (live)',
    description:
      'Build one CHARACTER, LOCATION, PROP or WARDROBE asset in the project\'s stage-06 asset book, using the app\'s REAL factory — live, so the user watches. '
      + 'Each kind runs its own cascade: a character makes the identity FACE first (no clothing, so wardrobe stays separate) then the four-angle SHEET from that face; '
      + 'a location makes the three-quarter WIDE then the reverse and working plates from it; a prop makes one four-view turnaround canvas; wardrobe makes one plate per piece. '
      + 'Re-running with the same name does NOT duplicate — it adds a new take to the existing asset. COST GUARD: estimate unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        project: PROJECT_ARG,
        kind: { type: 'string', enum: ['character', 'location', 'prop', 'wardrobe'], description: 'Which factory.' },
        name: { type: 'string', description: 'The asset name — this is the @tag the prompt will use, so make it distinctive.' },
        spec: { type: 'object', description: 'Kind-specific fields. character: the Cast anchors (age, heritage, build…). location: foreground/midground/background, truthObject, hour, light. prop: material, finish, scaleCue. wardrobe: pieces (newline-separated), material, colour, condition.' },
        anchor: { type: 'string', description: 'The SHORT line (~25 words) that rides into every prompt beside the plates. Long text fights the reference image — name only what the model tends to drop.' },
        negatives: { type: 'array', items: { type: 'string' }, description: 'Explicit refusals.' },
        binding: { type: 'string', enum: ['hard', 'style'], description: 'LOCATION only. hard = the frame\'s geometry is pinned to the plate (composition lock). style = the model extends the world. Default style.' },
        photoType: { type: 'string', enum: ['flat', 'ghost', 'on-body'], description: 'WARDROBE only. ghost-mannequin keeps the drape (default for thobe/abaya/bisht); flat-lay wins on print and logo.' },
        confirm: { type: 'boolean', description: 'Must be true to spend.' },
      },
      required: ['project', 'kind', 'name'],
    },
    handler: async ({ project, kind, name, spec, anchor, negatives, binding, photoType, confirm }) => {
      const r = need(host, String(project ?? '')); if ('error' in r) return r.error;
      const k = String(kind ?? '');
      // How many plates the cascade will make — the cost is per plate, and a
      // character is two, so a dry-run that says "1" would understate it.
      const pieces = String((spec as any)?.pieces ?? '').split('\n').map(s => s.trim()).filter(Boolean).length;
      const plates = k === 'character' ? 2 : k === 'location' ? 3 : k === 'wardrobe' ? Math.max(1, pieces) : 1;
      if (confirm !== true) {
        return ok({
          requiresConfirm: true, kind: k, name: String(name ?? ''), plates,
          estimateUsd: +(frameEstimate('HIGH') * plates).toFixed(2),
          note: 'Dry-run. Set confirm:true to build it live in the app.',
        });
      }
      if (!appIsRunning(host)) return fail(APP_CLOSED);
      const res = await driveApp(host, 'assets.make', {
        projectId: r.project.id, kind: k, name, spec, anchor, negatives, binding, photoType,
      });
      if (!res) return fail(APP_CLOSED);
      const view = k === 'character' ? 'character' : k === 'location' ? 'location' : k === 'prop' ? 'prop' : 'wardrobe';
      return res.ok ? ok({ ...res, deepLink: projectLink(r.project.id, view) }) : fail(res);
    },
  });
}
