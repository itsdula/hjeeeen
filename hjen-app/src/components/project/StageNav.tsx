import { useStore } from '../../store';
import type { StageNumber } from '../../types/hjen-bridge';
import { STAGES } from './primitives/stages';

/** Left rail of the Project Workspace. Eight stages, click to jump.
 *  Status dot: ember for done (signed), white outline for current,
 *  faint for not started. Advisory: a future stage is *never locked*,
 *  just marked "awaiting Stage N-1". */
export function StageNav() {
  const projectState = useStore(s => s.projectState);
  const activeStage = useStore(s => s.activeProjectStage);
  const jump = useStore(s => s.setActiveProjectStage);

  if (!projectState) return null;

  return (
    <nav className="stage-nav" aria-label="Project pipeline">
      <h4 className="stage-nav__title mono-label">The Journey</h4>
      <ol className="stage-nav__list">
        {STAGES.map(s => {
          const st = projectState.stages[s.n]?.status ?? 'draft';
          const isCurrent = activeStage === s.n;
          const prevSigned = s.n === 1 ? true : (projectState.stages[(s.n - 1) as StageNumber]?.status === 'signed');
          const awaiting = !prevSigned && st === 'draft';
          return (
            <li key={s.n}>
              <button
                className={[
                  'stage-nav__item',
                  isCurrent ? 'is-current' : '',
                  st === 'signed' ? 'is-signed' : '',
                  awaiting ? 'is-awaiting' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => jump(s.n)}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span className="stage-nav__dot" />
                <span className="stage-nav__num mono-label">{s.code}</span>
                <span className="stage-nav__name">{s.name}</span>
                {st === 'signed' && <span className="stage-nav__status mono-label">signed</span>}
                {awaiting && <span className="stage-nav__status stage-nav__status--awaiting mono-label">awaiting {(s.n - 1).toString().padStart(2, '0')}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
