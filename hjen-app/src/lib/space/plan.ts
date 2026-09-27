// THE SPACE PLAN — what the agent lays out after the user answers the gateway.
//
// One ask in, a production out: a handful of PIPELINES, each an ordered list of
// STEPS, each step bound to a real HJEN tool. The plan is data, not chrome —
// the rail renders it, the store persists it with its canvas, and pressing a
// step is what makes anything happen.
//
// TWO LAWS ARE BUILT IN, both Anwar's:
//   THE AGENT WAITS.  Nothing runs on its own. A fresh plan is entirely
//                     'queued'; every state after that was caused by a hand.
//   IT RUNS IN PLACE. A pressed step executes inside SPACE and leaves a node on
//                     the board. The user never leaves to get work done.
//
// Where a tool genuinely cannot run headless we say so in the step's KIND
// rather than pretending — see StepKind below. A plan that lies about what it
// can do is worse than a shorter plan.

import { llmForTask } from '../models/registry';
import { PRODUCTS, PRODUCT_VIEW, type ProductId } from '../../components/ProductHub';

/** What pressing a step actually does. The kind is a property of the TOOL, not
 *  of the plan — the planner never chooses it, so it can never over-promise. */
export type StepKind =
  /** Runs through the node engine, here, and the node it made stays on the
   *  board. The full promise. */
  | 'make'
  /** The output is written, not rendered: one model call with the step's brief,
   *  landing as a text node on the board. Also fully in place. */
  | 'write'
  /** Needs the tool's own room — photos to upload, a camera to fly, a book to
   *  lay out. Pressing opens it; the step is marked open, never "done", because
   *  we did not do it. */
  | 'open';

export interface PlanStep {
  /** HJEN product this step belongs to. */
  tool: ProductId;
  /** What this step does, in the plan's own words. One line, imperative. */
  label: string;
  kind: StepKind;
  state: 'queued' | 'running' | 'done' | 'open' | 'failed';
  /** Live detail while running / after finishing. Never pre-filled. */
  note?: string;
  /** Node this step put on the board, so a re-press can focus it instead of
   *  making a second one. */
  nodeId?: string;
}

export interface Pipeline {
  id: string;
  /** Two or three words. The client reads these before anything else. */
  name: string;
  /** One line of meaning under the name — what this stretch of work is FOR. */
  sub: string;
  /** Brand token, inherited from the pipeline's first step's tool. */
  accent: string;
  steps: PlanStep[];
}

export interface SpacePlan {
  /** The user's own words. Shown back verbatim in the rail — never paraphrased. */
  ask: string;
  pipelines: Pipeline[];
  createdAt: string;
}

// ─── tool → kind ────────────────────────────────────────────────────────────
// The honest table. 'make' is only claimed where a node spec's process() really
// runs the work; 'write' where one model call is genuinely the deliverable;
// everything else opens its own room.
// Only these three have a node whose process() can actually do the work from a
// plan alone. Cast / Location / HJEN SET / Film Space all need a photo or a
// camera the user supplies, so mapping them to a node would only manufacture a
// node that fails — they open their own room instead, and say so.
const NODE_FOR: Partial<Record<ProductId, string>> = {
  frame: 'frame', enhancer: 'enhancer', video: 'video',
};
/** Which input a downstream make-step takes its predecessor's image on. This is
 *  what lets Frame → Enhancer → Video chain for real instead of three orphan
 *  nodes sitting next to each other. */
const IMAGE_INPUT: Record<string, string> = { frame: 'source', enhancer: 'image', video: 'image' };
export function imageInputOf(type: string): string | undefined { return IMAGE_INPUT[type]; }
const WRITE_TOOLS = new Set<ProductId>([
  'brief', 'treatment', 'story', 'shotlist', 'advisor', 'references', 'wardrobe', 'a-prop',
]);

export function kindOf(tool: ProductId): StepKind {
  if (NODE_FOR[tool]) return 'make';
  if (WRITE_TOOLS.has(tool)) return 'write';
  return 'open';
}
export function nodeTypeFor(tool: ProductId): string | undefined { return NODE_FOR[tool]; }

/** Tools the planner may use: everything the app can actually open. A plan that
 *  names a roadmap tool is a plan with a dead step in it. */
export const PLANNABLE = PRODUCTS.filter(p => p.status === 'available' && PRODUCT_VIEW[p.id]);
const BY_ID = new Map(PLANNABLE.map(p => [p.id as string, p]));

// ─── the planner ────────────────────────────────────────────────────────────

/** Local fallback only. The real system prompt lives SERVER-side under the
 *  promptId (house law: the recipe never ships in the client bundle); this lean
 *  copy is what the offline/direct path uses. */
const SYSTEM = [
  'You are the producer of a Saudi-market production house. A director tells you what they want to make. You lay out the production — not advice, not a pitch: the actual order of work.',
  'Return 3–6 pipelines. Each is one stretch of work with a two-or-three-word name and one line of meaning under it — written as a STATEMENT ("Brief to signed look", "Casting is 95% of the KV"), never beginning with "For" or "To". Each holds 1–6 ordered steps; every step names one tool from the list and one imperative line of what to do with it (max 8 words).',
  'HOUSE VOCABULARY — binding: "generate", "generating" and "generation" are banned. We MAKE, we FRAME, we REFINE, we take TAKES.',
  'Order the pipelines the way the work really runs: understanding before look, look before people, people before frames, frames before motion, motion before the book.',
  'Never invent a tool. Never repeat a tool inside one pipeline unless the work genuinely repeats.',
  'Write every label in English, concrete and camera-able. No marketing language.',
  'Return ONLY JSON: {"pipelines":[{"name":"...","sub":"...","steps":[{"tool":"<id>","label":"..."}]}]}',
].join('\n');

export interface PlanResult { ok: boolean; plan?: SpacePlan; message?: string }

export async function planFromAsk(ask: string): Promise<PlanResult> {
  const trimmed = ask.trim();
  if (!trimmed) return { ok: false, message: 'Say what you want to make.' };

  const catalog = PLANNABLE.map(p => `${p.id} — ${p.name}: ${p.tagline}`).join('\n');
  const res = await llmForTask('space-plan', {
    system: SYSTEM,
    promptId: 'space.plan',
    vars: { tools: catalog },
    prompt: `TOOLS AVAILABLE\n${catalog}\n\nTHE ASK\n${trimmed}`,
    maxTokens: 1800,
  });
  if (!res.ok || !res.text) return { ok: false, message: res.message || 'The planner did not answer.' };

  let raw: any;
  try { raw = JSON.parse(stripFence(res.text)); }
  catch { return { ok: false, message: 'The planner returned something that was not a plan.' }; }

  const plan = normalize(raw, trimmed);
  if (!plan.pipelines.length) return { ok: false, message: 'The planner returned no usable steps.' };
  return { ok: true, plan };
}

/** Models fence JSON often enough that not handling it is a bug, not a nicety. */
function stripFence(t: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  return (m ? m[1] : t).trim();
}

/** Shape the model's answer into a plan we can trust: drop unknown tools, drop
 *  empty pipelines, force every state to 'queued'. The agent WAITS — so a plan
 *  that arrives with anything already done is a plan we correct, not honour. */
function normalize(raw: any, ask: string): SpacePlan {
  const out: Pipeline[] = [];
  const list = Array.isArray(raw?.pipelines) ? raw.pipelines : [];
  list.forEach((p: any, i: number) => {
    const steps: PlanStep[] = (Array.isArray(p?.steps) ? p.steps : [])
      .map((s: any) => {
        const tool = String(s?.tool || '').trim() as ProductId;
        if (!BY_ID.has(tool)) return null;
        const label = String(s?.label || BY_ID.get(tool)!.name).trim().slice(0, 80);
        return { tool, label, kind: kindOf(tool), state: 'queued' as const };
      })
      .filter(Boolean) as PlanStep[];
    if (!steps.length) return;
    out.push({
      id: slug(p?.name, i),
      name: String(p?.name || `Pipeline ${i + 1}`).trim().slice(0, 40),
      sub: String(p?.sub || '').trim().slice(0, 80),
      accent: BY_ID.get(steps[0].tool)!.accent,
      steps,
    });
  });
  return { ask, pipelines: out, createdAt: new Date().toISOString() };
}

function slug(name: any, i: number): string {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || `p${i + 1}`;
}

/** How far along one pipeline is. 'open' counts as touched, not finished — it
 *  is work we handed to the user, and only they can call it done. */
export function pipelineProgress(p: Pipeline): { done: number; total: number } {
  return { done: p.steps.filter(s => s.state === 'done').length, total: p.steps.length };
}
