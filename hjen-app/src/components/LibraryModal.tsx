import { useEffect, useState } from 'react';
import { useStore, LAYER_CATEGORIES } from '../store';
import type { LibCategory, LibraryAsset } from '../types/hjen-bridge';
import type { AssetsData } from '../types/assets';
import { resolveRefs, type ResolvedRef } from '../lib/assets/payload';
import { dispSrc } from '../lib/dispUrl';

function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

/** One frame from the open project's reference set, shaped for the same grid
 *  the library tiles use. */
interface ProjectRef { id: string; name: string; filePath: string }

export function LibraryModal() {
  const library = useStore(s => s.library);
  const targetCategory = useStore(s => s.libraryPickerCategory);
  const targetParentId = useStore(s => s.libraryPickerParentId);
  const layers = useStore(s => s.layers);
  const close = useStore(s => s.closePicker);
  const addLayer = useStore(s => s.addLayer);
  const uploadToLibrary = useStore(s => s.uploadToLibrary);
  const deleteLibraryAsset = useStore(s => s.deleteLibraryAsset);
  const projects = useStore(s => s.projects);
  const activeProjectId = useStore(s => s.activeProjectId);

  const parentLayer = targetParentId ? layers.find(l => l.id === targetParentId) : null;
  const parentDisplay = parentLayer ? (parentLayer.customName || parentLayer.name) : null;

  const [activeTab, setActiveTab] = useState<LibCategory | 'all'>(targetCategory ?? 'all');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState<LibCategory | null>(null);

  // ── Source: the shared LIBRARY, or THIS project's References ──────────────
  // The library is the durable shelf that outlives any one campaign. The
  // reference set is what THIS project actually gathered — hunted, imported, or
  // clipped from the browser — and until now the only way to use one as a layer
  // was to hunt down the file on disk and upload it again. Same picker, one
  // more source, no copy.
  // A third source: the project's ASSETS (stage 6). A built character, place,
  // prop or garment is exactly what a layer wants, and going through the asset
  // book carries the plate's ROLE with it — so an identity face lands as a
  // character reference and a hard-bound location lands as a composition lock,
  // instead of every pick becoming an anonymous "general".
  const [source, setSource] = useState<'library' | 'references' | 'assets'>('library');
  const [refs, setRefs] = useState<ProjectRef[]>([]);
  const [refsLoading, setRefsLoading] = useState(false);
  const [assetRefs, setAssetRefs] = useState<ResolvedRef[]>([]);
  const openProject = projects.find(p => p.id === activeProjectId) ?? null;

  useEffect(() => {
    if (targetCategory) setActiveTab(targetCategory);
  }, [targetCategory]);

  // References live in stage 2 of the project contract — the same set the
  // References view reads, so a frame clipped from the browser is usable as a
  // layer the moment it lands. Loaded on demand: a signed set can be large.
  useEffect(() => {
    if (source !== 'references' || !openProject) { setRefs([]); return; }
    let dead = false;
    (async () => {
      setRefsLoading(true);
      let out: ProjectRef[] = [];
      try {
        const data: any = await window.hjen.readStageData({ id: openProject.id, stage: 2 });
        out = (data?.refs || [])
          .filter((r: any) => r?.imagePath)
          .map((r: any, i: number) => ({
            id: String(r.id ?? `ref-${i}`),
            name: String(r.sourceName || r.tag || `Reference ${i + 1}`),
            filePath: String(r.imagePath),
          }));
      } catch { /* an unreadable stage file reads as an empty set */ }
      if (!dead) { setRefs(out); setRefsLoading(false); }
    })();
    return () => { dead = true; };
  }, [source, openProject]);

  // Assets live in stage 6. resolveRefs() is the same resolver the recall path
  // uses, so the picker and "Recall into Frame" can never disagree about which
  // plate is active or what category it carries.
  useEffect(() => {
    if (source !== 'assets' || !openProject) { setAssetRefs([]); return; }
    let dead = false;
    (async () => {
      let out: ResolvedRef[] = [];
      try {
        const data = (await window.hjen.readStageData({ id: openProject.id, stage: 6 })) as AssetsData | null;
        if (data?.assets?.length) out = resolveRefs(data.assets);
      } catch { /* an unreadable stage file reads as an empty book */ }
      if (!dead) setAssetRefs(out);
    })();
    return () => { dead = true; };
  }, [source, openProject]);

  const filteredRefs = refs.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()));
  const filteredAssets = assetRefs.filter(r =>
    !search || `${r.asset.name} ${r.role}`.toLowerCase().includes(search.toLowerCase()));

  /** Pick a plate. The asset's own category wins over the slot the picker was
   *  opened for — a face is a character reference wherever you clicked from. */
  const pickAsset = (r: ResolvedRef) => {
    const name = `${r.asset.name} · ${r.plate.note || r.role}`;
    addLayer(
      {
        id: `asset-${r.plate.id}`, category: r.category, name, filename: name,
        filePath: r.plate.path, thumbPath: r.plate.thumbPath || r.plate.path,
        addedAt: r.plate.at, bytes: 0,
      } satisfies LibraryAsset,
      r.category,
      targetParentId ?? undefined,
    );
    close();
  };

  /** A reference belongs to the project, not to the shelf, so it is NOT copied
   *  into the library. addLayer needs only a name and the two paths, so it goes
   *  in as a faux asset — the same shape CastView uses to recall a character's
   *  reference photos. */
  const pickRef = (r: ProjectRef) => {
    const cat: LibCategory = targetCategory ?? 'general';
    addLayer(
      {
        id: `projref-${r.id}`, category: cat, name: r.name, filename: r.name,
        filePath: r.filePath, thumbPath: r.filePath, addedAt: new Date().toISOString(), bytes: 0,
      } satisfies LibraryAsset,
      cat,
      targetParentId ?? undefined,
    );
    close();
  };

  const filtered: LibraryAsset[] = library.filter(a => {
    if (activeTab !== 'all' && a.category !== activeTab) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleUpload = async (cat: LibCategory) => {
    setUploading(cat);
    try { await uploadToLibrary(cat); } finally { setUploading(null); }
  };

  const handlePick = (asset: LibraryAsset) => {
    addLayer(asset, targetCategory ?? asset.category, targetParentId ?? undefined);
    close();
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" style={{ width: 'min(1080px, 100%)' }} onClick={e => e.stopPropagation()}>
        <header className="modal__header">
          <span className="mono-label">
            {parentDisplay
              ? `Add ${targetCategory ?? 'reference'} to "${parentDisplay}"`
              : (targetCategory ? `Pick a ${targetCategory} reference` : 'Reference library')}
          </span>
          <input
            className="modal__search"
            placeholder="Filter by name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="modal__close" onClick={close}>Close</button>
        </header>

        {/* Source switch — where the reference comes FROM. Sits above the
            category tabs because it changes what those tabs are filtering. */}
        <div className="library-tabs library-tabs--source">
          <button
            className={`library-tab ${source === 'library' ? 'library-tab--active' : ''}`}
            onClick={() => setSource('library')}
          >Library ({library.length})</button>
          <button
            className={`library-tab ${source === 'references' ? 'library-tab--active' : ''}`}
            onClick={() => setSource('references')}
            disabled={!openProject}
            title={openProject
              ? `References gathered in ${openProject.name}`
              : 'Open a project to use its references'}
          >
            Project references{source === 'references' && refs.length > 0 ? ` (${refs.length})` : ''}
          </button>
          <button
            className={`library-tab ${source === 'assets' ? 'library-tab--active' : ''}`}
            onClick={() => setSource('assets')}
            disabled={!openProject}
            title={openProject
              ? `Characters, locations, props and wardrobe built in ${openProject.name}`
              : 'Open a project to use its assets'}
          >
            Project assets{source === 'assets' && assetRefs.length > 0 ? ` (${assetRefs.length})` : ''}
          </button>
          <div className="library-tabs__spacer" />
          {source !== 'library' && openProject && (
            <span className="mono-label" style={{ opacity: 0.5, paddingInlineEnd: 4 }}>{openProject.name}</span>
          )}
        </div>

        {source === 'assets' ? (
          <div className="modal__body library-body">
            {filteredAssets.length === 0 ? (
              <div className="library-empty">
                {assetRefs.length === 0
                  ? `Nothing built in ${openProject?.name ?? 'this project'} yet — make a character, location, prop or wardrobe piece and its plates land here.`
                  : 'No assets match that search.'}
              </div>
            ) : (
              <div className="library-grid">
                {filteredAssets.map(r => (
                  <button
                    key={r.plate.id}
                    className="library-tile"
                    onClick={() => pickAsset(r)}
                    title={`${r.asset.name} · ${r.role} — adds as ${r.category}`}
                  >
                    <img className="library-tile__thumb" src={dispSrc(r.plate.thumbPath || r.plate.path, 'thumb')} alt="" loading="lazy" decoding="async" />
                    <div className="library-tile__body">
                      <div className="library-tile__name">{r.asset.name}</div>
                      <div className="library-tile__cat mono-label">
                        {r.plate.note || r.role} · {r.category}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : source === 'references' ? (
          <div className="modal__body library-body">
            {refsLoading ? (
              <div className="library-empty">Reading the reference set…</div>
            ) : filteredRefs.length === 0 ? (
              <div className="library-empty">
                {refs.length === 0
                  ? `No references in ${openProject?.name ?? 'this project'} yet — hunt them, import them, or clip them from the browser with HJEN Clipper.`
                  : 'No references match that search.'}
              </div>
            ) : (
              <div className="library-grid">
                {filteredRefs.map(r => (
                  <button
                    key={r.id}
                    className="library-tile"
                    onClick={() => pickRef(r)}
                    title={`${r.name} · click to add as ${targetCategory ?? 'general'}`}
                  >
                    <img className="library-tile__thumb" src={dispSrc(r.filePath, 'thumb')} alt="" loading="lazy" decoding="async" />
                    <div className="library-tile__body">
                      <div className="library-tile__name">{r.name}</div>
                      <div className="library-tile__cat mono-label">reference</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
        <>
        <div className="library-tabs">
          <button
            className={`library-tab ${activeTab === 'all' ? 'library-tab--active' : ''}`}
            onClick={() => setActiveTab('all')}
          >All ({library.length})</button>
          {LAYER_CATEGORIES.map(cat => {
            const count = library.filter(a => a.category === cat.id).length;
            return (
              <button
                key={cat.id}
                className={`library-tab ${activeTab === cat.id ? 'library-tab--active' : ''}`}
                onClick={() => setActiveTab(cat.id)}
              >
                {cat.label} ({count})
              </button>
            );
          })}
          <div className="library-tabs__spacer" />
          {LAYER_CATEGORIES.map(cat => {
            // Show an upload button matching the active category, or 'general' when 'all' is active
            if (activeTab !== 'all' && activeTab !== cat.id) return null;
            return (
              <button
                key={`upload-${cat.id}`}
                className="library-upload-btn"
                onClick={() => handleUpload(cat.id)}
                disabled={uploading !== null}
              >
                {uploading === cat.id ? 'Uploading…' : `Upload to ${cat.label}`}
              </button>
            );
          })}
        </div>

        <div className="modal__body library-body">
          {filtered.length === 0 ? (
            <div className="library-empty">
              {library.length === 0
                ? 'Your reference library is empty. Upload images to get started — they stay across all projects.'
                : 'No matches in this category. Try a different tab or search term.'}
            </div>
          ) : (
            <div className="library-grid">
              {filtered.map(asset => (
                <button
                  key={asset.id}
                  className="library-tile"
                  onClick={() => handlePick(asset)}
                  title={`${asset.name} · click to add as ${(targetCategory ?? asset.category)}`}
                >
                  <img className="library-tile__thumb" src={dispSrc(asset.thumbPath, 'thumb')} alt="" loading="lazy" decoding="async" />
                  <div className="library-tile__body">
                    <div className="library-tile__name">{asset.name}</div>
                    <div className="library-tile__cat mono-label">{asset.category}</div>
                  </div>
                  <button
                    className="library-tile__delete"
                    onClick={e => {
                      e.stopPropagation();
                      if (confirm(`Delete "${asset.name}" from library?\n\nThis removes the file permanently and detaches it from any current frame.`)) {
                        deleteLibraryAsset(asset.id);
                      }
                    }}
                    title="Delete from library"
                  >×</button>
                </button>
              ))}
            </div>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
