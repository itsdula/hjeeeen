// Capture — the Zettel inbox. Organ #1 of the Creative Mind: catch a fleeting
// thought in one breath, file it under a DNA dimension, keep it for the day the
// collider needs it. Two skins: a quiet strip on the entry scene, a left drawer
// toggled by the corner glyph anywhere in the session.

import { useMemo, useState } from 'react';
import { useCreativeMind } from '../../store/creativeMindStore';
import { ALL_CARDS } from '../../lib/compiler';
import { CmindAr } from './CmindAr';

/** The 18 DNA dimensions, sourced from the deck so the list can never drift. */
const DIMENSIONS: string[] = Array.from(new Set(ALL_CARDS.map(c => c.dimension)));

function CaptureBar({ compact }: { compact?: boolean }) {
  const captureNote = useCreativeMind(s => s.captureNote);
  const [text, setText] = useState('');
  const [dim, setDim] = useState<string | undefined>(undefined);

  const commit = () => {
    const t = text.trim();
    if (!t) return;
    void captureNote(t, dim);
    setText('');
    // keep the dimension sticky — a session tends to think in one dimension
  };

  return (
    <div className={`cmind-capture${compact ? ' cmind-capture--strip' : ''}`}>
      <input
        className="cmind-capture__input"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        placeholder="Capture what crosses your mind — one breath"
        dir="auto"
        aria-label="Capture a fleeting note"
      />
      <span className="cmind-capture__hint" dir="rtl">التقط ما يمر ببالك — نفس واحد</span>
      <div className="cmind-capture__dims">
        {DIMENSIONS.map(d => (
          <button
            key={d}
            type="button"
            className={`cmind-dimchip${dim === d ? ' is-on' : ''}`}
            onClick={() => setDim(dim === d ? undefined : d)}
            aria-pressed={dim === d}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The full drawer — capture bar + the running list of fleeting notes. */
export function CaptureInbox({ onClose }: { onClose: () => void }) {
  const notes = useCreativeMind(s => s.notes);
  const deleteNote = useCreativeMind(s => s.deleteNote);

  // newest first
  const ordered = useMemo(
    () => [...notes].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)),
    [notes],
  );

  return (
    <aside className="cmind-inbox" role="dialog" aria-label="Capture inbox">
      <div className="cmind-inbox__head">
        <span className="cmind-inbox__en">Capture</span>
        <span className="cmind-inbox__ar" dir="rtl">الالتقاط · fleeting notes</span>
        <button className="cmind-inbox__close" onClick={onClose} aria-label="Close capture">×</button>
      </div>
      <CaptureBar />
      <div className="cmind-notes">
        {ordered.length === 0 ? (
          <div className="cmind-notes__empty">Nothing captured yet — the first thought that passes is the one to keep.</div>
        ) : ordered.map(n => (
          <div key={n.id} className="cmind-note">
            <div className="cmind-note__body">
              <span className="cmind-note__text" dir="auto">{n.text}</span>
              <CmindAr text={n.text} />
              {n.dimension && <span className="cmind-chip">{n.dimension}</span>}
            </div>
            <button
              className="cmind-note__del"
              onClick={() => void deleteNote(n.id)}
              aria-label="Delete note"
            >×</button>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** The entry-scene strip — capture without leaving the brief. */
export function CaptureStrip() {
  return <CaptureBar compact />;
}
