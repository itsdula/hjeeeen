import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { cleanTitle } from './QualityBadge';
import { cleanFileName } from '../lib/downloadName';
import type { GlobalGenerationEntry, ProjectFileEntry } from '../types/hjen-bridge';

// House pattern for turning a stored absolute path into an <img> src — the same
// resolver ProjectsPage / LibraryPage / GenerationPreview use. On web this token
// is rewritten to the cloud endpoint by the host adapter; on desktop it streams
// the local file. We never invent a new scheme.
function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

// filesList() carries an explicit `isVideo`; fall back to the extension signal the
// rest of the app uses so legacy rows still read correctly.
const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i;
const isVideo = (g: GlobalGenerationEntry) => g.isVideo ?? VIDEO_RE.test(g.imgPath);

// Human folder names for the raw tool ids filesList() reports. Anything we don't
// recognise gets Title-cased so a new tool still lands in a sensible folder.
const TOOL_LABELS: Record<string, string> = {
  frame: 'Frames',
  video: 'Videos',
  storyboard: 'Storyboard',
  breakdown: 'Breakdown',
  cuts: 'Cuts',
  reference: 'References',
  cast: 'Cast',
  world: 'Worlds',
  // The four asset factories. Each tags its plates with its own tool id, so
  // opening a project here shows the world it was built from — split by kind —
  // beside the frames that world produced.
  'asset-character': 'Characters',
  'asset-location': 'Locations',
  'asset-prop': 'Props',
  'asset-wardrobe': 'Wardrobe',
};
const OTHER_TOOL = 'other';
function toolLabel(tool?: string): string {
  const t = tool || OTHER_TOOL;
  if (TOOL_LABELS[t]) return TOOL_LABELS[t];
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// A project's identity key — projectId when we have one, else a name fallback so
// unassigned/legacy rows still bucket together.
const projKey = (g: GlobalGenerationEntry) => g.projectId ?? `name:${g.projectName}`;

// The generation lightbox speaks ProjectFileEntry; the Files log speaks
// GlobalGenerationEntry (a superset). Map the one differing field
// (finalSize → size) so clicking a tile opens the shared preview overlay.
function toEntry(g: GlobalGenerationEntry): ProjectFileEntry {
  return {
    imgPath: g.imgPath,
    thumbPath: g.thumbPath,
    jsonPath: g.jsonPath,
    dateFolder: g.dateFolder,
    baseName: g.baseName,
    promptTitle: g.promptTitle,
    size: g.finalSize,
    quality: g.quality,
    ts: g.ts,
    costUsd: g.costUsd,
    durationMs: g.durationMs,
    modelLabel: g.modelLabel,
  };
}

const byTs = (a: GlobalGenerationEntry, b: GlobalGenerationEntry) => b.ts - a.ts;

interface ProjectFolder {
  key: string;
  name: string;
  count: number;
  toolCount: number;
  newest: number;
  cover?: string;
}

interface ToolFolder {
  tool: string;
  label: string;
  count: number;
  videoCount: number;
  newest: number;
  cover?: string;
  coverIsVideo: boolean;
}

// Where the browser currently is: null projectKey/tool = the top level.
interface Path { projectKey: string | null; tool: string | null }

export function FilesView() {
  const openPreview = useStore(s => s.openPreview);

  // null = loading (first paint), [] = genuinely empty.
  const [items, setItems] = useState<GlobalGenerationEntry[] | null>(null);
  const [search, setSearch] = useState('');
  const [path, setPath] = useState<Path>({ projectKey: null, tool: null });
  // Which tile's download is in flight — disables just that button.
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  const load = () => {
    setItems(null);
    // Guard the bridge call: if the preload doesn't expose filesList (e.g. an
    // app packaged before this door was wired), calling undefined() throws
    // SYNCHRONOUSLY — which the .catch below can't catch — and, because this view
    // is kept-alive and can mount at startup, it would white-screen the whole app.
    const p = window.hjen.filesList?.();
    if (p) p.then(setItems).catch(() => setItems([]));
    else setItems([]);
  };
  useEffect(() => { load(); }, []);

  // Live refresh: a frame/video made anywhere (Studio, MCP, Node…) fires this
  // event — keep the Files browser current without a manual reload.
  useEffect(() => {
    const h = () => load();
    window.addEventListener('hjen:generation-reload', h);
    return () => window.removeEventListener('hjen:generation-reload', h);
  }, []);

  const all = items ?? [];
  const searchQ = search.trim().toLowerCase();
  const searchActive = searchQ.length > 0;

  // ── Level 0 — project folders ─────────────────────────────────
  const projects = useMemo(() => {
    const m = new Map<string, ProjectFolder>();
    const tools = new Map<string, Set<string>>();
    for (const g of all) {
      const k = projKey(g);
      let p = m.get(k);
      if (!p) { p = { key: k, name: g.projectName || 'Unassigned', count: 0, toolCount: 0, newest: 0 }; m.set(k, p); tools.set(k, new Set()); }
      p.count++;
      tools.get(k)!.add(g.tool || OTHER_TOOL);
      if (g.ts >= p.newest) { p.newest = g.ts; p.cover = g.thumbPath ?? (isVideo(g) ? undefined : g.imgPath); }
    }
    const arr = [...m.values()];
    for (const p of arr) p.toolCount = tools.get(p.key)!.size;
    return arr.sort((a, b) => b.newest - a.newest);
  }, [all]);

  const projectKeys = useMemo(() => new Set(projects.map(p => p.key)), [projects]);
  const singleProject = projects.length <= 1;

  // Resolve the effective project the browser is inside. With a single project we
  // skip Level 0 entirely and open straight into its tool folders.
  const openProjectKey =
    path.projectKey && projectKeys.has(path.projectKey)
      ? path.projectKey
      : (singleProject ? projects[0]?.key ?? null : null);
  const openProject = projects.find(p => p.key === openProjectKey) ?? null;

  // ── Level 1 — tool folders inside the open project ────────────
  const folders = useMemo(() => {
    if (!openProjectKey) return [] as ToolFolder[];
    const m = new Map<string, ToolFolder>();
    for (const g of all) {
      if (projKey(g) !== openProjectKey) continue;
      const t = g.tool || OTHER_TOOL;
      let f = m.get(t);
      if (!f) { f = { tool: t, label: toolLabel(t), count: 0, videoCount: 0, newest: 0, coverIsVideo: false }; m.set(t, f); }
      f.count++;
      const v = isVideo(g);
      if (v) f.videoCount++;
      if (g.ts >= f.newest) { f.newest = g.ts; f.cover = g.thumbPath ?? (v ? undefined : g.imgPath); f.coverIsVideo = v; }
    }
    return [...m.values()].sort((a, b) => b.newest - a.newest);
  }, [all, openProjectKey]);

  const openTool =
    path.tool && folders.some(f => f.tool === path.tool) ? path.tool : null;

  // ── Level 2 — files inside the open tool folder ───────────────
  const folderFiles = useMemo(() => {
    if (!openProjectKey || !openTool) return [] as GlobalGenerationEntry[];
    return all
      .filter(g => projKey(g) === openProjectKey && (g.tool || OTHER_TOOL) === openTool)
      .sort(byTs);
  }, [all, openProjectKey, openTool]);

  // ── Search — a flat result set, scoped to the open project (Finder-style) ──
  const searchResults = useMemo(() => {
    if (!searchActive) return [] as GlobalGenerationEntry[];
    const base = openProjectKey ? all.filter(g => projKey(g) === openProjectKey) : all;
    return base
      .filter(g =>
        (g.promptTitle || '').toLowerCase().includes(searchQ) ||
        (g.projectName || '').toLowerCase().includes(searchQ) ||
        toolLabel(g.tool).toLowerCase().includes(searchQ))
      .sort(byTs);
  }, [all, searchActive, searchQ, openProjectKey]);

  // The visible grid drives the lightbox's navigable set so arrows cycle exactly
  // what the user sees.
  const gridItems = searchActive ? searchResults : folderFiles;
  const previewList = useMemo(() => gridItems.map(toEntry), [gridItems]);
  const open = (g: GlobalGenerationEntry) => openPreview(toEntry(g), previewList);

  const download = async (g: GlobalGenerationEntry) => {
    if (downloadingPath) return;
    setDownloadingPath(g.imgPath);
    try {
      await window.hjen.downloadGeneration({
        filePath: g.imgPath,
        name: cleanFileName(g.promptTitle, g.imgPath),
      });
    } finally {
      setDownloadingPath(null);
    }
  };

  const loading = items === null;
  const empty = !loading && all.length === 0;

  // Which stage are we rendering? (search overrides folders.)
  const stage: 'search' | 'files' | 'tools' | 'projects' =
    searchActive ? 'search'
    : openTool ? 'files'
    : openProjectKey ? 'tools'
    : 'projects';

  // Reset navigation.
  const goRoot = () => setPath({ projectKey: null, tool: null });
  const goProject = (key: string) => setPath({ projectKey: key, tool: null });
  const enterProjectFromCrumb = () =>
    setPath(p => ({ projectKey: p.projectKey ?? openProjectKey, tool: null }));
  const enterTool = (tool: string) => setPath(p => ({ projectKey: p.projectKey ?? openProjectKey, tool }));

  // Contextual summary line.
  const summary = (() => {
    if (loading) return 'Reading your library…';
    if (empty) return 'Every frame and clip you make lands here';
    if (stage === 'search') {
      const n = searchResults.length;
      const where = openProject ? ` in ${openProject.name}` : '';
      return `${n} match${n === 1 ? '' : 'es'}${where}`;
    }
    if (stage === 'files' && openProject) {
      const label = toolLabel(openTool!);
      return `${folderFiles.length} ${folderFiles.length === 1 ? 'file' : 'files'} · ${label} · ${openProject.name}`;
    }
    if (stage === 'tools' && openProject) {
      return `${folders.length} folder${folders.length === 1 ? '' : 's'} · ${openProject.count} file${openProject.count === 1 ? '' : 's'} · ${openProject.name}`;
    }
    const totalFiles = all.length;
    return `${projects.length} project${projects.length === 1 ? '' : 's'} · ${totalFiles} file${totalFiles === 1 ? '' : 's'}`;
  })();

  return (
    <div className="page files-page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Files</h1>
          <p className="page__subtitle mono-label">{summary}</p>
        </div>

        <div className="page__header-tools">
          <input
            className="setting-input page__create-input"
            placeholder={openProject && !singleProject ? `Search ${openProject.name}…` : 'Search files…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </header>

      {/* Breadcrumb — the Finder path back up the folder tree. */}
      {!loading && !empty && (openProjectKey || searchActive) && (
        <nav className="files-crumbs" aria-label="Folder path">
          <button type="button" className="files-crumb" onClick={goRoot}>
            <FolderGlyph small />
            {singleProject && openProject ? openProject.name : 'Files'}
          </button>

          {!singleProject && openProject && (
            <>
              <span className="files-crumb-sep" aria-hidden="true">/</span>
              <button
                type="button"
                className={`files-crumb ${!openTool && !searchActive ? 'files-crumb--current' : ''}`}
                onClick={enterProjectFromCrumb}
                aria-current={!openTool && !searchActive ? 'page' : undefined}
              >
                {openProject.name}
              </button>
            </>
          )}

          {openTool && !searchActive && (
            <>
              <span className="files-crumb-sep" aria-hidden="true">/</span>
              <span className="files-crumb files-crumb--current" aria-current="page">
                {toolLabel(openTool)}
              </span>
            </>
          )}

          {searchActive && (
            <>
              <span className="files-crumb-sep" aria-hidden="true">/</span>
              <span className="files-crumb files-crumb--current" aria-current="page">
                Search “{search.trim()}”
              </span>
            </>
          )}
        </nav>
      )}

      {loading && <div className="page__empty">Loading your files…</div>}

      {empty && (
        <div className="page__empty">
          No files yet. Frames and videos you make will appear here — sorted into folders by the tool that made them, ready to browse and download.
        </div>
      )}

      {/* ── Search results — flat grid across the current scope ─────── */}
      {!loading && !empty && stage === 'search' && (
        searchResults.length === 0 ? (
          <div className="page__empty">No files match “{search.trim()}”.</div>
        ) : (
          <div className="files-grid">
            {searchResults.map(g => (
              <FileTile
                key={g.imgPath}
                g={g}
                showProject={!openProjectKey}
                downloading={downloadingPath === g.imgPath}
                onOpen={() => open(g)}
                onDownload={() => download(g)}
              />
            ))}
          </div>
        )
      )}

      {/* ── Level 0 — project folders (only when >1 project) ────────── */}
      {!loading && !empty && stage === 'projects' && (
        <div className="files-folders">
          {projects.map(p => (
            <button
              key={p.key}
              type="button"
              className="files-folder"
              onClick={() => goProject(p.key)}
            >
              <span className="files-folder__cover">
                {p.cover
                  ? <FolderCover src={p.cover} />
                  : <span className="files-folder__cover-empty" aria-hidden="true"><FolderGlyph /></span>}
              </span>
              <span className="files-folder__body">
                <span className="files-folder__label selectable" title={p.name}>{p.name}</span>
                <span className="files-folder__count mono-label">
                  {p.toolCount} folder{p.toolCount === 1 ? '' : 's'} · {p.count} file{p.count === 1 ? '' : 's'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── Level 1 — tool folders inside the open project ──────────── */}
      {!loading && !empty && stage === 'tools' && (
        folders.length === 0 ? (
          <div className="page__empty">This project has no deliverables yet.</div>
        ) : (
          <div className="files-folders">
            {folders.map(f => (
              <button
                key={f.tool}
                type="button"
                className="files-folder"
                onClick={() => enterTool(f.tool)}
              >
                <span className="files-folder__cover">
                  {f.cover
                    ? <FolderCover src={f.cover} />
                    : <span className="files-folder__cover-empty" aria-hidden="true"><FolderGlyph /></span>}
                  {f.videoCount > 0 && (
                    <span className="files-folder__vid mono-label" aria-hidden="true">
                      <PlayGlyph /> {f.videoCount}
                    </span>
                  )}
                </span>
                <span className="files-folder__body">
                  <span className="files-folder__label">{f.label}</span>
                  <span className="files-folder__count mono-label">
                    {f.count} file{f.count === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )
      )}

      {/* ── Level 2 — the tool folder's file grid ───────────────────── */}
      {!loading && !empty && stage === 'files' && (
        folderFiles.length === 0 ? (
          <div className="page__empty">This folder is empty.</div>
        ) : (
          <div className="files-grid">
            {folderFiles.map(g => (
              <FileTile
                key={g.imgPath}
                g={g}
                downloading={downloadingPath === g.imgPath}
                onOpen={() => open(g)}
                onDownload={() => download(g)}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

/* A folder cover thumbnail that quietly falls back to the folder glyph if the
   blob can't be resolved. */
function FolderCover({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="files-folder__cover-empty" aria-hidden="true"><FolderGlyph /></span>;
  return (
    <img
      className="files-folder__cover-img"
      src={fileUrl(src)}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}

function FolderGlyph({ small }: { small?: boolean }) {
  const s = small ? 13 : 30;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" /></svg>
  );
}

function FileTile({
  g, showProject, downloading, onOpen, onDownload,
}: {
  g: GlobalGenerationEntry;
  showProject?: boolean;
  downloading: boolean;
  onOpen: () => void;
  onDownload: () => void;
}) {
  const video = isVideo(g);
  // Videos carry a poster in thumbPath; images fall back to the master itself.
  const thumb = fileUrl(g.thumbPath ?? (video ? undefined : g.imgPath));
  const [broken, setBroken] = useState(false);
  const size = g.finalSize || g.resolution || '';

  return (
    <div className="files-tile">
      <button
        type="button"
        className="files-tile__thumb-btn"
        onClick={onOpen}
        aria-label={`Open ${cleanTitle(g.promptTitle)}`}
      >
        {thumb && !broken ? (
          <img
            className="files-tile__thumb"
            src={thumb}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="files-tile__thumb files-tile__thumb--empty" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              {video
                ? <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" /></>
                : <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="1.6" /><path d="M3 17l5-4 4 3 3-3 6 5" /></>}
            </svg>
          </div>
        )}
        {video && (
          <span className="files-tile__type" aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5v9l7-4.5z" /></svg>
          </span>
        )}
      </button>

      <div className="files-tile__body">
        <div className="files-tile__title selectable" title={g.promptTitle}>{cleanTitle(g.promptTitle)}</div>
        <div className="files-tile__meta mono-label">
          {showProject && <span className="files-tile__proj" title={g.projectName}>{g.projectName}</span>}
          {size && <span>{size}</span>}
          <span>{new Date(g.ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
      </div>

      <button
        type="button"
        className="files-tile__dl"
        onClick={onDownload}
        disabled={downloading}
        title="Download a clean copy"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10" />
        </svg>
        {downloading ? 'Saving…' : 'Download'}
      </button>
    </div>
  );
}
