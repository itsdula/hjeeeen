import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { PRODUCTS, GLYPH, openStudioProduct, type ProductId } from './ProductHub';
import { APP_PROGRAMS } from './AppHub';

/**
 * ⌘K COMMAND PALETTE — the single keyboard entry point to every corner of HJEN.
 *
 * One overlay, mounted once at the App root, reachable from any view. It sources
 * its items from the SAME registries the rest of the app uses (the ProductHub
 * PRODUCTS list for tools, the store's real navigation actions for everything
 * else) so it can never drift from what the tiles and top-nav actually do.
 *
 *   ⌘K / Ctrl+K  toggle       ↑ ↓  move       Enter  run       Esc  close
 *
 * Roadmap ('soon') tools are listed but greyed and non-selectable, so the
 * palette is an honest map of the whole program — present and future.
 */

type Section = 'Tools' | 'Navigate' | 'Actions';
const SECTION_ORDER: Section[] = ['Tools', 'Navigate', 'Actions'];

interface CmdItem {
  id: string;
  section: Section;
  label: string;
  /** Dim second line — a one-liner on what the item is. */
  subtitle?: string;
  icon: JSX.Element;
  /** Extra searchable text (synonyms) not shown in the row. */
  keywords?: string;
  /** Listed but not runnable (roadmap tools). */
  disabled?: boolean;
  run: () => void;
}

/* ── small inline glyphs for Navigate / Actions rows ───────────────────── */
const I = (d: string, fill = false) => (
  <svg viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const NAV_ICON: Record<string, JSX.Element> = {
  studio: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M3 9h18" /><path d="M8 21h8" /><path d="M12 18v3" /></svg>,
  apphub: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.6" /><rect x="3" y="14" width="7" height="7" rx="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.6" /></svg>,
  projects: I('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  library: I('M4 5h5a2 2 0 0 1 2 2v12a1.5 1.5 0 0 0-1.5-1.5H4z M20 5h-5a2 2 0 0 0-2 2v12a1.5 1.5 0 0 1 1.5-1.5H20z'),
  learn: I('M12 3 2 8l10 5 10-5z M6 10.5V16c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5.5'),
  support: I('M21 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z'),
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 14a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.1-2.7l-.1-.1A2 2 0 1 1 8.3 4.6l.1.1A1.6 1.6 0 0 0 10 5.4h.1A1.6 1.6 0 0 0 11 3.9V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5.9z" /></svg>,
};
const ACT_ICON: Record<string, JSX.Element> = {
  newProject: I('M12 5v14M5 12h14'),
  switchProject: I('M8 3v4M16 3v4M4 8h16 M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  mcp: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4" /></svg>,
  newTab: I('M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z M12 9v6M9 12h6'),
};

/* ── literal match — a plain case-insensitive substring, no fuzzy gaps ──────
   Returns a score (higher = better) or null when the query is not literally
   present. A hit inside the LABEL always outranks a hit found only in the
   subtitle/keywords, and an earlier hit outranks a later one, so results feel
   precise and predictable: what you type is what you see. */
function literalMatch(query: string, label: string, extra: string): number | null {
  const q = query.toLowerCase().trim();
  if (!q) return 0; // empty query → everything passes (used by the "all" list)
  const inLabel = label.toLowerCase().indexOf(q);
  if (inLabel >= 0) return 2000 - inLabel;      // label hits float to the top
  const inExtra = extra.toLowerCase().indexOf(q);
  return inExtra >= 0 ? 1000 - inExtra : null;  // subtitle / keyword hits below
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // The full list is opt-in: it appears only when the user is typing a query
  // or has toggled "all" on. On a bare open, the palette is just the search box.
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Live store actions — the SAME functions the top-nav and tiles call.
  const setActiveView = useStore(s => s.setActiveView);
  const openPicker = useStore(s => s.openPicker);
  const toggleMcpDock = useStore(s => s.toggleMcpDock);
  const newTab = useStore(s => s.newTab);

  // Global ⌘K / Ctrl+K toggle — one listener, from every view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Fresh every open: bare search box — clear the query, collapse the list,
  // reset the highlight, focus the input.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setShowAll(false);
    setActive(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const close = () => setOpen(false);

  // ── the full item set, sourced from the real registries ──────────────
  const allItems = useMemo<CmdItem[]>(() => {
    const tools: CmdItem[] = PRODUCTS.map(p => ({
      id: `tool:${p.id}`,
      section: 'Tools',
      label: p.name,
      subtitle: p.tagline,
      icon: GLYPH[p.id as ProductId] ?? NAV_ICON.studio,
      // NB: the marketing description is deliberately NOT used as search text.
      // It's prose full of the house word "frame" (and "make", "studio"…), so a
      // literal substring match on it would surface the whole Tools list for a
      // one-word query. A command palette matches on name + tagline, not prose.
      disabled: p.status === 'soon',
      run: () => { openStudioProduct(p.id); },
    }));

    const standalone: CmdItem[] = APP_PROGRAMS.map(p => ({
      id: `app:${p.view}`,
      section: 'Tools',
      label: p.name,
      subtitle: p.tagline,
      icon: p.glyph,
      keywords: 'standalone app program',
      run: () => setActiveView(p.view),
    }));

    const navigate: CmdItem[] = [
      { id: 'nav:studio', section: 'Navigate', label: 'Studio', subtitle: 'The tool hub', icon: NAV_ICON.studio, keywords: 'hub home apps products', run: () => setActiveView('studio') },
      { id: 'nav:apphub', section: 'Navigate', label: 'App', subtitle: 'Standalone tools', icon: NAV_ICON.apphub, keywords: 'apphub cuts standalone', run: () => setActiveView('apphub') },
      { id: 'nav:projects', section: 'Navigate', label: 'Projects', subtitle: 'Every project workspace', icon: NAV_ICON.projects, keywords: 'files workspace list', run: () => setActiveView('projects') },
      { id: 'nav:library', section: 'Navigate', label: 'Library', subtitle: 'Shared reference assets', icon: NAV_ICON.library, keywords: 'assets references media', run: () => setActiveView('library') },
      { id: 'nav:learn', section: 'Navigate', label: 'Learn', subtitle: 'Guides & tutorials', icon: NAV_ICON.learn, keywords: 'help docs tutorial guide', run: () => setActiveView('learn') },
      { id: 'nav:support', section: 'Navigate', label: 'Support', subtitle: 'Report a bug or request', icon: NAV_ICON.support, keywords: 'help ticket feedback bug', run: () => setActiveView('support') },
      { id: 'nav:settings', section: 'Navigate', label: 'Settings', subtitle: 'Appearance, themes & more', icon: NAV_ICON.settings, keywords: 'appearance theme preferences config options', run: () => setActiveView('settings') },
    ];

    const actions: CmdItem[] = [
      { id: 'act:new-project', section: 'Actions', label: 'New project', subtitle: 'Start a fresh project', icon: ACT_ICON.newProject, keywords: 'create add project', run: () => setActiveView('projects') },
      { id: 'act:switch-project', section: 'Actions', label: 'Switch project', subtitle: 'Open the project switcher', icon: ACT_ICON.switchProject, keywords: 'change select open project', run: () => openPicker('projects') },
      { id: 'act:mcp', section: 'Actions', label: 'MCP Assistant', subtitle: 'Toggle the Assistant drawer', icon: ACT_ICON.mcp, keywords: 'agent assistant chat drawer mcp', run: () => toggleMcpDock() },
      { id: 'act:new-tab', section: 'Actions', label: 'New tab', subtitle: 'Open a fresh workspace tab', icon: ACT_ICON.newTab, keywords: 'tab window open', run: () => newTab() },
    ];

    return [...tools, ...standalone, ...navigate, ...actions];
  }, [setActiveView, openPicker, toggleMcpDock, newTab]);

  // ── filter + rank ────────────────────────────────────────────────────
  // Empty query → grouped Tools · Navigate · Actions in registry order. With a
  // query → keep only items whose text LITERALLY contains what was typed
  // (case-insensitive substring — no fuzzy gap-matching), ranked best-first
  // within each section, with the section holding the strongest hit floated to
  // the top, so the closest result is always the first (highlighted) row.
  const groups = useMemo(() => {
    const q = query.trim();
    const scored = allItems
      .map((it, i) => ({ it, i, score: literalMatch(query, it.label, `${it.subtitle ?? ''} ${it.keywords ?? ''}`) }))
      .filter(x => x.score !== null);
    const bySection = SECTION_ORDER
      .map(section => {
        const rows = scored.filter(x => x.it.section === section);
        if (q) rows.sort((a, b) => (b.score! - a.score!) || (a.i - b.i));
        const top = rows.reduce((m, x) => Math.max(m, x.score!), -1);
        return { section, items: rows.map(x => x.it), top };
      })
      .filter(g => g.items.length > 0);
    if (q) bySection.sort((a, b) => b.top - a.top);
    return bySection.map(({ section, items }) => ({ section, items }));
  }, [allItems, query]);

  // Flat list of the SELECTABLE (non-disabled) items, in render order — the
  // highlight + Enter run over this; disabled roadmap rows are skipped.
  const selectable = useMemo(
    () => groups.flatMap(g => g.items).filter(it => !it.disabled),
    [groups],
  );

  // Keep the highlight in range whenever the result set changes.
  useEffect(() => {
    setActive(a => (selectable.length === 0 ? 0 : Math.min(a, selectable.length - 1)));
  }, [selectable.length]);

  // Scroll the highlighted row into view as it moves.
  useLayoutEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-sel="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open, groups]);

  // The list is revealed only when the user is typing OR has opted into "all".
  // Everything below (groups/selectable) is still computed — the list just
  // isn't drawn — so nav + Enter must stay gated behind this flag.
  const hasQuery = query.trim().length > 0;
  const showList = showAll || hasQuery;

  const runIndex = (i: number) => {
    const it = selectable[i];
    if (!it) return;
    close();
    it.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    // Bare box: don't launch anything on Enter; ↓ reveals the full list.
    if (!showList) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setShowAll(true); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(0, selectable.length - 1))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); runIndex(active); }
  };

  if (!open) return null;

  // Running counter so each selectable row knows its flat index for nav/scroll.
  let sel = -1;

  return (
    <div className="cmdk-backdrop" onMouseDown={close} role="presentation">
      <div
        className="cmdk-panel"
        data-mode={showList ? 'list' : 'bare'}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="cmdk-search">
          <svg className="cmdk-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input
            ref={inputRef}
            className="cmdk-search__input"
            placeholder="Search tools, pages and actions…"
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className={`cmdk-pill ${showAll ? 'cmdk-pill--on' : ''}`}
            aria-pressed={showAll}
            title={showAll ? 'Hide the full list' : 'Show every tool, page and action'}
            onClick={() => { setShowAll(v => !v); setActive(0); inputRef.current?.focus(); }}
          >
            all
          </button>
          <button
            type="button"
            className="cmdk-pill cmdk-pill--esc"
            title="Close"
            onClick={close}
          >
            esc
          </button>
        </div>

        {showList && (
        <div className="cmdk-list" ref={listRef}>
          {groups.length === 0 && (
            <div className="cmdk-empty">
              <span className="cmdk-empty__title">Nothing matches “{query}”</span>
              <span className="cmdk-empty__hint mono-label">Try a tool, page or action name</span>
            </div>
          )}

          {groups.map(g => (
            <div key={g.section} className="cmdk-group">
              <div className="cmdk-group__head mono-label">{g.section}</div>
              {g.items.map(it => {
                const idx = it.disabled ? -1 : ++sel;
                const isActive = idx >= 0 && idx === active;
                return (
                  <button
                    key={it.id}
                    type="button"
                    className={`cmdk-row ${isActive ? 'cmdk-row--active' : ''} ${it.disabled ? 'cmdk-row--disabled' : ''}`}
                    data-sel={idx >= 0 ? idx : undefined}
                    disabled={it.disabled}
                    onMouseMove={() => { if (idx >= 0 && idx !== active) setActive(idx); }}
                    onClick={() => { if (idx >= 0) runIndex(idx); }}
                  >
                    <span className="cmdk-row__icon" aria-hidden>{it.icon}</span>
                    <span className="cmdk-row__text">
                      <span className="cmdk-row__label">{it.label}</span>
                      {it.subtitle && <span className="cmdk-row__sub">{it.subtitle}</span>}
                    </span>
                    <span className="cmdk-row__hint mono-label">
                      {it.disabled ? 'Soon' : g.section}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        )}

        {showList && (
        <div className="cmdk-foot">
          <span className="cmdk-foot__keys mono-label"><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span className="cmdk-foot__keys mono-label"><kbd>↵</kbd> open</span>
          <span className="cmdk-foot__brand mono-label">HJEN Studio</span>
        </div>
        )}
      </div>
    </div>
  );
}
