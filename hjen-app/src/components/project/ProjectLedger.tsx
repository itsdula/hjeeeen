import { useState } from 'react';
import { useStore } from '../../store';
import type { ProjectLedgerEntry } from '../../types/hjen-bridge';

/** Right rail of the Project Workspace. Notes, risks, open items.
 *  Persists per-project in state.json. Used as the photographer's
 *  thinking-out-loud surface while walking the eight stages. */
export function ProjectLedger() {
  const ledger = useStore(s => s.projectState?.ledger ?? []);
  const addEntry = useStore(s => s.addLedgerEntry);
  const removeEntry = useStore(s => s.removeLedgerEntry);
  const toggleEntry = useStore(s => s.toggleLedgerEntry);

  const [body, setBody] = useState('');
  const [kind, setKind] = useState<ProjectLedgerEntry['kind']>('note');

  const submit = async () => {
    const t = body.trim();
    if (!t) return;
    await addEntry({ kind, body: t });
    setBody('');
  };

  const open = ledger.filter(e => !e.resolved);
  const done = ledger.filter(e => e.resolved);

  return (
    <aside className="project-ledger" aria-label="Project ledger">
      <header className="project-ledger__head">
        <h4 className="project-ledger__title mono-label">Ledger</h4>
        <span className="project-ledger__count mono-label">{open.length} open</span>
      </header>

      <form
        className="project-ledger__form"
        onSubmit={e => { e.preventDefault(); submit(); }}
      >
        <div className="project-ledger__kinds">
          {(['note', 'risk', 'open'] as const).map(k => (
            <button
              key={k}
              type="button"
              className={`project-ledger__kind ${kind === k ? 'is-active' : ''}`}
              onClick={() => setKind(k)}
            >{k}</button>
          ))}
        </div>
        <textarea
          className="project-ledger__textarea"
          placeholder={kind === 'note' ? 'A line for yourself.' : kind === 'risk' ? 'What could go wrong.' : 'What\'s outstanding.'}
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); }}
          rows={2}
        />
        <button type="submit" className="project-ledger__add" disabled={!body.trim()}>Add</button>
      </form>

      <ul className="project-ledger__list">
        {open.length === 0 && done.length === 0 && (
          <li className="project-ledger__empty">No entries yet.</li>
        )}
        {open.map(e => (
          <LedgerItem key={e.id} entry={e} onToggle={() => toggleEntry(e.id)} onRemove={() => removeEntry(e.id)} />
        ))}
        {done.length > 0 && (
          <li className="project-ledger__divider mono-label">resolved</li>
        )}
        {done.map(e => (
          <LedgerItem key={e.id} entry={e} onToggle={() => toggleEntry(e.id)} onRemove={() => removeEntry(e.id)} />
        ))}
      </ul>
    </aside>
  );
}

function LedgerItem({ entry, onToggle, onRemove }: { entry: ProjectLedgerEntry; onToggle: () => void; onRemove: () => void }) {
  return (
    <li className={`ledger-item ledger-item--${entry.kind} ${entry.resolved ? 'is-resolved' : ''}`}>
      <button className="ledger-item__check" onClick={onToggle} title={entry.resolved ? 'Mark open' : 'Mark resolved'}>
        {entry.resolved ? '✓' : '○'}
      </button>
      <div className="ledger-item__body">
        <span className="ledger-item__kind mono-label">{entry.kind}</span>
        <p className="ledger-item__text">{entry.body}</p>
        <span className="ledger-item__ts mono-label">{relTime(entry.ts)}</span>
      </div>
      <button className="ledger-item__remove" onClick={onRemove} title="Remove">×</button>
    </li>
  );
}

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
