import { useStore } from '../store';

export function SidebarToggle() {
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const toggle = useStore(s => s.toggleSidebar);

  return (
    <button
      className="sidebar-toggle no-drag"
      onClick={toggle}
      title={sidebarOpen ? 'Hide sidebar (⌘B)' : 'Show sidebar (⌘B)'}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {sidebarOpen ? (
          // Panel with arrow pointing into panel (close)
          <>
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>
            <line x1="6" y1="2.5" x2="6" y2="13.5"/>
            <path d="M11 6l-2 2 2 2"/>
          </>
        ) : (
          // Panel with arrow pointing out (open)
          <>
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>
            <line x1="6" y1="2.5" x2="6" y2="13.5"/>
            <path d="M9 6l2 2-2 2"/>
          </>
        )}
      </svg>
    </button>
  );
}
