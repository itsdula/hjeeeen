// ENTITY RESOLVER — the ad's PEOPLE and PLACES, understood and LINKED across shots.
//
// An ad is not understood shot-by-shot: the same child in shot 1 is the same
// child in shot 4 and shot 18. Understanding that identity is what lets the
// system (a) grasp the IDEA (a character's arc), and (b) UNIFY references — one
// person = ONE locked reference frame, reused across their shots, instead of a
// fresh reference per shot. This is the Connect member of the Second Brain: the
// ad's entities are nodes linked across its shots (and, later, across ads).
//
// One vision pass: hand the model ONE representative frame per shot (labelled by
// shot) and have it cluster the DISTINCT recurring persons + places, returning
// which shots each appears in and a chosen best reference frame. Nothing is
// ad-specific — a montage yields many singletons + a few recurring principals; a
// narrative ad yields a small recurring cast.

import { llmForTask } from '../models/registry';
import type {
  AdBreakdown, BreakdownEntities, BreakdownPerson, BreakdownPlace, BreakdownAsset,
} from '../creativemind/breakdown';

export type EntityRoster = BreakdownEntities;
export interface EntityResolveResult { ok: boolean; roster?: EntityRoster; message?: string; frameCount: number }

const clamp = (s: any): string => String(s ?? '').trim();
const fid = (s: any): string => clamp(s).replace(/\.jpe?g$/i, '');

function parseJsonLoose(text: string): any {
  const t = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch { /* slice */ }
  const m = t.match(/[{[][\s\S]*[}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw new Error('model did not return valid JSON');
}

function tcToSec(tc?: string): number | undefined {
  const s = clamp(tc); if (!s) return undefined;
  const m = /(\d+):(\d+)(?:\.(\d+))?/.exec(s);
  if (m) return (+m[1]) * 60 + (+m[2]) + (m[3] ? +`0.${m[3]}` : 0);
  const n = parseFloat(s); return Number.isFinite(n) ? n : undefined;
}

/** One representative frame per shot: the shot's own beat frame, else the frame
 *  nearest its tc. Returns [{shotNo, frameId, abs}] capped to `cap` (evenly). */
function shotRepFrames(bd: AdBreakdown, cap: number): { shotNo: number; frameId: string; abs: string }[] {
  const framesByT: { id: string; t: number; file: string }[] = [];
  const fileById = new Map<string, string>();
  for (const f of Array.isArray(bd.frames) ? bd.frames : []) {
    if (!f?.id) continue;
    if (f.file) fileById.set(f.id, f.file);
    if (typeof f.t === 'number') framesByT.push({ id: f.id, t: f.t, file: f.file || '' });
  }
  const rows: any[] = Array.isArray((bd.pipeline as any)?.shotlist?.rows) ? (bd.pipeline as any).shotlist.rows : [];
  const out: { shotNo: number; frameId: string; abs: string }[] = [];
  for (const r of rows) {
    const sec = tcToSec(r.tc);
    let pick: { id: string; file: string } | undefined;
    if (sec != null && framesByT.length) {
      const near = [...framesByT].sort((a, b) => Math.abs(a.t - sec) - Math.abs(b.t - sec))[0];
      if (near) pick = { id: near.id, file: near.file };
    }
    if (pick?.id && pick.file) out.push({ shotNo: Number.isFinite(r.no) ? r.no : out.length + 1, frameId: pick.id, abs: pick.file });
  }
  if (out.length <= cap) return out;
  const step = out.length / cap;
  return Array.from({ length: cap }, (_v, i) => out[Math.min(out.length - 1, Math.floor(i * step))]);
}

const SYSTEM = `You are HJEN BREAKDOWN's ENTITY analyst. Across a set of labelled shot frames from ONE ad you identify the DISTINCT recurring PEOPLE and PLACES and say which shots each appears in — reliable visual re-identification (same face/body/kit across shots = one person; same location across shots = one place). You never merge two different people, never split one person into two. You return strict JSON only.`;

export async function resolveEntities(bd: AdBreakdown, opts?: { maxFrames?: number; onlyShotNos?: number[] }): Promise<EntityResolveResult> {
  let reps = shotRepFrames(bd, opts?.maxFrames ?? 28);
  if (opts?.onlyShotNos?.length) {
    const allow = new Set(opts.onlyShotNos);
    reps = reps.filter(r => allow.has(r.shotNo));
  }
  if (!reps.length) return { ok: false, message: 'no shot frames to analyse', frameCount: 0 };
  const knownShots = new Set(reps.map(r => r.shotNo));
  const label = reps.map((r, i) => `image ${i + 1} = SHOT ${r.shotNo} · frame ${r.frameId}`).join('\n');

  const prompt = `These are representative frames, ONE per shot, from a single ad — in shot order. Bind each image to its shot:
${label}

Identify the DISTINCT recurring ENTITIES, LINK them across shots, and for EACH write a self-contained BUILD PROMPT:
· PERSONS — each distinct human: a short descriptor (apparent age from the face, build, skin tone, features), the wardrobe/kit that identifies them, and the shots they appear in.
· PLACES — each distinct location/setting: a short descriptor + the shots it appears in.
· ASSETS — the ad's other buildable elements: key PROPS (the ball, racket, bat, equipment, a signature object) and signature WARDROBE looks. For each: kind ("prop" or "wardrobe") + a short descriptor + the shots. Only assets that MATTER (skip incidental background objects).

For EVERY entry also write "prompt": a SELF-CONTAINED text-to-image description that MAKES a clean reference of that element FROM SCRATCH — it must NOT rely on the video or any frame (in later use there is no source film; the element is built from imagination). Describe it fully in words:
· for a PERSON — describe ONLY their PHYSICAL IDENTITY: apparent age (from the face), build, skin tone, face shape, hair, and any distinctive features. Do NOT mention clothing at all — the identity must be wardrobe-free so the person can be dressed freely later (their kit is captured separately as a wardrobe ASSET).
· for a PLACE — the location + surfaces + light register.
· for a PROP — the object + material + condition, isolated on a solid flat 50% NEUTRAL GRAY (#808080) background with flat even studio lighting.
· for a WARDROBE asset — the garments piece-by-piece (flat-lay or on a plain mannequin) on a solid flat 50% NEUTRAL GRAY (#808080) background, flat even lighting.
Style register = the ad's own look. A clean neutral reference (subject centered), not an action shot. (Persons are identity-only, wardrobe-free; PLACES keep their real environment; PROPS/WARDROBE use the neutral gray reference background.) House vocabulary: MAKE, never "generate".

Rules: the SAME person/place/asset across shots is ONE entry (never duplicated per shot); two different ones are never merged. A once-seen entry is still valid. refFrameId = the clearest frame you saw it in (provenance only). Use ONLY the shot numbers and frame ids listed above.

Return STRICT JSON only, no code fences:
{"persons":[{"descriptor":"…","wardrobe":"…","prompt":"MAKE …","shotNos":[1,4],"refFrameId":"fNNN"}],
 "places":[{"descriptor":"…","prompt":"MAKE …","shotNos":[1,2],"refFrameId":"fNNN"}],
 "assets":[{"kind":"prop"|"wardrobe","descriptor":"…","prompt":"MAKE …","shotNos":[1,2],"refFrameId":"fNNN"}]}`;

  const res = await llmForTask('ad-breakdown', {
    system: SYSTEM, prompt, maxTokens: 8000,
    imagePaths: reps.map(r => r.abs),
  });
  if (!res.ok || !res.text) return { ok: false, message: res.message || res.reason || 'entity call failed', frameCount: reps.length };
  let j: any;
  try { j = parseJsonLoose(res.text); } catch { return { ok: false, message: 'model did not return valid JSON', frameCount: reps.length }; }

  const known = new Set(reps.map(r => r.frameId));
  const cleanShots = (arr: any): number[] => (Array.isArray(arr) ? arr : []).map((n: any) => Number(n)).filter((n: number) => knownShots.has(n));
  const persons: BreakdownPerson[] = (Array.isArray(j?.persons) ? j.persons : []).map((p: any, i: number) => {
    const ref = fid(p?.refFrameId);
    return {
      id: `P${i + 1}`,
      descriptor: clamp(p?.descriptor),
      wardrobe: clamp(p?.wardrobe) || undefined,
      prompt: clamp(p?.prompt) || undefined,
      refFrameId: known.has(ref) ? ref : (reps.find(r => cleanShots(p?.shotNos).includes(r.shotNo))?.frameId || reps[0].frameId),
      shotNos: cleanShots(p?.shotNos),
    };
  }).filter((p: BreakdownPerson) => p.descriptor);
  const places: BreakdownPlace[] = (Array.isArray(j?.places) ? j.places : []).map((p: any, i: number) => {
    const ref = fid(p?.refFrameId);
    return {
      id: `L${i + 1}`,
      descriptor: clamp(p?.descriptor),
      prompt: clamp(p?.prompt) || undefined,
      refFrameId: known.has(ref) ? ref : (reps.find(r => cleanShots(p?.shotNos).includes(r.shotNo))?.frameId || reps[0].frameId),
      shotNos: cleanShots(p?.shotNos),
    };
  }).filter((p: BreakdownPlace) => p.descriptor);
  const assets: BreakdownAsset[] = (Array.isArray(j?.assets) ? j.assets : []).map((a: any, i: number) => {
    const ref = fid(a?.refFrameId);
    return {
      id: `A${i + 1}`,
      kind: clamp(a?.kind) === 'wardrobe' ? 'wardrobe' : 'prop',
      descriptor: clamp(a?.descriptor),
      prompt: clamp(a?.prompt) || undefined,
      refFrameId: known.has(ref) ? ref : (reps.find(r => cleanShots(a?.shotNos).includes(r.shotNo))?.frameId || reps[0].frameId),
      shotNos: cleanShots(a?.shotNos),
    };
  }).filter((a: BreakdownAsset) => a.descriptor);

  return { ok: true, roster: { persons, places, assets }, frameCount: reps.length };
}

/** Per-shot lookup built from a roster — which persons + place a shot contains. */
export function entitiesForShot(roster: EntityRoster | undefined, shotNo: number): { persons: BreakdownPerson[]; place?: BreakdownPlace } {
  if (!roster) return { persons: [] };
  return {
    persons: roster.persons.filter(p => p.shotNos.includes(shotNo)),
    place: roster.places.find(p => p.shotNos.includes(shotNo)),
  };
}
