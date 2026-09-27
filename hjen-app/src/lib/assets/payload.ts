// PAYLOAD COMPILERS — one asset schema in, per-model reference payload out.
//
// This is the module the whole system's correctness rests on, because the two
// image doors do not agree about what a reference IS:
//
//   gpt-image-2      ONE FLAT ARRAY on /images/edits. No roles, no per-kind
//                    budget. Every input processed at high fidelity (which is
//                    why `input_fidelity` must be omitted — the API rejects it).
//   gemini-3-*-image TYPED BUDGETS in parts[]: 5 character refs, 6 high-fidelity
//                    object refs. The "14" everyone quotes is the TOTAL input
//                    allowance, not a consistency budget.
//
// Writing one abstraction over both is the fastest way to silently degrade one
// of them — and with NO SEED on either door, you cannot prove afterwards which
// build regressed. So: two compilers, one schema, and a slot priority that is
// explicit data rather than an ordering side-effect.
//
// SLOT PRIORITY. Anything that must survive rides in the first six slots, and
// the practical count is far below the API ceiling: our own
// skills_and_guides/gpt-image-2-engineering-guide.md §3.1 measures the drop-off
// after 4. When the budget is hit we drop by REVERSE priority and say so — a
// silent truncation reads as "everything was attached" when it wasn't.

import type { Asset, AssetPlate, PlateRole } from '../../types/assets';
import { activePlate, platesFor, MULTI_ROLES, ROLES_BY_KIND } from '../../types/assets';
import type { Layer } from '../../store';
import type { LibCategory } from '../../types/hjen-bridge';
import type { ModelId } from '../../types/catalog';
import { MODELS } from '../models';

/** Highest first. A plate whose role is missing here sorts last. */
export const SLOT_PRIORITY: PlateRole[] = [
  'face',          // 1 · identity — the one thing that must never drift
  'sheet',         // 2 · build + turnaround
  'wide',          // 3 · the world (or, when binding is 'hard', the framing template)
  'ghost',         // 4 · wardrobe as worn
  'flat',
  'on-body',
  'turnaround',    // 5 · the object
  'reverse',
  'working',
  'insert',        // 6 · details, dropped first
  'detail',
  'swatch',
  'video-anchor',  // never sent into a still — it exists for the video stage
];

function priority(role: PlateRole): number {
  const i = SLOT_PRIORITY.indexOf(role);
  return i === -1 ? SLOT_PRIORITY.length : i;
}

/** One plate, resolved with everything the prose clause needs to name it. */
export interface ResolvedRef {
  asset: Asset;
  plate: AssetPlate;
  role: PlateRole;
  /** Which bucket this lands in on a typed-budget model. */
  bucket: 'character' | 'object' | 'style';
  /** The layer category on the flat-array model. */
  category: LibCategory;
}

/** Never recalled into a still. */
const STILL_EXCLUDED: PlateRole[] = ['video-anchor', 'swatch'];

/** Resolve an asset's active plates into ordered, typed references.
 *
 *  A LOCATION's binding decides its category, and therefore whether it fires
 *  the COMPOSITION LOCK. 'hard' pins the frame's geometry to the plate;
 *  'style' lets the model extend the world. Getting this wrong in either
 *  direction is a visible failure, which is why it is a per-location decision
 *  rather than a default. */
export function resolveRefs(assets: Asset[]): ResolvedRef[] {
  const out: ResolvedRef[] = [];

  for (const asset of assets) {
    const roles = ROLES_BY_KIND[asset.kind];
    for (const role of roles) {
      if (STILL_EXCLUDED.includes(role)) continue;
      const plates = MULTI_ROLES.includes(role)
        ? platesFor(asset, role)
        : [activePlate(asset, role)].filter(Boolean) as AssetPlate[];

      for (const plate of plates) {
        const bucket: ResolvedRef['bucket'] =
          asset.kind === 'character' ? 'character'
            : asset.kind === 'location' ? 'style'
              : 'object';
        const category: LibCategory =
          asset.kind === 'character' ? 'character'
            : asset.kind === 'wardrobe' ? 'wardrobe'
              : asset.kind === 'prop' ? 'prop'
                : asset.binding === 'hard' ? 'composition' : 'location';
        out.push({ asset, plate, role, bucket, category });
      }
    }
  }

  return out.sort((a, b) => priority(a.role) - priority(b.role));
}

export interface CompileResult {
  /** Everything that fit, in send order. */
  refs: ResolvedRef[];
  /** What was cut for budget — surfaced to the user, never silent. */
  dropped: ResolvedRef[];
  /** The budget that applied, for the message. */
  budget: number;
  /** Human line for the UI when anything was dropped. */
  notice?: string;
}

function notice(dropped: ResolvedRef[], model: ModelId, budget: number): string | undefined {
  if (!dropped.length) return undefined;
  const names = dropped.map(d => `${d.asset.name} · ${d.role}`).join(', ');
  return `${MODELS[model].label} holds ${budget} references well — ${dropped.length} left off: ${names}.`;
}

/** OpenAI: one flat array. Cap at the practical count, not the API ceiling. */
export function compileOpenAI(assets: Asset[], model: ModelId = 'GPT_IMAGE_2'): CompileResult {
  const budgetSpec = MODELS[model].refs;
  const budget = budgetSpec?.practical ?? 0;
  const all = resolveRefs(assets);
  const refs = all.slice(0, budget);
  const dropped = all.slice(budget);
  return { refs, dropped, budget, notice: notice(dropped, model, budget) };
}

export interface GeminiPayload extends CompileResult {
  characters: ResolvedRef[];
  objects: ResolvedRef[];
  styles: ResolvedRef[];
}

/** Google: separate ceilings per bucket. A character ref does not consume the
 *  object budget and vice versa, so the split has to happen BEFORE the cap. */
export function compileGemini(assets: Asset[], model: ModelId = 'NANO_BANANA_PRO'): GeminiPayload {
  const b = MODELS[model].refs;
  const capChar = b?.characters ?? 0;
  const capObj = b?.objects ?? 0;
  const budget = b?.practical ?? 0;

  const all = resolveRefs(assets);
  const characters: ResolvedRef[] = [];
  const objects: ResolvedRef[] = [];
  const styles: ResolvedRef[] = [];
  const dropped: ResolvedRef[] = [];

  for (const r of all) {
    const target = r.bucket === 'character' ? characters : r.bucket === 'object' ? objects : styles;
    const cap = r.bucket === 'character' ? capChar : r.bucket === 'object' ? capObj : capObj;
    if (target.length < cap) target.push(r); else dropped.push(r);
  }

  // The per-kind caps can still add up past what the model reads well.
  const merged = [...characters, ...objects, ...styles].sort((a, b2) => priority(a.role) - priority(b2.role));
  const refs = merged.slice(0, budget);
  dropped.push(...merged.slice(budget));

  return {
    refs, dropped, budget,
    characters: characters.filter(c => refs.includes(c)),
    objects: objects.filter(o => refs.includes(o)),
    styles: styles.filter(s => refs.includes(s)),
    notice: notice(dropped, model, budget),
  };
}

/** Compile for whichever model is actually selected. */
export function compileFor(assets: Asset[], model: ModelId): CompileResult {
  return MODELS[model].api === 'generateContent'
    ? compileGemini(assets, model)
    : compileOpenAI(assets, model);
}

// ─── recall into Frame ───────────────────────────────────────────────────────

/** Turn compiled references into Frame layers.
 *
 *  Wardrobe binds to its parent character via parentLayerId — the mechanism
 *  Frame's prompt builder already reads to emit
 *  `'Mubarak' (character Mubarak; wardrobe navy-abaya)`. One person's clothes
 *  can never migrate to another subject. */
export function toLayers(refs: ResolvedRef[]): Layer[] {
  const layers: Layer[] = [];
  // assetId → the layer id of that asset's first (parent) layer.
  const parentLayerFor = new Map<string, string>();

  // Characters first so a wardrobe layer always finds its parent already placed.
  const ordered = [
    ...refs.filter(r => r.asset.kind === 'character'),
    ...refs.filter(r => r.asset.kind !== 'character'),
  ];

  for (const r of ordered) {
    const id = `asset-${r.plate.id}`;
    const parentId = r.asset.parentId ? parentLayerFor.get(r.asset.parentId) : undefined;
    layers.push({
      id,
      assetId: r.asset.id,
      category: r.category,
      // The @tag. A multi-plate asset names its role so the prose can tell the
      // face from the sheet without the model guessing from position.
      name: MULTI_ROLES.includes(r.role) || r.role !== ROLES_BY_KIND[r.asset.kind][0]
        ? `${r.asset.name} · ${r.plate.note || r.role}`
        : r.asset.name,
      parentLayerId: parentId,
      filePath: r.plate.path,
      thumbPath: r.plate.thumbPath || r.plate.path,
    });
    if (!parentLayerFor.has(r.asset.id)) parentLayerFor.set(r.asset.id, id);
  }

  return layers;
}

/** The prompt text that rides with the plates.
 *
 *  DELIBERATELY SHORT. Long appearance text fights the reference image and
 *  degrades it — the failure Cast's characterPrompt() walks into by injecting
 *  all 37 anchors alongside the photos. Each asset contributes its own ≤25-word
 *  anchor and nothing more; the full spec stays in the card, for humans. */
export function toPromptAnchor(refs: ResolvedRef[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of refs) {
    if (seen.has(r.asset.id)) continue;
    seen.add(r.asset.id);
    const anchor = (r.asset.anchor || '').trim();
    if (anchor) lines.push(anchor);
  }
  return lines.join(' ');
}
