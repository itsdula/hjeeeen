import { useEffect, useState, memo } from 'react';
import { useStore } from '../store';
import { useStoryboard } from '../store/storyboardStore';
import { fanVars } from './ProductHub';
import { QualityBadge, DimsTag, cleanTitle } from './QualityBadge';
import type { GlobalGenerationEntry, ProjectMeta } from '../types/hjen-bridge';
import { dispSrc } from '../lib/dispUrl';

// ─── 8-stage pipeline ────────────────────────────────────────
// These are the phases every HJEN project moves through.
// Today only Brief (implicit) + Frames (real, from generations) are
// data-backed; the rest are surfaces for future tooling. The visualisation
// is honest: we show the journey shape and mark "current = Frames" once
// the project has any frames, otherwise "current = Brief".
const STAGES = [
  { n: '01', name: 'Brief' },
  { n: '02', name: 'References' },
  { n: '03', name: 'Saudi Recast' },
  { n: '04', name: 'Treatment' },
  { n: '05', name: 'Screenplay' },
  { n: '06', name: 'Assets' },
  { n: '07', name: 'Frames' },
  { n: '08', name: 'Videos' },
] as const;

function currentStageIndex(generationCount: number): number {
  return generationCount > 0 ? 6 /* Frames */ : 0 /* Brief */;
}

type ViewMode = 'atlas' | 'wall' | 'wallet';
const VIEW_MODE_KEY = 'hjen.projects.viewMode';

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    return v === 'wall' || v === 'wallet' ? v : 'atlas';
  } catch { return 'atlas'; }
}

function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

// ─── tool wallet ─────────────────────────────────────────────
// From a project you can open it directly in any HJEN tool. The wallet
// fans the tools out sideways; clicking an available card sets the active
// project and jumps straight into that tool.
type ToolView = 'frame' | 'enhancer' | 'node' | 'space' | 'storyboard' | 'video' | 'cast';
interface Tool { id: string; name: string; tagline: string; status: 'available' | 'soon'; accent: string; view?: ToolView; order: number; }
// Same canonical workflow order as the Studio hub: Story → Art → Storyboard →
// References → Cast → Wardrobe → Shotlist → Frame → Enhancer → Video → Node →
// MCP. Sorted by `order` so a future tool just needs its own number.
const TOOLS: Tool[] = [
  { id: 'story', name: 'Story', tagline: 'Five-beat narrative spine builder', status: 'soon', accent: '#D1B310', order: 1 },
  { id: 'art', name: 'Art', tagline: 'Art direction — sets, props & palette', status: 'soon', accent: '#B2D08D', order: 2 },
  { id: 'storyboard', name: 'Storyboard', tagline: 'Beat-by-beat visual planning', status: 'available', accent: '#0563E9', view: 'storyboard', order: 3 },
  { id: 'references', name: 'References', tagline: 'Curated visual library for filmmakers', status: 'soon', accent: '#257D64', order: 4 },
  { id: 'cast', name: 'Cast', tagline: 'Photo → locked character profile', status: 'available', accent: '#AF7757', view: 'cast', order: 5 },
  { id: 'wardrobe', name: 'Wardrobe', tagline: 'Per-role piece lists with cultural fidelity', status: 'soon', accent: '#DCC9C1', order: 6 },
  { id: 'shotlist', name: 'Shotlist', tagline: 'Shot planning + production schedule', status: 'soon', accent: '#E5AAD8', order: 7 },
  { id: 'frame', name: 'Frame', tagline: 'Saudi-DNA AI image studio for KV stills', status: 'available', accent: '#F25502', view: 'frame', order: 8 },
  { id: 'enhancer', name: 'Enhancer', tagline: 'De-plastic AI portraits, restore real skin', status: 'available', accent: '#2E7C9E', view: 'enhancer', order: 9 },
  { id: 'video', name: 'Video', tagline: 'Image → motion · Seedance 2.0', status: 'available', accent: '#E41A2F', view: 'video', order: 10 },
  { id: 'node', name: 'Node', tagline: 'Visual pipeline — chain every HJEN tool', status: 'available', accent: '#1095ED', view: 'node', order: 11 },
  { id: 'space', name: 'HJEN SPACE', tagline: 'The infinite board — make, arrange, wire. No sequence.', status: 'available', accent: '#4FB7B3', view: 'space', order: 11.5 },
  { id: 'mcp', name: 'MCP', tagline: 'Model Context Protocol — HJEN as an agent tool', status: 'soon', accent: '#0563E9', order: 12 },
];
TOOLS.sort((a, b) => a.order - b.order);
function inkOf(hex: string): 'dark' | 'light' {
  const h = hex.replace('#', '');
  const ch = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(2)) + 0.0722 * lin(ch(4));
  return L > 0.45 ? 'dark' : 'light';
}
const toolStatus = (s: string) => (s === 'available' ? 'Available now' : 'Coming soon');
// Deterministic brand-token colour per project, used for the gradient
// fallback when a project has no generated image yet (mirrors the Product
// hub gradient look).
const PROJ_COLORS = ['#F25502', '#1095ED', '#257D64', '#E5AAD8', '#B2D08D', '#AF7757', '#D1B310', '#E41A2F', '#0563E9', '#DCC9C1'];

export function ProjectsPage() {
  const projects = useStore(s => s.projects);
  const projectsRoot = useStore(s => s.projectsRoot);
  const selectProject = useStore(s => s.selectProject);
  const setActiveView = useStore(s => s.setActiveView);
  const openProjectWorkspace = useStore(s => s.openProjectWorkspace);
  const createProject = useStore(s => s.createProject);
  const deleteProject = useStore(s => s.deleteProject);
  const renameProject = useStore(s => s.renameProject);
  const setProjectCover = useStore(s => s.setProjectCover);
  const viewPast = useStore(s => s.viewPastGeneration);
  const activeProjectId = useStore(s => s.activeProjectId);
  const openStoryboard = useStoryboard(s => s.open);

  const [allGens, setAllGens] = useState<GlobalGenerationEntry[]>([]);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [activePid, setActivePid] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [imgPickerOpen, setImgPickerOpen] = useState(false);

  useEffect(() => {
    window.hjen.listAllGenerations().then(setAllGens);
  }, []);

  // Default the wallet's active project to the last one the user opened/used
  // (restored from the store's activeProjectId, which is seeded from the
  // persisted lastProjectId on launch); fall back to the first project.
  useEffect(() => {
    if (activePid || !projects.length) return;
    const restore = activeProjectId && projects.some(p => p.id === activeProjectId)
      ? activeProjectId
      : projects[0].id;
    setActivePid(restore);
  }, [projects, activePid, activeProjectId]);

  // Remember a project as the "last used" — drives the default above next time.
  const rememberProject = (id: string) => {
    selectProject(id);
    window.hjen.setLastProjectId?.(id);
  };
  const chooseProject = (id: string) => {
    setActivePid(id);
    rememberProject(id);
  };

  // Close the project dropdown on any outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const close = () => setPickerOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [pickerOpen]);

  const launchTool = (t: Tool) => {
    if (t.status !== 'available' || !t.view || !activePid) return;
    rememberProject(activePid);
    // Scope the tool to the chosen project. Storyboard keeps its own per-project
    // store, so open it explicitly (skips the in-tool project picker); the
    // canvas tools (frame/enhancer/video/node) read the store's activeProjectId.
    if (t.view === 'storyboard') openStoryboard(activePid);
    setActiveView(t.view);
  };

  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch {}
  }, [viewMode]);

  const statsByProject = new Map<string, { count: number; cost: number; durationMs: number }>();
  for (const g of allGens) {
    const key = g.projectId ?? '_unassigned';
    const cur = statsByProject.get(key) ?? { count: 0, cost: 0, durationMs: 0 };
    cur.count += 1;
    cur.cost += g.costUsd ?? 0;
    cur.durationMs += g.durationMs ?? 0;
    statsByProject.set(key, cur);
  }

  const handleCreate = async () => {
    const n = newName.trim();
    if (!n) return;
    await createProject(n);
    setNewName('');
  };

  // Primary action: enter the 8-stage Project Workspace.
  const handleOpen = (id: string) => { window.hjen.setLastProjectId?.(id); openProjectWorkspace(id); };
  // Secondary action: skip the workspace and go straight to the Studio canvas
  // (i.e. the legacy 'frame' view) with this project active.
  const handleOpenStudio = (id: string) => { rememberProject(id); setActiveView('frame'); };
  const handleReveal = (slug: string) => window.hjen.openFolder(`${projectsRoot}/${slug}`);
  const handleDelete = async (p: ProjectMeta) => {
    const deleteFiles = confirm(`Delete project "${p.name}"?\n\nClick OK to ALSO delete its files on disk, Cancel to keep the files but remove from the list.`);
    if (!confirm('Confirm: remove the project from the list?')) return;
    await deleteProject(p.id, deleteFiles);
  };
  const handleSetCover = async (projectId: string, imgPath: string | null) => {
    await setProjectCover(projectId, imgPath);
  };
  // Electron has no window.prompt, so rename inline using the shared editing
  // state — the picker swaps to a text field while editingId === project.
  const handleRenameActive = (p: ProjectMeta) => {
    setEditingId(p.id);
    setEditingName(p.name);
    setPickerOpen(false);
  };
  const commitRename = async () => {
    if (editingId && editingName.trim()) await renameProject(editingId, editingName.trim());
    setEditingId(null);
  };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Projects</h1>
          <p className="page__subtitle mono-label">
            {projects.length} project{projects.length === 1 ? '' : 's'} ·
            {' '}{shortenPath(projectsRoot)}
          </p>
        </div>

        <div className="page__header-tools">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <div className="page__create">
            <input
              className="setting-input page__create-input"
              placeholder="New project name…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            />
            <button className="btn-primary" onClick={handleCreate} disabled={!newName.trim()}>Create</button>
          </div>
        </div>
      </header>

      {projects.length === 0 && (
        <div className="page__empty">
          No projects yet. Create one above to begin the journey.
        </div>
      )}

      {viewMode === 'atlas' && (
        <div className="atlas-list">
          {projects.map(p => {
            const stats = statsByProject.get(p.id) ?? { count: 0, cost: 0, durationMs: 0 };
            const projectGens = allGens.filter(g => g.projectId === p.id);
            const isOpen = openProjectId === p.id;
            return (
              <AtlasCard
                key={p.id}
                project={p}
                stats={stats}
                generations={projectGens}
                isOpen={isOpen}
                isEditing={editingId === p.id}
                editingName={editingName}
                onEditStart={() => { setEditingId(p.id); setEditingName(p.name); }}
                onEditCancel={() => setEditingId(null)}
                onEditCommit={async () => {
                  if (editingId && editingName.trim()) await renameProject(editingId, editingName.trim());
                  setEditingId(null);
                }}
                onEditChange={setEditingName}
                onToggle={() => setOpenProjectId(isOpen ? null : p.id)}
                onSwitch={() => handleOpen(p.id)}
                onReveal={() => handleReveal(p.slug)}
                onDelete={() => handleDelete(p)}
                onPickGen={viewPast}
                onSetCover={(imgPath) => handleSetCover(p.id, imgPath)}
              />
            );
          })}
        </div>
      )}

      {(viewMode === 'wall' || viewMode === 'wallet') && (() => {
        const activeProject = projects.find(p => p.id === activePid) ?? null;
        const activeGens = allGens.filter(g => g.projectId === activePid);
        const heroSrc = activeProject ? fileUrl(pickHeroImage(activeProject, activeGens)) : undefined;
        const idx = projects.findIndex(p => p.id === activePid);
        const accent = PROJ_COLORS[(idx < 0 ? 0 : idx) % PROJ_COLORS.length];
        const stats = activePid ? (statsByProject.get(activePid) ?? { count: 0, cost: 0, durationMs: 0 }) : null;
        const go = (delta: number) => {
          if (!projects.length) return;
          const n = (idx + delta + projects.length) % projects.length;
          chooseProject(projects[n].id);
          setImgPickerOpen(false);
        };
        return (
          <div className="proj-wallet">
            {heroSrc ? (
              <div className="proj-wallet__bg" style={{ backgroundImage: `url(${heroSrc})` }} />
            ) : (
              <div className="proj-wallet__bg proj-wallet__bg--grad" style={{ ['--pg-accent' as any]: accent }} />
            )}
            <div className="proj-wallet__tint" />
            <div className="hub-wallet">
              <div className="hub-wallet__lead">
                <h3>One project,<br />every tool.</h3>
                <p>Pick a project, then open it directly in any HJEN tool.</p>
                {projects.length === 0 ? (
                  <div className="proj-pills__empty mono-label">No projects yet — create one above</div>
                ) : (
                  <>
                    <div className="proj-picker">
                      <button className="proj-nav" onClick={() => go(-1)} aria-label="Previous project" title="Previous">‹</button>
                      {editingId === activePid && activeProject ? (
                        <input
                          autoFocus
                          className="proj-rename-input"
                          value={editingName}
                          onClick={e => e.stopPropagation()}
                          onChange={e => setEditingName(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }}
                        />
                      ) : (
                        <div className="proj-select" onClick={e => e.stopPropagation()}>
                          <button className="proj-select__btn" onClick={() => setPickerOpen(o => !o)} aria-haspopup="listbox" aria-expanded={pickerOpen}>
                            <span>{activeProject?.name ?? 'Select project'}</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                          </button>
                          {pickerOpen && (
                            <div className="proj-select__menu" role="listbox">
                              {projects.map(p => (
                                <button
                                  key={p.id}
                                  role="option"
                                  aria-selected={p.id === activePid}
                                  className={`proj-select__opt ${p.id === activePid ? 'is-active' : ''}`}
                                  onClick={() => { chooseProject(p.id); setPickerOpen(false); }}
                                >{p.name}</button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <button className="proj-nav" onClick={() => go(1)} aria-label="Next project" title="Next">›</button>
                    </div>

                    {stats && activeProject && (
                      <div className="proj-wallet__stats">
                        <Stat label="Frames" value={String(stats.count)} />
                        <Stat label="Spend" value={`$${stats.cost.toFixed(2)}`} accent />
                        <Stat label="Time" value={fmtTime(stats.durationMs)} />
                        <Stat label="Created" value={new Date(activeProject.created).toLocaleDateString()} />
                      </div>
                    )}

                    {activeGens.length > 0 && (
                      <div className="proj-imgpick" onClick={e => e.stopPropagation()}>
                        <button className="proj-imgpick__btn" onClick={() => setImgPickerOpen(o => !o)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M3 17l5-4 4 3 3-3 6 5" /></svg>
                          Change background
                        </button>
                        {imgPickerOpen && (
                          <div className="proj-imgpick__strip">
                            {activeGens.slice(0, 16).map(g => (
                              <button
                                key={g.imgPath}
                                className={`proj-imgpick__thumb ${g.imgPath === activeProject?.coverImagePath ? 'is-active' : ''}`}
                                onClick={() => { handleSetCover(activePid!, g.imgPath); }}
                                title={g.promptTitle || 'Set as background'}
                              >
                                <img src={dispSrc(g.thumbPath ?? g.imgPath, 'thumb')} alt="" loading="lazy" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {activeProject && (
                      <div className="proj-wallet__actions">
                        <button className="proj-act" onClick={() => handleOpen(activeProject.id)}>Open workspace</button>
                        <button className="proj-act" onClick={() => handleReveal(activeProject.slug)}>Reveal</button>
                        <button className="proj-act" onClick={() => handleRenameActive(activeProject)}>Rename</button>
                        <button className="proj-act proj-act--danger" onClick={() => handleDelete(activeProject)}>Delete</button>
                      </div>
                    )}
                  </>
                )}
                <div className="hub-wallet__hint">{viewMode === 'wallet'
                  ? 'Hover the stack to fan it open · the hovered card lifts up — click to open this project in it.'
                  : 'Click a tool to open this project in it.'}</div>
              </div>
              {viewMode === 'wall' ? (
                <div className="proj-tools">
                  {TOOLS.map((t, i) => {
                    const ink = inkOf(t.accent);
                    const disabled = t.status !== 'available' || !activePid;
                    return (
                      <button
                        key={t.id}
                        className={`proj-tool proj-tool--ink-${ink} ${disabled ? 'proj-tool--soon' : ''}`}
                        disabled={disabled}
                        style={{ background: t.accent }}
                        onClick={() => launchTool(t)}
                      >
                        <span className="proj-tool__no mono-label">{String(i + 1).padStart(2, '0')}</span>
                        <span className="proj-tool__nm">{t.name}</span>
                        <span className="proj-tool__ds">{t.tagline}</span>
                        <span className="proj-tool__st mono-label">{toolStatus(t.status)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="hub-deck">
                  {TOOLS.map((t, i) => {
                    const ink = inkOf(t.accent);
                    const disabled = t.status !== 'available' || !activePid;
                    return (
                      <button
                        key={t.id}
                        className={`hub-wc hub-wc--ink-${ink}`}
                        disabled={disabled}
                        style={{ background: t.accent, ...(fanVars(i, TOOLS.length) as any) }}
                        onClick={() => launchTool(t)}
                      >
                        <span className="hub-wc__top">
                          <span className="hub-wc__nm">{t.name}</span>
                          <span className="hub-wc__st mono-label">{toolStatus(t.status)}</span>
                        </span>
                        <span className="hub-wc__ds">{t.tagline}</span>
                        <span className="hub-wc__big">{String(i + 1).padStart(2, '0')}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── view-mode toggle ────────────────────────────────────────
function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="view-toggle" role="tablist" aria-label="Projects view mode">
      <button
        role="tab"
        aria-selected={mode === 'atlas'}
        className={`view-toggle__btn ${mode === 'atlas' ? 'is-active' : ''}`}
        onClick={() => onChange('atlas')}
        title="Atlas — cinematic hero rows with the journey rail"
      >
        <AtlasIcon /> <span>Atlas</span>
      </button>
      <button
        role="tab"
        aria-selected={mode === 'wall'}
        className={`view-toggle__btn ${mode === 'wall' ? 'is-active' : ''}`}
        onClick={() => onChange('wall')}
        title="Wall — open this project in any tool (clear grid)"
      >
        <WallIcon /> <span>Wall</span>
      </button>
      <button
        role="tab"
        aria-selected={mode === 'wallet'}
        className={`view-toggle__btn ${mode === 'wallet' ? 'is-active' : ''}`}
        onClick={() => onChange('wallet')}
        title="Wallet — open this project directly in any HJEN tool"
      >
        <WalletIcon /> <span>Wallet</span>
      </button>
    </div>
  );
}

function AtlasIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="2" width="12" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1" y="10" width="3" height="2" fill="currentColor" />
      <rect x="5.5" y="10" width="3" height="2" fill="currentColor" opacity=".5" />
      <rect x="10" y="10" width="3" height="2" fill="currentColor" opacity=".3" />
    </svg>
  );
}
function WallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="3.5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="5.25" y="1" width="3.5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.5" y="1" width="3.5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function WalletIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="9" width="16" height="11" rx="2.5" />
      <path d="M6 9V7a2 2 0 0 1 2-2h10" />
      <path d="M7 6l1-2h9" />
    </svg>
  );
}

// ─── shared card props ───────────────────────────────────────
interface CardProps {
  project: ProjectMeta;
  stats: { count: number; cost: number; durationMs: number };
  generations: GlobalGenerationEntry[];
  isOpen: boolean;
  isEditing: boolean;
  editingName: string;
  onEditStart: () => void;
  onEditCancel: () => void;
  onEditCommit: () => void;
  onEditChange: (v: string) => void;
  onToggle: () => void;
  onSwitch: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onPickGen: (g: any) => void;
  onSetCover: (imgPath: string | null) => void | Promise<void>;
}

/** Pick the image to render as the project hero. Prefer the user-pinned
 *  cover; fall back to the most recent generation. Always full-res PNG —
 *  the storyboard-strip thumbs are the small ones, the hero is not. */
function pickHeroImage(project: ProjectMeta, generations: GlobalGenerationEntry[]): string | undefined {
  if (project.coverImagePath) return project.coverImagePath;
  return generations[0]?.imgPath;
}

// ─── ATLAS card ──────────────────────────────────────────────
const AtlasCard = memo(function AtlasCard(props: CardProps) {
  const { project, stats, generations, isOpen } = props;
  const cur = currentStageIndex(stats.count);
  const heroSrc = fileUrl(pickHeroImage(project, generations));
  const coverPath = project.coverImagePath ?? null;

  return (
    <article className={`atlas-card ${isOpen ? 'atlas-card--open' : ''}`}>
      <div className="atlas-card__hero">
        <div className="atlas-card__poster">
          {heroSrc ? (
            <img className="atlas-card__poster-img" src={heroSrc} alt="" loading="lazy" />
          ) : (
            <div className="atlas-card__poster-empty">No frames yet</div>
          )}
          <div className="atlas-card__poster-tag">{STAGES[cur].n} · {STAGES[cur].name.toUpperCase()}</div>
        </div>

        <div className="atlas-card__body">
          <div className="atlas-card__crumbs mono-label">
            {project.slug} · Phase {STAGES[cur].n} of 08 · {STAGES[cur].name}
          </div>

          <div className="atlas-card__title-row">
            {props.isEditing ? (
              <input
                autoFocus
                className="atlas-card__title-input"
                value={props.editingName}
                onChange={e => props.onEditChange(e.target.value)}
                onBlur={props.onEditCommit}
                onKeyDown={e => { if (e.key === 'Enter') props.onEditCommit(); if (e.key === 'Escape') props.onEditCancel(); }}
              />
            ) : (
              <h2 className="atlas-card__title">{project.name}</h2>
            )}
          </div>

          <div className="atlas-card__stats">
            <Stat label="Frames" value={String(stats.count)} />
            <Stat label="Spend" value={`$${stats.cost.toFixed(2)}`} accent />
            <Stat label="Time" value={fmtTime(stats.durationMs)} />
            <Stat label="Created" value={new Date(project.created).toLocaleDateString()} />
          </div>

          <div className="atlas-card__actions">
            <button className="atlas-card__cta" onClick={props.onSwitch}>Open in Studio</button>
            <button className="atlas-card__btn" onClick={props.onToggle}>
              {isOpen ? 'Hide frames' : `Show ${stats.count} frame${stats.count === 1 ? '' : 's'}`}
            </button>
            <button className="atlas-card__btn" onClick={props.onReveal}>Reveal</button>
            <button className="atlas-card__btn" onClick={props.onEditStart}>Rename</button>
            <button className="atlas-card__btn atlas-card__btn--danger" onClick={props.onDelete}>Delete</button>
          </div>
        </div>
      </div>

      <div className="atlas-card__rail" aria-label="Project pipeline">
        {STAGES.map((s, i) => {
          const cls = i < cur ? 'atlas-stage atlas-stage--done'
            : i === cur ? 'atlas-stage atlas-stage--current'
            : 'atlas-stage';
          return (
            <div key={s.n} className={cls}>
              <span className="atlas-stage__dot" />
              <span className="atlas-stage__n mono-label">{s.n}</span>
              <span className="atlas-stage__name">{s.name}</span>
            </div>
          );
        })}
      </div>

      {isOpen && (
        <div className="atlas-card__gens">
          {generations.length === 0 ? (
            <div className="atlas-card__gens-empty">No frames yet in this project.</div>
          ) : (
            <div className="atlas-card__gens-grid">
              {generations.map(g => (
                <GenTile
                  key={g.imgPath}
                  g={g}
                  onPick={props.onPickGen}
                  isCover={g.imgPath === coverPath}
                  onSetCover={props.onSetCover}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
});

// ─── WALL card ───────────────────────────────────────────────
const WallCard = memo(function WallCard(props: CardProps) {
  const { project, stats, generations, isOpen } = props;
  const cur = currentStageIndex(stats.count);
  const heroSrc = fileUrl(pickHeroImage(project, generations));
  const coverPath = project.coverImagePath ?? null;
  // Small strip still uses thumbs for performance; hero uses full PNG.
  const stripThumbs = generations.slice(0, 4).map(g => dispSrc(g.thumbPath ?? g.imgPath, 'thumb')).filter(Boolean) as string[];

  return (
    <article className={`wall-card ${isOpen ? 'wall-card--open' : ''}`}>
      <div className="wall-card__map" aria-label="Stage map">
        {STAGES.map((s, i) => {
          const cls = i < cur ? 'wall-cell wall-cell--filled'
            : i === cur ? 'wall-cell wall-cell--current'
            : 'wall-cell';
          return <span key={s.n} className={cls} title={`${s.n} · ${s.name}`} />;
        })}
      </div>

      <div className="wall-card__body">
        <div className="wall-card__head">
          {props.isEditing ? (
            <input
              autoFocus
              className="wall-card__title-input"
              value={props.editingName}
              onChange={e => props.onEditChange(e.target.value)}
              onBlur={props.onEditCommit}
              onKeyDown={e => { if (e.key === 'Enter') props.onEditCommit(); if (e.key === 'Escape') props.onEditCancel(); }}
            />
          ) : (
            <h2 className="wall-card__title">
              {project.name}
              <small>{STAGES[cur].n} · {STAGES[cur].name}</small>
            </h2>
          )}
        </div>

        <div className="wall-card__strip">
          {heroSrc ? (
            <img className="wall-card__strip-img wall-card__strip-img--hero" src={heroSrc} alt="" loading="lazy" />
          ) : null}
          {stripThumbs.length === 0 && !heroSrc ? (
            <div className="wall-card__strip-empty">No frames yet</div>
          ) : (
            stripThumbs.slice(1).map((t, i) => (
              <img key={i} className="wall-card__strip-img" src={t} alt="" loading="lazy" />
            ))
          )}
        </div>

        <div className="wall-card__stats">
          <Stat label="Frames" value={String(stats.count)} />
          <Stat label="Spend" value={`$${stats.cost.toFixed(2)}`} accent />
          <Stat label="Time" value={fmtTime(stats.durationMs)} />
        </div>

        <div className="wall-card__actions">
          <button className="wall-card__cta" onClick={props.onSwitch}>Open in Studio</button>
          <button className="wall-card__btn" onClick={props.onToggle} title={isOpen ? 'Hide frames' : 'Show frames'}>
            {isOpen ? '▴' : `▾ ${stats.count}`}
          </button>
          <button className="wall-card__btn" onClick={props.onReveal} title="Reveal in Finder">⤴</button>
          <button className="wall-card__btn" onClick={props.onEditStart} title="Rename">✎</button>
          <button className="wall-card__btn wall-card__btn--danger" onClick={props.onDelete} title="Delete">×</button>
        </div>
      </div>

      {isOpen && (
        <div className="wall-card__gens">
          {generations.length === 0 ? (
            <div className="wall-card__gens-empty">No frames yet in this project.</div>
          ) : (
            <div className="wall-card__gens-grid">
              {generations.map(g => (
                <GenTile
                  key={g.imgPath}
                  g={g}
                  onPick={props.onPickGen}
                  isCover={g.imgPath === coverPath}
                  onSetCover={props.onSetCover}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
});

// ─── shared bits ─────────────────────────────────────────────
function GenTile({
  g, onPick, isCover, onSetCover,
}: {
  g: GlobalGenerationEntry;
  onPick: (g: any) => void;
  isCover: boolean;
  onSetCover: (imgPath: string | null) => void | Promise<void>;
}) {
  return (
    <div className={`gen-tile ${isCover ? 'gen-tile--is-cover' : ''}`} title={g.promptTitle}>
      <button
        type="button"
        className="gen-tile__thumb-btn"
        onClick={() => onPick(g)}
        aria-label="Open frame"
      >
        <img className="gen-tile__thumb" src={dispSrc(g.thumbPath ?? g.imgPath, 'thumb')} alt="" loading="lazy" />
        {isCover && <span className="gen-tile__cover-flag mono-label">COVER</span>}
        <QualityBadge quality={g.quality} variant="overlay" />
      </button>
      <div className="gen-tile__body">
        <div className="gen-tile__title selectable" title={g.promptTitle}>{cleanTitle(g.promptTitle)}</div>
        <div className="gen-tile__meta mono-label">
          <DimsTag size={g.finalSize} path={g.imgPath} />
          <span className="selectable">{new Date(g.ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
        </div>
        <div className="gen-tile__stats">
          {g.costUsd !== undefined && <span className="gen-tile__cost">${g.costUsd.toFixed(3)}</span>}
          {g.durationMs !== undefined && <span className="gen-tile__time">{fmtTime(g.durationMs)}</span>}
        </div>
        <div className="gen-tile__actions">
          {isCover ? (
            <button
              type="button"
              className="gen-tile__action gen-tile__action--active"
              onClick={() => onSetCover(null)}
              title="Remove as project cover"
            >★ Cover</button>
          ) : (
            <button
              type="button"
              className="gen-tile__action"
              onClick={() => onSetCover(g.imgPath)}
              title="Use this frame as the project cover"
            >☆ Set as cover</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="stat">
      <div className="mono-label stat__label">{label}</div>
      <div className={`stat__value ${accent ? 'stat__value--accent' : ''}`}>{value}</div>
    </div>
  );
}

function fmtTime(ms: number): string {
  if (!ms) return '0s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function shortenPath(p: string): string {
  return p ? p.replace(/^\/Users\/[^/]+/, '~') : '';
}
