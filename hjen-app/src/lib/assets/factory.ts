// THE FACTORY CORE — one make engine, four factory floors.
//
// Every asset is a generation: a miniature Frame run. So this is not a new
// image stack, it's a thin, opinionated layer over runFrameGeneration() — the
// same function the Studio, Camera Angles, Film Space, the Node graph, Cuts and
// the Breakdown roster all already call.
//
// What this module owns (identical on every floor):
//   • the cascade — selected roles may be made FROM an earlier plate
//   • the make itself, with the per-kind default model
//   • save through hjen:save-generation with the right tool tag, which buys the
//     generation log, cost tracking, crash recovery and Files placement free
//   • append the plate + move the active pointer, never overwrite
//   • per-project in-flight bookkeeping so a build survives navigation
//
// What the FLOORS own: layout, spec schema, plate roles, and the output shape.

import type { Asset, AssetPlate, PlateRole } from '../../types/assets';
import { toolTag } from '../../types/assets';
import type { ModelId, Quality, Selections } from '../../types/catalog';
import { useAssets } from '../../store/assetsStore';
import { useStore } from '../../store';
import { runFrameGeneration, gatewayConf, readLayerB64 } from '../frameGen';
import { generateImage, generateWithReferences } from '../openai';
import { buildAssetRecipe, type AssetRecipeReq } from './compose';
import { initialSelections } from '../selectionsDefault';
import { MODELS, mapQuality, resolveSize } from '../models';

/** Per-kind default model.
 *
 *  Character and wardrobe stay on gpt-image-2: it holds a face across an edit
 *  better in practice, and its flat high-fidelity array is the right shape for
 *  "here is the identity, keep it".
 *
 *  Prop and location default to the Gemini door. gpt-image-2 renders objects
 *  flat — no real taper, no honest contact shadow — and a flat prop animates
 *  like 2D card in any video model. Gemini's separate high-fidelity OBJECT
 *  budget is exactly the case these two floors are. */
export const DEFAULT_MODEL: Record<Asset['kind'], ModelId> = {
  character: 'GPT_IMAGE_2',
  wardrobe: 'GPT_IMAGE_2',
  prop: 'NANO_BANANA_PRO',
  location: 'NANO_BANANA_PRO',
};

/** Which plate a role is built FROM. Both character outputs that depict a face
 * inherit the identity plate; the sheet adds wardrobe references separately. */
export const BUILT_FROM: Partial<Record<PlateRole, PlateRole>> = {
  sheet: 'face',
  'video-anchor': 'face',
  insert: 'turnaround',
  reverse: 'wide',
  working: 'wide',
  detail: 'wide',
};

export interface MakePlateOpts {
  assetId: string;
  role: PlateRole;
  /** Wardrobe piece / prop part this plate is for. */
  part?: string;
  /** Override the per-kind default. */
  model?: ModelId;
  quality?: Quality;
}

export interface MakePlateResult {
  ok: boolean;
  plate?: AssetPlate;
  message?: string;
}

function slugify(s: string): string {
  return (s || 'asset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'asset';
}

/** Resolve the reference paths for a plate build:
 *   1. the cascade parent (the face, for a sheet) — the identity anchor
 *   2. the client's own source references, if any
 *  Capped hard: an asset build is a SMALL-reference job by design. More inputs
 *  here means a muddier plate, not a richer one. */
function refsFor(asset: Asset, role: PlateRole): {
  paths: string[];
  fromIdentity: boolean;
  fromRef: boolean;
  fromWardrobeRef: boolean;
} {
  const paths: string[] = [];
  let fromIdentity = false;

  // A character sheet uses exactly one identity anchor (the active face) plus
  // at most two wardrobe references. The prompt's full-body and height locks
  // prevent the close portrait from collapsing the figure's proportions.
  if (asset.kind === 'character' && role === 'sheet') {
    const faceId = asset.active.face;
    const face = faceId ? asset.plates.find(p => p.id === faceId) : undefined;
    if (face) { paths.push(face.path); fromIdentity = true; }
    const wardrobeRefs = (asset.wardrobeRefs ?? []).filter(Boolean).slice(0, 3);
    for (const wardrobeRef of wardrobeRefs) {
      if (paths.length >= 3) break;
      if (!paths.includes(wardrobeRef)) paths.push(wardrobeRef);
    }
    return {
      paths,
      fromIdentity,
      fromRef: false,
      fromWardrobeRef: wardrobeRefs.length > 0,
    };
  }

  const parentRole = BUILT_FROM[role];
  if (parentRole) {
    const parentId = asset.active[parentRole];
    const parent = parentId ? asset.plates.find(p => p.id === parentId) : undefined;
    if (parent) { paths.push(parent.path); fromIdentity = true; }
  }

  const sources = asset.sourceRefs.filter(Boolean);
  for (const s of sources) {
    if (paths.length >= 3) break;      // the identity anchor + at most two sources
    if (!paths.includes(s)) paths.push(s);
  }

  return { paths, fromIdentity, fromRef: sources.length > 0, fromWardrobeRef: false };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** A client can briefly be newer than the gateway during a staged rollout.
 *  Preserve the HTTP status so makePlate can distinguish that compatibility
 *  gap from a real render/account failure. */
class AssetGatewayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AssetGatewayError';
  }
}

/** Run the plate on the SERVER, which composes the recipe itself.
 *
 *  This is the path that keeps the LAW: the client posts only the typed request
 *  ({kind, role, name, spec, negatives}) plus reference bytes, and the composed
 *  plate prompt never ships in the bundle or crosses the wire outbound.
 *
 *  It also avoids a real bug on the other path: runFrameGeneration's gateway
 *  branch would take an already-composed asset recipe as the "scene" and wrap
 *  it in the FRAME recipe — style gate, camera clause, photoreal render tail —
 *  baking exactly the decisions a reference plate must not carry. */
async function runPlateViaGateway(
  gw: { url: string; token: string },
  req: AssetRecipeReq,
  refPaths: string[],
  model: ModelId,
  quality: Quality,
): Promise<{ b64: string; apiSize: string; modelLabel?: string }> {
  const layers: Array<{ b64: string; mime: string; filename: string }> = [];
  for (const p of refPaths) {
    const bt = await readLayerB64(p);
    if (bt) layers.push({ b64: bt.b64, mime: bt.mime, filename: p.split('/').pop() || 'ref.png' });
  }
  const jobKey = `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${gw.token}`,
    'x-hjen-job': jobKey,
  };
  const sub = await fetch(`${gw.url}/api/assets/submit`, {
    method: 'POST', headers,
    body: JSON.stringify({ req, layers, settings: { model, quality, resolution: '3.7MP' } }),
  });
  const sj: any = await sub.json().catch(() => ({}));
  if (!sub.ok || !sj?.jobId) {
    throw new AssetGatewayError(sj?.message || `The plate failed (HTTP ${sub.status})`, sub.status);
  }

  // Fully async: the server renders in the background, so poll until done. The
  // ceiling is a backstop, not a timing guess — a HIGH plate takes as long as
  // it takes.
  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    await sleep(3000);
    if (Date.now() > deadline) throw new Error('The plate timed out on the server.');
    const pr = await fetch(`${gw.url}/api/assets/poll`, {
      method: 'POST', headers, body: JSON.stringify({ jobId: sj.jobId }),
    });
    const pj: any = await pr.json().catch(() => ({}));
    if (!pr.ok) throw new Error(pj?.message || `Poll failed (HTTP ${pr.status})`);
    if (pj.status === 'error') throw new Error(pj.message || 'The plate failed.');
    if (pj.status === 'done') return { b64: pj.b64, apiSize: pj.apiSize, modelLabel: pj.modelLabel };
  }
}

/** Compatibility path for a gateway that predates /api/assets/submit.
 *
 * The generic async image door already exists on those servers. Send it the
 * ASSET recipe directly, never through runFrameGeneration(): that function
 * would wrap this plate in the Frame recipe and add camera/style decisions a
 * reusable reference asset must not carry. Remove this fallback once every
 * gateway has the typed asset endpoint. */
async function runPlateViaLegacyImageDoor(
  recipe: ReturnType<typeof buildAssetRecipe>,
  refPaths: string[],
  model: ModelId,
  quality: Quality,
): Promise<{ b64: string; apiSize: string; modelLabel?: string; prompt: string; finalSize: string }> {
  const size = resolveSize(model, recipe.aspect, '3.7MP');
  const apiQuality = mapQuality(model, quality) as 'low' | 'medium' | 'high';
  const params = {
    prompt: recipe.prompt,
    size: size.apiSize,
    quality: apiQuality,
    modelId: MODELS[model].apiModelId,
  };
  const result = refPaths.length
    ? await generateWithReferences({ ...params, referenceFilePaths: refPaths })
    : await generateImage(params);
  return {
    b64: result.b64,
    apiSize: result.size || size.apiSize,
    modelLabel: result.modelLabel || MODELS[model].label,
    prompt: recipe.prompt,
    finalSize: `${size.targetWidth}x${size.targetHeight}`,
  };
}

/** MAKE one plate for one asset, save it, and append it to the asset's history.
 *
 *  Errors are returned, never thrown — a floor that loses one plate must keep
 *  the rest of the build alive. */
export async function makePlate(o: MakePlateOpts): Promise<MakePlateResult> {
  const A = useAssets.getState();
  const asset = A.get(o.assetId);
  if (!asset) return { ok: false, message: 'That asset is no longer in the project.' };

  const S = useStore.getState();
  const project = S.projects.find(p => p.id === S.activeProjectId) ?? null;

  const model = o.model ?? DEFAULT_MODEL[asset.kind];
  const { paths, fromIdentity, fromRef, fromWardrobeRef } = refsFor(asset, o.role);

  const req: AssetRecipeReq = {
    kind: asset.kind,
    role: o.role,
    name: asset.name,
    spec: asset.spec,
    negatives: asset.negatives,
    part: o.part,
    photoType: asset.photoType,
    binding: asset.binding,
    fromRef,
    fromIdentity,
    fromWardrobeRef,
  };
  const recipe = buildAssetRecipe(req);
  const quality = o.quality ?? 'HIGH';

  A.bumpPending(o.assetId, +1);
  A.setStatus(o.assetId, 'making');

  try {
    // Gateway mode composes on the server (recipe stays hidden). Only the
    // OpenAI provider is migrated there, matching the Frame path; Google and
    // the owner's offline machine fall through to local composition.
    const gw = MODELS[model].provider === 'openai' ? await gatewayConf() : null;

    let b64: string;
    let apiSize: string;
    let modelLabel: string | undefined;
    let promptForSidecar = '';
    let finalSize: string;

    if (gw) {
      try {
        const out = await runPlateViaGateway(gw, req, paths, model, quality);
        b64 = out.b64; apiSize = out.apiSize; modelLabel = out.modelLabel;
        const s = resolveSize(model, recipe.aspect, '3.7MP');
        finalSize = `${s.targetWidth}x${s.targetHeight}`;
      } catch (e) {
        // demo.hjen.ai shipped the generic async image door before the typed
        // asset door. A 404 means rollout skew, not a failed make: use the
        // plate recipe directly so Character Tools remains operational.
        if (!(e instanceof AssetGatewayError) || e.status !== 404) throw e;
        const out = await runPlateViaLegacyImageDoor(recipe, paths, model, quality);
        b64 = out.b64; apiSize = out.apiSize; modelLabel = out.modelLabel;
        promptForSidecar = out.prompt;
        finalSize = out.finalSize;
      }
    } else {
      // The asset factory deliberately runs with NO DOP chips — no camera, no
      // film stock, no movie/photographer style gate. A reference plate that
      // carries a lighting or lens decision poisons every frame it is later
      // attached to. Camera Angles takes the same precaution for the same reason.
      const selections: Selections = {
        ...initialSelections,
        prompt: recipe.prompt,
        aspect: recipe.aspect,
        model,
        quality,
        resolution: '3.7MP',
      };
      const r = await runFrameGeneration(
        selections,
        paths.map((p, i) => ({
          id: `asset-ref-${i}`,
          assetId: asset.id,
          // The cascade parent is an IDENTITY reference, not a framing template.
          // Tagging it 'composition' would fire the COMPOSITION LOCK and pin the
          // new plate's geometry to the face crop — which is exactly wrong.
          category: 'character' as const,
          name: i === 0 && fromIdentity ? `${asset.name} identity` : `${asset.name} source ${i + 1}`,
          filePath: p,
          thumbPath: p,
        })),
      );
      b64 = r.result.b64;
      apiSize = r.apiSize;
      modelLabel = r.result.modelLabel;
      promptForSidecar = r.result.prompt;
      finalSize = `${r.size.targetWidth}x${r.size.targetHeight}`;
    }

    const saved = await window.hjen.saveGeneration({
      base64: b64,
      promptSlug: slugify(`${asset.kind}-${asset.name}-${o.role}${o.part ? `-${o.part}` : ''}`),
      projectSlug: project?.slug,
      projectId: project?.id,
      sidecar: {
        captured: new Date().toISOString(),
        project: project ? { id: project.id, name: project.name, slug: project.slug } : null,
        prompt: promptForSidecar,       // '' in gateway mode — the recipe stays server-side
        size: apiSize,
        apiSize,
        finalSize,
        model: modelLabel,
        // Drives the per-kind folder in the Files browser.
        tool: toolTag(asset.kind),
        // Provenance — which asset, which role, and what it was built FROM.
        asset: { id: asset.id, kind: asset.kind, name: asset.name, role: o.role, part: o.part },
        references: paths.map(p => ({ filePath: p })),
      },
    });

    const plate = useAssets.getState().addPlate(o.assetId, {
      role: o.role,
      path: saved.imgPath,
      // saveGeneration writes a .thumb.jpg beside the image but doesn't return
      // its path; the image itself is a safe thumb source via hjen-file://.
      thumbPath: saved.imgPath,
      at: new Date().toISOString(),
      source: 'made',
      builtFrom: fromIdentity ? [paths[0]] : undefined,
      model,
      note: o.part,
    });

    if (project) {
      useStore.setState(state => ({
        projects: state.projects.map(p =>
          p.id === project.id ? { ...p, generationCount: (p.generationCount || 0) + 1 } : p),
      }));
    }
    return { ok: true, plate: plate ?? undefined };
  } catch (e: any) {
    const message = String(e?.message || e).slice(0, 300);
    useAssets.getState().setStatus(o.assetId, 'failed', message);
    return { ok: false, message };
  } finally {
    useAssets.getState().bumpPending(o.assetId, -1);
  }
}

/** The full build for one asset, in presentation order.
 *
 *  Character makes FACE first, then the three-view SHEET from that identity
 *  anchor. A failed step does not abort the rest — keep what landed. */
export async function buildAsset(assetId: string, opts?: { model?: ModelId; quality?: Quality }): Promise<MakePlateResult[]> {
  const asset = useAssets.getState().get(assetId);
  if (!asset) return [{ ok: false, message: 'That asset is no longer in the project.' }];

  const out: MakePlateResult[] = [];

  if (asset.kind === 'character') {
    out.push(await makePlate({ assetId, role: 'face', ...opts }));
    out.push(await makePlate({ assetId, role: 'sheet', ...opts }));
    return out;
  }

  if (asset.kind === 'location') {
    // The wide is the world; the other three are made from it so the space
    // stays one place. Sequential for the same reason the sheet is.
    out.push(await makePlate({ assetId, role: 'wide', ...opts }));
    for (const role of ['reverse', 'working'] as PlateRole[]) {
      out.push(await makePlate({ assetId, role, ...opts }));
    }
    return out;
  }

  if (asset.kind === 'prop') {
    out.push(await makePlate({ assetId, role: 'turnaround', ...opts }));
    return out;
  }

  // Wardrobe — one plate per piece. Pieces are independent of each other, so
  // this is the only kind where the whole build can run concurrently.
  const pieces = (asset.spec.pieces || '').split('\n').map(s => s.trim()).filter(Boolean);
  const role: PlateRole = asset.photoType === 'flat' ? 'flat'
    : asset.photoType === 'on-body' ? 'on-body' : 'ghost';
  if (!pieces.length) {
    out.push(await makePlate({ assetId, role, ...opts }));
    return out;
  }
  const settled = await Promise.all(pieces.map(part => makePlate({ assetId, role, part, ...opts })));
  out.push(...settled);
  return out;
}
