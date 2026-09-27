import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type BgJob } from '../store';

/**
 * StatusBar — the global bottom bar, present on every HJEN view. A CORE bar
 * (a future Settings toggle can hide it via `statusBarVisible`).
 *
 * Left: the wordmark "HJEN STUDIO 2026" · a hairline divider · the currently
 * running operation (title + mini progress). When more than one op runs, they
 * ROTATE on a gentle cycle. Far right: a small square button that opens a
 * popover of the LAST 10 operations — each a click-through to that op's home
 * (nav) — with a link into the full Operations LOG.
 *
 * Theme-blind, tokens only. Job state uses the semantic --job-* colours (red /
 * green / amber), never the accent. Reserves its own strip at the foot of every
 * full-bleed surface (see .app--statusbar in app.css) so it never overlaps
 * content. House vocabulary: operations are MADE, never "generated".
 */
export function StatusBar() {
  const visible = useStore(s => s.statusBarVisible);
  const bgJobs = useStore(s => s.bgJobs);
  const recentJobs = useStore(s => s.recentJobs);
  const openJobNav = useStore(s => s.openJobNav);
  const setActiveView = useStore(s => s.setActiveView);

  const running = useMemo(() => bgJobs.filter(j => j.status === 'running'), [bgJobs]);
  const [rot, setRot] = useState(0);
  const [popOpen, setPopOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);

  // Rotate the running-op readout when more than one is in flight.
  useEffect(() => {
    if (running.length <= 1) { setRot(0); return; }
    const id = window.setInterval(() => setRot(r => (r + 1) % running.length), 3400);
    return () => window.clearInterval(id);
  }, [running.length]);

  // Close the popover on outside-click / Escape.
  useEffect(() => {
    if (!popOpen) return;
    const onDown = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setPopOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPopOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [popOpen]);

  if (!visible) return null;

  const cur = running.length ? running[Math.min(rot, running.length - 1)] : null;
  const last10 = recentJobs(10);

  return (
    <footer className="status-bar no-drag" role="contentinfo" aria-label="HJEN Studio status">
      <div className="status-bar__log" ref={popRef}>
        <button
          type="button"
          className={`status-bar__square ${popOpen ? 'is-open' : ''}`}
          aria-label="Recent operations"
          aria-expanded={popOpen}
          title="Recent operations"
          onClick={() => setPopOpen(o => !o)}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2.5 3.5h9M2.5 7h9M2.5 10.5h9" />
          </svg>
        </button>

        {popOpen && (
          <div className="status-bar__pop" role="menu" aria-label="Recent operations">
            <div className="status-bar__pop-head">
              <span className="mono-label">RECENT OPERATIONS</span>
              <button
                type="button"
                className="status-bar__pop-all"
                onClick={() => { setPopOpen(false); setActiveView('log'); }}
              >
                OPERATIONS LOG →
              </button>
            </div>
            {last10.length === 0 ? (
              <div className="status-bar__pop-empty">Nothing made yet — start an operation and it lands here.</div>
            ) : (
              <ul className="status-bar__pop-list">
                {last10.map(j => (
                  <li key={j.id}>
                    <button
                      type="button"
                      className="status-bar__pop-item"
                      role="menuitem"
                      title={j.title}
                      onClick={() => { setPopOpen(false); void openJobNav(j.id); }}
                    >
                      <span className={`status-bar__pop-dot status-bar__pop-dot--${j.status}`} aria-hidden="true" />
                      <span className="status-bar__pop-title">{j.title}</span>
                      <span className="status-bar__pop-time">{relTime(j.doneAt ?? j.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="status-bar__ops" aria-live="polite">
        {cur ? (
          <button
            type="button"
            className="status-bar__op"
            title={`${cur.title} — running`}
            onClick={() => void openJobNav(cur.id)}
          >
            <span className="status-bar__op-dot" aria-hidden="true" />
            <span className="status-bar__op-title">{cur.title}</span>
            {opProgress(cur) && <span className="status-bar__op-prog">{opProgress(cur)}</span>}
            {running.length > 1 && (
              <span className="status-bar__op-count" aria-label={`${running.length} operations running`}>
                +{running.length - 1}
              </span>
            )}
          </button>
        ) : (
          <span className="status-bar__idle">No operations running</span>
        )}
      </div>

      <span className="status-bar__sep" aria-hidden="true">|</span>
      <div className="status-bar__brand">HJEN STUDIO 2026</div>
    </footer>
  );
}

/** Compact progress for the status bar: stage fraction (multi-stage) or the
 *  op's own progress text (single-stage). */
function opProgress(j: BgJob): string {
  if (j.stages.length > 1) {
    const activeIdx = j.stages.findIndex(s => s.state === 'active');
    const doneCount = j.stages.filter(s => s.state === 'done').length;
    const cur = activeIdx >= 0 ? activeIdx + 1 : doneCount;
    const active = j.stages[activeIdx];
    return `${active ? active.label + ' · ' : ''}${cur}/${j.stages.length}`;
  }
  return j.progressText || '';
}

/** Short relative time — "now", "3m", "2h", "4d". */
export function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
