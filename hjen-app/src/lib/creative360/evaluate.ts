// Creative 360 — the reasoning primitives tools call: craft searchable queries
// from the POV, and judge candidate images on a rubric that can REFUSE.

import { ppClaude } from '../../components/preprod/shared';
import type {
  CreativePOV, SearchIntent, EvaluateResult, JudgedImage, RubricScore, Strictness,
} from './types';
import { querySystem, judgeSystem, reformulateSystem, assignSystem } from './prompts';
import { EYE_REGISTERS, type Register } from '../eye/types';

/** POV → 4–7 search intents, each with 2–3 engine-tuned queries. */
export async function craftQueries(pov: CreativePOV): Promise<SearchIntent[]> {
  const res = await ppClaude<{ intents?: Array<{ intent?: string; queries?: string[]; register?: string }> }>({ task: 'creative-advisor',
    system: querySystem(pov), promptId: 'creative360.query', vars: { pov },
    prompt: 'Produce the search intents and their queries for this project. Return JSON only.',
    maxTokens: 1800,
  });
  if (!res.ok) return [];
  const raw = Array.isArray(res.json?.intents) ? res.json.intents : [];
  return raw
    .map(x => ({
      intent: str(x?.intent),
      queries: (Array.isArray(x?.queries) ? x.queries : []).map(str).filter(Boolean).slice(0, 3),
      // an unknown word is dropped, never coerced — a wrong feeling ranks worse
      // than no feeling, and the hunt simply keeps its old behaviour without one
      register: (EYE_REGISTERS as string[]).includes(str(x?.register).toLowerCase())
        ? (str(x?.register).toLowerCase() as Register) : null,
    }))
    .filter(i => i.intent && i.queries.length);
}

/** A tried query found too few keepers — the mind rewrites it, reading WHY it
 *  failed (the judge's own note). Returns up to 2 novel queries, never repeats. */
export async function reformulateQueries(
  pov: CreativePOV,
  intentText: string,
  tried: string[],
  feedback: string,
): Promise<string[]> {
  const res = await ppClaude<{ queries?: string[] }>({ task: 'creative-advisor',
    system: reformulateSystem(pov, intentText, tried, feedback),
    promptId: 'creative360.reformulate', vars: { pov, intentText, tried, feedback },
    prompt: 'Diagnose the miss and return the 2 new queries. JSON only.',
    maxTokens: 500,
  });
  if (!res.ok) return [];
  const raw = Array.isArray(res.json?.queries) ? res.json.queries : [];
  const seen = new Set(tried.map(t => t.toLowerCase()));
  return raw.map(str).filter(q => q && !seen.has(q.toLowerCase())).slice(0, 2);
}

/** The layout eye: given the POV, the pitch slides, and a pool of candidate
 *  images (paths + labels), pick the best image for each slide. Returns
 *  {slide,image,why} with image 1-based into imagePaths, or 0 = leave unresolved. */
export async function assignImages(
  pov: CreativePOV,
  slides: Array<{ section: string; spec: string }>,
  imagePaths: string[],
  labels: string[],
): Promise<Array<{ slide: number; image: number; why: string }>> {
  if (imagePaths.length === 0 || slides.length === 0) return [];
  const res = await ppClaude<{ assignments?: any[] }>({ task: 'creative-advisor',
    system: assignSystem(pov, slides, labels),
    promptId: 'creative360.assign', vars: { pov, slides, labels },
    prompt: `Assign the best image to each of the ${slides.length} slides. Return JSON only.`,
    imagePaths,
    maxTokens: 2200,
  });
  if (!res.ok) return [];
  const rows = Array.isArray(res.json?.assignments) ? res.json.assignments : [];
  return rows
    .map((r: any) => ({ slide: Math.round(Number(r?.slide)), image: Math.round(Number(r?.image)), why: str(r?.why) }))
    .filter(a => Number.isFinite(a.slide) && Number.isFinite(a.image));
}

const clamp5 = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(0, Math.min(5, v)) : 0;
};

/** Judge the candidate images for one intent. Returns every candidate ranked
 *  and scored, with `keep` reflecting the active strictness — and `thin` set
 *  when fewer than `keep` cleared the bar (the set is honestly under-filled). */
export async function evaluateImages(
  pov: CreativePOV,
  intent: SearchIntent,
  imagePaths: string[],
  keep: number,
  strictness: Strictness,
): Promise<EvaluateResult> {
  if (imagePaths.length === 0) return { judged: [], thin: true, note: 'No candidates to judge.' };
  const res = await ppClaude<{ note?: string; judged?: any[] }>({ task: 'creative-advisor',
    system: judgeSystem(pov, intent, keep, strictness),
    promptId: 'creative360.judge', vars: { pov, intent, keep, strictness },
    prompt: `Judge the ${imagePaths.length} candidate images for the intent above. Score, rank, and keep only real keepers. Return JSON only.`,
    imagePaths,
    maxTokens: 4000,
  });
  if (!res.ok) return { judged: [], thin: true, note: res.message || 'The judge could not read the set.' };

  const rows = Array.isArray(res.json?.judged) ? res.json.judged : [];
  const palettes = ['warm', 'cool', 'colorful', 'mid'] as const;
  const judged: JudgedImage[] = rows.map((r: any) => {
    const s = r?.scores || {};
    const scores: RubricScore = {
      literal: clamp5(s.literal), pov: clamp5(s.pov), craft: clamp5(s.craft),
      fit: clamp5(s.fit), antiCliche: clamp5(s.antiCliche), total: 0,
    };
    scores.total = scores.literal + scores.pov + scores.craft + scores.fit + scores.antiCliche;
    const idx = Number(r?.index);
    return {
      index: Number.isInteger(idx) ? idx : 0,
      keep: r?.keep === true,
      scores,
      why: str(r?.why), take: str(r?.take), leave: str(r?.leave),
      palette: palettes.includes(r?.palette) ? r.palette : 'mid',
    };
  }).filter((j: JudgedImage) => j.index >= 1 && j.index <= imagePaths.length);

  // Enforce the bar in code — never trust the model to force-fill or over-cull.
  //  STRICT: POV-perfect only (literal ≥3 AND total ≥16) — may keep zero.
  //  LENIENT: exploration — a real subject match (literal ≥2) with decency
  //           (total ≥12) is kept even if the light/palette isn't the POV's yet;
  //           references inform the look, they don't have to already BE it.
  //           (Bar aligned to prompts.ts, which tells the model literal≥2 & total≥12.)
  judged.sort((a, b) => b.scores.total - a.scores.total);
  let kept = 0;
  for (const j of judged) {
    const s = j.scores;
    const clears = strictness === 'strict'
      ? (s.literal >= 3 && s.total >= 16)
      : (s.literal >= 2 && s.total >= 12 && s.antiCliche >= 1);
    j.keep = clears && kept < keep;
    if (j.keep) kept++;
  }
  const thin = kept < keep;
  const note = str((res.json as any)?.note) ||
    (kept === 0 ? 'No candidate cleared the bar — reword the query or add a source.'
      : thin ? `Only ${kept} of ${keep} cleared the bar — the set is thin.`
        : `Kept ${kept}.`);
  return { judged, thin, note };
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
