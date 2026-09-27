import type { BriefCollision, BriefTerritory } from '../../types/preprod';
import { ppClaude } from '../../components/preprod/shared';
import { runCreativeGraph } from './engine';
import {
  ANALYZE_SYSTEM, COLLIDE_SYSTEM, TERRITORY_SYSTEM,
  type AnalyzeOut, type CollideOut, type TerritoryOut, type EngineResult,
} from '../creativemind/engine';

type CallResult<T> = Awaited<ReturnType<typeof ppClaude<T>>>;

const CRITIC_SYSTEM = `You are the hostile creative review room. You protect the work from polite mediocrity.
You receive a proposition, one named person, and a numbered collision set. Score every collision from 0–5 on:
humanTruth, brandCausality (the brand is necessary, not pasted on), visualProof (one frame proves it), tension, culturalSpecificity, novelty, campaignRange (30 seconds AND a stills system), and antiCliche.
Name the collision's nearest sibling when it repeats the same mechanism. A renamed duplicate is still a duplicate.
Set keep=true only when total >= 28/40, visualProof >= 3, brandCausality >= 3, and it is not a duplicate. Keep at most six. Do not reward scale, sentiment, or spectacle by themselves.
Return JSON only: {"reviews":[{"index":1,"keep":true,"total":31,"weakest":"...","reason":"...","duplicateOf":null}],"missingLanes":["a precise creative route the set failed to explore"]}`;

const REPAIR_SYSTEM = `You are the senior creative called after a hostile review. Do not defend the draft. Replace its weak thinking.
Using the proposition, named person, rejected ideas, review reasons, and missing lanes, write NEW collisions only. Each must have a different dramatic mechanism, a necessary role for the brand, a camera-provable first frame, and a human behavior specific enough to be observed. Do not paraphrase any submitted idea.
Use the same four machine labels: funnel | collision | invert | transform. Return JSON only:
{"collisions":[{"seed":"repair:<lane>","machine":"funnel|collision|invert|transform","idea":"one or two seen sentences"}]}`;

const TERRITORY_CRITIC_SYSTEM = `You are a regional ECD reviewing three campaign territories before a client sees them. Test each for: proposition fidelity, brand causality, a real human tension, named cultural truth, first-frame proof, 30s story range, 40-still range, and distance from stock-Arab advertising.
Return JSON only: {"pass":true,"notes":[{"name":"...","fatal":false,"note":"..."}],"globalFix":"..."}. pass is true only if all three are distinct and at least one is genuinely ownable.`;

const TERRITORY_REWRITE_SYSTEM = `You are the Gulf Creative Director revising territories after ECD review. Preserve only what the evidence supports. Rewrite all three so each owns a different human tension and dramatic engine. The brand must cause the idea. The first frame must prove it without copy. Cultural truth must be a named behavior, object, place, or social pressure — never "heritage" or "authenticity".
Return exactly the same JSON contract as the original territory task: {"territories":[{"name":"...","hook":"...","insight":"...","firstFrameHint":"...","culturalTruth":"..."},{...},{...}],"bigIdea":{"territory":"...","why":"..."}}.`;

const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const cost = (...values: Array<number | undefined>): number | undefined => {
  const total = values.reduce<number>((n, v) => n + (typeof v === 'number' ? v : 0), 0);
  return total > 0 ? total : undefined;
};

export async function runAnalyzeGraph(rawBrief: string): Promise<EngineResult<AnalyzeOut>> {
  type S = { draft?: AnalyzeOut; challenged?: AnalyzeOut; usd?: number; error?: string };
  const result = await runCreativeGraph<S>({ start: 'planner', initial: {}, nodes: [
    { id: 'planner', defaultRoute: 'skeptic', async run(state) {
      const r = await ppClaude<AnalyzeOut>({ system: ANALYZE_SYSTEM, promptId: 'brief-mind.graph.analyze', prompt: rawBrief, task: 'brief-mind' });
      return r.ok ? { state: { ...state, draft: r.json, usd: r.usd } } : { state: { ...state, error: r.message }, route: null };
    } },
    { id: 'skeptic', defaultRoute: null, async run(state, ctx) {
      if (!state.draft) return { state, route: null };
      const system = `${ANALYZE_SYSTEM}\n\nSECOND-PASS LAW: You are now the skeptical planning partner. The first planner's JSON is included with the raw brief. Correct false certainty, split assumptions from facts, sharpen the persona into observed behavior, and restore every operational gap the first pass missed. Do not make the prose prettier; make the contract harder to misunderstand.`;
      const r = await ppClaude<AnalyzeOut>({ system, promptId: 'brief-mind.graph.challenge', prompt: JSON.stringify({ rawBrief, firstPass: state.draft }), task: 'brief-mind' });
      ctx.note('Second planner challenged assumptions and missing approval facts.');
      return r.ok ? { state: { ...state, challenged: r.json, usd: cost(state.usd, r.usd) } } : { state, route: null };
    } },
  ] });
  if (result.state.error) return { ok: false, message: result.state.error };
  const json = result.state.challenged ?? result.state.draft;
  return json ? { ok: true, json, usd: result.state.usd } : { ok: false, message: 'The brief graph returned no analysis.' };
}

export async function runCollisionGraph(input: {
  proposition: string; persona: string;
  cards: Array<{ id: string; dimension: string; ar: string; en: string }>;
  visualWorld?: unknown[]; mindNotes?: string[];
}): Promise<EngineResult<CollideOut>> {
  type Review = { index?: number; keep?: boolean; total?: number; weakest?: string; reason?: string; duplicateOf?: number | null };
  type S = { draft: any[]; reviews: Review[]; missing: string[]; repaired: any[]; usd?: number; error?: string };
  const payload = { ...input };
  const result = await runCreativeGraph<S>({ start: 'diverge', initial: { draft: [], reviews: [], missing: [], repaired: [] }, nodes: [
    { id: 'diverge', defaultRoute: 'critic', async run(state) {
      const system = `${COLLIDE_SYSTEM}\n\nDIVERGENCE LAW: Produce 16, not 10: four independent lanes with four ideas each. The lanes are human behavior, product misuse/inversion, social pressure, and format/structure. No two ideas may share the same reveal or dramatic mechanism.`;
      const r = await ppClaude<CollideOut>({ system, promptId: 'brief-mind.graph.diverge', prompt: JSON.stringify(payload, null, 1), task: 'brief-mind' });
      return r.ok ? { state: { ...state, draft: list(r.json.collisions), usd: r.usd } } : { state: { ...state, error: r.message }, route: null };
    } },
    { id: 'critic', routes: { repair: 'repair', finish: null }, async run(state, ctx) {
      if (!state.draft.length) return { state: { ...state, error: 'The divergence node returned no ideas.' }, route: null };
      const r = await ppClaude<{ reviews?: Review[]; missingLanes?: string[] }>({ system: CRITIC_SYSTEM, promptId: 'brief-mind.graph.critic', prompt: JSON.stringify({ proposition: input.proposition, persona: input.persona, collisions: state.draft }, null, 1), task: 'brief-mind' });
      if (!r.ok) return { state, route: 'finish' };
      const reviews = list(r.json.reviews) as Review[];
      const keepers = reviews.filter(x => x.keep === true).length;
      const missing = list(r.json.missingLanes).map(str).filter(Boolean);
      ctx.note(`${keepers} ideas cleared the hostile review; ${missing.length} lanes missing.`);
      return { state: { ...state, reviews, missing, usd: cost(state.usd, r.usd) }, route: keepers >= 6 && missing.length === 0 ? 'finish' : 'repair' };
    } },
    { id: 'repair', defaultRoute: null, async run(state) {
      const rejected = state.draft.filter((_, i) => !state.reviews.find(x => Number(x.index) === i + 1)?.keep);
      const r = await ppClaude<CollideOut>({ system: REPAIR_SYSTEM, promptId: 'brief-mind.graph.repair', prompt: JSON.stringify({ proposition: input.proposition, persona: input.persona, rejected, reviews: state.reviews, missingLanes: state.missing, existingIdeas: state.draft }, null, 1), task: 'brief-mind' });
      return r.ok ? { state: { ...state, repaired: list(r.json.collisions), usd: cost(state.usd, r.usd) } } : { state, route: null };
    } },
  ], maxSteps: 6 });
  if (result.state.error) return { ok: false, message: result.state.error };
  const kept = result.state.draft.filter((_, i) => result.state.reviews.length === 0 || result.state.reviews.find(x => Number(x.index) === i + 1)?.keep);
  const combined = [...kept, ...result.state.repaired];
  return combined.length ? { ok: true, json: { collisions: combined.slice(0, 12) }, usd: result.state.usd } : { ok: false, message: 'No collision cleared the creative review.' };
}

export async function runTerritoryGraph(input: {
  proposition: string; persona: string;
  survivors: Array<{ seed: string; machine: string; idea: string }>;
  visualWorld?: unknown[];
}): Promise<EngineResult<TerritoryOut>> {
  type Crit = { pass?: boolean; notes?: unknown[]; globalFix?: string };
  type S = { draft?: TerritoryOut; critique?: Crit; final?: TerritoryOut; usd?: number; error?: string };
  const result = await runCreativeGraph<S>({ start: 'synthesize', initial: {}, nodes: [
    { id: 'synthesize', defaultRoute: 'red-team', async run(state) {
      const r = await ppClaude<TerritoryOut>({ system: TERRITORY_SYSTEM, promptId: 'brief-mind.graph.synthesize', prompt: JSON.stringify(input, null, 1), task: 'brief-mind' });
      return r.ok ? { state: { ...state, draft: r.json, usd: r.usd } } : { state: { ...state, error: r.message }, route: null };
    } },
    { id: 'red-team', routes: { pass: null, revise: 'revise' }, async run(state, ctx) {
      const r = await ppClaude<Crit>({ system: TERRITORY_CRITIC_SYSTEM, promptId: 'brief-mind.graph.territory-critic', prompt: JSON.stringify({ proposition: input.proposition, persona: input.persona, draft: state.draft }, null, 1), task: 'brief-mind' });
      if (!r.ok) return { state, route: 'pass' };
      ctx.note(r.json.pass ? 'Territories cleared ECD review.' : 'Territories returned for one bounded rewrite.');
      return { state: { ...state, critique: r.json, usd: cost(state.usd, r.usd) }, route: r.json.pass ? 'pass' : 'revise' };
    } },
    { id: 'revise', defaultRoute: null, async run(state) {
      const r = await ppClaude<TerritoryOut>({ system: TERRITORY_REWRITE_SYSTEM, promptId: 'brief-mind.graph.territory-rewrite', prompt: JSON.stringify({ proposition: input.proposition, persona: input.persona, survivors: input.survivors, draft: state.draft, review: state.critique }, null, 1), task: 'brief-mind' });
      return r.ok ? { state: { ...state, final: r.json, usd: cost(state.usd, r.usd) } } : { state, route: null };
    } },
  ], maxSteps: 5 });
  if (result.state.error) return { ok: false, message: result.state.error };
  const json = result.state.final ?? result.state.draft;
  return json ? { ok: true, json, usd: result.state.usd } : { ok: false, message: 'The territory graph returned no result.' };
}
