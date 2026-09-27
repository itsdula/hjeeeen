// RefBoard — the three-state reference board, extracted from Creative Mind's
// OptionBoard (QuestionScene.tsx) so BOTH surfaces of Context Agents share one
// visual: the impression INPUT options and the output Lock CARDS. It is a pure
// presentational component — it takes the already-hunted frames and renders:
//
//   · frames === undefined  → a quiet shimmer (the hunt is still in flight)
//   · frames.length < 2     → a typographic card (caption + content-word chips)
//   · frames.length >= 2    → a 2×2 collage of real corpus/Frameset frames
//
// Images render through the hjen-file:// protocol via hjenFileUrl — never a raw
// file:// url (house law). This component holds NO recipe: the caller decides
// the query and passes the result in.

import type { BoardFrame } from '../../store/contextAgentsStore';
import { hjenFileUrl } from '../../lib/theme/apply';

export interface RefBoardProps {
  /** The hunted frames. `undefined` = still loading (shimmer). */
  frames: BoardFrame[] | undefined;
  /** Display caption — English is the base, Arabic the smaller translation. */
  en: string;
  ar?: string;
  /** A third, quieter meaning line (impression "when to choose this"). */
  meaning?: string;
  /** Content-word chips shown on the typographic fallback. */
  chips?: string[];
  /** Click handler — when set the whole board is a button (input option). When
   *  omitted the board is a static tile (output Lock evidence). */
  onPick?: () => void;
  /** Extra content rendered under the caption inside the button/tile (e.g. the
   *  Lock card's principle / effect / disabled slots). */
  children?: React.ReactNode;
  /** Marks the option as the currently-picked one (input selection state). */
  selected?: boolean;
  className?: string;
}

export function RefBoard({ frames, en, ar, meaning, chips, onPick, children, selected, className }: RefBoardProps) {
  const interactive = !!onPick;
  const rootClass = [
    'ca-board',
    selected ? 'is-selected' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  const caption = (
    <div className="ca-board__cap">
      <span className="ca-board__en">{en}</span>
      {ar && <span className="ca-board__ar" dir="rtl">{ar}</span>}
      {meaning && <span className="ca-board__meaning" dir="rtl">{meaning}</span>}
    </div>
  );

  // ── loading — undefined means the hunt hasn't landed yet ──
  if (frames === undefined) {
    if (interactive) {
      // NOT disabled, and NOT hidden from the reader. The board is EVIDENCE for
      // a choice, not the choice itself: the caption already says what this
      // option means, and answer() copes with an empty board. Disabling it made
      // every question unanswerable until a live browser hunt returned — so a
      // slow or failed hunt meant MAKE could never enable. The spinner stays,
      // as a sign that pictures are still coming.
      return (
        <button type="button" className={`${rootClass} ca-board--load`} onClick={onPick} aria-pressed={selected}>
          <span className="ca-board__spin" />
          {caption}
        </button>
      );
    }
    return (
      <div className={`${rootClass} ca-board--load`} aria-hidden="true">
        <span className="ca-board__spin" />
        {caption}
        {children}
      </div>
    );
  }

  const shots = frames.slice(0, 4);
  const rich = shots.length >= 2;

  // ── typographic fallback — thin board, degrade to caption + chips ──
  if (!rich) {
    const body = (
      <>
        {caption}
        {chips && chips.length > 0 && (
          <div className="ca-board__chips">
            {chips.slice(0, 4).map(t => <span key={t} className="ca-chip">{t}</span>)}
          </div>
        )}
        {children}
      </>
    );
    return interactive
      ? <button type="button" className={`${rootClass} ca-board--type`} onClick={onPick} aria-pressed={selected}>{body}</button>
      : <div className={`${rootClass} ca-board--type`}>{body}</div>;
  }

  // ── the rich board — a 2×2 Ken-Burns collage ──
  const grid = (
    <>
      <div className="ca-board__grid" data-n={String(Math.min(shots.length, 4))}>
        {shots.map(f => (
          <img key={f.id} src={hjenFileUrl(f.filePath)} alt="" loading="lazy" decoding="async" />
        ))}
      </div>
      <span className="ca-board__scrim" />
      {caption}
      {children}
    </>
  );
  return interactive
    ? <button type="button" className={rootClass} onClick={onPick} aria-pressed={selected}>{grid}</button>
    : <div className={rootClass}>{grid}</div>;
}
