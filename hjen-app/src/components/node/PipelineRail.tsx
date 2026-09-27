import { useState } from 'react';
import { useStore } from '../../store';
import { GLYPH, PRODUCTS, type ProductId } from '../ProductHub';
import { pipelineProgress, type PlanStep } from '../../lib/space/plan';
import { runStep } from '../../lib/space/run';

/**
 * THE PIPELINE RAIL — the production, across the top of the space.
 *
 * Each pipeline is one stretch of work; open it and you read every step end to
 * end. A step is a BUTTON, because Anwar's contract is that a hand moves this:
 * nothing runs on its own, and a plan that arrives showing progress would be
 * lying about what happened.
 *
 * Pressing a step runs it HERE — the result lands as a node on the board below
 * — except where the tool genuinely needs its own room, which the step says out
 * loud rather than pretending.
 *
 * Numbers signed off in STUDY/ux_redesign/space_gateway_lab.html. They change
 * in the lab first and come back as numbers; do not retune them here.
 */

const PIPE_W = 232;   // px
const GAP = 10;       // px
const LINK = 18;      // px — the run of wire drawn between two steps

/** A step wears its own tool's colour, not its pipeline's — the rail is where
 *  you read what a stretch of work is MADE of. */
const ACCENTS = new Map<string, string>(PRODUCTS.map(p => [p.id as string, p.accent]));
const accentOf = (tool: ProductId): string => ACCENTS.get(tool) ?? '#8A8A8A';

const RUN_GLYPH: Record<string, React.ReactNode> = {
  queued: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>,
  running: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 1-6.4 2.6" /></svg>,
  done: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12.5l5.5 5.5L20 7" /></svg>,
  open: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>,
  failed: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>,
};

/** What the step promises, said plainly on hover. A user who presses a step
 *  should never be surprised by where they end up. */
const KIND_HINT: Record<PlanStep['kind'], string> = {
  make: 'Runs here — the node lands on the board',
  write: 'Writes it here — lands as a note on the board',
  open: 'Needs its own room — opens the tool',
};

export function PipelineRail() {
  const plan = useStore(s => s.spacePlan);
  const setSpacePlan = useStore(s => s.setSpacePlan);
  const patchPlanStep = useStore(s => s.patchPlanStep);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!plan) return null;
  const openPipe = plan.pipelines.find(p => p.id === openId) ?? null;

  const press = (pipelineId: string, index: number) => {
    const st = useStore.getState();
    const cur = st.spacePlan;
    if (!cur) return;
    const row = cur.pipelines.findIndex(p => p.id === pipelineId);
    const pipe = cur.pipelines[row];
    if (!pipe) return;
    void runStep({
      plan: cur,
      pipeline: pipe,
      step: pipe.steps[index],
      row,
      index,
      prevNodeId: index > 0 ? pipe.steps[index - 1].nodeId : undefined,
      patch: p => patchPlanStep(pipelineId, index, p),
    });
  };

  return (
    <div className="pr">
      <div className="pr__head">
        <span className="pr__title">Production</span>
        {/* The user's own words, verbatim. Never paraphrased back at them. */}
        <span className="pr__ask" dir="auto" title={plan.ask}>{plan.ask}</span>
        <button className="pr__act" onClick={() => setSpacePlan(null)}>Re-plan</button>
      </div>

      <div className="pr__track" style={{ gap: GAP }}>
        {plan.pipelines.map(p => {
          const { done, total } = pipelineProgress(p);
          return (
            <button
              key={p.id}
              className={`pr__pipe${openId === p.id ? ' pr__pipe--on' : ''}`}
              style={{ width: PIPE_W, ['--pr-c' as string]: p.accent }}
              onClick={() => setOpenId(openId === p.id ? null : p.id)}
              title={`${p.name} — ${done}/${total} done`}
            >
              <span className="pr__pipeTop">
                <span className="pr__dot" />
                <span className="pr__name">{p.name}</span>
                <span className="pr__n mono-label">{total}</span>
              </span>
              <span className="pr__sub">{p.sub}</span>
              <span className="pr__bar">
                {p.steps.map((s, i) => (
                  <span key={i} className={`pr__seg pr__seg--${s.state}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {openPipe && (
        <div className="pr__steps">
          <div className="pr__stepsBox" style={{ ['--pr-c' as string]: openPipe.accent }}>
            <div className="pr__stepsHead">
              <span className="pr__dot" />
              <span className="pr__name">{openPipe.name}</span>
              <span className="pr__sub">{openPipe.sub} · {openPipe.steps.length} steps</span>
              <button className="pr__close" onClick={() => setOpenId(null)}>close ✕</button>
            </div>
            <div className="pr__stepsList">
              {openPipe.steps.map((s, i) => (
                <span key={i} className="pr__stepWrap">
                  {i > 0 && <span className="pr__link" style={{ width: LINK }} />}
                  <button
                    className={`pr__step pr__step--${s.state}`}
                    style={{ ['--pr-c' as string]: accentOf(s.tool) }}
                    onClick={() => press(openPipe.id, i)}
                    title={KIND_HINT[s.kind]}
                    disabled={s.state === 'running'}
                  >
                    <span className="pr__stepIco">{GLYPH[s.tool]}</span>
                    <span className="pr__stepTxt">
                      <span className="pr__stepTool mono-label">{s.tool}</span>
                      <span className="pr__stepLbl">{s.label}</span>
                      {s.note && <span className="pr__stepNote">{s.note}</span>}
                    </span>
                    <span className="pr__run">{RUN_GLYPH[s.state]}</span>
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

