import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { ProjectSwitcher } from './ProjectSwitcher';
import { DetailsPanel } from './DetailsPanel';
import { LibraryModal } from './LibraryModal';
import {
  angleThumb, movieThumb, photographerThumb,
  cameraIcon, cameraSample, lensIcon, lensSample,
  stockIcon, stockSample, lightingThumb, movementStandin,
} from '../lib/catalog';

const FOCAL_OPTIONS = [
  { v: 14, label: '14mm', desc: 'Ultra Wide' },
  { v: 24, label: '24mm', desc: 'Wide' },
  { v: 35, label: '35mm', desc: 'Wide-Standard' },
  { v: 50, label: '50mm', desc: 'Standard' },
  { v: 85, label: '85mm', desc: 'Short Telephoto / Portrait' },
  { v: 105, label: '105mm', desc: 'Portrait Telephoto' },
  { v: 150, label: '150mm', desc: 'Telephoto' },
];

const APERTURE_OPTIONS = [
  { v: 1.4, label: 'f/1.4', desc: 'Very shallow DoF' },
  { v: 2, label: 'f/2', desc: 'Shallow DoF' },
  { v: 2.8, label: 'f/2.8', desc: 'Shallow DoF' },
  { v: 4, label: 'f/4', desc: 'Moderate DoF' },
  { v: 5.6, label: 'f/5.6', desc: 'Standard DoF' },
  { v: 8, label: 'f/8', desc: 'Deep DoF' },
  { v: 11, label: 'f/11', desc: 'Very deep DoF' },
];

const ASPECT_OPTIONS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'];

export function PickerModal() {
  const { activePicker, catalog, selections } = useStore();
  const close = useStore(s => s.closePicker);
  const set = useStore(s => s.setSelection);
  const [search, setSearch] = useState('');
  // Category filter — picker-specific. Reset to 'All' whenever the picker
  // opens/changes so the user always sees the full set first.
  const [category, setCategory] = useState<string>('All');

  useEffect(() => { setSearch(''); setCategory('All'); }, [activePicker]);

  if (!activePicker) return null;
  if (activePicker === 'projects') return <ProjectSwitcher />;
  if (activePicker === 'details') return <DetailsPanel />;
  if (activePicker === 'library') return <LibraryModal />;
  if (!catalog) return null;

  // Map each picker kind → (current value is set?, action that clears it).
  // Used to render a "Clear" button in the modal header so the user can
  // opt OUT of any single setting — preventing the prompt builder from
  // appending its corresponding fragment.
  const clearableMap: Record<string, { isSet: boolean; clear: () => void } | undefined> = {
    angle:        { isSet: !!selections.angle,        clear: () => { set('angle', null); close(); } },
    movie:        { isSet: !!selections.movie,        clear: () => { set('movie', null); close(); } },
    photographer: { isSet: !!selections.photographer, clear: () => { set('photographer', null); close(); } },
    camera:       { isSet: !!selections.camera,       clear: () => { set('camera', null); close(); } },
    lens:         { isSet: !!selections.lens,         clear: () => { set('lens', null); close(); } },
    stock:        { isSet: !!selections.stock,        clear: () => { set('stock', null); close(); } },
    lighting:     { isSet: !!selections.lighting,     clear: () => { set('lighting', null); close(); } },
    movement:     { isSet: !!selections.movement,     clear: () => { set('movement', null); close(); } },
    focal:        { isSet: selections.focal_mm !== null,    clear: () => { set('focal_mm', null);    close(); } },
    aperture:     { isSet: selections.aperture_f !== null,  clear: () => { set('aperture_f', null);  close(); } },
    // Aspect is always set (it's a string with a default) — no clear.
  };
  const clearable = clearableMap[activePicker as string];

  const wrap = (title: string, body: React.ReactNode) => (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <header className="modal__header">
          <span className="mono-label">{title}</span>
          <input className="modal__search" placeholder="Filter…" value={search} onChange={e => setSearch(e.target.value)} />
          {clearable && (
            <button
              className="modal__clear"
              onClick={clearable.clear}
              disabled={!clearable.isSet}
              title={clearable.isSet
                ? 'Clear this setting so the prompt does not include it'
                : 'No selection to clear'}
            >Clear</button>
          )}
          <button className="modal__close" onClick={close}>Close</button>
        </header>
        <div className="modal__body">{body}</div>
      </div>
    </div>
  );

  const q = search.toLowerCase().trim();
  const filt = <T extends { name?: string; title?: string }>(arr: T[]) =>
    q ? arr.filter(x => ((x as any).name || (x as any).title || '').toLowerCase().includes(q)) : arr;

  // Extract unique category values from a list. Returns sorted unique
  // strings — ready to drop into the CategoryStrip pills.
  const uniqueCats = <T,>(items: T[], getCat: (item: T) => string | undefined): string[] => {
    const set = new Set<string>();
    for (const i of items) {
      const c = getCat(i);
      if (c && c.trim()) set.add(c.trim());
    }
    return Array.from(set).sort();
  };

  // Filter items by current category. 'All' = no filter.
  const filtByCat = <T,>(items: T[], getCat: (item: T) => string | undefined): T[] =>
    category === 'All' ? items : items.filter(i => (getCat(i) ?? '').trim() === category);

  // Pills row at top of picker body. Renders nothing if there's only one
  // (or zero) categories — no point cluttering the UI.
  const CategoryStrip = ({ cats }: { cats: string[] }) => {
    if (cats.length <= 1) return null;
    return (
      <div className="picker-cats">
        <button
          className={`picker-cat ${category === 'All' ? 'picker-cat--active' : ''}`}
          onClick={() => setCategory('All')}
        >
          All <span className="picker-cat__count">{cats.length + 1}</span>
        </button>
        {cats.map(c => (
          <button
            key={c}
            className={`picker-cat ${category === c ? 'picker-cat--active' : ''}`}
            onClick={() => setCategory(c)}
          >{c}</button>
        ))}
      </div>
    );
  };

  switch (activePicker) {
    case 'angle': {
      return wrap('Select perspective', (
        <div className="grid grid--3">
          {filt(catalog.angles).map(a => (
            <Tile key={a.id} active={selections.angle?.id === a.id} thumb={angleThumb(a.filename)} title={a.name} sub={a.description} onClick={() => set('angle', a)} />
          ))}
        </div>
      ));
    }
    case 'movie': {
      const cats = uniqueCats(catalog.movies.items, m => m.type);
      const items = filt(filtByCat(catalog.movies.items, m => m.type));
      return wrap('Select movie reference', (
        <>
          <CategoryStrip cats={cats} />
          <div className="grid grid--3">
            {items.map(m => (
              <Tile key={m.id} active={selections.movie?.id === m.id} thumb={movieThumb(m.filename)} title={m.title} sub={`${m.year}${m.director ? ' · ' + m.director : ''}`} onClick={() => set('movie', m)} />
            ))}
          </div>
        </>
      ));
    }
    case 'photographer': {
      const cats = uniqueCats(catalog.photographers.items, p => p.genre);
      const items = filt(filtByCat(catalog.photographers.items, p => p.genre));
      return wrap('Select photographer', (
        <>
          <CategoryStrip cats={cats} />
          <div className="grid grid--3">
            {items.map(p => (
              <Tile key={p.id} active={selections.photographer?.id === p.id} thumb={photographerThumb(p.filename)} title={p.name} sub={p.notes} onClick={() => set('photographer', p)} />
            ))}
          </div>
        </>
      ));
    }
    case 'camera': {
      const cats = uniqueCats(catalog.cameras.items, c => c.format);
      const items = filt(filtByCat(catalog.cameras.items, c => c.format));
      return wrap('Select camera body', (
        <>
          <CategoryStrip cats={cats} />
          <div className="grid grid--3">
            {items.map(c => (
              <Tile key={c.id} active={selections.camera?.id === c.id} thumb={cameraSample(c.sample_filename)} icon={cameraIcon(c.filename)} title={c.name} sub={c.aesthetic} onClick={() => set('camera', c)} />
            ))}
          </div>
        </>
      ));
    }
    case 'lens': {
      const cats = uniqueCats(catalog.lenses.items, l => l.type);
      const items = filt(filtByCat(catalog.lenses.items, l => l.type));
      return wrap('Select lens', (
        <>
          <CategoryStrip cats={cats} />
          <div className="grid grid--3">
            {items.map(l => (
              <Tile key={l.id} active={selections.lens?.id === l.id} thumb={lensSample(l.sample_filename)} icon={lensIcon(l.filename)} title={l.name} sub={l.note} onClick={() => set('lens', l)} />
            ))}
          </div>
        </>
      ));
    }
    case 'stock': {
      // Stocks have no explicit `category` field — use `usage` heuristic.
      const cats = uniqueCats(catalog.stocks.items, s => s.usage);
      const items = filt(filtByCat(catalog.stocks.items, s => s.usage));
      return wrap('Select film stock', (
        <>
          <CategoryStrip cats={cats} />
          <div className="grid grid--3">
            {items.map(s => (
              <Tile key={s.id} active={selections.stock?.id === s.id} thumb={stockSample(s.sample_filename)} icon={stockIcon(s.filename)} title={s.name} sub={s.usage} onClick={() => set('stock', s)} />
            ))}
          </div>
        </>
      ));
    }
    case 'lighting': {
      const cats = uniqueCats(catalog.lighting.items, l => l.category);
      const items = filt(filtByCat(catalog.lighting.items, l => l.category));
      return wrap('Select lighting', (
        <>
          <CategoryStrip cats={cats} />
          <div className="grid grid--3">
            {items.map(l => (
              <Tile key={l.id} active={selections.lighting?.id === l.id} thumb={lightingThumb(l.filename)} title={l.name} sub={l.description} onClick={() => set('lighting', l)} />
            ))}
          </div>
        </>
      ));
    }
    case 'movement': {
      const cats = uniqueCats(catalog.cameraMovements.items, m => m.category);
      const items = filt(filtByCat(catalog.cameraMovements.items, m => m.category));
      return wrap('Select camera movement', (
        <>
          <CategoryStrip cats={cats} />
          <div className="grid grid--3">
            {items.map(m => (
              <Tile key={m.id} active={selections.movement?.id === m.id} thumb={movementStandin(m.stand_in_filename)} title={m.name} sub={m.description} onClick={() => set('movement', m)} />
            ))}
          </div>
        </>
      ));
    }
    case 'focal': {
      return wrap('Set focal length', (
        <div className="grid grid--row">
          {FOCAL_OPTIONS.map(o => (
            <Tile key={o.v} active={selections.focal_mm === o.v} title={o.label} sub={o.desc} onClick={() => set('focal_mm', o.v)} />
          ))}
        </div>
      ));
    }
    case 'aperture': {
      return wrap('Set aperture', (
        <div className="grid grid--row">
          {APERTURE_OPTIONS.map(o => (
            <Tile key={o.v} active={selections.aperture_f === o.v} title={o.label} sub={o.desc} onClick={() => set('aperture_f', o.v)} />
          ))}
        </div>
      ));
    }
    case 'aspect': {
      return wrap('Set aspect ratio', (
        <div className="grid grid--row">
          {ASPECT_OPTIONS.map(a => (
            <Tile key={a} active={selections.aspect === a} title={a} sub="" onClick={() => set('aspect', a)} />
          ))}
        </div>
      ));
    }
  }
  return null;
}

function Tile({ thumb, icon, title, sub, active, onClick }: { thumb?: string; icon?: string; title: string; sub?: string; active?: boolean; onClick: () => void }) {
  return (
    <button className={`tile ${active ? 'tile--active' : ''}`} onClick={onClick}>
      {thumb && (
        <div className="tile__thumb-wrap">
          <img className="tile__thumb" src={thumb} alt="" loading="lazy" />
          {icon && <img className="tile__icon" src={icon} alt="" />}
        </div>
      )}
      <div className="tile__title">{title}</div>
      {sub && <div className="tile__sub">{sub}</div>}
    </button>
  );
}
