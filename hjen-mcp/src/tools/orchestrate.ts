// Orchestration tools (Phase 3) — the "speed operations BETWEEN the tools" ask.
// They chain the proven make-core + the storyboard/graph contract so an agent
// runs Frame→Refine→Video, or fills a whole storyboard/graph, in one call. All
// cost-guarded (confirm:true to spend); dry-run sums the estimate.

import { McpServer, type ToolResult } from '../mcp/server.js';
import type { Host } from '../host.js';
import { resolveProject, readStoryboard, readGraph } from '../projects.js';
import { upsertShot } from '../writers.js';
import type { ProjectMeta } from '../types.js';
import {
  asQuality, asRes, frameEstimate, estimateVideoUsd,
  makeFrameAndSave, makePanelAndSave, refineAndSave, startVideoJob, type FrameResult,
} from '../make-core.js';
import type { Quality } from '../providers/imagesize.js';
import type { SeedanceParams } from '../providers/seedance.js';
import { projectLink } from '../deeplinks.js';
import { applyBoardStyle } from '../storyboard-style.js';
import { driveApp, appIsRunning } from '../drive.js';

const ok = (d: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(d, null, 2) }] });
const fail = (d: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(d, null, 2) }], isError: true });
const resolveOpt = (host: Host, q?: string): ProjectMeta | null => (q ? resolveProject(host, String(q)).project : null);

/** Collect a shot's reference images the way the app's makeShot does, so a
 *  remade panel LOCKS identity/wardrobe/face + place + element + style plate.
 *  Order matters: character face → sheet → place → element → style plate. */
function shotReferences(sb: any, shot: any): string[] {
  const chars: any[] = Array.isArray(sb?.characters) ? sb.characters : [];
  const places: any[] = Array.isArray(sb?.places) ? sb.places : [];
  const elements: any[] = Array.isArray(sb?.elements) ? sb.elements : [];
  const pick = (all: any[], ids?: string[]) => (Array.isArray(ids) ? ids : []).map(id => all.find(x => x.id === id)).filter(Boolean);
  const usedChars = pick(chars, shot?.characterIds);
  const usedPlaces = pick(places, shot?.placeIds);
  const usedElements = pick(elements, shot?.elementIds);
  const refs: string[] = [];
  for (const c of usedChars) { if (c.faceImagePath) refs.push(c.faceImagePath); else if (c.refImagePath) refs.push(c.refImagePath); }
  for (const c of usedChars) { if (c.sheetImagePath) refs.push(c.sheetImagePath); }
  for (const p of usedPlaces) { if (p.refImagePath) refs.push(p.refImagePath); }
  for (const e of usedElements) { if (e.refImagePath) refs.push(e.refImagePath); }
  // de-dup, keep order
  return refs.filter((r, i) => r && refs.indexOf(r) === i);
}

/** Compose an image prompt from a storyboard shot's §6.1 fields. */
function shotPrompt(shot: any, extra?: string): string {
  const bits = [String(shot.description || '').trim()];
  const tech: string[] = [];
  if (shot.shot) tech.push(`Shot ${shot.shot}`);
  if (shot.angle) tech.push(`angle ${shot.angle}`);
  if (shot.lens) tech.push(`lens ${shot.lens}`);
  if (tech.length) bits.push(tech.join(', ') + '.');
  if (shot.blocking) bits.push(String(shot.blocking));
  if (shot.light) bits.push(String(shot.light));
  if (shot.frameFurniture) bits.push(String(shot.frameFurniture));
  if (extra) bits.push(extra);
  return bits.filter(Boolean).join(' ');
}

export function registerOrchestrateTools(server: McpServer, host: Host): void {
  // ---- chain: Frame → Refine → Video --------------------------------------
  server.tool({
    name: 'hjen_chain_run',
    title: 'Chain Frame → Refine → Video',
    description: 'Run the pipeline in one call: make a frame, optionally refine it, optionally animate it (Seedance, async). Outputs thread automatically (refine edits the frame; video anchors on the latest still). COST GUARD: dry-run sums the estimate unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        framePrompt: { type: 'string', description: 'The still prompt (in-DNA).' },
        project: { type: 'string', description: 'Optional project to save into.' },
        aspect: { type: 'string', description: 'Frame aspect (default 16:9).' },
        resolution: { type: 'string', enum: ['1MP', '3.7MP', '8.3MP'] },
        quality: { type: 'string', enum: ['LOW', 'MED', 'HIGH'], description: 'Frame quality (default MED).' },
        references: { type: 'array', description: 'Optional reference image paths.' },
        refineInstruction: { type: 'string', description: 'If set, refine the frame with this instruction.' },
        videoPrompt: { type: 'string', description: 'If set, animate the (refined) still with this motion prompt.' },
        videoResolution: { type: 'string', enum: ['480p', '720p', '1080p', '4k'], description: 'Default 720p.' },
        videoDuration: { type: 'number', description: 'Seconds (default 5).' },
        confirm: { type: 'boolean', description: 'Must be true to spend.' },
      },
      required: ['framePrompt'],
    },
    handler: async ({ framePrompt, project, aspect, resolution, quality, references, refineInstruction, videoPrompt, videoResolution, videoDuration, confirm }) => {
      const fp = String(framePrompt ?? '').trim();
      if (!fp) return fail({ error: 'framePrompt_required' });
      const q = asQuality(quality);
      const wantRefine = !!(refineInstruction && String(refineInstruction).trim());
      const wantVideo = !!(videoPrompt && String(videoPrompt).trim());
      const vRes = (['480p', '720p', '1080p', '4k'].includes(String(videoResolution)) ? videoResolution : '720p') as SeedanceParams['resolution'];
      const vDur = Number(videoDuration) || 5;
      const est = frameEstimate(q) + (wantRefine ? frameEstimate('HIGH') : 0) + (wantVideo ? estimateVideoUsd(vRes, vDur) : 0);
      if (confirm !== true) return ok({ requiresConfirm: true, steps: ['frame', ...(wantRefine ? ['refine'] : []), ...(wantVideo ? ['video'] : [])], estimateUsd: Number(est.toFixed(2)), note: 'Dry-run. Set confirm:true to run the chain.' });

      const proj = resolveOpt(host, project ? String(project) : undefined);
      const refs = Array.isArray(references) ? references.map(String) : [];
      try {
        const frame = await makeFrameAndSave(host, { prompt: fp, project: proj, aspect: aspect ? String(aspect) : undefined, resolution: asRes(resolution), quality: q, references: refs });
        let refine: (FrameResult & { refinedFrom: string }) | undefined;
        let still = frame.imgPath;
        if (wantRefine) { refine = await refineAndSave(host, { image: still, instruction: String(refineInstruction), project: proj, aspect: aspect ? String(aspect) : undefined, quality: 'HIGH' }); still = refine.imgPath; }
        let video: { jobId: string; taskId: string; estimateUsd: number } | undefined;
        if (wantVideo) {
          const params: SeedanceParams = { prompt: String(videoPrompt), imagePath: still, endImagePath: null, resolution: vRes, duration: vDur, ratio: '16:9', fps: 24, seed: null, cameraFixed: false, watermark: false, audio: false };
          video = await startVideoJob(host, { params, project: proj, promptSlug: String(videoPrompt) });
        }
        return ok({ ok: true, frame, refine, video: video ? { ...video, note: 'poll with hjen_job_wait' } : undefined, spentUsd: Number((frame.costUsd + (refine?.costUsd || 0)).toFixed(2)) });
      } catch (err: any) { return fail({ error: 'chain_failed', message: err?.message || String(err) }); }
    },
  });

  // ---- storyboard: make a panel from its shot ------------------------------
  server.tool({
    name: 'hjen_storyboard_shot_make',
    title: 'Make a storyboard panel',
    description: 'Make the frame for a storyboard shot (by id or scene+letter): builds the prompt from the shot\'s §6.1 fields, makes the still, saves it, and writes the image + a new take back into the shot (status → made). COST GUARD: estimate unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id, slug, or name.' },
        shotId: { type: 'string', description: 'Shot id (or use scene+letter).' },
        scene: { type: 'number' }, letter: { type: 'string' },
        extraPrompt: { type: 'string', description: 'Optional extra direction appended to the shot prompt.' },
        aspect: { type: 'string', description: 'Default from the board or 16:9.' },
        quality: { type: 'string', enum: ['LOW', 'MED', 'HIGH'], description: 'Default MED.' },
        confirm: { type: 'boolean', description: 'Must be true to spend.' },
      },
      required: ['project'],
    },
    handler: async ({ project, shotId, scene, letter, extraPrompt, aspect, quality, confirm }) => {
      const proj = resolveOpt(host, String(project ?? ''));
      if (!proj) return fail({ error: 'project_not_found', project });
      const sb = readStoryboard(host, proj.slug);
      const shots: any[] = Array.isArray((sb as any)?.shots) ? (sb as any).shots : [];
      const shot = shotId ? shots.find(s => s.id === String(shotId)) : shots.find(s => s.scene === Number(scene) && s.letter === String(letter));
      if (!shot) return fail({ error: 'shot_not_found', shotId, scene, letter, available: shots.map(s => `${s.scene}${s.letter}`) });
      const bare = shotPrompt(shot, extraPrompt ? String(extraPrompt) : undefined);
      if (!bare.trim()) return fail({ error: 'empty_shot_prompt', panelId: `${shot.scene}${shot.letter}` });
      // Lock the panel to the BOARD's drawing style (graphite/marker/…) so a
      // remade panel stays a sketch and never overwrites the board with a photo.
      const prompt = applyBoardStyle(bare, sb);
      // Lock identity/wardrobe/face + place + element from the board's reference
      // slots — the same images the app's own panel maker uses.
      const references = shotReferences(sb, shot);
      // Honor the BOARD's own quality (draft/med/high) so it renders as fast as
      // the board's settings, not a hardcoded default.
      const q = asQuality(quality ?? (sb as any)?.quality);
      const boardAspect = aspect ? String(aspect) : String((sb as any)?.aspect || '16:9');
      const pnl = `${shot.scene}${shot.letter}`;
      if (confirm !== true) return ok({ requiresConfirm: true, panelId: pnl, boardStyleApplied: prompt.includes('Style lock:'), referencesLocked: references.length, quality: q, promptPreview: prompt.slice(0, 240), estimateUsd: frameEstimate(q), note: 'Dry-run. Set confirm:true to make the panel — board style + character/face/wardrobe refs, saved into the board (not Frames). For MULTIPLE shots use hjen_storyboard_shots_make (parallel).' });
      // DRIVE-FIRST: if the Studio is open, run its REAL panel maker so the user
      // watches it happen; only fall back to headless when the app is closed.
      const driven = appIsRunning(host) ? await driveApp(host, 'storyboard.makeShot', { projectId: proj.id, shot: pnl }) : null;
      if (driven) return driven.ok ? ok({ ...driven, drivenLive: true, deepLink: projectLink(proj.id, 'storyboard', pnl) }) : fail(driven);
      const prevStatus = shot.status || 'pending';
      // Headless fallback (app closed): make + save into the board folder.
      try { upsertShot(host, proj, { id: shot.id, status: 'making' }); } catch { /* non-blocking */ }
      try {
        const frame = await makePanelAndSave(host, { prompt, project: proj, aspect: boardAspect, resolution: '3.7MP', quality: q, references, panelId: pnl });
        const take = { imgPath: frame.imgPath, jsonPath: frame.jsonPath, ts: Date.now() };
        const { panelId } = upsertShot(host, proj, { id: shot.id, generatedImagePath: frame.imgPath, generatedJsonPath: frame.jsonPath, status: 'made', takes: [...(shot.takes || []), take] });
        return ok({ ok: true, panelId, imgPath: frame.imgPath, costUsd: frame.costUsd, wroteInto: 'storyboard panel', referencesLocked: references.length, prompt, deepLink: projectLink(proj.id, 'storyboard', panelId) });
      } catch (err: any) {
        try { upsertShot(host, proj, { id: shot.id, status: prevStatus }); } catch { /* leave as-is */ }
        return fail({ error: 'panel_make_failed', message: err?.message || String(err) });
      }
    },
  });

  // ---- storyboard: make MANY panels in PARALLEL ---------------------------
  server.tool({
    name: 'hjen_storyboard_shots_make',
    title: 'Make several storyboard panels (parallel)',
    description: 'Make/remake MULTIPLE storyboard panels AT ONCE, in parallel — use this instead of calling hjen_storyboard_shot_make one-by-one when the user asks for several shots. Each renders in the board style with the shot\'s character/face/wardrobe references and saves back into its panel. COST GUARD: dry-run sums the estimate unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id, slug, or name.' },
        shots: { type: 'array', items: { type: 'string' }, description: 'Panel ids like ["2B","3A"] (scene+letter), or shot ids.' },
        quality: { type: 'string', enum: ['LOW', 'MED', 'HIGH'], description: 'Overrides the board quality.' },
        confirm: { type: 'boolean', description: 'Must be true to spend.' },
      },
      required: ['project', 'shots'],
    },
    handler: async ({ project, shots, quality, confirm }) => {
      const proj = resolveOpt(host, String(project ?? ''));
      if (!proj) return fail({ error: 'project_not_found', project });
      const sb = readStoryboard(host, proj.slug);
      const all: any[] = Array.isArray((sb as any)?.shots) ? (sb as any).shots : [];
      const want = Array.isArray(shots) ? shots.map(String) : [];
      if (!want.length) return fail({ error: 'no_shots', hint: 'Pass panel ids like ["2B","3A"].' });
      const resolved = want.map(tok => {
        const m = /^(\d+)\s*([A-Za-z])$/.exec(tok.trim());
        const shot = m ? all.find(s => String(s.scene) === m[1] && String(s.letter).toLowerCase() === m[2].toLowerCase()) : all.find(s => s.id === tok);
        return { tok, shot };
      });
      const missing = resolved.filter(r => !r.shot).map(r => r.tok);
      if (missing.length) return fail({ error: 'shots_not_found', missing, available: all.map(s => `${s.scene}${s.letter}`) });
      const q = asQuality(quality ?? (sb as any)?.quality);
      const boardAspect = String((sb as any)?.aspect || '16:9');

      if (confirm !== true) {
        return ok({ requiresConfirm: true, count: resolved.length, panels: resolved.map(r => `${r.shot.scene}${r.shot.letter}`), estimateUsd: +(frameEstimate(q) * resolved.length).toFixed(2), note: 'Dry-run. Set confirm:true to make ALL of them in parallel.' });
      }
      // DRIVE-FIRST: run the app's REAL panel maker for all of them so the user
      // watches; fall back to headless-parallel only when the Studio is closed.
      const drivenBatch = appIsRunning(host) ? await driveApp(host, 'storyboard.makeShots', { projectId: proj.id, shots: resolved.map(r => `${r.shot.scene}${r.shot.letter}`) }) : null;
      if (drivenBatch) return drivenBatch.ok ? ok({ ...drivenBatch, drivenLive: true, deepLink: projectLink(proj.id, 'storyboard') }) : fail(drivenBatch);
      // Flip every target to "making" in ONE board write so the app shows all
      // their spinners at once, then render them concurrently.
      for (const r of resolved) { try { upsertShot(host, proj, { id: r.shot.id, status: 'making' }); } catch { /* ignore */ } }
      const results = await Promise.all(resolved.map(async (r) => {
        const shot = r.shot;
        const pnl = `${shot.scene}${shot.letter}`;
        try {
          const prompt = applyBoardStyle(shotPrompt(shot), sb);
          const references = shotReferences(sb, shot);
          const frame = await makePanelAndSave(host, { prompt, project: proj, aspect: boardAspect, resolution: '3.7MP', quality: q, references, panelId: pnl });
          const take = { imgPath: frame.imgPath, jsonPath: frame.jsonPath, ts: Date.now() };
          upsertShot(host, proj, { id: shot.id, generatedImagePath: frame.imgPath, generatedJsonPath: frame.jsonPath, status: 'made', takes: [...(shot.takes || []), take] });
          return { panel: pnl, ok: true, imgPath: frame.imgPath, costUsd: frame.costUsd, referencesLocked: references.length };
        } catch (err: any) {
          try { upsertShot(host, proj, { id: shot.id, status: shot.status || 'pending' }); } catch { /* ignore */ }
          return { panel: pnl, ok: false, error: err?.message || String(err) };
        }
      }));
      const made = results.filter(r => r.ok);
      return ok({ ok: made.length > 0, made: made.length, of: results.length, totalUsd: +made.reduce((s, r) => s + (r.costUsd || 0), 0).toFixed(2), results, deepLink: projectLink(proj.id, 'storyboard') });
    },
  });

  // ---- graph: run frame/video nodes ---------------------------------------
  server.tool({
    name: 'hjen_graph_run',
    title: 'Run the node graph',
    description: 'Execute a project\'s node graph headlessly: runs every frame node, then every video node (anchoring on an upstream frame\'s output via edges). Linear/best-effort. COST GUARD: dry-run sums the estimate unless confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id, slug, or name.' },
        quality: { type: 'string', enum: ['LOW', 'MED', 'HIGH'], description: 'Frame quality (default MED).' },
        confirm: { type: 'boolean', description: 'Must be true to spend.' },
      },
      required: ['project'],
    },
    handler: async ({ project, quality, confirm }) => {
      const proj = resolveOpt(host, String(project ?? ''));
      if (!proj) return fail({ error: 'project_not_found', project });
      const g: any = readGraph(host, proj.slug);
      const nodes: any[] = Array.isArray(g?.nodes) ? g.nodes : [];
      const edges: any[] = Array.isArray(g?.edges) ? g.edges : [];
      const frameNodes = nodes.filter(n => n.type === 'frame' && String(n.paramValues?.prompt || '').trim());
      const videoNodes = nodes.filter(n => n.type === 'video' && String(n.paramValues?.prompt || '').trim());
      if (!frameNodes.length && !videoNodes.length) return fail({ error: 'nothing_to_run', note: 'No frame/video nodes with a prompt.' });
      const q = asQuality(quality);
      const est = frameNodes.length * frameEstimate(q) + videoNodes.length * estimateVideoUsd('720p', 5);
      if (confirm !== true) return ok({ requiresConfirm: true, frameNodes: frameNodes.length, videoNodes: videoNodes.length, estimateUsd: Number(est.toFixed(2)), note: 'Dry-run. Set confirm:true to run the graph.' });

      const outByNode: Record<string, string> = {};
      const results: any[] = [];
      for (const n of frameNodes) {
        try {
          const f = await makeFrameAndSave(host, { prompt: String(n.paramValues.prompt), project: proj, aspect: String(n.paramValues.aspect || '16:9'), resolution: '3.7MP', quality: q });
          outByNode[n.id] = f.imgPath; results.push({ node: n.id, type: 'frame', ok: true, imgPath: f.imgPath, costUsd: f.costUsd });
        } catch (e: any) { results.push({ node: n.id, type: 'frame', ok: false, error: e?.message || String(e) }); }
      }
      for (const n of videoNodes) {
        const upstream = edges.find(e => e.to?.node === n.id && outByNode[e.from?.node]);
        const imagePath = upstream ? outByNode[upstream.from.node] : null;
        try {
          const params: SeedanceParams = { prompt: String(n.paramValues.prompt), imagePath, endImagePath: null, resolution: '720p', duration: 5, ratio: '16:9', fps: 24, seed: null, cameraFixed: false, watermark: false, audio: false };
          const v = await startVideoJob(host, { params, project: proj, promptSlug: String(n.paramValues.prompt) });
          results.push({ node: n.id, type: 'video', ok: true, jobId: v.jobId, anchoredOn: upstream?.from?.node || null });
        } catch (e: any) { results.push({ node: n.id, type: 'video', ok: false, error: e?.message || String(e) }); }
      }
      return ok({ ok: true, ran: results.length, results, deepLink: projectLink(proj.id, 'node'), note: 'Video nodes are async — poll their jobIds with hjen_job_wait.' });
    },
  });
}
