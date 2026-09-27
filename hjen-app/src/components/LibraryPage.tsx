import { useEffect, useRef, useState } from 'react';
import { useStore, LAYER_CATEGORIES } from '../store';
import type { LibCategory, LibraryAsset, Skill } from '../types/hjen-bridge';
import { LayerPreviewModal, type PreviewTarget } from './LayerPreviewModal';

function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

export function LibraryPage() {
  const library = useStore(s => s.library);
  const projectsRoot = useStore(s => s.projectsRoot);
  const uploadToLibrary = useStore(s => s.uploadToLibrary);
  const pickLibraryFiles = useStore(s => s.pickLibraryFiles);
  const deleteLibraryAsset = useStore(s => s.deleteLibraryAsset);
  const moveLibraryAsset = useStore(s => s.moveLibraryAsset);
  const bulkDeleteLibraryAssets = useStore(s => s.bulkDeleteLibraryAssets);
  const dedupLibrary = useStore(s => s.dedupLibrary);
  const loadLibrary = useStore(s => s.loadLibrary);

  // Re-fetch library.json on every mount. Cheap (one IPC + JSON parse) and
  // it covers the case where the file was changed externally — e.g. a
  // command-line dedup, or a manual edit in Finder — while the renderer
  // held a stale in-memory snapshot.
  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  const [mode, setMode] = useState<'refs' | 'skills'>(() =>
    sessionStorage.getItem('hjen:library-mode') === 'skills' ? 'skills' : 'refs'
  );
  useEffect(() => { sessionStorage.setItem('hjen:library-mode', mode); }, [mode]);
  useEffect(() => {
    const openSkills = () => setMode('skills');
    window.addEventListener('hjen:open-skills-library', openSkills);
    return () => window.removeEventListener('hjen:open-skills-library', openSkills);
  }, []);
  const [tab, setTab] = useState<LibCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  // Click any library tile (normal mode) → open the same 50%-of-frame
  // preview modal used in the Layers sidebar and the GenerationPreview
  // ref panel.
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  // Files chosen by the user but not yet assigned a category. While this
  // is non-null, an overlay asks them which category to add to.
  const [pendingFiles, setPendingFiles] = useState<string[] | null>(null);
  // Select mode: tiles become click-to-toggle for bulk operations.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Inline "Move to ▾" popover open state for the bulk action.
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Shift+click range anchor: the last tile clicked WITHOUT shift. Holding
  // Shift and clicking another tile selects everything between the two in
  // display order (matches Finder / Photos.app convention).
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  // Marquee (box) drag-select. `marquee` is the live rect in grid-local
  // coords for rendering. `marqueeStartRef` + `marqueeBaseRef` hold drag
  // state that handlers need to read without closure staleness.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeBaseRef = useRef<Set<string> | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Map<assetId, tile DOM node> — populated via callback refs on each tile
  // so the marquee can compute intersections without a DOM query.
  const tileNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Library lives at {projectsRoot}/_library on disk. Click to reveal in
  // Finder so the user can manage files manually (drag-drop, batch tools).
  const libraryPath = projectsRoot ? `${projectsRoot}/_library` : '';
  const openLibraryFolder = () => libraryPath && window.hjen.openFolder(libraryPath);

  const filtered: LibraryAsset[] = library.filter(a => {
    if (tab !== 'all' && a.category !== tab) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Upload flow: pick files first, then ask category. Splitting these
  // lets one button cover all categories AND lets a single picker pass
  // upload many files at once (bulk).
  const startUpload = async () => {
    const paths = await pickLibraryFiles();
    if (paths && paths.length > 0) setPendingFiles(paths);
  };
  const finishUpload = async (cat: LibCategory) => {
    if (!pendingFiles) return;
    setBusy(true);
    try { await uploadToLibrary(cat, pendingFiles); }
    finally { setBusy(false); setPendingFiles(null); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // Tile click in select mode. Shift+click extends the selection from the
  // anchor (last non-shift click) to the clicked tile in `filtered` order.
  // Plain click toggles individual + becomes the new anchor.
  const handleTileSelectClick = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedId && lastClickedId !== id) {
      const ids = filtered.map(a => a.id);
      const i0 = ids.indexOf(lastClickedId);
      const i1 = ids.indexOf(id);
      if (i0 >= 0 && i1 >= 0) {
        const [lo, hi] = i0 < i1 ? [i0, i1] : [i1, i0];
        const range = ids.slice(lo, hi + 1);
        setSelectedIds(prev => {
          const next = new Set(prev);
          for (const r of range) next.add(r);
          return next;
        });
        return;
      }
    }
    toggleSelect(id);
    setLastClickedId(id);
  };
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setMoveMenuOpen(false);
    setLastClickedId(null);
  };

  // Marquee drag — only fires when the pointer-down lands on the grid
  // background (not inside a tile). Shift held at drag-start keeps the
  // existing selection as a baseline; otherwise the drag REPLACES it.
  const onGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectMode) return;
    if (e.target !== gridRef.current) return;
    if (e.button !== 0) return;
    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    marqueeStartRef.current = { x, y };
    marqueeBaseRef.current = e.shiftKey ? new Set(selectedIds) : new Set();
    setMarquee({ x0: x, y0: y, x1: x, y1: y });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onGridPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = marqueeStartRef.current;
    if (!start || !gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const x1 = e.clientX - rect.left;
    const y1 = e.clientY - rect.top;
    setMarquee({ x0: start.x, y0: start.y, x1, y1 });

    const minX = Math.min(start.x, x1);
    const maxX = Math.max(start.x, x1);
    const minY = Math.min(start.y, y1);
    const maxY = Math.max(start.y, y1);
    const base = marqueeBaseRef.current || new Set<string>();
    const next = new Set(base);
    for (const [id, el] of tileNodesRef.current) {
      const r = el.getBoundingClientRect();
      const tx0 = r.left - rect.left;
      const ty0 = r.top - rect.top;
      const tx1 = r.right - rect.left;
      const ty1 = r.bottom - rect.top;
      const intersects = !(tx1 < minX || tx0 > maxX || ty1 < minY || ty0 > maxY);
      if (intersects) next.add(id);
    }
    setSelectedIds(next);
  };
  const onGridPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!marqueeStartRef.current) return;
    marqueeStartRef.current = null;
    marqueeBaseRef.current = null;
    setMarquee(null);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };
  const handleBulkMove = async (cat: LibCategory) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBusy(true);
    setMoveMenuOpen(false);
    try {
      // Sequential — each move is a rename on disk; serialise to keep
      // the index writes ordered and avoid a read-modify-write race.
      for (const id of ids) await moveLibraryAsset(id, cat);
    } finally {
      setBusy(false);
      exitSelectMode();
    }
  };
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} asset${ids.length === 1 ? '' : 's'}?\n\nFiles are removed from disk and detached from any current frame.`)) return;
    setBusy(true);
    try { await bulkDeleteLibraryAssets(ids); }
    finally { setBusy(false); exitSelectMode(); }
  };
  const handleDedup = async () => {
    if (!confirm('Scan the library for duplicate images and remove copies?\n\nFor each duplicate group the oldest file is kept; newer copies are deleted from disk. Layers pointing at deleted copies are rewired to the survivor.')) return;
    setBusy(true);
    try {
      const r = await dedupLibrary();
      const mb = (r.freedBytes / (1024 * 1024)).toFixed(1);
      alert(`Done.\n\nRemoved ${r.removed} duplicate${r.removed === 1 ? '' : 's'} · freed ${mb} MB${r.backfilled ? ` · backfilled ${r.backfilled} hash${r.backfilled === 1 ? '' : 'es'}` : ''}.`);
    } finally { setBusy(false); }
  };

  const totalBytes = library.reduce((s, a) => s + (a.bytes ?? 0), 0);

  return (
    <div className="page library-page">
      <header className="page__header">
        <div>
          <h1 className="page__title">{mode === 'refs' ? 'Reference Library' : 'Skills'}</h1>
          {mode === 'refs' ? (
            <p className="page__subtitle mono-label">
              {library.length} asset{library.length === 1 ? '' : 's'} · {fmtBytes(totalBytes)} on disk · shared across all projects
            </p>
          ) : (
            <SkillsSubtitle />
          )}
        </div>
        {mode === 'refs' && (
          <div className="page__create">
            <input
              className="setting-input page__create-input"
              placeholder="Filter by name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        )}
      </header>

      <div className="lib-finder">
        {/* Finder-style sidebar: mode switch, category list, reveal-in-Finder */}
        <aside className="lib-sidebar">
          <div className="lib-sidebar__modes">
            <button
              className={`library-mode-btn ${mode === 'refs' ? 'library-mode-btn--active' : ''}`}
              onClick={() => setMode('refs')}
            >References</button>
            <button
              className={`library-mode-btn ${mode === 'skills' ? 'library-mode-btn--active' : ''}`}
              onClick={() => setMode('skills')}
            >Skills</button>
          </div>

          {mode === 'refs' && (
            <nav className="lib-sidebar__cats" aria-label="Categories">
              <button
                className={`lib-sidebar__cat ${tab === 'all' ? 'lib-sidebar__cat--active' : ''}`}
                onClick={() => setTab('all')}
              >
                <span className="lib-sidebar__cat-name">All</span>
                <span className="lib-sidebar__cat-count mono-label">{library.length}</span>
              </button>
              {LAYER_CATEGORIES.map(cat => {
                const count = library.filter(a => a.category === cat.id).length;
                return (
                  <button
                    key={cat.id}
                    className={`lib-sidebar__cat ${tab === cat.id ? 'lib-sidebar__cat--active' : ''}`}
                    onClick={() => setTab(cat.id)}
                  >
                    <span className="lib-sidebar__cat-name">{cat.label}</span>
                    <span className="lib-sidebar__cat-count mono-label">{count}</span>
                  </button>
                );
              })}
            </nav>
          )}

          {mode === 'refs' && libraryPath && (
            <button
              className="library-path-link mono-label lib-sidebar__reveal"
              onClick={openLibraryFolder}
              title="Reveal library folder in Finder"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
                <path d="M1.5 4.5h4l1.5 1.5h7.5v8h-13z" />
              </svg>
              Reveal in Finder
            </button>
          )}
        </aside>

        <main className="lib-main">
          {mode === 'skills' && <SkillsPanel />}

          {mode === 'refs' && <>
          <div className="lib-toolbar">
            <div className="library-tabs__spacer" />
            {!selectMode ? (
              <>
                <button
                  className="library-upload-btn"
                  onClick={startUpload}
                  disabled={busy || pendingFiles !== null}
                  title="Pick one or more images, then choose which category to add them to"
                >Upload</button>
                <button
                  className="library-upload-btn library-upload-btn--ghost"
                  onClick={() => setSelectMode(true)}
                  disabled={library.length === 0}
                  title="Enter multi-select mode to move or delete several assets at once"
                >Select</button>
                <button
                  className="library-upload-btn library-upload-btn--ghost"
                  onClick={handleDedup}
                  disabled={busy || library.length === 0}
                  title="Scan for duplicate images and remove copies"
                >Dedup</button>
              </>
            ) : (
              <div className="library-select-bar">
                <span className="library-select-bar__count mono-label">
                  {selectedIds.size} selected
                </span>
                <div className="library-select-bar__move-wrap">
                  <button
                    className="library-upload-btn"
                    onClick={() => setMoveMenuOpen(o => !o)}
                    disabled={busy || selectedIds.size === 0}
                  >Move to ▾</button>
                  {moveMenuOpen && (
                    <div className="library-select-bar__menu" onClick={e => e.stopPropagation()}>
                      {LAYER_CATEGORIES.map(cat => (
                        <button
                          key={cat.id}
                          className="library-select-bar__menu-item"
                          onClick={() => handleBulkMove(cat.id)}
                        >{cat.label}</button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="library-upload-btn library-upload-btn--danger"
                  onClick={handleBulkDelete}
                  disabled={busy || selectedIds.size === 0}
                >Delete</button>
                <button
                  className="library-upload-btn library-upload-btn--ghost"
                  onClick={exitSelectMode}
                >Done</button>
              </div>
            )}
          </div>

          {pendingFiles && (
        <div className="library-pending-bar" role="dialog" aria-label="Pick destination category">
          <div className="library-pending-bar__label">
            <strong>{pendingFiles.length}</strong> file{pendingFiles.length === 1 ? '' : 's'} chosen — add to:
          </div>
          <div className="library-pending-bar__cats">
            {LAYER_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                className="library-upload-btn"
                onClick={() => finishUpload(cat.id)}
                disabled={busy}
              >{cat.label}</button>
            ))}
          </div>
          <button
            className="library-upload-btn library-upload-btn--ghost"
            onClick={() => setPendingFiles(null)}
            disabled={busy}
          >Cancel</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="page__empty">
          {library.length === 0
            ? 'Your library is empty. Click Upload to add reference images.'
            : 'No matches.'}
        </div>
      ) : (
        <div
          ref={gridRef}
          className={`library-page-grid ${selectMode ? 'library-page-grid--selectable' : ''}`}
          onPointerDown={onGridPointerDown}
          onPointerMove={onGridPointerMove}
          onPointerUp={onGridPointerUp}
          onPointerCancel={onGridPointerUp}
        >
          {filtered.map(asset => {
            const isSelected = selectedIds.has(asset.id);
            return (
              <div
                key={asset.id}
                ref={el => {
                  if (el) tileNodesRef.current.set(asset.id, el);
                  else tileNodesRef.current.delete(asset.id);
                }}
                className={`library-page-tile ${selectMode ? 'library-page-tile--selectable' : ''} ${isSelected ? 'library-page-tile--selected' : ''}`}
              >
                <img
                  className="library-page-tile__thumb"
                  src={fileUrl(asset.thumbPath)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  style={{ cursor: selectMode ? 'pointer' : 'zoom-in' }}
                  onClick={(e) => selectMode
                    ? handleTileSelectClick(asset.id, e)
                    : setPreviewTarget({ filePath: asset.filePath, name: asset.name })}
                  title={selectMode ? 'Click to select · Shift+click to extend selection' : 'Click to preview'}
                />
                {selectMode && (
                  <div
                    className={`library-page-tile__check ${isSelected ? 'library-page-tile__check--on' : ''}`}
                    onClick={(e) => { e.stopPropagation(); handleTileSelectClick(asset.id, e); }}
                    title={isSelected ? 'Selected — click to deselect' : 'Click to select'}
                  >
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8l4 4 6-8" />
                      </svg>
                    )}
                  </div>
                )}
                <div className="library-page-tile__body">
                  <div className="library-page-tile__name">{asset.name}</div>
                  <div className="library-page-tile__meta mono-label">
                    {asset.category} · {fmtBytes(asset.bytes)}
                  </div>
                </div>
                {!selectMode && (
                  <button
                    className="library-page-tile__delete"
                    onClick={() => {
                      if (confirm(`Delete "${asset.name}"?\n\nThe file is removed from disk and detached from any current frame.`)) {
                        deleteLibraryAsset(asset.id);
                      }
                    }}
                    title="Delete"
                  >×</button>
                )}
              </div>
            );
          })}
          {marquee && (
            <div
              className="library-marquee"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
              }}
            />
          )}
        </div>
      )}
          </>}
        </main>
      </div>

      <LayerPreviewModal target={previewTarget} onClose={() => setPreviewTarget(null)} />
    </div>
  );
}

function SkillsSubtitle() {
  const skills = useStore(s => s.skills);
  const totalBytes = skills.reduce((s, k) => s + (k.bytes ?? 0), 0);
  return (
    <p className="page__subtitle mono-label">
      {skills.length} skill{skills.length === 1 ? '' : 's'} installed · {fmtBytes(totalBytes)} on disk
    </p>
  );
}

function SkillsPanel() {
  const skills = useStore(s => s.skills);
  const loadSkills = useStore(s => s.loadSkills);
  const importSkill = useStore(s => s.importSkill);
  const saveSkill = useStore(s => s.saveSkill);
  const deleteSkill = useStore(s => s.deleteSkill);
  const skillImportError = useStore(s => s.skillImportError);
  const clearSkillImportError = useStore(s => s.clearSkillImportError);
  const [importing, setImporting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [skillsFolder, setSkillsFolder] = useState('');
  // undefined = closed, null = create, Skill = edit.
  const [editorSkill, setEditorSkill] = useState<Skill | null | undefined>(undefined);

  useEffect(() => {
    void loadSkills();
    void window.hjen.getSkillsFolder().then(setSkillsFolder);
    const refreshOnFocus = () => { void loadSkills(); };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [loadSkills]);

  useEffect(() => {
    if (sessionStorage.getItem('hjen:skill-editor') !== 'new') return;
    sessionStorage.removeItem('hjen:skill-editor');
    setEditorSkill(null);
  }, []);

  useEffect(() => {
    const openFromDropdown = (event: Event) => {
      if (!(event as CustomEvent<{ create?: boolean }>).detail?.create) return;
      sessionStorage.removeItem('hjen:skill-editor');
      setEditorSkill(null);
    };
    window.addEventListener('hjen:open-skills-library', openFromDropdown);
    return () => window.removeEventListener('hjen:open-skills-library', openFromDropdown);
  }, []);

  const handleImport = async () => {
    setImporting(true);
    try { await importSkill(); } finally { setImporting(false); }
  };

  return (
    <div className="skills-panel">
      <div className="skills-panel__head">
        <div className="skills-panel__actions">
          <button
            className="library-upload-btn"
            onClick={() => setEditorSkill(null)}
          >
            New Skill
          </button>
          <button
            className="library-upload-btn library-upload-btn--ghost"
            onClick={() => { void window.hjen.openSkillsFolder(); }}
          >
            Open Folder
          </button>
          <button
            className="library-upload-btn library-upload-btn--ghost"
            onClick={handleImport}
            disabled={importing}
          >
            {importing ? 'Importing…' : 'Import .md'}
          </button>
        </div>
        <div className="skills-panel__folder">
          <div className="skills-panel__hint mono-label">
            Add a .md file or a folder containing SKILL.md. The list refreshes when you return.
          </div>
          {skillsFolder && <code title={skillsFolder}>{skillsFolder}</code>}
        </div>
      </div>

      {skillImportError && (
        <div className="skills-panel__error" role="alert">
          <span>{skillImportError}</span>
          <button className="skills-panel__error-close" onClick={clearSkillImportError}>×</button>
        </div>
      )}

      {skills.length === 0 ? (
        <div className="page__empty">
          No skills found. Open the Skills folder and add <code>my-skill.md</code> or <code>my-skill/SKILL.md</code>.
        </div>
      ) : (
        <div className="skills-list">
          {skills.map(skill => (
            <SkillRow
              key={skill.id}
              skill={skill}
              expanded={expanded === skill.id}
              onToggle={() => setExpanded(prev => prev === skill.id ? null : skill.id)}
              onEdit={() => setEditorSkill(skill)}
              onDelete={() => {
                if (confirm(`Delete skill "${skill.name}"?\n\nThe .md file is removed from disk.`)) {
                  deleteSkill(skill.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {editorSkill !== undefined && (
        <SkillEditor
          key={editorSkill?.id || 'new'}
          skill={editorSkill}
          onClose={() => setEditorSkill(undefined)}
          onSave={async draft => {
            const result = await saveSkill(draft);
            if (result.ok) setEditorSkill(undefined);
            return result;
          }}
        />
      )}
    </div>
  );
}

function SkillRow({ skill, expanded, onToggle, onEdit, onDelete }: {
  skill: Skill;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`skill-row ${expanded ? 'skill-row--expanded' : ''}`}>
      <div className="skill-row__head">
        <button className="skill-row__toggle" onClick={onToggle} title={expanded ? 'Collapse' : 'Show skill body'}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
            <path d="M3 1.5L7 5L3 8.5" />
          </svg>
        </button>
        <div className="skill-row__body">
          <div className="skill-row__name">{skill.name}</div>
          {skill.description && <div className="skill-row__desc">{skill.description}</div>}
          <div className="skill-row__meta mono-label">
            {skill.version && <>v{skill.version} · </>}
            {fmtBytes(skill.bytes)} · added {new Date(skill.importedAt).toLocaleDateString()}
          </div>
        </div>
        <button className="skill-row__edit" onClick={onEdit}>Edit</button>
        <button className="skill-row__delete" onClick={onDelete} title="Delete">×</button>
      </div>
      {expanded && (
        <pre className="skill-row__content">{skill.body}</pre>
      )}
    </div>
  );
}

function SkillEditor({ skill, onClose, onSave }: {
  skill: Skill | null;
  onClose: () => void;
  onSave: (draft: { id?: string | null; name: string; description?: string; version?: string; body: string }) => Promise<{ ok: boolean; reason?: string; message?: string }>;
}) {
  const [name, setName] = useState(skill?.name || '');
  const [description, setDescription] = useState(skill?.description || '');
  const [version, setVersion] = useState(skill?.version || '1.0.0');
  const [body, setBody] = useState(skill?.body || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Give the skill a name.'); return; }
    if (!body.trim()) { setError('Write the skill instructions before saving.'); return; }
    setSaving(true);
    setError('');
    try {
      const result = await onSave({ id: skill?.id, name, description, version, body });
      if (!result.ok) {
        const message = result.reason === 'already_exists' ? 'A skill with this name already exists.'
          : result.reason === 'not_found' ? 'The original skill file is no longer in the folder.'
          : result.reason === 'write_failed' ? (result.message || 'HJEN could not write the skill file.')
          : 'The skill could not be saved.';
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  return (
    <div className="skill-editor-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <form className="skill-editor" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="skill-editor-title">
        <header className="skill-editor__head">
          <div>
            <div className="mono-label">{skill ? 'Edit skill' : 'New skill'}</div>
            <h2 id="skill-editor-title">{skill ? skill.name : 'Create inside HJEN'}</h2>
          </div>
          <button type="button" className="skill-editor__close" onClick={onClose} disabled={saving} aria-label="Close">×</button>
        </header>

        <div className="skill-editor__meta">
          <label>
            <span className="mono-label">Name</span>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Gulf Editorial Portrait" />
          </label>
          <label>
            <span className="mono-label">Version</span>
            <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.0.0" />
          </label>
        </div>
        <label className="skill-editor__field">
          <span className="mono-label">Description</span>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="One line explaining what this skill does" />
        </label>
        <label className="skill-editor__field skill-editor__field--body">
          <span className="mono-label">Skill instructions</span>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write the instruction set HJEN should apply to the user's prompt…"
            spellCheck={false}
          />
        </label>

        {error && <div className="skill-editor__error" role="alert">{error}</div>}
        <footer className="skill-editor__foot">
          <span className="mono-label">Saved as Markdown in the Skills folder</span>
          <div>
            <button type="button" className="library-upload-btn library-upload-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="library-upload-btn" disabled={saving}>{saving ? 'Saving…' : 'Save Skill'}</button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function fmtBytes(b: number): string {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
