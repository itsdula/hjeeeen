import type { StageNumber } from '../../../types/hjen-bridge';

// Eight-stage pipeline canon. Shared by ProjectWorkspace shell, StageNav,
// the Atlas/Wall progress visualisations, and every stage tool that needs
// to display its own name/number.
export const STAGES: ReadonlyArray<{ n: StageNumber; code: string; name: string; subtitle: string }> = [
  { n: 1, code: '01', name: 'Brief', subtitle: 'Restate the intent.' },
  { n: 2, code: '02', name: 'References', subtitle: 'Build the palette-balanced set.' },
  { n: 3, code: '03', name: 'Saudi Recast', subtitle: 'Translate every foreign ref.' },
  { n: 4, code: '04', name: 'Direction', subtitle: 'Turn the signed idea into visual law.' },
  { n: 5, code: '05', name: 'Screenplay', subtitle: 'Master prompts, frame by frame.' },
  { n: 6, code: '06', name: 'Assets', subtitle: 'The book of characters, places, props.' },
  { n: 7, code: '07', name: 'Frames', subtitle: 'Make and refine the deliverable.' },
  { n: 8, code: '08', name: 'Videos', subtitle: 'Motion takes from the approved frames.' },
];

export function stageMeta(n: StageNumber) {
  return STAGES[n - 1];
}
