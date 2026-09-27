import { useEffect, useRef, lazy, Suspense } from 'react';
import { useStore, type ActiveView, type TabHistoryEntry } from './store';
import { TabActiveContext } from './lib/keepAlive';
import { TopChrome } from './components/TopChrome';
import { TabStrip } from './components/TabStrip';
import { HeroCanvas } from './components/HeroCanvas';
import { LeftMeta } from './components/LeftMeta';
import { BottomDock } from './components/BottomDock';
import { PickerModal } from './components/PickerModal';
import { LeftSidebar } from './components/LeftSidebar';
import { RightSidebar } from './components/RightSidebar';
import { DopSidebar } from './components/DopSidebar';
import { ProjectsPage } from './components/ProjectsPage';
import { ProjectWorkspace } from './components/project/ProjectWorkspace';
import { StoryboardWorkspace } from './components/storyboard/StoryboardWorkspace';
import { StoryboardPreview } from './components/storyboard/StoryboardPreview';
import { AssetPreview } from './components/storyboard/AssetPreview';
import { LibraryPage } from './components/LibraryPage';
import { FilesView } from './components/FilesView';
import { UsagePage } from './components/UsagePage';
import { PricingDashboard } from './components/PricingDashboard';
import { LearnPage } from './components/LearnPage';
import { SupportInbox } from './components/SupportInbox';
import { SettingsPage } from './components/SettingsPage';
import { loadUserFonts } from './lib/userFonts';
import { ProductHub } from './components/ProductHub';
import { AppHub } from './components/AppHub';
import { McpHub } from './components/McpHub';
import { EnhancerView } from './components/EnhancerView';
import { CastView } from './components/CastView';
import { CameraAnglesView } from './components/CameraAnglesView';
import { BriefMindView } from './components/preprod/BriefMindView';
import { CreativeMindView } from './components/creativemind/CreativeMindView';
import { StoryView } from './components/preprod/StoryView';
import { CreativeAdvisorView } from './components/preprod/CreativeAdvisorView';
// Heavy workspaces are code-split: their JS loads on first open of that tool
// (KeepAlive keeps them mounted after), shrinking the initial bundle so the app
// boots faster and every OTHER tool opens sooner. Named exports are unwrapped to
// { default } for React.lazy; CutsView is already a default export.
const EmulsionView = lazy(() => import('./components/EmulsionView').then(m => ({ default: m.EmulsionView })));
const VideoView = lazy(() => import('./components/VideoView').then(m => ({ default: m.VideoView })));
const NodeView = lazy(() => import('./components/NodeView').then(m => ({ default: m.NodeView })));
const SpaceView = lazy(() => import('./components/SpaceView').then(m => ({ default: m.SpaceView })));
const WorldView = lazy(() => import('./components/WorldView').then(m => ({ default: m.WorldView })));
const FilmSpaceView = lazy(() => import('./components/FilmSpaceView').then(m => ({ default: m.FilmSpaceView })));
const TreatmentView = lazy(() => import('./components/preprod/TreatmentView').then(m => ({ default: m.TreatmentView })));
const ReferencesView = lazy(() => import('./components/preprod/ReferencesView').then(m => ({ default: m.ReferencesView })));
const PitchView = lazy(() => import('./components/preprod/PitchView').then(m => ({ default: m.PitchView })));
const ShotlistView = lazy(() => import('./components/preprod/ShotlistView').then(m => ({ default: m.ShotlistView })));
const BreakdownView = lazy(() => import('./components/breakdown/BreakdownView').then(m => ({ default: m.BreakdownView })));
const CutsView = lazy(() => import('./components/CutsView'));
const IdeaView = lazy(() => import('./components/IdeaView').then(m => ({ default: m.IdeaView })));
const ContextStudio = lazy(() => import('./components/contextagents/ContextStudio').then(m => ({ default: m.ContextStudio })));
const ContextTrainer = lazy(() => import('./components/contextagents/ContextTrainer').then(m => ({ default: m.ContextTrainer })));
const ContextEye = lazy(() => import('./components/contextagents/ContextEye').then(m => ({ default: m.ContextEye })));
const EyeBench = lazy(() => import('./components/eye/EyeBench'));
const SwapView = lazy(() => import('./components/SwapView').then(m => ({ default: m.SwapView })));
const ReferenceMakerView = lazy(() => import('./components/ReferenceMakerView').then(m => ({ default: m.ReferenceMakerView })));
// The four asset factories — one engine, four floors, code-split per floor.
const CharacterView = lazy(() => import('./components/assets/CharacterView').then(m => ({ default: m.CharacterView })));
const LocationView = lazy(() => import('./components/assets/LocationView').then(m => ({ default: m.LocationView })));
const PropView = lazy(() => import('./components/assets/PropView').then(m => ({ default: m.PropView })));
const WardrobeView = lazy(() => import('./components/assets/WardrobeView').then(m => ({ default: m.WardrobeView })));
import { LogView } from './components/LogView';
import { StatusBar } from './components/StatusBar';
import { GenerationPreview } from './components/GenerationPreview';
import { FailedJobInspector } from './components/FailedJobInspector';
import { DaylightRail } from './components/DaylightRail';
import { RightSidebarToggle } from './components/RightSidebarToggle';
import { SidebarToggle } from './components/SidebarToggle';
import { McpDock } from './components/McpDock';
import { CommandPalette } from './components/CommandPalette';
import { useStoryboard } from './store/storyboardStore';
import { runMcpAction } from './lib/mcpActions';
import { useActiveTheme } from './lib/theme/useTheme';
import { hjenFileUrl } from './lib/theme/apply';
import './styles/app.css';
import './styles/emulsion.css';   // Emulsion (Camera Body × Lens × Film) view
import './styles/files.css';      // Files — the deliverables browser
import './styles/pro-skin.css';   // [data-appearance="pro"] re-skin — inert in Classic
import './styles/mcp.css';        // MCP chat font · living loader · Pro sharpening
import './styles/command-palette.css'; // ⌘K command palette — global overlay
import './styles/account.css';      // Account dropdown enrichment + Profile / Pricing modals

export function App() {
  const init = useStore(s => s.init);
  const catalogReady = useStore(s => s.catalogReady);
  const bootBgPath = useActiveTheme().brand.bootBgPath;
  const error = useStore(s => s.error);
  const clearError = useStore(s => s.clearError);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const layersOpen = useStore(s => s.layersOpen);
  const activeView = useStore(s => s.activeView);
  const activeProjectId = useStore(s => s.activeProjectId);
  const tabs = useStore(s => s.tabs);
  const activeTabId = useStore(s => s.activeTabId);
  const activeTabSub = useStore(s => s.tabs.find(t => t.id === s.activeTabId)?.sub);
  const recordTabHistory = useStore(s => s.recordTabHistory);
  const statusBarVisible = useStore(s => s.statusBarVisible);
  const toggleSidebar = useStore(s => s.toggleSidebar);
  const toggleLayers = useStore(s => s.toggleLayers);

  useEffect(() => { init(); }, [init]);
  useEffect(() => { void loadUserFonts(); }, []);

  // Observe the FINAL navigation state React receives, so synchronous sequences
  // such as project-select → page-open become one history entry. Tab switches do
  // not contaminate either tab's stack; each tab owns its own browser history.
  const previousNavRef = useRef<(TabHistoryEntry & { tabId: string }) | null>(null);
  const historyTrackingStarted = useRef(false);
  useEffect(() => {
    const current = { tabId: activeTabId, view: activeView, projectId: activeProjectId, sub: activeTabSub };
    if (!catalogReady) {
      previousNavRef.current = current;
      historyTrackingStarted.current = false;
      return;
    }
    if (!historyTrackingStarted.current) {
      previousNavRef.current = current;
      historyTrackingStarted.current = true;
      return;
    }
    const previous = previousNavRef.current;
    if (previous && previous.tabId === current.tabId
      && (previous.view !== current.view || previous.projectId !== current.projectId)) {
      recordTabHistory({ view: previous.view, projectId: previous.projectId, sub: previous.sub });
    }
    previousNavRef.current = current;
  }, [catalogReady, activeTabId, activeView, activeProjectId, activeTabSub, recordTabHistory]);

  // Keyboard shortcuts: ⌘B = left sidebar, ⌘L = right layers, ESC = close DOP
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc closes the DOP sidebar if it's open and no picker is active
      if (e.key === 'Escape') {
        const st = useStore.getState();
        if (st.dopOpen && !st.activePicker) {
          e.preventDefault();
          st.setDopOpen(false);
        }
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (k === '[' && !typing) { e.preventDefault(); useStore.getState().goBack(); }
      else if (k === ']' && !typing) { e.preventDefault(); useStore.getState().goForward(); }
      else if (k === 'b') { e.preventDefault(); toggleSidebar(); }
      else if (k === 'l') { e.preventDefault(); toggleLayers(); }
      // Browser-style tab shortcuts: ⌘T new tab · ⌘W close the active tab.
      else if (k === 't') { e.preventDefault(); useStore.getState().newTab(); }
      else if (k === 'w') { e.preventDefault(); const st = useStore.getState(); st.closeTab(st.activeTabId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar, toggleLayers]);

  // Deep-link navigation (hjen-studio://) + MCP live hot-reload (control port).
  useEffect(() => {
    const viewMap: Record<string, string> = {
      overview: 'project', project: 'project', storyboard: 'storyboard', node: 'node', space: 'space',
      frame: 'frame', video: 'video', library: 'library', files: 'files', cast: 'cast', world: 'world',
      brief: 'brief', creativemind: 'creativemind', story: 'story', treatment: 'treatment', references: 'references', pitch: 'pitch', advisor: 'advisor',
      breakdown: 'breakdown', log: 'log', idea: 'idea',
      'ca-studio': 'ca-studio', 'ca-trainer': 'ca-trainer', 'ca-eye': 'ca-eye', eye: 'eye', swap: 'swap',
      'reference-maker': 'reference-maker',
      // The four asset factories — reachable by deep link and by an agent.
      character: 'a-character', location: 'a-location', prop: 'a-prop', wardrobe: 'a-wardrobe',
    };
    const offNav = window.hjen.onNavigate?.(({ projectId, view }) => {
      void (async () => {
        // An agent may navigate to a project it JUST created — refresh the
        // cached index first so selectProject can actually find it.
        let st = useStore.getState();
        if (projectId && !st.projects.some(p => p.id === projectId)) { await st.loadProjects(); st = useStore.getState(); }
        if (projectId) st.selectProject(projectId);
        const target = viewMap[view] || 'projects';
        if (target === 'project' && projectId) void st.openProjectWorkspace(projectId);
        else {
          // Project-scoped workspaces must be loaded FOR the project, else the
          // view shows its generic hub/list instead of this project's content.
          if ((target === 'node' || target === 'space') && projectId) void st.loadGraphForProject(projectId, target === 'space' ? 'space' : 'node');
          if (target === 'storyboard' && projectId) void useStoryboard.getState().open(projectId);
          st.setActiveView(target as any);
        }
      })();
    });
    const offReload = window.hjen.onReload?.(({ projectId, kind }) => {
      const st = useStore.getState();
      // Any MCP write may have touched the projects index (create / stage /
      // ledger mirror) — re-read it so the Projects page is live, no restart.
      void st.loadProjects();
      if (projectId && projectId === st.activeProjectId && (kind === 'graph' || kind === 'all')) void st.loadGraphForProject(projectId);
      // Storyboard write from the MCP → refresh the open board live so the
      // panel shows its 'making' spinner and then the new take, no restart.
      if ((kind === 'storyboard' || kind === 'all') && useStoryboard.getState().projectId === projectId) {
        void useStoryboard.getState().reloadFromDisk();
      }
      // A frame/refine/video made via the MCP → refresh the Frame/Video history.
      if (kind === 'generation' || kind === 'frame' || kind === 'video' || kind === 'all') {
        window.dispatchEvent(new CustomEvent('hjen:generation-reload', { detail: { projectId } }));
      }
      // A frame clipped from the browser landed in {project}/_references/ and
      // was appended to stage 2 on disk. The open References view merges it in
      // by id — it must never reload wholesale over the user's live edits.
      if (kind === 'references' || kind === 'all') {
        window.dispatchEvent(new CustomEvent('hjen:references-reload', { detail: { projectId } }));
      }
    });
    // Command bridge — the MCP drives a REAL app action (registry in lib/mcpActions).
    // We run it LIVE (navigation + real store action) and answer the MCP back.
    const offCmd = window.hjen.onCommand?.(({ requestId, action, args }) => {
      void runMcpAction(action, args)
        .then(result => window.hjen.respondCommand?.(requestId, result))
        .catch(err => window.hjen.respondCommand?.(requestId, { ok: false, reason: 'threw', message: String(err?.message || err) }));
    });
    return () => { offNav?.(); offReload?.(); offCmd?.(); };
  }, []);

  // Pre-boot screens — only block the UI while the catalog is loading or
  // failed BEFORE the app is usable. Once catalogReady = true, runtime
  // errors surface as a top banner instead of locking the user out.
  if (!catalogReady) {
    if (error) {
      return (
        <div className="boot boot--err">
          <div className="boot__err">{error}</div>
          <button
            className="boot__retry"
            onClick={() => { clearError(); init(); }}
          >Retry</button>
        </div>
      );
    }
    return (
      <div
        className={`boot ${bootBgPath ? 'boot--custom-bg' : ''}`}
        style={bootBgPath ? { backgroundImage: `url("${hjenFileUrl(bootBgPath)}")` } : undefined}
      >
        <div className="boot__mark">HJEN</div>
        <div className="boot__sub mono-label">Loading catalog…</div>
      </div>
    );
  }

  // `frame` is the original workspace (canvas + dock + sidebars). Every
  // other view renders full-bleed (no sidebars, no dock). `studio` is the
  // product hub — full-bleed list of HJEN's apps.
  const isFrame = activeView === 'frame';
  const appClass = [
    'app',
    `app--view-${activeView}`,
    isFrame && !sidebarOpen ? 'app--sidebar-collapsed' : '',
    isFrame && !layersOpen ? 'app--layers-collapsed' : '',
    !isFrame ? 'app--sidebar-collapsed app--layers-collapsed' : '',
    // Reserve the foot-strip so the global StatusBar never overlaps content.
    statusBarVisible ? 'app--statusbar' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={appClass}>
      {error && (
        <ErrorBar />
      )}
      <DaylightRail />
      <TopChrome />
      <TabStrip />
      <PickerModal />

      {/* Keep-alive workspace host — the browser-tab contract. Every open tab
       *  whose view is an interactive workspace stays MOUNTED (hidden when it
       *  isn't the active tab) so its local React state — prompt text, uploaded
       *  refs, scroll position, the open shot / inner sub-page — survives a tab
       *  switch. Two tabs on the same view are two independent instances, keyed
       *  by tab.id. Lightweight / global-store-backed pages below stay
       *  conditionally mounted (unmount on leave); nothing there is lost. */}
      {tabs.filter(t => KEEP_ALIVE_VIEWS.has(t.view)).map(t => (
        <KeepAlivePane key={t.id} view={t.view} active={t.id === activeTabId} />
      ))}

      {/* DOP sidebar — ONE shared overlay for Frame, Video, Node and Reference
       *  Maker. The latter calls the same optional Frame tool from Make settings;
       *  it does not create a parallel cinematography editor. */}
      {(isFrame || activeView === 'video' || activeView === 'node' || activeView === 'space' || activeView === 'reference-maker') && <DopSidebar />}

      {/* Every view now routes through the keep-alive host above — each open
       *  tab's page (workspaces, the big containers project/storyboard/library,
       *  hubs and utility pages) stays mounted and is hidden with visibility (not
       *  display) so returning to a tab is instant and flash-free with its state
       *  intact. Nothing renders here conditionally by activeView anymore. */}

      <GenerationPreview />
      <StoryboardPreview />
      <AssetPreview />
      <FailedJobInspector />
      {/* Global MCP drawer — pinned in the top bar, same surface on every view. */}
      <McpDock />
      {/* Global ⌘K command palette — the keyboard entry point to every view,
       *  tool and action. Mounted once at the root so it opens from anywhere. */}
      <CommandPalette />
      {/* Global bottom bar — HJEN STUDIO 2026 · running ops · recent-10 popover.
       *  Present on every view; reserves its strip via .app--statusbar. */}
      <StatusBar />
    </div>
  );
}

// Interactive workspace views that must survive a tab switch with their local
// state intact. Everything NOT listed here stays conditionally mounted — either
// it holds no user input (studio, settings, usage, pricing, learn, support) or
// its state already lives in a persistent global store (storyboard → useStoryboard,
// project → projectState), so unmounting it loses nothing.
const KEEP_ALIVE_VIEWS = new Set<ActiveView>([
  'frame', 'video', 'node', 'space', 'cast', 'angles', 'filmspace', 'breakdown',
  'brief', 'creativemind', 'story', 'treatment', 'references', 'pitch', 'cuts', 'idea',
  'shotlist',
  // Standalone interactive tools — same self-contained shape as the above, so
  // they keep their local state (uploaded image, settings, sub-page) and stay
  // flash-free across a tab switch. Heavy ones (world = 3D) can read
  // TabActiveContext to pause their render loop while inactive.
  'enhancer', 'emulsion', 'world', 'advisor', 'ca-studio', 'ca-trainer', 'ca-eye', 'eye',
  // The Swap holds a read, a full decision map and several in-flight ladders.
  // Losing that to a tab switch would throw away two vision passes and a plan.
  'swap', 'reference-maker',
  // The asset factories hold real local state — the open asset, the spec drawer,
  // an in-flight build — and all four read one stage-6 document, so switching
  // between them must never reload or lose a selection.
  'a-character', 'a-location', 'a-prop', 'a-wardrobe',
  // The big containers + hubs + utility pages. All roots are position:fixed
  // full-bleed, so they overlap and hide via visibility with no flash. Their
  // per-tab nav open-logic (openProjectWorkspace / useStoryboard.open /
  // loadGraphForProject) still runs in applyTabNav, so the visible pane always
  // reflects the active project; local UI (scroll, stage tab, filters) persists.
  'projects', 'project', 'storyboard', 'library', 'files', 'log',
  'studio', 'apphub', 'mcp', 'usage', 'pricing', 'learn', 'support', 'settings',
]);

/** One kept-alive tab pane: its workspace view stays mounted; only the active
 *  tab's pane is visible. We hide inactive panes with `visibility:hidden`, NOT
 *  `display:none` — both keep the React subtree (inputs, scroll, refs) alive, but
 *  `display:none` removes the pane from the render tree, so returning to the tab
 *  re-lays-it-out, REPLAYS every entrance animation/transition, recomputes blurs
 *  and re-decodes images — that re-entry paint is the flash the user saw across
 *  breakdown/shotlist and the other detail pages. Every view root is
 *  position:fixed and fills the same area (they overlap by design), and
 *  visibility inherits into fixed descendants, so hiding this wrapper hides the
 *  whole view with no reflow and no flash; returning is an instant reveal.
 *  pointer-events:none keeps a hidden pane from intercepting clicks. */
function KeepAlivePane({ view, active }: { view: ActiveView; active: boolean }) {
  return (
    <TabActiveContext.Provider value={active}>
      <div
        className="ka-pane"
        aria-hidden={!active}
        style={active ? undefined : { visibility: 'hidden', pointerEvents: 'none' }}
      >
        {/* Suspense boundary for the code-split workspaces — shows nothing (the
         *  pane is already full-bleed) while a tool's chunk loads on first open. */}
        <Suspense fallback={null}>
          {renderWorkspace(view)}
        </Suspense>
      </div>
    </TabActiveContext.Provider>
  );
}

function renderWorkspace(view: ActiveView) {
  switch (view) {
    case 'frame': return <FrameWorkspace />;
    case 'video': return <VideoView />;
    case 'node': return <NodeView />;
    case 'space': return <SpaceView />;
    case 'cast': return <CastView />;
    case 'a-character': return <CharacterView />;
    case 'a-location': return <LocationView />;
    case 'a-prop': return <PropView />;
    case 'a-wardrobe': return <WardrobeView />;
    case 'angles': return <CameraAnglesView />;
    case 'filmspace': return <FilmSpaceView />;
    case 'breakdown': return <BreakdownView />;
    case 'brief': return <BriefMindView />;
    case 'creativemind': return <CreativeMindView />;
    case 'story': return <StoryView />;
    case 'treatment': return <TreatmentView />;
    case 'references': return <ReferencesView />;
    case 'pitch': return <PitchView />;
    case 'shotlist': return <ShotlistView />;
    case 'cuts': return <CutsView />;
    case 'idea': return <IdeaView />;
    case 'ca-studio': return <ContextStudio />;
    case 'ca-trainer': return <ContextTrainer />;
    case 'ca-eye': return <ContextEye />;
    case 'eye': return <EyeBench />;
    case 'swap': return <SwapView />;
    case 'reference-maker': return <ReferenceMakerView />;
    case 'enhancer': return <EnhancerView />;
    case 'emulsion': return <EmulsionView />;
    case 'world': return <WorldView />;
    case 'advisor': return <CreativeAdvisorView />;
    case 'projects': return <ProjectsPage />;
    case 'project': return <ProjectWorkspace />;
    case 'storyboard': return <StoryboardWorkspace />;
    case 'library': return <LibraryPage />;
    case 'files': return <FilesView />;
    case 'log': return <LogView />;
    case 'studio': return <ProductHub />;
    case 'apphub': return <AppHub />;
    case 'mcp': return <McpHub />;
    case 'usage': return <UsagePage />;
    case 'pricing': return <PricingDashboard />;
    case 'learn': return <LearnPage />;
    case 'support': return <SupportInbox />;
    case 'settings': return <SettingsPage />;
    default: return null;
  }
}

/** The original full workspace (Frame view) — canvas + sidebars + dock + meta.
 *  DopSidebar is intentionally excluded: it's the one shared overlay rendered
 *  once at the App root for whichever of Frame / Video / Node is active. */
function FrameWorkspace() {
  return (
    <>
      <HeroCanvas />
      <LeftSidebar />
      <RightSidebar />
      <SidebarToggle />
      <RightSidebarToggle />
      <LeftMeta />
      <BottomDock />
    </>
  );
}

function ErrorBar() {
  const error = useStore(s => s.error);
  const clearError = useStore(s => s.clearError);
  if (!error) return null;

  return (
    <div className="error-bar" role="alert">
      <span className="error-bar__dot" />
      <span className="error-bar__text">{error}</span>
      <button className="error-bar__close" onClick={clearError} title="Dismiss">×</button>
    </div>
  );
}
