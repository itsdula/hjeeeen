// ⌘/ keyboard-shortcuts overlay for the Node view. Renders straight from the
// registry (shortcutGroupsForHelp) so it can never drift from what the keys
// actually do or from the Learn page's reference table.

import { shortcutGroupsForHelp } from '../../lib/node-engine/shortcuts';

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const groups = shortcutGroupsForHelp();
  return (
    <div className="nv-help__backdrop" onPointerDown={onClose}>
      <div className="nv-help" onPointerDown={(e) => e.stopPropagation()}>
        <header className="nv-help__head">
          <span className="nv-help__title">Keyboard shortcuts</span>
          <span className="nv-help__hint mono-label">⌘/ to toggle</span>
          <button className="nv-help__x" onClick={onClose} title="Close">✕</button>
        </header>
        <div className="nv-help__cols">
          {groups.map(g => (
            <section key={g.label} className="nv-help__group">
              <div className="nv-help__grouptitle mono-label">{g.label}</div>
              {g.items.map(it => (
                <div key={it.name} className="nv-help__row">
                  <span className="nv-help__name">{it.name}</span>
                  <span className="nv-help__chords">
                    {it.chords.map((chord, ci) => (
                      <span key={ci} className="nv-help__chord">
                        {ci > 0 && <span className="nv-help__sep">/</span>}
                        {chord.map((k, ki) => <kbd key={ki} className="nv-help__kbd">{k}</kbd>)}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
