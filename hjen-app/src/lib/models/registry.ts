// Model registry — النماذج لكل مهمة. THE single module (house law: verified
// specs live in ONE module everyone imports) that knows:
//   1. which text models exist per provider (direct vendor APIs only — no
//      middlemen: Anthropic / OpenAI / Google, each called on its own key),
//   2. which HJEN task uses which model BY DEFAULT,
//   3. the user's overrides (Settings → Models), persisted in
//      {userData}/models_config.json via IPC so the MAIN process reads the
//      same file for its own calls.
// Consumers never name a model — they name a TASK; the registry resolves it.

export type Provider = 'anthropic' | 'openai' | 'google';

export interface ModelDef {
  id: string;                 // exact API model id
  provider: Provider;
  label: string;              // what the dashboard shows
  note?: string;              // one-line positioning
}

/** The selectable text models. Latest ChatGPT text model first among OpenAI. */
export const MODEL_CATALOG: ModelDef[] = [
  // Anthropic — the house workhorse for structured creative JSON
  { id: 'claude-sonnet-4-6', provider: 'anthropic', label: 'Claude Sonnet 4.6', note: 'التوازن — البنية الإبداعية المنضبطة' },
  { id: 'claude-opus-4-8', provider: 'anthropic', label: 'Claude Opus 4.8', note: 'الأعمق — للمهام الثقيلة' },
  { id: 'claude-haiku-4-5-20251001', provider: 'anthropic', label: 'Claude Haiku 4.5', note: 'الأسرع — للمهام الميكانيكية' },
  // OpenAI — latest ChatGPT text models (ids probed live against the account:
  // gpt-5.2 / gpt-5.1 / gpt-5-mini exist; gpt-5.1-mini does NOT — 404)
  { id: 'gpt-5.2', provider: 'openai', label: 'ChatGPT · GPT-5.2', note: 'أحدث نص ChatGPT' },
  { id: 'gpt-5.1', provider: 'openai', label: 'ChatGPT · GPT-5.1', note: 'الصياغة العربية المجرّبة' },
  { id: 'gpt-5-mini', provider: 'openai', label: 'ChatGPT · GPT-5 mini', note: 'أخف وأرخص — الترجمة' },
  // Google — the corpus/vision line (ids probed live against the account
  // 2026-07-31 via GET /v1beta/models + a real generateContent call; the list
  // endpoint alone LIES — it still advertises gemini-2.5-pro, which now answers
  // 404 "no longer available to new users")
  { id: 'gemini-3.6-flash', provider: 'google', label: 'Gemini 3.6 Flash', note: 'أحدث قراءة بصرية — الأقوى على المحاور الداخلية' },
  { id: 'gemini-3.1-pro-preview', provider: 'google', label: 'Gemini 3.1 Pro (preview)', note: 'تحليل بصري عميق — نسخة معاينة' },
  { id: 'gemini-2.5-flash', provider: 'google', label: 'Gemini 2.5 Flash', note: 'تحليل بصري سريع — يشغّل مقطّر الكوربوس' },
  { id: 'gemini-2.5-pro', provider: 'google', label: 'Gemini 2.5 Pro', note: '⚠ 404 على المفاتيح الجديدة — لا تختره' },
];

export type TaskId =
  | 'brief-mind' | 'treatment' | 'story-script' | 'storyboard' | 'frame-skill'
  | 'cast' | 'creative-advisor' | 'prompt-enhance' | 'camera-angles'
  | 'arabic-copy' | 'arabic-translate'
  | 'context-agents' | 'eye-read'
  | 'swap-slots' | 'swap-consequence' | 'swap-verify'
  | 'reference-maker-understand' | 'reference-maker-drift'
  | 'ad-breakdown' | 'breakdown-docs' | 'breakdown-dna' | 'breakdown-master'
  | 'space-plan' | 'space-write' | 'general';

export interface TaskDef {
  id: TaskId;
  ar: string;                 // dashboard label (Arabic-first product)
  en: string;
  desc: string;               // one line: what this task does
  defaultModel: string;       // MODEL_CATALOG id
  /** true = the task's code path already routes through llmForTask; false =
   *  listed for the roadmap, switching it has no effect YET (dashboard says so). */
  routed: boolean;
}

export const TASKS: TaskDef[] = [
  { id: 'brief-mind', ar: 'العقل الإبداعي', en: 'Brief Mind', desc: 'تحليل البريف · التصادم · العصر', defaultModel: 'claude-sonnet-4-6', routed: true },
  // HJEN SPACE — the gateway agent. `space-plan` turns one spoken ask into the
  // production's pipelines; `space-write` executes a single written step in
  // place. Sonnet on both: this is structured creative JSON, the house workhorse.
  { id: 'space-plan', ar: 'خطة الفضاء', en: 'Space Plan', desc: 'طلب المستخدم → خطوط إنتاج بخطواتها', defaultModel: 'claude-sonnet-4-6', routed: true },
  { id: 'space-write', ar: 'خطوة مكتوبة', en: 'Space Step', desc: 'تنفيذ خطوة كتابية داخل الفضاء', defaultModel: 'claude-sonnet-4-6', routed: true },
  { id: 'treatment', ar: 'المعالجة', en: 'Treatment', desc: 'رؤية المخرج والاختيارات', defaultModel: 'claude-sonnet-4-6', routed: false },
  { id: 'story-script', ar: 'نص القصة', en: 'Story Script', desc: 'السكربت الموقوت بالضربات', defaultModel: 'claude-sonnet-4-6', routed: false },
  { id: 'storyboard', ar: 'الستوري بورد', en: 'Storyboard', desc: 'تقطيع السكربت إلى مشاهد ولقطات', defaultModel: 'claude-sonnet-4-6', routed: false },
  { id: 'frame-skill', ar: 'مهارات الفريم', en: 'Frame Skills', desc: 'تحويل إدخال Frame إلى Master Prompt عبر الـSkill المختارة', defaultModel: 'claude-sonnet-4-6', routed: true },
  { id: 'cast', ar: 'الكاست', en: 'Cast', desc: 'قراءة بطاقات الشخصيات من الصور', defaultModel: 'claude-sonnet-4-6', routed: false },
  { id: 'creative-advisor', ar: 'المستشار الإبداعي', en: 'Creative Advisor', desc: 'الرأي الدائم 360', defaultModel: 'claude-sonnet-4-6', routed: true },
  { id: 'prompt-enhance', ar: 'تحسين الوصف', en: 'Prompt Enhance', desc: 'رفع وصف الفريم قبل الصنع', defaultModel: 'claude-sonnet-4-6', routed: false },
  { id: 'camera-angles', ar: 'زوايا الكاميرا', en: 'Camera Angles', desc: 'قراءة المشهد واقتراح زوايا كاميرا متمايزة لكل لقطة', defaultModel: 'gpt-5.2', routed: true },
  { id: 'arabic-copy', ar: 'الصياغة العربية', en: 'Arabic Copy', desc: 'إعادة صياغة المخرجات بعربية حيّة', defaultModel: 'gpt-5.1', routed: true },
  { id: 'arabic-translate', ar: 'الترجمة إلى العربية', en: 'Arabic Translate', desc: 'ترجمة العرض — الأصل إنجليزي دائمًا', defaultModel: 'gpt-5-mini', routed: true },
  { id: 'context-agents', ar: 'وكلاء السياق', en: 'Context Agents', desc: 'استرجاع الطرق المتراكمة + اللوك لإخراج موجّه', defaultModel: 'gpt-5.1', routed: true },
  { id: 'eye-read', ar: 'العين — قراءة الفريم', en: 'The Eye · Read', desc: 'قراءة الفريم على عشرة محاور — ما فيه، حرفته، حالته الداخلية، ومفتاح بحثه', defaultModel: 'gemini-3.6-flash', routed: true },
  // THE SWAP. The two vision passes run on the SAME model as eye-read on purpose:
  // the split has to see the frame exactly the way the read that it inherits saw
  // it, and the verifier has to hold the same standard as the eye that will later
  // grade the take. Different models on those three seats is how a swap ends up
  // preserving what one model saw and changing what another one did.
  { id: 'swap-slots', ar: 'التبديل — تفكيك الفريم', en: 'The Swap · Slots', desc: 'فصل الشخصية عن الجسد والنظرة، وقراءة الأزياء التي لم تقرأها العين', defaultModel: 'gemini-3.6-flash', routed: true },
  { id: 'swap-consequence', ar: 'التبديل — التبعات', en: 'The Swap · Consequence', desc: 'ما الذي يجرّه التغيير معه، وكتابة اختبار القبول لكل مطلب', defaultModel: 'claude-sonnet-4-6', routed: true },
  { id: 'swap-verify', ar: 'التبديل — التحقق', en: 'The Swap · Verify', desc: 'هل نزل كل مطلب في اللقطة — حكم أعمى لا يرى المصدر', defaultModel: 'gemini-3.6-flash', routed: true },
  { id: 'reference-maker-understand', ar: 'صانع المراجع — الفهم', en: 'Reference Maker · Understand', desc: 'تحويل شرح المخرج إلى عقد KEEP / CHANGE', defaultModel: 'claude-sonnet-4-6', routed: true },
  { id: 'reference-maker-drift', ar: 'صانع المراجع — الانحراف', en: 'Reference Maker · Drift', desc: 'مقارنة الـtake بالمصدر وما تم قفله', defaultModel: 'gemini-3.6-flash', routed: true },
  // Default was gemini-2.5-pro — the ONE model this very file marks "⚠ 404 on new
  // keys, do not pick it". Anyone who never opened Settings → Models got that 404
  // on every Ad Breakdown. Moved to the strongest vision read that is actually alive.
  { id: 'ad-breakdown', ar: 'تشريح الإعلان — التحليل البصري', en: 'Ad Breakdown · Vision', desc: 'قراءة الإعلان 360 من الفريمات (متعدد الصور + صوت)', defaultModel: 'gemini-3.6-flash', routed: true },
  { id: 'breakdown-docs', ar: 'تشريح الإعلان — وثائق ما قبل الإنتاج', en: 'Ad Breakdown · Docs', desc: 'تأليف حزمة ما قبل الإنتاج (بريف · قصة · معالجة · مراجع · شوت ليست · بيتش)', defaultModel: 'claude-sonnet-4-6', routed: true },
  { id: 'breakdown-dna', ar: 'تشريح الإعلان — تقطير الـDNA', en: 'Ad Breakdown · DNA', desc: 'تقطير 13 ملف DNA (Gem خماسي المقاطع) من خلاصات كل محور — كيف تصنع جديدًا بلغة هذا الإعلان', defaultModel: 'claude-sonnet-4-6', routed: true },
  { id: 'breakdown-master', ar: 'تشريح الإعلان — البرومبت الجامع', en: 'Ad Breakdown · Master Prompt', desc: 'دمج المحاور الـ13 في برومبت جامع واحد لكل لقطة (فريم/فيديو) + قائمة المراجع للوصول لنتيجة مطابقة', defaultModel: 'claude-sonnet-4-6', routed: true },
  { id: 'general', ar: 'عام', en: 'General', desc: 'أي مهمة غير مصنفة', defaultModel: 'claude-sonnet-4-6', routed: true },
];

export const modelById = (id: string): ModelDef | undefined => MODEL_CATALOG.find(m => m.id === id);
export const taskById = (id: TaskId): TaskDef => TASKS.find(t => t.id === id) ?? TASKS[TASKS.length - 1];

// ─── config (overrides only; defaults live above) ───────────────────────────

export interface ModelsConfig { version: 1; tasks: Partial<Record<TaskId, string>> }

let cached: ModelsConfig | null = null;

export async function loadModelsConfig(force = false): Promise<ModelsConfig> {
  if (cached && !force) return cached;
  try {
    const res = await window.hjen.modelsConfigRead();
    cached = res?.ok && res.config ? (res.config as ModelsConfig) : { version: 1, tasks: {} };
  } catch { cached = { version: 1, tasks: {} }; }
  return cached!;
}

export async function saveModelsConfig(cfg: ModelsConfig): Promise<void> {
  cached = cfg;
  try { await window.hjen.modelsConfigWrite({ config: cfg }); } catch { /* next save retries */ }
}

/** Task → the model that should run it right now (override, else default,
 *  else the catalog's first anthropic model). */
export function resolveModel(task: TaskId, cfg: ModelsConfig | null): ModelDef {
  const id = cfg?.tasks?.[task] ?? taskById(task).defaultModel;
  return modelById(id) ?? MODEL_CATALOG[0];
}

// ─── the router — consumers call a TASK, never a model ─────────────────────

export interface LlmArgs { system: string; prompt: string; maxTokens?: number; imagePaths?: string[]; audioPaths?: string[];
  /** When set, the SERVER injects the system prompt (gateway mode) from its
   *  registry — `system` is still passed for the offline/direct path. */
  promptId?: string; vars?: any }
export interface LlmResult { ok: boolean; text?: string; model?: string; truncated?: boolean; message?: string; reason?: string }

// A transient failure is worth retrying — a network blip, a rate-limit, an
// overloaded provider, a dropped socket. A single one of these on batch 4 of a
// 13-minute run must NOT throw the whole run away. Content errors (bad JSON, auth,
// 400) are NOT transient — retrying them just wastes time, so they fail fast.
const TRANSIENT_RE = /fetch failed|network|socket|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|timed? ?out|aborted|econn|429|rate.?limit|overloaded|throttl|temporar|unavailable|50[234]|bad gateway|gateway time/i;
const isTransient = (msg?: string) => !!msg && TRANSIENT_RE.test(msg);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
// backoff between attempts (attempt 1 → wait[0] before attempt 2, …)
const RETRY_BACKOFF_MS = [2000, 5000, 12000, 25000];

export async function llmForTask(task: TaskId, args: LlmArgs): Promise<LlmResult> {
  const cfg = await loadModelsConfig();
  const model = resolveModel(task, cfg);
  const call = async (): Promise<LlmResult> => {
    try {
      return await window.hjen.llmJson({
        provider: model.provider, model: model.id,
        system: args.system, prompt: args.prompt,
        maxTokens: args.maxTokens, imagePaths: args.imagePaths, audioPaths: args.audioPaths,
        promptId: args.promptId, vars: args.vars,
      }) as LlmResult;
    } catch (e: any) {
      return { ok: false, message: String(e?.message || e) };
    }
  };

  let res = await call();
  for (let attempt = 0; !res.ok && isTransient(res.message) && attempt < RETRY_BACKOFF_MS.length; attempt++) {
    await sleep(RETRY_BACKOFF_MS[attempt]);
    res = await call();
  }
  return res;
}
