// Saudi DNA Layer — shared types.
// This module is PURE: no window.*, no SDKs, no Electron imports.
// The LLM call is injected by the caller (app renderer today, server later).

export type Dimension =
  | 'wardrobe' | 'dialect' | 'places' | 'heritage' | 'faces' | 'era'
  | 'narrative' | 'comedy' | 'arabic_text' | 'dialogue' | 'performance'
  | 'camera' | 'lighting' | 'sound' | 'editing' | 'social' | 'occasions' | 'brand';

export interface KnowledgeCard {
  id: string;
  dimension: Dimension;
  region: string;
  era: string;
  tags: string[];
  ar: string;
  en: string;
  negatives: string[];
  sources: string[];
  weight: number;        // 3 = law, 1 = flavor
  always?: boolean;      // safety rails — retrieved on every run
}

export type LayerMode = 'image' | 'video';

export interface TextPlan {
  mode: 'none' | 'in-model' | 'overlay';
  /** Exact text the user wants rendered (verbatim, if any). */
  content: string | null;
  note: string | null;
}

/** Injected LLM call — maps onto window.hjen.claudeJson in the app. */
export type LlmFn = (args: { system: string; prompt: string; maxTokens?: number }) =>
  Promise<{ ok: boolean; text?: string; message?: string }>;

export interface LayerRun {
  originalPrompt: string;
  compiledPrompt: string;
  /** One Arabic sentence for the "ماذا فعلت الطبقة" panel. */
  notesAr: string;
  usedCards: { id: string; dimension: string; ar: string }[];
  textPlan: TextPlan;
  /** Model id the layer recommends (e.g. NANO_BANANA_PRO for in-model Arabic text). */
  suggestModel: string | null;
  mode: LayerMode;
  ts: number;
  /** Post-make OCR verdict on in-model Arabic text (filled by the QC step). */
  ocr?: { match: boolean; seen: string | null; retook: boolean } | null;
}

export interface CompileInput {
  userPrompt: string;
  mode: LayerMode;
  /** HJEN model id currently selected (GPT_IMAGE_2 / NANO_BANANA_PRO / seedance…). */
  modelId: string;
  /** True when the user has claimed the look themselves (DOP chips, DNA
   *  preset, Movie preset, atmosphere). The layer then does cultural
   *  correction ONLY — zero grade/stock/lighting/lens language. */
  lookLocked?: boolean;
  llm: LlmFn;
}
