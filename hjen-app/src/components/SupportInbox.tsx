import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { SupportTicket } from '../types/hjen-bridge';

/* ────────────────────────────────────────────────────────────────────────
 *  Support Inbox — the summary of every Support request submitted in-app.
 *  Reads {projectsRoot}/_support.jsonl (no email, no cloud). Shows the
 *  sender identity attached to each ticket. This is the admin surface for
 *  the in-platform Support system.
 * ──────────────────────────────────────────────────────────────────────── */

function fmtTime(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(ts); }
}

export function SupportInbox() {
  const setActiveView = useStore(s => s.setActiveView);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [root, setRoot] = useState('');
  const [filter, setFilter] = useState<string>('All');

  const load = async () => {
    setLoading(true);
    try {
      const [list, r] = await Promise.all([
        window.hjen.listSupport(),
        window.hjen.getProjectsRoot(),
      ]);
      setTickets(list);
      setRoot(r);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const kinds = ['All', ...Array.from(new Set(tickets.map(t => t.kind)))];
  const shown = filter === 'All' ? tickets : tickets.filter(t => t.kind === filter);

  return (
    <div className="support-inbox">
      <header className="support-inbox__nav">
        <button className="learn-nav__home" onClick={() => setActiveView('studio')} title="Back to Studio">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="support-inbox__navtitle">Support inbox</span>
        <div className="support-inbox__navspacer" />
        <button className="btn-ghost" onClick={load}>Refresh</button>
        {root && <button className="btn-ghost" onClick={() => window.hjen.openFolder(root)}>Reveal file</button>}
      </header>

      <div className="support-inbox__body">
        <div className="support-inbox__head">
          <h1 className="support-inbox__title">Support requests</h1>
          <p className="support-inbox__sub">
            {loading ? 'Loading…' : `${tickets.length} request${tickets.length === 1 ? '' : 's'}`}
            {root && <> · stored at <code>{root}/_support.jsonl</code></>}
          </p>
        </div>

        {kinds.length > 2 && (
          <div className="support-inbox__filters">
            {kinds.map(k => (
              <button
                key={k}
                className={`support-kind ${filter === k ? 'support-kind--on' : ''}`}
                onClick={() => setFilter(k)}
              >{k}</button>
            ))}
          </div>
        )}

        {!loading && shown.length === 0 && (
          <div className="support-inbox__empty">No support requests yet.</div>
        )}

        <div className="support-inbox__list">
          {shown.map(t => (
            <article key={t.id} className="ticket">
              <div className="ticket__row">
                <span className={`ticket__kind ticket__kind--${t.kind.replace(/\s+/g, '-').toLowerCase()}`}>{t.kind}</span>
                <span className="ticket__time">{fmtTime(t.ts)}</span>
              </div>
              <p className="ticket__msg">{t.message}</p>
              <div className="ticket__meta">
                <span className="ticket__sender">
                  <span className="account-avatar ticket__avatar" aria-hidden />
                  {t.user?.name || 'Unknown'}
                  {t.user?.plan && <span className="ticket__plan">{t.user.plan}</span>}
                </span>
                {t.user?.email && <span className="ticket__chip">{t.user.email}</span>}
                {t.user?.host && <span className="ticket__chip">{t.user.host}</span>}
                {t.platform && <span className="ticket__chip">{t.platform}</span>}
                {t.appVersion && <span className="ticket__chip">v{t.appVersion}</span>}
                <span className="ticket__id mono-label">{t.id}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
