import { useStore } from '../store';

type View = 'studio' | 'projects' | 'library' | 'files' | 'usage' | 'pricing';

// Studio moved to the right cluster (next to Learn & Support) via StudioLink.
// The left nav keeps Projects — the workspace switcher — and Files, the
// customer's cross-project browser of everything they've made.
const NAV: Array<{ id: View; label: string }> = [
  { id: 'projects', label: 'Projects' },
  { id: 'files', label: 'Files' },
];

export function AppNav() {
  const active = useStore(s => s.activeView);
  const setActive = useStore(s => s.setActiveView);

  // Studio is the products hub. When the user is inside an individual
  // product workspace (e.g. 'frame'), the Studio tab should still glow
  // since the product lives under Studio in the nav model.
  const isActive = (id: View) =>
    id === active || (id === 'studio' && active === 'frame');

  return (
    <nav className="app-nav no-drag">
      {NAV.map(item => (
        <button
          key={item.id}
          className={`app-nav__btn ${isActive(item.id) ? 'app-nav__btn--active' : ''}`}
          onClick={() => setActive(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
