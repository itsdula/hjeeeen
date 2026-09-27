import { useStore, type ActiveView } from '../store';
import { inkOf } from './ProductHub';

/**
 * The "App" hub — a sibling of the Studio product hub, reached from the "App"
 * link in the top bar. Where Studio lists the creative products of the film
 * pipeline, App lists STANDALONE internal tools that live beside the studio —
 * each its own program, opened full-bleed.
 *
 * It deliberately reuses the Studio hub's tile system verbatim (`.hub`,
 * `.hub-bar`, `.hub-tiles`, `.hub-tile`) so it inherits every theme treatment
 * for free — Classic/Pro appearance, the `[data-hub-tiles]` colouring modes
 * (identity / industrial / faint), and the ink-on-substrate law. Adding a
 * future program is one entry in APP_PROGRAMS; the grid grows itself.
 *
 * House vocabulary: tools MAKE and FRAME — never "generate".
 */

/** The App tiles share the Studio tiles' MARKUP, so they pick up the same
 *  hand-drawn doodle rule — but deliberately NOT the `.studio-sorbet` scope.
 *  That skin forces ink-black copy onto every tile ("ink-black on ALL candy"),
 *  which is right for candy and wrong for these two dark teal tiles: the names
 *  would drop to ~3:1 contrast. So the drawing is shared and the skin is not;
 *  the doodle rule lives outside the scope in studio-sorbet.css for exactly
 *  this reason, and the ink inverts on light-ink tiles. */
export interface AppProgram {
  /** Stable key + the ActiveView the tile opens. */
  view: ActiveView;
  name: string;
  /** One-line promise shown on the tile. */
  tagline: string;
  /** Brand-token hex used as the tile substrate (same pattern as ProductHub). */
  accent: string;
  /** Filename slug in src/assets/studio-doodles — the hand-drawn set. */
  doodle: string;
  /** Fallback only: used if the drawing is ever missing. */
  glyph: JSX.Element;
}

/** Bundled like the Studio set — fingerprinted into the build, no runtime fetch. */
const DOODLES = import.meta.glob('../assets/studio-doodles/*.png', {
  eager: true, import: 'default',
}) as Record<string, string>;
const doodleUrl = (slug: string): string | undefined => DOODLES[`../assets/studio-doodles/${slug}.png`];

// The App programs. Cuts Engine is the first; drop another entry here and the
// grid expands with no further wiring (the view must exist in ActiveView).
export const APP_PROGRAMS: AppProgram[] = [
  {
    view: 'idea',
    name: 'IDEA',
    tagline: 'Brief in · three Saudi routes out · every line judged',
    accent: '#E5AAD8',
    doodle: 'creative-mind',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 4h8M6 8h12M5 12h7M5 16h10M5 20h6" />
        <path d="M17.5 13.5l1 2.1 2.2.9-2.2.9-1 2.1-1-2.1-2.2-.9 2.2-.9z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    view: 'cuts',
    name: 'Cuts Engine',
    tagline: 'Find every cut · lift the frame that carries the shot',
    accent: '#2E7C9E',
    doodle: 'cuts',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="2.6" />
        <circle cx="6" cy="18" r="2.6" />
        <path d="M8.2 7.6L20 16M8.2 16.4L20 8" />
        <path d="M11.5 12l2.4-1.7" />
      </svg>
    ),
  },
  {
    view: 'eye',
    name: 'The Eye',
    tagline: 'Read one frame on ten axes · grade every one',
    accent: '#4A6B8A',
    doodle: 'the-eye',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
        <circle cx="12" cy="12" r="3.1" />
      </svg>
    ),
  },
];

export function AppHub() {
  const setActiveView = useStore(s => s.setActiveView);
  const count = APP_PROGRAMS.length;

  return (
    <div className="hub app-hub">
      <div className="hub-bar">
        <div className="hub-bar__head">
          <h2 className="hub-bar__title">App</h2>
          <span className="hub-bar__lead mono-label selectable">
            Standalone tools, built into HJEN · {count} available
          </span>
        </div>
      </div>

      {count === 0 ? (
        <div className="hub-empty">
          <span className="hub-empty__title">No tools yet</span>
          <span className="hub-empty__meta selectable">
            Standalone tools land here as they ship.
          </span>
        </div>
      ) : (
        <div className="hub-tiles">
          {APP_PROGRAMS.map(p => {
            const ink = inkOf(p.accent);
            return (
              <button
                key={p.view}
                className={`hub-tile hub-tile--ink-${ink}`}
                style={{ background: p.accent, ['--hub-tile-accent' as any]: p.accent }}
                onClick={() => setActiveView(p.view)}
              >
                <span className="hub-tile__name">{p.name}</span>
                <span className="hub-tile__desc">{p.tagline}</span>
                {doodleUrl(p.doodle)
                  ? <img className="tile-doodle" src={doodleUrl(p.doodle)} alt="" aria-hidden="true" draggable={false} />
                  : <span className="hub-tile__glyph">{p.glyph}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
