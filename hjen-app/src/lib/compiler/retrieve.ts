// Saudi DNA Layer — card retrieval. v0 is keyword/tag matching with light
// Arabic normalization; no embeddings, no network. Deliberately simple —
// the corpus study will tell us where matching falls short before we add
// machinery.
import type { KnowledgeCard, LayerMode } from './types';
import { ALL_CARDS } from './cards';

/** Normalize Arabic for matching: strip diacritics, unify alef/teh/yeh forms. */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ٰٟ]/g, '')  // harakat
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ـ/g, '')                       // tatweel
    .toLowerCase();
}

/** Dimensions that only make sense for moving image / story work. */
const VIDEO_ONLY: Set<string> = new Set(['editing', 'sound']);

export interface Retrieval {
  matched: KnowledgeCard[];
  rails: KnowledgeCard[];   // always-on safety cards (refusals, text laws)
}

export function retrieveCards(userPrompt: string, mode: LayerMode, limit = 12, lookLocked = false): Retrieval {
  const norm = normalizeArabic(userPrompt);

  const scored: { card: KnowledgeCard; score: number }[] = [];
  for (const card of ALL_CARDS) {
    if (mode === 'image' && VIDEO_ONLY.has(card.dimension)) continue;
    // Look belongs to the user's DOP/DNA/Movie choices when locked — the
    // lighting cards stay out of the compiler's hands entirely.
    if (lookLocked && card.dimension === 'lighting') continue;
    let hits = 0;
    for (const tag of card.tags) {
      const t = normalizeArabic(tag);
      if (t.length >= 2 && norm.includes(t)) hits++;
    }
    if (hits > 0) scored.push({ card, score: hits * card.weight });
  }
  scored.sort((a, b) => b.score - a.score);

  const matched = scored.slice(0, limit).map(s => s.card);
  const matchedIds = new Set(matched.map(c => c.id));
  const rails = ALL_CARDS.filter(c => c.always && !matchedIds.has(c.id)
    && !(mode === 'image' && VIDEO_ONLY.has(c.dimension))
    && !(lookLocked && c.dimension === 'lighting'));

  return { matched, rails };
}
