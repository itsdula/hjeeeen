// The six emotional registers — extracted from the Clay & Basil style bible
// (طين و ريحان) §III Mood Matrix. These are the Creative Mind's first visual
// question: the user picks a register by choosing a board of corpus frames,
// not by naming a mood word.
//
// refQuery tokens come from the verified corpus vocabulary (lightState /
// shotSize / free-text blob) — see STUDY/creative_mind/01_BUILD_PLAN.md.

export interface MoodRegister {
  id: string;
  ar: string;
  en: string;
  tags: string[];      // English tokens fed to the collider when picked
  refQuery: string;    // ≤3-ish tokens against hjen:ref-search
  colorNote: string;   // the bible's color/light emphasis, for the option card
}

export const MOOD_REGISTERS: ReadonlyArray<MoodRegister> = [
  {
    id: 'haneen',
    ar: 'حنين',
    en: 'Longing',
    tags: ['nostalgia', 'warm light', 'memory', 'golden hour'],
    refQuery: 'golden warm bakery craft',
    colorNote: 'Warm amber dominates — light from a low sun or a practical lamp.',
  },
  {
    id: 'azm',
    ar: 'عزم',
    en: 'Resolve',
    tags: ['determination', 'solitary figure', 'craftsman', 'daylight'],
    refQuery: 'day portrait craftsman solitary',
    colorNote: 'Hard clean daylight — one human, one task, no softness.',
  },
  {
    id: 'tarab',
    ar: 'طرب',
    en: 'Joy',
    tags: ['celebration', 'gathering', 'laughter', 'color'],
    refQuery: 'day market celebration laughing',
    colorNote: 'Color pops on skin-warm base — the frame is full and moving.',
  },
  {
    id: 'wahsha',
    ar: 'وحشة',
    en: 'Desolation',
    tags: ['solitude', 'vast landscape', 'blue hour', 'silence'],
    refQuery: 'extreme-wide desert blue-hour',
    colorNote: 'Teal-blue shadow field — the figure is small against the land.',
  },
  {
    id: 'fawda',
    ar: 'فوضى',
    en: 'Chaos',
    tags: ['mixed light', 'crowded interior', 'motion', 'noise'],
    refQuery: 'interior-practical mixed office',
    colorNote: 'Mixed color temperatures collide — practicals against daylight.',
  },
  {
    id: 'asala',
    ar: 'أصالة',
    en: 'Rootedness',
    tags: ['heritage', 'ritual', 'fire light', 'craft'],
    refQuery: 'golden dallah fire heritage',
    colorNote: 'Ember warmth on aged surfaces — the ritual object holds the frame.',
  },
];
