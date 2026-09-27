// Saudi DNA Layer — public API.
//
//   const run = await runLayer({ userPrompt, mode: 'image', modelId, llm });
//
// Pure module: the LLM function is injected (window.hjen.claudeJson in the
// renderer; an Anthropic REST call in the demo server later). On any failure
// the caller falls back to the original prompt — the layer must never block
// a make.
import type { CompileInput, LayerRun } from './types';
import { retrieveCards } from './retrieve';
import { buildCompileRequest, parseCompileResponse } from './compile';
import { validateCompiledPrompt } from './validate';
import { ALL_CARDS } from './cards';

export type { LayerRun, TextPlan, KnowledgeCard, LlmFn, LayerMode } from './types';
export { ALL_CARDS } from './cards';

/** The model that renders Arabic glyphs most reliably today. */
const TEXT_MODEL_ID = 'NANO_BANANA_PRO';

export async function runLayer(input: CompileInput): Promise<LayerRun | null> {
  const userPrompt = (input.userPrompt || '').trim();
  if (!userPrompt) return null;
  const lookLocked = !!input.lookLocked;

  const { matched, rails } = retrieveCards(userPrompt, input.mode, 12, lookLocked);
  const cards = [...rails, ...matched];
  if (cards.length === 0) return null;

  const { system, prompt } = buildCompileRequest(userPrompt, input.mode, cards, lookLocked);
  let res: { ok: boolean; text?: string; message?: string };
  try {
    res = await input.llm({ system, prompt, maxTokens: 2000 });
  } catch {
    return null;
  }
  if (!res.ok || !res.text) return null;

  const parsed = parseCompileResponse(res.text);
  if (!parsed) return null;

  let { prompt: finalPrompt } = validateCompiledPrompt(parsed.compiledPrompt, userPrompt);

  // Signage discipline — invented legible Arabic is the #1 giveaway. When no
  // exact in-model text was planned, force incidental signage unreadable.
  if (parsed.textPlan.mode !== 'in-model') {
    finalPrompt += ' Any incidental background text or signage is softly out of focus and unreadable — no legible invented Arabic words, no invented shop or institution names.';
  }

  const byId = new Map(ALL_CARDS.map(c => [c.id, c]));
  const usedCards = parsed.usedCardIds
    .map(id => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map(c => ({ id: c.id, dimension: c.dimension, ar: c.ar }));

  const suggestModel =
    parsed.textPlan.mode === 'in-model' && input.modelId !== TEXT_MODEL_ID
      ? TEXT_MODEL_ID
      : null;

  return {
    originalPrompt: userPrompt,
    compiledPrompt: finalPrompt,
    notesAr: parsed.notesAr,
    usedCards,
    textPlan: parsed.textPlan,
    suggestModel,
    mode: input.mode,
    ts: Date.now(),
  };
}
