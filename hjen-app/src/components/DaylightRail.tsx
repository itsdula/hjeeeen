import { useStore } from '../store';
import { useActiveTheme } from '../lib/theme/useTheme';
import wordmark from '../assets/hjen_wordmark.svg';

type View = 'studio' | 'projects' | 'library' | 'usage' | 'pricing';

/** Same destinations as AppNav.tsx (kept in sync intentionally). */
const NAV: Array<{ id: View; label: string; icon: JSX.Element }> = [
  { id: 'studio',   label: 'Studio',   icon: <IconGrid /> },
  { id: 'projects', label: 'Projects', icon: <IconFolder /> },
  { id: 'library',  label: 'Library',  icon: <IconStack /> },
  { id: 'usage',    label: 'Usage',    icon: <IconChart /> },
  { id: 'pricing',  label: 'Pricing',  icon: <IconTag /> },
];

/**
 * The Daylight black floating nav rail (Intelly/Clarity طابع). Renders ONLY
 * when the active theme's shell is 'daylight' — returns null otherwise, so it
 * has zero effect on every other theme. Carries global navigation (which the
 * top AppNav is hidden for under this shell — see [data-shell] CSS).
 */
export function DaylightRail() {
  const shell = useActiveTheme().shell;
  const active = useStore(s => s.activeView);
  const setActive = useStore(s => s.setActiveView);

  if (shell !== 'daylight') return null;

  const isActive = (id: View) => id === active || (id === 'studio' && active === 'frame');

  return (
    <aside className="dl-rail no-drag">
      <div className="dl-rail__logo">
        <img src={wordmark} alt="HJEN" className="dl-rail__mark" />
      </div>

      <nav className="dl-rail__nav">
        <div className="dl-rail__section">General</div>
        {NAV.map(item => (
          <button
            key={item.id}
            className={`dl-rail__item ${isActive(item.id) ? 'dl-rail__item--active' : ''}`}
            onClick={() => setActive(item.id)}
          >
            <span className="dl-rail__icon">{item.icon}</span>
            <span className="dl-rail__label">{item.label}</span>
            {isActive(item.id) && <span className="dl-rail__dot" />}
          </button>
        ))}
      </nav>

      <div className="dl-rail__foot">
        <button className="dl-rail__item" onClick={() => setActive('settings')}>
          <span className="dl-rail__icon"><IconGear /></span>
          <span className="dl-rail__label">Settings</span>
        </button>
      </div>
    </aside>
  );
}

/* ---- inline icons (1.6 stroke, currentColor) ---- */
function IconGrid() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
}
function IconFolder() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>;
}
function IconStack() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5"/></svg>;
}
function IconChart() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>;
}
function IconTag() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/></svg>;
}
function IconGear() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
}
