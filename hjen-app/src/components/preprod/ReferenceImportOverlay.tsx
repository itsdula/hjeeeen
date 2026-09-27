// Reference import — bring frames INTO the reference set without the hunt.
// Four sources: the user's device, past generations (توليدات), the project's
// Storyboard, and the shared Library. Each picked frame is copied into
// {project}/_references/ and handed back as a HuntedRef the user then annotates
// (Why / Take / Leave still apply — an imported frame is not exempt from the
// house law). The hunt stays; this is the manual lane beside it.

import { useEffect, useState } from 'react';
import { hjenFileUrl } from '../../lib/theme/apply';
import { Busy } from './shared';

export interface ImportItem { path: string; source: string; label?: string }

type Src = 'device' | 'generations' | 'storyboard' | 'library';
interface Thumb { path: string; thumb?: string; label: string }

const SOURCES: Array<{ id: Src; label: string; hint: string }> = [
  { id: 'device', label: 'Device', hint: 'A file from your computer' },
  { id: 'generations', label: 'Generations', hint: 'Frames you already made' },
  { id: 'storyboard', label: 'Storyboard', hint: 'Approved shots on this board' },
  { id: 'library', label: 'Library', hint: 'The shared reference library' },
];

const uniqByPath = (list: Thumb[]): Thumb[] => {
  const seen = new Set<string>();
  return list.filter(t => t.path && !seen.has(t.path) && (seen.add(t.path), true));
};

export function ReferenceImportOverlay({ projectId, onClose, onImport, importing }: {
  projectId: string | null;
  onClose: () => void;
  onImport: (items: ImportItem[]) => void;
  importing: boolean;
}) {
  const [tab, setTab] = useState<Src>('generations');
  const [loading, setLoading] = useState(false);
  const [gens, setGens] = useState<Thumb[] | null>(null);
  const [board, setBoard] = useState<Thumb[] | null>(null);
  const [lib, setLib] = useState<Thumb[] | null>(null);
  const [device, setDevice] = useState<Thumb[]>([]);          // staged device files
  const [picked, setPicked] = useState<Map<string, ImportItem>>(new Map());

  // ── lazy source loaders (fetch a tab's grid the first time it's opened) ──
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        if (tab === 'generations' && gens === null) {
          setLoading(true);
          const all = await window.hjen.listAllGenerations();
          if (live) setGens(uniqByPath(all.map(g => ({ path: g.imgPath, thumb: g.thumbPath, label: g.promptTitle || g.baseName }))));
        } else if (tab === 'storyboard' && board === null) {
          setLoading(true);
          const raw = projectId ? await window.hjen.readStoryboard({ id: projectId }) as any : null;
          const shots: any[] = Array.isArray(raw?.shots) ? raw.shots : [];
          const frames: Thumb[] = [];
          shots.forEach((s, i) => {
            const label = (s.scene != null && s.letter) ? `${s.scene}${s.letter}` : `Shot ${i + 1}`;
            if (s.generatedImagePath) frames.push({ path: s.generatedImagePath, thumb: s.thumbPath, label });
            for (const t of (Array.isArray(s.takes) ? s.takes : [])) {
              if (t.imgPath && t.imgPath !== s.generatedImagePath) frames.push({ path: t.imgPath, thumb: t.thumbPath, label: `${label} · take` });
            }
          });
          if (live) setBoard(uniqByPath(frames));
        } else if (tab === 'library' && lib === null) {
          setLoading(true);
          const assets = await window.hjen.listLibrary();
          if (live) setLib(uniqByPath(assets.map(a => ({ path: a.filePath, thumb: a.thumbPath, label: a.name }))));
        }
      } catch { /* an empty grid is the honest failure state */ }
      if (live) setLoading(false);
    };
    void load();
    return () => { live = false; };
  }, [tab, projectId, gens, board, lib]);

  const pickDevice = async () => {
    const paths = await window.hjen.pickImageFiles();
    if (!paths || paths.length === 0) return;
    const staged = uniqByPath([...device, ...paths.map(p => ({ path: p, thumb: p, label: p.split('/').pop() || 'file' }))]);
    setDevice(staged);
    // device frames are an explicit act — select them the moment they land.
    setPicked(prev => {
      const next = new Map(prev);
      for (const p of paths) next.set(p, { path: p, source: 'Device', label: p.split('/').pop() });
      return next;
    });
  };

  const grid: Thumb[] = tab === 'device' ? device : tab === 'generations' ? (gens ?? []) : tab === 'storyboard' ? (board ?? []) : (lib ?? []);
  const sourceLabel = SOURCES.find(s => s.id === tab)!.label;

  const toggle = (t: Thumb) => {
    setPicked(prev => {
      const next = new Map(prev);
      if (next.has(t.path)) next.delete(t.path);
      else next.set(t.path, { path: t.path, source: sourceLabel, label: t.label });
      return next;
    });
  };

  const count = picked.size;

  return (
    <div className="modal-backdrop" onClick={importing ? undefined : onClose}>
      <div className="modal ppri" style={{ width: 'min(1080px, 100%)' }} onClick={e => e.stopPropagation()}>
        <header className="modal__header">
          <span className="mono-label">Import frames into the set</span>
          <span className="ppri__sub">Device · Generations · Storyboard · Library — annotate Why / Leave after.</span>
          <button className="modal__close" disabled={importing} onClick={onClose}>Close</button>
        </header>

        <div className="ppri__tabs">
          {SOURCES.map(s => (
            <button
              key={s.id}
              className={`ppri__tab${tab === s.id ? ' is-on' : ''}`}
              onClick={() => setTab(s.id)}
              title={s.hint}
            >
              {s.label}
              {s.id === 'device' && device.length > 0 && <span className="ppri__tabcount">{device.length}</span>}
            </button>
          ))}
        </div>

        <div className="modal__body ppri__body">
          {tab === 'device' && device.length === 0 && (
            <div className="ppri__device">
              <p className="ppri__blank">Choose one or more images from your computer. They copy into the project.</p>
              <button className="pp-btn pp-btn--accent" onClick={() => void pickDevice()}>Choose files…</button>
            </div>
          )}

          {tab === 'device' && device.length > 0 && (
            <div className="ppri__devicehead">
              <button className="pp-btn pp-btn--ghost" onClick={() => void pickDevice()}>+ Add more files</button>
            </div>
          )}

          {loading ? (
            <div className="ppri__loading"><Busy label={`Reading ${sourceLabel.toLowerCase()}…`} /></div>
          ) : (tab !== 'device' && grid.length === 0) ? (
            <div className="ppri__blank">
              {tab === 'generations' ? 'No generations yet — make frames first, or import from another source.'
                : tab === 'storyboard' ? 'No approved shots on this board yet.'
                : 'The library is empty — upload images to it first.'}
            </div>
          ) : (
            <div className="ppri__grid">
              {grid.map(t => {
                const on = picked.has(t.path);
                return (
                  <button
                    key={t.path}
                    className={`ppri__tile${on ? ' is-picked' : ''}`}
                    onClick={() => toggle(t)}
                    title={t.label}
                  >
                    <img className="ppri__thumb" src={hjenFileUrl(t.thumb || t.path)} alt="" loading="lazy" decoding="async" />
                    <span className="ppri__check">{on ? '✓' : ''}</span>
                    <span className="ppri__label">{t.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="ppri__foot">
          <span className="mono-label ppri__picked">{count} frame{count === 1 ? '' : 's'} selected</span>
          <span className="ppri__spacer" />
          <button className="pp-btn pp-btn--ghost" disabled={importing} onClick={onClose}>Cancel</button>
          <button
            className="pp-btn pp-btn--accent"
            disabled={count === 0 || importing}
            onClick={() => onImport([...picked.values()])}
          >{importing ? <Busy label="Importing…" /> : `Import ${count || ''}`}</button>
        </footer>
      </div>
    </div>
  );
}
