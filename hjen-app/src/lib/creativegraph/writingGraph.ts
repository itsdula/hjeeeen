import { ppClaude } from '../../components/preprod/shared';
import { runCreativeGraph } from './engine';

export interface WritingGraphInput<T> {
  system: string;
  promptId: string;
  payload: unknown;
  rubric: string;
  vars?: Record<string, unknown>;
  maxTokens?: number;
  readDraft: (json: any) => T | null;
}

export type WritingGraphResult<T> =
  | { ok: true; value: T; usd?: number }
  | { ok: false; message: string };

/** Draft → independent script editor → one bounded rewrite when required. */
export async function runWritingGraph<T>(input: WritingGraphInput<T>): Promise<WritingGraphResult<T>> {
  type Review = { pass?: boolean; fatal?: string[]; notes?: string[] };
  type S = { draft?: any; review?: Review; final?: any; usd?: number; error?: string };
  const result = await runCreativeGraph<S>({ start: 'writer', initial: {}, maxSteps: 4, nodes: [
    { id: 'writer', defaultRoute: 'editor', async run(state) {
      const r = await ppClaude<any>({ system: input.system, promptId: `${input.promptId}.graph.draft`, vars: input.vars, prompt: JSON.stringify(input.payload), maxTokens: input.maxTokens });
      return r.ok ? { state: { ...state, draft: r.json, usd: r.usd } } : { state: { ...state, error: r.message }, route: null };
    } },
    { id: 'editor', routes: { pass: null, revise: 'rewrite' }, async run(state, ctx) {
      const system = `You are an unsentimental senior script editor. You did not write the draft. Test it against this exact rubric:\n${input.rubric}\nDo not line-edit for taste. Flag structural failure, generic language, repeated beats, unfilmable emotion, false cultural detail, and any brand appearance that could be removed without changing the story. Return JSON only: {"pass":true,"fatal":[],"notes":[]}.`;
      const r = await ppClaude<Review>({ system, promptId: `${input.promptId}.graph.edit`, vars: input.vars, prompt: JSON.stringify({ source: input.payload, draft: state.draft }), maxTokens: 1400 });
      if (!r.ok) return { state, route: 'pass' };
      ctx.note(r.json.pass ? 'Draft cleared the independent editor.' : 'Draft returned for one structural rewrite.');
      return { state: { ...state, review: r.json, usd: (state.usd ?? 0) + (r.usd ?? 0) }, route: r.json.pass ? 'pass' : 'revise' };
    } },
    { id: 'rewrite', defaultRoute: null, async run(state) {
      const system = `${input.system}\n\nREVISION LAW: An independent editor rejected the first draft. Rewrite the complete output, fixing the cited structural failures. Do not explain or defend the old draft; return only the original JSON contract.`;
      const r = await ppClaude<any>({ system, promptId: `${input.promptId}.graph.rewrite`, vars: input.vars, prompt: JSON.stringify({ source: input.payload, rejectedDraft: state.draft, editor: state.review }), maxTokens: input.maxTokens });
      return r.ok ? { state: { ...state, final: r.json, usd: (state.usd ?? 0) + (r.usd ?? 0) } } : { state, route: null };
    } },
  ] });
  if (result.state.error) return { ok: false, message: result.state.error };
  const value = input.readDraft(result.state.final ?? result.state.draft);
  return value ? { ok: true, value, usd: result.state.usd } : { ok: false, message: 'The writing graph returned a malformed draft.' };
}

