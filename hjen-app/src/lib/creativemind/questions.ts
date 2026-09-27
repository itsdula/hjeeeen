// The Creative Mind's visual questions — fully brief-driven since Anwar's
// 2026-07-11 corrections:
//   · Questions are EXTRACTED FROM THE CLIENT'S BRIEF (6–10 initially; answers
//     may spawn follow-up questions, hard cap 20 total). No fixed dimensions.
//   · PLAIN LANGUAGE law: simple, direct, well-crafted — zero philosophy.
//     ("Where does the story happen?" — never "Which register of place…")
//   · English is the base; every question/option carries an Arabic
//     translation rendered smaller in the UI.
//
// Boards resolve per option: hidden Frameset hunt on `query` first, corpus
// refSearch on `tags` second, typographic card last — the flow never blocks.

import type { CraftedQuestion } from './engine';
import { EYE_REGISTERS, type Register } from '../eye/types';

export interface MindOption {
  id: string;
  en: string;          // 2–6 plain words naming what we would SEE
  ar: string;          // Arabic translation (smaller type in UI)
  tags: string[];      // what the pick feeds to the collider
  query: string;       // film-frame search phrase (hidden Frameset hunt)
  // The FEELING this option is asking for, in the eye's vocabulary. The hunt
  // harvests deep and the eye reorders by this — without it the board falls back
  // to a random pick out of the first twelve results, which cannot be wrong but
  // cannot be right either. Written by the same call that writes `query`, so it
  // costs nothing extra. Null = no eye, old behaviour.
  register: Register | null;
}

export interface MindQuestion {
  id: string;          // crafted slug — questions are born from the brief
  en: string;          // one short plain English question
  ar: string;          // Arabic translation
  options: MindOption[];
}

/** Hard ceiling across initial + follow-up rounds (Anwar: up to 20 if earned). */
export const MAX_TOTAL_QUESTIONS = 20;
export const MAX_INITIAL_QUESTIONS = 10;
export const MIN_INITIAL_QUESTIONS = 4;

/** Static fallback — used ONLY when the craft call fails. Plain language. */
export const FALLBACK_QUESTIONS: ReadonlyArray<MindQuestion> = [
  {
    id: 'who',
    en: 'Who is the film about?',
    ar: 'عن مَن الفيلم؟',
    options: [
      { id: 'one-person', en: 'One person, up close', ar: 'شخص واحد، قريب', tags: ['solitary figure', 'portrait'], query: 'solitary portrait close' , register: 'longing' },
      { id: 'two-people', en: 'Two people together', ar: 'شخصان معًا', tags: ['two people', 'relationship'], query: 'two people conversation' , register: 'groundedness' },
      { id: 'a-family', en: 'A family', ar: 'عائلة', tags: ['family', 'gathering'], query: 'family dinner gathering' , register: 'joy' },
    ],
  },
  {
    id: 'where',
    en: 'Where does the story happen?',
    ar: 'أين تحدث القصة؟',
    options: [
      { id: 'at-home', en: 'At home', ar: 'في البيت', tags: ['home', 'domestic interior'], query: 'family living room warm' , register: 'groundedness' },
      { id: 'in-the-street', en: 'In the street', ar: 'في الشارع', tags: ['street', 'city'], query: 'city street storefront' , register: 'groundedness' },
      { id: 'open-land', en: 'In open land', ar: 'في أرض مفتوحة', tags: ['desert', 'landscape'], query: 'desert wide landscape' , register: 'desolation' },
      { id: 'at-work', en: 'At work or in the market', ar: 'في العمل أو السوق', tags: ['shop', 'workplace'], query: 'market shop vendor' , register: 'groundedness' },
    ],
  },
  {
    id: 'when',
    en: 'What time of day?',
    ar: 'أي وقت من اليوم؟',
    options: [
      { id: 'early-morning', en: 'Early morning light', ar: 'ضوء الصباح الباكر', tags: ['dawn', 'morning light'], query: 'dawn golden morning' , register: 'longing' },
      { id: 'daytime', en: 'Full daylight', ar: 'وضح النهار', tags: ['day', 'daylight'], query: 'bright daylight street' , register: 'groundedness' },
      { id: 'night', en: 'At night', ar: 'في الليل', tags: ['night', 'lamps', 'neon'], query: 'night neon street' , register: 'desolation' },
    ],
  },
  {
    id: 'feeling',
    en: 'What should it feel like?',
    ar: 'ما الإحساس المطلوب؟',
    options: [
      { id: 'warm-memory', en: 'A warm memory', ar: 'ذكرى دافئة', tags: ['nostalgia', 'warm light'], query: 'warm nostalgic interior' , register: 'longing' },
      { id: 'quiet-pride', en: 'Quiet pride', ar: 'فخر هادئ', tags: ['dignity', 'craftsman'], query: 'craftsman portrait daylight' , register: 'resolve' },
      { id: 'big-joy', en: 'Big shared joy', ar: 'فرح جماعي', tags: ['celebration', 'laughter'], query: 'celebration crowd laughing' , register: 'joy' },
    ],
  },
  {
    id: 'product-role',
    en: 'How does the product appear?',
    ar: 'كيف يظهر المنتج؟',
    options: [
      { id: 'in-hands', en: 'In someone’s hands', ar: 'في يد أحدهم', tags: ['hands', 'product in use'], query: 'hands holding object close-up' , register: 'groundedness' },
      { id: 'in-the-scene', en: 'Part of the scene', ar: 'جزء من المشهد', tags: ['product in scene', 'natural presence'], query: 'kitchen table morning still' , register: 'groundedness' },
    ],
  },
  {
    id: 'camera',
    en: 'How close is the camera?',
    ar: 'كم تقترب الكاميرا؟',
    options: [
      { id: 'very-close', en: 'Very close — faces and hands', ar: 'قريبة جدًا — وجوه وأيادٍ', tags: ['close-up', 'intimate'], query: 'face hands close-up' , register: 'longing' },
      { id: 'whole-scene', en: 'Standing back — the whole scene', ar: 'بعيدة — المشهد كامل', tags: ['wide shot', 'observer'], query: 'wide scene figure' , register: 'desolation' },
    ],
  },
];

/** A register the eye can actually rank on, or null. An unknown word is dropped
 *  rather than coerced — a wrong feeling ranks worse than no feeling at all. */
function asRegister(v: unknown): Register | null {
  const t = String(v ?? '').trim().toLowerCase();
  return (EYE_REGISTERS as string[]).includes(t) ? (t as Register) : null;
}

/** Normalize crafted output (initial OR follow-up) into valid questions.
 *  Generic — no fixed dimensions. Malformed questions are dropped. */
export function normalizeCraftedQuestions(
  crafted: CraftedQuestion[] | undefined,
  opts?: { max?: number; existingIds?: string[] },
): MindQuestion[] {
  const max = opts?.max ?? MAX_INITIAL_QUESTIONS;
  const taken = new Set(opts?.existingIds ?? []);
  const out: MindQuestion[] = [];
  for (const c of crafted ?? []) {
    if (out.length >= max) break;
    const en = String(c.en ?? '').trim();
    const ar = String(c.ar ?? '').trim();
    if (!en) continue;
    let id = String(c.id ?? '').trim() || en.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32);
    while (taken.has(id)) id = `${id}-2`;
    const options: MindOption[] = (c.options ?? [])
      .map((o, i) => ({
        id: String(o.id ?? `opt-${i}`).trim() || `opt-${i}`,
        en: String(o.en ?? '').trim(),
        ar: String(o.ar ?? '').trim(),
        tags: Array.isArray(o.tags) ? o.tags.map(t => String(t ?? '').trim()).filter(Boolean) : [],
        query: String(o.query ?? '').trim(),
        register: asRegister(o.register),
      }))
      .filter(o => o.en && o.query)
      .slice(0, 4);
    if (options.length < 2) continue;
    taken.add(id);
    out.push({ id, en, ar, options });
  }
  return out;
}
