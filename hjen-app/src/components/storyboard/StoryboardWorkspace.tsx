import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useStoryboard, activeStoryboardProject } from '../../store/storyboardStore';
import type { StoryboardStep } from '../../types/storyboard';
import { ScriptStep } from './ScriptStep';
import { BreakdownStep } from './BreakdownStep';
import { FramesStep } from './FramesStep';
import { ExportStep } from './ExportStep';

const STEPS: ReadonlyArray<{ n: StoryboardStep; code: string; name: string; sub: string }> = [
  { n: 1, code: '01', name: 'Script', sub: 'Paste the film or ad. The whole thing.' },
  { n: 2, code: '02', name: 'Breakdown', sub: 'Cut it into shots. Lock the cast and places.' },
  { n: 3, code: '03', name: 'Storyboard', sub: 'Make every panel. Drag to reorder.' },
  { n: 4, code: '04', name: 'Export', sub: 'Pack the panels + the formatted PDF.' },
];

/** The Storyboard product workspace. Its own 3-step pipeline — NOT the PPM
 *  8-stage ProjectWorkspace. When no storyboard project is open, shows a
 *  project picker (reusing the main store's projects + createProject). */
export function StoryboardWorkspace() {
  const projectId = useStoryboard(s => s.projectId);
  const loaded = useStoryboard(s => s.loaded);
  const step = useStoryboard(s => s.data?.step ?? 1);
  const open = useStoryboard(s => s.open);
  const close = useStoryboard(s => s.close);
  const setStep = useStoryboard(s => s.setStep);
  const setActiveView = useStore(s => s.setActiveView);

  if (!projectId) {
    return <StoryboardPicker onPick={open} onExit={() => setActiveView('studio')} />;
  }

  const project = activeStoryboardProject();

  return (
    <div className="sbw">
      <header className="sbw__crumb">
        <button className="sbw__back" onClick={() => { close(); setActiveView('studio'); }} title="Back to products">
          <span aria-hidden>‹</span> Studio
        </button>
        <span className="sbw__sep">›</span>
        <button className="sbw__back" onClick={close} title="Switch storyboard project">Storyboards</button>
        <span className="sbw__sep">›</span>
        <span className="sbw__name">{project?.name ?? 'Storyboard'}</span>
        <span className="sbw__crumb-spacer" />
        {projectId && <HistoryButton projectId={projectId} />}
      </header>

      <div className="sbw__grid">
        <nav className="sbw__rail" aria-label="Storyboard pipeline">
          <h4 className="sbw__rail-title mono-label">The board</h4>
          <ol className="sbw__steps">
            {STEPS.map(s => (
              <li key={s.n}>
                <button
                  className={`sbw__step ${step === s.n ? 'is-current' : ''}`}
                  onClick={() => setStep(s.n)}
                  aria-current={step === s.n ? 'step' : undefined}
                >
                  <span className="sbw__step-dot" />
                  <span className="sbw__step-num mono-label">{s.code}</span>
                  <span className="sbw__step-name">{s.name}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <main className="sbw__main">
          {!loaded ? (
            <div className="sbw__loading mono-label">Loading storyboard…</div>
          ) : (
            <>
              <div className="sbw__head">
                <div className="sbw__eyebrow mono-label">Step {STEPS[step - 1].code}</div>
                <h1 className="sbw__h1">{STEPS[step - 1].name}.</h1>
                <p className="sbw__sub">{STEPS[step - 1].sub}</p>
              </div>
              {step === 1 && <ScriptStep />}
              {step === 2 && <BreakdownStep />}
              {step === 3 && <FramesStep />}
              {step === 4 && <ExportStep />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── version history / restore ────────────────────────────────────
interface Backup { file: string; ts: number; shots: number; characters: number; places: number; elements: number; scriptChars: number; }

function HistoryButton({ projectId }: { projectId: string }) {
  const open = useStoryboard(s => s.open);
  const [show, setShow] = useState(false);
  const [items, setItems] = useState<Backup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setItems(null);
    const res = await window.hjen.listStoryboardBackups({ id: projectId });
    setItems(res.ok ? res.backups : []);
  };
  const openModal = () => { setShow(true); void load(); };

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setShow(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [show]);

  const restore = async (b: Backup) => {
    setBusy(b.file);
    try {
      const res = await window.hjen.restoreStoryboardBackup({ id: projectId, file: b.file });
      if (res.ok) { await open(projectId); setShow(false); }
    } finally { setBusy(null); }
  };

  return (
    <>
      <button className="sbw__history-btn" onClick={openModal} title="Version history — restore an earlier save">
        ⟲ History
      </button>
      {show && (
        <div className="sb-look-modal" onClick={() => setShow(false)}>
          <div className="sb-look-modal__panel sb-history" onClick={e => e.stopPropagation()}>
            <header className="sb-look-modal__head">
              <div>
                <h3>Version history</h3>
                <p className="sb-note">Every saved state is kept. Restore any point — your current board is snapshotted first, so a restore is undoable.</p>
              </div>
              <button type="button" className="sb-icon" onClick={() => setShow(false)} title="Close (Esc)">×</button>
            </header>
            {items === null ? (
              <div className="sbw__loading mono-label">Loading history…</div>
            ) : items.length === 0 ? (
              <div className="sb-empty sb-empty--sm">No restore points yet. They’re created automatically as you work.</div>
            ) : (
              <ul className="sb-history__list">
                {items.map(b => (
                  <li key={b.file} className="sb-history__row">
                    <div className="sb-history__when">{new Date(b.ts).toLocaleString()}</div>
                    <div className="sb-history__stat mono-label">
                      {b.shots} shots · {b.characters + b.places + b.elements} assets{b.scriptChars > 0 ? ' · script' : ''}
                    </div>
                    <button className="sb-btn sb-btn--sm" onClick={() => restore(b)} disabled={!!busy}>
                      {busy === b.file ? 'Restoring…' : 'Restore'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── project picker ───────────────────────────────────────────────
function StoryboardPicker({ onPick, onExit }: { onPick: (id: string) => void; onExit: () => void }) {
  const projects = useStore(s => s.projects);
  const createProject = useStore(s => s.createProject);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  // Surface the most recently touched first (projects come newest-first already).
  useEffect(() => { /* projects load at app init */ }, []);

  const handleCreate = async () => {
    const n = newName.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const p = await createProject(n);
      setNewName('');
      onPick(p.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page sbw-picker">
      <header className="page__header">
        <div>
          <button className="sbw__back" onClick={onExit} title="Back to products">
            <span aria-hidden>‹</span> Studio
          </button>
          <h1 className="page__title">Storyboards</h1>
          <p className="page__subtitle mono-label">
            Open a project to board it, or start a new one. {projects.length} project{projects.length === 1 ? '' : 's'}.
          </p>
        </div>
        <div className="page__create">
          <input
            className="setting-input page__create-input"
            placeholder="New storyboard project…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
          />
          <button className="btn-primary" onClick={handleCreate} disabled={!newName.trim() || busy}>Create</button>
        </div>
      </header>

      {projects.length === 0 ? (
        <div className="page__empty">No projects yet. Create one above to start a storyboard.</div>
      ) : (
        <div className="sbw-picker__grid">
          {projects.map(p => (
            <button key={p.id} className="sbw-picker__card" onClick={() => onPick(p.id)}>
              {p.coverImagePath ? (
                <img className="sbw-picker__cover" src={`hjen-file://${encodeURI(p.coverImagePath)}`} alt="" loading="lazy" />
              ) : (
                <div className="sbw-picker__cover sbw-picker__cover--empty">{p.name.slice(0, 1).toUpperCase()}</div>
              )}
              <div className="sbw-picker__body">
                <div className="sbw-picker__name">{p.name}</div>
                <div className="sbw-picker__meta mono-label">{new Date(p.created).toLocaleDateString()}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
