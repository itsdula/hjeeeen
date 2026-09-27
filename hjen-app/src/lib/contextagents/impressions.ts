// Context Agents — the three IMPRESSION questions (المُدخَل).
//
// Anwar's law (2026-07-30): a beginner never sees the technical vocabulary
// (register / beat / energy). They answer by picking a PICTURE that conveys a
// feeling. These three questions are STATIC — the axes are a closed enum
// (6 × 5 × 3), nothing is discovered from a brief; only the board `query` may
// be tuned later if a board comes back thin (Phase 1.5). This file is the
// verbatim source of truth for the option text; the store maps a pick to the
// state member via `option.value` and hunts its board from `option.query`.
//
// The shape is a superset of Creative Mind's MindOption (adds `meaning` +
// `value`), so framesetBoardLadder / corpusBoard / RefBoard consume it unchanged.
// Language law: English is the display type; the Arabic line is its translation.

/** One impression choice. `value` is the closed-vocab enum member the engine
 *  receives; `meaning` is the plain "when to choose this" line; `query` hunts
 *  the board; `tags` are the query's content words (board fallback + chips). */
export interface ImpressionOption {
  id: string;
  en: string;
  ar: string;
  meaning: string;
  value: string;      // a member of REGISTERS / BEATS / ENERGIES
  tags: string[];     // content words of `query` (drives the typographic fallback)
  query: string;      // film-frame search phrase (hidden Frameset hunt / corpus)
}

/** One impression question — bound to a single state axis. */
export interface ImpressionQuestion {
  axis: 'register' | 'beat' | 'energy';
  id: string;
  en: string;
  ar: string;
  options: ImpressionOption[];
}

// Same stopword set as framesetHunt.labelQuery — kept local so impressions.ts
// has no engine/board dependency and can be authored/tested on its own.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'on', 'in', 'at', 'to', 'and', 'or', 'not', 'like',
  'with', 'else', 'being', 'its', "it's", 'their', 'his', 'her',
]);

/** Content words of a board query → the option's tags (drops stopwords, dedupes). */
function tagsOf(query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (w.length <= 2 || STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 6) break;
  }
  return out;
}

/** Build an option with tags auto-derived from its query. */
function opt(o: Omit<ImpressionOption, 'tags'>): ImpressionOption {
  return { ...o, tags: tagsOf(o.query) };
}

// ─── Q1 · REGISTER «وش الإحساس اللي يغلب؟» ─────────────────────────────────────
const REGISTER_Q: ImpressionQuestion = {
  axis: 'register',
  id: 'register',
  en: 'How should it feel?',
  ar: 'وش الإحساس اللي يغلب؟',
  options: [
    opt({ id: 'longing', value: 'longing',
      en: 'A quiet ache for someone / somewhere', ar: 'حنين هادئ',
      meaning: 'لمّا الإعلان عن الاشتياق، الغياب، ذكرى تشدّك',
      query: 'nostalgic longing warm window figure looking away' }),
    opt({ id: 'resolve', value: 'resolve',
      en: 'Steady, set on it', ar: 'عزيمة ثابتة',
      meaning: 'لمّا البطل ماضي في هدفه، ثبات وتصميم بلا صراخ',
      query: 'determined focused figure steady forward quiet strength' }),
    opt({ id: 'joy', value: 'joy',
      en: 'Bright, shared happiness', ar: 'فرح مشترك',
      meaning: 'لمّا الإعلان احتفال، ضحك، لمّة تفرح',
      query: 'celebration laughter family gathering bright joy' }),
    opt({ id: 'desolation', value: 'desolation',
      en: 'Empty, alone, cold', ar: 'وحشة وفراغ',
      meaning: 'لمّا المطلوب إحساس الوحدة، الفقد، البرود',
      query: 'desolate empty lone figure cold muted vast' }),
    opt({ id: 'turbulence', value: 'turbulence',
      en: 'Restless, on edge', ar: 'اضطراب وقلق',
      meaning: 'لمّا فيه توتر، حركة، شي على وشك الانفجار',
      query: 'tense restless motion conflict charged unstable' }),
    opt({ id: 'groundedness', value: 'groundedness',
      en: 'Calm, rooted, at peace', ar: 'طمأنينة وثبات',
      meaning: 'لمّا الإحساس سكينة، انتماء، أرض ثابتة تحت القدم',
      query: 'grounded calm rooted still belonging warm home' }),
  ],
};

// ─── Q2 · BEAT «وين إحنا من القصة؟» ───────────────────────────────────────────
const BEAT_Q: ImpressionQuestion = {
  axis: 'beat',
  id: 'beat',
  en: 'Where in the story are we?',
  ar: 'وين إحنا من القصة؟',
  options: [
    opt({ id: 'setup', value: 'setup',
      en: 'The everyday, before anything changes', ar: 'البداية العادية',
      meaning: 'المشهد الطبيعي قبل ما يصير شي — نعرّف العالم',
      query: 'ordinary establishing everyday calm opening wide' }),
    opt({ id: 'desire', value: 'desire',
      en: 'Someone wants something', ar: 'ظهور الرغبة',
      meaning: 'لمّا نشوف البطل يبي شي، شرارة الرغبة',
      query: 'character reaching wanting look desire spark' }),
    opt({ id: 'conflict', value: 'conflict',
      en: 'It gets hard, something resists', ar: 'العقبة والصراع',
      meaning: 'لمّا فيه مانع، صعوبة، مقاومة',
      query: 'struggle obstacle tension conflict effort' }),
    opt({ id: 'change', value: 'change',
      en: 'The turn — everything shifts', ar: 'نقطة التحوّل',
      meaning: 'اللحظة اللي كل شي يتغير فيها',
      query: 'turning point reveal shift transformation moment' }),
    opt({ id: 'result', value: 'result',
      en: 'After — the new state', ar: 'النتيجة والخاتمة',
      meaning: 'المشهد بعد التحوّل، الحال الجديد',
      query: 'resolution aftermath new calm arrival ending' }),
  ],
};

// ─── Q3 · ENERGY «قد إيش المشهد صاخب؟» ────────────────────────────────────────
const ENERGY_Q: ImpressionQuestion = {
  axis: 'energy',
  id: 'energy',
  en: 'How loud is this moment?',
  ar: 'قد إيش المشهد صاخب؟',
  options: [
    opt({ id: 'quiet', value: 'quiet',
      en: 'Still and hushed', ar: 'هادئ وساكن',
      meaning: 'لقطات بطيئة، صمت، تأمّل',
      query: 'quiet still slow contemplative minimal calm' }),
    opt({ id: 'mid', value: 'mid',
      en: 'A steady pulse', ar: 'نبض متوسط',
      meaning: 'إيقاع طبيعي، لا ساكن ولا صاخب',
      query: 'steady balanced everyday rhythm moderate' }),
    opt({ id: 'loud', value: 'loud',
      en: 'Big and driving', ar: 'صاخب ومندفع',
      meaning: 'حركة، إيقاع عالي، طاقة تدفعك',
      query: 'loud energetic fast dynamic bold crowd motion' }),
  ],
};

/** The three impression questions, in the order the Studio walks them:
 *  register → beat → energy. */
export const IMPRESSION_QUESTIONS: ImpressionQuestion[] = [REGISTER_Q, BEAT_Q, ENERGY_Q];
