import { useEffect, useState } from 'react';
import wordmark from '../assets/hjen_wordmark.svg';
import markLogo from '../assets/hjen_primary.svg';
// TEMPORARY collab wordmark ("hjen.") — swapped in for the top-bar logo. To
// revert, point ThemedLogo back at `wordmark` / `markLogo` below.
import tempWordmark from '../assets/hjen_temp_wordmark.png';
import { useStore } from '../store';
import { useHunt } from '../store/huntStore';
import { AppNav } from './AppNav';
import { StudioLink, AppLink, LearnMenu, SupportMenu, AccountMenu } from './TopBarMenus';
import { useActiveTheme } from '../lib/theme/useTheme';
import { hjenFileUrl } from '../lib/theme/apply';

/** Live hunt indicator — visible from ANY view while a reference hunt runs.
 *  Clicking jumps back to that project's References view. */
function HuntPill() {
  const running = useHunt(s => s.running);
  const done = useHunt(s => s.queriesDone);
  const total = useHunt(s => s.queriesTotal);
  const kept = useHunt(s => s.kept);
  const pid = useHunt(s => s.projectId);
  const setActiveView = useStore(s => s.setActiveView);
  const selectProject = useStore(s => s.selectProject);
  if (!running) return null;
  return (
    <button
      className="hunt-pill no-drag"
      title="Reference hunt running — click to open References"
      onClick={() => { if (pid) selectProject(pid); setActiveView('references'); }}
    >
      <span className="hunt-pill__dot" aria-hidden="true" />
      Hunt · {done}/{total} · {kept} kept
    </button>
  );
}

/** Update badge — appears the moment a newer version finishes downloading in the
 *  background (desktop only; on web onUpdateReady never fires). Live while the app
 *  stays open — no need to quit. Clicking restarts into the new version at once. */
function UpdatePill() {
  const [ready, setReady] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    const off = window.hjen.onUpdateReady?.((d) => setReady(d?.version || 'new'));
    return () => { try { off?.(); } catch { /* ignore */ } };
  }, []);
  if (!ready) return null;
  return (
    <button
      className="hunt-pill no-drag"
      title={`Update ${ready} is ready — click to restart and apply it now`}
      disabled={restarting}
      onClick={async () => { setRestarting(true); try { await window.hjen.restartToUpdate?.(); } catch { setRestarting(false); } }}
    >
      <span className="hunt-pill__dot" aria-hidden="true" />
      {restarting ? 'Restarting…' : 'Update ready · Restart'}
    </button>
  );
}

/** MCP — pinned in the top bar so the Assistant drawer opens from ANY view. */
function McpDockButton() {
  const open = useStore(s => s.mcpDockOpen);
  const toggle = useStore(s => s.toggleMcpDock);
  return (
    <button
      className={`topbar-link ${open ? 'topbar-link--on' : ''}`}
      onClick={toggle}
      title="MCP — Assistant + connect an external agent (works on every page)"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4" /><path d="M12 18v4" />
        <path d="M4.9 4.9l2.8 2.8" /><path d="M16.3 16.3l2.8 2.8" />
        <path d="M2 12h4" /><path d="M18 12h4" />
      </svg>
      MCP
    </button>
  );
}

export function TopChrome() {
  const activeProjectId = useStore(s => s.activeProjectId);
  const projectName = useStore(s => s.projects.find(p => p.id === s.activeProjectId)?.name);
  const openPicker = useStore(s => s.openPicker);
  const { brand } = useActiveTheme();

  return (
    <header className="drag-region top-chrome">
      <div className="top-chrome__left no-drag">
        {/* The left-sidebar toggle now floats on-canvas at the sidebar's edge
            (see <SidebarToggle/> in App.tsx), mirroring the Layers toggle — so
            the HJEN logo is the first chrome item, clear of the traffic lights. */}
        <ThemedLogo brand={brand} />
        <AppNav />
        {activeProjectId && projectName && (
          <div className="top-chrome__crumb" title="Switch project">
            <span className="top-chrome__crumb-sep">/</span>
            <button className="top-chrome__crumb-name" onClick={() => openPicker('projects')}>
              {projectName}
              <svg className="top-chrome__crumb-caret" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4l2.5 2.5L7.5 4" /></svg>
            </button>
          </div>
        )}
      </div>

      <div className="top-chrome__right no-drag">
        <UpdatePill />
        <HuntPill />
        <StudioLink />
        <AppLink />
        <McpDockButton />
        <LearnMenu />
        <SupportMenu />
        <AccountMenu />
      </div>
    </header>
  );
}

function ThemedLogo({ brand }: { brand: ReturnType<typeof useActiveTheme>['brand'] }) {
  // TEMPORARY: show the "hjen." collab wordmark in every non-hidden logo mode so
  // the swap holds across theme switches. Uses the plain `.wordmark` class (not
  // --mark/--custom) so it stays theme-aware — white on dark, dark on light.
  if (brand.logoMode === 'hidden') return null;
  return <img src={tempWordmark} alt="HJEN" className="wordmark wordmark--temp" />;
}
