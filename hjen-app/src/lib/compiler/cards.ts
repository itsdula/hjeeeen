// Saudi DNA Layer — seed knowledge cards.
// Seed cards are distilled from the HJEN bibles (Clay & Basil, the copy
// register, the KV wardrobe/casting canon). As the dna_corpus study produces
// verified auto-cards they progressively replace/extend these files.
import type { KnowledgeCard } from './types';

import wardrobe from './cards/wardrobe.json';
import lighting from './cards/lighting.json';
import camera from './cards/camera.json';
import places from './cards/places.json';
import faces from './cards/faces.json';
import era from './cards/era.json';
import heritage from './cards/heritage.json';
import social from './cards/social.json';
import occasions from './cards/occasions.json';
import arabicText from './cards/arabic_text.json';
import brand from './cards/brand.json';
import dialect from './cards/dialect.json';
import dialogue from './cards/dialogue.json';
import narrative from './cards/narrative.json';
import comedy from './cards/comedy.json';
import performance from './cards/performance.json';
import sound from './cards/sound.json';
import editing from './cards/editing.json';

export const ALL_CARDS: KnowledgeCard[] = [
  ...wardrobe, ...lighting, ...camera, ...places, ...faces, ...era,
  ...heritage, ...social, ...occasions, ...arabicText, ...brand,
  ...dialect, ...dialogue, ...narrative, ...comedy, ...performance,
  ...sound, ...editing,
] as KnowledgeCard[];
