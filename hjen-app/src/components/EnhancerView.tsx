import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { enhanceFace } from '../lib/enhancer';
import hjenMaster from '../assets/hjen_master.svg';
import type { ProjectFileEntry, ProjectMeta } from '../types/hjen-bridge';

function fileUrl(absPath?: string): string | undefined {
  if (!absPath) return undefined;
  return `hjen-file://${encodeURI(absPath)}`;
}

type Phase = 'idle' | 'picked' | 'running' | 'done' | 'error';

interface RunStage { name: string; predictionId: string; ms: number }

interface EnhanceState {
  phase: Phase;
  sourcePath: string | null;
  resultUrl: string | null;
  resultPath: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  stages: RunStage[];
  currentStageName: string | null;
}

const INITIAL: EnhanceState = {
  phase: 'idle',
  sourcePath: null,
  resultUrl: null,
  resultPath: null,
  error: null,
  startedAt: null,
  finishedAt: null,
  stages: [],
  currentStageName: null,
};

export function EnhancerView() {
  const setActiveView = useStore(s => s.setActiveView);
  const activeProject = useStore(s => s.activeProject)();
  const projects = useStore(s => s.projects);
  const [state, setState] = useState<EnhanceState>(INITIAL);
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [browseProjectSlug, setBrowseProjectSlug] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // CodeFormer fidelity — 0 = max texture restoration, 1 = max identity lock.
  // 0.7 is the model author's sweet spot for AI-generated portraits.
  const [fidelity, setFidelity] = useState(0.7);
  // Second pass through Clarity Upscaler adds Magnific-style skin/fabric pore
  // detail at the cost of ~$0.05 and ~2 min of compute. Off by default.
  const [clarityPass, setClarityPass] = useState(false);

  // When the picker opens, default to the active project's files. The user
  // can switch projects from inside the modal.
  useEffect(() => {
    if (!pickerOpen) return;
    const slug = browseProjectSlug ?? activeProject?.slug ?? null;
    if (!slug) { setProjectFiles([]); return; }
    let cancelled = false;
    window.hjen.listProjectFiles({ projectSlug: slug }).then(files => {
      if (!cancelled) setProjectFiles(files);
    }).catch(() => { if (!cancelled) setProjectFiles([]); });
    return () => { cancelled = true; };
  }, [pickerOpen, browseProjectSlug, activeProject?.slug]);

  const pickSource = async () => {
    const paths = await window.hjen.pickImageFiles();
    if (!paths || paths.length === 0) return;
    setState({ ...INITIAL, phase: 'picked', sourcePath: paths[0] });
  };

  const pickFromProject = (entry: ProjectFileEntry) => {
    setState({ ...INITIAL, phase: 'picked', sourcePath: entry.imgPath });
    setPickerOpen(false);
  };

  const openProjectPicker = () => {
    setBrowseProjectSlug(activeProject?.slug ?? null);
    setPickerOpen(true);
  };

  const run = async () => {
    if (!state.sourcePath) return;
    const startedAt = performance.now();
    setState(s => ({
      ...s,
      phase: 'running',
      error: null,
      startedAt,
      stages: [],
      currentStageName: 'CodeFormer · face restoration',
    }));
    try {
      const result = await enhanceFace({
        sourcePath: state.sourcePath,
        fidelity,
        clarityPass,
      });

      const slug = 'enhanced-' + (state.sourcePath.split('/').pop() || 'portrait').replace(/\.[^.]+$/, '');
      const saved = await window.hjen.saveGeneration({
        base64: result.b64,
        promptSlug: slug,
        projectSlug: activeProject?.slug,
        projectId: activeProject?.id,
        sidecar: {
          captured: new Date().toISOString(),
          project: activeProject
            ? { id: activeProject.id, name: activeProject.name, slug: activeProject.slug }
            : null,
          tool: 'enhancer',
          sourcePath: state.sourcePath,
          prompt: '[HJEN Enhancer — CodeFormer' + (clarityPass ? ' + Clarity Upscaler' : '') + ']',
          size: result.size,
          finalSize: result.size,
          model: 'Replicate · ' + result.stages.map(s => s.name).join(' + '),
          apiModelId: 'replicate',
          enhancerSettings: { fidelity, clarityPass },
          enhancerStages: result.stages,
          durationMs: Math.round(performance.now() - startedAt),
        },
      });

      setState({
        phase: 'done',
        sourcePath: state.sourcePath,
        resultUrl: result.url,
        resultPath: saved.imgPath,
        error: null,
        startedAt,
        finishedAt: performance.now(),
        stages: result.stages,
        currentStageName: null,
      });
    } catch (err: any) {
      setState(s => ({ ...s, phase: 'error', error: err?.message || String(err), currentStageName: null }));
    }
  };

  const reset = () => setState(INITIAL);

  const elapsed = state.startedAt && state.finishedAt
    ? ((state.finishedAt - state.startedAt) / 1000).toFixed(1) + 's'
    : null;

  return (
    <div className="enhancer">
      <header className="enhancer__header">
        <button className="enhancer__back" onClick={() => setActiveView('studio')}>← Studio</button>
        <div className="enhancer__title">
          <h1>Enhancer</h1>
          <span className="mono-label">De-plastic AI portraits · Restore real skin</span>
        </div>
        <div className="enhancer__project mono-label">
          {activeProject ? activeProject.name : 'No project — result will save to root'}
        </div>
      </header>

      <div className="enhancer__body">
        {/* Source pane */}
        <section className="enhancer-pane">
          <header className="enhancer-pane__head mono-label">Source · AI portrait</header>
          <div className="enhancer-pane__canvas">
            {state.sourcePath ? (
              <img className="enhancer-pane__img" src={fileUrl(state.sourcePath)} alt="" />
            ) : (
              <div className="enhancer-dropzone-wrap">
                <button className="enhancer-dropzone" onClick={pickSource}>
                  <img className="enhancer-dropzone__mark" src={hjenMaster} alt="" />
                  <div className="enhancer-dropzone__title">Pick a portrait</div>
                  <div className="enhancer-dropzone__sub mono-label">
                    PNG / JPG / WEBP · any AI face
                  </div>
                </button>
                <button
                  className="enhancer-fromproject"
                  onClick={openProjectPicker}
                  disabled={projects.length === 0}
                  title={projects.length === 0 ? 'No projects yet' : 'Browse past frames'}
                >
                  From a project →
                </button>
              </div>
            )}
            {state.sourcePath && state.phase !== 'running' && (
              <div className="enhancer-pane__swap-group">
                <button className="enhancer-pane__swap" onClick={pickSource} title="Pick another source">
                  Swap source
                </button>
                <button className="enhancer-pane__swap" onClick={openProjectPicker} title="Browse past frames">
                  From project
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Result pane */}
        <section className="enhancer-pane">
          <header className="enhancer-pane__head mono-label">
            Result · Real photograph
            {elapsed && <span className="enhancer-pane__elapsed"> · {elapsed}</span>}
          </header>
          <div className="enhancer-pane__canvas">
            {state.phase === 'running' && (
              <div className="enhancer-running">
                <div className="spinner" />
                <div className="mono-label">{state.currentStageName ?? 'Running…'}</div>
                <div className="enhancer-running__sub mono-label">
                  {clarityPass
                    ? 'Two-pass: face restoration → skin/fabric detail upscale'
                    : 'Single-pass face restoration · CodeFormer'}
                </div>
              </div>
            )}
            {state.phase === 'done' && state.resultPath && (
              <img className="enhancer-pane__img" src={fileUrl(state.resultPath) || state.resultUrl || ''} alt="" />
            )}
            {state.phase === 'error' && (
              <div className="enhancer-error">
                <div className="enhancer-error__title">Enhance failed</div>
                <pre className="enhancer-error__msg">{state.error}</pre>
                <button className="btn-secondary" onClick={() => setState(s => ({ ...s, phase: 'picked', error: null }))}>
                  Try again
                </button>
              </div>
            )}
            {(state.phase === 'idle' || state.phase === 'picked') && (
              <div className="enhancer-pane__placeholder mono-label">
                {state.phase === 'idle' ? 'Pick a source to begin' : 'Press Enhance below'}
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="enhancer-controls">
        <div className="enhancer-control">
          <label className="mono-label">
            Fidelity · <span className="enhancer-control__val">{fidelity.toFixed(2)}</span>
            <span className="enhancer-control__hint">0 = max texture · 1 = max identity</span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={fidelity}
            disabled={state.phase === 'running'}
            onChange={e => setFidelity(parseFloat(e.target.value))}
          />
        </div>
        <div className="enhancer-control">
          <label className="mono-label enhancer-control__check">
            <input
              type="checkbox"
              checked={clarityPass}
              disabled={state.phase === 'running'}
              onChange={e => setClarityPass(e.target.checked)}
            />
            Clarity Upscaler pass
            <span className="enhancer-control__hint">+pores · fabric · ~$0.05 · +2 min</span>
          </label>
        </div>
      </div>

      <footer className="enhancer__foot">
        <button className="btn-secondary" onClick={reset} disabled={state.phase === 'running'}>
          New
        </button>
        <div className="enhancer__foot-meta mono-label">
          {state.phase === 'done' && state.resultPath
            ? <>Saved · <code>{shortenPath(state.resultPath)}</code> · {state.stages.map(s => s.name).join(' + ')}</>
            : clarityPass
              ? 'Replicate · CodeFormer + Clarity Upscaler · ~$0.055 · ~3 min'
              : 'Replicate · CodeFormer · ~$0.003 · ~30 sec'}
        </div>
        <button
          className="btn-primary enhancer__cta"
          onClick={run}
          disabled={state.phase !== 'picked'}
        >
          {state.phase === 'running' ? 'Enhancing…' : 'Enhance'}
        </button>
      </footer>

      {pickerOpen && (
        <ProjectFilePicker
          projects={projects}
          currentSlug={browseProjectSlug ?? activeProject?.slug ?? null}
          files={projectFiles}
          onSwitchProject={setBrowseProjectSlug}
          onPick={pickFromProject}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

interface ProjectFilePickerProps {
  projects: ProjectMeta[];
  currentSlug: string | null;
  files: ProjectFileEntry[];
  onSwitchProject: (slug: string | null) => void;
  onPick: (entry: ProjectFileEntry) => void;
  onClose: () => void;
}

function ProjectFilePicker({ projects, currentSlug, files, onSwitchProject, onPick, onClose }: ProjectFilePickerProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal enhancer-picker"
        style={{ width: 'min(1080px, 100%)', maxHeight: 'min(720px, 90vh)' }}
        onClick={e => e.stopPropagation()}
      >
        <header className="modal__header">
          <span className="mono-label">Pick a frame to refine</span>
          <select
            className="enhancer-picker__project"
            value={currentSlug ?? ''}
            onChange={e => onSwitchProject(e.target.value || null)}
          >
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map(p => (
              <option key={p.id} value={p.slug}>{p.name}</option>
            ))}
          </select>
          <button className="modal__close" onClick={onClose}>Close</button>
        </header>

        <div className="enhancer-picker__body">
          {files.length === 0 ? (
            <div className="enhancer-picker__empty mono-label">
              No frames in this project yet.
            </div>
          ) : (
            <div className="enhancer-picker__grid">
              {files.map(f => (
                <button
                  key={f.imgPath}
                  className="enhancer-picker__card"
                  onClick={() => onPick(f)}
                  title={f.promptTitle}
                >
                  <img
                    className="enhancer-picker__thumb"
                    src={`hjen-file://${encodeURI(f.thumbPath || f.imgPath)}`}
                    alt=""
                    loading="lazy"
                  />
                  <div className="enhancer-picker__caption mono-label">
                    {f.promptTitle.slice(0, 48)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function shortenPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~');
}
