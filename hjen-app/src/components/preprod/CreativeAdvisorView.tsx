// Creative Advisor — the visible face of the Creative 360 mind. Shows the
// project's durable POV as a readable "brain card", and proposes the concrete
// next moves that would most strengthen the work, per surface. Reads the same
// POV every other tool obeys — the one creative point-of-view for the project.

import { useEffect, useState } from 'react';
import '../../styles/preprod-advisor.css';
import { useStore } from '../../store';
import { PreprodShell, Busy, useToast } from './shared';
import { getPOV, formPOV, advise } from '../../lib/creative360';
import type { CreativePOV, Advice } from '../../lib/creative360';

const SURFACES = ['all', 'references', 'treatment', 'story', 'pitch', 'frames'] as const;
type Surface = typeof SURFACES[number];

const KIND_LABEL: Record<Advice['kind'], string> = { gap: 'GAP', drift: 'DRIFT', lift: 'LIFT' };

export function CreativeAdvisorView() {
  const projectId = useStore(s => s.activeProjectId);
  const [toast, showToast] = useToast();
  const [pov, setPov] = useState<CreativePOV | null>(null);
  const [loadingPov, setLoadingPov] = useState(false);
  const [surface, setSurface] = useState<Surface>('all');
  const [advice, setAdvice] = useState<Advice[]>([]);
  const [advising, setAdvising] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load the cached POV when a project is picked (form on first use).
  useEffect(() => {
    if (!projectId) { setPov(null); setAdvice([]); return; }
    setLoadingPov(true); setErr(null);
    let live = true;
    getPOV(projectId)
      .then(p => { if (live) { setPov(p); if (!p) setErr('No thinking yet — make Brief Mind / Treatment / Story first.'); } })
      .catch(e => { if (live) setErr(String(e?.message || e)); })
      .finally(() => { if (live) setLoadingPov(false); });
    return () => { live = false; };
  }, [projectId]);

  const reform = async () => {
    if (!projectId || loadingPov) return;
    setLoadingPov(true); setErr(null);
    const p = await formPOV(projectId).catch(() => null);
    setPov(p);
    if (!p) setErr('Could not re-form the POV — are the stages filled?');
    else showToast('POV re-formed from the current stages.');
    setLoadingPov(false);
  };

  const runAdvise = async () => {
    if (!projectId || !pov || advising) return;
    setAdvising(true); setErr(null);
    const rows = await advise(projectId, pov, surface).catch(() => [] as Advice[]);
    setAdvice(rows);
    if (rows.length === 0) showToast('Nothing pressing — the work holds on this surface.');
    setAdvising(false);
  };

  return (
    <PreprodShell tool="Creative Advisor" sub="The project's creative mind — POV + next moves" accent="#9B6DD1">
      <div className="pp-grid">
        {/* ── the POV brain card ──────────────────────────── */}
        <aside className="pp-aside pca-aside">
          <div className="pp-panel">
            <div className="pp-panel__head">
              <span className="pp-panel__title mono-label">THE POV</span>
              <span className="ppr-panel-sub">The durable creative brain</span>
            </div>
            {loadingPov && <Busy label="Reading the mind…" />}
            {!loadingPov && !pov && <div className="pca-empty">{err || 'No POV yet.'}</div>}
            {pov && (
              <div className="pca-pov">
                <PovRow label="ESSENCE" v={pov.essence} />
                <PovRow label="REGISTER" v={pov.register} />
                <PovRow label="AUDIENCE" v={pov.audience} />
                <PovRow label="VISUAL LANGUAGE" v={pov.visualLanguage} />
                <div className="pca-forbidden">
                  <div className="pca-row__label mono-label">FORBIDDEN</div>
                  <ul>{(pov.forbidden || []).map((f, i) => <li key={i}>{f}</li>)}</ul>
                </div>
                <PovRow label="NORTH STAR" v={pov.northStar} strong />
                <div className="pca-formed mono-label">
                  formed from {[pov.formedFrom.brief && 'brief', pov.formedFrom.treatment && 'treatment', pov.formedFrom.screenplay && 'story'].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
            )}
            <button className="pp-btn pp-btn--ghost pca-wide" disabled={loadingPov || !projectId} onClick={() => void reform()}>
              Re-form from stages
            </button>
          </div>
        </aside>

        {/* ── the advice ──────────────────────────────────── */}
        <main className="pp-main">
          {err && pov && <div className="pp-error">{err}</div>}
          <div className="pca-bar">
            <div className="pca-seg">
              {SURFACES.map(s => (
                <button key={s} className={`pca-seg__opt${surface === s ? ' is-on' : ''}`} onClick={() => setSurface(s)}>{s}</button>
              ))}
            </div>
            <button className="pp-btn pp-btn--accent" disabled={advising || !pov} onClick={() => void runAdvise()}>
              {advising ? <Busy label="Thinking…" /> : 'What would strengthen this?'}
            </button>
          </div>

          {advice.length === 0 ? (
            <div className="pca-blank">
              <div className="mono-label pca-blank__eyebrow">CREATIVE 360</div>
              <h3 className="pca-blank__h">The mind that serves every tool.</h3>
              <p className="pca-blank__p">
                One creative point-of-view, formed from the brief, the treatment, and the story —
                and obeyed by References, Treatment, Story, and Pitch. Ask it what would strengthen
                the work on any surface, and it answers with concrete moves, not adjectives.
              </p>
            </div>
          ) : (
            <div className="pca-advice">
              {advice.map((a, i) => (
                <div key={i} className={`pca-move pca-move--${a.kind}`}>
                  <div className="pca-move__head">
                    <span className={`pca-kind pca-kind--${a.kind} mono-label`}>{KIND_LABEL[a.kind]}</span>
                    <span className="pca-move__surface mono-label">{a.surface}</span>
                  </div>
                  <div className="pca-move__line">{a.move}</div>
                  {a.why && <div className="pca-move__why">{a.why}</div>}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
      {toast && <div className="pp-toast">{toast}</div>}
    </PreprodShell>
  );
}

function PovRow({ label, v, strong }: { label: string; v: string; strong?: boolean }) {
  if (!v) return null;
  return (
    <div className="pca-row">
      <div className="pca-row__label mono-label">{label}</div>
      <div className={`pca-row__v${strong ? ' is-strong' : ''}`}>{v}</div>
    </div>
  );
}
