// Parse a five-segment Gem file (a job_<slug>.md or a dna/<slug>.gem.md) into a
// header + the five named blocks. Robust to BOTH authoring styles found in the
// factory: job files use paired <role>…</role> tags (with a nested <constraints>
// inside <examples>); the DNA sample uses opening tags only, each section running
// to the next tag or EOF. We anchor on the FIRST line-start opening of each of the
// five canonical sections, slice to the next section boundary, and strip any bare
// structural tag lines from the content. Nike-agnostic.

export type GemSegKey = 'role' | 'context' | 'instructions' | 'constraints' | 'examples';
export const GEM_SEG_ORDER: GemSegKey[] = ['role', 'context', 'instructions', 'constraints', 'examples'];

export interface Gem {
  header: string;                             // everything before <role>
  segments: Record<GemSegKey, string>;
}

const OPEN = (k: GemSegKey) => new RegExp(`^<${k}>\\s*$`);
const BARE_TAG = /^<\/?(role|context|instructions|constraints|examples)>\s*$/;

export function parseGem(raw: string): Gem {
  const lines = (raw || '').replace(/\r\n/g, '\n').split('\n');

  // first line-start opening index for each canonical section
  const starts: Record<GemSegKey, number> = {
    role: -1, context: -1, instructions: -1, constraints: -1, examples: -1,
  };
  for (const k of GEM_SEG_ORDER) {
    const re = OPEN(k);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) { starts[k] = i; break; }
    }
  }

  const firstTag = GEM_SEG_ORDER
    .map(k => starts[k])
    .filter(i => i >= 0)
    .reduce((m, i) => (m < 0 ? i : Math.min(m, i)), -1);

  const header = (firstTag < 0 ? lines : lines.slice(0, firstTag)).join('\n').trim();

  // every start index, sorted — a section ends at the next start after it
  const bounds = GEM_SEG_ORDER
    .map(k => starts[k])
    .filter(i => i >= 0)
    .sort((a, b) => a - b);

  const clean = (from: number): string => {
    const nextBound = bounds.find(b => b > from);
    const slice = lines.slice(from + 1, nextBound === undefined ? lines.length : nextBound);
    return slice.filter(l => !BARE_TAG.test(l)).join('\n').trim();
  };

  const segments = {} as Record<GemSegKey, string>;
  for (const k of GEM_SEG_ORDER) {
    segments[k] = starts[k] >= 0 ? clean(starts[k]) : '';
  }
  return { header, segments };
}

export function gemWordCount(text: string): number {
  return (text || '').split(/\s+/).filter(Boolean).length;
}
