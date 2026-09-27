import { useStore, tabTitle, type Tab, type BgJob } from '../store';

/**
 * TabStrip — the app-wide, browser-style tab bar that sits directly beneath
 * TopChrome. Each tab is a full open workspace (a view + a project + any
 * per-view sub-state); switching a tab restores that navigation exactly.
 *
 * Design decision — ALWAYS ON. Like a browser, the strip shows on every view
 * (including the Frame canvas) for spatial consistency: the user always knows
 * how many workspaces are open and where to click back. It spans the same
 * left/right insets as TopChrome, so it lives in the canvas gap between the
 * sidebars and never collides with the Frame dock or meta.
 *
 * JOB-TABS — a distinct variant appended after the workspace tabs. A running
 * background operation shows as a RED, subtly pulsing tab that is NOT clickable
 * (the work is in flight); its label carries a compact stage/progress readout.
 * On completion the tab turns GREEN and becomes clickable — clicking it
 * navigates back to where the op ran (job.nav) and dismisses the tab. A stopped
 * op reads AMBER and is likewise clickable (back to retry). Job state uses the
 * semantic --job-* tokens, never the amber accent, so it reads the same across
 * all six themes. Reduced-motion users get a static dot, no pulse.
 *
 * Theme-blind: tokens only, responds to the same chrome tokens as TopChrome.
 * Overflow scrolls horizontally; long titles truncate with an ellipsis and
 * carry the full title on hover. Arabic project names inherit --font-sans and
 * are never given mono / letter-spacing (Anwar's language law).
 */
export function TabStrip() {
  const tabs = useStore(s => s.tabs);
  const activeTabId = useStore(s => s.activeTabId);
  const canGoBack = useStore(s => (s.tabs.find(t => t.id === s.activeTabId)?.history?.length || 0) > 0);
  const canGoForward = useStore(s => (s.tabs.find(t => t.id === s.activeTabId)?.forward?.length || 0) > 0);
  const projects = useStore(s => s.projects);
  const bgJobs = useStore(s => s.bgJobs);
  const selectTab = useStore(s => s.selectTab);
  const closeTab = useStore(s => s.closeTab);
  const newTab = useStore(s => s.newTab);
  const goBack = useStore(s => s.goBack);
  const goForward = useStore(s => s.goForward);
  const openJobNav = useStore(s => s.openJobNav);
  const dismissJobTabs = useStore(s => s.dismissJobTabs);
  const setActiveView = useStore(s => s.setActiveView);
  const setLogFocusJobId = useStore(s => s.setLogFocusJobId);

  // Middle-click closes a tab (browser convention).
  const onAuxDown = (e: React.MouseEvent, id: string) => {
    if (e.button === 1) { e.preventDefault(); closeTab(id); }
  };

  // Jobs not yet dismissed ride the strip. They are CONSOLIDATED PER TOOL (one
  // chip for all Frames, one for all Video, …) so 20 makes never spawn 20 chips —
  // the chip carries aggregate colour + a count and leads to the tool's work.
  const groups = groupJobs(bgJobs.filter(j => !j.dismissedFromTab));

  const openJob = (id: string) => {
    const j = bgJobs.find(x => x.id === id);
    // A STOPPED op's home is its breakdown page — which says nothing about the
    // failure. Route it to the LOG and open its error detail there instead.
    if (j && j.status === 'error') { setLogFocusJobId(id); setActiveView('log'); return; }
    void openJobNav(id);
  };

  // Click a tool chip → open its LAST COMPLETED generation (Anwar's choice), and
  // dismiss the group's finished chips (running ones keep the chip alive).
  const openGroup = (g: JobGroup) => {
    if (g.target) openJob(g.target.id);
    if (g.finishedIds.length) dismissJobTabs(g.finishedIds);
  };

  return (
    <div className="tab-strip no-drag">
      <button
        type="button"
        className="tab-strip__back"
        aria-label="Back to the previous page"
        title={canGoBack ? 'Back to the previous page (⌘[)' : 'No previous page in this tab'}
        disabled={!canGoBack}
        onClick={goBack}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.75 3.25L5 8l4.75 4.75" />
          <path d="M5.25 8H13" />
        </svg>
      </button>
      <button
        type="button"
        className="tab-strip__forward"
        aria-label="Forward to the next page"
        title={canGoForward ? 'Forward to the next page (⌘])' : 'No next page in this tab'}
        disabled={!canGoForward}
        onClick={goForward}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6.25 3.25L11 8l-4.75 4.75" />
          <path d="M10.75 8H3" />
        </svg>
      </button>
      <div className="tab-strip__scroll" role="tablist" aria-label="Open workspaces">
        {tabs.map((t: Tab) => {
          const title = tabTitle(t.view, t.projectId, projects);
          const active = t.id === activeTabId;
          const closable = tabs.length > 1;
          return (
            <div
              key={t.id}
              role="tab"
              tabIndex={0}
              aria-selected={active}
              className={`tab-strip__tab ${active ? 'tab-strip__tab--active' : ''}`}
              title={title}
              onMouseDown={e => onAuxDown(e, t.id)}
              onClick={() => selectTab(t.id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTab(t.id); }
                else if ((e.key === 'w' || e.key === 'W') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closeTab(t.id); }
              }}
            >
              <span className="tab-strip__dot" aria-hidden="true" />
              <span className="tab-strip__title">{title}</span>
              {closable && (
                <button
                  type="button"
                  className="tab-strip__close"
                  aria-label={`Close ${title}`}
                  title="Close tab (⌘W)"
                  onClick={e => { e.stopPropagation(); closeTab(t.id); }}
                  onMouseDown={e => e.stopPropagation()}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M2 2l6 6M8 2l-6 6" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}

        {/* Job-tabs — ONE consolidated chip per tool (Frames / Video / …). */}
        {groups.map(g => <GroupJobTab key={g.key} group={g} onOpen={openGroup} onDismiss={dismissJobTabs} />)}
      </div>
      <button
        type="button"
        className="tab-strip__new"
        aria-label="Open a new tab"
        title="New tab (⌘T)"
        onClick={newTab}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M7 2.5v9M2.5 7h9" />
        </svg>
      </button>
    </div>
  );
}

// ─── per-tool grouping ───────────────────────────────────────────────────────
// One chip per TOOL, not per generation. A tool's key/label/target-view is derived
// from the job kind so all Frames makes collapse into a single "Frames" chip, etc.
type ToolStatus = 'running' | 'error' | 'interrupted' | 'done';
interface JobGroup {
  key: string;
  label: string;
  status: ToolStatus;        // aggregate: running > error > interrupted > done
  total: number;
  running: number;
  done: number;
  target: BgJob | null;      // the job a click opens — the LAST COMPLETED one
  finishedIds: string[];     // non-running ids (dismissed together)
}

function toolOf(kind: string): { key: string; label: string } {
  if (kind === 'frame-make') return { key: 'frame', label: 'Frames' };
  if (kind === 'video-make' || kind === 'video-recover') return { key: 'video', label: 'Video' };
  if (kind.startsWith('breakdown')) return { key: 'breakdown', label: 'Breakdown' };
  if (kind === 'cuts') return { key: 'cuts', label: 'Cuts' };
  return { key: kind, label: kind };
}

/** Collapse the live job list into one group per tool, preserving first-seen
 *  order so a tool's chip keeps its position as new makes stream in. */
function groupJobs(jobs: BgJob[]): JobGroup[] {
  const order: string[] = [];
  const map = new Map<string, BgJob[]>();
  for (const j of jobs) {
    const { key } = toolOf(j.kind);
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key)!.push(j);
  }
  return order.map(key => {
    const list = map.get(key)!;
    const { label } = toolOf(list[0].kind);
    const running = list.filter(j => j.status === 'running').length;
    const done = list.filter(j => j.status === 'done').length;
    const errored = list.filter(j => j.status === 'error').length;
    const interrupted = list.filter(j => j.status === 'interrupted').length;
    const status: ToolStatus = running > 0 ? 'running' : errored > 0 ? 'error' : interrupted > 0 ? 'interrupted' : 'done';
    // Click target = the LAST COMPLETED generation (newest doneAt); else newest finished.
    const finished = list.filter(j => j.status !== 'running');
    const byRecency = [...finished].sort((a, b) => (b.doneAt ?? b.createdAt) - (a.doneAt ?? a.createdAt));
    const target = byRecency.find(j => j.status === 'done') ?? byRecency[0] ?? null;
    return { key, label, status, total: list.length, running, done, target, finishedIds: finished.map(j => j.id) };
  });
}

function GroupJobTab({ group, onOpen, onDismiss }: {
  group: JobGroup; onOpen: (g: JobGroup) => void; onDismiss: (ids: string[]) => void;
}) {
  const g = group;
  const clickable = !!g.target;                 // openable once at least one finished
  const allDone = g.running === 0;
  // Compact count: while any run, show completed/total; when all settled, show the total.
  const prog = g.running > 0 ? `${g.done}/${g.total}` : `${g.total}`;
  const tip = g.running > 0
    ? `${g.label} — ${g.running} running · ${g.done}/${g.total} done${clickable ? ' · click to open the last completed' : ''}`
    : `${g.label} — ${g.total} ${g.status === 'done' ? 'done' : g.status} · click to open the last completed`;

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : -1}
      aria-disabled={!clickable || undefined}
      aria-label={tip}
      className={`tab-strip__job tab-strip__job--${g.status}`}
      title={tip}
      onClick={clickable ? () => onOpen(g) : undefined}
      onKeyDown={clickable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(g); } } : undefined}
    >
      <span className="tab-strip__job-dot" aria-hidden="true" />
      <span className="tab-strip__job-title">{g.label}</span>
      <span className="tab-strip__job-prog">{prog}</span>
      {allDone && g.finishedIds.length > 0 && (
        <button
          type="button"
          className="tab-strip__job-close"
          aria-label={`Dismiss ${g.label}`}
          title="Dismiss"
          onClick={e => { e.stopPropagation(); onDismiss(g.finishedIds); }}
          onMouseDown={e => e.stopPropagation()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 2l6 6M8 2l-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
