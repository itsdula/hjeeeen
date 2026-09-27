// Turn any AdBreakdown into the disc's view model. Every field is guarded: an
// axis absent from the data is a pending segment, a missing pipeline stage is a
// pending page — the disc never assumes Nike's 11 axes, 49 frames, or beat names.

import type { AdBreakdown, BreakdownAxis, BreakdownElement, BreakdownFrame } from '../creativemind/breakdown';
import { BREAKDOWN_AXES, matchAxisSlug, AxisDef } from './axes';

export interface DiscAxis {
  slug: string;
  en: string;                        // canonical disc label
  ar: string;                        // data's title_ar when present, else registry fallback
  present: boolean;                  // false → pending (not in this breakdown's data)
  findings: BreakdownElement[];
  heroFrameIds: string[];
  summary?: string;
  reproductionPrompt?: string;       // OUTPUT 1 — THE MAKE PROMPT for this axis
}

export interface FrameLite { id: string; file: string; t?: number; beat?: string }

export interface DiscModel {
  axes: DiscAxis[];                  // always 13, in registry order
  frames: Map<string, FrameLite>;
  cycleFrameIds: string[];           // hub crossfade order (beat spine → hero → all)
  findingsTotal: number;
}

function frameLite(f: BreakdownFrame): FrameLite {
  return { id: f.id, file: f.file, t: f.t, beat: f.beat };
}

export function buildDiscModel(bd: AdBreakdown): DiscModel {
  const dataAxes: BreakdownAxis[] = Array.isArray(bd.axes) ? bd.axes : [];

  // index data axes by resolved slug (title_en first, then key as fallback)
  const bySlug = new Map<string, BreakdownAxis>();
  for (const ax of dataAxes) {
    const slug = matchAxisSlug(ax.title_en) || matchAxisSlug(ax.key);
    if (slug && !bySlug.has(slug)) bySlug.set(slug, ax);
  }

  const axes: DiscAxis[] = BREAKDOWN_AXES.map((def: AxisDef) => {
    const hit = bySlug.get(def.slug);
    if (hit) {
      return {
        slug: def.slug,
        en: def.en,
        ar: hit.title_ar || def.ar,
        present: true,
        findings: Array.isArray(hit.findings) ? hit.findings : [],
        heroFrameIds: Array.isArray(hit.heroFrameIds) ? hit.heroFrameIds : [],
        summary: hit.summary,
        reproductionPrompt: hit.reproductionPrompt,
      };
    }
    return { slug: def.slug, en: def.en, ar: def.ar, present: false, findings: [], heroFrameIds: [] };
  });

  const frames = new Map<string, FrameLite>();
  for (const f of Array.isArray(bd.frames) ? bd.frames : []) frames.set(f.id, frameLite(f));

  // hub crossfade: prefer the beat spine, then axis hero frames, then all frames
  const cycle: string[] = [];
  const push = (id?: string) => { if (id && frames.has(id) && !cycle.includes(id)) cycle.push(id); };
  for (const b of bd.pipeline?.beats || []) for (const id of b.frameIds || []) push(id);
  for (const ax of axes) for (const id of ax.heroFrameIds) push(id);
  if (cycle.length < 2) for (const id of frames.keys()) push(id);

  const findingsTotal = axes.reduce((s, a) => s + a.findings.length, 0);

  return { axes, frames, cycleFrameIds: cycle, findingsTotal };
}

/** Resolve frame ids → {url,label} for thumb strips, silently dropping unknowns. */
export function resolveThumbs(model: DiscModel, ids: string[] | undefined, fileUrl: (p: string) => string) {
  return (ids || [])
    .map(id => model.frames.get(id))
    .filter((f): f is FrameLite => !!f)
    .map(f => ({ id: f.id, url: fileUrl(f.file), t: f.t ?? 0 }));
}
