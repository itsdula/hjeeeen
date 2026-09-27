import { useState } from 'react';
import { useStore } from '../store';
import type { ProjectMeta } from '../types/hjen-bridge';

export function ProjectSwitcher() {
  const projects = useStore(s => s.projects);
  const activeId = useStore(s => s.activeProjectId);
  const projectsRoot = useStore(s => s.projectsRoot);
  const close = useStore(s => s.closePicker);
  const create = useStore(s => s.createProject);
  const select = useStore(s => s.selectProject);
  const remove = useStore(s => s.deleteProject);
  const rename = useStore(s => s.renameProject);

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleCreate = async () => {
    const n = newName.trim();
    if (!n) return;
    await create(n);
    setNewName('');
  };

  const startEdit = (p: ProjectMeta) => { setEditingId(p.id); setEditingName(p.name); };
  const commitEdit = async () => {
    if (editingId && editingName.trim()) await rename(editingId, editingName.trim());
    setEditingId(null);
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" style={{ width: 'min(720px, 100%)' }} onClick={e => e.stopPropagation()}>
        <header className="modal__header">
          <span className="mono-label">Projects</span>
          <span className="modal__root-path" title={projectsRoot}>{shortenPath(projectsRoot)}</span>
          <button className="modal__close" onClick={close}>Close</button>
        </header>

        <div className="modal__body modal__body--padded">
          <div className="project-create">
            <input
              className="setting-input"
              placeholder="New project name (e.g., SAR Hofuf Launch · Aug 2026)"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            />
            <button className="btn-primary" onClick={handleCreate} disabled={!newName.trim()}>Create</button>
          </div>

          <div className="project-list">
            {projects.length === 0 && (
              <div className="project-empty">No projects yet. Create one above to start grouping frames.</div>
            )}
            {projects.map(p => (
              <div key={p.id} className={`project-row ${activeId === p.id ? 'project-row--active' : ''}`}>
                <button className="project-row__pick" onClick={() => { select(p.id); close(); }}>
                  <div className="project-row__main">
                    {editingId === p.id ? (
                      <input
                        autoFocus
                        className="project-row__input"
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <div className="project-row__name">{p.name}</div>
                        <div className="project-row__meta mono-label">
                          {p.slug} · {p.generationCount || 0} generations · created {new Date(p.created).toLocaleDateString()}
                        </div>
                      </>
                    )}
                  </div>
                </button>
                <div className="project-row__actions">
                  <button
                    className="project-row__action"
                    title="Open folder"
                    onClick={e => { e.stopPropagation(); window.hjen.openFolder(`${projectsRoot}/${p.slug}`); }}
                  >
                    Reveal
                  </button>
                  <button
                    className="project-row__action"
                    onClick={e => { e.stopPropagation(); startEdit(p); }}
                  >
                    Rename
                  </button>
                  <button
                    className="project-row__action project-row__action--danger"
                    onClick={async e => {
                      e.stopPropagation();
                      const confirmDelete = confirm(`Delete project "${p.name}"?\n\nThe project will be removed from the list.\nClick OK to also delete its files on disk, or Cancel to keep the files.`);
                      const deleteFiles = confirmDelete;
                      if (!confirm('Confirm: remove project from list?')) return;
                      await remove(p.id, deleteFiles);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {projects.length > 0 && (
            <button className="project-clear" onClick={() => { select(null); close(); }}>
              Use no project (save to _unassigned)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function shortenPath(p: string): string {
  return p ? p.replace(/^\/Users\/[^/]+/, '~') : '';
}
