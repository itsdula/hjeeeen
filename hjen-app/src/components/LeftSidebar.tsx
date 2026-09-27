import { useEffect, useState, memo } from 'react';
import { useStore } from '../store';
import type { Job } from '../store';
import type { ProjectFileEntry } from '../types/hjen-bridge';

// Build a URL the renderer can use directly via the custom hjen-file:// protocol
// (registered in electron/main.ts). Avoids base64 IPC for thumbnails.
function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

const PAGE_SIZE = 30;

export function LeftSidebar() {
  const activeProject = useStore(s => s.activeProject());
  const projects = useStore(s => s.projects);
  const activeProjectId = useStore(s => s.activeProjectId);
  const selectProject = useStore(s => s.selectProject);
  const openPicker = useStore(s => s.openPicker);
  const view = useStore(s => s.viewPastGeneration);
  const openPreview = useStore(s => s.openPreview);
  const current = useStore(s => s.current);
  const jobs = useStore(s => s.jobs);
  // Bumps when a new generation finishes so we re-fetch
  const generationStamp = useStore(s => s.history[0]?.ts ?? 0);
  const interruptedJobs = useStore(s => s.interruptedJobs);
  const restoreInterruptedJob = useStore(s => s.restoreInterruptedJob);
  const dismissInterruptedJob = useStore(s => s.dismissInterruptedJob);
  const failedJobs = useStore(s => s.failedJobs);
  const inspectFailedJob = useStore(s => s.inspectFailedJob);
  const dismissFailedJob = useStore(s => s.dismissFailedJob);
  const restoreFailedJob = useStore(s => s.restoreFailedJob);

  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // IDE-style: each date folder + each scope folder (Interrupted, In progress)
  // can be collapsed. Default = all expanded; toggling persists for the
  // session (not across reloads — intentional, daily work is mostly recent).
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const toggleDate = (d: string) => setCollapsedDates(prev => {
    const next = new Set(prev);
    if (next.has(d)) next.delete(d); else next.add(d);
    return next;
  });

  // Multi-select mode for batch move/delete
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showMoveTo, setShowMoveTo] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset selection when leaving select mode or switching project
  useEffect(() => {
    if (!selectMode) { setSelected(new Set()); setShowMoveTo(false); }
  }, [selectMode, activeProject?.slug]);

  const toggleSelected = (imgPath: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(imgPath)) next.delete(imgPath); else next.add(imgPath);
      return next;
    });
  };

  const refreshList = async () => {
    const list = await window.hjen.listProjectFiles({ projectSlug: activeProject?.slug ?? null });
    setFiles(list);
  };

  const handleBatchMove = async (slug: string | null, id: string | null) => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      for (const imgPath of selected) {
        await window.hjen.moveGeneration({ imgPath, targetProjectSlug: slug, targetProjectId: id });
      }
      await refreshList();
      setSelected(new Set());
      setSelectMode(false);
      setShowMoveTo(false);
    } finally {
      setBusy(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} frame${selected.size === 1 ? '' : 's'} permanently?\n\nThe files will be removed from disk.`)) return;
    setBusy(true);
    try {
      for (const imgPath of selected) {
        await window.hjen.deleteGeneration({ imgPath });
      }
      await refreshList();
      setSelected(new Set());
      setSelectMode(false);
    } finally {
      setBusy(false);
    }
  };

  // Load file list whenever active project or new generation completes.
  // After the initial list, kick off a background backfill of any missing
  // thumbnails (for generations saved before the thumbnail-on-save feature),
  // then re-list once that finishes so the sidebar picks up the new thumbs.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const slug = activeProject?.slug ?? null;
    window.hjen.listProjectFiles({ projectSlug: slug }).then(async list => {
      if (cancelled) return;
      setFiles(list);
      setLoading(false);

      const missing = list.filter(f => !f.thumbPath).length;
      if (missing > 0) {
        // Run backfill in the background, don't block UI
        window.hjen.backfillThumbnails({ projectSlug: slug }).then(async res => {
          if (cancelled || res.processed === 0) return;
          const updated = await window.hjen.listProjectFiles({ projectSlug: slug });
          if (!cancelled) setFiles(updated);
        }).catch(err => console.warn('Backfill failed', err));
      }
    }).catch(() => { if (!cancelled) setLoading(false); });
    // A frame made via the MCP fires this (App.tsx onReload) — re-list so the
    // new frame appears live in the Frame history, no restart.
    const onMcpGen = () => { window.hjen.listProjectFiles({ projectSlug: slug }).then(l => { if (!cancelled) setFiles(l); }).catch(() => {}); };
    window.addEventListener('hjen:generation-reload', onMcpGen as EventListener);
    return () => { cancelled = true; window.removeEventListener('hjen:generation-reload', onMcpGen as EventListener); };
  }, [activeProject?.slug, generationStamp]);

  const visibleFiles = showMore ? files : files.slice(0, PAGE_SIZE);
  const grouped = groupByDate(visibleFiles);

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <button className="sidebar__project-pill" onClick={() => openPicker('projects')}>
          <div className="sidebar__project-pill-top">
            <span className="mono-label">Project</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M2 3.5l3 3 3-3"/>
            </svg>
          </div>
          <div className="sidebar__project-pill-name">
            {activeProject ? activeProject.name : 'Choose project'}
          </div>
        </button>

        {projects.length > 1 && (
          <div className="sidebar__quickswitch">
            <span className="mono-label">Switch</span>
            <div className="sidebar__quickswitch-list">
              {projects.slice(0, 4).filter(p => p.id !== activeProjectId).map(p => (
                <button key={p.id} className="sidebar__quickswitch-chip" onClick={() => selectProject(p.id)} title={p.name}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {files.length > 0 && (
          <div className="sidebar__select-toolbar">
            <button
              className={`sidebar__select-toggle ${selectMode ? 'sidebar__select-toggle--active' : ''}`}
              onClick={() => setSelectMode(v => !v)}
            >
              {selectMode ? `Cancel · ${selected.size} selected` : 'Select'}
            </button>
          </div>
        )}
      </header>

      <div className="sidebar__body">
        {failedJobs.length > 0 && (
          <section className="sidebar__group sidebar__group--failed">
            <div className="sidebar__group-header mono-label">
              Failed · {failedJobs.length}
            </div>
            <div className="sidebar__group-items">
              {failedJobs.slice(0, 20).map(j => (
                <div
                  key={j.id}
                  className="sidebar__item sidebar__item--failed sidebar__item--clickable"
                  title={`${j.errorMessage} · click for details`}
                  role="button"
                  tabIndex={0}
                  onClick={() => inspectFailedJob(j)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inspectFailedJob(j); } }}
                >
                  <div className="sidebar__item-thumb sidebar__item-thumb--warn">
                    <span className="warn-mark">!</span>
                  </div>
                  <div className="sidebar__item-body">
                    <div className="sidebar__item-title">{j.promptTitle}</div>
                    <div className="sidebar__item-meta mono-label">
                      {j.modelLabel} · {new Date(j.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="sidebar__interrupted-actions">
                      <button
                        className="sidebar__interrupted-btn sidebar__interrupted-btn--primary"
                        onClick={(e) => { e.stopPropagation(); restoreFailedJob(j.id); }}
                        title="Re-apply this prompt + settings + references into the form (stays here)"
                      >Restore</button>
                      <button
                        className="sidebar__interrupted-btn"
                        onClick={(e) => { e.stopPropagation(); dismissFailedJob(j.id); }}
                        title="Delete this failed entry"
                      >Dismiss</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {interruptedJobs.length > 0 && (
          <section className="sidebar__group sidebar__group--interrupted">
            <div className="sidebar__group-header mono-label">
              Interrupted · {interruptedJobs.length}
            </div>
            <div className="sidebar__group-items">
              {interruptedJobs.map(j => (
                <div key={j.id} className="sidebar__item sidebar__item--interrupted" title={j.promptTitle}>
                  <div className="sidebar__item-thumb sidebar__item-thumb--warn">
                    <span className="warn-mark">⚠</span>
                  </div>
                  <div className="sidebar__item-body">
                    <div className="sidebar__item-title">{j.promptTitle}</div>
                    <div className="sidebar__item-meta mono-label">
                      {j.modelLabel} · {j.aspect} · {new Date(j.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="sidebar__interrupted-actions">
                      <button
                        className="sidebar__interrupted-btn sidebar__interrupted-btn--primary"
                        onClick={(e) => { e.stopPropagation(); restoreInterruptedJob(j.id); }}
                        title="Restore prompt + references into Studio (does NOT re-run; you choose)"
                      >Restore</button>
                      <button
                        className="sidebar__interrupted-btn"
                        onClick={(e) => { e.stopPropagation(); dismissInterruptedJob(j.id); }}
                        title="Dismiss this notice"
                      >Dismiss</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {jobs.length > 0 && (
          <section className="sidebar__group sidebar__group--running">
            <div className="sidebar__group-header mono-label">
              In progress · {jobs.length}
            </div>
            <div className="sidebar__group-items">
              {jobs.map(j => <JobRow key={j.id} job={j} />)}
            </div>
          </section>
        )}

        {loading && files.length === 0 && jobs.length === 0 && <div className="sidebar__empty">Loading…</div>}
        {!loading && files.length === 0 && jobs.length === 0 && (
          <div className="sidebar__empty">
            No frames yet. Hit <strong>Make</strong> below to shoot your first.
          </div>
        )}

        {grouped.map(group => {
          const isCollapsed = collapsedDates.has(group.date);
          return (
            <section key={group.date} className="sidebar__group">
              <button
                className={`sidebar__group-header sidebar__group-header--toggle mono-label ${isCollapsed ? 'sidebar__group-header--collapsed' : ''}`}
                onClick={() => toggleDate(group.date)}
              >
                <svg className="tree-caret" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 1.5l3 3-3 3" />
                </svg>
                <span>{prettyDate(group.date)}</span>
                <span className="sidebar__group-count">{group.items.length}</span>
              </button>
              {!isCollapsed && (
                <div className="sidebar__group-items">
                  {group.items.map(entry => (
                    <HistoryRow
                      key={entry.imgPath}
                      entry={entry}
                      isCurrent={current?.savedPath === entry.imgPath}
                      selectMode={selectMode}
                      selected={selected.has(entry.imgPath)}
                      onPick={selectMode ? () => toggleSelected(entry.imgPath) : view}
                      onDoublePick={selectMode ? undefined : (e) => openPreview(e, files)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {files.length > PAGE_SIZE && !showMore && (
          <button className="sidebar__show-more" onClick={() => setShowMore(true)}>
            Show all ({files.length})
          </button>
        )}
      </div>

      {selectMode && selected.size > 0 && (
        <div className="sidebar__batch">
          <div className="sidebar__batch-count mono-label">{selected.size} selected</div>
          <button className="sidebar__batch-btn" onClick={() => setShowMoveTo(v => !v)} disabled={busy}>
            {showMoveTo ? 'Cancel' : 'Move…'}
          </button>
          <button className="sidebar__batch-btn sidebar__batch-btn--danger" onClick={handleBatchDelete} disabled={busy}>
            Delete
          </button>
          {showMoveTo && (
            <div className="sidebar__batch-targets">
              {projects.filter(p => p.id !== activeProjectId).map(p => (
                <button
                  key={p.id}
                  className="sidebar__batch-target"
                  onClick={() => handleBatchMove(p.slug, p.id)}
                  disabled={busy}
                  title={p.name}
                >{p.name}</button>
              ))}
              <button
                className="sidebar__batch-target sidebar__batch-target--unassigned"
                onClick={() => handleBatchMove(null, null)}
                disabled={busy}
              >_unassigned</button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function groupByDate(entries: ProjectFileEntry[]): Array<{ date: string; items: ProjectFileEntry[] }> {
  const map = new Map<string, ProjectFileEntry[]>();
  for (const e of entries) {
    if (!map.has(e.dateFolder)) map.set(e.dateFolder, []);
    map.get(e.dateFolder)!.push(e);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({ date, items }));
}

interface HistoryRowProps {
  entry: ProjectFileEntry;
  isCurrent: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onPick: (e: ProjectFileEntry) => void;
  onDoublePick?: ((e: ProjectFileEntry) => void) | undefined;
}
const HistoryRow = memo(function HistoryRow({ entry, isCurrent, selectMode, selected, onPick, onDoublePick }: HistoryRowProps) {
  const thumbSrc = fileUrl(entry.thumbPath) || fileUrl(entry.imgPath);
  const cls = [
    'sidebar__item',
    isCurrent && !selectMode ? 'sidebar__item--active' : '',
    selectMode ? 'sidebar__item--selectable' : '',
    selected ? 'sidebar__item--selected' : '',
  ].filter(Boolean).join(' ');
  return (
    <button
      className={cls}
      onClick={() => onPick(entry)}
      onDoubleClick={onDoublePick ? () => onDoublePick(entry) : undefined}
      title={`${entry.promptTitle}${onDoublePick ? ' · double-click to preview' : ''}`}
    >
      {selectMode && (
        <span className={`sidebar__item-checkbox ${selected ? 'sidebar__item-checkbox--on' : ''}`}>
          {selected ? '✓' : ''}
        </span>
      )}
      <div className="sidebar__item-thumb">
        {thumbSrc
          ? <img src={thumbSrc} alt="" loading="lazy" decoding="async" />
          : <div className="sidebar__item-thumb-placeholder" />}
      </div>
      <div className="sidebar__item-body">
        <div className="sidebar__item-title">{entry.promptTitle || 'Untitled'}</div>
        <div className="sidebar__item-meta mono-label">
          {entry.size ?? ''} · {new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        {(entry.costUsd !== undefined || entry.durationMs !== undefined) && (
          <div className="sidebar__item-stats">
            {entry.costUsd !== undefined && (
              <span className="sidebar__item-cost">${entry.costUsd.toFixed(3)}</span>
            )}
            {entry.durationMs !== undefined && (
              <span className="sidebar__item-time">{formatDuration(entry.durationMs)}</span>
            )}
          </div>
        )}
      </div>
    </button>
  );
});

function JobRow({ job }: { job: Job }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.round((Date.now() - job.startedAt) / 1000));
  return (
    <div className="sidebar__item sidebar__item--running" title={job.promptTitle}>
      <div className="sidebar__item-thumb sidebar__item-thumb--running">
        <span className="job-dot" />
      </div>
      <div className="sidebar__item-body">
        <div className="sidebar__item-title">{job.promptTitle}</div>
        <div className="sidebar__item-meta mono-label">
          {job.modelLabel} · {job.aspect} · {job.resolution}
        </div>
        <div className="sidebar__item-stats">
          <span className="sidebar__item-running-label">Making</span>
          <span className="sidebar__item-time">{elapsed}s</span>
        </div>
      </div>
    </div>
  );
}

function prettyDate(d: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (d === today) return 'Today';
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (d === yesterday) return 'Yesterday';
  return new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${r}s`;
}

