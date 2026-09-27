// The Action Registry — the single map that turns an MCP command into the app's
// OWN real action, run LIVE in front of the user. This is why the MCP no longer
// "reimplements + pastes in the background": every entry (a) navigates to the
// tool's view so the user watches, (b) calls the tool's REAL store action
// (identical to a real click), (c) returns the result to the MCP.
//
// EXTENSIBLE BY DESIGN: adding a current or future tool = add an entry here.
// The control-port bridge (main.ts) and the renderer wiring (App.tsx) never
// change. New tool → new line in ACTIONS.

import { useStore, LAYER_CATEGORIES, type ActiveView } from '../store';
import { useStoryboard } from '../store/storyboardStore';
import { useAssets } from '../store/assetsStore';
import { buildAsset } from './assets/factory';
import { ASSET_KINDS, type AssetKind } from '../types/assets';
import type { LibCategory } from '../types/hjen-bridge';

/** Which floor each asset kind opens on. */
const ASSET_VIEW: Record<AssetKind, ActiveView> = {
  character: 'a-character', location: 'a-location', prop: 'a-prop', wardrobe: 'a-wardrobe',
};

type ActionResult = Record<string, unknown>;
type ActionFn = (args: any) => Promise<ActionResult>;

const ok = (extra: ActionResult = {}): ActionResult => ({ ok: true, ...extra });
const fail = (reason: string, extra: ActionResult = {}): ActionResult => ({ ok: false, reason, ...extra });

/** Ensure a project is selected + its storyboard board is open (and shown),
 *  navigating there so the user sees it. Returns the resolved project id. */
async function openStoryboardFor(projectId?: string): Promise<{ pid: string } | { error: ActionResult }> {
  const st = useStore.getState();
  let pid = projectId || st.activeProjectId || '';
  if (!pid) return { error: fail('no_project', { hint: 'Pass projectId or open a project first.' }) };
  if (!st.projects.some(p => p.id === pid)) { await st.loadProjects(); }
  const fresh = useStore.getState();
  if (!fresh.projects.some(p => p.id === pid)) return { error: fail('project_not_found', { projectId: pid }) };
  fresh.selectProject(pid);
  const sb = useStoryboard.getState();
  if (sb.projectId !== pid) await sb.open(pid);
  fresh.setActiveView('storyboard');   // navigate so the effect is visible
  return { pid };
}

const settle = () => new Promise<void>(r => setTimeout(r, 120)); // let the view paint

/** Attach an agent's references as real Frame layers.
 *
 *  A reference is either a bare path (legacy) or `{ path, category, name }`.
 *
 *  THE CATEGORY MATTERS. Every reference used to be tagged `composition`, and
 *  `composition` is not a neutral bucket — promptBuilder emits a COMPOSITION
 *  LOCK for it: "TREAT THIS REFERENCE AS A HARD FRAMING TEMPLATE… the output's
 *  spatial geometry must MATCH when the two are overlaid." Handing an agent's
 *  character portrait to that clause pins the new frame's geometry to a face
 *  crop, which is never what was meant.
 *
 *  So the default is `general` — described to the model but not locked — and a
 *  caller has to ask for `composition` explicitly to get the hard lock. */
function attachRefs(
  s: ReturnType<typeof useStore.getState>,
  references: unknown,
): string[] {
  const list = Array.isArray(references) ? references : [];
  const out: string[] = [];
  for (const raw of list) {
    const path = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? String((raw as any).path ?? '') : '');
    if (!path) continue;
    const wanted = (raw && typeof raw === 'object' ? String((raw as any).category ?? '') : '') as LibCategory | '';
    const category: LibCategory = LAYER_CATEGORIES.some(c => c.id === wanted) || wanted === 'wardrobe'
      ? (wanted as LibCategory)
      : 'general';
    const name = (raw && typeof raw === 'object' && (raw as any).name)
      ? String((raw as any).name)
      : (path.split('/').pop() || 'reference');
    s.addLayer({
      id: `mcp-ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category, name, filename: name, filePath: path, thumbPath: path,
      addedAt: new Date().toISOString(), bytes: 0,
    }, category);
    out.push(path);
  }
  return out;
}
// Storyboard steps are numeric (1 Script · 2 Breakdown · 3 Storyboard · 4 Export).
const STEP = { script: 1, breakdown: 2, storyboard: 3, export: 4 } as const;

// ─── The registry ───────────────────────────────────────────────────────────
const ACTIONS: Record<string, ActionFn> = {
  // Navigate only (no work) — mirror of hjen_studio_open, used to "walk" the user.
  'studio.open': async ({ projectId, view }) => {
    const st = useStore.getState();
    if (projectId) { if (!st.projects.some(p => p.id === projectId)) await st.loadProjects(); useStore.getState().selectProject(projectId); }
    const v = String(view || 'overview');
    // NOTE: this map is the THIRD place a view name has to be listed (with
    // App.tsx's viewMap and mcp/src/tools/studio.ts's VIEWS). All three must
    // agree or an agent silently lands on the Projects page instead.
    const map: Record<string, string> = {
      overview: 'project', project: 'project', storyboard: 'storyboard', node: 'node',
      frame: 'frame', video: 'video', library: 'library', cast: 'cast', creativemind: 'creativemind',
      // the four asset factories (stage 06)
      character: 'a-character', location: 'a-location', prop: 'a-prop', wardrobe: 'a-wardrobe',
      'a-character': 'a-character', 'a-location': 'a-location', 'a-prop': 'a-prop', 'a-wardrobe': 'a-wardrobe',
    };
    const target = map[v] || 'projects';
    const s2 = useStore.getState();
    if (target === 'project' && projectId) await s2.openProjectWorkspace(projectId);
    else { if (target === 'node' && projectId) await s2.loadGraphForProject(projectId); if (target === 'storyboard' && projectId) await useStoryboard.getState().open(projectId); s2.setActiveView(target as any); }
    return ok({ view: target, projectId: projectId ?? null });
  },

  // Explicit zero-state preflight for agent-driven Frame work. It uses the
  // same store reset as the UI's New scene button, but needs no brittle mouse
  // choreography and returns measurable proof to the caller.
  'frame.reset': async ({ projectId }) => {
    const st = useStore.getState();
    if (projectId) {
      if (!st.projects.some(p => p.id === projectId)) await st.loadProjects();
      useStore.getState().selectProject(projectId);
    }
    useStore.getState().setActiveView('frame');
    useStore.getState().resetScene();
    await settle();
    const clean = useStore.getState();
    return ok({
      promptChars: clean.selections.prompt.length,
      attachments: clean.layers.length,
      empty: clean.selections.prompt.trim().length === 0 && clean.layers.length === 0,
    });
  },

  // ── STORYBOARD pipeline — the director flow, each step live ────────────────
  'storyboard.setScript': async ({ projectId, script, title }) => {
    const r = await openStoryboardFor(projectId); if ('error' in r) return r.error;
    const sb = useStoryboard.getState();
    sb.setStep(STEP.script);            // show the Script step
    await settle();
    sb.patch({ scriptText: String(script ?? ''), ...(title ? { title: String(title) } : {}) });
    return ok({ chars: String(script ?? '').length });
  },

  'storyboard.runBreakdown': async ({ projectId }) => {
    const r = await openStoryboardFor(projectId); if ('error' in r) return r.error;
    const sb = useStoryboard.getState();
    sb.setStep(STEP.breakdown);         // show the Breakdown step running
    await settle();
    const res = await sb.runBreakdown();
    const shots = useStoryboard.getState().data?.shots ?? [];
    return res.ok ? ok({ shots: shots.length }) : fail('breakdown_failed', { message: res.message });
  },

  'storyboard.findCast': async ({ projectId }) => {
    const r = await openStoryboardFor(projectId); if ('error' in r) return r.error;
    const sb = useStoryboard.getState();
    sb.setStep(STEP.breakdown);
    await settle();
    await sb.findCast();
    const d = useStoryboard.getState().data;
    return ok({ characters: d?.characters?.length ?? 0, places: d?.places?.length ?? 0, elements: d?.elements?.length ?? 0 });
  },

  'storyboard.makeAssets': async ({ projectId }) => {
    const r = await openStoryboardFor(projectId); if ('error' in r) return r.error;
    const sb = useStoryboard.getState();
    sb.setStep(STEP.storyboard);
    await settle();
    await sb.makeAssets();           // real batch — reference images build live
    const d = useStoryboard.getState().data;
    const made = [...(d?.characters ?? []), ...(d?.places ?? []), ...(d?.elements ?? [])].filter((a: any) => a.assetStatus === 'made').length;
    return ok({ assetsMade: made });
  },

  'storyboard.makeAll': async ({ projectId }) => {
    const r = await openStoryboardFor(projectId); if ('error' in r) return r.error;
    const sb = useStoryboard.getState();
    sb.setStep(STEP.storyboard);
    await settle();
    await sb.makeAll();              // real batch — panels render live in board style
    const shots = useStoryboard.getState().data?.shots ?? [];
    const made = shots.filter((s: any) => s.generatedImagePath).length;
    return ok({ panelsMade: made, of: shots.length });
  },

  'storyboard.makeShot': async ({ projectId, shot }) => {
    const r = await openStoryboardFor(projectId); if ('error' in r) return r.error;
    const sb = useStoryboard.getState();
    sb.setStep(STEP.storyboard);
    await settle();
    const shots = sb.data?.shots ?? [];
    const m = /^(\d+)\s*([A-Za-z])$/.exec(String(shot || '').trim());
    const target = m ? shots.find((s: any) => String(s.scene) === m[1] && String(s.letter).toLowerCase() === m[2].toLowerCase()) : shots.find((s: any) => s.id === shot);
    if (!target) return fail('shot_not_found', { shot, available: shots.map((s: any) => `${s.scene}${s.letter}`) });
    await sb.makeShot(target.id);
    const after = useStoryboard.getState().data?.shots?.find((s: any) => s.id === target.id);
    return ok({ panel: `${target.scene}${target.letter}`, imgPath: after?.generatedImagePath });
  },

  'storyboard.makeShots': async ({ projectId, shots }) => {
    const r = await openStoryboardFor(projectId); if ('error' in r) return r.error;
    const sb = useStoryboard.getState();
    sb.setStep(STEP.storyboard);
    await settle();
    const all = sb.data?.shots ?? [];
    const want = Array.isArray(shots) ? shots.map(String) : [];
    const ids = want.map(tok => {
      const m = /^(\d+)\s*([A-Za-z])$/.exec(tok.trim());
      const t = m ? all.find((s: any) => String(s.scene) === m[1] && String(s.letter).toLowerCase() === m[2].toLowerCase()) : all.find((s: any) => s.id === tok);
      return t?.id;
    }).filter(Boolean) as string[];
    if (!ids.length) return fail('no_shots', { available: all.map((s: any) => `${s.scene}${s.letter}`) });
    // Real per-shot action, in parallel — the store's making-state shows each live.
    await Promise.all(ids.map(id => useStoryboard.getState().makeShot(id)));
    return ok({ made: ids.length });
  },

  // ── FRAME — set the real selections + reference layers, then fire the real
  //    Generate. Photographic (uses the frame DNA/selections), NOT storyboard
  //    style. References become real Layers so they SHOW in the Frame view.
  'frame.generate': async ({ projectId, prompt, aspect, quality, references }) => {
    const st = useStore.getState();
    if (projectId) { if (!st.projects.some(p => p.id === projectId)) await st.loadProjects(); useStore.getState().selectProject(projectId); }
    const s = useStore.getState();
    // CLEAN-INPUT GATE — every MCP take starts from an actually empty Frame
    // form. Without this, attachRefs() appends the new command's references to
    // whatever the previous take left in Layers, silently contaminating the
    // next generation. Reset first, verify zero, then stage ONLY this command.
    s.resetScene();
    const empty = useStore.getState();
    if (empty.selections.prompt.trim() || empty.layers.length > 0) {
      return fail('frame_preflight_not_empty', {
        promptChars: empty.selections.prompt.length,
        attachments: empty.layers.length,
      });
    }
    s.setActiveView('frame');        // navigate so the user watches the form + gen
    await settle();
    if (prompt != null) s.setSelection('prompt', String(prompt));
    if (aspect) s.setSelection('aspect', String(aspect));
    if (quality) s.setSelection('quality', String(quality) as any);
    // Add each reference as a REAL layer so it appears in the Frame view + the
    // generated take's reference list (fixes "refs fetched in the background").
    const refs = attachRefs(s, references);
    if (refs.length) s.setLayersOpen(true);
    await settle();
    const staged = useStore.getState();
    if (staged.layers.length !== refs.length) {
      return fail('frame_preflight_reference_mismatch', {
        expected: refs.length,
        attached: staged.layers.length,
      });
    }
    await staged.generate();   // the REAL Generate action
    const cur = useStore.getState().current;
    return ok({
      imgPath: (cur as any)?.imgPath ?? (cur as any)?.filePath,
      references: refs.length,
      cleanInputGate: { promptStartedEmpty: true, attachmentsStartedEmpty: true },
    });
  },

  // ── FRAME BATCH — fire MANY frames in ONE parallel burst. generate() snapshots
  //    its selections+layers synchronously, so we set→fire→set→fire→await-all.
  'frame.generateBatch': async ({ projectId, frames }) => {
    const st = useStore.getState();
    if (projectId) { if (!st.projects.some(p => p.id === projectId)) await st.loadProjects(); useStore.getState().selectProject(projectId); }
    const s0 = useStore.getState();
    s0.setActiveView('frame');
    await settle();
    const list = Array.isArray(frames) ? frames : [];
    if (!list.length) return fail('no_frames');
    const proms: Promise<void>[] = [];
    for (const f of list) {
      // Same zero-state contract for every item in a batch: prompt and all
      // attachments are cleared before the next frame is staged.
      useStore.getState().resetScene();
      const empty = useStore.getState();
      if (empty.selections.prompt.trim() || empty.layers.length > 0) {
        return fail('frame_batch_preflight_not_empty', {
          promptChars: empty.selections.prompt.length,
          attachments: empty.layers.length,
        });
      }
      const s = useStore.getState();
      if (f?.prompt != null) s.setSelection('prompt', String(f.prompt));
      if (f?.aspect) s.setSelection('aspect', String(f.aspect));
      if (f?.quality) s.setSelection('quality', String(f.quality) as any);
      const refs = attachRefs(s, f?.references);
      if (useStore.getState().layers.length !== refs.length) {
        return fail('frame_batch_preflight_reference_mismatch', {
          expected: refs.length,
          attached: useStore.getState().layers.length,
        });
      }
      proms.push(useStore.getState().generate());        // snapshots NOW; do not await
    }
    const settled = await Promise.allSettled(proms);
    const made = settled.filter(r => r.status === 'fulfilled').length;
    return ok({ made, of: list.length });
  },

  // ── ASSETS — build a project asset through the real factory ───────────────
  //    Creates the asset if its name isn't already in the book (never
  //    duplicates), navigates to its floor so the user watches, then runs the
  //    same cascade the Build button runs — face → sheet for a character, wide
  //    → the rest for a location. Nothing here re-implements the recipe.
  'assets.make': async ({ projectId, kind, name, spec, anchor, negatives, binding, photoType }) => {
    const k = String(kind ?? '') as AssetKind;
    if (!ASSET_KINDS.includes(k)) return fail('bad_kind', { expected: ASSET_KINDS });
    const wanted = String(name ?? '').trim();
    if (!wanted) return fail('no_name');

    const st = useStore.getState();
    if (projectId) {
      if (!st.projects.some(p => p.id === projectId)) await st.loadProjects();
      useStore.getState().selectProject(projectId);
    }
    const pid = useStore.getState().activeProjectId;
    if (!pid) return fail('no_project');

    useStore.getState().setActiveView(ASSET_VIEW[k]);
    const A = useAssets.getState();
    if (A.projectId !== pid) await A.open(pid);
    await settle();

    const book = useAssets.getState();
    let asset = (book.data?.assets ?? []).find(
      a => a.kind === k && a.name.trim().toLowerCase() === wanted.toLowerCase());
    if (!asset) {
      asset = book.addAsset(k, wanted, {
        ...(spec && typeof spec === 'object' ? { spec: spec as Record<string, string> } : {}),
        ...(anchor ? { anchor: String(anchor) } : {}),
        ...(Array.isArray(negatives) ? { negatives: negatives.map(String) } : {}),
        ...(binding === 'hard' || binding === 'style' ? { binding } : {}),
        ...(photoType ? { photoType: photoType as any } : {}),
      }) ?? undefined;
    } else if (spec && typeof spec === 'object') {
      useAssets.getState().updateAsset(asset.id, { spec: { ...asset.spec, ...(spec as Record<string, string>) } });
    }
    if (!asset) return fail('create_failed');

    await settle();
    const out = await buildAsset(asset.id);
    const made = out.filter(r => r.ok).length;
    useAssets.getState().flush();
    return made
      ? ok({ assetId: asset.id, name: asset.name, kind: k, plates: made, of: out.length })
      : fail('build_failed', { message: out.find(r => !r.ok)?.message });
  },

  // ── NODE — run the real graph ─────────────────────────────────────────────
  'node.run': async ({ projectId }) => {
    const st = useStore.getState();
    if (projectId) { if (!st.projects.some(p => p.id === projectId)) await st.loadProjects(); const s = useStore.getState(); s.selectProject(projectId); await s.loadGraphForProject(projectId); }
    const s2 = useStore.getState();
    s2.setActiveView('node');
    await settle();
    await useStore.getState().runGraph();
    return ok({ status: useStore.getState().graphStatus });
  },
};

/** Entry point wired to window.hjen.onCommand. Runs the registered real action
 *  and always resolves to a JSON result for the MCP (never throws). */
export async function runMcpAction(action: string, args: any): Promise<ActionResult> {
  const fn = ACTIONS[action];
  if (!fn) return fail('unknown_action', { action, known: Object.keys(ACTIONS) });
  try { return await fn(args || {}); }
  catch (err: any) { return fail('action_threw', { action, message: String(err?.message || err) }); }
}

export const MCP_ACTION_NAMES = Object.keys(ACTIONS);
