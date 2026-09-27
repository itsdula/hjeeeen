// The board's STYLE LOCK — ported from app/src/lib/storyboardPresets.ts so a
// panel made over MCP renders in the SAME hand-drawn register as the app's own
// panels (graphite / blue / marker / …), never photoreal. Without this, an
// MCP-made panel comes out as a photo and overwrites the sketch board — the
// exact corruption we are fixing. Keep the id/styleLock strings in sync with
// the app file if presets change there.

interface Preset { id: string; styleLock: string; negatives: string }

const MONO_NEG =
  'color of any kind, cream background, ivory background, warm paper tone, sepia wash, ' +
  'photo-realistic rendering, 3D render, CGI, digital photo, airbrushed gradients, Instagram-flattened look, ' +
  'AI-generated sheen, vector art, typeset printed labels';
const COLOR_NEG =
  'photo-realistic rendering, 3D render, CGI, photograph, airbrushed plastic skin, Instagram-flattened look, ' +
  'AI-generated sheen, vector art, typeset printed labels';

const PRESETS: Preset[] = [
  { id: 'graphite', styleLock: 'Hand-drawn professional feature-film storyboard panel, graphite pencil on PURE WHITE paper. Cross-hatching and parallel-line hatching for shading, layered pencil weights 2B–6B, monochrome only. Black ink for the panel border, labels, and bold camera-move arrows. The crisp page of a feature-film board artist.', negatives: MONO_NEG },
  { id: 'blue', styleLock: 'Animation rough storyboard in NON-PHOTO BLUE col-erase pencil on white paper — the industry rough-board look. Loose confident blue-pencil construction lines, light blue tonal hatching, occasional red-pencil accents for emphasis. Gestural, energetic, clearly a rough animation board, not a finished drawing.', negatives: 'full colour palette, photo-realistic rendering, 3D render, CGI, photograph, airbrushed gradients, AI sheen, typeset labels' },
  { id: 'marker', styleLock: 'Advertising/commercial storyboard rendered in GREY markers (Copic/ProMarker), the agency board-room standard. Clean ink line over layered warm-and-cool grey marker tones, confident flat fills, soft streak texture of marker on marker paper, a few white-gel highlights. Monochrome grey, professional and quick.', negatives: 'full saturated colour, photo-realistic rendering, 3D render, CGI, photograph, AI sheen, typeset printed labels' },
  { id: 'ink', styleLock: 'Clean black-ink storyboard line art on white — high-clarity clear-line drawing. Confident uniform-weight ink contours, minimal hatching only where shadow is essential, lots of white space. Reads instantly, like a clear-line bande-dessinée panel in monochrome.', negatives: MONO_NEG + ', pencil texture, marker bleed, watercolor' },
  { id: 'charcoal', styleLock: 'Dramatic charcoal-and-conté storyboard on toned white — heavy chiaroscuro, deep velvety blacks, smudged tonal masses, bold light-and-shadow blocking. Film-noir mood-board register; expressive, smoky, high-contrast monochrome.', negatives: MONO_NEG + ', clean thin line art, flat even lighting' },
  { id: 'digital', styleLock: 'Digital storyboard in the Toon Boom Storyboard Pro register — crisp uniform digital ink line with flat grey tonal fills, clean shape blocking, even values. Tidy, modern, production-pipeline board look.', negatives: MONO_NEG + ', pencil grain, paper texture, marker streaks, painterly brushwork' },
  { id: 'colormarker', styleLock: 'Full-COLOUR marker production storyboard — ink line over vibrant Copic-marker colour fills, confident streaky marker texture, white-gel highlights. High-end commercial/film colour board: lively, illustrative, clearly hand-rendered marker art.', negatives: COLOR_NEG + ', flat vector fills, monochrome' },
  { id: 'watercolor', styleLock: 'Watercolour-and-gouache concept/production board in the lineage of classic film concept illustration. Loose washes, soft edges, atmospheric colour, gentle pencil under-drawing showing through. Painterly, evocative, full colour.', negatives: COLOR_NEG + ', hard vector line, flat marker fills, clinical digital line' },
  { id: 'bd', styleLock: 'Franco-Belgian bande-dessinée storyboard panel — clean clear-line black ink contours with flat bright colour fills (ligne claire). Crisp, graphic, comic-album register; confident outlines, simple cel-flat colour, no gradients.', negatives: COLOR_NEG + ', painterly brushwork, photographic shading, heavy gradients' },
  { id: 'previs', styleLock: 'Cinematic greyscale previs concept frame — monochrome digital painting with a photographic value range, soft atmospheric depth, realistic light falloff and lens-like framing, but rendered as a painted greyscale board (not a photo). Moody, filmic, value-driven.', negatives: 'saturated colour, hard cartoon outline, flat marker fills, typeset printed labels, AI sheen' },
];

const CUSTOM_NEG = 'photo-realistic rendering, 3D render, CGI, photograph, airbrushed plastic skin, AI-generated sheen, typeset printed labels';

function resolvePreset(sb: any): Preset {
  const id = String(sb?.presetId || 'graphite');
  if (id === 'custom' || id.startsWith('custom-')) {
    const board = Array.isArray(sb?.customBoards) ? sb.customBoards.find((b: any) => b.id === id) : null;
    const desc = String(board?.note || '').trim();
    return {
      id,
      styleLock: desc
        ? `Hand-drawn storyboard panel in this custom look: ${desc}. Hold this exact medium, line quality, tone and register across every panel of the board.`
        : 'Hand-drawn storyboard panel. Match the board\'s established style-reference exactly — medium, line quality, tone and register — and hold it across every panel.',
      negatives: CUSTOM_NEG,
    };
  }
  return PRESETS.find(p => p.id === id) ?? PRESETS[0];
}

/** Wrap a bare shot prompt with the board's style lock + negatives so the panel
 *  matches the board (sketch/marker/etc.), not a photo. Mirrors the app's
 *  buildPanelPrompt styleBlock. */
export function applyBoardStyle(prompt: string, sb: any): string {
  const p = resolvePreset(sb);
  const note = String(sb?.styleNote || '').trim();
  const parts = [
    prompt.trim(),
    '',
    `Style lock: ${p.styleLock}`,
  ];
  if (note) parts.push(`Additional board-style note: ${note}`);
  parts.push('', `Absolutely avoid: ${p.negatives}.`);
  return parts.join('\n');
}
