import { useStore } from '../../store';
import { StageNav } from './StageNav';
import { ProjectLedger } from './ProjectLedger';
import { BriefComposer } from './stages/BriefComposer';
import { stageMeta } from './primitives/stages';
import type { StageNumber } from '../../types/hjen-bridge';

/** The Project Workspace shell. Three columns:
 *   - left rail (220px): StageNav — eight stages, click to jump
 *   - center: the active stage's tool
 *   - right rail (280px): ProjectLedger — notes, risks, open items
 *  Top crumb shows: Projects › [name] › Stage 0X · [stage name]
 *
 *  Today only Brief is wired. Future stages render a stub that explains
 *  what's coming. This is the honest-risk mitigation from the plan:
 *  every stage ships as a vertical slice, the shell is real *now* and
 *  the user always knows where they are. */
export function ProjectWorkspace() {
  const project = useStore(s => s.activeProject());
  const stage = useStore(s => s.activeProjectStage);
  const setActiveView = useStore(s => s.setActiveView);

  if (!project || stage === null) {
    return (
      <div className="project-ws project-ws--empty">
        <p>No project loaded.</p>
        <button onClick={() => setActiveView('projects')}>Back to projects</button>
      </div>
    );
  }

  const meta = stageMeta(stage);

  return (
    <div className="project-ws">
      <header className="project-ws__crumb">
        <button className="project-ws__back" onClick={() => setActiveView('projects')} title="Back to all projects">
          <span aria-hidden>‹</span> Projects
        </button>
        <span className="project-ws__sep">›</span>
        <span className="project-ws__name">{project.name}</span>
        <span className="project-ws__sep">›</span>
        <span className="project-ws__stage mono-label">Stage {meta.code} · {meta.name}</span>

        <div className="project-ws__crumb-actions">
          <button
            className="project-ws__crumb-btn"
            onClick={() => setActiveView('frame')}
            title="Open the Studio canvas with this project active"
          >Open in Studio</button>
        </div>
      </header>

      <div className="project-ws__grid">
        <div className="project-ws__rail project-ws__rail--left">
          <StageNav />
        </div>

        <main className="project-ws__main">
          <div className="project-ws__stage-head">
            <div className="project-ws__stage-eyebrow mono-label">Stage {meta.code}</div>
            <h1 className="project-ws__stage-h1">{meta.name}.</h1>
            <p className="project-ws__stage-sub">{meta.subtitle}</p>
          </div>
          <StageTool stage={stage} />
        </main>

        <div className="project-ws__rail project-ws__rail--right">
          <ProjectLedger />
        </div>
      </div>
    </div>
  );
}

function StageTool({ stage }: { stage: StageNumber }) {
  switch (stage) {
    case 1: return <BriefComposer />;
    default: return <StubStage stage={stage} />;
  }
}

function StubStage({ stage }: { stage: StageNumber }) {
  const meta = stageMeta(stage);
  return (
    <div className="stage-stub">
      <div className="stage-stub__inner">
        <h3 className="stage-stub__h">{meta.name} is coming next.</h3>
        <p className="stage-stub__p">
          The shell is real, the eight stages are real, the data model is real.
          This particular tool is the next vertical slice we'll cut. Until then,
          you can use the ledger on the right to note anything you want this
          stage to carry forward.
        </p>
        <p className="stage-stub__sub mono-label">Plan reference · Stage {meta.code} · {meta.name}</p>
      </div>
    </div>
  );
}
