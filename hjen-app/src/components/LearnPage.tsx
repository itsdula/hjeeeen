import { useMemo, useState } from 'react';
import { LEARN_CONTENT, LEARN_MEDIA_DIR, type LearnPageContent, type LearnGroupContent } from '../lib/learnContent';
import { shortcutGroupsForHelp } from '../lib/node-engine/shortcuts';

/* ────────────────────────────────────────────────────────────────────────
 *  Learn page — the Learn hub UX for HJEN Studio. Chrome (brand ·
 *  Learn/Docs/Tutorials · search with "/" hint · Ask AI), hub (download
 *  cards → category cards → browse-by-topic), docs reader (sectioned
 *  sidebar · lede · inline lesson clips · related pages · prev/next ·
 *  footer). Content + clips come from lib/learnContent.ts.
 * ──────────────────────────────────────────────────────────────────────── */

type Tab = 'hub' | 'docs' | 'tutorials';

// Sidebar sections — "USING … / YOUR WORKSPACE / REFERENCE".
const SECTIONS: Array<{ label: string; groups: string[] }> = [
  { label: 'Using HJEN Studio', groups: ['getting-started', 'canvas', 'generation', 'sets', 'timeline', 'export', 'mcp'] },
  { label: 'Your workspace', groups: ['teams', 'account'] },
  { label: 'Reference', groups: ['shortcuts'] },
];

const byKey = (k: string): LearnGroupContent => LEARN_CONTENT.find(g => g.key === k) ?? LEARN_CONTENT[0];

// Flat page order across every section — drives Previous / Next.
const FLAT: Array<{ group: string; page: string }> = SECTIONS.flatMap(s =>
  s.groups.flatMap(gk => byKey(gk).pages.map(p => ({ group: gk, page: p.key }))),
);

const CARDS: Array<{ tab: Tab; group?: string; title: string; body: string; icon: JSX.Element }> = [
  {
    tab: 'docs', group: 'getting-started', title: 'Docs',
    body: 'Written guides for every part of HJEN Studio — canvas, generation, sets, timeline, and export.',
    icon: <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H12v16H5.5A1.5 1.5 0 0 0 4 21.5z M20 5.5A1.5 1.5 0 0 0 18.5 4H12v16h6.5A1.5 1.5 0 0 1 20 21.5z" />,
  },
  {
    tab: 'tutorials', title: 'Tutorials',
    body: 'Short video lessons that walk through the workflow, from first shot to final cut.',
    icon: <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M10 9l5 3-5 3z" />,
  },
  {
    tab: 'docs', group: 'mcp', title: 'Agent setup',
    body: 'Connect Claude, ChatGPT, Cursor and other assistants to drive HJEN Studio by command.',
    icon: <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z" />,
  },
];

function mediaUrl(file: string): string {
  // No clip directory in this build → no URL, so callers skip the player rather
  // than mounting a <video> pointed at a path that cannot resolve.
  if (!LEARN_MEDIA_DIR) return '';
  return `hjen-file://${encodeURI(`${LEARN_MEDIA_DIR}/${file}`)}`;
}

/* Keyboard shortcuts — sourced straight from the Node view's shortcut registry
 * (lib/node-engine/shortcuts.ts) so this Learn table, the in-app ⌘/ help
 * overlay, and the live key handlers are one and the same and cannot drift. */
const SHORTCUTS = shortcutGroupsForHelp();

export function LearnPage() {
  const [tab, setTab] = useState<Tab>('hub');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string>(LEARN_CONTENT[0].key);
  const [page, setPage] = useState<string>(LEARN_CONTENT[0].pages[0].key);

  const open = (groupKey: string, pageKey?: string) => {
    const g = byKey(groupKey);
    setGroup(g.key);
    setPage(pageKey ?? g.pages[0].key);
    setTab('docs');
    window.scrollTo?.(0, 0);
  };

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const hits: Array<{ group: string; groupTitle: string; page: LearnPageContent }> = [];
    for (const g of LEARN_CONTENT) {
      for (const p of g.pages) {
        const hay = `${p.title} ${p.subtitle} ${p.paragraphs.join(' ')}`.toLowerCase();
        if (hay.includes(q)) hits.push({ group: g.key, groupTitle: g.title, page: p });
      }
    }
    return hits.slice(0, 30);
  }, [search]);

  return (
    <div className="learn-page">
      <header className="learn-nav">
        <div className="learn-nav__brand">
          <button className={`learn-tab ${tab === 'hub' && !search ? 'learn-tab--on' : ''}`} onClick={() => { setTab('hub'); setSearch(''); }}>Learn</button>
          <button className={`learn-tab ${tab === 'docs' && !search ? 'learn-tab--on' : ''}`} onClick={() => { setTab('docs'); setSearch(''); }}>Docs</button>
          <button className={`learn-tab ${tab === 'tutorials' && !search ? 'learn-tab--on' : ''}`} onClick={() => { setTab('tutorials'); setSearch(''); }}>Tutorials</button>
        </div>
        <div className="learn-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input
            placeholder="Search lessons, docs, shortcuts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <span className="learn-search__hint">/</span>
        </div>
        <button className="learn-askai" title="Ask AI (coming soon)">
          <span className="learn-askai__ring" /> Ask AI
        </button>
      </header>

      {search.trim() ? (
        <LearnResults results={results} query={search} onOpen={open} />
      ) : (
        <>
          {tab === 'hub' && <LearnHub onOpen={open} onCard={(t, g) => (t === 'docs' && g ? open(g) : setTab(t))} />}
          {tab === 'docs' && (
            <LearnDocs group={group} page={page} onOpen={open} onPage={setPage} />
          )}
          {tab === 'tutorials' && (
            <LearnComingSoon title="Tutorials" note="Short video lessons will live here. For now, every Docs page carries its own lesson clip." />
          )}
        </>
      )}
    </div>
  );
}

/* ─── Hub ─────────────────────────────────────────────────────────────── */

function LearnHub({ onOpen, onCard }: { onOpen: (g: string) => void; onCard: (t: Tab, g?: string) => void }) {
  return (
    <div className="learn-body">
      <h1 className="learn-hero__title">Learn HJEN Studio</h1>
      <p className="learn-hero__sub">Reference docs and video lessons for shot creation, project organization, and exporting your film.</p>

      {/* Download cards — the block the hub opens with. */}
      <div className="learn-downloads">
        <button className="learn-dl">
          <div className="learn-dl__top">
            <span className="learn-dl__os">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 3c.1 1-.3 2-1 2.7-.6.7-1.7 1.3-2.6 1.2-.1-1 .4-2 1-2.6.7-.7 1.8-1.2 2.6-1.3zM19 17c-.4 1-.6 1.4-1.1 2.2-.8 1.2-1.9 2.6-3.2 2.6-1.2 0-1.5-.8-3.1-.8s-2 .8-3.1.8c-1.4 0-2.4-1.3-3.2-2.4-1.6-2.4-2.9-6.7-1.2-9.6.8-1.4 2.2-2.3 3.7-2.3 1.2 0 2 .8 3 .8s1.6-.8 3-.8c1.3 0 2.6.7 3.5 1.9-3 1.7-2.5 6 .9 7.4z"/></svg>
            </span>
            <svg className="learn-dl__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13" /><path d="M7 12l5 5 5-5" /><path d="M5 21h14" /></svg>
          </div>
          <div className="learn-dl__title">Download for Mac</div>
          <div className="learn-dl__meta">.dmg · Apple silicon</div>
        </button>
        <button className="learn-dl">
          <div className="learn-dl__top">
            <span className="learn-dl__os">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.5l8-1.1v7.2H3zM12 4.3l9-1.3v8.6h-9zM3 12.4h8v7.2l-8-1.1zM12 12.4h9v8.6l-9-1.3z"/></svg>
            </span>
            <svg className="learn-dl__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13" /><path d="M7 12l5 5 5-5" /><path d="M5 21h14" /></svg>
          </div>
          <div className="learn-dl__title">Download for Windows</div>
          <div className="learn-dl__meta">.exe · x64</div>
        </button>
      </div>

      <div className="learn-divider" />

      <div className="learn-cards">
        {CARDS.map((c, i) => (
          <button key={i} className="learn-card" onClick={() => onCard(c.tab, c.group)}>
            <div className="learn-card__top">
              <span className="learn-card__icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{c.icon}</svg>
              </span>
              <svg className="learn-card__arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>
            </div>
            <div className="learn-card__title">{c.title}</div>
            <p className="learn-card__body">{c.body}</p>
          </button>
        ))}
      </div>

      <div className="learn-browse__label mono-label">Browse by topic</div>
      <div className="learn-topics">
        {LEARN_CONTENT.filter(g => g.key !== 'shortcuts').map(g => (
          <button key={g.key} className="learn-topic" onClick={() => onOpen(g.key)}>
            <span className="learn-topic__title">{g.title}</span>
            <span className="learn-topic__count">{g.pages.length} {g.pages.length === 1 ? 'page' : 'pages'}</span>
          </button>
        ))}
      </div>

      <div className="learn-foot">© 2026 HJEN</div>
    </div>
  );
}

/* ─── Search results ──────────────────────────────────────────────────── */

function LearnResults({ results, query, onOpen }: {
  results: Array<{ group: string; groupTitle: string; page: LearnPageContent }>;
  query: string;
  onOpen: (g: string, p: string) => void;
}) {
  return (
    <div className="learn-body">
      <div className="learn-browse__label mono-label">
        {results.length} result{results.length === 1 ? '' : 's'} for “{query.trim()}”
      </div>
      <div className="learn-results">
        {results.map(r => (
          <button key={`${r.group}/${r.page.key}`} className="learn-result" onClick={() => onOpen(r.group, r.page.key)}>
            <div className="learn-result__crumb mono-label">{r.groupTitle}</div>
            <div className="learn-result__title">{r.page.title}</div>
            <div className="learn-result__sub">{r.page.subtitle}</div>
          </button>
        ))}
        {results.length === 0 && <div className="learn-docs__stub learn-docs__stub--wide">No matches.</div>}
      </div>
    </div>
  );
}

/* ─── Docs reader ─────────────────────────────────────────────────────── */

function LearnDocs({ group, page, onOpen, onPage }: {
  group: string; page: string;
  onOpen: (g: string, p?: string) => void; onPage: (p: string) => void;
}) {
  const g = byKey(group);
  const p = g.pages.find(x => x.key === page) ?? g.pages[0];

  // Interleave: intro paragraph, first clip, rest of the body, remaining clips.
  const blocks: Array<{ t: 'p' | 'v'; v: string; k: string }> = [];
  p.paragraphs.forEach((para, i) => {
    blocks.push({ t: 'p', v: para, k: `p${i}` });
    if (i === 0 && p.videos[0]) blocks.push({ t: 'v', v: p.videos[0], k: `v0` });
  });
  p.videos.slice(1).forEach((vid, i) => blocks.push({ t: 'v', v: vid, k: `v${i + 1}` }));
  if (p.paragraphs.length === 0) p.videos.forEach((vid, i) => blocks.push({ t: 'v', v: vid, k: `vo${i}` }));

  const related = g.pages.filter(x => x.key !== p.key).slice(0, 4);
  const flatIdx = FLAT.findIndex(f => f.group === group && f.page === page);
  const prev = flatIdx > 0 ? FLAT[flatIdx - 1] : null;
  const next = flatIdx >= 0 && flatIdx < FLAT.length - 1 ? FLAT[flatIdx + 1] : null;
  const label = (f: { group: string; page: string }) => byKey(f.group).pages.find(x => x.key === f.page)?.title ?? '';

  return (
    <div className="learn-docs">
      <aside className="learn-docs__side">
        {SECTIONS.map(sec => (
          <div key={sec.label} className="learn-docs__section">
            <div className="learn-docs__seclabel mono-label">{sec.label}</div>
            {sec.groups.map(gk => {
              const grp = byKey(gk);
              const single = grp.pages.length === 1;
              const activeGroup = grp.key === group;
              return (
                <div key={gk} className="learn-docs__group">
                  <button
                    className={`learn-docs__grouphead ${activeGroup ? 'learn-docs__grouphead--on' : ''} ${single && activeGroup ? 'learn-docs__grouphead--leaf' : ''}`}
                    onClick={() => (single ? onOpen(gk, grp.pages[0].key) : onOpen(gk))}
                  >{grp.title}</button>
                  {activeGroup && !single && (
                    <div className="learn-docs__pages">
                      {grp.pages.map(pg => (
                        <button
                          key={pg.key}
                          className={`learn-docs__page ${pg.key === page ? 'learn-docs__page--on' : ''}`}
                          onClick={() => onPage(pg.key)}
                        >{pg.title}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </aside>

      <main className="learn-docs__main">
        {group === 'shortcuts' ? (
          <ShortcutsView />
        ) : (
        <>
        <h1 className="learn-docs__title">{p.title}</h1>
        {p.subtitle && <p className="learn-docs__lede">{p.subtitle}</p>}

        {blocks.map(b => {
          if (b.t === 'p') return <p key={b.k} className="learn-docs__p">{b.v}</p>;
          // A build with no clip directory drops the player entirely — a <video>
          // with an unresolvable src is a black box with a broken control strip,
          // which reads as a bug rather than as "this lesson is text only".
          const src = mediaUrl(b.v);
          if (!src) return null;
          return <video key={b.k} className="learn-docs__video" src={src} controls loop muted playsInline preload="metadata" />;
        })}

        {related.length > 0 && (
          <>
            <div className="learn-docs__related-label">Related pages</div>
            <div className="learn-docs__related">
              {related.map(r => (
                <button key={r.key} className="learn-docs__chip" onClick={() => onPage(r.key)}>{r.title}</button>
              ))}
            </div>
          </>
        )}

        <div className="learn-docs__nav">
          {prev
            ? <button className="learn-docs__navbtn learn-docs__navbtn--prev" onClick={() => onOpen(prev.group, prev.page)}>
                <span className="learn-docs__navdir mono-label">Previous</span>
                <span className="learn-docs__navname">{label(prev)}</span>
              </button>
            : <span />}
          {next
            ? <button className="learn-docs__navbtn learn-docs__navbtn--next" onClick={() => onOpen(next.group, next.page)}>
                <span className="learn-docs__navdir mono-label">Next</span>
                <span className="learn-docs__navname">{label(next)}</span>
              </button>
            : <span />}
        </div>
        </>
        )}

        <div className="learn-foot learn-foot--docs">© 2026 HJEN</div>
      </main>
    </div>
  );
}

function ShortcutsView() {
  return (
    <>
      <h1 className="learn-docs__title">Keyboard Shortcuts</h1>
      <p className="learn-docs__lede">Use these shortcuts to move faster on the canvas. They are grouped by the work they support.</p>

      {SHORTCUTS.map(sec => (
        <section key={sec.label} className="kbd-sec">
          <div className="kbd-sec__label mono-label">{sec.label}</div>
          <div className="kbd-table">
            {sec.items.map(sc => (
              <div key={sc.name} className="kbd-row">
                <span className="kbd-row__name">{sc.name}</span>
                <span className="kbd-row__keys">
                  {sc.chords.map((chord, ci) => (
                    <span key={ci} className="kbd-chord">
                      {ci > 0 && <span className="kbd-slash">/</span>}
                      {chord.map((k, ki) => (
                        k === '–'
                          ? <span key={ki} className="kbd-range">–</span>
                          : <kbd key={ki} className="kbd">{k}</kbd>
                      ))}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function LearnComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div className="learn-body">
      <h1 className="learn-hero__title">{title}</h1>
      <p className="learn-hero__sub">{note}</p>
    </div>
  );
}
