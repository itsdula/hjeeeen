import { useStore } from '../store';

const TITLE_MAX_CHARS = 42;

// Arabic Unicode block + supplements
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export function LeftMeta() {
  const selections = useStore(s => s.selections);
  const activeProject = useStore(s => s.activeProject());

  const title = extractTitleFromPrompt(selections.prompt);

  return (
    <aside className="left-meta">
      <div className="mono-label left-meta__label">{activeProject ? activeProject.name : 'Project'}</div>
      {title && (
        <h1 className="left-meta__title" title={selections.prompt}>
          {title}
        </h1>
      )}
      <div className="left-meta__sub">
        <div className="left-meta__sub-line">
          {selections.movie?.title ?? selections.photographer?.name ?? 'No style anchor'}
        </div>
        <div className="left-meta__sub-line">
          {selections.aspect} · {selections.quality} · {selections.resolution}
        </div>
      </div>
    </aside>
  );
}

function extractTitleFromPrompt(prompt: string): string {
  const t = prompt.trim();
  if (!t) return '';
  const firstBreak = t.split(/[.!?\n,]/)[0].trim();
  let candidate = firstBreak || t;
  // Display-font is Latin-only (Instrument Serif) and breaks on Arabic glyph
  // shaping. For mixed-language prompts, strip the Arabic runs and keep
  // whatever Latin chunks remain. For pure-Arabic prompts the result is
  // empty and the title is hidden — project chip + sub-line still provide
  // enough context.
  if (ARABIC_RE.test(candidate)) {
    candidate = candidate
      .replace(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+/g, ' ')     // strip Arabic runs
      .replace(/\s+/g, ' ')                            // collapse whitespace
      .replace(/[\s—–\-,:;'"]+$/g, '')      // trim trailing punctuation/dashes
      .trim();
  }
  if (candidate.length < 3) return '';
  if (candidate.length <= TITLE_MAX_CHARS) return candidate;
  const cut = candidate.slice(0, TITLE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
}
