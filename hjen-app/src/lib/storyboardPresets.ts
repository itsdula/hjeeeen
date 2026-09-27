// Ten globally-recognized storyboard / production-board looks. Each preset
// supplies the positive style lock + the matching negative list (color presets
// must NOT forbid colour). The selected preset replaces the default style lock
// in every panel + asset prompt so the whole board stays in one register.

export interface StoryboardPreset {
  id: string;
  label: string;
  note: string;       // one-line, shown under the chip
  styleLock: string;  // positive description appended to every prompt
  negatives: string;  // hard-exclusion list for this look
}

const MONO_NEG =
  'color of any kind, cream background, ivory background, warm paper tone, sepia wash, ' +
  'photo-realistic rendering, 3D render, CGI, digital photo, airbrushed gradients, Instagram-flattened look, ' +
  'AI-generated sheen, vector art, typeset printed labels';

const COLOR_NEG =
  'photo-realistic rendering, 3D render, CGI, photograph, airbrushed plastic skin, Instagram-flattened look, ' +
  'AI-generated sheen, vector art, typeset printed labels';

export const STORYBOARD_PRESETS: StoryboardPreset[] = [
  {
    id: 'graphite',
    label: 'Graphite Pencil',
    note: 'Classic feature-film board, soft pencil on white',
    styleLock:
      'Hand-drawn professional feature-film storyboard panel, graphite pencil on PURE WHITE paper. ' +
      'Cross-hatching and parallel-line hatching for shading, layered pencil weights 2B–6B, monochrome only. ' +
      'Black ink for the panel border, labels, and bold camera-move arrows. The crisp page of a feature-film board artist.',
    negatives: MONO_NEG,
  },
  {
    id: 'blue',
    label: 'Non-Photo Blue',
    note: 'Animation rough boards, col-erase blue pencil',
    styleLock:
      'Animation rough storyboard in NON-PHOTO BLUE col-erase pencil on white paper — the industry rough-board look. ' +
      'Loose confident blue-pencil construction lines, light blue tonal hatching, occasional red-pencil accents for emphasis. ' +
      'Gestural, energetic, clearly a rough animation board, not a finished drawing.',
    negatives:
      'full colour palette, photo-realistic rendering, 3D render, CGI, photograph, airbrushed gradients, AI sheen, typeset labels',
  },
  {
    id: 'marker',
    label: 'Grey Marker',
    note: 'Agency commercial boards, Copic grey tones',
    styleLock:
      'Advertising/commercial storyboard rendered in GREY markers (Copic/ProMarker), the agency board-room standard. ' +
      'Clean ink line over layered warm-and-cool grey marker tones, confident flat fills, soft streak texture of marker on marker paper, ' +
      'a few white-gel highlights. Monochrome grey, professional and quick.',
    negatives:
      'full saturated colour, photo-realistic rendering, 3D render, CGI, photograph, AI sheen, typeset printed labels',
  },
  {
    id: 'ink',
    label: 'Clean Ink Line',
    note: 'High-clarity black ink line art',
    styleLock:
      'Clean black-ink storyboard line art on white — high-clarity clear-line drawing. Confident uniform-weight ink contours, ' +
      'minimal hatching only where shadow is essential, lots of white space. Reads instantly, like a clear-line bande-dessinée panel in monochrome.',
    negatives: MONO_NEG + ', pencil texture, marker bleed, watercolor',
  },
  {
    id: 'charcoal',
    label: 'Charcoal Noir',
    note: 'Dramatic chiaroscuro, conté + charcoal',
    styleLock:
      'Dramatic charcoal-and-conté storyboard on toned white — heavy chiaroscuro, deep velvety blacks, smudged tonal masses, ' +
      'bold light-and-shadow blocking. Film-noir mood-board register; expressive, smoky, high-contrast monochrome.',
    negatives: MONO_NEG + ', clean thin line art, flat even lighting',
  },
  {
    id: 'digital',
    label: 'Storyboard Pro',
    note: 'Clean digital line + flat greys (Toon Boom)',
    styleLock:
      'Digital storyboard in the Toon Boom Storyboard Pro register — crisp uniform digital ink line with flat grey tonal fills, ' +
      'clean shape blocking, even values. Tidy, modern, production-pipeline board look.',
    negatives: MONO_NEG + ', pencil grain, paper texture, marker streaks, painterly brushwork',
  },
  {
    id: 'colormarker',
    label: 'Colour Marker',
    note: 'Full-colour marker production board',
    styleLock:
      'Full-COLOUR marker production storyboard — ink line over vibrant Copic-marker colour fills, confident streaky marker texture, ' +
      'white-gel highlights. High-end commercial/film colour board: lively, illustrative, clearly hand-rendered marker art.',
    negatives: COLOR_NEG + ', flat vector fills, monochrome',
  },
  {
    id: 'watercolor',
    label: 'Watercolour Concept',
    note: 'Loose painted production board (McQuarrie-style)',
    styleLock:
      'Watercolour-and-gouache concept/production board in the lineage of classic film concept illustration (à la Ralph McQuarrie). ' +
      'Loose washes, soft edges, atmospheric colour, gentle pencil under-drawing showing through. Painterly, evocative, full colour.',
    negatives: COLOR_NEG + ', hard vector line, flat marker fills, clinical digital line',
  },
  {
    id: 'bd',
    label: 'Comic / BD',
    note: 'Clear-line ink + flat colour panel',
    styleLock:
      'Franco-Belgian bande-dessinée storyboard panel — clean clear-line black ink contours with flat bright colour fills (ligne claire). ' +
      'Crisp, graphic, comic-album register; confident outlines, simple cel-flat colour, no gradients.',
    negatives: COLOR_NEG + ', painterly brushwork, photographic shading, heavy gradients',
  },
  {
    id: 'previs',
    label: 'Cinematic Greyscale',
    note: 'Monochrome digital painting (previs concept)',
    styleLock:
      'Cinematic greyscale previs concept frame — monochrome digital painting with a photographic value range, ' +
      'soft atmospheric depth, realistic light falloff and lens-like framing, but rendered as a painted greyscale board (not a photo). ' +
      'Moody, filmic, value-driven.',
    negatives:
      'saturated colour, hard cartoon outline, flat marker fills, typeset printed labels, AI sheen',
  },
];

export function presetById(id?: string): StoryboardPreset {
  return STORYBOARD_PRESETS.find(p => p.id === id) ?? STORYBOARD_PRESETS[0];
}

// The user's own board looks — not the ten bundled presets. Each is driven by
// one or more uploaded style references and/or a free-text description. The
// styleLock is built from that description (or leans on the supplied reference
// image(s) when no description is given).
import type { CustomBoard } from '../types/storyboard';

export const CUSTOM_LOOK_ID = 'custom';                 // the first custom board id
export function isCustomLookId(id?: string): boolean {
  return id === CUSTOM_LOOK_ID || (!!id && id.startsWith('custom-'));
}
/** Next free custom board id given the existing ones ('custom', 'custom-2', …). */
export function nextCustomBoardId(boards: CustomBoard[]): string {
  if (!boards.some(b => b.id === CUSTOM_LOOK_ID)) return CUSTOM_LOOK_ID;
  let n = 2;
  while (boards.some(b => b.id === `custom-${n}`)) n++;
  return `custom-${n}`;
}

export function customLook(board?: CustomBoard): StoryboardPreset {
  const desc = (board?.note ?? '').trim();
  return {
    id: board?.id ?? CUSTOM_LOOK_ID,
    label: (board?.name ?? '').trim() || 'Custom look',
    note: desc || 'Your own reference or description',
    styleLock: desc
      ? `Hand-drawn storyboard panel in this custom look: ${desc}. Hold this exact medium, line quality, tone and register across every panel of the board.`
      : 'Hand-drawn storyboard panel. Match the supplied style-reference image(s) exactly — their medium, line quality, tone and register — and hold it across every panel of the board.',
    negatives:
      'photo-realistic rendering, 3D render, CGI, photograph, airbrushed plastic skin, AI-generated sheen, typeset printed labels',
  };
}

/** Resolve the active look — a bundled preset, or one of the user's custom boards. */
export function resolvePreset(id?: string, boards?: CustomBoard[]): StoryboardPreset {
  if (isCustomLookId(id)) return customLook(boards?.find(b => b.id === id) ?? { id: id! });
  return presetById(id);
}
